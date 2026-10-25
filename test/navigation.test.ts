import { env, SELF } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { base64url, sign } from '../src/worker/auth/session'
import { ensureUser } from '../src/worker/services/users'

// Las sesiones solo valen para usuarios registrados y activos.
beforeEach(() => ensureUser(env.DB, { id: 'auth0|nav', email: 'nav@example.com' }))

async function sessionCookie() {
  const payload = base64url(
    new TextEncoder().encode(JSON.stringify({ userId: 'auth0|nav', email: 'nav@example.com', exp: Date.now() / 1000 + 3600 })),
  )
  return `__Host-session=${await sign(payload, env.SESSION_SECRET)}`
}

describe('navegación', () => {
  it('redirige al login antes de entregar la app, conservando la ruta', async () => {
    const res = await SELF.fetch('http://localhost/?mes=2026-09', { redirect: 'manual' })
    expect(res.status).toBe(302)
    const location = new URL(res.headers.get('Location')!, 'http://localhost')
    expect(location.pathname).toBe('/auth/login')
    expect(location.searchParams.get('returnTo')).toBe('/?mes=2026-09')
  })

  it('una ruta de API inexistente responde 404 en JSON, no la app', async () => {
    const res = await SELF.fetch('http://localhost/api/no-existe', { headers: { Cookie: await sessionCookie() } })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'No encontrado' })
  })
})

describe('asistentes conectados', () => {
  it('lista vacía para un usuario sin conexiones y 404 al revocar una ajena o inexistente', async () => {
    const cookie = { Cookie: await sessionCookie() }
    const list = await SELF.fetch('http://localhost/api/connections', { headers: cookie })
    expect(list.status).toBe(200)
    expect(await list.json()).toEqual([])
    const revoke = await SELF.fetch('http://localhost/api/connections/no-existe', { method: 'DELETE', headers: cookie })
    expect(revoke.status).toBe(404)
  })
})
