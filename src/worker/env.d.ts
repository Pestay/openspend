import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider'

// OAuthProvider inyecta sus helpers en env para el defaultHandler (página /authorize).
declare global {
  interface Env {
    OAUTH_PROVIDER: OAuthHelpers
    // Client ID de la Native app de Auth0 (app móvil, POC). Sin él, la API solo acepta la cookie.
    AUTH0_NATIVE_CLIENT_ID?: string
  }
}
