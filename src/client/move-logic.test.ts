import { describe, expect, it } from 'vitest'
import { effectNote, moveBlockReason, MOVE_LIMIT } from './move-logic'

const effect = { accountId: 1, name: 'Principal', currency: 'CLP' as const, beforeMinor: 75_000, afterMinor: 80_000, lastReconciliationDate: null, anchoredCount: 0 }

describe('mover movimientos: vista previa', () => {
  it('sin conciliación no hay nota', () => {
    expect(effectNote(effect)).toBeNull()
  })

  it('explica cuando movimientos anteriores a la conciliación no cambian el saldo actual', () => {
    expect(effectNote({ ...effect, lastReconciliationDate: '2026-01-31', anchoredCount: 1 })).toBe(
      '1 movimiento es anterior a su conciliación del 31-01-2026: no cambia su saldo actual, solo la diferencia de esa conciliación.',
    )
    expect(effectNote({ ...effect, lastReconciliationDate: '2026-01-31', anchoredCount: 3 })).toBe(
      '3 movimientos son anteriores a su conciliación del 31-01-2026: no cambian su saldo actual, solo la diferencia de esa conciliación.',
    )
  })

  it('no deja mover sin selección, sin cuenta o sobre el límite', () => {
    expect(moveBlockReason(0, '')).toBe('Selecciona movimientos')
    expect(moveBlockReason(2, '')).toBe('Elige la cuenta destino')
    expect(moveBlockReason(MOVE_LIMIT + 1, '3')).toBe(`Puedes mover hasta ${MOVE_LIMIT} movimientos a la vez`)
    expect(moveBlockReason(2, '3')).toBeNull()
  })
})
