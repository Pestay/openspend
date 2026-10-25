import { CURRENCIES, type Currency } from '../money'
import { parseCsv } from './csv'
import type { CategoryHint, ImportAdapter, ImportedTransaction } from './types'

// Export CSV de Spendee (un archivo por billetera):
// Date,Wallet,Type,"Category name",Amount,Currency,Note,Labels,Author
// Date viene en UTC (2025-11-01T15:56:03+00:00); Amount es negativo en los gastos.
const REQUIRED_COLUMNS = ['Date', 'Wallet', 'Type', 'Category name', 'Amount', 'Currency']

const chileDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' })

// Categorías estándar de Spendee → categorías por defecto de OpenSpend.
const STANDARD: Record<'expense' | 'income', Record<string, string>> = {
  expense: {
    'food & drink': 'Comida y restaurantes',
    transport: 'Transporte',
    groceries: 'Supermercado',
    shopping: 'Shopping',
    other: 'Otros gastos',
    'bills & fees': 'Cuentas y servicios',
    'carga telefono': 'Cuentas y servicios',
    sports: 'Deporte',
    healthcare: 'Salud',
    streamings: 'Suscripciones',
    app: 'Suscripciones',
    gifts: 'Regalos',
    travel: 'Viajes',
    entertainment: 'Entretenimiento',
    'family & personal': 'Familia',
    estudios: 'Educación',
    education: 'Educación',
    home: 'Vivienda',
    pets: 'Mascotas',
  },
  income: {
    salary: 'Sueldo',
    other: 'Otros ingresos',
    isapre: 'Reembolsos',
    'insurance payout': 'Reembolsos',
    'dev impuestos': 'Reembolsos',
    refunds: 'Reembolsos',
    gifts: 'Regalos recibidos',
    'extra income': 'Freelance',
  },
}

// Categorías sin equivalente directo: nombre e ícono si se crean, y la categoría por defecto
// más cercana si el usuario prefiere no crear categorías nuevas.
const CUSTOM: Record<string, { name: string; icon: string; closest: string }> = {
  gaming: { name: 'Gaming', icon: '🎮', closest: 'Entretenimiento' },
  'herramientas web': { name: 'Herramientas web', icon: '🛠️', closest: 'Suscripciones' },
  auto: { name: 'Auto', icon: '🚙', closest: 'Transporte' },
  'plata perdida': { name: 'Plata perdida', icon: '💸', closest: 'Otros gastos' },
  'targeta de credito (extra)': { name: 'Tarjeta de crédito (extra)', icon: '💳', closest: 'Impuestos y comisiones' },
  caridad: { name: 'Caridad', icon: '🤝', closest: 'Regalos' },
  'transferencias de otros': { name: 'Transferencias recibidas', icon: '📥', closest: 'Otros ingresos' },
  'aguinaldos - bonos': { name: 'Aguinaldos y bonos', icon: '🎉', closest: 'Sueldo' },
}

function categoryHint(sourceCategory: string, kind: 'expense' | 'income'): CategoryHint {
  const key = sourceCategory.trim().toLowerCase()
  const fallback = kind === 'expense' ? 'Otros gastos' : 'Otros ingresos'
  const standard = STANDARD[kind][key]
  if (standard) return { standard, closest: standard }
  const custom = CUSTOM[key]
  if (custom) return { create: { name: custom.name, icon: custom.icon }, closest: custom.closest }
  // Categoría personalizada desconocida: se crea con el mismo nombre, en mayúscula inicial.
  const name = sourceCategory.trim()
  return { create: { name: name.charAt(0).toUpperCase() + name.slice(1) }, closest: fallback }
}

export const spendee: ImportAdapter = {
  id: 'spendee',
  label: 'Spendee (export CSV)',
  accept: '.csv',
  categoryHint,
  parse(files) {
    const transactions: ImportedTransaction[] = []
    const warnings: string[] = []

    for (const file of files) {
      const rows = parseCsv(file.content)
      const missing = REQUIRED_COLUMNS.filter((c) => rows.length > 0 && !(c in rows[0]))
      if (rows.length === 0 || missing.length > 0) {
        warnings.push(`${file.name}: no parece un export de Spendee${missing.length ? ` (faltan columnas: ${missing.join(', ')})` : ''}`)
        continue
      }

      rows.forEach((row, i) => {
        const line = `${file.name}, fila ${i + 2}`
        const when = new Date(row.Date)
        const amount = Number(row.Amount)
        const currency = row.Currency.toUpperCase()
        if (Number.isNaN(when.getTime())) return warnings.push(`${line}: fecha inválida "${row.Date}"`)
        if (!Number.isFinite(amount) || amount === 0) return warnings.push(`${line}: monto inválido "${row.Amount}"`)
        if (!(CURRENCIES as readonly string[]).includes(currency)) {
          return warnings.push(`${line}: moneda ${currency} no soportada (solo CLP y USD)`)
        }
        transactions.push({
          date: chileDate.format(when),
          // El signo manda: en Spendee los gastos son negativos.
          kind: amount < 0 ? 'expense' : 'income',
          amount: Math.abs(amount),
          currency: currency as Currency,
          description: row.Note || null,
          labels: (row.Labels ?? '').split(',').map((l) => l.trim()).filter(Boolean),
          sourceWallet: row.Wallet || 'Sin billetera',
          sourceCategory: row['Category name'] || 'Sin categoría',
        })
      })
    }
    return { transactions, warnings }
  },
}
