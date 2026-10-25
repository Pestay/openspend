import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '../src/worker/db'
import { createAccount, deleteAccount, updateAccount } from '../src/worker/services/accounts'
import { deleteCategory, listCategories, updateCategory } from '../src/worker/services/categories'
import { getAccountsWithBalance } from '../src/worker/services/summary'
import { createTransactions, listTransactions } from '../src/worker/services/transactions'
import { ensureUser } from '../src/worker/services/users'

const ALICE = { id: 'auth0|alice', email: 'alice@example.com' }
const BOB = { id: 'auth0|bob', email: 'bob@example.com' }
const db = () => getDb(env.DB)

const byName = async (userId: string, name: string) => (await listCategories(env.DB, userId)).find((c) => c.name === name)!

async function expense(userId: string, categoryId: number, accountId?: number) {
  await createTransactions(db(), env.DB, userId, {
    transactions: [{ date: '2026-10-20', kind: 'expense', amount: 1000, currency: 'CLP', categoryId, accountId, source: 'manual' }],
    skipDuplicates: false,
  })
}

beforeEach(async () => {
  await env.DB.batch(['transactions', 'import_batches', 'categories', 'accounts', 'users'].map((t) => env.DB.prepare(`DELETE FROM ${t}`)))
  await ensureUser(env.DB, ALICE)
  await ensureUser(env.DB, BOB)
})

describe('categorías', () => {
  it('lista con la cantidad de movimientos', async () => {
    const food = await byName(ALICE.id, 'Comida y restaurantes')
    await expense(ALICE.id, food.id)
    expect((await byName(ALICE.id, 'Comida y restaurantes')).transactionCount).toBe(1)
    expect((await byName(BOB.id, 'Comida y restaurantes')).transactionCount).toBe(0)
  })

  it('no permite eliminar una categoría con movimientos sin decir qué hacer con ellos', async () => {
    const food = await byName(ALICE.id, 'Comida y restaurantes')
    await expense(ALICE.id, food.id)
    await expect(deleteCategory(env.DB, db(), ALICE.id, food.id)).rejects.toThrow(/1 movimiento/)
  })

  it('fusiona: mueve los movimientos a otra categoría del mismo tipo y elimina la original', async () => {
    const food = await byName(ALICE.id, 'Comida y restaurantes')
    const market = await byName(ALICE.id, 'Supermercado')
    await expense(ALICE.id, food.id)

    const result = await deleteCategory(env.DB, db(), ALICE.id, food.id, market.id)
    expect(result.movedTransactions).toBe(1)
    const [tx] = await listTransactions(db(), ALICE.id, { limit: 10, offset: 0 })
    expect(tx.categoryId).toBe(market.id)
    expect((await listCategories(env.DB, ALICE.id)).some((c) => c.id === food.id)).toBe(false)
  })

  it('reassignTo null deja los movimientos sin categoría', async () => {
    const food = await byName(ALICE.id, 'Comida y restaurantes')
    await expense(ALICE.id, food.id)
    await deleteCategory(env.DB, db(), ALICE.id, food.id, null)
    const [tx] = await listTransactions(db(), ALICE.id, { limit: 10, offset: 0 })
    expect(tx.categoryId).toBeNull()
  })

  it('no fusiona con una categoría de otro tipo', async () => {
    const food = await byName(ALICE.id, 'Comida y restaurantes')
    const salary = await byName(ALICE.id, 'Sueldo')
    await expense(ALICE.id, food.id)
    await expect(deleteCategory(env.DB, db(), ALICE.id, food.id, salary.id)).rejects.toThrow(/mismo tipo/)
  })

  it('un usuario no puede editar, eliminar ni fusionar hacia categorías de otro', async () => {
    const aliceFood = await byName(ALICE.id, 'Comida y restaurantes')
    const bobFood = await byName(BOB.id, 'Comida y restaurantes')
    const bobMarket = await byName(BOB.id, 'Supermercado')

    await expect(updateCategory(db(), BOB.id, aliceFood.id, { name: 'hackeada' })).rejects.toThrow(/no existe/)
    await expect(deleteCategory(env.DB, db(), BOB.id, aliceFood.id, null)).rejects.toThrow(/no existe/)
    await expect(deleteCategory(env.DB, db(), ALICE.id, aliceFood.id, bobMarket.id)).rejects.toThrow(/no existe/)

    expect((await byName(ALICE.id, 'Comida y restaurantes')).id).toBe(aliceFood.id)
    expect(bobFood.id).not.toBe(aliceFood.id)
  })
})

describe('cuentas', () => {
  it('no elimina cuentas con movimientos (se archivan)', async () => {
    const [main] = await getAccountsWithBalance(env.DB, ALICE.id)
    const food = await byName(ALICE.id, 'Comida y restaurantes')
    const card = await createAccount(db(), ALICE.id, { name: 'Tarjeta', type: 'credit_card', currency: 'CLP', initialBalance: 0 })
    await expense(ALICE.id, food.id, card.id)

    await expect(deleteAccount(env.DB, db(), ALICE.id, card.id)).rejects.toThrow(/archívala/)
    const archived = await updateAccount(db(), ALICE.id, card.id, { archived: true })
    expect(archived.archived).toBe(true)
    expect(main.archived).toBe(false)
  })

  it('siempre deja al menos una cuenta activa', async () => {
    const [main] = await getAccountsWithBalance(env.DB, ALICE.id)
    await expect(updateAccount(db(), ALICE.id, main.id, { archived: true })).rejects.toThrow(/al menos una cuenta activa/)
    await expect(deleteAccount(env.DB, db(), ALICE.id, main.id)).rejects.toThrow(/al menos una cuenta activa/)
  })

  it('un usuario no puede editar ni eliminar cuentas de otro', async () => {
    const [aliceMain] = await getAccountsWithBalance(env.DB, ALICE.id)
    await expect(updateAccount(db(), BOB.id, aliceMain.id, { name: 'hackeada' })).rejects.toThrow(/no existe/)
    await expect(deleteAccount(env.DB, db(), BOB.id, aliceMain.id)).rejects.toThrow(/no existe/)
  })
})
