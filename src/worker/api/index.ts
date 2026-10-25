import { Hono } from 'hono'
import { z } from 'zod'
import {
  accountInput,
  accountUpdateInput,
  categoryInput,
  categoryUpdateInput,
  createTransactionsInput,
  deleteCategoryInput,
  listTransactionsQuery,
  summaryQuery,
  updateTransactionInput,
} from '../../shared/schemas'
import type { AuthEnv } from '../auth/routes'
import { getDb } from '../db'
import { AppError } from '../errors'
import { createAccount, deleteAccount, updateAccount } from '../services/accounts'
import { createCategory, deleteCategory, listCategories, updateCategory } from '../services/categories'
import { getUsdClpRates } from '../services/fx'
import { getAccountsWithBalance, getSummary } from '../services/summary'
import {
  createTransactions,
  deleteTransaction,
  listTransactions,
  updateTransaction,
} from '../services/transactions'
import { validate } from './validate'

const idParam = z.object({ id: z.coerce.number().int().positive() })

// Todas las rutas corren detrás de requireSession: c.get('session').userId es el dueño
// de los datos y se pasa explícitamente a cada servicio.
export const api = new Hono<AuthEnv>()
  .get('/health', (c) => c.json({ ok: true }))

  .get('/accounts', async (c) => c.json(await getAccountsWithBalance(c.env.DB, c.get('session').userId)))
  .post('/accounts', validate('json', accountInput), async (c) =>
    c.json(await createAccount(getDb(c.env.DB), c.get('session').userId, c.req.valid('json')), 201),
  )
  .patch('/accounts/:id', validate('param', idParam), validate('json', accountUpdateInput), async (c) =>
    c.json(await updateAccount(getDb(c.env.DB), c.get('session').userId, c.req.valid('param').id, c.req.valid('json'))),
  )
  .delete('/accounts/:id', validate('param', idParam), async (c) =>
    c.json(await deleteAccount(c.env.DB, getDb(c.env.DB), c.get('session').userId, c.req.valid('param').id)),
  )

  .get('/categories', async (c) => c.json(await listCategories(c.env.DB, c.get('session').userId)))
  .post('/categories', validate('json', categoryInput), async (c) =>
    c.json(await createCategory(getDb(c.env.DB), c.get('session').userId, c.req.valid('json')), 201),
  )
  .patch('/categories/:id', validate('param', idParam), validate('json', categoryUpdateInput), async (c) =>
    c.json(await updateCategory(getDb(c.env.DB), c.get('session').userId, c.req.valid('param').id, c.req.valid('json'))),
  )
  // ?reassignTo=<id> mueve los movimientos a otra categoría; ?reassignTo=null los deja sin categoría.
  .delete('/categories/:id', validate('param', idParam), validate('query', deleteCategoryInput), async (c) =>
    c.json(
      await deleteCategory(
        c.env.DB,
        getDb(c.env.DB),
        c.get('session').userId,
        c.req.valid('param').id,
        c.req.valid('query').reassignTo,
      ),
    ),
  )

  .get('/transactions', validate('query', listTransactionsQuery), async (c) =>
    c.json(await listTransactions(getDb(c.env.DB), c.get('session').userId, c.req.valid('query'))),
  )
  .post('/transactions', validate('json', createTransactionsInput), async (c) =>
    c.json(await createTransactions(getDb(c.env.DB), c.env.DB, c.get('session').userId, c.req.valid('json')), 201),
  )
  .patch('/transactions/:id', validate('param', idParam), validate('json', updateTransactionInput), async (c) => {
    const updated = await updateTransaction(
      getDb(c.env.DB),
      c.env.DB,
      c.get('session').userId,
      c.req.valid('param').id,
      c.req.valid('json'),
    )
    if (!updated) throw new AppError('Transacción no encontrada', 404)
    return c.json(updated)
  })
  .delete('/transactions/:id', validate('param', idParam), async (c) => {
    if (!(await deleteTransaction(getDb(c.env.DB), c.get('session').userId, c.req.valid('param').id))) {
      throw new AppError('Transacción no encontrada', 404)
    }
    return c.body(null, 204)
  })

  .get('/summary', validate('query', summaryQuery), async (c) => {
    const { from, to } = c.req.valid('query')
    return c.json(await getSummary(c.env.DB, c.get('session').userId, from, to))
  })

  .get('/fx/usd/:date', validate('param', z.object({ date: z.iso.date() })), async (c) => {
    const { date } = c.req.valid('param')
    const rates = await getUsdClpRates(c.env.DB, [date])
    return c.json({ date, currency: 'USD', clpPerUnit: rates.get(date) })
  })

