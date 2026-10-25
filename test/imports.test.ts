import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '../src/worker/db'
import { parseCsv } from '../src/shared/importers/csv'
import { looksLikeAdjustment } from '../src/shared/importers/adjustments'
import { spendee } from '../src/shared/importers/spendee'
import { listCategories, mergeCategories } from '../src/worker/services/categories'
import { listImports, previewImport, revertImport, runImport } from '../src/worker/services/imports'
import { getAccountsWithBalance } from '../src/worker/services/summary'
import { createTransactions, listTransactions } from '../src/worker/services/transactions'
import { ensureUser } from '../src/worker/services/users'

const ALICE = { id: 'auth0|alice', email: 'alice@example.com' }
const BOB = { id: 'auth0|bob', email: 'bob@example.com' }
const db = () => getDb(env.DB)

// Export inventado con el formato de Spendee: notas con comas, comillas y salto de línea,
// una hora UTC que en Chile cae el día anterior, etiquetas y ajustes de saldo.
const CSV = [
  'Date,Wallet,Type,"Category name",Amount,Currency,Note,Labels,Author',
  '2025-03-10T15:00:00+00:00,Cash Wallet,Expense,"Food & Drink",-8500.00000000,CLP,"Almuerzo, con ""amigos""",peru,Ana',
  '2025-03-11T02:30:00+00:00,Cash Wallet,Expense,Gaming,-20000.00000000,CLP,"Juego\nen oferta",,Ana',
  '2025-03-12T12:00:00+00:00,Cash Wallet,Expense,Streamings,-9990.00000000,CLP,Netflix,,Ana',
  '2025-03-12T13:00:00+00:00,Cash Wallet,Expense,App,-2990.00000000,CLP,App,,Ana',
  '2025-03-15T12:00:00+00:00,Cash Wallet,Income,Salary,1500000.00000000,CLP,Sueldo,,Ana',
  '2025-03-20T12:00:00+00:00,Cash Wallet,Expense,"Ajuste Negativo",-1000.00000000,CLP,,,Ana',
].join('\n')

const file = { name: 'export.csv', content: CSV }
const request = (options: Record<string, unknown> = {}) =>
  ({ adapter: 'spendee', fileNames: ['export.csv'], rows: spendee.parse([file]).transactions, options: { accounts: {}, categoryStrategy: 'hybrid', categoryOverrides: {}, reconcileCategories: {}, labels: 'append', duplicates: 'skip', ...options } }) as Parameters<typeof previewImport>[3]

beforeEach(async () => {
  await env.DB.batch(['transactions', 'import_batches', 'categories', 'accounts', 'users'].map((t) => env.DB.prepare(`DELETE FROM ${t}`)))
  await ensureUser(env.DB, ALICE)
  await ensureUser(env.DB, BOB)
})

describe('parser CSV y adaptador de Spendee', () => {
  it('soporta comas, comillas escapadas y saltos de línea dentro de un campo', () => {
    const rows = parseCsv(CSV)
    expect(rows).toHaveLength(6)
    expect(rows[0].Note).toBe('Almuerzo, con "amigos"')
    expect(rows[1].Note).toBe('Juego\nen oferta')
  })

  it('convierte la fecha UTC a hora de Chile y normaliza signos', () => {
    const { transactions, warnings } = spendee.parse([file])
    expect(warnings).toEqual([])
    // 2025-03-11 02:30 UTC = 2025-03-10 23:30 en Chile.
    expect(transactions[1].date).toBe('2025-03-10')
    expect(transactions[0]).toMatchObject({ kind: 'expense', amount: 8500, labels: ['peru'] })
    expect(transactions[4]).toMatchObject({ kind: 'income', amount: 1500000 })
  })

  it('avisa si el archivo no es un export de Spendee', () => {
    const { transactions, warnings } = spendee.parse([{ name: 'otro.csv', content: 'a,b\n1,2' }])
    expect(transactions).toHaveLength(0)
    expect(warnings[0]).toMatch(/no parece un export/)
  })
})

describe('sugerencia de ajustes', () => {
  it('reconoce nombres que parecen ajustes de saldo, en español e inglés', () => {
    for (const name of ['Ajuste Negativo', 'ajustes', 'Balance adjustment', 'Corrección de saldo', 'Conciliación', 'Reconciliation'])
      expect(looksLikeAdjustment(name)).toBe(true)
    for (const name of ['Food & Drink', 'Sueldo', 'Ajo y especias']) expect(looksLikeAdjustment(name)).toBe(false)
  })
})

