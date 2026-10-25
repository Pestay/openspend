import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider'

// OAuthProvider inyecta sus helpers en env para el defaultHandler (página /authorize).
declare global {
  interface Env {
    OAUTH_PROVIDER: OAuthHelpers
  }
}
