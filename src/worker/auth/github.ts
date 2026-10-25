import { base64url } from './session'

// Login con una GitHub OAuth App. Solo se usa para identificar al usuario; el token de
// GitHub no se guarda.

export function githubAuthorizeUrl(env: Env, state: string, codeChallenge: string): string {
  const params = new URLSearchParams({
    client_id: env.GITHUB_CLIENT_ID,
    redirect_uri: new URL('/auth/callback', env.PUBLIC_URL).href,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    allow_signup: 'false',
  })
  return `https://github.com/login/oauth/authorize?${params}`
}

export async function s256(verifier: string): Promise<string> {
  return base64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))
}

export async function fetchGithubUser(env: Env, code: string, verifier: string) {
  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      code_verifier: verifier,
      redirect_uri: new URL('/auth/callback', env.PUBLIC_URL).href,
    }),
  })
  const token = (await tokenRes.json()) as { access_token?: string; error_description?: string }
  if (!token.access_token) throw new Error(`GitHub no entregó token: ${token.error_description ?? tokenRes.status}`)

  const userRes = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'openspend',
    },
  })
  if (!userRes.ok) throw new Error(`GitHub /user respondió ${userRes.status}`)
  const user = (await userRes.json()) as { id: number; login: string }
  return { githubUserId: String(user.id), login: user.login }
}
