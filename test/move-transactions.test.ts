import { env, SELF } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { base64url, sign } from '../src/worker/auth/session'
import { getDb } from '../src/worker/db'
import { createAccount } from '../src/worker/services/accounts'
import { reconcile } from '../src/worker/services/reconciliations'
import { getAccountsWithBalance } from '../src/worker/services/summary'
import { createTransactions, listTransactions, moveTransactions } from '../src/worker/services/transactions'
import { ensureUser } from '../src/worker/services/users'
import { listTransactionsQuery } from '../src/shared/schemas'

// Mover movimientos a otra cuenta: separar lo que antes se registraba todo en una sola cuenta.
// La vista previa muestra el saldo de cada cuenta antes y después, porque una cuenta conciliada
// no cambia su saldo actual por movimientos anteriores a su conciliación.

const ALICE = { id: 'auth0|alice', email: 'alice@example.com' }
const BOB = { id: 'auth0|bob', email: 'bob@example.com' }
const db = () => getDb(env.DB)

beforeEach(async () => {
  await env.DB.batch(
    ['balance_reconciliations', 'transactions', 'import_batches', 'categories', 'accounts', 'users'].map((t) =>
      env.DB.prepare(`DELETE FROM ${t}`),
    ),
  )
  await ensureUser(env.DB, ALICE)
  await ensureUser(env.DB, BOB)
})

async function setup() {
  const [main] = await getAccountsWithBalance(env.DB, ALICE.id)
  const card = await createAccount(db(), ALICE.id, { name: 'Tarjeta', type: 'credit_card', currency: 'CLP', initialBalance: 0 })
  const { inserted } = await createTransactions(db(), env.DB, ALICE.id, {
    transactions: [
      { date: '2026-01-05', kind: 'income', amount: 100_000, currency: 'CLP', accountId: main.id, source: 'manual' },
      { date: '2026-01-10', kind: 'expense', amount: 20_000, currency: 'CLP', accountId: main.id, source: 'manual', description: 'Uber' },
      { date: '2026-02-03', kind: 'expense', amount: 5_000, currency: 'CLP', accountId: main.id, source: 'manual', description: 'Café' },
    ],
    skipDuplicates: false,
  })
  const ids = inserted.map((t) => t.id)
  return { main, card, income: ids[0], uber: ids[1], coffee: ids[2] }
}

const onAccount = (accountId: number) => listTransactions(db(), ALICE.id, listTransactionsQuery.parse({ accountId }))
const balances = async () => new Map((await getAccountsWithBalance(env.DB, ALICE.id)).map((a) => [a.id, a.balanceMinor]))

