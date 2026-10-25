import { Hono } from 'hono'
import { z } from 'zod'
import {
  accountInput,
  accountUpdateInput,
  categoryInput,
  categoryUpdateInput,
  createTransactionsInput,
  deleteCategoryInput,
  appendImportRowsRequest,
  finishImportRequest,
  importRequest,
  startImportRequest,
  listReconciliationsQuery,
  mergeCategoriesInput,
  reconcileInput,
  listTransactionsQuery,
  summaryQuery,
  updateTransactionInput,
} from '../../shared/schemas'
import type { AuthEnv } from '../auth/routes'
import { getDb } from '../db'
import { AppError } from '../errors'
import { createAccount, deleteAccount, updateAccount } from '../services/accounts'
import { listConnections, revokeConnection } from '../services/connections'
import { createCategory, deleteCategory, listCategories, mergeCategories, updateCategory } from '../services/categories'
import { getUsdClpRates } from '../services/fx'
import { appendImportRows, finishImport, listImports, previewImport, revertImport, startImport } from '../services/imports'
import { deleteReconciliation, listReconciliations, previewReconciliation, reconcile } from '../services/reconciliations'
import { getAccountsWithBalance, getSummary } from '../services/summary'
import {
  countTransactions,
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
  .post('/categories/merge', validate('json', mergeCategoriesInput), async (c) => {
    const { sourceIds, targetId } = c.req.valid('json')
    return c.json(await mergeCategories(c.env.DB, getDb(c.env.DB), c.get('session').userId, sourceIds, targetId))
  })
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

  // Asistentes conectados al MCP (grants OAuth) y su revocación.
  .get('/connections', async (c) => c.json(await listConnections(c.env.OAUTH_PROVIDER, c.get('session').userId)))
  .delete('/connections/:grantId', validate('param', z.object({ grantId: z.string().min(1).max(200) })), async (c) =>
    c.json(await revokeConnection(c.env.OAUTH_PROVIDER, c.get('session').userId, c.req.valid('param').grantId)),
  )

  // Conciliaciones: saldo real de una cuenta en una fecha (ancla del saldo, no un movimiento).
  .get('/reconciliations', validate('query', listReconciliationsQuery), async (c) =>
    c.json(await listReconciliations(c.env.DB, getDb(c.env.DB), c.get('session').userId, c.req.valid('query').accountId)),
  )
  .post('/reconciliations/preview', validate('json', reconcileInput), async (c) =>
    c.json(await previewReconciliation(c.env.DB, getDb(c.env.DB), c.get('session').userId, c.req.valid('json'))),
  )
  .post('/reconciliations', validate('json', reconcileInput), async (c) =>
    c.json(await reconcile(c.env.DB, getDb(c.env.DB), c.get('session').userId, c.req.valid('json')), 201),
  )
  .delete('/reconciliations/:id', validate('param', idParam), async (c) =>
    c.json(await deleteReconciliation(c.env.DB, c.get('session').userId, c.req.valid('param').id)),
  )

  // Importación de historial en etapas (cada request hace poco trabajo, por el límite de CPU):
  // vista previa (no escribe) → start → tandas de ≤ 500 movimientos → finish. Historial y revertir.
  .post('/imports/preview', validate('json', importRequest), async (c) =>
    c.json(await previewImport(getDb(c.env.DB), c.env.DB, c.get('session').userId, c.req.valid('json'))),
  )
  .post('/imports/start', validate('json', startImportRequest), async (c) =>
    c.json(await startImport(getDb(c.env.DB), c.env.DB, c.get('session').userId, c.req.valid('json')), 201),
  )
  .post('/imports/:id/rows', validate('param', idParam), validate('json', appendImportRowsRequest), async (c) =>
    c.json(await appendImportRows(getDb(c.env.DB), c.env.DB, c.get('session').userId, c.req.valid('param').id, c.req.valid('json'))),
  )
  .post('/imports/:id/finish', validate('param', idParam), validate('json', finishImportRequest), async (c) =>
    c.json(await finishImport(c.env.DB, getDb(c.env.DB), c.get('session').userId, c.req.valid('param').id, c.req.valid('json'))),
  )
  .get('/imports', async (c) => c.json(await listImports(c.env.DB, c.get('session').userId)))
  .delete('/imports/:id', validate('param', idParam), async (c) =>
    c.json(await revertImport(c.env.DB, getDb(c.env.DB), c.get('session').userId, c.req.valid('param').id)),
  )

  // Página de movimientos y total del filtro (para el paginador).
  .get('/transactions', validate('query', listTransactionsQuery), async (c) => {
    const db = getDb(c.env.DB)
    const userId = c.get('session').userId
    const query = c.req.valid('query')
    const [items, total] = await Promise.all([listTransactions(db, userId, query), countTransactions(db, userId, query)])
    return c.json({ items, total })
  })
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

