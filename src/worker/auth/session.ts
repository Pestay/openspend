import type { Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'

// Sesión del dashboard: cookie firmada con HMAC-SHA256 (no se guarda nada en el servidor).
const COOKIE = '__Host-session'
// Corta para que un usuario dado de baja en Auth0 pierda el acceso al dashboard pronto.
const MAX_AGE_SECONDS = 7 * 24 * 60 * 60

export interface Session {
  userId: string // sub de Auth0
  email: string
  exp: number
}

const encoder = new TextEncoder()

export function base64url(bytes: ArrayBuffer | Uint8Array): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

export function fromBase64url(value: string): Uint8Array {
  const bin = atob(value.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

// PKCE: code_challenge = BASE64URL(SHA-256(code_verifier))
export async function s256(verifier: string): Promise<string> {
  return base64url(await crypto.subtle.digest('SHA-256', encoder.encode(verifier)))
}

async function hmacKey(secret: string) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ])
}

export async function sign(payload: string, secret: string): Promise<string> {
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(payload))
  return `${payload}.${base64url(signature)}`
}

export async function verify(token: string, secret: string): Promise<string | null> {
  const [payload, signature] = token.split('.')
  if (!payload || !signature) return null
  // crypto.subtle.verify compara en tiempo constante.
  const valid = await crypto.subtle.verify('HMAC', await hmacKey(secret), fromBase64url(signature), encoder.encode(payload))
  return valid ? payload : null
}

export async function createSession<E extends { Bindings: Env }>(c: Context<E>, user: { userId: string; email: string }) {
  const session: Session = { ...user, exp: Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS }
  const payload = base64url(encoder.encode(JSON.stringify(session)))
  setCookie(c, COOKIE, await sign(payload, c.env.SESSION_SECRET), {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  })
}

export async function getSession<E extends { Bindings: Env }>(c: Context<E>): Promise<Session | null> {
  const token = getCookie(c, COOKIE)
  if (!token) return null
  const payload = await verify(token, c.env.SESSION_SECRET)
  if (!payload) return null
  const session = JSON.parse(new TextDecoder().decode(fromBase64url(payload))) as Session
  if (session.exp < Date.now() / 1000 || !session.userId) return null
  return session
}

export function clearSession(c: Context) {
  deleteCookie(c, COOKIE, { path: '/', secure: true })
}
