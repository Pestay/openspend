# Cómo contribuir

¡Gracias por tu interés en OpenSpend! Este documento explica cómo proponer cambios.

## Antes de empezar

- Lee el [Código de Conducta](CODE_OF_CONDUCT.md).
- Para cambios grandes, **abre primero un issue** para conversarlo y evitar trabajo que no se pueda integrar.
- Las vulnerabilidades de seguridad **no** se reportan en issues: sigue la [política de seguridad](SECURITY.md).

## Licencia de las contribuciones

OpenSpend se distribuye bajo la [PolyForm Noncommercial License 1.0.0](LICENSE) y el mantenedor ofrece licencias
comerciales por separado. Para que eso sea posible, **al enviar una contribución (PR) aceptas que**:

1. Tu contribución se publica bajo la misma licencia del proyecto.
2. Otorgas al mantenedor del proyecto una licencia perpetua, mundial, gratuita e irrevocable para usar, modificar,
   sublicenciar y distribuir tu contribución, **incluso bajo licencias comerciales**.
3. Tienes derecho a hacer esa contribución (es tuya o tienes permiso de su autor).

Si no estás de acuerdo con estos términos, por favor no envíes la contribución.

## Entorno de desarrollo

Requiere Node 22+ y pnpm. Ver el [README](README.md#desarrollo-local) para el detalle.

```bash
nvm use
pnpm install
cp .dev.vars.example .dev.vars   # completa los valores (ver README)
pnpm db:migrate:local
pnpm dev                         # http://localhost:5173 (landing) y /app/
```

## Flujo de trabajo

1. Crea una rama desde `main` (por ejemplo `feature/descripcion-corta`).
2. Haz **commits semánticos** ([Conventional Commits](https://www.conventionalcommits.org/es/)):
   `feat:`, `fix:`, `docs:`, `test:`, `ci:`, `build:`, `chore:`, `refactor:`.
3. Antes de abrir el PR, corre lo mismo que el CI:
   ```bash
   pnpm typecheck && pnpm lint && pnpm test && pnpm build
   ```
4. Abre el PR contra `main` con un **título semántico** y completa la plantilla.

## Requisitos para mergear

`main` está protegida. Un PR solo se puede mergear si:

- Pasan los checks **Typecheck**, **Lint**, **Tests**, **Build** y **Secretos (gitleaks)**.
- CodeQL no reporta alertas de seguridad altas o críticas.
- La rama está al día con `main` (actualízala con **rebase**).
- El mantenedor lo aprueba y lo mergea (squash o rebase; no se aceptan merge commits).

## Pautas de código

- Mantén el estilo existente: TypeScript estricto, sin `any` innecesarios, comentarios solo donde aporten contexto.
- **Toda consulta a datos financieros debe filtrar por el usuario** y validar que las referencias (cuentas,
  categorías, lotes) le pertenezcan. Agrega tests de aislamiento para cualquier acceso nuevo a datos.
- Nunca subas secretos ni datos financieros reales (el hook de gitleaks y el `.gitignore` ayudan, pero revisa igual).
- Si el cambio afecta la app desplegada, actualiza `version` en `package.json`.
