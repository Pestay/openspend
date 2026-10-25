# 💸 OpenSpend

Registro de gastos e ingresos **open source** y **compatible con agentes de IA**: incluye un
servidor [MCP](https://modelcontextprotocol.io) para registrar, buscar y analizar tus finanzas
conversando con Claude (u otro agente), más un dashboard web. Multimoneda (CLP y USD) y
pensado para desplegarse gratis en Cloudflare.

## Stack

- **Cloudflare Workers**: API ([Hono](https://hono.dev)) + front estático + MCP remoto ([SDK oficial v2](https://github.com/modelcontextprotocol/typescript-sdk))
- **D1** (SQLite) con [Drizzle](https://orm.drizzle.team) para esquema y migraciones
- **React + Vite + TanStack Query + Tailwind** para el dashboard
- Tipo de cambio: dólar observado histórico desde [mindicador.cl](https://mindicador.cl), cacheado en D1

## Desarrollo local

Requiere Node 22+ (`nvm use` lee `.nvmrc`) y pnpm.

```bash
nvm use
pnpm install
pnpm db:migrate:local   # crea la base local en .wrangler/
pnpm dev                # http://localhost:5173
```

| Script | Qué hace |
|---|---|
| `pnpm dev` | Front + Worker + D1 local con hot reload |
| `pnpm typecheck` / `pnpm lint` | Tipos y lint |
| `pnpm test` | Tests (Vitest dentro del runtime de Workers, con D1 local) |
| `pnpm db:generate` | Genera una migración SQL tras cambiar `db/schema.ts` |
| `pnpm db:migrate:local` / `:remote` | Aplica migraciones a la base local / de producción |
| `pnpm cf-typegen` | Regenera tipos de bindings tras cambiar `wrangler.jsonc` |
| `pnpm run deploy` | Build y despliegue a Cloudflare (`pnpm deploy` a secas es otro comando de pnpm) |

## Despliegue (GitHub Actions)

El workflow [`.github/workflows/ci-cd.yml`](.github/workflows/ci-cd.yml):

- **En cada PR y push a `main`**: typecheck, lint, tests, build y escaneo de secretos con gitleaks. No despliega.
- **Al crear un tag `v*` sobre `main`**: repite las verificaciones, aplica las migraciones de D1 y despliega el Worker.

Para publicar una versión:

```bash
gh release create v0.2.0 --target main --generate-notes
```

Esto crea el tag y una release con las notas generadas desde los PRs. El despliegue se rechaza si el tag no apunta
a un commit de `main` o si no coincide con `version` de `package.json` (actualízala en el PR antes de publicar).
Al abrir la app, la consola del navegador muestra la versión y el commit que están corriendo.

Configuración necesaria en GitHub → Settings → Environments → `production` (restringido a tags `v*`):

| Nombre | Tipo | Valor |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Secret | Token de Cloudflare con la plantilla *Edit Cloudflare Workers* + permiso *D1: Edit* |
| `CLOUDFLARE_ACCOUNT_ID` | Variable | ID de la cuenta de Cloudflare |

Los secretos de la app (`AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `SESSION_SECRET`) se configuran
una vez con `wrangler secret put` y se mantienen entre despliegues.

## Usuarios e invitaciones (Auth0)

OpenSpend es multiusuario **solo por invitación**: cada usuario ve únicamente sus datos y nadie puede registrarse solo.

**Configuración de Auth0 (una vez):**

Un mismo tenant de Auth0 puede servir a varias apps (login compartido con SSO). La invitación es **por app**: estar
invitado a una no da acceso a otra.

1. *Applications → Create Application → Regular Web Application*.
   - Allowed Callback URLs: `https://<tu-dominio>/auth/callback, http://localhost:5173/auth/callback`
   - Allowed Logout URLs: `https://<tu-dominio>, http://localhost:5173`
   - *Advanced Settings → Application Metadata*: key `app`, value `openspend`.
   - En *Connections*, dejar solo **Username-Password-Authentication**.
2. *Authentication → Database → Username-Password-Authentication*: activar **Disable Sign Ups**.
3. *Actions → Triggers → post-login*: agregar esta Action. Bloquea a quien no esté invitado a la app que pide el login
   y marca el ID token (OpenSpend rechaza tokens sin la marca `https://openspend/invited`):

   ```js
   exports.onExecutePostLogin = async (event, api) => {
     const app = event.client.metadata?.app
     const invitedTo = event.user.app_metadata?.apps ?? []
     if (!app || !invitedTo.includes(app)) {
       api.access.deny('Esta cuenta no tiene una invitación a esta aplicación.')
       return
     }
     api.idToken.setCustomClaim(`https://${app}/invited`, true)
   }
   ```

**Invitar a alguien:**

1. *User Management → Users → Create User* con su email (conexión Username-Password-Authentication) y una
   contraseña temporal cualquiera.
2. En el usuario, *app_metadata*: `{ "apps": ["openspend"] }` → Save. Para darle acceso a otra app del mismo tenant,
   se agrega su nombre a la lista.
3. Pídele que entre a la app y use **"¿Olvidaste tu contraseña?"** para definir la suya.

En su primer login se le crean sus categorías y una cuenta "Principal". Para quitar el acceso, bloquea o elimina el
usuario en Auth0: pierde el dashboard al expirar su sesión (máximo 7 días) y el MCP de inmediato si además se borra
su fila en la tabla `users` (eso **elimina todos sus datos**).

## Estructura

```
src/
  client/            React (dashboard)
  worker/
    api/             Rutas REST (Hono)
    auth/            Login con Auth0, sesión y consentimiento OAuth del MCP
    mcp/             Servidor MCP (herramientas para agentes)
    services/        Lógica compartida por API y MCP (duplicados, tipo de cambio, resúmenes, usuarios)
  shared/            Esquemas Zod, tipos y utilidades de dinero
db/
  schema.ts          Esquema Drizzle
  migrations/        SQL aplicado con wrangler
test/                Tests de aislamiento entre usuarios
```

## Decisiones

- **Montos como enteros** en la unidad mínima de cada moneda (CLP sin decimales, USD en centavos).
- Cada movimiento guarda **moneda original, tipo de cambio del día y monto en CLP**; las estadísticas usan CLP.
- **Duplicados**: mismo monto, moneda, tipo y cuenta dentro de ±2 días. Se marcan (`possibleDuplicateOf`) o se omiten con `skipDuplicates`.
- **Operaciones masivas** usan un único parámetro JSON + `json_each()` para respetar los límites de D1 del plan gratis.
- **Multiusuario**: todas las tablas con datos financieros tienen `user_id`; cada servicio recibe el usuario
  explícitamente y valida que las cuentas, categorías y lotes referenciados le pertenezcan (las claves foráneas solo
  garantizan que existan). Los tests en `test/` verifican el aislamiento.

## Seguridad (repo público)

- Ningún secreto en el código: local en `.dev.vars` (ignorado), producción con `wrangler secret put`.
- Ningún dato financiero en el repo: `.gitignore` bloquea CSV/XLSX/PDF; los exports se guardan fuera del repo.
- Hook `pre-commit` con [gitleaks](https://github.com/gitleaks/gitleaks) (`brew install gitleaks`), activado automáticamente por `pnpm install`.
- Acceso: login con Auth0 (OIDC + PKCE, ID token verificado con JWKS) solo para usuarios invitados. El dashboard usa
  una cookie firmada (`HttpOnly`, `SameSite=Lax`, 7 días); el MCP usa OAuth 2.1 con PKCE y página de consentimiento
  ([workers-oauth-provider](https://github.com/cloudflare/workers-oauth-provider)).

## Roadmap

- [x] Esqueleto: API, D1, tipo de cambio, duplicados, dashboard básico
- [x] MCP remoto para Claude (registrar, buscar, editar, resúmenes)
- [x] Autenticación (OAuth 2.1 para el MCP)
- [x] Multiusuario por invitación con Auth0
- [ ] Importador desde otras apps de finanzas (CSV) y lotes de importación reversibles
- [ ] Carga de cartolas bancarias
- [ ] Gráficos y presupuestos por categoría
