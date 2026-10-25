import { and, eq } from 'drizzle-orm'
import type { z } from 'zod'
import { accounts, categories, importBatches } from '../../../db/schema'
import { ADAPTERS, type ImportAdapter, type ImportedTransaction } from '../../shared/importers'
import { looksLikeAdjustment } from '../../shared/importers/adjustments'
import { buildImportPayload, categoryKey, chunk, IMPORT_CHUNK_SIZE } from '../../shared/importers/payload'
import { toMinor } from '../../shared/money'
import type {
  appendImportRowsRequest,
  finishImportRequest,
  importOptions,
  importRequest,
  startImportRequest,
} from '../../shared/schemas'
import type { ImportBatch, ImportCategoryTarget, ImportPreview, ImportResult } from '../../shared/types'
import type { Db } from '../db'
import { AppError } from '../errors'
import { reconciliationsFromAdjustments } from './reconciliations'
import { createTransactions, duplicateFinder, existingTransactionsAround } from './transactions'

// Importación de historial en tres etapas, para que ninguna request exceda el límite de CPU:
//   preview (no escribe) → start (lote, cuentas y categorías) → rows (tandas ≤ 500) → finish.
// El archivo se convierte en movimientos normalizados en el navegador, con el mismo adaptador.

type Options = z.output<typeof importOptions>
type PreviewRequest = z.output<typeof importRequest>
type StartRequest = z.output<typeof startImportRequest>
type Kind = 'expense' | 'income'

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

function adapterOf(id: string): ImportAdapter {
  const adapter = ADAPTERS[id]
  if (!adapter) throw new AppError(`Origen de importación desconocido: ${id}`)
  return adapter
}

function countBy<T>(items: T[], key: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>()
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1)
  return counts
}

/**
 * Resuelve, según las respuestas del usuario, a qué cuenta va cada billetera y a qué
 * categoría va cada categoría del origen. No escribe nada.
 */
async function resolveTargets(
  db: Db,
  userId: string,
  adapter: ImportAdapter,
  groups: { kind: Kind; sourceCategory: string; count: number }[],
  wallets: { name: string; count: number; currencies: Set<string> }[],
  options: Options,
) {
  const [userAccounts, userCategories] = await Promise.all([
    db.select().from(accounts).where(eq(accounts.userId, userId)).orderBy(accounts.id),
    db.select().from(categories).where(eq(categories.userId, userId)),
  ])
  const defaultAccount = userAccounts.find((a) => !a.archived)
  if (!defaultAccount) throw new AppError('No hay cuentas activas')

  // Billeteras → cuentas.
  const walletPlan = wallets.map(({ name, count, currencies }) => {
    const choice = options.accounts[name]
    if (choice?.type === 'create') {
      // Se valida en la vista previa para avisar antes de confirmar, no al importar.
      const taken = userAccounts.find((a) => sameName(a.name, choice.name))
      if (taken) throw new AppError(`Ya existe una cuenta llamada "${taken.name}"`)
      return { name, count, target: { type: 'create' as const, name: choice.name.trim(), accountType: choice.accountType } }
    }
    const account = choice ? userAccounts.find((a) => a.id === choice.accountId) : defaultAccount
    if (!account) throw new AppError(`La cuenta ${choice!.type === 'existing' ? choice.accountId : ''} no existe`)
    if (account.currency === 'USD' && [...currencies].some((c) => c !== 'USD')) {
      throw new AppError(`La cuenta "${account.name}" es en USD y "${name}" tiene movimientos en otra moneda`)
    }
    return { name, count, target: { type: 'existing' as const, accountId: account.id, name: account.name } }
  })

  // Categorías del origen → categorías de OpenSpend.
  const findCategory = (kind: Kind, name: string) => userCategories.find((c) => c.kind === kind && sameName(c.name, name))
  const toTarget = (kind: Kind, name: string, icon?: string): ImportCategoryTarget => {
    const found = findCategory(kind, name)
    return found ? { type: 'existing', categoryId: found.id, name: found.name } : { type: 'create', name, icon }
  }
  // Para "solo tus categorías": nunca crea. Sin equivalente, usa "Otros…" o la primera del
  // mismo tipo; solo crea si el usuario no tiene ninguna categoría de ese tipo.
  const toExistingTarget = (kind: Kind, name: string): ImportCategoryTarget => {
    const other = kind === 'expense' ? 'Otros gastos' : 'Otros ingresos'
    const found = findCategory(kind, name) ?? findCategory(kind, other) ?? userCategories.find((c) => c.kind === kind)
    return found ? { type: 'existing', categoryId: found.id, name: found.name } : { type: 'create', name: other }
  }

  const categoryPlan = groups.map(({ kind, sourceCategory: sourceName, count }) => {
    const key = categoryKey(kind, sourceName)
    const hint = adapter.categoryHint(sourceName, kind)
    const override = options.categoryOverrides[key]

    let target: ImportCategoryTarget
    if (override?.type === 'existing') {
      const found = userCategories.find((c) => c.id === override.categoryId && c.kind === kind)
      if (!found) throw new AppError(`La categoría ${override.categoryId} no existe o no es de ${kind === 'expense' ? 'gasto' : 'ingreso'}`)
      target = { type: 'existing', categoryId: found.id, name: found.name }
    } else if (override?.type === 'create') target = toTarget(kind, override.name)
    else if (options.categoryStrategy === 'copy') target = toTarget(kind, sourceName)
    else if (options.categoryStrategy === 'existing') target = toExistingTarget(kind, hint.closest)
    else if (hint.standard) target = toTarget(kind, hint.standard)
    else target = toTarget(kind, hint.create!.name, hint.create!.icon)

    // Marcada por el usuario como conciliación; si el nombre lo parece, solo se sugiere.
    const adjustment = options.reconcileCategories[key] ?? false
    return { key, sourceName, kind, count, adjustment, suggestedAdjustment: looksLikeAdjustment(sourceName), target }
  })

  return { walletPlan, categoryPlan }
}

