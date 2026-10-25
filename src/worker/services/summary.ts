import type { AccountWithBalance, Summary } from '../../shared/types'
import { accountsWithReconciledBalance } from './reconciliations'

// Las estadísticas se calculan en CLP (amount_clp). Las transferencias no cuentan
// como ingreso ni gasto.
export async function getSummary(d1: D1Database, userId: string, from: string, to: string): Promise<Summary> {
  const [totals, byCategory, byMonth] = await d1.batch([
    d1
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN kind = 'income' THEN amount_clp END), 0) AS incomeClp,
           COALESCE(SUM(CASE WHEN kind = 'expense' THEN amount_clp END), 0) AS expenseClp
         FROM transactions WHERE user_id = ?3 AND date BETWEEN ?1 AND ?2`,
      )
      .bind(from, to, userId),
    d1
      .prepare(
        `SELECT t.category_id AS categoryId, COALESCE(c.name, 'Sin categoría') AS name, t.kind,
           SUM(t.amount_clp) AS totalClp, COUNT(*) AS count
         FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
         WHERE t.user_id = ?3 AND t.date BETWEEN ?1 AND ?2 AND t.kind != 'transfer'
         GROUP BY t.category_id, t.kind
         ORDER BY totalClp DESC`,
      )
      .bind(from, to, userId),
    d1
      .prepare(
        `SELECT substr(date, 1, 7) AS month,
           COALESCE(SUM(CASE WHEN kind = 'income' THEN amount_clp END), 0) AS incomeClp,
           COALESCE(SUM(CASE WHEN kind = 'expense' THEN amount_clp END), 0) AS expenseClp
         FROM transactions WHERE user_id = ?3 AND date BETWEEN ?1 AND ?2
         GROUP BY month ORDER BY month`,
      )
      .bind(from, to, userId),
  ])

  const { incomeClp, expenseClp } = totals.results[0] as { incomeClp: number; expenseClp: number }
  return {
    from,
    to,
    incomeClp,
    expenseClp,
    netClp: incomeClp - expenseClp,
    byCategory: byCategory.results as Summary['byCategory'],
    byMonth: byMonth.results as Summary['byMonth'],
  }
}

// Saldo por cuenta en la moneda de la cuenta, anclado a su última conciliación (ver
// reconciliations.ts), con la cantidad de movimientos de cada una.
export async function getAccountsWithBalance(d1: D1Database, userId: string): Promise<AccountWithBalance[]> {
  const [{ results }, balances] = await Promise.all([
    d1
      .prepare(
        `SELECT a.id, a.name, a.type, a.currency, a.initial_balance_minor AS initialBalanceMinor, a.archived,
           (SELECT COUNT(*) FROM transactions t
            WHERE t.user_id = a.user_id AND (t.account_id = a.id OR t.to_account_id = a.id)) AS transactionCount
         FROM accounts a WHERE a.user_id = ? ORDER BY a.archived, a.id`,
      )
      .bind(userId)
      .all<Omit<AccountWithBalance, 'archived' | 'balanceMinor' | 'lastReconciliation'> & { archived: number }>(),
    accountsWithReconciledBalance(d1, userId),
  ])
  return results.map((r) => ({ ...r, archived: Boolean(r.archived), ...balances.get(r.id)! }))
}
