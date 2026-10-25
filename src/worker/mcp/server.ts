import { McpServer, type CallToolResult } from '@modelcontextprotocol/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { accounts, categories } from '../../../db/schema'
import { formatMoney } from '../../shared/money'
import {
  accountInput,
  accountUpdateInput,
  categoryInput,
  categoryUpdateInput,
  mergeCategoriesInput,
  reconcileInput,
  createTransactionsInput,
  listTransactionsQuery,
  summaryQuery,
  updateTransactionInput,
} from '../../shared/schemas'
import type { Transaction } from '../../shared/types'
import { getDb, todayInChile } from '../db'
import { AppError } from '../errors'
import { createAccount, deleteAccount, updateAccount } from '../services/accounts'
import { createCategory, deleteCategory, listCategories, mergeCategories, updateCategory } from '../services/categories'
import { listImports, revertImport } from '../services/imports'
import { deleteReconciliation, listReconciliations, previewReconciliation, reconcile } from '../services/reconciliations'
import { getUsdClpRates } from '../services/fx'
import { getAccountsWithBalance, getSummary } from '../services/summary'
import { createTransactions, deleteTransaction, listTransactions, updateTransaction } from '../services/transactions'

const INSTRUCTIONS = `OpenSpend: registro de gastos e ingresos personales (Chile, montos en CLP y USD).

Flujo recomendado:
1. Llama a get_context al inicio para conocer la fecha de hoy, las cuentas y las categorías (con sus IDs).
2. Cuando el usuario cuente gastos o ingresos en texto libre o en una foto de boleta, extrae cada movimiento:
   - Sin fecha → hoy (según get_context). "ayer", "el lunes" → calcula la fecha.
   - Sin moneda → CLP. "lucas" = miles de pesos (8 lucas = 8000).
   - Sin cuenta → se usa la cuenta principal.
   - Elige la categoría más adecuada. Si dudas, busca movimientos parecidos con search_transactions (campo q) y usa la categoría que se usó antes.
3. ANTES de registrar, muestra una vista previa en tabla (fecha, descripción, monto, moneda, categoría, cuenta) y
   pregunta si está bien o si quiere cambiar algo. Llama a add_transactions SOLO cuando el usuario confirme.
   Nunca registres en el mismo turno en que el usuario describe el movimiento.
4. Después de registrar, confirma brevemente qué quedó guardado. Si add_transactions reporta duplicados, pregunta
   al usuario antes de borrar o volver a insertar.
5. Para correcciones ("el uber era trabajo") usa search_transactions, muestra el cambio propuesto y, tras la
   confirmación, update_transaction. Para borrar, confirma siempre antes de delete_transaction.
6. Categorías y cuentas se administran con create/update/delete_category y create/update/delete_account, siempre
   con confirmación previa. Para fusionar categorías usa delete_category con reassignTo. Las cuentas con
   movimientos no se eliminan: se archivan (update_account con archived=true). Para juntar varias categorías en
   una usa merge_categories.
7. Si el usuario dice cuánto tiene realmente en una cuenta ("en el banco tengo 1.234.567"), concilia: primero
   preview_reconciliation, muestra la diferencia sin registrar y, si confirma, reconcile_balance. No inventes
   movimientos para cuadrar el saldo.
8. Las importaciones de historial se hacen desde la página Importar del dashboard; con list_imports y revert_import
   puedes ver y deshacer una importación completa (con confirmación).

Los montos se envían en unidades normales (12990, 9.99), no en centavos.`

type ToolResult = CallToolResult

function ok(data: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
}

// Los errores esperados (validación, cuenta inexistente) se devuelven como resultado de
// error para que Claude pueda corregir y reintentar.
async function run(fn: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return ok(await fn())
  } catch (error) {
    if (error instanceof AppError) return { isError: true, content: [{ type: 'text', text: error.message }] }
    if (error instanceof Error && error.message.includes('FOREIGN KEY constraint failed')) {
      return { isError: true, content: [{ type: 'text', text: 'La cuenta o categoría indicada no existe' }] }
    }
    if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
      return { isError: true, content: [{ type: 'text', text: 'Ya existe un registro con ese nombre' }] }
    }
    throw error
  }
}

