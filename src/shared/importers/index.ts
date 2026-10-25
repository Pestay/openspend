import { spendee } from './spendee'
import type { ImportAdapter } from './types'

// Orígenes soportados. Para agregar uno: un adaptador nuevo y su subcarpeta en imports/.
export const ADAPTERS: Record<string, ImportAdapter> = { [spendee.id]: spendee }

export type { ImportAdapter, ImportedTransaction, ImportFile } from './types'
