// Firma una cookie de sesión para el Worker local, igual que src/worker/auth/session.ts.
// Uso: node scripts/dev-session-cookie.mjs <userId> <email>   (lee SESSION_SECRET de ../.dev.vars)
// El usuario debe existir en la D1 local (por ejemplo, tras entrar una vez al dashboard local).
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'

const [userId, email] = process.argv.slice(2)
if (!userId || !email) {
  console.error('Uso: node scripts/dev-session-cookie.mjs <userId> <email>')
  process.exit(1)
}
const secret = readFileSync(new URL('../../.dev.vars', import.meta.url), 'utf8').match(/^SESSION_SECRET=(.+)$/m)?.[1]?.trim()
if (!secret) throw new Error('Falta SESSION_SECRET en .dev.vars')

const b64u = (value) => Buffer.from(value).toString('base64url')
const payload = b64u(JSON.stringify({ userId, email, exp: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60 }))
console.log(`__Host-session=${payload}.${b64u(createHmac('sha256', secret).update(payload).digest())}`)