// userId viene del token OAuth validado: cada herramienta opera solo sobre sus datos.
export function buildMcpServer(env: Env, userId: string) {
  const db = getDb(env.DB)
  const server = new McpServer({ name: 'openspend', version: '0.1.0' }, { instructions: INSTRUCTIONS })

  // Versión legible de una transacción para el modelo.
  async function describe(transactions: Transaction[]) {
    const [cats, accs] = await Promise.all([
      db.select().from(categories).where(eq(categories.userId, userId)),
      db.select().from(accounts).where(eq(accounts.userId, userId)),
    ])
    const catName = new Map(cats.map((c) => [c.id, c.name]))
    const accName = new Map(accs.map((a) => [a.id, a.name]))
    return transactions.map((t) => ({
      id: t.id,
      date: t.date,
      kind: t.kind,
      amount: formatMoney(t.amountMinor, t.currency),
      amountClp: t.currency === 'CLP' ? undefined : formatMoney(t.amountClp, 'CLP'),
      category: t.categoryId ? catName.get(t.categoryId) : null,
      account: accName.get(t.accountId),
      toAccount: t.toAccountId ? accName.get(t.toAccountId) : undefined,
      description: t.description,
      merchant: t.merchant,
      possibleDuplicateOf: t.possibleDuplicateOf ?? undefined,
    }))
  }

  server.registerTool(
    'get_context',
    {
      title: 'Contexto',
      description:
        'Fecha de hoy en Chile, cuentas con saldo y categorías (con IDs y cantidad de movimientos). Llamar al inicio.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    () =>
      run(async () => ({
        today: todayInChile(),
        accounts: (await getAccountsWithBalance(env.DB, userId))
          .filter((a) => !a.archived)
          .map((a) => ({
            id: a.id,
            name: a.name,
            type: a.type,
            currency: a.currency,
            balance: formatMoney(a.balanceMinor, a.currency),
            transactions: a.transactionCount,
            lastReconciliation: a.lastReconciliation
              ? {
                  date: a.lastReconciliation.date,
                  balance: formatMoney(a.lastReconciliation.balanceMinor, a.currency),
                  unregisteredDifference: formatMoney(a.lastReconciliation.differenceMinor, a.currency),
                }
              : null,
          })),
        categories: (await listCategories(env.DB, userId)).map((c) => ({
          id: c.id,
          name: c.name,
          kind: c.kind,
          icon: c.icon,
          transactions: c.transactionCount,
        })),
      })),
  )

  server.registerTool(
    'add_transactions',
    {
      title: 'Registrar movimientos',
      description:
        'Registra uno o más gastos, ingresos o transferencias. Úsala solo después de mostrar una vista previa y que el usuario la confirme. Detecta posibles duplicados (mismo monto, moneda, tipo y cuenta, ±2 días). Con skipDuplicates=true no inserta los duplicados, solo los reporta.',
      inputSchema: createTransactionsInput.omit({ importBatchId: true }),
    },
    (input) =>
      run(async () => {
        const result = await createTransactions(db, env.DB, userId, {
          ...input,
          transactions: input.transactions.map((t) => ({ ...t, source: t.source === 'manual' ? 'chat' : t.source })),
        })
        return {
          inserted: await describe(result.inserted),
          duplicates: await Promise.all(
            result.duplicates.map(async (d) => ({ input: d.input, inserted: d.inserted, matches: await describe(d.matches) })),
          ),
        }
      }),
  )

  server.registerTool(
    'search_transactions',
    {
      title: 'Buscar movimientos',
      description:
        'Busca movimientos por rango de fechas, cuenta, categoría, tipo o texto (q busca en descripción y comercio). Ordenados del más reciente al más antiguo.',
      inputSchema: listTransactionsQuery,
      annotations: { readOnlyHint: true },
    },
    (query) => run(async () => describe((await listTransactions(db, userId, query)) as Transaction[])),
  )

  server.registerTool(
    'update_transaction',
    {
      title: 'Editar movimiento',
      description:
        'Modifica campos de un movimiento existente. Úsala solo después de mostrar el cambio propuesto y que el usuario lo confirme. Si cambia monto, moneda o fecha se recalcula la conversión a CLP. Usa possibleDuplicateOf=null para marcar que no es duplicado.',
      inputSchema: updateTransactionInput.extend({ id: z.number().int().positive() }),
    },
    ({ id, ...patch }) =>
      run(async () => {
        const updated = await updateTransaction(db, env.DB, userId, id, patch)
        if (!updated) throw new AppError('Transacción no encontrada', 404)
        return (await describe([updated as Transaction]))[0]
      }),
  )

  server.registerTool(
    'delete_transaction',
    {
      title: 'Eliminar movimiento',
      description: 'Elimina un movimiento por ID. Confirma con el usuario antes de usarla.',
      inputSchema: z.object({ id: z.number().int().positive() }),
      annotations: { destructiveHint: true },
    },
    ({ id }) =>
      run(async () => {
        if (!(await deleteTransaction(db, userId, id))) throw new AppError('Transacción no encontrada', 404)
        return { deleted: id }
      }),
  )

  server.registerTool(
    'get_summary',
    {
      title: 'Resumen',
      description: 'Ingresos, gastos y neto en CLP para un rango de fechas, desglosado por categoría y por mes.',
      inputSchema: summaryQuery,
      annotations: { readOnlyHint: true },
    },
    ({ from, to }) =>
      run(async () => {
        const s = await getSummary(env.DB, userId, from, to)
        const clp = (n: number) => formatMoney(n, 'CLP')
        return {
          from,
          to,
          income: clp(s.incomeClp),
          expense: clp(s.expenseClp),
          net: clp(s.netClp),
          byCategory: s.byCategory.map((c) => ({ category: c.name, kind: c.kind, total: clp(c.totalClp), count: c.count })),
          byMonth: s.byMonth.map((m) => ({ month: m.month, income: clp(m.incomeClp), expense: clp(m.expenseClp) })),
        }
      }),
  )

  server.registerTool(
    'get_usd_rate',
    {
      title: 'Dólar observado',
      description: 'Valor del dólar observado (CLP por 1 USD) para una fecha.',
      inputSchema: z.object({ date: z.iso.date() }),
      annotations: { readOnlyHint: true },
    },
    ({ date }) => run(async () => ({ date, clpPerUsd: (await getUsdClpRates(env.DB, [date])).get(date) })),
  )

  server.registerTool(
    'create_category',
    {
      title: 'Crear categoría',
      description: 'Crea una categoría. Úsala solo después de que el usuario confirme nombre, tipo e ícono.',
      inputSchema: categoryInput,
    },
    (input) => run(() => createCategory(db, userId, input)),
  )

  server.registerTool(
    'update_category',
    {
      title: 'Editar categoría',
      description:
        'Cambia el nombre, ícono o color (#RRGGBB) de una categoría. El tipo (gasto/ingreso) no se puede cambiar. Úsala solo después de que el usuario confirme el cambio.',
      inputSchema: categoryUpdateInput.extend({ id: z.number().int().positive() }),
    },
    ({ id, ...patch }) => run(() => updateCategory(db, userId, id, patch)),
  )

  server.registerTool(
    'delete_category',
    {
      title: 'Eliminar o fusionar categoría',
      description:
        'Elimina una categoría. Si tiene movimientos, reassignTo indica a qué categoría del mismo tipo moverlos (sirve para fusionar categorías) o null para dejarlos sin categoría; sin reassignTo falla e informa cuántos movimientos tiene. Confirma con el usuario antes de usarla.',
      inputSchema: z.object({ id: z.number().int().positive(), reassignTo: z.number().int().positive().nullable().optional() }),
      annotations: { destructiveHint: true },
    },
    ({ id, reassignTo }) => run(() => deleteCategory(env.DB, db, userId, id, reassignTo)),
  )

  server.registerTool(
    'merge_categories',
    {
      title: 'Combinar categorías',
      description:
        'Combina varias categorías (sourceIds) en una (targetId): mueve sus movimientos y elimina las de origen. Todas deben ser del mismo tipo. Confirma con el usuario antes de usarla.',
      inputSchema: mergeCategoriesInput,
      annotations: { destructiveHint: true },
    },
    ({ sourceIds, targetId }) => run(() => mergeCategories(env.DB, db, userId, sourceIds, targetId)),
  )

  server.registerTool(
    'preview_reconciliation',
    {
      title: 'Vista previa de conciliación',
      description:
        'Compara el saldo real que indica el usuario (en la moneda de la cuenta, al cierre de la fecha) con el saldo que calcula OpenSpend, y devuelve la diferencia sin registrar. No guarda nada. Úsala siempre antes de reconcile_balance y muéstrale el resultado al usuario.',
      inputSchema: reconcileInput.omit({ note: true }),
      annotations: { readOnlyHint: true },
    },
    (input) =>
      run(async () => {
        const p = await previewReconciliation(env.DB, db, userId, input)
        const currency = (await getAccountsWithBalance(env.DB, userId)).find((a) => a.id === input.accountId)!.currency
        return {
          calculated: formatMoney(p.calculatedMinor, currency),
          real: formatMoney(p.balanceMinor, currency),
          unregisteredDifference: formatMoney(p.differenceMinor, currency),
          meaning: p.differenceMinor === 0 ? 'cuadra' : p.differenceMinor < 0 ? 'faltan gastos por registrar' : 'faltan ingresos por registrar',
        }
      }),
  )

  server.registerTool(
    'reconcile_balance',
    {
      title: 'Conciliar saldo',
      description:
        'Registra el saldo real de una cuenta al cierre de una fecha. Pasa a ser el ancla del saldo: no crea movimientos ni afecta las estadísticas. Úsala solo después de mostrar preview_reconciliation y que el usuario confirme.',
      inputSchema: reconcileInput,
    },
    (input) => run(() => reconcile(env.DB, db, userId, input)),
  )

  server.registerTool(
    'list_reconciliations',
    {
      title: 'Conciliaciones',
      description: 'Lista las conciliaciones de saldo (más recientes primero) con su diferencia sin registrar.',
      inputSchema: z.object({ accountId: z.number().int().positive().optional() }),
      annotations: { readOnlyHint: true },
    },
    ({ accountId }) => run(() => listReconciliations(env.DB, db, userId, accountId)),
  )

  server.registerTool(
    'delete_reconciliation',
    {
      title: 'Eliminar conciliación',
      description: 'Elimina una conciliación; el saldo vuelve a calcularse sin ella. Confirma con el usuario antes de usarla.',
      inputSchema: z.object({ id: z.number().int().positive() }),
      annotations: { destructiveHint: true },
    },
    ({ id }) => run(() => deleteReconciliation(env.DB, userId, id)),
  )

  server.registerTool(
    'list_imports',
    {
      title: 'Importaciones',
      description: 'Lista las importaciones de datos históricos (lotes) con su estado y cantidad de movimientos.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    () => run(() => listImports(env.DB, userId)),
  )

  server.registerTool(
    'revert_import',
    {
      title: 'Revertir importación',
      description:
        'Revierte una importación completa: elimina todos los movimientos de ese lote. Confirma con el usuario antes de usarla.',
      inputSchema: z.object({ id: z.number().int().positive() }),
      annotations: { destructiveHint: true },
    },
    ({ id }) => run(() => revertImport(env.DB, db, userId, id)),
  )

  server.registerTool(
    'create_account',
    {
      title: 'Crear cuenta',
      description:
        'Crea una cuenta (banco, efectivo, tarjeta de crédito, ahorro, inversión) en CLP o USD. Úsala solo después de que el usuario confirme.',
      inputSchema: accountInput,
    },
    (input) => run(() => createAccount(db, userId, input)),
  )

  server.registerTool(
    'update_account',
    {
      title: 'Editar o archivar cuenta',
      description:
        'Cambia nombre, tipo o saldo inicial de una cuenta, o la archiva (archived=true) para ocultarla sin perder su historial. La moneda no se puede cambiar. Úsala solo después de que el usuario confirme.',
      inputSchema: accountUpdateInput.extend({ id: z.number().int().positive() }),
    },
    ({ id, ...patch }) => run(() => updateAccount(db, userId, id, patch)),
  )

  server.registerTool(
    'delete_account',
    {
      title: 'Eliminar cuenta',
      description:
        'Elimina una cuenta sin movimientos. Si tiene movimientos falla: en ese caso propón archivarla con update_account. Confirma con el usuario antes de usarla.',
      inputSchema: z.object({ id: z.number().int().positive() }),
      annotations: { destructiveHint: true },
    },
    ({ id }) => run(() => deleteAccount(env.DB, db, userId, id)),
  )

  return server
}
