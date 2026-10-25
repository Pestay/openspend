import { z } from 'zod'
import { CURRENCIES } from './money'

z.config(z.locales.es())

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha en formato YYYY-MM-DD')

export const TRANSACTION_KINDS = ['expense', 'income', 'transfer'] as const
export const ACCOUNT_TYPES = ['cash', 'bank', 'credit_card', 'savings', 'investment'] as const
export const TRANSACTION_SOURCES = ['manual', 'chat', 'app_import', 'statement'] as const

// Entrada de una transacción: el monto viene en unidades "humanas" (12990, 9.99)
// y la API lo convierte a unidad mínima.
export const transactionInput = z
  .object({
    date: isoDate,
    kind: z.enum(TRANSACTION_KINDS).default('expense'),
    amount: z.number().positive(),
    currency: z.enum(CURRENCIES).default('CLP'),
    accountId: z.number().int().positive().optional(),
    toAccountId: z.number().int().positive().optional(),
    categoryId: z.number().int().positive().optional(),
    description: z.string().trim().max(500).optional(),
    merchant: z.string().trim().max(200).optional(),
    source: z.enum(TRANSACTION_SOURCES).default('manual'),
  })
  .refine((t) => t.kind !== 'transfer' || t.toAccountId, {
    message: 'Una transferencia requiere toAccountId',
    path: ['toAccountId'],
  })
export type TransactionInput = z.input<typeof transactionInput>

export const createTransactionsInput = z.object({
  transactions: z.array(transactionInput).min(1).max(500),
  // Si es true, los posibles duplicados no se insertan y solo se reportan.
  skipDuplicates: z.boolean().default(false),
  importBatchId: z.number().int().positive().optional(),
})

export const updateTransactionInput = z
  .object({
    date: isoDate,
    kind: z.enum(TRANSACTION_KINDS),
    amount: z.number().positive(),
    currency: z.enum(CURRENCIES),
    accountId: z.number().int().positive(),
    toAccountId: z.number().int().positive().nullable(),
    categoryId: z.number().int().positive().nullable(),
    description: z.string().trim().max(500).nullable(),
    merchant: z.string().trim().max(200).nullable(),
    possibleDuplicateOf: z.null(),
  })
  .partial()

export const listTransactionsQuery = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  accountId: z.coerce.number().int().positive().optional(),
  categoryId: z.coerce.number().int().positive().optional(),
  kind: z.enum(TRANSACTION_KINDS).optional(),
  q: z.string().trim().optional(),
  onlyPossibleDuplicates: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(200),
  offset: z.coerce.number().int().min(0).default(0),
})

export const summaryQuery = z.object({
  from: isoDate,
  to: isoDate,
})

export const accountInput = z.object({
  name: z.string().trim().min(1).max(100),
  type: z.enum(ACCOUNT_TYPES).default('bank'),
  currency: z.enum(CURRENCIES).default('CLP'),
  initialBalance: z.number().default(0),
})

export const accountUpdateInput = z
  .object({
    name: z.string().trim().min(1).max(100),
    type: z.enum(ACCOUNT_TYPES),
    initialBalance: z.number(),
    archived: z.boolean(),
  })
  .partial()

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Color en formato #RRGGBB')

export const categoryInput = z.object({
  name: z.string().trim().min(1).max(100),
  kind: z.enum(['expense', 'income']),
  icon: z.string().trim().max(8).optional(),
  color: hexColor.optional(),
})

// El tipo (gasto/ingreso) no se cambia: los movimientos ya clasificados dependen de él.
export const categoryUpdateInput = z
  .object({
    name: z.string().trim().min(1).max(100),
    icon: z.string().trim().max(8).nullable(),
    color: hexColor.nullable(),
  })
  .partial()

// Al eliminar una categoría con movimientos hay que decir qué hacer con ellos:
// moverlos a otra categoría del mismo tipo (fusionar) o dejarlos sin categoría (null).
export const deleteCategoryInput = z.object({
  reassignTo: z.preprocess((v) => (v === 'null' ? null : v), z.coerce.number().int().positive().nullable().optional()),
})
