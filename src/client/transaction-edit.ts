import { fromMinor } from '../shared/money'
import type { Transaction } from '../shared/types'
import { parseAmountInput } from './reconcile-logic'

// Edición de un movimiento en el modo "Editar" de la lista (lógica pura, testeada).

export interface EditForm {
  date: string
  amount: string // escrito como en Chile: "42.108", "9,99"
  categoryId: string // '' = sin categoría
  description: string
}

export type TransactionPatch = Partial<{ date: string; amount: number; categoryId: number | null; description: string | null }>

export function editForm(t: Transaction): EditForm {
  const decimals = t.currency === 'USD' ? 2 : 0
  const amount = new Intl.NumberFormat('es-CL', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(
    fromMinor(t.amountMinor, t.currency),
  )
  return { date: t.date, amount, categoryId: t.categoryId ? String(t.categoryId) : '', description: t.description ?? '' }
}

/** Solo los campos que cambiaron, listos para PATCH /api/transactions/:id. */
export function transactionPatch(t: Transaction, form: EditForm): { ok: true; patch: TransactionPatch } | { ok: false; error: string } {
  const original = editForm(t)
  const patch: TransactionPatch = {}
  if (form.date !== original.date) patch.date = form.date
  if (form.amount !== original.amount) {
    const amount = parseAmountInput(form.amount, t.currency)
    if (amount === null) return { ok: false, error: 'Monto inválido' }
    if (amount <= 0) return { ok: false, error: 'El monto debe ser mayor que 0' }
    if (amount !== fromMinor(t.amountMinor, t.currency)) patch.amount = amount
  }
  if (form.categoryId !== original.categoryId) patch.categoryId = form.categoryId ? Number(form.categoryId) : null
  const description = form.description.trim() || null
  if (description !== (t.description ?? null)) patch.description = description
  return { ok: true, patch }
}