describe('mover movimientos a otra cuenta', () => {
  it('la vista previa muestra el saldo antes y después de cada cuenta afectada, sin guardar nada', async () => {
    const { main, card, uber, coffee } = await setup()
    const preview = await moveTransactions(env.DB, ALICE.id, { ids: [uber, coffee], accountId: card.id, dryRun: true })

    expect(preview.moved).toBe(2)
    expect(preview.accounts).toEqual([
      { accountId: main.id, name: main.name, currency: 'CLP', beforeMinor: 75_000, afterMinor: 100_000, lastReconciliationDate: null, anchoredCount: 0 },
      { accountId: card.id, name: 'Tarjeta', currency: 'CLP', beforeMinor: 0, afterMinor: -25_000, lastReconciliationDate: null, anchoredCount: 0 },
    ])
    expect((await balances()).get(main.id)).toBe(75_000)
  })

  it('mueve los movimientos y los saldos quedan como en la vista previa', async () => {
    const { main, card, uber, coffee } = await setup()
    const preview = await moveTransactions(env.DB, ALICE.id, { ids: [uber, coffee], accountId: card.id, dryRun: true })
    const result = await moveTransactions(env.DB, ALICE.id, { ids: [uber, coffee], accountId: card.id })

    expect(result.moved).toBe(2)
    const after = await balances()
    for (const a of preview.accounts) expect(after.get(a.accountId)).toBe(a.afterMinor)
    const onCard = await onAccount(card.id)
    expect(onCard.map((t) => t.id).sort()).toEqual([uber, coffee].sort())
    expect(after.get(main.id)).toBe(100_000)
  })

  it('una cuenta conciliada no cambia su saldo actual por movimientos anteriores a la conciliación', async () => {
    const { main, card, uber, coffee } = await setup()
    await reconcile(env.DB, db(), ALICE.id, { accountId: main.id, date: '2026-01-31', balance: 80_000 })

    const preview = await moveTransactions(env.DB, ALICE.id, { ids: [uber, coffee], accountId: card.id, dryRun: true })
    const mainEffect = preview.accounts.find((a) => a.accountId === main.id)!
    // El Uber (10-01) está "dentro" del saldo conciliado; solo el café (03-02) cambia el saldo actual.
    expect(mainEffect).toMatchObject({ beforeMinor: 75_000, afterMinor: 80_000, lastReconciliationDate: '2026-01-31', anchoredCount: 1 })
    expect(preview.accounts.find((a) => a.accountId === card.id)).toMatchObject({ beforeMinor: 0, afterMinor: -25_000 })
  })

  it('ignora los que ya están en la cuenta destino', async () => {
    const { card, uber, coffee } = await setup()
    await moveTransactions(env.DB, ALICE.id, { ids: [uber], accountId: card.id })
    const result = await moveTransactions(env.DB, ALICE.id, { ids: [uber, coffee], accountId: card.id, dryRun: true })
    expect(result).toMatchObject({ moved: 1, alreadyThere: 1 })
  })

  it('rechaza movimientos o cuentas de otro usuario', async () => {
    const { card, uber } = await setup()
    const [bobAccount] = await getAccountsWithBalance(env.DB, BOB.id)
    await expect(moveTransactions(env.DB, BOB.id, { ids: [uber], accountId: bobAccount.id })).rejects.toThrow('no encontrado')
    await expect(moveTransactions(env.DB, ALICE.id, { ids: [uber], accountId: bobAccount.id })).rejects.toThrow('no existe')
    expect((await onAccount(card.id)).length).toBe(0)
  })

  it('no deja una transferencia con la misma cuenta de origen y destino', async () => {
    const { main, card } = await setup()
    const { inserted } = await createTransactions(db(), env.DB, ALICE.id, {
      transactions: [
        { date: '2026-02-01', kind: 'transfer', amount: 1_000, currency: 'CLP', accountId: main.id, toAccountId: card.id, source: 'manual' },
      ],
      skipDuplicates: false,
    })
    await expect(moveTransactions(env.DB, ALICE.id, { ids: [inserted[0].id], accountId: card.id })).rejects.toThrow('transferencia')
  })
})

describe('mover movimientos (API)', () => {
  it('POST /api/transactions/move con vista previa y luego aplicando', async () => {
    const { card, uber } = await setup()
    const payload = base64url(new TextEncoder().encode(JSON.stringify({ userId: ALICE.id, email: ALICE.email, exp: Date.now() / 1000 + 3600 })))
    const headers = { Cookie: `__Host-session=${await sign(payload, env.SESSION_SECRET)}`, 'Content-Type': 'application/json' }
    const send = (body: unknown) => SELF.fetch('http://localhost/api/transactions/move', { method: 'POST', headers, body: JSON.stringify(body) })

    const preview = await send({ ids: [uber], accountId: card.id, dryRun: true })
    expect(preview.status).toBe(200)
    expect((await preview.json()) as object).toMatchObject({ moved: 1 })
    expect((await onAccount(card.id)).length).toBe(0)

    expect((await send({ ids: [uber], accountId: card.id })).status).toBe(200)
    expect((await onAccount(card.id)).length).toBe(1)
    expect((await send({ ids: [], accountId: card.id })).status).toBe(400)
  })
})
