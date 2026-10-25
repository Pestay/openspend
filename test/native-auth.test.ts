import { env, SELF } from 'cloudflare:test'
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose'
import { beforeAll, describe, expect, it } from 'vitest'
import { INVITED_CLAIM, verifyNativeIdToken } from '../src/worker/auth/auth0'

// App móvil (POC): la API acepta el ID token de la Native app de Auth0 como Bearer.

const NATIVE_CLIENT = 'native-client'
const nativeEnv = { ...env, AUTH0_NATIVE_CLIENT_ID: NATIVE_CLIENT }
let keys: ReturnType<typeof createLocalJWKSet>
let privateKey: CryptoKey

beforeAll(async () => {
  const pair = await generateKeyPair('RS256')
  privateKey = pair.privateKey
  keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), alg: 'RS256' }] })
})

function idToken(claims: Record<string, unknown>, audience = NATIVE_CLIENT) {
  return new SignJWT({ email: 'alice@example.com', [INVITED_CLAIM]: true, ...claims })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(`https://${env.AUTH0_DOMAIN}/`)
    .setAudience(audience)
    .setSubject('auth0|alice')
    .setExpirationTime('1h')
    .sign(privateKey)
}

describe('verifyNativeIdToken', () => {
  it('acepta un ID token válido de la app nativa', async () => {
    expect(await verifyNativeIdToken(nativeEnv, await idToken({}), keys)).toMatchObject({
      userId: 'auth0|alice',
      email: 'alice@example.com',
    })
  })

  it('rechaza tokens de otra app, sin invitación o con la app nativa sin configurar', async () => {
    expect(await verifyNativeIdToken(nativeEnv, await idToken({}, env.AUTH0_CLIENT_ID), keys)).toBeNull()
    expect(await verifyNativeIdToken(nativeEnv, await idToken({ [INVITED_CLAIM]: false }), keys)).toBeNull()
    expect(await verifyNativeIdToken(env, await idToken({}), keys)).toBeNull()
    expect(await verifyNativeIdToken(nativeEnv, 'no-es-un-jwt', keys)).toBeNull()
  })
})

describe('API con Bearer', () => {
  it('un Bearer inválido no da acceso', async () => {
    const res = await SELF.fetch('http://localhost/api/me', { headers: { Authorization: 'Bearer basura' } })
    expect(res.status).toBe(401)
  })
})
