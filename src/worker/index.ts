import { OAuthProvider } from '@cloudflare/workers-oauth-provider'
import { createMcpHandler } from '@modelcontextprotocol/server'
import { Hono } from 'hono'
import { api } from './api'
import { authRoutes, getActiveSession, requireSession, type AuthEnv, type McpProps } from './auth/routes'
import { AppError } from './errors'
import { buildMcpServer } from './mcp/server'
import { isActiveUser } from './services/users'

// Dashboard, API REST y páginas de login/consentimiento (autenticados con la cookie de sesión).
const app = new Hono<AuthEnv>()
  .route('/', authRoutes)
  .use('/api/*', requireSession)
  .get('/api/me', (c) => c.json({ email: c.get('session').email }))
  .route('/api', api)
  .all('/api/*', (c) => c.json({ error: 'No encontrado' }, 404))
  // Navegación del dashboard: sin sesión se redirige al login antes de entregar la app, así
  // nunca se dibuja un dashboard vacío. Con sesión, se sirve la SPA (index.html).
  .get('*', async (c) => {
    if (!(await getActiveSession(c))) {
      const url = new URL(c.req.url)
      return c.redirect(`/auth/login?${new URLSearchParams({ returnTo: url.pathname + url.search })}`)
    }
    return c.env.ASSETS.fetch(c.req.raw)
  })
  .onError((err, c) => {
    if (err instanceof AppError) return c.json({ error: err.message }, err.status)
    if (err.message.includes('FOREIGN KEY constraint failed')) {
      return c.json({ error: 'La cuenta o categoría indicada no existe' }, 400)
    }
    if (err.message.includes('UNIQUE constraint failed')) {
      return c.json({ error: 'Ya existe un registro con ese nombre' }, 409)
    }
    console.error(err)
    return c.json({ error: 'Error interno' }, 500)
  })

// Endpoint MCP: OAuthProvider ya validó el token antes de llegar aquí.
const mcpHandler = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    // ctx.props es lo que guardó completeAuthorization() en /authorize.
    const props = ctx.props as Partial<McpProps>
    // Tokens emitidos antes del paso a Auth0 no traen userId; los usuarios eliminados o
    // suspendidos pierden el acceso aunque su token no haya expirado.
    if (!props.userId || !(await isActiveUser(env.DB, props.userId))) {
      return new Response('Forbidden', { status: 403 })
    }
    return createMcpHandler(() => buildMcpServer(env, props.userId!)).fetch(request)
  },
}

// La URL pública cambia entre desarrollo y producción, así que el proveedor se crea con el
// primer request (una vez por isolate).
let provider: OAuthProvider<Env> | undefined

function getProvider(env: Env) {
  provider ??= new OAuthProvider<Env>({
    apiRoute: '/mcp',
    apiHandler: mcpHandler,
    defaultHandler: app,
    authorizeEndpoint: '/authorize',
    tokenEndpoint: '/oauth/token',
    clientRegistrationEndpoint: '/oauth/register',
    clientIdMetadataDocumentEnabled: true,
    scopesSupported: ['openspend'],
    resourceMetadata: {
      resource: new URL('/mcp', env.PUBLIC_URL).href,
      authorization_servers: [new URL(env.PUBLIC_URL).origin],
    },
  })
  return provider
}

export default {
  fetch(request, env, ctx) {
    return getProvider(env).fetch(request, env, ctx)
  },
} satisfies ExportedHandler<Env>
