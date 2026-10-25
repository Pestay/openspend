import type { Category, ImportCategoryTarget, ImportPreview } from '../shared/types'

// Lógica pura de la página Importar y de "Combinar categorías" (testeada sin navegador).

export type CategoryOverride = { type: 'existing'; categoryId: number } | { type: 'create'; name: string }

/** Valor del <select> de destino de una categoría del origen. */
export function encodeTarget(target: ImportCategoryTarget): string {
  if (target.type === 'existing') return `existing:${target.categoryId}`
  return `create:${target.name}`
}

/** Inverso de encodeTarget; "new" significa que el usuario quiere escribir un nombre nuevo. */
export function decodeTarget(value: string): CategoryOverride | 'new' {
  if (value === 'new') return 'new'
  const [type, ...rest] = value.split(':')
  const payload = rest.join(':') // el nombre puede contener ":"
  return type === 'existing' ? { type: 'existing', categoryId: Number(payload) } : { type: 'create', name: payload }
}

/**
 * Categorías nuevas que crea el plan para un tipo, sin repetir (las combinadas cuentan una
 * vez). Las filas marcadas como conciliación no crean categorías.
 */
export function newCategoryNames(plan: ImportPreview['categories'], kind: 'expense' | 'income'): string[] {
  return [...new Set(plan.flatMap((c) => (c.kind === kind && !c.adjustment && c.target.type === 'create' ? [c.target.name] : [])))]
}

type Steps = { file: number; account: number; categories: number; labels?: number; duplicates?: number; review: number }

/** Números de paso correlativos; las preguntas que no aplican al archivo no aparecen. */
export function stepNumbers(preview: Pick<ImportPreview, 'labeledCount' | 'duplicateCount'>): Steps {
  let n = 3
  const steps: Steps = { file: 1, account: 2, categories: 3, review: 0 }
  if (preview.labeledCount > 0) steps.labels = ++n
  if (preview.duplicateCount > 0) steps.duplicates = ++n
  steps.review = ++n
  return steps
}

export type MergePlan =
  | { ok: true; moved: number; removed: string[]; target: string }
  | { ok: false; error: string }

/** Qué pasará al combinar `sourceIds` en `targetId`, para mostrarlo antes de confirmar. */
export function mergePlan(categories: Category[], sourceIds: number[], targetId: number | null): MergePlan {
  const target = categories.find((c) => c.id === targetId)
  if (!target) return { ok: false, error: 'Elige la categoría de destino' }
  const sources = categories.filter((c) => sourceIds.includes(c.id) && c.id !== target.id)
  if (sources.length === 0) return { ok: false, error: 'Elige al menos una categoría para combinar' }
  const kindName = (k: Category['kind']) => (k === 'expense' ? 'gasto' : 'ingreso')
  const mismatch = sources.find((s) => s.kind !== target.kind)
  if (mismatch) {
    return {
      ok: false,
      error: `"${mismatch.name}" es de ${kindName(mismatch.kind)} y "${target.name}" de ${kindName(target.kind)}: no se pueden combinar`,
    }
  }
  return { ok: true, moved: sources.reduce((sum, s) => sum + s.transactionCount, 0), removed: sources.map((s) => s.name), target: target.name }
}

type AccountLike = { id: number; name: string; archived: boolean }

/** Cuentas elegibles al importar: primero la por defecto (la primera activa), luego las demás activas. */
export function accountChoices(accounts: AccountLike[]): { id: number; name: string; isDefault: boolean }[] {
  const active = accounts.filter((a) => !a.archived).sort((a, b) => a.id - b.id)
  return active.map((a, i) => ({ id: a.id, name: a.name, isDefault: i === 0 }))
}

/** Error del nombre de una cuenta nueva, o null si es válido (no vacío y no repetido). */
export function newAccountNameError(name: string, accounts: AccountLike[]): string | null {
  const trimmed = name.trim()
  if (!trimmed) return 'Escribe un nombre para la cuenta'
  const existing = accounts.find((a) => a.name.trim().toLowerCase() === trimmed.toLowerCase())
  return existing ? `Ya existe una cuenta llamada "${existing.name}"` : null
}

/** Por qué no se puede confirmar todavía, o null si se puede. */
export function importBlockReason(toImport: number, invalidWallets: string[]): string | null {
  if (invalidWallets.length > 0) return `Revisa el nombre de la cuenta nueva para “${invalidWallets[0]}”`
  if (toImport === 0) return 'No hay movimientos para importar'
  return null
}
