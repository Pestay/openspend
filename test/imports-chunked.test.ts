import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { spendee } from '../src/shared/importers/spendee'
import { getDb } from '../src/worker/db'
import { listCategories } from '../src/worker/services/categories'
import { appendImportRows, finishImport, listImports, startImport } from '../src/worker/services/imports'
import { listReconciliations } from '../src/worker/services/reconciliations'
import { getAccountsWithBalance } from '../src/worker/services/summary'
import { listTransactions } from '../src/worker/services/transactions'
import { ensureUser } from '../src/worker/services/users'

// Importación por tandas: start (plan) → rows (tandas ≤ 500) → finish (conciliaciones).
// Cada request hace poco trabajo, para respetar el límite de CPU del plan gratis.

const ALICE = { id: 'auth0|alice', email: 'alice@example.com' }
const BOB = { id: 'auth0|bob', email: 'bob@example.com' }
const db = () => getDb(env.DB)

const CSV = [
  'Date,Wallet,Type,"Category name",Amount,Currency,Note,Labels,Author',
  '2025-03-01T15:00:00+00:00,Cash Wallet,Income,Salary,100000.00000000,CLP,,,Ana',
  '2025-03-05T15:00:00+00:00,Cash Wallet,Expense,Gaming,-20000.00000000,CLP,Juego,,Ana',
  '2025-03-10T15:00:00+00:00,Cash Wallet,Expense,"Ajuste Negativo",-1000.00000000,CLP,,,Ana',
].join('\n')
const rows = spendee.parse([{ name: 'export.csv', content: CSV }]).transactions
const options = {
  accounts: {},
  categoryStrategy: 'hybrid' as const,
  categoryOverrides: {},
  reconcileCategories: { 'expense|Ajuste Negativo': true },
  labels: 'append' as const,
  duplicates: 'skip' as const,
}
const startRequest = {
  adapter: 'spendee',
  fileNames: ['export.csv'],
  categories: [
    { kind: 'income' as const, sourceCategory: 'Salary' },
    { kind: 'expense' as const, sourceCategory: 'Gaming' },
    { kind: 'expense' as const, sourceCategory: 'Ajuste Negativo' },
  ],
  wallets: ['Cash Wallet'],
  options,
}

beforeEach(async () => {
  await env.DB.batch(
    ['balance_reconciliations', 'transactions', 'import_batches', 'categories', 'accounts', 'users'].map((t) => env.DB.prepare(`DELETE FROM ${t}`)),
  )
  await ensureUser(env.DB, ALICE)
  await ensureUser(env.DB, BOB)
})

describe('importación por tandas', () => {
  it('start crea el lote "importando", las categorías nuevas y devuelve los mapeos', async () => {
    const start = await startImport(db(), env.DB, ALICE.id, startRequest)
    const [main] = await getAccountsWithBalance(env.DB, ALICE.id)
    expect(start.accounts).toEqual({ 'Cash Wallet': main.id })
    expect(start.reconcileKeys).toEqual(['expense|Ajuste Negativo'])
    const gaming = (await listCategories(env.DB, ALICE.id)).find((c) => c.name === 'Gaming')!
    expect(start.categories['expense|Gaming']).toBe(gaming.id)
    expect(start.categories['expense|Ajuste Negativo']).toBeUndefined()
    expect((await listImports(env.DB, ALICE.id))[0]).toMatchObject({ id: start.batchId, status: 'importing' })
  })

  it('las tandas se insertan en el lote; finish crea las conciliaciones y lo deja activo', async () => {
    const start = await startImport(db(), env.DB, ALICE.id, startRequest)
    const account = start.accounts['Cash Wallet']
    const tx = (date: string, kind: 'income' | 'expense', amount: number, categoryId?: number) => ({
      date,
      kind,
      amount,
      currency: 'CLP' as const,
      accountId: account,
      categoryId,
      source: 'app_import' as const,
    })

    const first = await appendImportRows(db(), env.DB, ALICE.id, start.batchId, {
      transactions: [tx('2025-03-01', 'income', 100_000, start.categories['income|Salary'])],
      skipDuplicates: true,
    })
    const second = await appendImportRows(db(), env.DB, ALICE.id, start.batchId, {
      transactions: [tx('2025-03-05', 'expense', 20_000, start.categories['expense|Gaming'])],
      skipDuplicates: true,
    })
    expect(first.inserted + second.inserted).toBe(2)

    const done = await finishImport(env.DB, db(), ALICE.id, start.batchId, {
      adjustments: [{ accountId: account, date: '2025-03-10', deltaMinor: -1_000 }],
    })
    expect(done).toMatchObject({ reconciliations: 1 })
    expect((await listReconciliations(env.DB, db(), ALICE.id))[0]).toMatchObject({ balanceMinor: 79_000 })
    expect((await listImports(env.DB, ALICE.id))[0]).toMatchObject({ status: 'active', transactionCount: 2 })
  })

  it('no marca como duplicados movimientos iguales del mismo archivo que llegan en tandas distintas', async () => {
    const start = await startImport(db(), env.DB, ALICE.id, startRequest)
    const coffee = { date: '2025-03-05', kind: 'expense' as const, amount: 3_000, currency: 'CLP' as const, accountId: start.accounts['Cash Wallet'], source: 'app_import' as const }
    await appendImportRows(db(), env.DB, ALICE.id, start.batchId, { transactions: [coffee], skipDuplicates: true })
    const again = await appendImportRows(db(), env.DB, ALICE.id, start.batchId, { transactions: [coffee], skipDuplicates: true })
    expect(again).toMatchObject({ inserted: 1, skippedDuplicates: 0 })
    expect(await listTransactions(db(), ALICE.id, { limit: 10, offset: 0 })).toHaveLength(2)
  })

  it('rechaza tandas de más de 500 movimientos', async () => {
    const start = await startImport(db(), env.DB, ALICE.id, startRequest)
    const many = Array.from({ length: 501 }, () => ({ date: '2025-03-05', kind: 'expense' as const, amount: 1, currency: 'CLP' as const, source: 'app_import' as const }))
    await expect(appendImportRows(db(), env.DB, ALICE.id, start.batchId, { transactions: many, skipDuplicates: true })).rejects.toThrow(/500/)
  })

  it('no permite agregar a un lote terminado ni al lote de otro usuario', async () => {
    const start = await startImport(db(), env.DB, ALICE.id, startRequest)
    const one = { date: '2025-03-05', kind: 'expense' as const, amount: 1, currency: 'CLP' as const, source: 'app_import' as const }
    await expect(appendImportRows(db(), env.DB, BOB.id, start.batchId, { transactions: [one], skipDuplicates: true })).rejects.toThrow(/no encontrada/)
    await expect(finishImport(env.DB, db(), BOB.id, start.batchId, { adjustments: [] })).rejects.toThrow(/no encontrada/)
    await finishImport(env.DB, db(), ALICE.id, start.batchId, { adjustments: [] })
    await expect(appendImportRows(db(), env.DB, ALICE.id, start.batchId, { transactions: [one], skipDuplicates: true })).rejects.toThrow(/terminada/)
  })

  it('la vista previa recibe movimientos ya normalizados (el CSV se procesa en el navegador)', async () => {
    expect(rows).toHaveLength(3)
  })
})
