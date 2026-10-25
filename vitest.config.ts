import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'

export default defineConfig(async () => ({
  test: {
    projects: [
      {
        // Worker, API, MCP y servicios: corren dentro del runtime de Workers con D1 local.
        plugins: [
          cloudflareTest({
            wrangler: { configPath: './wrangler.jsonc' },
            miniflare: {
              // Valores ficticios: los tests no dependen de .dev.vars ni de servicios externos.
              bindings: {
                TEST_MIGRATIONS: await readD1Migrations('./db/migrations'),
                PUBLIC_URL: 'http://localhost',
                SESSION_SECRET: 'test-session-secret-0123456789abcdef',
                AUTH0_DOMAIN: 'test.auth0.invalid',
                AUTH0_CLIENT_ID: 'test-client',
                AUTH0_CLIENT_SECRET: 'test-secret',
              },
            },
          }),
        ],
        test: { name: 'worker', include: ['test/**/*.test.ts'], setupFiles: ['./test/setup.ts'] },
      },
      {
        // Lógica pura del cliente (sin DOM).
        test: { name: 'client', include: ['src/client/**/*.test.ts'], environment: 'node' },
      },
    ],
  },
}))