describe('vista previa', () => {
  it('híbrido: estándar a tus categorías y personalizadas como nuevas', async () => {
    const preview = await previewImport(db(), env.DB, ALICE.id, request())
    const target = (name: string) => preview.categories.find((c) => c.sourceName === name)!.target
    expect(target('Food & Drink')).toMatchObject({ type: 'existing', name: 'Comida y restaurantes' })
    expect(target('Gaming')).toMatchObject({ type: 'create', name: 'Gaming' })
    expect(preview.summary).toMatchObject({ total: 6, toImport: 6, expenses: 5, incomes: 1 })
    expect(preview.wallets[0].target).toMatchObject({ type: 'existing', name: 'Principal' })
    expect(preview.labeledCount).toBe(1)
    expect(preview.adjustmentCount).toBe(0)
  })

  it('"solo tus categorías" no crea ninguna; las marcadas como conciliación no se importan como movimientos', async () => {
    const preview = await previewImport(
      db(),
      env.DB,
      ALICE.id,
      request({ categoryStrategy: 'existing', reconcileCategories: { 'expense|Ajuste Negativo': true } }),
    )
    expect(preview.categories.filter((c) => c.target.type === 'create')).toHaveLength(0)
    expect(preview.categories.find((c) => c.sourceName === 'Gaming')!.target).toMatchObject({ name: 'Entretenimiento' })
    expect(preview.summary.toImport).toBe(5)
  })

  it('"solo tus categorías" nunca crea categorías, aunque falten las equivalentes', async () => {
    // Alice renombró "Entretenimiento" (destino natural de Gaming) y borró "Otros gastos".
    await env.DB.prepare("UPDATE categories SET name = 'Ocio' WHERE user_id = ? AND name = 'Entretenimiento'").bind(ALICE.id).run()
    await env.DB.prepare("DELETE FROM categories WHERE user_id = ? AND name = 'Otros gastos'").bind(ALICE.id).run()
    const preview = await previewImport(db(), env.DB, ALICE.id, request({ categoryStrategy: 'existing' }))
    expect(preview.categories.filter((c) => c.target.type === 'create')).toEqual([])
    // Sin equivalente, cae en una categoría existente del mismo tipo.
    expect(preview.categories.find((c) => c.sourceName === 'Gaming')!.target.type).toBe('existing')
  })

  it('una cuenta nueva con nombre personalizado aparece en la vista previa; un nombre repetido se rechaza ahí mismo', async () => {
    const preview = await previewImport(
      db(),
      env.DB,
      ALICE.id,
      request({ accounts: { 'Cash Wallet': { type: 'create', name: 'Billetera vieja', accountType: 'cash' } } }),
    )
    expect(preview.wallets[0].target).toMatchObject({ type: 'create', name: 'Billetera vieja' })
    await expect(
      previewImport(db(), env.DB, ALICE.id, request({ accounts: { 'Cash Wallet': { type: 'create', name: ' principal', accountType: 'bank' } } })),
    ).rejects.toThrow(/Ya existe una cuenta llamada "Principal"/)
  })

  it('cuenta duplicados contra lo que ya existía', async () => {
    const [main] = await getAccountsWithBalance(env.DB, ALICE.id)
    await createTransactions(db(), env.DB, ALICE.id, {
      transactions: [{ date: '2025-03-11', kind: 'expense', amount: 8500, currency: 'CLP', accountId: main.id, source: 'manual' }],
      skipDuplicates: false,
    })
    const preview = await previewImport(db(), env.DB, ALICE.id, request())
    expect(preview.duplicateCount).toBe(1)
    expect(preview.summary.toImport).toBe(5)
  })

  it('no acepta cuentas ni categorías de otro usuario en las opciones', async () => {
    const [bobAccount] = await getAccountsWithBalance(env.DB, BOB.id)
    const bobFood = (await listCategories(env.DB, BOB.id)).find((c) => c.name === 'Comida y restaurantes')!
    await expect(
      previewImport(db(), env.DB, ALICE.id, request({ accounts: { 'Cash Wallet': { type: 'existing', accountId: bobAccount.id } } })),
    ).rejects.toThrow(/no existe/)
    await expect(
      previewImport(db(), env.DB, ALICE.id, request({ categoryOverrides: { 'expense|Gaming': { type: 'existing', categoryId: bobFood.id } } })),
    ).rejects.toThrow(/no existe/)
  })
})

