import type { Currency } from '../money'

export interface ImportFile {
  name: string
  content: string
}

/** Movimiento normalizado, independiente del origen. */
export interface ImportedTransaction {
  date: string // YYYY-MM-DD en hora de Chile
  kind: 'expense' | 'income'
  amount: number // positivo, en unidades normales
  currency: Currency
  description: string | null // la nota original
  labels: string[] // etiquetas del origen; el usuario decide si se agregan a la descripción
  sourceWallet: string
  sourceCategory: string
}

/**
 * Cómo se relaciona una categoría del origen con OpenSpend. Las estrategias del importador
 * ("híbrido", "solo tus categorías", "copiar tal cual") eligen entre estas opciones.
 */
export interface CategoryHint {
  standard?: string // categoría por defecto de OpenSpend equivalente (se busca por nombre)
  create?: { name: string; icon?: string } // nombre sugerido si se crea como nueva
  closest: string // categoría por defecto más cercana, para "solo tus categorías"
}

/**
 * Un adaptador convierte los archivos de un origen (otra app, un banco…) en movimientos
 * normalizados. Vive en el servidor para que la misma lógica sirva al subir desde el
 * dashboard y, a futuro, para archivos en R2 o Drive.
 */
export interface ImportAdapter {
  id: string
  label: string
  accept: string // extensiones para el selector de archivos
  parse(files: ImportFile[]): { transactions: ImportedTransaction[]; warnings: string[] }
  categoryHint(sourceCategory: string, kind: 'expense' | 'income'): CategoryHint
}
