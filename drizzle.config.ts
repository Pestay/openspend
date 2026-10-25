import { defineConfig } from 'drizzle-kit'

// Solo se usa para generar migraciones SQL; se aplican con `wrangler d1 migrations apply`.
export default defineConfig({
  dialect: 'sqlite',
  schema: './db/schema.ts',
  out: './db/migrations',
})
