# OpenSpend móvil (prueba de concepto)

App Android (React Native + Expo) que consume la **misma API** del Worker (`/api/*`). No tiene base de datos ni
lógica propia: todo lo calcula el Worker, igual que para el dashboard web. Reutiliza directamente código del repo:

- `src/shared/types.ts`, `src/shared/schemas.ts`, `src/shared/money.ts` (tipos, validación y formato de montos)
- `src/client/dates.ts` (meses en hora de Chile)
- `src/api.ts` es casi una copia de `src/client/api.ts` (mismas queries de TanStack Query)

Hoy incluye el **Resumen**: navegación por mes, ingresos/gastos/neto, gastos por categoría, saldos de cuentas,
agregar movimiento y lista de movimientos (mantener presionado para eliminar). Categorías, cuentas y conexiones
quedan para después si la prueba convence.

## Cambio que necesita el Worker

El dashboard usa una cookie de sesión, que una app nativa no puede usar. El Worker ahora acepta además
`Authorization: Bearer <ID token>` en `/api/*` cuando el ID token lo emitió la **Native app** de Auth0
(`src/worker/auth/auth0.ts` → `verifyNativeIdToken`, `src/worker/auth/routes.ts` → `requireSession`):

- Se verifica firma, issuer, audiencia (`AUTH0_NATIVE_CLIENT_ID`) y la marca de invitado, igual que en el login web.
- Usuarios suspendidos quedan fuera; un usuario que entra por primera vez desde el teléfono se registra con
  `ensureUser`, como en `/auth/callback`.
- **Si `AUTH0_NATIVE_CLIENT_ID` no está configurado, no cambia nada**: la API solo acepta la cookie.

## Configuración (una vez)

1. **Auth0** → *Applications → Create Application → Native*:
   - Allowed Callback URLs y Allowed Logout URLs: `openspend://callback`
   - *Advanced Settings → Application Metadata*: key `app`, value `openspend` (así la Action de invitación aplica igual).
   - *Advanced Settings → Grant Types*: Authorization Code y Refresh Token.
   - En *Connections*, igual que la web: solo **Username-Password-Authentication**.
2. **Worker**: `pnpm exec wrangler secret put AUTH0_NATIVE_CLIENT_ID` (el Client ID de esa Native app) y desplegar.
3. **App**: copiar `mobile/.env.example` a `mobile/.env` y completar dominio y Client ID de Auth0.

## Desarrollo y APK

```sh
cd mobile
npm install
npx expo run:android          # build de desarrollo en un emulador o teléfono por USB
```

APK instalable (se firma con la llave de debug; para Play Store hace falta una llave propia o EAS):

```sh
npx expo prebuild -p android
cd android && ./gradlew assembleRelease
# → android/app/build/outputs/apk/release/app-release.apk
```

Sin Android Studio: `npx eas-cli@latest build -p android --profile preview` compila el APK en la nube (cuenta de Expo gratis).
