import { env, SELF } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { base64url, sign } from '../src/worker/auth/session'
import { getDb } from '../src/worker/db'
import { getAccountsWithBalance, getSummary } from '../src/worker/services/summary'
import {
  createTransactions,
  deleteTransaction,
  listTransactions,
  updateTransaction,
} from '../src/worker/services/transactions'
import { ensureUser } from '../src/worker/services/users'

// Los datos financieros de un usuario nunca deben ser visibles ni modificables por otro.

const ALICE = { id: 'auth0|alice', email: 'alice@example.com' }
const BOB = { id: 'auth0|bob', email: 'bob@example.com' }
const db = () => getDb(env.DB)

async function idsOf(userId: string) {
  const accounts = await getAccountsWithBalance(env.DB, userId)
  const { results } = await env.DB.prepare('SELECT id FROM categories WHERE user_id = ? ORDER BY id').bind(userId).all<{ id: number }>()
  return { accountId: accounts[0].id, categoryId: results[0].id }
}

async function aliceExpense() {
  const { accountId, categoryId } = await idsOf(ALICE.id)
  const { inserted } = await createTransactions(db(), env.DB, ALICE.id, {
    transactions: [{ date: '2026-10-20', kind: 'expense', amount: 8500, currency: 'CLP', accountId, categoryId, source: 'manual' }],
    skipDuplicates: false,
  })
  return inserted[0]
}

async function sessionCookie(user: { id: string; email: string }) {
  const payload = base64url(
    new TextEncoder().encode(JSON.stringify({ userId: user.id, email: user.email, exp: Date.now() / 1000 + 3600 })),
  )
  return `__Host-session=${await sign(payload, env.SESSION_SECRET)}`
}

beforeEach(async () => {
  await env.DB.batch(['transactions', 'import_batches', 'categories', 'accounts', 'users'].map((t) => env.DB.prepare(`DELETE FROM ${t}`)))
  await ensureUser(env.DB, ALICE)
  await ensureUser(env.DB, BOB)
})

describe('ensureUser', () => {
  it('crea categorías y cuenta inicial solo una vez', async () => {
    await ensureUser(env.DB, ALICE)
    const count = (table: string) =>
      env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`).bind(ALICE.id).first<number>('n')
    expect(await count('categories')).toBe(23)
    expect(await count('accounts')).toBe(1)
  })
})

describe('aislamiento entre usuarios (servicios)', () => {
  it('un usuario no ve movimientos, resúmenes ni saldos de otro', async () => {
    await aliceExpense()

    expect(await listTransactions(db(), BOB.id, { limit: 100, offset: 0 })).toHaveLength(0)
    const summary = await getSummary(env.DB, BOB.id, '2026-01-01', '2026-12-31')
    expect(summary.expenseClp).toBe(0)
    expect(summary.byCategory).toHaveLength(0)
    const [bobAccount] = await getAccountsWithBalance(env.DB, BOB.id)
    expect(bobAccount.balanceMinor).toBe(0)

    expect(await listTransactions(db(), ALICE.id, { limit: 100, offset: 0 })).toHaveLength(1)
  })

  it('un usuario no puede editar ni borrar movimientos de otro', async () => {
    const tx = await aliceExpense()

    expect(await updateTransaction(db(), env.DB, BOB.id, tx.id, { amount: 1 })).toBeNull()
    expect(await deleteTransaction(db(), BOB.id, tx.id)).toBe(false)

    const [still] = await listTransactions(db(), ALICE.id, { limit: 100, offset: 0 })
    expect(still.amountMinor).toBe(8500)
  })

  it('no permite usar cuentas ni categorías de otro usuario', async () => {
    const alice = await idsOf(ALICE.id)
    const bob = await idsOf(BOB.id)
    const base = { date: '2026-10-20', kind: 'expense' as const, amount: 100, currency: 'CLP' as const, source: 'manual' as const }

    await expect(
      createTransactions(db(), env.DB, BOB.id, { transactions: [{ ...base, accountId: alice.accountId }], skipDuplicates: false }),
    ).rejects.toThrow(/cuenta/)
    await expect(
      createTransactions(db(), env.DB, BOB.id, { transactions: [{ ...base, categoryId: alice.categoryId }], skipDuplicates: false }),
    ).rejects.toThrow(/categoría/)

    const { inserted } = await createTransactions(db(), env.DB, BOB.id, {
      transactions: [{ ...base, accountId: bob.accountId }],
      skipDuplicates: false,
    })
    await expect(updateTransaction(db(), env.DB, BOB.id, inserted[0].id, { accountId: alice.accountId })).rejects.toThrow(/cuenta/)
    await expect(updateTransaction(db(), env.DB, BOB.id, inserted[0].id, { categoryId: alice.categoryId })).rejects.toThrow(/categoría/)
  })

  it('la detección de duplicados no cruza usuarios', async () => {
    await aliceExpense()
    const { accountId } = await idsOf(BOB.id)
    const result = await createTransactions(db(), env.DB, BOB.id, {
      transactions: [{ date: '2026-10-20', kind: 'expense', amount: 8500, currency: 'CLP', accountId, source: 'manual' }],
      skipDuplicates: true,
    })
    expect(result.duplicates).toHaveLength(0)
    expect(result.inserted).toHaveLength(1)
  })
})

describe('aislamiento entre usuarios (API)', () => {
  it('requiere sesión', async () => {
    expect((await SELF.fetch('http://localhost/api/transactions')).status).toBe(401)
  })

  it('cada sesión solo ve y modifica sus datos', async () => {
    const tx = await aliceExpense()
    const bob = { headers: { Cookie: await sessionCookie(BOB) } }

    const list = (await (await SELF.fetch('http://localhost/api/transactions', bob)).json()) as unknown[]
    expect(list).toHaveLength(0)
    const categories = (await (await SELF.fetch('http://localhost/api/categories', bob)).json()) as { id: number }[]
    expect(categories.map((c) => c.id)).not.toContain((await idsOf(ALICE.id)).categoryId)

    expect((await SELF.fetch(`http://localhost/api/transactions/${tx.id}`, { ...bob, method: 'DELETE' })).status).toBe(404)
    const patch = await SELF.fetch(`http://localhost/api/transactions/${tx.id}`, {
      method: 'PATCH',
      headers: { ...bob.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 1 }),
    })
    expect(patch.status).toBe(404)

    const alice = { headers: { Cookie: await sessionCookie(ALICE) } }
    const aliceList = (await (await SELF.fetch('http://localhost/api/transactions', alice)).json()) as unknown[]
    expect(aliceList).toHaveLength(1)
  })

  it('rechaza una cookie firmada con otro secreto', async () => {
    const payload = base64url(new TextEncoder().encode(JSON.stringify({ userId: ALICE.id, email: ALICE.email, exp: Date.now() / 1000 + 3600 })))
    const forged = await sign(payload, 'otro-secreto')
    const res = await SELF.fetch('http://localhost/api/transactions', { headers: { Cookie: `__Host-session=${forged}` } })
    expect(res.status).toBe(401)
  })
})
