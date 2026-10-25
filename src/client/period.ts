import { monthLabel, monthRange, shiftMonth } from './dates'

// Período que muestra el dashboard: un mes, un año o todo el historial (vive en la URL).

export type View = 'mes' | 'anio' | 'todo'

export interface Period {
  view: View
  month: string // YYYY-MM (vista mes)
  year: string // YYYY (vista año)
}

export interface PeriodSearch {
  vista?: View
  mes?: string
  anio?: string
}

export function parsePeriod(search: PeriodSearch, today: string): Period {
  return {
    view: search.vista ?? 'mes',
    month: search.mes ?? today.slice(0, 7),
    year: search.anio ?? today.slice(0, 4),
  }
}

// Para "todo" basta un rango que cubra cualquier fecha posible.
export function periodRange(period: Period): { from: string; to: string } {
  if (period.view === 'mes') return monthRange(period.month)
  if (period.view === 'anio') return { from: `${period.year}-01-01`, to: `${period.year}-12-31` }
  return { from: '0001-01-01', to: '9999-12-31' }
}

export function periodLabel(period: Period): string {
  if (period.view === 'mes') return monthLabel(period.month)
  if (period.view === 'anio') return period.year
  return 'Todo el historial'
}

/** Parámetros de URL al mover el período con las flechas; null si la vista no tiene flechas. */
export function shiftPeriod(period: Period, delta: number): PeriodSearch | null {
  if (period.view === 'mes') return { vista: 'mes', mes: shiftMonth(period.month, delta) }
  if (period.view === 'anio') return { vista: 'anio', anio: String(Number(period.year) + delta) }
  return null
}

export interface Bar {
  label: string
  incomeClp: number
  expenseClp: number
}

/** Agrupa los totales mensuales por año (evolución de la vista "todo"). */
export function totalsByYear(byMonth: { month: string; incomeClp: number; expenseClp: number }[]): Bar[] {
  const years = new Map<string, Bar>()
  for (const m of byMonth) {
    const label = m.month.slice(0, 4)
    const bar = years.get(label) ?? { label, incomeClp: 0, expenseClp: 0 }
    bar.incomeClp += m.incomeClp
    bar.expenseClp += m.expenseClp
    years.set(label, bar)
  }
  return [...years.values()].sort((a, b) => a.label.localeCompare(b.label))
}
