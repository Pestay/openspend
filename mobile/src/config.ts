// Configuración de la app móvil (ver mobile/.env.example). Expo inyecta las EXPO_PUBLIC_* al compilar.
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://openspend.elguet5.workers.dev'
export const AUTH0_DOMAIN = process.env.EXPO_PUBLIC_AUTH0_DOMAIN ?? ''
// Client ID de la *Native* app de Auth0 (no la Regular Web Application del dashboard).
export const AUTH0_CLIENT_ID = process.env.EXPO_PUBLIC_AUTH0_CLIENT_ID ?? ''
