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
  balanceMinor: number
  transactionCount: number
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
