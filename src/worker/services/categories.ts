import { and, eq } from 'drizzle-orm'
import type { z } from 'zod'
import { categories } from '../../../db/schema'
import type { categoryInput, categoryUpdateInput } from '../../shared/schemas'
import type { Category } from '../../shared/types'
import type { Db } from '../db'
import { AppError } from '../errors'

export async function listCategories(d1: D1Database, userId: string): Promise<Category[]> {
  const { results } = await d1
    .prepare(
      `SELECT c.id, c.name, c.kind, c.icon, c.color, COUNT(t.id) AS transactionCount
       FROM categories c LEFT JOIN transactions t ON t.category_id = c.id AND t.user_id = c.user_id
       WHERE c.user_id = ?
       GROUP BY c.id ORDER BY c.kind, c.name`,
    )
    .bind(userId)
    .all<Category>()
  return results
}

async function findOwned(db: Db, userId: string, id: number) {
  const [category] = await db
    .select()
    .from(categories)
    .where(and(eq(categories.id, id), eq(categories.userId, userId)))
  if (!category) throw new AppError(`La categoría ${id} no existe`, 404)
  return category
}

export async function createCategory(db: Db, userId: string, input: z.output<typeof categoryInput>) {
  const [category] = await db.insert(categories).values({ ...input, userId }).returning()
  return category
}

export async function updateCategory(db: Db, userId: string, id: number, patch: z.output<typeof categoryUpdateInput>) {
  await findOwned(db, userId, id)
  const [updated] = await db
    .update(categories)
    .set(patch)
    .where(and(eq(categories.id, id), eq(categories.userId, userId)))
    .returning()
  return updated
}

/**
 * Elimina una categoría. Si tiene movimientos, `reassignTo` decide qué hacer con ellos:
 * un id mueve los movimientos a esa categoría (fusionar) y `null` los deja sin categoría.
 * Mover y borrar ocurre en un mismo batch (transacción).
 */
export async function deleteCategory(d1: D1Database, db: Db, userId: string, id: number, reassignTo?: number | null) {
  const category = await findOwned(db, userId, id)
  const used = await d1
    .prepare('SELECT COUNT(*) AS n FROM transactions WHERE user_id = ? AND category_id = ?')
    .bind(userId, id)
    .first<number>('n')

  if (used && reassignTo === undefined) {
    throw new AppError(
      `La categoría "${category.name}" tiene ${used} movimiento(s). Indica a qué categoría moverlos (reassignTo) o null para dejarlos sin categoría.`,
      409,
    )
  }
  if (reassignTo != null) {
    if (reassignTo === id) throw new AppError('No se puede reasignar a la misma categoría')
    const target = await findOwned(db, userId, reassignTo)
    if (target.kind !== category.kind) {
      throw new AppError(`"${target.name}" es de ${target.kind === 'expense' ? 'gasto' : 'ingreso'}; debe ser del mismo tipo`)
    }
  }

  await d1.batch([
    d1
      .prepare('UPDATE transactions SET category_id = ? WHERE user_id = ? AND category_id = ?')
      .bind(reassignTo ?? null, userId, id),
    d1.prepare('DELETE FROM categories WHERE id = ? AND user_id = ?').bind(id, userId),
  ])
  return { deleted: id, movedTransactions: used ?? 0, reassignedTo: reassignTo ?? null }
}

/**
 * Combina varias categorías en una: mueve todos sus movimientos a `targetId` y las elimina.
 * Todas deben ser del usuario y del mismo tipo (gasto/ingreso). Ocurre en un solo batch.
 */
export async function mergeCategories(d1: D1Database, db: Db, userId: string, sourceIds: number[], targetId: number) {
  const ids = [...new Set(sourceIds)].filter((id) => id !== targetId)
  if (ids.length === 0) throw new AppError('Elige al menos una categoría distinta de la de destino')
  const target = await findOwned(db, userId, targetId)
  const sources = await Promise.all(ids.map((id) => findOwned(db, userId, id)))
  const otherKind = sources.find((s) => s.kind !== target.kind)
  if (otherKind) {
    throw new AppError(`"${otherKind.name}" y "${target.name}" son de distinto tipo (gasto/ingreso); no se pueden combinar`)
  }

  const json = JSON.stringify(ids)
  const [moved] = await d1.batch([
    d1
      .prepare('UPDATE transactions SET category_id = ? WHERE user_id = ? AND category_id IN (SELECT value FROM json_each(?))')
      .bind(targetId, userId, json),
    d1.prepare('DELETE FROM categories WHERE user_id = ? AND id IN (SELECT value FROM json_each(?))').bind(userId, json),
  ])
  return { target: target.name, merged: sources.map((s) => s.name), movedTransactions: moved.meta.changes }
}