function groupsOf(rows: ImportedTransaction[]) {
  const counts = countBy(rows, (t) => categoryKey(t.kind, t.sourceCategory))
  return [...counts].map(([key, count]) => {
    const sample = rows.find((t) => categoryKey(t.kind, t.sourceCategory) === key)!
    return { kind: sample.kind, sourceCategory: sample.sourceCategory, count }
  })
}

function walletsOf(rows: ImportedTransaction[]) {
  const wallets = new Map<string, { name: string; count: number; currencies: Set<string> }>()
  for (const t of rows) {
    const w = wallets.get(t.sourceWallet) ?? { name: t.sourceWallet, count: 0, currencies: new Set<string>() }
    w.count++
    w.currencies.add(t.currency)
    wallets.set(t.sourceWallet, w)
  }
  return [...wallets.values()]
}

export async function previewImport(db: Db, d1: D1Database, userId: string, request: PreviewRequest): Promise<ImportPreview> {
  const adapter = adapterOf(request.adapter)
  const rows = request.rows
  const { walletPlan, categoryPlan } = await resolveTargets(db, userId, adapter, groupsOf(rows), walletsOf(rows), request.options)

  // Los ajustes de saldo no son movimientos: se convierten en conciliaciones.
  const reconcileKeys = new Set(categoryPlan.filter((c) => c.adjustment).map((c) => c.key))
  const movements = rows.filter((t) => !reconcileKeys.has(categoryKey(t.kind, t.sourceCategory)))

  // Duplicados: contra lo que el usuario ya tenía (solo aplica a cuentas existentes).
  const accountOf = new Map(walletPlan.map((w) => [w.name, w.target.type === 'existing' ? w.target.accountId : null]))
  const findDuplicates = duplicateFinder(await existingTransactionsAround(d1, userId, movements.map((t) => t.date)))
  const duplicateCount = movements.filter((t) => {
    const accountId = accountOf.get(t.sourceWallet)
    return (
      accountId != null &&
      findDuplicates({ accountId, amountMinor: toMinor(t.amount, t.currency), currency: t.currency, kind: t.kind, date: t.date }).length > 0
    )
  }).length

  const dates = rows.map((t) => t.date).sort()
  const clp = (kind: Kind) => movements.filter((t) => t.kind === kind && t.currency === 'CLP').reduce((sum, t) => sum + t.amount, 0)
  return {
    adapter: adapter.id,
    warnings: [],
    summary: {
      total: rows.length,
      toImport: movements.length - (request.options.duplicates === 'skip' ? duplicateCount : 0),
      expenses: rows.filter((t) => t.kind === 'expense').length,
      incomes: rows.filter((t) => t.kind === 'income').length,
      from: dates[0] ?? null,
      to: dates[dates.length - 1] ?? null,
      byYear: [...countBy(rows, (t) => t.date.slice(0, 4))].sort().map(([year, count]) => ({ year, count })),
      expenseClp: clp('expense'),
      incomeClp: clp('income'),
    },
    wallets: walletPlan,
    categories: categoryPlan.sort((a, b) => a.kind.localeCompare(b.kind) || b.count - a.count),
    labeledCount: rows.filter((t) => t.labels.length > 0).length,
    adjustmentCount: rows.length - movements.length,
    duplicateCount,
  }
}

