import { AuthorizationError, CimdFetchError, type ConsentDescription } from '@cloudflare/workers-oauth-provider'
import { Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { createMiddleware } from 'hono/factory'
import { fetchGithubUser, githubAuthorizeUrl, s256 } from './github'
import { base64url, clearSession, createSession, fromBase64url, getSession, sign, verify, type Session } from './session'

const LOGIN_COOKIE = '__Host-login'

export type AuthEnv = { Bindings: Env; Variables: { session: Session } }

// Protege rutas del dashboard/API: sin sesión válida responde 401.
export const requireSession = createMiddleware<AuthEnv>(async (c, next) => {
  const session = await getSession(c)
  if (!session) return c.json({ error: 'No autenticado' }, 401)
  c.set('session', session)
  await next()
})

const escape = (value: string) => value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)

function page(title: string, body: string) {
  return `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(title)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:28rem;margin:4rem auto;padding:0 1rem;color:#0f172a;background:#f8fafc}
button{padding:.5rem 1rem;border-radius:.5rem;border:1px solid #cbd5e1;background:#fff;cursor:pointer;font-size:1rem}
button.primary{background:#0f172a;color:#fff;border-color:#0f172a}.warn{color:#b45309}</style>
<body>${body}</body></html>`
}

function safeReturnTo(value: string | undefined): string {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '/'
}

function loginRedirect(c: { req: { url: string } }) {
  const url = new URL(c.req.url)
  return `/auth/login?${new URLSearchParams({ returnTo: url.pathname + url.search })}`
}

function consentPage(details: ConsentDescription, handle: string, login: string) {
  const name = escape(details.clientName)
  const origin = details.clientDomain
    ? `Publicada por <strong>${escape(details.clientDomain)}</strong>.`
    : 'La aplicación se registró sola; su nombre no está verificado.'
  return page(
    `Autorizar ${details.clientName}`,
    `<h1>¿Permitir que ${name} acceda a tus finanzas?</h1>
<p>${origin} El acceso se enviará a <strong>${escape(details.redirectHost)}</strong>.</p>
${details.redirectIsLoopback ? '<p class="warn"><strong>Esto envía acceso a una app en tu computador.</strong> Continúa solo si acabas de iniciar la conexión desde ella.</p>' : ''}
<p>Podrá leer, crear, editar y eliminar movimientos. Sesión: <strong>${escape(login)}</strong>.</p>
<form method="post">
  <input type="hidden" name="handle" value="${escape(handle)}">
  ${details.scope.map((s) => `<input type="hidden" name="scope" value="${escape(s)}">`).join('')}
  <button class="primary" name="decision" value="approve">Permitir</button>
  <button name="decision" value="deny">Rechazar</button>
</form>`,
  )
}

export const authRoutes = new Hono<AuthEnv>()
  // --- Login del dashboard con GitHub ---
  .get('/auth/login', async (c) => {
    const state = crypto.randomUUID()
    const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)))
    const payload = base64url(
      new TextEncoder().encode(JSON.stringify({ state, verifier, returnTo: safeReturnTo(c.req.query('returnTo')) })),
    )
    setCookie(c, LOGIN_COOKIE, await sign(payload, c.env.SESSION_SECRET), {
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      path: '/',
      maxAge: 600,
    })
    return c.redirect(githubAuthorizeUrl(c.env, state, await s256(verifier)))
  })
  .get('/auth/callback', async (c) => {
    const cookie = getCookie(c, LOGIN_COOKIE)
    deleteCookie(c, LOGIN_COOKIE, { path: '/', secure: true })
    const payload = cookie && (await verify(cookie, c.env.SESSION_SECRET))
    if (!payload) return c.html(page('Error', '<p>La sesión de login expiró. <a href="/auth/login">Intenta de nuevo</a>.</p>'), 400)
    const login = JSON.parse(new TextDecoder().decode(fromBase64url(payload))) as {
      state: string
      verifier: string
      returnTo: string
    }
    const code = c.req.query('code')
    if (!code || c.req.query('state') !== login.state) {
      return c.html(page('Error', '<p>Login inválido. <a href="/auth/login">Intenta de nuevo</a>.</p>'), 400)
    }
    const user = await fetchGithubUser(c.env, code, login.verifier)
    if (user.githubUserId !== c.env.ALLOWED_GITHUB_USER_ID) {
      console.warn(`Login rechazado para GitHub ${user.login} (${user.githubUserId})`)
      return c.html(page('Acceso denegado', `<p>La cuenta <strong>${escape(user.login)}</strong> no tiene acceso.</p>`), 403)
    }
    await createSession(c, user)
    return c.redirect(login.returnTo)
  })
  .post('/auth/logout', (c) => {
    clearSession(c)
    return c.redirect('/')
  })

  // --- Autorización OAuth para clientes MCP (Claude) ---
  // Requiere la sesión del dashboard; luego muestra la página de consentimiento.
  .on(['GET', 'POST'], '/authorize', async (c) => {
    const session = await getSession(c)
    if (!session) return c.redirect(loginRedirect(c))
    const oauth = c.env.OAUTH_PROVIDER
    const remember = { secret: c.env.SESSION_SECRET, subject: session.githubUserId }
    const complete = async (request: Parameters<typeof oauth.completeAuthorization>[0]['request'], headers: Headers) => {
      const { redirectTo } = await oauth.completeAuthorization({
        request,
        userId: session.githubUserId,
        metadata: { login: session.login },
        scope: request.scope,
        props: { githubUserId: session.githubUserId, login: session.login },
      })
      headers.set('Location', redirectTo)
      return new Response(null, { status: 302, headers })
    }

    try {
      if (c.req.method === 'GET') {
        const request = await oauth.parseAuthRequest(c.req.raw)
        if (await oauth.isConsentRemembered(c.req.raw, request, remember)) return complete(request, new Headers())
        const details = await oauth.describeConsent(request)
        const consent = await oauth.beginConsent(request)
        consent.headers.set('Content-Type', 'text/html; charset=utf-8')
        return new Response(consentPage(details, consent.handle, session.login), { headers: consent.headers })
      }

      const form = await c.req.formData()
      const handle = String(form.get('handle'))
      if (form.get('decision') !== 'approve') {
        const denied = await oauth.denyConsent(c.req.raw, handle)
        return new Response(null, { status: 302, headers: denied.headers })
      }
      const approved = await oauth.approveConsent(c.req.raw, handle, {
        scope: form.getAll('scope').map(String),
        remember,
      })
      return complete(approved.request, approved.headers)
    } catch (error) {
      if (error instanceof AuthorizationError && error.redirectTo) return c.redirect(error.redirectTo)
      if (error instanceof AuthorizationError || error instanceof CimdFetchError) {
        const message = error instanceof AuthorizationError ? error.description : 'No se pudo verificar la aplicación.'
        return c.html(page('Error', `<p>${escape(message)}</p>`), 400)
      }
      throw error
    }
  })
