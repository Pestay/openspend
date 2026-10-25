import { and, eq } from 'drizzle-orm'
import { accounts, balanceReconciliations } from '../../../db/schema'
import { toMinor, type Currency } from '../../shared/money'
import type { AccountWithBalance, Reconciliation } from '../../shared/types'
import { todayInChile, type Db } from '../db'
import { AppError } from '../errors'

// Una conciliación es un ancla: "al cierre de `date`, el saldo real era `balanceMinor`".
// El saldo a cualquier fecha = ancla más reciente (≤ fecha) + movimientos posteriores a ella.
// Sin anclas = saldo inicial + todos los movimientos.

type Anchor = { id: number; date: string; balanceMinor: number }
type Delta = { date: string; delta: number }

interface AccountState {
  initialBalanceMinor: number
  anchors: Anchor[] // ordenadas por fecha e id
  deltas: Delta[] // variación neta por día, ordenada por fecha
}

const before = (a: Anchor, b: Anchor) => a.date < b.date || (a.date === b.date && a.id < b.id)

/** Saldo calculado al cierre de `date`, usando solo las anclas que cumplan `usable`. */
function calculatedAt(state: AccountState, date: string, usable: (a: Anchor) => boolean = () => true): number {
  const anchor = state.anchors.filter((a) => a.date <= date && usable(a)).at(-1)
  const base = anchor ? anchor.balanceMinor : state.initialBalanceMinor
  const since = anchor?.date ?? ''
  return base + state.deltas.filter((d) => d.date > since && d.date <= date).reduce((sum, d) => sum + d.delta, 0)
}

/** Diferencia sin registrar de una conciliación: lo real menos lo que se calculaba antes de ella. */
function differenceOf(state: AccountState, anchor: Anchor): number {
  return anchor.balanceMinor - calculatedAt(state, anchor.date, (a) => before(a, anchor))
}

function currentBalance(state: AccountState): number {
  const anchor = state.anchors.at(-1)
  const base = anchor ? anchor.balanceMinor : state.initialBalanceMinor
  return base + state.deltas.filter((d) => !anchor || d.date > anchor.date).reduce((sum, d) => sum + d.delta, 0)
}

/** Estado de todas las cuentas del usuario en 3 consultas (D1 limita consultas por request). */
async function loadStates(d1: D1Database, userId: string) {
  const [accountRows, anchorRows, deltaRows] = await d1.batch([
    d1
      .prepare(
        `SELECT id, name, type, currency, initial_balance_minor AS initialBalanceMinor, archived
         FROM accounts WHERE user_id = ? ORDER BY archived, id`,
      )
      .bind(userId),
    d1
      .prepare(
        `SELECT id, account_id AS accountId, date, balance_minor AS balanceMinor, note
         FROM balance_reconciliations WHERE user_id = ? ORDER BY date, id`,
      )
      .bind(userId),
    // Variación neta por cuenta y día, en la moneda de la cuenta (las transferencias suman
    // en la cuenta destino; un movimiento en otra moneda usa su monto convertido a CLP).
    d1
      .prepare(
        `WITH movements AS (
           SELECT account_id AS account, date, CASE kind WHEN 'income' THEN 1 ELSE -1 END AS sign,
             amount_minor, currency, amount_clp
           FROM transactions WHERE user_id = ?1
           UNION ALL
           SELECT to_account_id, date, 1, amount_minor, currency, amount_clp
           FROM transactions WHERE user_id = ?1 AND kind = 'transfer' AND to_account_id IS NOT NULL
         )
         SELECT m.account AS accountId, m.date,
           SUM(m.sign * CASE WHEN m.currency = a.currency THEN m.amount_minor ELSE m.amount_clp END) AS delta
         FROM movements m JOIN accounts a ON a.id = m.account AND a.user_id = ?1
         GROUP BY m.account, m.date ORDER BY m.account, m.date`,
      )
      .bind(userId),
  ])

  type AccountRow = Omit<AccountWithBalance, 'balanceMinor' | 'transactionCount' | 'lastReconciliation' | 'archived'> & {
    archived: number
  }
  const anchors = anchorRows.results as (Anchor & { accountId: number; note: string | null })[]
  const deltas = deltaRows.results as (Delta & { accountId: number })[]
  const states = new Map<number, AccountState & { account: AccountRow }>()
  for (const account of accountRows.results as AccountRow[]) {
    states.set(account.id, {
      account,
      initialBalanceMinor: account.initialBalanceMinor,
      anchors: anchors.filter((a) => a.accountId === account.id),
      deltas: deltas.filter((d) => d.accountId === account.id),
    })
  }
  return { states, anchors }
}