describe('importar y revertir', () => {
  it('importa, crea categorías una sola vez, agrega etiquetas y permite combinar en la vista previa', async () => {
    const result = await runImport(
      db(),
      env.DB,
      ALICE.id,
      request({ categoryOverrides: { 'expense|App': { type: 'create', name: 'Apps y streaming' }, 'expense|Streamings': { type: 'create', name: 'Apps y streaming' } } }),
    )
    expect(result).toMatchObject({ inserted: 6, skippedDuplicates: 0, reconciliations: 0 })
    expect(result.createdCategories.filter((c) => c.includes('Apps y streaming'))).toHaveLength(1)

    const txs = await listTransactions(db(), ALICE.id, { limit: 100, offset: 0 })
    expect(txs.find((t) => t.amountMinor === 8500)!.description).toBe('Almuerzo, con "amigos" #peru')
    const streaming = (await listCategories(env.DB, ALICE.id)).find((c) => c.name === 'Apps y streaming')!
    expect(streaming.transactionCount).toBe(2)

    const [batch] = await listImports(env.DB, ALICE.id)
    expect(batch).toMatchObject({ status: 'active', transactionCount: 6 })
  })

  it('revierte el lote completo sin tocar otros movimientos, y no se puede revertir dos veces', async () => {
    const [main] = await getAccountsWithBalance(env.DB, ALICE.id)
    await createTransactions(db(), env.DB, ALICE.id, {
      transactions: [{ date: '2026-01-01', kind: 'expense', amount: 1, currency: 'CLP', accountId: main.id, source: 'manual' }],
      skipDuplicates: false,
    })
    const { batchId } = await runImport(db(), env.DB, ALICE.id, request())
    const reverted = await revertImport(env.DB, db(), ALICE.id, batchId)
    expect(reverted.deletedTransactions).toBe(6)
    expect(await listTransactions(db(), ALICE.id, { limit: 100, offset: 0 })).toHaveLength(1)
    await expect(revertImport(env.DB, db(), ALICE.id, batchId)).rejects.toThrow(/ya fue revertida/)
  })

  it('un usuario no puede ver ni revertir importaciones de otro', async () => {
    const { batchId } = await runImport(db(), env.DB, ALICE.id, request())
    expect(await listImports(env.DB, BOB.id)).toHaveLength(0)
    await expect(revertImport(env.DB, db(), BOB.id, batchId)).rejects.toThrow(/no encontrada/)
  })
})

describe('combinar categorías', () => {
  it('mueve los movimientos al destino y elimina las de origen', async () => {
    await runImport(db(), env.DB, ALICE.id, request())
    const cats = await listCategories(env.DB, ALICE.id)
    const subs = cats.find((c) => c.name === 'Suscripciones')!
    const gaming = cats.find((c) => c.name === 'Gaming')!
    const ent = cats.find((c) => c.name === 'Entretenimiento')!

    const result = await mergeCategories(env.DB, db(), ALICE.id, [gaming.id, subs.id], ent.id)
    expect(result.movedTransactions).toBe(3)
    const after = await listCategories(env.DB, ALICE.id)
    expect(after.some((c) => c.id === gaming.id || c.id === subs.id)).toBe(false)
    expect(after.find((c) => c.id === ent.id)!.transactionCount).toBe(3)
  })

  it('no combina tipos distintos ni categorías de otro usuario', async () => {
    const cats = await listCategories(env.DB, ALICE.id)
    const food = cats.find((c) => c.name === 'Comida y restaurantes')!
    const salary = cats.find((c) => c.name === 'Sueldo')!
    const bobMarket = (await listCategories(env.DB, BOB.id)).find((c) => c.name === 'Supermercado')!
    await expect(mergeCategories(env.DB, db(), ALICE.id, [salary.id], food.id)).rejects.toThrow(/distinto tipo/)
    await expect(mergeCategories(env.DB, db(), ALICE.id, [bobMarket.id], food.id)).rejects.toThrow(/no existe/)
    await expect(mergeCategories(env.DB, db(), BOB.id, [food.id], bobMarket.id)).rejects.toThrow(/no existe/)
  })
})
