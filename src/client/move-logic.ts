import type { Currency } from '../shared/money'
import { formatDate } from './pagination'

// Mover movimientos a otra cuenta: textos y validaciones de la vista previa (lógica pura, testeada).

export const MOVE_LIMIT = 500

export interface AccountEffect {
  accountId: number
  name: string
  currency: Currency
  beforeMinor: number
  afterMinor: number
  lastReconciliationDate: string | null
  anchoredCount: number
}

export interface MoveResult {
  moved: number
  alreadyThere: number
  accounts: AccountEffect[]
}

/** Aviso cuando parte de lo movido es anterior a la última conciliación de la cuenta. */
export function effectNote(effect: AccountEffect): string | null {
  if (!effect.lastReconciliationDate || effect.anchoredCount === 0) return null
  const n = effect.anchoredCount
  const date = formatDate(effect.lastReconciliationDate)
  return n === 1
    ? `1 movimiento es anterior a su conciliación del ${date}: no cambia su saldo actual, solo la diferencia de esa conciliación.`
    : `${n} movimientos son anteriores a su conciliación del ${date}: no cambian su saldo actual, solo la diferencia de esa conciliación.`
}

export function moveBlockReason(selected: number, accountId: string): string | null {
  if (selected === 0) return 'Selecciona movimientos'
  if (!accountId) return 'Elige la cuenta destino'
  if (selected > MOVE_LIMIT) return `Puedes mover hasta ${MOVE_LIMIT} movimientos a la vez`
  return null
}
