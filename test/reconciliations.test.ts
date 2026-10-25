import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { spendee } from '../src/shared/importers/spendee'
import { getDb } from '../src/worker/db'
import { listImports, previewImport, revertImport, runImport } from '../src/worker/services/imports'
import {
  deleteReconciliation,
  listReconciliations,
  previewReconciliation,
  reconcile,
} from '../src/worker/services/reconciliations'
import { getAccountsWithBalance, getSummary } from '../src/worker/services/summary'
import { createTransactions } from '../src/worker/services/transactions'
import { ensureUser } from '../src/worker/services/users'

// Conciliar = registrar "al cierre del día D, el saldo real de la cuenta era X". Es un ancla:
// el saldo actual parte de la conciliación más reciente y suma solo los movimientos posteriores.

const ALICE = { id: 'auth0|alice', email: 'alice@example.com' }
const BOB = { id: 'auth0|bob', email: 'bob@example.com' }
const db = () => getDb(env.DB)

async function mainAccount(userId = ALICE.id) {
  return (await getAccountsWithBalance(env.DB, userId))[0]
}

async function move(date: string, kind: 'expense' | 'income', amount: number) {
  const account = await mainAccount()
  await createTransactions(db(), env.DB, ALICE.id, {
    transactions: [{ date, kind, amount, currency: 'CLP', accountId: account.id, source: 'manual' }],
    skipDuplicates: false,
  })
}

beforeEach(async () => {
  await env.DB.batch(
    ['balance_reconciliations', 'transactions', 'import_batches', 'categories', 'accounts', 'users'].map((t) =>
      env.DB.prepare(`DELETE FROM ${t}`),
    ),
  )
  await ensureUser(env.DB, ALICE)
  await ensureUser(env.DB, BOB)
})

describe('conciliar saldo', () => {
  it('la vista previa muestra el saldo calculado a esa fecha y la diferencia, sin guardar nada', async () => {
    await move('2026-01-05', 'income', 100_000)
    await move('2026-01-10', 'expense', 30_000)
    await move('2026-02-01', 'expense', 5_000) // posterior: no cuenta para el 31-01
    const account = await mainAccount()

    const preview = await previewReconciliation(env.DB, db(), ALICE.id, { accountId: account.id, date: '2026-01-31', balance: 60_000 })
    expect(preview).toEqual({ calculatedMinor: 70_000, balanceMinor: 60_000, differenceMinor: -10_000 })
    expect(await listReconciliations(env.DB, db(), ALICE.id)).toEqual([])
  })

  it('el saldo actual parte de la última conciliación y suma solo lo posterior', async () => {
    await move('2026-01-05', 'income', 100_000)
    await move('2026-01-10', 'expense', 30_000)
    const account = await mainAccount()
    await reconcile(env.DB, db(), ALICE.id, { accountId: account.id, date: '2026-01-31', balance: 60_000 })
    await move('2026-01-20', 'expense', 999) // anterior a la conciliación: ya está "dentro" del saldo conciliado
    await move('2026-02-03', 'expense', 5_000)

    expect((await mainAccount()).balanceMinor).toBe(55_000)
  })

  it('guarda la diferencia sin registrar de cada conciliación respecto del ancla anterior', async () => {
    await move('2026-01-05', 'income', 100_000)
    const account = await mainAccount()
    await reconcile(env.DB, db(), ALICE.id, { accountId: account.id, date: '2026-01-31', balance: 90_000 })
    await move('2026-02-10', 'expense', 20_000)
    await reconcile(env.DB, db(), ALICE.id, { accountId: account.id, date: '2026-02-28', balance: 65_000, note: 'Cartola febrero' })

    const list = await listReconciliations(env.DB, db(), ALICE.id)
    expect(list.map((r) => [r.date, r.balanceMinor, r.differenceMinor, r.note])).toEqual([
      ['2026-02-28', 65_000, -5_000, 'Cartola febrero'],
      ['2026-01-31', 90_000, -10_000, null],
    ])
    const [withLast] = await getAccountsWithBalance(env.DB, ALICE.id)
    expect(withLast.lastReconciliation).toEqual({ date: '2026-02-28', balanceMinor: 65_000, differenceMinor: -5_000 })
  })

  it('no altera las estadísticas de ingresos y gastos', async () => {
    await move('2026-01-05', 'income', 100_000)
    const account = await mainAccount()
    await reconcile(env.DB, db(), ALICE.id, { accountId: account.id, date: '2026-01-31', balance: 1 })
    const summary = await getSummary(env.DB, ALICE.id, '2026-01-01', '2026-01-31')
    expect(summary).toMatchObject({ incomeClp: 100_000, expenseClp: 0 })
  })

  it('al eliminar la conciliación, el saldo vuelve a calcularse sin ella', async () => {
    await move('2026-01-05', 'income', 100_000)
    const account = await mainAccount()
    const r = await reconcile(env.DB, db(), ALICE.id, { accountId: account.id, date: '2026-01-31', balance: 1 })
    await deleteReconciliation(env.DB, ALICE.id, r.id)
    expect((await mainAccount()).balanceMinor).toBe(100_000)
  })

  it('no permite fechas futuras', async () => {
    const account = await mainAccount()
    await expect(reconcile(env.DB, db(), ALICE.id, { accountId: account.id, date: '2999-01-01', balance: 1 })).rejects.toThrow(/futura/)
  })

  it('aislamiento: no se puede conciliar, ver ni borrar en cuentas de otro usuario', async () => {
    const bobAccount = await mainAccount(BOB.id)
    await expect(reconcile(env.DB, db(), ALICE.id, { accountId: bobAccount.id, date: '2026-01-31', balance: 1 })).rejects.toThrow(/no existe/)
    const bobR = await reconcile(env.DB, db(), BOB.id, { accountId: bobAccount.id, date: '2026-01-31', balance: 1 })
    expect(await listReconciliations(env.DB, db(), ALICE.id)).toEqual([])
    await expect(deleteReconciliation(env.DB, ALICE.id, bobR.id)).rejects.toThrow(/no encontrada/)
  })
})

