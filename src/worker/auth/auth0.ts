import { createRemoteJWKSet, jwtVerify } from 'jose'

// Login con Auth0 (OIDC, Authorization Code + PKCE). Solo se usa el ID token para saber
// quién es el usuario; no se guardan tokens de Auth0.

// Claim que agrega la Action de Auth0 a los usuarios invitados (ver README).
export const INVITED_CLAIM = 'https://openspend/invited'

const jwksByDomain = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

function jwks(domain: string) {
  let set = jwksByDomain.get(domain)
  if (!set) {
    set = createRemoteJWKSet(new URL(`https://${domain}/.well-known/jwks.json`))
    jwksByDomain.set(domain, set)
  }
  return set
}

const callbackUrl = (env: Env) => new URL('/auth/callback', env.PUBLIC_URL).href

export function auth0AuthorizeUrl(env: Env, params: { state: string; nonce: string; codeChallenge: string }): string {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: env.AUTH0_CLIENT_ID,
    redirect_uri: callbackUrl(env),
    scope: 'openid email',
    state: params.state,
    nonce: params.nonce,
    code_challenge: params.codeChallenge,
    code_challenge_method: 'S256',
  })
  return `https://${env.AUTH0_DOMAIN}/authorize?${query}`
}

export function auth0LogoutUrl(env: Env): string {
  const query = new URLSearchParams({ client_id: env.AUTH0_CLIENT_ID, returnTo: new URL('/', env.PUBLIC_URL).href })
  return `https://${env.AUTH0_DOMAIN}/v2/logout?${query}`
}

export class NotInvitedError extends Error {}

/** Canjea el code por tokens y devuelve el usuario verificado del ID token. */
export async function fetchAuth0User(env: Env, code: string, verifier: string, nonce: string) {
  const res = await fetch(`https://${env.AUTH0_DOMAIN}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: env.AUTH0_CLIENT_ID,
      client_secret: env.AUTH0_CLIENT_SECRET,
      code,
      code_verifier: verifier,
      redirect_uri: callbackUrl(env),
    }),
  })
  const tokens = (await res.json()) as { id_token?: string; error_description?: string }
  if (!tokens.id_token) throw new Error(`Auth0 no entregó id_token: ${tokens.error_description ?? res.status}`)

  const { payload } = await jwtVerify(tokens.id_token, jwks(env.AUTH0_DOMAIN), {
    issuer: `https://${env.AUTH0_DOMAIN}/`,
    audience: env.AUTH0_CLIENT_ID,
  })
  if (payload.nonce !== nonce) throw new Error('nonce inválido')
  if (!payload.sub || typeof payload.email !== 'string') throw new Error('ID token sin sub o email')
  // Defensa en profundidad: además de la Action que bloquea el login en Auth0, el token
  // debe traer la marca de invitado.
  if (payload[INVITED_CLAIM] !== true) throw new NotInvitedError(payload.email)
  return { userId: payload.sub, email: payload.email }
}
