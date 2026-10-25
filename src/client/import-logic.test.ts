import { describe, expect, it } from 'vitest'
import type { Category, ImportPreview } from '../shared/types'
import {
  accountChoices,
  decodeTarget,
  encodeTarget,
  importBlockReason,
  mergePlan,
  newAccountNameError,
  newCategoryNames,
  stepNumbers,
} from './import-logic'

const category = (id: number, name: string, kind: 'expense' | 'income', transactionCount: number): Category => ({
  id,
  name,
  kind,
  icon: null,
  color: null,
  transactionCount,
})

const previewCategories: ImportPreview['categories'] = [
  { key: 'expense|Gaming', sourceName: 'Gaming', kind: 'expense', count: 3, adjustment: false, suggestedAdjustment: false, target: { type: 'create', name: 'Gaming' } },
  { key: 'expense|Juegos', sourceName: 'Juegos', kind: 'expense', count: 1, adjustment: false, suggestedAdjustment: false, target: { type: 'create', name: 'Gaming' } },
  { key: 'expense|Food', sourceName: 'Food', kind: 'expense', count: 5, adjustment: false, suggestedAdjustment: false, target: { type: 'existing', categoryId: 1, name: 'Comida' } },
  { key: 'income|Bonos', sourceName: 'Bonos', kind: 'income', count: 2, adjustment: false, suggestedAdjustment: false, target: { type: 'create', name: 'Bonos' } },
]

describe('selector de destino de categoría', () => {
  it('codifica y decodifica destinos existentes y nuevos (ida y vuelta)', () => {
    expect(decodeTarget(encodeTarget({ type: 'existing', categoryId: 7, name: 'Salud' }))).toEqual({ type: 'existing', categoryId: 7 })
    expect(decodeTarget(encodeTarget({ type: 'create', name: 'Auto: repuestos' }))).toEqual({ type: 'create', name: 'Auto: repuestos' })
  })

  it('las filas marcadas como conciliación no aportan categorías nuevas', () => {
    const plan: ImportPreview['categories'] = [
      { key: 'expense|Ajuste', sourceName: 'Ajuste', kind: 'expense', count: 1, adjustment: true, suggestedAdjustment: true, target: { type: 'create', name: 'Ajuste' } },
      { key: 'expense|Gaming', sourceName: 'Gaming', kind: 'expense', count: 1, adjustment: false, suggestedAdjustment: false, target: { type: 'create', name: 'Gaming' } },
    ]
    expect(newCategoryNames(plan, 'expense')).toEqual(['Gaming'])
  })

  it('"crear otra" se reconoce como pedido de nombre nuevo', () => {
    expect(decodeTarget('new')).toBe('new')
  })

  it('lista las categorías nuevas del plan por tipo, sin repetir (combinadas cuentan una vez)', () => {
    expect(newCategoryNames(previewCategories, 'expense')).toEqual(['Gaming'])
    expect(newCategoryNames(previewCategories, 'income')).toEqual(['Bonos'])
  })
})

describe('numeración de pasos', () => {
  it('numera de corrido y omite las preguntas que no aplican', () => {
    expect(stepNumbers({ labeledCount: 0, duplicateCount: 0 })).toEqual({ file: 1, account: 2, categories: 3, review: 4 })
    expect(stepNumbers({ labeledCount: 1, duplicateCount: 1 })).toEqual({
      file: 1,
      account: 2,
      categories: 3,
      labels: 4,
      duplicates: 5,
      review: 6,
    })
  })
})

describe('plan para combinar categorías', () => {
  const cats = [category(1, 'Entretenimiento', 'expense', 4), category(2, 'Gaming', 'expense', 3), category(3, 'Streaming', 'expense', 2), category(9, 'Sueldo', 'income', 12)]

  it('suma los movimientos que se moverán y nombra las categorías que se eliminan', () => {
    expect(mergePlan(cats, [2, 3], 1)).toEqual({ ok: true, moved: 5, removed: ['Gaming', 'Streaming'], target: 'Entretenimiento' })
  })

  it('ignora el destino si también está entre las de origen', () => {
    expect(mergePlan(cats, [1, 2], 1)).toMatchObject({ ok: true, moved: 3, removed: ['Gaming'] })
  })

  it('exige al menos una categoría de origen y un destino', () => {
    expect(mergePlan(cats, [], 1)).toMatchObject({ ok: false })
    expect(mergePlan(cats, [2], null)).toMatchObject({ ok: false })
  })

  it('rechaza combinar gastos con ingresos', () => {
    expect(mergePlan(cats, [9], 1)).toEqual({ ok: false, error: '"Sueldo" es de ingreso y "Entretenimiento" de gasto: no se pueden combinar' })
  })
})

describe('opciones de cuenta para una billetera', () => {
  const account = (id: number, name: string, archived = false) =>
    ({ id, name, archived, type: 'bank', currency: 'CLP', initialBalanceMinor: 0, balanceMinor: 0, transactionCount: 0 }) as const

  it('pone primero la cuenta por defecto (la primera activa), luego las demás activas, sin archivadas', () => {
    const choices = accountChoices([account(5, 'Vieja', true), account(2, 'Principal'), account(7, 'Tarjeta')])
    expect(choices).toEqual([
      { id: 2, name: 'Principal', isDefault: true },
      { id: 7, name: 'Tarjeta', isDefault: false },
    ])
  })

  it('valida el nombre de una cuenta nueva', () => {
    const accounts = [account(2, 'Principal')]
    expect(newAccountNameError('  ', accounts)).toBe('Escribe un nombre para la cuenta')
    expect(newAccountNameError('principal ', accounts)).toBe('Ya existe una cuenta llamada "Principal"')
    expect(newAccountNameError('Cash Wallet', accounts)).toBeNull()
  })
})

describe('cuándo se puede confirmar la importación', () => {
  it('bloquea si hay una cuenta nueva con nombre inválido o si no queda nada por importar', () => {
    expect(importBlockReason(10, [])).toBeNull()
    expect(importBlockReason(10, ['Cash Wallet'])).toBe('Revisa el nombre de la cuenta nueva para “Cash Wallet”')
    expect(importBlockReason(0, [])).toBe('No hay movimientos para importar')
  })
})
