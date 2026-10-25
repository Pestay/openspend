import { AuthorizationError, CimdFetchError, type ConsentDescription } from '@cloudflare/workers-oauth-provider'
import { Hono, type Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { createMiddleware } from 'hono/factory'
import { auth0AuthorizeUrl, auth0LogoutUrl, fetchAuth0User, NotInvitedError } from './auth0'
import { ensureUser, isActiveUser } from '../services/users'
import {
  base64url,
  clearSession,
  createSession,
  fromBase64url,
  getSession,
  s256,
  sign,
  verify,
  type Session,
} from './session'

const LOGIN_COOKIE = '__Host-login'

export type AuthEnv = { Bindings: Env; Variables: { session: Session } }

// Lo que recibe el endpoint MCP en ctx.props tras validar el token OAuth.
export interface McpProps {
  userId: string
  email: string
}

// Sesión válida (cookie firmada y vigente) de un usuario que sigue activo (no suspendido).
export async function getActiveSession(c: Context<AuthEnv>): Promise<Session | null> {
  const session = await getSession(c)
  return session && (await isActiveUser(c.env.DB, session.userId)) ? session : null
}

// Protege rutas del dashboard/API: sin sesión válida responde 401.
export const requireSession = createMiddleware<AuthEnv>(async (c, next) => {
  const session = await getActiveSession(c)
  if (!session) return c.json({ error: 'No autenticado' }, 401)
  c.set('session', session)
  await next()
})

const escape = (value: string) => value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)

function page(title: string, body: string) {
  return `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(title)} · OpenSpend</title><link rel="icon" type="image/svg+xml" href="/logo.svg">
<style>
body{font-family:system-ui,sans-serif;margin:0;min-height:100vh;display:grid;place-items:center;padding:1rem;color:#0f172a;
  background:linear-gradient(160deg,#ecfdf5,#f8fafc 60%)}
main{background:#fff;max-width:26rem;width:100%;padding:2rem;border-radius:1rem;box-shadow:0 10px 30px rgb(15 23 42/.08)}
header{display:flex;align-items:center;gap:.5rem;font-weight:600;margin-bottom:1rem}header img{width:2rem;height:2rem}
h1{font-size:1.25rem;margin:.5rem 0 1rem}a{color:#047857}
button{padding:.6rem 1.1rem;border-radius:.6rem;border:1px solid #cbd5e1;background:#fff;cursor:pointer;font-size:1rem}
button.primary{background:#047857;color:#fff;border-color:#047857}button.primary:hover{background:#065f46}
form{display:flex;gap:.5rem;margin-top:1.5rem}.warn{color:#b45309}
</style>
<main><header><img src="/logo.svg" alt="">OpenSpend</header>${body}</main></html>`
}

function safeReturnTo(value: string | undefined): string {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '/'
}

function loginRedirect(c: { req: { url: string } }) {
  const url = new URL(c.req.url)
  return `/auth/login?${new URLSearchParams({ returnTo: url.pathname + url.search })}`
}

function consentPage(details: ConsentDescription, handle: string, email: string) {
  const name = escape(details.clientName)
  const origin = details.clientDomain
    ? `Publicada por <strong>${escape(details.clientDomain)}</strong>.`
    : 'La aplicación se registró sola; su nombre no está verificado.'
  return page(
    `Autorizar ${details.clientName}`,
    `<h1>¿Permitir que ${name} acceda a tus finanzas?</h1>
<p>${origin} El acceso se enviará a <strong>${escape(details.redirectHost)}</strong>.</p>
${details.redirectIsLoopback ? '<p class="warn"><strong>Esto envía acceso a una app en tu computador.</strong> Continúa solo si acabas de iniciar la conexión desde ella.</p>' : ''}
<p>Podrá leer, crear, editar y eliminar movimientos. Sesión: <strong>${escape(email)}</strong>.</p>
<form method="post">
  <input type="hidden" name="handle" value="${escape(handle)}">
  ${details.scope.map((s) => `<input type="hidden" name="scope" value="${escape(s)}">`).join('')}
  <button class="primary" name="decision" value="approve">Permitir</button>
  <button name="decision" value="deny">Rechazar</button>
</form>`,
  )
}

