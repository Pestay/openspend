// Categorías con las que parte cada usuario nuevo (luego puede editarlas o crear más).
const DEFAULT_CATEGORIES: { name: string; kind: 'expense' | 'income'; icon: string; color: string }[] = [
  { name: 'Comida y restaurantes', kind: 'expense', icon: '🍽️', color: '#f97316' },
  { name: 'Supermercado', kind: 'expense', icon: '🛒', color: '#84cc16' },
  { name: 'Transporte', kind: 'expense', icon: '🚗', color: '#0ea5e9' },
  { name: 'Vivienda', kind: 'expense', icon: '🏠', color: '#8b5cf6' },
  { name: 'Cuentas y servicios', kind: 'expense', icon: '💡', color: '#eab308' },
  { name: 'Salud', kind: 'expense', icon: '🩺', color: '#ef4444' },
  { name: 'Shopping', kind: 'expense', icon: '🛍️', color: '#ec4899' },
  { name: 'Entretenimiento', kind: 'expense', icon: '🎬', color: '#a855f7' },
  { name: 'Suscripciones', kind: 'expense', icon: '🔁', color: '#6366f1' },
  { name: 'Viajes', kind: 'expense', icon: '✈️', color: '#14b8a6' },
  { name: 'Educación', kind: 'expense', icon: '📚', color: '#3b82f6' },
  { name: 'Deporte', kind: 'expense', icon: '🏋️', color: '#22c55e' },
  { name: 'Familia', kind: 'expense', icon: '👨‍👩‍👧', color: '#f43f5e' },
  { name: 'Mascotas', kind: 'expense', icon: '🐾', color: '#d97706' },
  { name: 'Regalos', kind: 'expense', icon: '🎁', color: '#db2777' },
  { name: 'Impuestos y comisiones', kind: 'expense', icon: '🧾', color: '#64748b' },
  { name: 'Otros gastos', kind: 'expense', icon: '📦', color: '#94a3b8' },
  { name: 'Sueldo', kind: 'income', icon: '💼', color: '#16a34a' },
  { name: 'Freelance', kind: 'income', icon: '🧑‍💻', color: '#0d9488' },
  { name: 'Inversiones', kind: 'income', icon: '📈', color: '#2563eb' },
  { name: 'Reembolsos', kind: 'income', icon: '↩️', color: '#7c3aed' },
  { name: 'Regalos recibidos', kind: 'income', icon: '🎁', color: '#c026d3' },
  { name: 'Otros ingresos', kind: 'income', icon: '💰', color: '#65a30d' },
]

/**
 * Registra al usuario en su primer login y le crea sus categorías y una cuenta
 * "Principal". Es idempotente y atómico (un batch de D1 corre en una transacción):
 * en logins siguientes solo actualiza el email.
 */
export async function ensureUser(d1: D1Database, user: { id: string; email: string }) {
  await d1.batch([
    d1
      .prepare('INSERT INTO users (id, email) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET email = excluded.email')
      .bind(user.id, user.email),
    d1
      .prepare(
        `INSERT INTO categories (user_id, name, kind, icon, color)
         SELECT ?1, value ->> 'name', value ->> 'kind', value ->> 'icon', value ->> 'color' FROM json_each(?2)
         WHERE NOT EXISTS (SELECT 1 FROM categories WHERE user_id = ?1)`,
      )
      .bind(user.id, JSON.stringify(DEFAULT_CATEGORIES)),
    d1
      .prepare(
        `INSERT INTO accounts (user_id, name, type, currency)
         SELECT ?1, 'Principal', 'bank', 'CLP' WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE user_id = ?1)`,
      )
      .bind(user.id),
  ])
}

// Activo = existe y no está suspendido. Se revisa en cada request del dashboard y del MCP,
// así una suspensión corta el acceso de inmediato aunque haya sesiones o tokens vigentes.
export async function isActiveUser(d1: D1Database, id: string): Promise<boolean> {
  return Boolean(await d1.prepare('SELECT 1 FROM users WHERE id = ? AND suspended_at IS NULL').bind(id).first())
}
