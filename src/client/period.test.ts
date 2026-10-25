import { describe, expect, it } from 'vitest'
import { parsePeriod, periodLabel, periodRange, shiftPeriod, totalsByYear } from './period'

const TODAY = '2026-10-25'

describe('período del dashboard', () => {
  it('por defecto es el mes actual; respeta vista, mes y año de la URL', () => {
    expect(parsePeriod({}, TODAY)).toEqual({ view: 'mes', month: '2026-10', year: '2026' })
    expect(parsePeriod({ vista: 'anio', anio: '2024' }, TODAY)).toEqual({ view: 'anio', month: '2026-10', year: '2024' })
    expect(parsePeriod({ vista: 'todo' }, TODAY)).toMatchObject({ view: 'todo' })
    expect(parsePeriod({ mes: '2025-03' }, TODAY)).toMatchObject({ view: 'mes', month: '2025-03' })
  })

  it('calcula el rango de fechas de cada vista', () => {
    expect(periodRange({ view: 'mes', month: '2024-02', year: '2024' })).toEqual({ from: '2024-02-01', to: '2024-02-29' })
    expect(periodRange({ view: 'anio', month: '2024-02', year: '2024' })).toEqual({ from: '2024-01-01', to: '2024-12-31' })
    expect(periodRange({ view: 'todo', month: '2024-02', year: '2024' })).toEqual({ from: '0001-01-01', to: '9999-12-31' })
  })

  it('etiqueta legible', () => {
    expect(periodLabel({ view: 'mes', month: '2026-10', year: '2026' })).toBe('octubre de 2026')
    expect(periodLabel({ view: 'anio', month: '2026-10', year: '2024' })).toBe('2024')
    expect(periodLabel({ view: 'todo', month: '2026-10', year: '2026' })).toBe('Todo el historial')
  })

  it('las flechas mueven un mes o un año, y en "todo" no aplican', () => {
    expect(shiftPeriod({ view: 'mes', month: '2026-01', year: '2026' }, -1)).toEqual({ vista: 'mes', mes: '2025-12' })
    expect(shiftPeriod({ view: 'anio', month: '2026-01', year: '2026' }, 1)).toEqual({ vista: 'anio', anio: '2027' })
    expect(shiftPeriod({ view: 'todo', month: '2026-01', year: '2026' }, 1)).toBeNull()
  })

  it('agrupa los totales mensuales por año para la vista "todo"', () => {
    expect(
      totalsByYear([
        { month: '2024-11', incomeClp: 100, expenseClp: 40 },
        { month: '2024-12', incomeClp: 50, expenseClp: 60 },
        { month: '2025-01', incomeClp: 10, expenseClp: 5 },
      ]),
    ).toEqual([
      { label: '2024', incomeClp: 150, expenseClp: 100 },
      { label: '2025', incomeClp: 10, expenseClp: 5 },
    ])
  })
})
