import { validate } from './validate'
import { Hono } from 'hono'
import { z } from 'zod'
import { accounts, categories } from '../../../db/schema'
import { toMinor } from '../../shared/money'
import {
  accountInput,
  createTransactionsInput,
  listTransactionsQuery,
  summaryQuery,
  updateTransactionInput,
} from '../../shared/schemas'
import { getDb } from '../db'
import { AppError } from '../errors'
import { getUsdClpRates } from '../services/fx'
import { getAccountsWithBalance, getSummary } from '../services/summary'
import {
  createTransactions,
  deleteTransaction,
  listTransactions,
  updateTransaction,
} from '../services/transactions'

const idParam = z.object({ id: z.coerce.number().int().positive() })

export const api = new Hono<{ Bindings: Env }>()
  .get('/health', (c) => c.json({ ok: true }))

  .get('/accounts', async (c) => c.json(await getAccountsWithBalance(c.env.DB)))
  .post('/accounts', validate('json', accountInput), async (c) => {
    const { initialBalance, ...data } = c.req.valid('json')
    const [account] = await getDb(c.env.DB)
      .insert(accounts)
      .values({ ...data, initialBalanceMinor: toMinor(initialBalance, data.currency) })
      .returning()
    return c.json(account, 201)
  })

  .get('/categories', async (c) => c.json(await getDb(c.env.DB).select().from(categories).orderBy(categories.kind, categories.name)))

  .get('/transactions', validate('query', listTransactionsQuery), async (c) =>
    c.json(await listTransactions(getDb(c.env.DB), c.req.valid('query'))),
  )
  .post('/transactions', validate('json', createTransactionsInput), async (c) =>
    c.json(await createTransactions(getDb(c.env.DB), c.env.DB, c.req.valid('json')), 201),
  )
  .patch('/transactions/:id', validate('param', idParam), validate('json', updateTransactionInput), async (c) => {
    const updated = await updateTransaction(getDb(c.env.DB), c.env.DB, c.req.valid('param').id, c.req.valid('json'))
    if (!updated) throw new AppError('Transacción no encontrada', 404)
    return c.json(updated)
  })
  .delete('/transactions/:id', validate('param', idParam), async (c) => {
    if (!(await deleteTransaction(getDb(c.env.DB), c.req.valid('param').id))) {
      throw new AppError('Transacción no encontrada', 404)
    }
    return c.body(null, 204)
  })

  .get('/summary', validate('query', summaryQuery), async (c) => {
    const { from, to } = c.req.valid('query')
    return c.json(await getSummary(c.env.DB, from, to))
  })

  .get('/fx/usd/:date', validate('param', z.object({ date: z.iso.date() })), async (c) => {
    const { date } = c.req.valid('param')
    const rates = await getUsdClpRates(c.env.DB, [date])
    return c.json({ date, currency: 'USD', clpPerUnit: rates.get(date) })
  })

