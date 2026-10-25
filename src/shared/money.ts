export const CURRENCIES = ['CLP', 'USD'] as const
export type Currency = (typeof CURRENCIES)[number]

// Montos se guardan como enteros en la unidad mínima de cada moneda
// (CLP no tiene decimales, USD se guarda en centavos) para evitar errores de punto flotante.
const DECIMALS: Record<Currency, number> = { CLP: 0, USD: 2 }

export function toMinor(amount: number, currency: Currency): number {
  return Math.round(amount * 10 ** DECIMALS[currency])
}

export function fromMinor(minor: number, currency: Currency): number {
  return minor / 10 ** DECIMALS[currency]
}

export function formatMoney(minor: number, currency: Currency): string {
  return new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency,
    minimumFractionDigits: DECIMALS[currency],
    maximumFractionDigits: DECIMALS[currency],
  }).format(fromMinor(minor, currency))
}
