import type { Connection } from '../../shared/types'
import { AppError } from '../errors'

// Asistentes con acceso OAuth al MCP. Cada aprobación en /authorize crea un "grant".
export async function listConnections(oauth: Env['OAUTH_PROVIDER'], userId: string): Promise<Connection[]> {
  const grants = []
  let cursor: string | undefined
  do {
    const page = await oauth.listUserGrants(userId, { cursor })
    grants.push(...page.items)
    cursor = page.cursor
  } while (cursor)

  const connections = await Promise.all(
    grants.map(async (grant) => {
      const client = await oauth.lookupClient(grant.clientId).catch(() => null)
      let redirectHost: string | null = null
      try {
        redirectHost = grant.redirectUri ? new URL(grant.redirectUri).host : null
      } catch {
        // URI de redirección no estándar (apps nativas): se omite el host.
      }
      return {
        id: grant.id,
        clientName: client?.clientName ?? 'Asistente sin nombre',
        redirectHost,
        connectedAt: new Date(grant.createdAt * 1000).toISOString(),
      }
    }),
  )
  return connections.sort((a, b) => b.connectedAt.localeCompare(a.connectedAt))
}

// revokeGrant solo actúa si el grant pertenece a ese usuario; además se verifica antes
// para responder 404 en vez de "éxito" sobre un id ajeno o inexistente.
export async function revokeConnection(oauth: Env['OAUTH_PROVIDER'], userId: string, grantId: string) {
  const owned = (await listConnections(oauth, userId)).some((c) => c.id === grantId)
  if (!owned) throw new AppError('Conexión no encontrada', 404)
  await oauth.revokeGrant(grantId, userId)
  return { revoked: grantId }
}