/** Cuentas con su saldo actual (anclado a la última conciliación) y su última conciliación. */
export async function accountsWithReconciledBalance(d1: D1Database, userId: string) {
  const { states } = await loadStates(d1, userId)
  return new Map(
    [...states].map(([id, state]) => {
      const last = state.anchors.at(-1)
      return [
        id,
        {
          balanceMinor: currentBalance(state),
          lastReconciliation: last ? { date: last.date, balanceMinor: last.balanceMinor, differenceMinor: differenceOf(state, last) } : null,
        },
      ]
    }),
  )
}

async function ownedAccount(db: Db, userId: string, accountId: number) {
  const [account] = await db.select().from(accounts).where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)))
  if (!account) throw new AppError(`La cuenta ${accountId} no existe`, 404)
  return account
}

export interface ReconcileInput {
  accountId: number
  date: string
  balance: number // en unidades normales, en la moneda de la cuenta
  note?: string | null
  importBatchId?: number
}

/** Qué saldo calcula OpenSpend a esa fecha y cuánto difiere del real. No guarda nada. */
export async function previewReconciliation(d1: D1Database, db: Db, userId: string, input: Omit<ReconcileInput, 'note'>) {
  const account = await ownedAccount(db, userId, input.accountId)
  if (input.date > todayInChile()) throw new AppError('La fecha de conciliación no puede ser futura')
  const { states } = await loadStates(d1, userId)
  const calculatedMinor = calculatedAt(states.get(account.id)!, input.date)
  const balanceMinor = toMinor(input.balance, account.currency as Currency)
  return { calculatedMinor, balanceMinor, differenceMinor: balanceMinor - calculatedMinor }
}

export async function reconcile(d1: D1Database, db: Db, userId: string, input: ReconcileInput): Promise<Reconciliation> {
  const preview = await previewReconciliation(d1, db, userId, input)
  const [row] = await db
    .insert(balanceReconciliations)
    .values({
      userId,
      accountId: input.accountId,
      date: input.date,
      balanceMinor: preview.balanceMinor,
      note: input.note?.trim() || null,
      importBatchId: input.importBatchId ?? null,
    })
    .returning()
  return {
    id: row.id,
    accountId: row.accountId,
    date: row.date,
    balanceMinor: row.balanceMinor,
    differenceMinor: preview.differenceMinor,
    note: row.note,
  }
}

/** Conciliaciones del usuario (más recientes primero), con su diferencia sin registrar. */
export async function listReconciliations(d1: D1Database, _db: Db, userId: string, accountId?: number): Promise<Reconciliation[]> {
  const { states, anchors } = await loadStates(d1, userId)
  return anchors
    .filter((a) => accountId === undefined || a.accountId === accountId)
    .map((a) => ({
      id: a.id,
      accountId: a.accountId,
      date: a.date,
      balanceMinor: a.balanceMinor,
      differenceMinor: differenceOf(states.get(a.accountId)!, a),
      note: a.note,
    }))
    .sort((x, y) => y.date.localeCompare(x.date) || y.id - x.id)
}

export async function deleteReconciliation(d1: D1Database, userId: string, id: number) {
  const result = await d1.prepare('DELETE FROM balance_reconciliations WHERE id = ? AND user_id = ?').bind(id, userId).run()
  if (result.meta.changes === 0) throw new AppError('Conciliación no encontrada', 404)
  return { deleted: id }
}

/**
 * Convierte ajustes de saldo importados (deltas con fecha) en conciliaciones: en cada ajuste,
 * el saldo real = lo calculado a esa fecha (con lo ya importado) + el ajuste. Una sola
 * inserción para todas.
 */
export async function reconciliationsFromAdjustments(
  d1: D1Database,
  userId: string,
  importBatchId: number,
  adjustments: { accountId: number; date: string; deltaMinor: number; note: string }[],
) {
  if (adjustments.length === 0) return 0
  const { states } = await loadStates(d1, userId)
  const rows: { accountId: number; date: string; balanceMinor: number; note: string }[] = []
  let nextId = Number.MAX_SAFE_INTEGER - adjustments.length // ids provisionales, siempre "después"
  for (const adj of [...adjustments].sort((a, b) => a.date.localeCompare(b.date))) {
    const state = states.get(adj.accountId)!
    const balanceMinor = calculatedAt(state, adj.date) + adj.deltaMinor
    state.anchors.push({ id: nextId++, date: adj.date, balanceMinor })
    state.anchors.sort((a, b) => (before(a, b) ? -1 : 1))
    rows.push({ accountId: adj.accountId, date: adj.date, balanceMinor, note: adj.note })
  }
  await d1
    .prepare(
      `INSERT INTO balance_reconciliations (user_id, account_id, date, balance_minor, note, import_batch_id)
       SELECT ?1, value ->> 'accountId', value ->> 'date', value ->> 'balanceMinor', value ->> 'note', ?2 FROM json_each(?3)`,
    )
    .bind(userId, importBatchId, JSON.stringify(rows))
    .run()
  return rows.length
}