/** Etapa 1: crea el lote ("importing"), las cuentas y categorías nuevas, y devuelve los mapeos. */
export async function startImport(db: Db, _d1: D1Database, userId: string, request: StartRequest) {
  const adapter = adapterOf(request.adapter)
  const { walletPlan, categoryPlan } = await resolveTargets(
    db,
    userId,
    adapter,
    request.categories.map((c) => ({ ...c, count: 0 })),
    request.wallets.map((name) => ({ name, count: 0, currencies: new Set<string>() })),
    request.options,
  )

  const createdAccounts: string[] = []
  const accountMap: Record<string, number> = {}
  for (const wallet of walletPlan) {
    if (wallet.target.type === 'existing') {
      accountMap[wallet.name] = wallet.target.accountId
      continue
    }
    const [account] = await db
      .insert(accounts)
      .values({ userId, name: wallet.target.name, type: wallet.target.accountType as 'cash', currency: 'CLP' })
      .returning()
    accountMap[wallet.name] = account.id
    createdAccounts.push(account.name)
  }

  const createdCategories: string[] = []
  const categoryMap: Record<string, number> = {}
  const createdByName = new Map<string, number>()
  for (const c of categoryPlan) {
    if (c.adjustment) continue // sus movimientos se convierten en conciliaciones
    if (c.target.type === 'existing') {
      categoryMap[c.key] = c.target.categoryId
      continue
    }
    const nameKey = categoryKey(c.kind, c.target.name.toLowerCase())
    let id = createdByName.get(nameKey)
    if (id === undefined) {
      const [category] = await db
        .insert(categories)
        .values({ userId, kind: c.kind, name: c.target.name, icon: c.target.icon ?? null })
        .returning()
      id = category.id
      createdByName.set(nameKey, id)
      createdCategories.push(`${c.target.icon ?? ''} ${c.target.name}`.trim())
    }
    categoryMap[c.key] = id
  }

  const [batch] = await db
    .insert(importBatches)
    .values({ userId, source: 'app_import', status: 'importing', label: `${adapter.label}: ${request.fileNames.join(', ')}`.slice(0, 300) })
    .returning()

  return {
    batchId: batch.id,
    accounts: accountMap,
    categories: categoryMap,
    reconcileKeys: categoryPlan.filter((c) => c.adjustment).map((c) => c.key),
    createdAccounts,
    createdCategories,
  }
}

async function importingBatch(db: Db, userId: string, batchId: number) {
  const [batch] = await db
    .select()
    .from(importBatches)
    .where(and(eq(importBatches.id, batchId), eq(importBatches.userId, userId)))
  if (!batch) throw new AppError('Importación no encontrada', 404)
  if (batch.status !== 'importing') throw new AppError('Esta importación ya está terminada', 409)
  return batch
}

/** Etapa 2: inserta una tanda. Los duplicados se buscan fuera de este lote (no entre sus tandas). */
export async function appendImportRows(
  db: Db,
  d1: D1Database,
  userId: string,
  batchId: number,
  request: z.input<typeof appendImportRowsRequest>,
) {
  if (request.transactions.length > IMPORT_CHUNK_SIZE) throw new AppError(`Máximo ${IMPORT_CHUNK_SIZE} movimientos por tanda`)
  await importingBatch(db, userId, batchId)
  const existing = await existingTransactionsAround(d1, userId, request.transactions.map((t) => t.date), batchId)
  const result = await createTransactions(
    db,
    d1,
    userId,
    {
      transactions: request.transactions.map((t) => ({ kind: 'expense', currency: 'CLP', source: 'app_import', ...t })),
      skipDuplicates: request.skipDuplicates ?? true,
      importBatchId: batchId,
    },
    { existing },
  )
  return {
    inserted: result.inserted.length,
    skippedDuplicates: result.duplicates.filter((d) => !d.inserted).length,
    markedDuplicates: result.duplicates.filter((d) => d.inserted).length,
  }
}

