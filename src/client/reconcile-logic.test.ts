import { describe, expect, it } from 'vitest'
import { differenceLabel, parseAmountInput } from './reconcile-logic'

describe('leer montos como se escriben en Chile', () => {
  it('CLP: puntos de miles, sin decimales', () => {
    expect(parseAmountInput('1.234.567', 'CLP')).toBe(1234567)
    expect(parseAmountInput(' $ 50.000 ', 'CLP')).toBe(50000)
    expect(parseAmountInput('-2.500', 'CLP')).toBe(-2500)
  })

  it('USD: coma decimal, con o sin miles', () => {
    expect(parseAmountInput('9,99', 'USD')).toBe(9.99)
    expect(parseAmountInput('1.234,56', 'USD')).toBe(1234.56)
    expect(parseAmountInput('20', 'USD')).toBe(20)
  })

  it('devuelve null si no es un monto válido', () => {
    expect(parseAmountInput('', 'CLP')).toBeNull()
    expect(parseAmountInput('mil', 'CLP')).toBeNull()
    expect(parseAmountInput('1,5', 'CLP')).toBeNull() // CLP no tiene decimales
  })
})

describe('explicar la diferencia de una conciliación', () => {
  it('negativa = gastos sin registrar; positiva = ingresos sin registrar; cero = cuadra', () => {
    expect(differenceLabel(0, 'CLP')).toEqual({ tone: 'ok', text: 'Cuadra con tus registros' })
    expect(differenceLabel(-12300, 'CLP')).toEqual({ tone: 'warn', text: 'Te faltan registrar $12.300 en gastos' })
    expect(differenceLabel(5000, 'CLP')).toEqual({ tone: 'warn', text: 'Te faltan registrar $5.000 en ingresos' })
  })
})
