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
| `pnpm db:generate` | Genera una migración SQL tras cambiar `db/schema.ts` |
| `pnpm db:migrate:local` / `:remote` | Aplica migraciones a la base local / de producción |
| `pnpm cf-typegen` | Regenera tipos de bindings tras cambiar `wrangler.jsonc` |
| `pnpm run deploy` | Build y despliegue a Cloudflare (`pnpm deploy` a secas es otro comando de pnpm) |

## Estructura

```
src/
  client/            React (dashboard)
  worker/
    api/             Rutas REST (Hono)
    services/        Lógica compartida por API y MCP (duplicados, tipo de cambio, resúmenes)
  shared/            Esquemas Zod, tipos y utilidades de dinero
db/
  schema.ts          Esquema Drizzle
  migrations/        SQL aplicado con wrangler
```

## Decisiones

- **Montos como enteros** en la unidad mínima de cada moneda (CLP sin decimales, USD en centavos).
- Cada movimiento guarda **moneda original, tipo de cambio del día y monto en CLP**; las estadísticas usan CLP.
- **Duplicados**: mismo monto, moneda, tipo y cuenta dentro de ±2 días. Se marcan (`possibleDuplicateOf`) o se omiten con `skipDuplicates`.
- **Operaciones masivas** usan un único parámetro JSON + `json_each()` para respetar los límites de D1 del plan gratis.

## Seguridad (repo público)

- Ningún secreto en el código: local en `.dev.vars` (ignorado), producción con `wrangler secret put`.
- Ningún dato financiero en el repo: `.gitignore` bloquea CSV/XLSX/PDF; los exports se guardan fuera del repo.
- Hook `pre-commit` con [gitleaks](https://github.com/gitleaks/gitleaks) (`brew install gitleaks`), activado automáticamente por `pnpm install`.
- Acceso: login con GitHub restringido a un único usuario (`ALLOWED_GITHUB_USER_ID`). El dashboard usa una cookie firmada; el MCP usa OAuth 2.1 con PKCE y página de consentimiento ([workers-oauth-provider](https://github.com/cloudflare/workers-oauth-provider)).

## Roadmap

- [x] Esqueleto: API, D1, tipo de cambio, duplicados, dashboard básico
- [x] MCP remoto para Claude (registrar, buscar, editar, resúmenes)
- [x] Autenticación (login con GitHub + OAuth 2.1 para el MCP)
- [ ] Importador de Spendee y lotes de importación reversibles
- [ ] Carga de cartolas bancarias
- [ ] Gráficos y presupuestos por categoría
