// Tipos de respuesta de la API, compartidos entre el Worker y el front.
import type { Currency } from './money'

export type TransactionKind = 'expense' | 'income' | 'transfer'

export interface Account {
  id: number
  name: string
  type: string
  currency: Currency
  initialBalanceMinor: number
  archived: boolean
}

export interface AccountWithBalance extends Account {
  balanceMinor: number // anclado a la última conciliación, si existe
  transactionCount: number
  lastReconciliation: { date: string; balanceMinor: number; differenceMinor: number } | null
}

// Conciliación: saldo real de una cuenta al cierre de una fecha. `differenceMinor` es lo
// real menos lo que calculaba OpenSpend (negativo = gastos sin registrar).
export interface Reconciliation {
  id: number
  accountId: number
  date: string
  balanceMinor: number
  differenceMinor: number
  note: string | null
}

export interface Category {
  id: number
  name: string
  kind: 'expense' | 'income'
  icon: string | null
  color: string | null
  transactionCount: number
}

export interface Transaction {
  id: number
  date: string
  kind: TransactionKind
  amountMinor: number
  currency: Currency
  fxRate: number
  amountClp: number
  accountId: number
  toAccountId: number | null
  categoryId: number | null
  description: string | null
  merchant: string | null
  source: string
  importBatchId: number | null
  possibleDuplicateOf: number | null
  createdAt: string
}

export interface CreateTransactionsResult {
  inserted: Transaction[]
  // Transacciones que coinciden con otras ya registradas (mismo monto y cuenta, ±2 días).
  duplicates: { input: unknown; matches: Transaction[]; inserted: boolean }[]
}

export interface Summary {
  from: string
  to: string
  incomeClp: number
  expenseClp: number
  netClp: number
  byCategory: { categoryId: number | null; name: string; kind: 'expense' | 'income'; totalClp: number; count: number }[]
  byMonth: { month: string; incomeClp: number; expenseClp: number }[]
}

// Un asistente (cliente MCP) al que el usuario dio acceso vía OAuth.
export interface Connection {
  id: string
  clientName: string
  redirectHost: string | null
  connectedAt: string
}

// --- Importación ---

export type ImportCategoryTarget =
  | { type: 'existing'; categoryId: number; name: string }
  | { type: 'create'; name: string; icon?: string }

export interface ImportPreview {
  adapter: string
  warnings: string[]
  summary: {
    total: number
    toImport: number
    expenses: number
    incomes: number
    from: string | null
    to: string | null
    byYear: { year: string; count: number }[]
    expenseClp: number
    incomeClp: number
  }
  wallets: { name: string; count: number; target: { type: 'existing'; accountId: number; name: string } | { type: 'create'; name: string; accountType: string } }[]
  // adjustment = marcada como conciliación (sus movimientos no se importan como gastos/ingresos);
  // target se conserva para que desmarcarla no pierda la categoría elegida.
  // suggestedAdjustment = el nombre parece un ajuste de saldo (solo una sugerencia).
  categories: {
    key: string
    sourceName: string
    kind: 'expense' | 'income'
    count: number
    adjustment: boolean
    suggestedAdjustment: boolean
    target: ImportCategoryTarget
  }[]
  labeledCount: number
  adjustmentCount: number
  duplicateCount: number
}

export interface ImportResult {
  batchId: number
  inserted: number
  skippedDuplicates: number
  markedDuplicates: number
  reconciliations: number
  createdAccounts: string[]
  createdCategories: string[]
}

export interface ImportBatch {
  id: number
  source: string
  label: string
  status: 'importing' | 'active' | 'reverted'
  createdAt: string
  transactionCount: number
}
