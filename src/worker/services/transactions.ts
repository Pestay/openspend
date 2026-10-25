import { and, desc, eq, gte, isNotNull, like, lte, or, type SQL } from 'drizzle-orm'
import type { z } from 'zod'
import { accounts, transactions } from '../../../db/schema'
import { fromMinor, toMinor, type Currency } from '../../shared/money'
import type { createTransactionsInput, listTransactionsQuery, updateTransactionInput } from '../../shared/schemas'
import type { CreateTransactionsResult, Transaction } from '../../shared/types'
import { addDays, type Db } from '../db'
import { AppError } from '../errors'
import { getUsdClpRates } from './fx'

// Ventana (± días) para considerar que dos movimientos iguales podrían ser el mismo.
const DUPLICATE_WINDOW_DAYS = 2

// D1 permite pocos parámetros por consulta y pocas consultas por invocación en el plan
// gratis, así que las operaciones masivas usan un único parámetro JSON + json_each().
const TRANSACTION_COLUMNS = `id, date, kind, amount_minor AS amountMinor, currency, fx_rate AS fxRate,
  amount_clp AS amountClp, account_id AS accountId, to_account_id AS toAccountId,
  category_id AS categoryId, description, merchant, source, import_batch_id AS importBatchId,
  possible_duplicate_of AS possibleDuplicateOf, created_at AS createdAt`

type CreateInput = z.output<typeof createTransactionsInput>

export async function createTransactions(db: Db, d1: D1Database, input: CreateInput): Promise<CreateTransactionsResult> {
  const allAccounts = await db.select().from(accounts).orderBy(accounts.id)
  const accountById = new Map(allAccounts.map((a) => [a.id, a]))
  const fallbackAccountId = allAccounts.find((a) => !a.archived)?.id
  if (fallbackAccountId === undefined) throw new AppError('No hay cuentas creadas')

  input.transactions.forEach((t, i) => {
    for (const id of [t.accountId, t.toAccountId]) {
      if (id !== undefined && !accountById.has(id)) throw new AppError(`Transacción ${i + 1}: la cuenta ${id} no existe`)
    }
    const account = accountById.get(t.accountId ?? fallbackAccountId)!
    if (account.currency === 'USD' && t.currency !== 'USD') {
      throw new AppError(`Transacción ${i + 1}: la cuenta "${account.name}" es en USD y solo acepta movimientos en USD`)
    }
    if (t.toAccountId && accountById.get(t.toAccountId)!.currency !== account.currency) {
      throw new AppError(`Transacción ${i + 1}: aún no se soportan transferencias entre cuentas de distinta moneda`)
    }
  })

  const usdDates = input.transactions.filter((t) => t.currency === 'USD').map((t) => t.date)
  const rates = await getUsdClpRates(d1, usdDates)

  const rows = input.transactions.map((t) => {
    const amountMinor = toMinor(t.amount, t.currency)
    const fxRate = t.currency === 'CLP' ? 1 : rates.get(t.date)!
    return {
      date: t.date,
      kind: t.kind,
      amountMinor,
      currency: t.currency as Currency,
      fxRate,
      amountClp: Math.round(t.amount * fxRate),
      accountId: t.accountId ?? fallbackAccountId,
      toAccountId: t.toAccountId ?? null,
      categoryId: t.categoryId ?? null,
      description: t.description || null,
      merchant: t.merchant || null,
      source: t.source,
      importBatchId: input.importBatchId ?? null,
      possibleDuplicateOf: null as number | null,
    }
  })

  // Una sola consulta trae todos los candidatos a duplicado del rango de fechas.
  const dates = rows.map((r) => r.date).sort()
  const { results: existing } = await d1
    .prepare(`SELECT ${TRANSACTION_COLUMNS} FROM transactions WHERE date BETWEEN ? AND ?`)
    .bind(addDays(dates[0], -DUPLICATE_WINDOW_DAYS), addDays(dates[dates.length - 1], DUPLICATE_WINDOW_DAYS))
    .all<Transaction>()

  const duplicates: CreateTransactionsResult['duplicates'] = []
  const toInsert: typeof rows = []
  rows.forEach((row, i) => {
    const from = addDays(row.date, -DUPLICATE_WINDOW_DAYS)
    const to = addDays(row.date, DUPLICATE_WINDOW_DAYS)
    const matches = existing.filter(
      (e) =>
        e.accountId === row.accountId &&
        e.amountMinor === row.amountMinor &&
        e.currency === row.currency &&
        e.kind === row.kind &&
        e.date >= from &&
        e.date <= to,
    )
    if (matches.length === 0) {
      toInsert.push(row)
      return
    }
    const inserted = !input.skipDuplicates
    duplicates.push({ input: input.transactions[i], matches, inserted })
    if (inserted) toInsert.push({ ...row, possibleDuplicateOf: matches[0].id })
  })

  if (toInsert.length === 0) return { inserted: [], duplicates }

  const { results: inserted } = await d1
    .prepare(
      `INSERT INTO transactions (date, kind, amount_minor, currency, fx_rate, amount_clp, account_id,
         to_account_id, category_id, description, merchant, source, import_batch_id, possible_duplicate_of)
       SELECT j.value ->> 'date', j.value ->> 'kind', j.value ->> 'amountMinor', j.value ->> 'currency',
         j.value ->> 'fxRate', j.value ->> 'amountClp', j.value ->> 'accountId', j.value ->> 'toAccountId',
         j.value ->> 'categoryId', j.value ->> 'description', j.value ->> 'merchant', j.value ->> 'source',
         j.value ->> 'importBatchId', j.value ->> 'possibleDuplicateOf'
       FROM json_each(?) AS j
       RETURNING ${TRANSACTION_COLUMNS}`,
    )
    .bind(JSON.stringify(toInsert))
    .all<Transaction>()

  return { inserted, duplicates }
}

