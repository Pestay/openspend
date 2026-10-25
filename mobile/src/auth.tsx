import {
  exchangeCodeAsync,
  makeRedirectUri,
  refreshAsync,
  useAuthRequest,
  useAutoDiscovery,
  type DiscoveryDocument,
} from 'expo-auth-session'
import * as SecureStore from 'expo-secure-store'
import * as WebBrowser from 'expo-web-browser'
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { AUTH0_CLIENT_ID, AUTH0_DOMAIN } from './config'

// Login con Auth0 (Native app, Authorization Code + PKCE en el navegador del sistema).
// La API del Worker acepta el ID token como Bearer; el refresh token permite renovarlo sin
// volver a pedir la contraseña.

WebBrowser.maybeCompleteAuthSession()

const STORE_KEY = 'openspend.tokens'
const redirectUri = makeRedirectUri({ scheme: 'openspend', path: 'callback' })

interface Tokens {
  idToken: string
  refreshToken?: string
}

interface AuthContextValue {
  status: 'loading' | 'signedOut' | 'signedIn'
  email: string | null
  login: () => void
  logout: () => Promise<void>
  /** ID token vigente (lo renueva si está por vencer); null si no hay sesión. */
  getIdToken: () => Promise<string | null>
}

const AuthContext = createContext<AuthContextValue | null>(null)

function claims(idToken: string): { exp: number; email?: string } {
  const part = idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
  return JSON.parse(atob(part))
}

// Renueva con un margen de un minuto para que el token no venza en camino al Worker.
const isFresh = (idToken: string) => claims(idToken).exp - 60 > Date.now() / 1000

export function AuthProvider({ children }: { children: ReactNode }) {
  const discovery = useAutoDiscovery(`https://${AUTH0_DOMAIN}`)
  const [tokens, setTokens] = useState<Tokens | null | undefined>(undefined)
  // getIdToken lee los tokens más recientes sin cambiar de identidad en cada render.
  const tokensRef = useRef(tokens)
  useEffect(() => {
    tokensRef.current = tokens
  }, [tokens])

  const [request, response, promptAsync] = useAuthRequest(
    { clientId: AUTH0_CLIENT_ID, redirectUri, scopes: ['openid', 'email', 'offline_access'] },
    discovery,
  )

  const save = useCallback(async (next: Tokens | null) => {
    if (next) await SecureStore.setItemAsync(STORE_KEY, JSON.stringify(next))
    else await SecureStore.deleteItemAsync(STORE_KEY)
    tokensRef.current = next
    setTokens(next)
  }, [])

  useEffect(() => {
    SecureStore.getItemAsync(STORE_KEY).then((raw) => setTokens(raw ? JSON.parse(raw) : null))
  }, [])

  useEffect(() => {
    if (response?.type !== 'success' || !discovery || !request?.codeVerifier) return
    exchangeCodeAsync(
      {
        clientId: AUTH0_CLIENT_ID,
        code: response.params.code,
        redirectUri,
        extraParams: { code_verifier: request.codeVerifier },
      },
      discovery,
    ).then((result) => {
      if (result.idToken) save({ idToken: result.idToken, refreshToken: result.refreshToken })
    })
  }, [response, discovery, request, save])

  const getIdToken = useCallback(async () => {
    const current = tokensRef.current
    if (!current) return null
    if (isFresh(current.idToken)) return current.idToken
    if (!current.refreshToken || !discovery) {
      await save(null)
      return null
    }
    try {
      const result = await refreshAsync(
        { clientId: AUTH0_CLIENT_ID, refreshToken: current.refreshToken },
        discovery as DiscoveryDocument,
      )
      if (!result.idToken) throw new Error('Auth0 no entregó id_token')
      // Auth0 rota el refresh token: guardar el nuevo si viene.
      const next = { idToken: result.idToken, refreshToken: result.refreshToken ?? current.refreshToken }
      await save(next)
      return next.idToken
    } catch {
      await save(null)
      return null
    }
  }, [discovery, save])

  const logout = useCallback(async () => {
    await save(null)
    // Cierra también la sesión de Auth0; si no, el siguiente login entra directo.
    const query = new URLSearchParams({ client_id: AUTH0_CLIENT_ID, returnTo: redirectUri })
    await WebBrowser.openAuthSessionAsync(`https://${AUTH0_DOMAIN}/v2/logout?${query}`, redirectUri)
  }, [save])

  const value: AuthContextValue = {
    status: tokens === undefined ? 'loading' : tokens ? 'signedIn' : 'signedOut',
    email: tokens ? (claims(tokens.idToken).email ?? null) : null,
    login: () => request && promptAsync(),
    logout,
    getIdToken,
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth fuera de AuthProvider')
  return value
}
