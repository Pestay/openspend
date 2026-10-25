import { formatMoney, type Currency } from '../shared/money'

// Lógica pura de la pantalla de conciliar (testeada sin navegador).

/**
 * Lee un monto escrito como en Chile: punto de miles y coma decimal ("1.234.567", "9,99",
 * "$ 50.000"). CLP no admite decimales. Devuelve null si no es un monto válido.
 */
export function parseAmountInput(input: string, currency: Currency): number | null {
  const cleaned = input.replace(/[\s$]/g, '')
  if (!/^-?[\d.]+(,\d+)?$/.test(cleaned)) return null
  const [integer, decimals] = cleaned.replace(/\./g, '').split(',')
  if (currency === 'CLP' && decimals !== undefined) return null
  const value = Number(decimals === undefined ? integer : `${integer}.${decimals}`)
  return Number.isFinite(value) ? value : null
}

/** Explica la diferencia entre el saldo real y el calculado (real − calculado). */
export function differenceLabel(differenceMinor: number, currency: Currency): { tone: 'ok' | 'warn'; text: string } {
  if (differenceMinor === 0) return { tone: 'ok', text: 'Cuadra con tus registros' }
  const amount = formatMoney(Math.abs(differenceMinor), currency)
  return differenceMinor < 0
    ? { tone: 'warn', text: `Te faltan registrar ${amount} en gastos` }
    : { tone: 'warn', text: `Te faltan registrar ${amount} en ingresos` }
}