describe('categorías marcadas como conciliación al importar', () => {
  // Saldo corrido: +100.000 (01-03) → −30.000 (05-03) → ajuste −1.000 (10-03) → +5.000 (12-03)
  const CSV = [
    'Date,Wallet,Type,"Category name",Amount,Currency,Note,Labels,Author',
    '2025-03-01T15:00:00+00:00,Cash Wallet,Income,Salary,100000.00000000,CLP,,,Ana',
    '2025-03-05T15:00:00+00:00,Cash Wallet,Expense,Groceries,-30000.00000000,CLP,,,Ana',
    '2025-03-10T15:00:00+00:00,Cash Wallet,Expense,"Ajuste Negativo",-1000.00000000,CLP,,,Ana',
    '2025-03-12T15:00:00+00:00,Cash Wallet,Income,Salary,5000.00000000,CLP,,,Ana',
  ].join('\n')
  const request = (reconcileCategories: Record<string, boolean> = {}) =>
    ({
      adapter: 'spendee',
      fileNames: ['export.csv'], rows: spendee.parse([{ name: 'export.csv', content: CSV }]).transactions,
      options: { accounts: {}, categoryStrategy: 'hybrid', categoryOverrides: {}, reconcileCategories, labels: 'append', duplicates: 'skip' },
    }) as Parameters<typeof previewImport>[3]

  it('no marca nada por defecto: solo sugiere las que parecen ajustes', async () => {
    const preview = await previewImport(db(), env.DB, ALICE.id, request())
    expect(preview.categories.find((c) => c.sourceName === 'Ajuste Negativo')).toMatchObject({ adjustment: false, suggestedAdjustment: true })
    expect(preview.categories.find((c) => c.sourceName === 'Groceries')).toMatchObject({ adjustment: false, suggestedAdjustment: false })
    expect(preview.adjustmentCount).toBe(0)
    expect(preview.summary.toImport).toBe(4)
  })

  it('cada movimiento de una categoría marcada se convierte en una conciliación con el saldo real de ese momento', async () => {
    const marked = request({ 'expense|Ajuste Negativo': true })
    const preview = await previewImport(db(), env.DB, ALICE.id, marked)
    expect(preview.adjustmentCount).toBe(1)
    expect(preview.summary.toImport).toBe(3)

    const result = await runImport(db(), env.DB, ALICE.id, marked)
    expect(result).toMatchObject({ inserted: 3, reconciliations: 1 })
    const [r] = await listReconciliations(env.DB, db(), ALICE.id)
    expect(r).toMatchObject({ date: '2025-03-10', balanceMinor: 69_000, differenceMinor: -1_000 })
    expect((await mainAccount()).balanceMinor).toBe(74_000)
  })

  it('se puede marcar cualquier categoría, aunque no parezca un ajuste', async () => {
    const result = await runImport(db(), env.DB, ALICE.id, request({ 'income|Salary': true, 'expense|Ajuste Negativo': true }))
    expect(result).toMatchObject({ inserted: 1, reconciliations: 3 })
    expect((await listReconciliations(env.DB, db(), ALICE.id)).map((r) => r.date)).toEqual(['2025-03-12', '2025-03-10', '2025-03-01'])
  })

  it('sin marcar, un "ajuste" se importa como movimiento normal', async () => {
    const result = await runImport(db(), env.DB, ALICE.id, request())
    expect(result).toMatchObject({ inserted: 4, reconciliations: 0 })
    expect((await mainAccount()).balanceMinor).toBe(74_000)
  })

  it('marcar y desmarcar no pierde la categoría elegida para la fila', async () => {
    const options = {
      ...request({ 'income|Salary': false }).options,
      categoryOverrides: { 'income|Salary': { type: 'create' as const, name: 'Remuneraciones' } },
    }
    const preview = await previewImport(db(), env.DB, ALICE.id, { ...request(), options })
    expect(preview.categories.find((c) => c.sourceName === 'Salary')).toMatchObject({
      adjustment: false,
      target: { type: 'create', name: 'Remuneraciones' },
    })
  })

  it('revertir la importación elimina también sus conciliaciones', async () => {
    const { batchId } = await runImport(db(), env.DB, ALICE.id, request({ 'expense|Ajuste Negativo': true }))
    await revertImport(env.DB, db(), ALICE.id, batchId)
    expect(await listReconciliations(env.DB, db(), ALICE.id)).toEqual([])
    expect((await mainAccount()).balanceMinor).toBe(0)
    expect((await listImports(env.DB, ALICE.id))[0].status).toBe('reverted')
  })
})

