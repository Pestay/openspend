import { sql } from 'drizzle-orm'
import { index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

const createdAt = () =>
  text('created_at')
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`)

export const accounts = sqliteTable('accounts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  type: text('type', { enum: ['cash', 'bank', 'credit_card', 'savings', 'investment'] }).notNull().default('bank'),
  currency: text('currency', { enum: ['CLP', 'USD'] }).notNull().default('CLP'),
  initialBalanceMinor: integer('initial_balance_minor').notNull().default(0),
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  createdAt: createdAt(),
})

export const categories = sqliteTable('categories', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  kind: text('kind', { enum: ['expense', 'income'] }).notNull(),
  icon: text('icon'),
  color: text('color'),
  createdAt: createdAt(),
})

// Cada carga masiva (export de Spendee, una cartola, un lote desde el chat) queda
// registrada para poder revisarla o revertirla completa.
export const importBatches = sqliteTable('import_batches', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  source: text('source', { enum: ['manual', 'chat', 'spendee', 'statement'] }).notNull(),
  label: text('label').notNull(),
  status: text('status', { enum: ['active', 'reverted'] }).notNull().default('active'),
  createdAt: createdAt(),
})

export const transactions = sqliteTable(
  'transactions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    date: text('date').notNull(), // YYYY-MM-DD
    kind: text('kind', { enum: ['expense', 'income', 'transfer'] }).notNull(),
    amountMinor: integer('amount_minor').notNull(), // siempre positivo, en la moneda original
    currency: text('currency', { enum: ['CLP', 'USD'] }).notNull(),
    fxRate: real('fx_rate').notNull(), // CLP por unidad de la moneda (1 para CLP)
    amountClp: integer('amount_clp').notNull(), // monto convertido, usado en estadísticas
    accountId: integer('account_id')
      .notNull()
      .references(() => accounts.id),
    toAccountId: integer('to_account_id').references(() => accounts.id), // solo transferencias
    categoryId: integer('category_id').references(() => categories.id),
    description: text('description'),
    merchant: text('merchant'),
    source: text('source', { enum: ['manual', 'chat', 'spendee', 'statement'] }).notNull(),
    importBatchId: integer('import_batch_id').references(() => importBatches.id, { onDelete: 'cascade' }),
    possibleDuplicateOf: integer('possible_duplicate_of'),
    createdAt: createdAt(),
    updatedAt: text('updated_at'),
  },
  (t) => [
    index('transactions_date_idx').on(t.date),
    index('transactions_dedupe_idx').on(t.accountId, t.amountMinor, t.date),
    index('transactions_category_idx').on(t.categoryId),
    index('transactions_batch_idx').on(t.importBatchId),
  ],
)

// Caché del dólar observado (mindicador.cl). Solo contiene días hábiles: para fines de
// semana y feriados se usa el último valor anterior a la fecha.
export const exchangeRates = sqliteTable(
  'exchange_rates',
  {
    currency: text('currency', { enum: ['USD'] }).notNull(),
    date: text('date').notNull(),
    clpPerUnit: real('clp_per_unit').notNull(),
    fetchedAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.currency, t.date] })],
)
