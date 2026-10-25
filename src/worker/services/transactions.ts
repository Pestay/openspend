import { and, count, desc, eq, gte, isNotNull, like, lte, or } from 'drizzle-orm'
import type { z } from 'zod'
import { accounts, categories, importBatches, transactions } from '../../../db/schema'
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

type DuplicateKey = Pick<Transaction, 'accountId' | 'amountMinor' | 'currency' | 'kind' | 'date'>

/**
 * Movimientos existentes del usuario que podrían duplicar alguno en esas fechas (±ventana).
 * `excludeBatchId` deja fuera un lote en curso: sus tandas no se comparan entre sí.
 */
export async function existingTransactionsAround(
  d1: D1Database,
  userId: string,
  dates: string[],
  excludeBatchId?: number,
): Promise<Transaction[]> {
  if (dates.length === 0) return []
  const sorted = [...dates].sort()
  const { results } = await d1
    .prepare(
      `SELECT ${TRANSACTION_COLUMNS} FROM transactions
       WHERE user_id = ? AND date BETWEEN ? AND ? AND (import_batch_id IS NULL OR import_batch_id != ?)`,
    )
    .bind(userId, addDays(sorted[0], -DUPLICATE_WINDOW_DAYS), addDays(sorted[sorted.length - 1], DUPLICATE_WINDOW_DAYS), excludeBatchId ?? -1)
    .all<Transaction>()
  return results
}

const duplicateKey = (t: DuplicateKey) => `${t.accountId}|${t.amountMinor}|${t.currency}|${t.kind}`

/**
 * Índice para buscar duplicados en tiempo constante por fila (mismo monto, moneda, tipo y
 * cuenta dentro de ±DUPLICATE_WINDOW_DAYS días). Evita recorrer todo `existing` por cada fila,
 * lo que en importaciones grandes excede el límite de CPU.
 */
export function duplicateFinder(existing: Transaction[]): (row: DuplicateKey) => Transaction[] {
  const index = new Map<string, Transaction[]>()
  for (const e of existing) {
    const key = duplicateKey(e)
    index.set(key, [...(index.get(key) ?? []), e])
  }
  return (row) => {
    const from = addDays(row.date, -DUPLICATE_WINDOW_DAYS)
    const to = addDays(row.date, DUPLICATE_WINDOW_DAYS)
    return (index.get(duplicateKey(row)) ?? []).filter((e) => e.date >= from && e.date <= to)
  }
}

// Las claves foráneas solo garantizan que la cuenta/categoría exista, no que sea del
// usuario. Toda referencia que venga del cliente se valida contra los datos del usuario.
async function userCategoryIds(db: Db, userId: string): Promise<Set<number>> {
  const rows = await db.select({ id: categories.id }).from(categories).where(eq(categories.userId, userId))
  return new Set(rows.map((r) => r.id))
}

// `existing` permite fijar contra qué se buscan duplicados. Las importaciones por tandas
// pasan lo que había antes de empezar, para no comparar el archivo consigo mismo.
export async function createTransactions(
  db: Db,
  d1: D1Database,
  userId: string,
  input: CreateInput,
  options: { existing?: Transaction[] } = {},
): Promise<CreateTransactionsResult> {
  const [userAccounts, categoryIds] = await Promise.all([
    db.select().from(accounts).where(eq(accounts.userId, userId)).orderBy(accounts.id),
    userCategoryIds(db, userId),
  ])
  const accountById = new Map(userAccounts.map((a) => [a.id, a]))
  const fallbackAccountId = userAccounts.find((a) => !a.archived)?.id
  if (fallbackAccountId === undefined) throw new AppError('No hay cuentas creadas')

  if (input.importBatchId !== undefined) {
    const [batch] = await db
      .select({ id: importBatches.id })
      .from(importBatches)
      .where(and(eq(importBatches.id, input.importBatchId), eq(importBatches.userId, userId)))
    if (!batch) throw new AppError(`El lote de importación ${input.importBatchId} no existe`)
  }

  input.transactions.forEach((t, i) => {
    for (const id of [t.accountId, t.toAccountId]) {
      if (id !== undefined && !accountById.has(id)) throw new AppError(`Transacción ${i + 1}: la cuenta ${id} no existe`)
    }
    if (t.categoryId !== undefined && !categoryIds.has(t.categoryId)) {
      throw new AppError(`Transacción ${i + 1}: la categoría ${t.categoryId} no existe`)
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
      userId,
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
  const existing = options.existing ?? (await existingTransactionsAround(d1, userId, rows.map((r) => r.date)))

  const duplicates: CreateTransactionsResult['duplicates'] = []
  const toInsert: typeof rows = []
  const findDuplicates = duplicateFinder(existing)
  rows.forEach((row, i) => {
    const matches = findDuplicates(row)
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
      `INSERT INTO transactions (user_id, date, kind, amount_minor, currency, fx_rate, amount_clp, account_id,
         to_account_id, category_id, description, merchant, source, import_batch_id, possible_duplicate_of)
       SELECT j.value ->> 'userId', j.value ->> 'date', j.value ->> 'kind', j.value ->> 'amountMinor', j.value ->> 'currency',
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

// Filtros comunes del listado y su conteo; siempre acotados al usuario.
function transactionFilters(userId: string, query: z.output<typeof listTransactionsQuery>) {
  return and(
    eq(transactions.userId, userId),
    query.from ? gte(transactions.date, query.from) : undefined,
    query.to ? lte(transactions.date, query.to) : undefined,
    query.accountId ? eq(transactions.accountId, query.accountId) : undefined,
    query.categoryId ? eq(transactions.categoryId, query.categoryId) : undefined,
    query.kind ? eq(transactions.kind, query.kind) : undefined,
    query.onlyPossibleDuplicates ? isNotNull(transactions.possibleDuplicateOf) : undefined,
    query.q ? or(like(transactions.description, `%${query.q}%`), like(transactions.merchant, `%${query.q}%`)) : undefined,
  )
}

export async function listTransactions(db: Db, userId: string, query: z.output<typeof listTransactionsQuery>) {
  return db
    .select()
    .from(transactions)
    .where(transactionFilters(userId, query))
    .orderBy(desc(transactions.date), desc(transactions.id))
    .limit(query.limit)
    .offset(query.offset)
}

export async function countTransactions(db: Db, userId: string, query: z.output<typeof listTransactionsQuery>): Promise<number> {
  const [row] = await db.select({ total: count() }).from(transactions).where(transactionFilters(userId, query))
  return row.total
}

export async function updateTransaction(
  db: Db,
  d1: D1Database,
  userId: string,
  id: number,
  patch: z.output<typeof updateTransactionInput>,
) {
  const owned = and(eq(transactions.id, id), eq(transactions.userId, userId))
  const [current] = await db.select().from(transactions).where(owned)
  if (!current) return null

  for (const accountId of [patch.accountId, patch.toAccountId]) {
    if (accountId == null) continue
    const [account] = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)))
    if (!account) throw new AppError(`La cuenta ${accountId} no existe`)
  }
  if (patch.categoryId != null && !(await userCategoryIds(db, userId)).has(patch.categoryId)) {
    throw new AppError(`La categoría ${patch.categoryId} no existe`)
  }

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

  const [updated] = await db.update(transactions).set(changes).where(owned).returning()
  return updated
}

export async function deleteTransaction(db: Db, userId: string, id: number) {
  const deleted = await db
    .delete(transactions)
    .where(and(eq(transactions.id, id), eq(transactions.userId, userId)))
    .returning({ id: transactions.id })
  return deleted.length > 0
}
