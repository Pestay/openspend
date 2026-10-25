import { describe, expect, it } from 'vitest'
import type { ImportedTransaction } from '../shared/importers/types'
import { buildImportPayload, chunk } from './import-rows'

const row = (over: Partial<ImportedTransaction>): ImportedTransaction => ({
  date: '2025-03-05',
  kind: 'expense',
  amount: 1000,
  currency: 'CLP',
  description: null,
  labels: [],
  sourceWallet: 'Cash Wallet',
  sourceCategory: 'Gaming',
  ...over,
})

describe('preparar las filas a enviar', () => {
  it('divide en tandas del tamaño indicado', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(chunk([], 500)).toEqual([])
  })

  it('separa movimientos y ajustes, aplica los mapeos y las etiquetas', () => {
    const start = { accounts: { 'Cash Wallet': 7 }, categories: { 'expense|Gaming': 3 }, reconcileKeys: ['expense|Ajuste'] }
    const payload = buildImportPayload(
      [
        row({ description: 'Juego', labels: ['steam deck'] }),
        row({ sourceCategory: 'Ajuste', amount: 500 }),
        row({ kind: 'income', sourceCategory: 'Ajuste', amount: 200 }),
      ],
      start,
      'append',
    )
    expect(payload.transactions).toEqual([
      { date: '2025-03-05', kind: 'expense', amount: 1000, currency: 'CLP', accountId: 7, categoryId: 3, description: 'Juego #steam-deck', source: 'app_import' },
    ])
    // El ajuste de gasto resta y el de ingreso (otra categoría "income|Ajuste" no marcada) se importa normal.
    expect(payload.adjustments).toEqual([{ accountId: 7, date: '2025-03-05', deltaMinor: -500 }])
    expect(payload.transactions).toHaveLength(1)
    expect(payload.unmatched).toBe(1)
  })
})