describe('API de conciliaciones', () => {
  async function cookie(user: { id: string; email: string }) {
    const { base64url, sign } = await import('../src/worker/auth/session')
    const payload = base64url(new TextEncoder().encode(JSON.stringify({ userId: user.id, email: user.email, exp: Date.now() / 1000 + 3600 })))
    return `__Host-session=${await sign(payload, env.SESSION_SECRET)}`
  }
  const call = async (user: typeof ALICE, path: string, init: RequestInit = {}) => {
    const { SELF } = await import('cloudflare:test')
    return SELF.fetch(`http://localhost/api${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', Cookie: await cookie(user), ...init.headers },
    })
  }

  it('vista previa, conciliar, listar y eliminar; cada usuario solo ve lo suyo', async () => {
    await move('2026-01-05', 'income', 100_000)
    const account = await mainAccount()
    const body = JSON.stringify({ accountId: account.id, date: '2026-01-31', balance: 90_000, note: 'Cartola' })

    const preview = await (await call(ALICE, '/reconciliations/preview', { method: 'POST', body })).json()
    expect(preview).toEqual({ calculatedMinor: 100_000, balanceMinor: 90_000, differenceMinor: -10_000 })

    const created = await call(ALICE, '/reconciliations', { method: 'POST', body })
    expect(created.status).toBe(201)
    const { id } = (await created.json()) as { id: number }

    expect(((await (await call(ALICE, '/reconciliations')).json()) as unknown[]).length).toBe(1)
    expect(((await (await call(BOB, '/reconciliations')).json()) as unknown[]).length).toBe(0)
    expect((await call(BOB, `/reconciliations/${id}`, { method: 'DELETE' })).status).toBe(404)
    expect((await call(ALICE, `/reconciliations/${id}`, { method: 'DELETE' })).status).toBe(200)
  })

  it('valida la entrada', async () => {
    const account = await mainAccount()
    const res = await call(ALICE, '/reconciliations', { method: 'POST', body: JSON.stringify({ accountId: account.id, date: '31-01-2026', balance: 'mil' }) })
    expect(res.status).toBe(400)
  })
})
