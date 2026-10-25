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

// Mover movimientos a otra cuenta; dryRun solo calcula el efecto en los saldos.
export const moveTransactionsInput = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(500),
  accountId: z.number().int().positive(),
  dryRun: z.boolean().default(false),
})

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

// --- Importación de datos históricos (las mismas decisiones que pregunta el asistente) ---

const accountTarget = z.discriminatedUnion('type', [
  z.object({ type: z.literal('existing'), accountId: z.number().int().positive() }),
  z.object({ type: z.literal('create'), name: z.string().trim().min(1).max(100), accountType: z.enum(ACCOUNT_TYPES) }),
])

const categoryTarget = z.discriminatedUnion('type', [
  z.object({ type: z.literal('existing'), categoryId: z.number().int().positive() }),
  z.object({ type: z.literal('create'), name: z.string().trim().min(1).max(100) }),
])

export const importOptions = z.object({
  // Billetera del origen → cuenta de OpenSpend. Sin indicar: la cuenta principal.
  accounts: z.record(z.string(), accountTarget).default({}),
  // hybrid: estándar a tus categorías y personalizadas como nuevas · existing: solo tus
  // categorías · copy: copia las del origen tal cual.
  categoryStrategy: z.enum(['hybrid', 'existing', 'copy']).default('hybrid'),
  // Ajustes manuales por categoría del origen, clave "kind|nombre".
  categoryOverrides: z.record(z.string(), categoryTarget).default({}),
  // Checkbox "Marcar como conciliación" por categoría del origen ("kind|nombre"): sus
  // movimientos son ajustes de saldo y se convierten en conciliaciones. Nada viene marcado.
  reconcileCategories: z.record(z.string(), z.boolean()).default({}),
  labels: z.enum(['append', 'discard']).default('append'),
  duplicates: z.enum(['skip', 'mark']).default('skip'),
})

// Movimiento ya normalizado por el adaptador (el archivo se procesa en el navegador).
const importedRow = z.object({
  date: isoDate,
  kind: z.enum(['expense', 'income']),
  amount: z.number().positive(),
  currency: z.enum(CURRENCIES),
  description: z.string().max(2000).nullable(),
  labels: z.array(z.string().max(100)).max(50),
  sourceWallet: z.string().max(200),
  sourceCategory: z.string().max(200),
})

// Vista previa: todos los movimientos normalizados (sin escribir nada).
export const importRequest = z.object({
  adapter: z.string().min(1).max(50),
  fileNames: z.array(z.string().max(200)).min(1).max(20),
  rows: z.array(importedRow).min(1).max(20_000),
  options: importOptions.prefault({}),
})

// Inicio de la importación: solo las categorías y billeteras distintas, no los movimientos.
export const startImportRequest = z.object({
  adapter: z.string().min(1).max(50),
  fileNames: z.array(z.string().max(200)).min(1).max(20),
  categories: z.array(z.object({ kind: z.enum(['expense', 'income']), sourceCategory: z.string().max(200) })).min(1).max(1000),
  wallets: z.array(z.string().max(200)).min(1).max(100),
  options: importOptions.prefault({}),
})

// Una tanda de movimientos (con cuenta y categoría ya mapeadas) para un lote en curso.
export const appendImportRowsRequest = z.object({
  transactions: z.array(transactionInput).min(1).max(500),
  skipDuplicates: z.boolean().default(true),
})

export const finishImportRequest = z.object({
  adjustments: z.array(z.object({ accountId: z.number().int().positive(), date: isoDate, deltaMinor: z.number().int() })).max(20_000),
})

export const mergeCategoriesInput = z.object({
  sourceIds: z.array(z.number().int().positive()).min(1).max(100),
  targetId: z.number().int().positive(),
})

export const reconcileInput = z.object({
  accountId: z.number().int().positive(),
  date: isoDate,
  balance: z.number().finite(), // saldo real, en unidades normales y en la moneda de la cuenta
  note: z.string().trim().max(300).optional(),
})

export const listReconciliationsQuery = z.object({
  accountId: z.coerce.number().int().positive().optional(),
})
