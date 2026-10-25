// Selección de movimientos para acciones en lote (lógica pura, testeada). Los conjuntos son
// inmutables para que React detecte el cambio.

export function toggle(selected: Set<number>, id: number): Set<number> {
  const next = new Set(selected)
  if (!next.delete(id)) next.add(id)
  return next
}

export function pageSelection(selected: Set<number>, pageIds: number[]): 'none' | 'some' | 'all' {
  const count = pageIds.filter((id) => selected.has(id)).length
  if (count === 0) return 'none'
  return count === pageIds.length ? 'all' : 'some'
}

/** Marca toda la página; si ya estaba toda marcada, la desmarca. Las otras páginas no se tocan. */
export function togglePage(selected: Set<number>, pageIds: number[]): Set<number> {
  const next = new Set(selected)
  if (pageSelection(selected, pageIds) === 'all') for (const id of pageIds) next.delete(id)
  else for (const id of pageIds) next.add(id)
  return next
}
