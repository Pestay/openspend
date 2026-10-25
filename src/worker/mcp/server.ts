import { McpServer, type CallToolResult } from '@modelcontextprotocol/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { accounts, categories } from '../../../db/schema'
import { formatMoney, toMinor } from '../../shared/money'
import {
  accountInput,
  createTransactionsInput,
  listTransactionsQuery,
  summaryQuery,
  updateTransactionInput,
} from '../../shared/schemas'
import type { Transaction } from '../../shared/types'
import { getDb, todayInChile } from '../db'
import { AppError } from '../errors'
import { getUsdClpRates } from '../services/fx'
import { getAccountsWithBalance, getSummary } from '../services/summary'
import { createTransactions, deleteTransaction, listTransactions, updateTransaction } from '../services/transactions'

const INSTRUCTIONS = `OpenSpend: registro de gastos e ingresos personales (Chile, montos en CLP y USD).

Flujo recomendado:
1. Llama a get_context al inicio para conocer la fecha de hoy, las cuentas y las categorías (con sus IDs).
2. Cuando el usuario cuente gastos o ingresos en texto libre o en una foto de boleta, extrae cada movimiento y regístralos juntos con add_transactions.
   - Sin fecha → hoy (según get_context). "ayer", "el lunes" → calcula la fecha.
   - Sin moneda → CLP. "lucas" = miles de pesos (8 lucas = 8000).
   - Sin cuenta → se usa la cuenta principal.
   - Elige la categoría más adecuada. Si dudas, busca movimientos parecidos con search_transactions (campo q) y usa la categoría que se usó antes.
3. Después de registrar, muestra un resumen breve (fecha, descripción, monto, categoría) para que el usuario confirme.
4. Si add_transactions reporta duplicados, pregunta al usuario antes de borrar o volver a insertar.
5. Para correcciones ("el uber era trabajo") usa search_transactions y luego update_transaction.

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
      description: 'Fecha de hoy en Chile, cuentas con saldo y categorías disponibles (con IDs). Llamar al inicio.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    () =>
      run(async () => ({
        today: todayInChile(),
        accounts: (await getAccountsWithBalance(env.DB, userId))
          .filter((a) => !a.archived)
          .map((a) => ({ id: a.id, name: a.name, type: a.type, currency: a.currency, balance: formatMoney(a.balanceMinor, a.currency) })),
        categories: await db
          .select({ id: categories.id, name: categories.name, kind: categories.kind })
          .from(categories)
          .where(eq(categories.userId, userId)),
      })),
  )

  server.registerTool(
    'add_transactions',
    {
      title: 'Registrar movimientos',
      description:
        'Registra uno o más gastos, ingresos o transferencias. Detecta posibles duplicados (mismo monto, moneda, tipo y cuenta, ±2 días). Con skipDuplicates=true no inserta los duplicados, solo los reporta.',
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
        'Modifica campos de un movimiento existente. Si cambia monto, moneda o fecha se recalcula la conversión a CLP. Usa possibleDuplicateOf=null para marcar que no es duplicado.',
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
      description: 'Crea una categoría nueva. Pregunta al usuario antes de crearla.',
      inputSchema: z.object({
        name: z.string().trim().min(1).max(100),
        kind: z.enum(['expense', 'income']),
        icon: z.string().max(8).optional(),
      }),
    },
    (input) => run(async () => (await db.insert(categories).values({ ...input, userId }).returning())[0]),
  )

  server.registerTool(
    'create_account',
    {
      title: 'Crear cuenta',
      description: 'Crea una cuenta (banco, efectivo, tarjeta de crédito, ahorro, inversión) en CLP o USD.',
      inputSchema: accountInput,
    },
    ({ initialBalance, ...data }) =>
      run(async () => {
        const [account] = await db
          .insert(accounts)
          .values({ ...data, userId, initialBalanceMinor: toMinor(initialBalance, data.currency) })
          .returning()
        return account
      }),
  )

  return server
}
