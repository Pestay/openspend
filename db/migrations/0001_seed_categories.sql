-- Categorías iniciales (se pueden renombrar o agregar más desde la app o el chat).
INSERT INTO categories (name, kind, icon, color) VALUES
  ('Comida y restaurantes', 'expense', '🍽️', '#f97316'),
  ('Supermercado', 'expense', '🛒', '#84cc16'),
  ('Transporte', 'expense', '🚗', '#0ea5e9'),
  ('Vivienda', 'expense', '🏠', '#8b5cf6'),
  ('Cuentas y servicios', 'expense', '💡', '#eab308'),
  ('Salud', 'expense', '🩺', '#ef4444'),
  ('Shopping', 'expense', '🛍️', '#ec4899'),
  ('Entretenimiento', 'expense', '🎬', '#a855f7'),
  ('Suscripciones', 'expense', '🔁', '#6366f1'),
  ('Viajes', 'expense', '✈️', '#14b8a6'),
  ('Educación', 'expense', '📚', '#3b82f6'),
  ('Deporte', 'expense', '🏋️', '#22c55e'),
  ('Familia', 'expense', '👨‍👩‍👧', '#f43f5e'),
  ('Mascotas', 'expense', '🐾', '#d97706'),
  ('Regalos', 'expense', '🎁', '#db2777'),
  ('Impuestos y comisiones', 'expense', '🧾', '#64748b'),
  ('Otros gastos', 'expense', '📦', '#94a3b8'),
  ('Sueldo', 'income', '💼', '#16a34a'),
  ('Freelance', 'income', '🧑‍💻', '#0d9488'),
  ('Inversiones', 'income', '📈', '#2563eb'),
  ('Reembolsos', 'income', '↩️', '#7c3aed'),
  ('Regalos recibidos', 'income', '🎁', '#c026d3'),
  ('Otros ingresos', 'income', '💰', '#65a30d');
--> statement-breakpoint
INSERT INTO accounts (name, type, currency) VALUES ('Principal', 'bank', 'CLP');
