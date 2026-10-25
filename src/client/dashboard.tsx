import { useState, type FormEvent } from 'react'
import { formatMoney, type Currency } from '../shared/money'
import type { Category } from '../shared/types'
import {
  useAccounts,
  useCategories,
  useCreateTransactions,
  useDeleteTransaction,
  useMe,
  useSummary,
  useTransactions,
} from './api'

const clp = (n: number) => formatMoney(n, 'CLP')

function monthRange(month: string) {
  const [y, m] = month.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` }
}

function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + delta, 1))
  return d.toISOString().slice(0, 7)
}

function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date())
}

export function App() {
  const [month, setMonth] = useState(() => today().slice(0, 7))
  const { from, to } = monthRange(month)
  const monthLabel = new Date(`${month}-15`).toLocaleDateString('es-CL', { month: 'long', year: 'numeric' })

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <img src="/logo.svg" alt="" className="h-8 w-8" />
            OpenSpend
          </h1>
          <UserMenu />
          <div className="flex items-center gap-2">
            <button className="rounded px-2 py-1 hover:bg-slate-200" onClick={() => setMonth(shiftMonth(month, -1))}>
              ←
            </button>
            <span className="w-40 text-center font-medium capitalize">{monthLabel}</span>
            <button className="rounded px-2 py-1 hover:bg-slate-200" onClick={() => setMonth(shiftMonth(month, 1))}>
              →
            </button>
          </div>
        </header>

        <SummaryCards from={from} to={to} />
        <div className="grid gap-6 md:grid-cols-2">
          <CategoryBreakdown from={from} to={to} />
          <Accounts />
        </div>
        <QuickAdd />
        <TransactionList from={from} to={to} />
      </div>
    </div>
  )
}

function UserMenu() {
  const { data } = useMe()
  if (!data) return null
  return (
    <form method="post" action="/auth/logout" className="order-last flex items-center gap-2 text-sm text-slate-500 sm:order-none">
      <span>{data.email}</span>
      <button className="rounded px-2 py-1 hover:bg-slate-200">Salir</button>
    </form>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-medium text-slate-500">{title}</h2>
      {children}
    </section>
  )
}

function SummaryCards({ from, to }: { from: string; to: string }) {
  const { data } = useSummary(from, to)
  const items = [
    { label: 'Ingresos', value: data?.incomeClp, className: 'text-emerald-600' },
    { label: 'Gastos', value: data?.expenseClp, className: 'text-rose-600' },
    { label: 'Neto', value: data?.netClp, className: (data?.netClp ?? 0) >= 0 ? 'text-emerald-600' : 'text-rose-600' },
  ]
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      {items.map((item) => (
        <Card key={item.label} title={item.label}>
          <p className={`text-2xl font-semibold tabular-nums ${item.className}`}>
            {item.value === undefined ? '…' : clp(item.value)}
          </p>
        </Card>
      ))}
    </div>
  )
}

function CategoryBreakdown({ from, to }: { from: string; to: string }) {
  const { data } = useSummary(from, to)
  const expenses = data?.byCategory.filter((c) => c.kind === 'expense') ?? []
  const max = Math.max(1, ...expenses.map((c) => c.totalClp))
  return (
    <Card title="Gastos por categoría">
      {expenses.length === 0 ? (
        <p className="text-sm text-slate-400">Sin gastos este mes.</p>
      ) : (
        <ul className="space-y-2">
          {expenses.map((c) => (
            <li key={c.categoryId ?? 'none'}>
              <div className="flex justify-between text-sm">
                <span>{c.name}</span>
                <span className="tabular-nums">{clp(c.totalClp)}</span>
              </div>
              <div className="mt-1 h-1.5 rounded bg-slate-100">
                <div className="h-1.5 rounded bg-rose-400" style={{ width: `${(c.totalClp / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function Accounts() {
  const { data } = useAccounts()
  return (
    <Card title="Cuentas">
      <ul className="divide-y divide-slate-100">
        {data
          ?.filter((a) => !a.archived)
          .map((a) => (
            <li key={a.id} className="flex justify-between py-2 text-sm">
              <span>{a.name}</span>
              <span className="tabular-nums">{formatMoney(a.balanceMinor, a.currency)}</span>
            </li>
          ))}
      </ul>
    </Card>
  )
}

function QuickAdd() {
  const { data: categories } = useCategories()
  const create = useCreateTransactions()
  const [kind, setKind] = useState<'expense' | 'income'>('expense')
  const [warning, setWarning] = useState<string | null>(null)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const data = new FormData(form)
    const categoryId = Number(data.get('categoryId'))
    const result = await create.mutateAsync([
      {
        date: String(data.get('date')),
        kind,
        amount: Number(data.get('amount')),
        currency: data.get('currency') as Currency,
        categoryId: categoryId || undefined,
        description: String(data.get('description')) || undefined,
      },
    ])
    setWarning(result.duplicates.length > 0 ? 'Guardado, pero parece un duplicado de un movimiento existente.' : null)
    form.reset()
  }

  const options = categories?.filter((c: Category) => c.kind === kind) ?? []
  const input = 'rounded border border-slate-300 px-2 py-1.5 text-sm'

  return (
    <Card title="Agregar movimiento">
      <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-2">
        <select className={input} value={kind} onChange={(e) => setKind(e.target.value as 'expense' | 'income')}>
          <option value="expense">Gasto</option>
          <option value="income">Ingreso</option>
        </select>
        <input className={input} type="date" name="date" defaultValue={today()} required />
        <input className={`${input} w-32`} type="number" name="amount" step="any" min="0" placeholder="Monto" required />
        <select className={input} name="currency" defaultValue="CLP">
          <option>CLP</option>
          <option>USD</option>
        </select>
        <select className={input} name="categoryId" defaultValue="">
          <option value="">Categoría…</option>
          {options.map((c) => (
            <option key={c.id} value={c.id}>
              {c.icon} {c.name}
            </option>
          ))}
        </select>
        <input className={`${input} min-w-40 flex-1`} name="description" placeholder="Descripción" />
        <button
          className="rounded bg-emerald-700 px-3 py-1.5 text-sm text-white hover:bg-emerald-800 disabled:opacity-50"
          disabled={create.isPending}
        >
          Guardar
        </button>
      </form>
      {create.error && <p className="mt-2 text-sm text-rose-600">{create.error.message}</p>}
      {warning && <p className="mt-2 text-sm text-amber-600">{warning}</p>}
    </Card>
  )
}

function TransactionList({ from, to }: { from: string; to: string }) {
  const { data: transactions, isLoading } = useTransactions(from, to)
  const { data: categories } = useCategories()
  const remove = useDeleteTransaction()
  const categoryById = new Map(categories?.map((c) => [c.id, c]))

  return (
    <Card title="Movimientos">
      {isLoading ? (
        <p className="text-sm text-slate-400">Cargando…</p>
      ) : !transactions?.length ? (
        <p className="text-sm text-slate-400">Sin movimientos este mes.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {transactions.map((t) => {
            const category = t.categoryId ? categoryById.get(t.categoryId) : undefined
            const sign = t.kind === 'income' ? '+' : t.kind === 'expense' ? '−' : ''
            return (
              <li key={t.id} className="group flex items-center gap-3 py-2 text-sm">
                <span className="w-20 shrink-0 text-slate-400 tabular-nums">{t.date.slice(5)}</span>
                <span className="shrink-0">{category?.icon ?? '•'}</span>
                <span className="min-w-0 flex-1 truncate">
                  {t.description ?? t.merchant ?? category?.name ?? '—'}
                  {t.possibleDuplicateOf && (
                    <span className="ml-2 rounded bg-amber-100 px-1.5 text-xs text-amber-700">¿duplicado?</span>
                  )}
                </span>
                <span
                  className={`tabular-nums ${t.kind === 'income' ? 'text-emerald-600' : t.kind === 'expense' ? 'text-rose-600' : ''}`}
                >
                  {sign}
                  {formatMoney(t.amountMinor, t.currency)}
                </span>
                <button
                  className="text-slate-300 opacity-0 group-hover:opacity-100 hover:text-rose-600"
                  onClick={() => remove.mutate(t.id)}
                  title="Eliminar"
                >
                  ✕
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}
