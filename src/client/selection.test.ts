import { describe, expect, it } from 'vitest'
import { pageSelection, toggle, togglePage } from './selection'

describe('selección de movimientos', () => {
  it('marca y desmarca uno sin modificar el conjunto original', () => {
    const empty = new Set<number>()
    const one = toggle(empty, 3)
    expect([...one]).toEqual([3])
    expect(empty.size).toBe(0)
    expect(toggle(one, 3).size).toBe(0)
  })

  it('el estado de la página es ninguno, algunos o todos', () => {
    expect(pageSelection(new Set(), [1, 2])).toBe('none')
    expect(pageSelection(new Set([1]), [1, 2])).toBe('some')
    expect(pageSelection(new Set([1, 2, 9]), [1, 2])).toBe('all')
    expect(pageSelection(new Set([9]), [])).toBe('none')
  })

  it('marcar la página agrega los que faltan; si ya estaban todos, los quita y conserva los de otras páginas', () => {
    expect([...togglePage(new Set([1, 9]), [1, 2])].sort()).toEqual([1, 2, 9])
    expect([...togglePage(new Set([1, 2, 9]), [1, 2])]).toEqual([9])
  })
})
