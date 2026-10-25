import { describe, expect, it } from 'vitest'
import type { Transaction } from '../shared/types'
import { editForm, transactionPatch } from './transaction-edit'

const tx: Transaction = {
  id: 7,
  date: '2025-10-18',
  kind: 'expense',
  amountMinor: 42108,
  currency: 'CLP',
  fxRate: 1,
  amountClp: 42108,
  accountId: 1,
  toAccountId: null,
  categoryId: 3,
  description: 'Uber',
  merchant: null,
  source: 'app_import',
  importBatchId: 1,
  possibleDuplicateOf: null,
  createdAt: '2026-10-25T00:00:00Z',
}

describe('editar un movimiento', () => {
  it('el formulario parte con los valores actuales, con el monto escrito como en Chile', () => {
    expect(editForm(tx)).toEqual({ date: '2025-10-18', amount: '42.108', categoryId: '3', accountId: '1', description: 'Uber' })
  })

  it('sin cambios no envía nada', () => {
    expect(transactionPatch(tx, editForm(tx))).toEqual({ ok: true, patch: {} })
  })

  it('envía solo los campos modificados', () => {
    const form = { ...editForm(tx), amount: '45.000', categoryId: '', description: '  Taxi  ' }
    expect(transactionPatch(tx, form)).toEqual({ ok: true, patch: { amount: 45000, categoryId: null, description: 'Taxi' } })
  })

  it('una descripción vacía se guarda como null', () => {
    expect(transactionPatch(tx, { ...editForm(tx), description: ' ' })).toEqual({ ok: true, patch: { description: null } })
  })

  it('rechaza montos inválidos o no positivos', () => {
    expect(transactionPatch(tx, { ...editForm(tx), amount: 'mil' })).toEqual({ ok: false, error: 'Monto inválido' })
    expect(transactionPatch(tx, { ...editForm(tx), amount: '0' })).toEqual({ ok: false, error: 'El monto debe ser mayor que 0' })
  })

  it('permite cambiar la cuenta', () => {
    expect(transactionPatch(tx, { ...editForm(tx), accountId: '4' })).toEqual({ ok: true, patch: { accountId: 4 } })
  })
})
