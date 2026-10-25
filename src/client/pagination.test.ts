import { describe, expect, it } from 'vitest'
import { formatDate, PAGE_SIZES, pageInfo } from './pagination'

describe('paginador de movimientos', () => {
  it('ofrece 10, 25, 50 y 100 por página (máximo 100)', () => {
    expect(PAGE_SIZES).toEqual([10, 25, 50, 100])
  })

  it('describe el rango visible y si hay página anterior o siguiente', () => {
    expect(pageInfo(1551, 0, 25)).toEqual({ from: 1, to: 25, pages: 63, hasPrev: false, hasNext: true })
    expect(pageInfo(1551, 62, 25)).toEqual({ from: 1551, to: 1551, pages: 63, hasPrev: true, hasNext: false })
    expect(pageInfo(30, 1, 10)).toEqual({ from: 11, to: 20, pages: 3, hasPrev: true, hasNext: true })
  })

  it('sin movimientos no hay páginas', () => {
    expect(pageInfo(0, 0, 25)).toEqual({ from: 0, to: 0, pages: 0, hasPrev: false, hasNext: false })
  })
})

describe('fecha con año', () => {
  it('formatea YYYY-MM-DD como DD-MM-YYYY', () => {
    expect(formatDate('2025-11-01')).toBe('01-11-2025')
  })
})