export async function listTransactions(db: Db, query: z.output<typeof listTransactionsQuery>) {
  const filters: (SQL | undefined)[] = [
    query.from ? gte(transactions.date, query.from) : undefined,
    query.to ? lte(transactions.date, query.to) : undefined,
    query.accountId ? eq(transactions.accountId, query.accountId) : undefined,
    query.categoryId ? eq(transactions.categoryId, query.categoryId) : undefined,
    query.kind ? eq(transactions.kind, query.kind) : undefined,
    query.onlyPossibleDuplicates ? isNotNull(transactions.possibleDuplicateOf) : undefined,
    query.q
      ? or(like(transactions.description, `%${query.q}%`), like(transactions.merchant, `%${query.q}%`))
      : undefined,
  ]
  return db
    .select()
    .from(transactions)
    .where(and(...filters))
    .orderBy(desc(transactions.date), desc(transactions.id))
    .limit(query.limit)
    .offset(query.offset)
}

export async function updateTransaction(
  db: Db,
  d1: D1Database,
  id: number,
  patch: z.output<typeof updateTransactionInput>,
) {
  const [current] = await db.select().from(transactions).where(eq(transactions.id, id))
  if (!current) return null

  const { amount, ...rest } = patch
  const changes: Partial<typeof transactions.$inferInsert> = { ...rest, updatedAt: new Date().toISOString() }

  // Si cambia el monto, la moneda o la fecha, se recalcula la conversión a CLP.
  if (amount !== undefined || patch.currency || patch.date) {
    const currency = patch.currency ?? current.currency
    const date = patch.date ?? current.date
    const human = amount ?? fromMinor(current.amountMinor, current.currency)
    const fxRate = currency === 'CLP' ? 1 : (await getUsdClpRates(d1, [date])).get(date)!
    Object.assign(changes, {
      amountMinor: toMinor(human, currency),
      fxRate,
      amountClp: Math.round(human * fxRate),
    })
  }

  const [updated] = await db.update(transactions).set(changes).where(eq(transactions.id, id)).returning()
  return updated
}

export async function deleteTransaction(db: Db, id: number) {
  const deleted = await db.delete(transactions).where(eq(transactions.id, id)).returning({ id: transactions.id })
  return deleted.length > 0
}
