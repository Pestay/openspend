import { and, eq } from 'drizzle-orm'
import type { z } from 'zod'
import { accounts } from '../../../db/schema'
import { toMinor } from '../../shared/money'
import type { accountInput, accountUpdateInput } from '../../shared/schemas'
import type { Db } from '../db'
import { AppError } from '../errors'

async function findOwned(db: Db, userId: string, id: number) {
  const [account] = await db.select().from(accounts).where(and(eq(accounts.id, id), eq(accounts.userId, userId)))
  if (!account) throw new AppError(`La cuenta ${id} no existe`, 404)
  return account
}

// Siempre debe quedar al menos una cuenta activa: es la que se usa cuando no se indica cuenta.
async function assertNotLastActive(db: Db, userId: string, id: number) {
  const active = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.archived, false)))
  if (active.length === 1 && active[0].id === id) {
    throw new AppError('Debe quedar al menos una cuenta activa')
  }
}

export async function createAccount(db: Db, userId: string, input: z.output<typeof accountInput>) {
  const { initialBalance, ...data } = input
  const [account] = await db
    .insert(accounts)
    .values({ ...data, userId, initialBalanceMinor: toMinor(initialBalance, data.currency) })
    .returning()
  return account
}

export async function updateAccount(db: Db, userId: string, id: number, patch: z.output<typeof accountUpdateInput>) {
  const account = await findOwned(db, userId, id)
  if (patch.archived === true && !account.archived) await assertNotLastActive(db, userId, id)
  const { initialBalance, ...rest } = patch
  const [updated] = await db
    .update(accounts)
    .set({
      ...rest,
      ...(initialBalance !== undefined && { initialBalanceMinor: toMinor(initialBalance, account.currency) }),
    })
    .where(and(eq(accounts.id, id), eq(accounts.userId, userId)))
    .returning()
  return updated
}

// Solo se eliminan cuentas sin movimientos; las que tienen historial se archivan.
export async function deleteAccount(d1: D1Database, db: Db, userId: string, id: number) {
  const account = await findOwned(db, userId, id)
  const used = await d1
    .prepare('SELECT COUNT(*) AS n FROM transactions WHERE user_id = ?1 AND (account_id = ?2 OR to_account_id = ?2)')
    .bind(userId, id)
    .first<number>('n')
  if (used) {
    throw new AppError(`La cuenta "${account.name}" tiene ${used} movimiento(s); archívala en vez de eliminarla.`, 409)
  }
  await assertNotLastActive(db, userId, id)
  await db.delete(accounts).where(and(eq(accounts.id, id), eq(accounts.userId, userId)))
  return { deleted: id }
}
