import { toMinor } from '../money'
import type { ImportedTransaction } from './types'

// Arma lo que se envía al importar por tandas, a partir de los movimientos normalizados y de
// los mapeos que devuelve /imports/start. Se usa en el navegador y en el servidor.

export const IMPORT_CHUNK_SIZE = 500

export interface StartMappings {
  accounts: Record<string, number> // billetera del origen → cuenta
  categories: Record<string, number> // "kind|categoría del origen" → categoría
  reconcileKeys: string[] // categorías del origen marcadas como conciliación
}

export const categoryKey = (kind: 'expense' | 'income', sourceCategory: string) => `${kind}|${sourceCategory}`

export function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size))
  return chunks
}

export function describeImported(t: ImportedTransaction, labels: 'append' | 'discard'): string | undefined {
  const tags = labels === 'append' ? t.labels.map((l) => `#${l.replace(/\s+/g, '-')}`).join(' ') : ''
  return [t.description, tags].filter(Boolean).join(' ').slice(0, 500) || undefined
}

/**
 * Separa los movimientos de los ajustes (categorías marcadas como conciliación) y aplica los
 * mapeos. `unmatched` cuenta filas sin cuenta o categoría mapeada (no debería ocurrir; se
 * informa en vez de importarlas mal).
 */
export function buildImportPayload(rows: ImportedTransaction[], start: StartMappings, labels: 'append' | 'discard') {
  const reconcile = new Set(start.reconcileKeys)
  const transactions: {
    date: string
    kind: 'expense' | 'income'
    amount: number
    currency: ImportedTransaction['currency']
    accountId: number
    categoryId: number
    description: string | undefined
    source: 'app_import'
  }[] = []
  const adjustments: { accountId: number; date: string; deltaMinor: number }[] = []
  let unmatched = 0

  for (const t of rows) {
    const key = categoryKey(t.kind, t.sourceCategory)
    const accountId = start.accounts[t.sourceWallet]
    if (accountId === undefined) {
      unmatched++
      continue
    }
    if (reconcile.has(key)) {
      adjustments.push({ accountId, date: t.date, deltaMinor: (t.kind === 'income' ? 1 : -1) * toMinor(t.amount, t.currency) })
      continue
    }
    const categoryId = start.categories[key]
    if (categoryId === undefined) {
      unmatched++
      continue
    }
    transactions.push({
      date: t.date,
      kind: t.kind,
      amount: t.amount,
      currency: t.currency,
      accountId,
      categoryId,
      description: describeImported(t, labels),
      source: 'app_import',
    })
  }
  return { transactions, adjustments, unmatched }
}
