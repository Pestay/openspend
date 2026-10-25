import type { AccountWithBalance, Summary } from '../../shared/types'

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

// Saldo por cuenta en la moneda de la cuenta. Si un movimiento está en otra moneda
// (ej. compra en USD con tarjeta en CLP) se usa su monto convertido. Las cuentas en USD
// solo aceptan movimientos en USD (lo valida createTransactions).
export async function getAccountsWithBalance(d1: D1Database, userId: string): Promise<AccountWithBalance[]> {
  const { results } = await d1
    .prepare(
      `WITH movements AS (
         SELECT account_id AS account, CASE kind WHEN 'income' THEN 1 ELSE -1 END AS sign,
           amount_minor, currency, amount_clp, fx_rate
         FROM transactions WHERE user_id = ?1
         UNION ALL
         SELECT to_account_id, 1, amount_minor, currency, amount_clp, fx_rate
         FROM transactions WHERE user_id = ?1 AND kind = 'transfer' AND to_account_id IS NOT NULL
       )
       SELECT a.id, a.name, a.type, a.currency, a.initial_balance_minor AS initialBalanceMinor,
         a.archived,
         a.initial_balance_minor + COALESCE(SUM(m.sign * CASE
           WHEN m.currency = a.currency THEN m.amount_minor
           ELSE m.amount_clp
         END), 0) AS balanceMinor,
         COUNT(m.account) AS transactionCount
       FROM accounts a LEFT JOIN movements m ON m.account = a.id
       WHERE a.user_id = ?1
       GROUP BY a.id ORDER BY a.archived, a.id`,
    )
    .bind(userId)
    .all<Omit<AccountWithBalance, 'archived'> & { archived: number }>()
  return results.map((r) => ({ ...r, archived: Boolean(r.archived) }))
}