/** Etapa 3: convierte los ajustes en conciliaciones (ya con todo insertado) y cierra el lote. */
export async function finishImport(d1: D1Database, db: Db, userId: string, batchId: number, request: z.output<typeof finishImportRequest>) {
  const batch = await importingBatch(db, userId, batchId)
  const reconciliations = await reconciliationsFromAdjustments(
    d1,
    userId,
    batchId,
    request.adjustments.map((a) => ({ ...a, note: `Ajuste importado (${batch.label.split(':')[0]})` })),
  )
  await db.update(importBatches).set({ status: 'active' }).where(and(eq(importBatches.id, batchId), eq(importBatches.userId, userId)))
  return { reconciliations }
}

/** Las tres etapas seguidas en el servidor (tests, y a futuro importaciones desde R2). */
export async function runImport(db: Db, d1: D1Database, userId: string, request: PreviewRequest): Promise<ImportResult> {
  const start = await startImport(db, d1, userId, {
    adapter: request.adapter,
    fileNames: request.fileNames,
    categories: groupsOf(request.rows).map(({ kind, sourceCategory }) => ({ kind, sourceCategory })),
    wallets: walletsOf(request.rows).map((w) => w.name),
    options: request.options,
  })
  const payload = buildImportPayload(request.rows, start, request.options.labels)
  let inserted = 0
  let skippedDuplicates = 0
  let markedDuplicates = 0
  for (const transactions of chunk(payload.transactions, IMPORT_CHUNK_SIZE)) {
    const r = await appendImportRows(db, d1, userId, start.batchId, { transactions, skipDuplicates: request.options.duplicates === 'skip' })
    inserted += r.inserted
    skippedDuplicates += r.skippedDuplicates
    markedDuplicates += r.markedDuplicates
  }
  const { reconciliations } = await finishImport(d1, db, userId, start.batchId, { adjustments: payload.adjustments })
  return {
    batchId: start.batchId,
    inserted,
    skippedDuplicates,
    markedDuplicates,
    reconciliations,
    createdAccounts: start.createdAccounts,
    createdCategories: start.createdCategories,
  }
}

export async function listImports(d1: D1Database, userId: string): Promise<ImportBatch[]> {
  const { results } = await d1
    .prepare(
      `SELECT b.id, b.source, b.label, b.status, b.created_at AS createdAt, COUNT(t.id) AS transactionCount
       FROM import_batches b LEFT JOIN transactions t ON t.import_batch_id = b.id AND t.user_id = b.user_id
       WHERE b.user_id = ? GROUP BY b.id ORDER BY b.id DESC`,
    )
    .bind(userId)
    .all<ImportBatch>()
  return results
}

/** Revierte un lote: borra sus movimientos y conciliaciones y lo marca como revertido (las categorías creadas quedan). */
export async function revertImport(d1: D1Database, db: Db, userId: string, batchId: number) {
  const [batch] = await db
    .select()
    .from(importBatches)
    .where(and(eq(importBatches.id, batchId), eq(importBatches.userId, userId)))
  if (!batch) throw new AppError('Importación no encontrada', 404)
  if (batch.status === 'reverted') throw new AppError('Esta importación ya fue revertida', 409)
  const [deleted] = await d1.batch([
    d1.prepare('DELETE FROM transactions WHERE user_id = ? AND import_batch_id = ?').bind(userId, batchId),
    d1.prepare('DELETE FROM balance_reconciliations WHERE user_id = ? AND import_batch_id = ?').bind(userId, batchId),
    d1.prepare("UPDATE import_batches SET status = 'reverted' WHERE id = ? AND user_id = ?").bind(batchId, userId),
  ])
  return { reverted: batchId, deletedTransactions: deleted.meta.changes }
}
