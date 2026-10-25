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

### Probar contra el Worker local, sin Auth0

1. En la raíz: `pnpm db:migrate:local` y `pnpm dev`. Entrar una vez al dashboard local para que exista tu usuario
   (o insertarlo en la D1 local).
2. `node scripts/dev-session-cookie.mjs '<userId>' '<email>'` y poner en `mobile/.env`:
   ```
   EXPO_PUBLIC_API_URL=http://localhost:5173
   EXPO_PUBLIC_DEV_SESSION_COOKIE=__Host-session=...
   ```
3. `adb reverse tcp:5173 tcp:5173` (el teléfono o emulador ve tu `localhost`) y `npx expo run:android`.

La app se salta el login y usa esa cookie. Solo funciona contra el Worker local: la firma depende del
`SESSION_SECRET` de tu `.dev.vars`.

APK instalable (se firma con la llave de debug; para Play Store hace falta una llave propia o EAS):

```sh
npx expo prebuild -p android
cd android && ./gradlew assembleRelease
# → android/app/build/outputs/apk/release/app-release.apk
```

**En Windows** el build nativo falla con `Filename longer than 260 characters` (el ninja de CMake 3.22 no soporta rutas
largas). Solución: instalar CMake 3.31 (`sdkmanager "cmake;3.31.6"`), agregar a `android/local.properties`
`cmake.dir=C:/Users/<usuario>/AppData/Local/Android/Sdk/cmake/3.31.6` y compilar desde una ruta corta. Para un APK más
liviano, solo para teléfonos actuales: `./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a`.

Sin Android Studio: `npx eas-cli@latest build -p android --profile preview` compila el APK en la nube (cuenta de Expo gratis).