export const authRoutes = new Hono<AuthEnv>()
  // --- Login del dashboard con Auth0 ---
  .get('/auth/login', async (c) => {
    const state = crypto.randomUUID()
    const nonce = crypto.randomUUID()
    const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)))
    const payload = base64url(
      new TextEncoder().encode(
        JSON.stringify({ state, nonce, verifier, returnTo: safeReturnTo(c.req.query('returnTo')) }),
      ),
    )
    setCookie(c, LOGIN_COOKIE, await sign(payload, c.env.SESSION_SECRET), {
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      path: '/',
      maxAge: 600,
    })
    return c.redirect(auth0AuthorizeUrl(c.env, { state, nonce, codeChallenge: await s256(verifier) }))
  })
  .get('/auth/callback', async (c) => {
    const cookie = getCookie(c, LOGIN_COOKIE)
    deleteCookie(c, LOGIN_COOKIE, { path: '/', secure: true })
    const payload = cookie && (await verify(cookie, c.env.SESSION_SECRET))
    if (!payload) return c.html(page('Error', '<p>La sesión de login expiró. <a href="/auth/login">Intenta de nuevo</a>.</p>'), 400)
    const login = JSON.parse(new TextDecoder().decode(fromBase64url(payload))) as {
      state: string
      nonce: string
      verifier: string
      returnTo: string
    }
    // Auth0 devuelve error=access_denied cuando la Action bloquea a un usuario no invitado.
    if (c.req.query('error')) {
      const description = c.req.query('error_description') ?? 'No se pudo iniciar sesión.'
      return c.html(page('Acceso denegado', `<p>${escape(description)}</p><p><a href="/auth/logout">Volver</a></p>`), 403)
    }
    const code = c.req.query('code')
    if (!code || c.req.query('state') !== login.state) {
      return c.html(page('Error', '<p>Login inválido. <a href="/auth/login">Intenta de nuevo</a>.</p>'), 400)
    }
    let user: { userId: string; email: string }
    try {
      user = await fetchAuth0User(c.env, code, login.verifier, login.nonce)
    } catch (error) {
      if (!(error instanceof NotInvitedError)) throw error
      console.warn(`Login rechazado: ${error.message} no está invitado`)
      return c.html(page('Acceso denegado', '<p>Esta cuenta no tiene una invitación a OpenSpend.</p>'), 403)
    }
    await ensureUser(c.env.DB, { id: user.userId, email: user.email })
    if (!(await isActiveUser(c.env.DB, user.userId))) {
      console.warn(`Login rechazado: ${user.email} está suspendido`)
      return c.html(page('Cuenta suspendida', '<p>Tu cuenta de OpenSpend está suspendida.</p>'), 403)
    }
    await createSession(c, user)
    return c.redirect(login.returnTo)
  })
  // Cierra la sesión local y también la de Auth0 (si no, el siguiente login entra directo).
  .on(['GET', 'POST'], '/auth/logout', (c) => {
    clearSession(c)
    return c.redirect(auth0LogoutUrl(c.env))
  })

  // --- Autorización OAuth para clientes MCP (Claude) ---
  // Requiere la sesión del dashboard; luego muestra la página de consentimiento.
  .on(['GET', 'POST'], '/authorize', async (c) => {
    const session = await getActiveSession(c)
    if (!session) return c.redirect(loginRedirect(c))
    const oauth = c.env.OAUTH_PROVIDER
    const remember = { secret: c.env.SESSION_SECRET, subject: session.userId }
    const complete = async (request: Parameters<typeof oauth.completeAuthorization>[0]['request'], headers: Headers) => {
      const { redirectTo } = await oauth.completeAuthorization({
        request,
        userId: session.userId,
        metadata: { email: session.email },
        scope: request.scope,
        props: { userId: session.userId, email: session.email } satisfies McpProps,
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
        return new Response(consentPage(details, consent.handle, session.email), { headers: consent.headers })
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
