// Paginador de la lista de movimientos (lógica pura, testeada sin navegador).

export const PAGE_SIZES = [10, 25, 50, 100] as const
export type PageSize = (typeof PAGE_SIZES)[number]
export const DEFAULT_PAGE_SIZE: PageSize = 25

/** Rango visible (1-based) de la página `page` (0-based) y si hay páginas antes o después. */
export function pageInfo(total: number, page: number, size: number) {
  if (total === 0) return { from: 0, to: 0, pages: 0, hasPrev: false, hasNext: false }
  const pages = Math.ceil(total / size)
  return {
    from: page * size + 1,
    to: Math.min(total, (page + 1) * size),
    pages,
    hasPrev: page > 0,
    hasNext: page < pages - 1,
  }
}

/** YYYY-MM-DD → DD-MM-YYYY. */
export function formatDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-')
  return `${d}-${m}-${y}`
}
