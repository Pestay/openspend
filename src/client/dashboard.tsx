import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { getRouteApi, Link } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import { formatMoney, type Currency } from '../shared/money'
import type { Category, Transaction } from '../shared/types'
import {
  accountsQuery,
  categoriesQuery,
  summaryQuery,
  transactionsQuery,
  useCreateTransactions,
  useDeleteTransaction,
  useUpdateTransaction,
} from './api'
import { DEFAULT_PAGE_SIZE, formatDate, PAGE_SIZES, pageInfo, type PageSize } from './pagination'
import { editForm, transactionPatch, type EditForm as EditFormValues } from './transaction-edit'
import { LastReconciliation } from './reconcile-panel'
import { today } from './dates'
import { parsePeriod, periodLabel, periodRange, shiftPeriod, totalsByYear, type Bar, type Period, type View } from './period'
import { Button, Card, ErrorText, inputClass } from './ui'

const clp = (n: number) => formatMoney(n, 'CLP')

const route = getRouteApi('/')


const VIEWS: { view: View; label: string }[] = [
  { view: 'mes', label: 'Mes' },
  { view: 'anio', label: 'Año' },
  { view: 'todo', label: 'Todo' },
]

export function Dashboard() {
  const period = parsePeriod(route.useSearch(), today())
  const { from, to } = periodRange(period)

  return (
    <>
      <PeriodNav period={period} />
      <SummaryCards from={from} to={to} />
      {period.view !== 'mes' && <Evolution period={period} from={from} to={to} />}
      <div className="grid gap-6 md:grid-cols-2">
        <CategoryBreakdown from={from} to={to} />
        <Accounts />
      </div>
      <QuickAdd />
      {/* key: al cambiar de período, el paginador vuelve a la primera página. */}
      <TransactionList key={`${from}|${to}`} from={from} to={to} />
    </>
  )
}

// Selector Mes · Año · Todo y flechas para moverse (las vistas viven en la URL).
function PeriodNav({ period }: { period: Period }) {
  const prev = shiftPeriod(period, -1)
  const next = shiftPeriod(period, 1)
  const arrow = 'rounded px-2 py-1 hover:bg-slate-200'
  return (
    <nav className="flex flex-wrap items-center justify-center gap-4" aria-label="Período">
      <div className="flex rounded-lg border border-slate-200 bg-white p-0.5 text-sm">
        {VIEWS.map(({ view, label }) => (
          <Link
            key={view}
            to="/"
            search={view === 'mes' ? { vista: 'mes', mes: period.month } : view === 'anio' ? { vista: 'anio', anio: period.year } : { vista: 'todo' }}
            className={`rounded-md px-3 py-1 ${period.view === view ? 'bg-emerald-700 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            {label}
          </Link>
        ))}
      </div>
      <div className="flex items-center gap-2">
        {prev && (
          <Link to="/" search={prev} className={arrow} aria-label="Anterior">
            ←
          </Link>
        )}
        <span className="min-w-44 text-center font-medium capitalize">{periodLabel(period)}</span>
        {next && (
          <Link to="/" search={next} className={arrow} aria-label="Siguiente">
            →
          </Link>
        )}
      </div>
    </nav>
  )
}

// Ingresos vs gastos por mes (vista año) o por año (vista todo).
function Evolution({ period, from, to }: { period: Period; from: string; to: string }) {
  const { data } = useSuspenseQuery(summaryQuery(from, to))
  const bars: Bar[] =
    period.view === 'anio'
      ? data.byMonth.map((m) => ({
          label: new Date(`${m.month}-15T12:00:00Z`).toLocaleDateString('es-CL', { month: 'short', timeZone: 'UTC' }),
          incomeClp: m.incomeClp,
          expenseClp: m.expenseClp,
        }))
      : totalsByYear(data.byMonth)
  const max = Math.max(1, ...bars.flatMap((b) => [b.incomeClp, b.expenseClp]))
  return (
    <Card title={period.view === 'anio' ? 'Evolución mensual' : 'Evolución anual'}>
      {bars.length === 0 ? (
        <p className="text-sm text-slate-400">Sin movimientos en este período.</p>
      ) : (

        <ul className="space-y-2">
          {bars.map((b) => (
            <li key={b.label} className="grid grid-cols-[3.5rem_1fr_auto] items-center gap-3 text-sm">
              <span className="capitalize text-slate-500">{b.label}</span>
              <span className="space-y-1">
                <span className="block h-2 rounded bg-emerald-400" style={{ width: `${(b.incomeClp / max) * 100}%` }} />
                <span className="block h-2 rounded bg-rose-400" style={{ width: `${(b.expenseClp / max) * 100}%` }} />
              </span>
              <span className="text-right text-xs tabular-nums">
                <span className="block text-emerald-700">+{clp(b.incomeClp)}</span>
                <span className="block text-rose-700">−{clp(b.expenseClp)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

// Esqueleto con la misma forma que el dashboard, mientras llegan los datos de otro mes.
export function DashboardSkeleton() {
  const block = 'animate-pulse rounded-xl border border-slate-200 bg-white'
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="mx-auto h-8 w-56 animate-pulse rounded bg-slate-200" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className={`${block} h-24`} />
        ))}
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <div className={`${block} h-48`} />
        <div className={`${block} h-48`} />
      </div>
      <div className={`${block} h-28`} />
      <div className={`${block} h-64`} />
    </div>
  )
}

function SummaryCards({ from, to }: { from: string; to: string }) {
  const { data } = useSuspenseQuery(summaryQuery(from, to))
  const items = [
    { label: 'Ingresos', value: data.incomeClp, className: 'text-emerald-600' },
    { label: 'Gastos', value: data.expenseClp, className: 'text-rose-600' },
    { label: 'Neto', value: data.netClp, className: data.netClp >= 0 ? 'text-emerald-600' : 'text-rose-600' },
  ]
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      {items.map((item) => (
        <Card key={item.label} title={item.label}>
          <p className={`text-2xl font-semibold tabular-nums ${item.className}`}>
            {clp(item.value)}
          </p>
        </Card>
      ))}
    </div>
  )
}

function CategoryBreakdown({ from, to }: { from: string; to: string }) {
  const { data } = useSuspenseQuery(summaryQuery(from, to))
  const expenses = data.byCategory.filter((c) => c.kind === 'expense')
  const max = Math.max(1, ...expenses.map((c) => c.totalClp))
  return (
    <Card title="Gastos por categoría">
      {expenses.length === 0 ? (
        <p className="text-sm text-slate-400">Sin gastos en este período.</p>
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
  const { data } = useSuspenseQuery(accountsQuery)
  return (
    <Card title="Cuentas">
      <ul className="divide-y divide-slate-100">
        {data
          .filter((a) => !a.archived)
          .map((a) => (
            <li key={a.id} className="flex items-start justify-between gap-2 py-2 text-sm">
              <span>
                {a.name}
                <span className="block">
                  <LastReconciliation account={a} />
                </span>
              </span>
              <span className="tabular-nums">{formatMoney(a.balanceMinor, a.currency)}</span>
            </li>
          ))}
      </ul>
    </Card>
  )
}

function QuickAdd() {
  const { data: categories } = useSuspenseQuery(categoriesQuery)
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

  const options = categories.filter((c) => c.kind === kind)
  const input = inputClass

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
        <Button disabled={create.isPending}>Guardar</Button>
      </form>
      <ErrorText error={create.error} />
      {warning && <p className="mt-2 text-sm text-amber-600">{warning}</p>}
    </Card>
  )
}

function TransactionList({ from, to }: { from: string; to: string }) {
  const [page, setPage] = useState(0)
  const [size, setSize] = useState<PageSize>(DEFAULT_PAGE_SIZE)
  const { data, isFetching } = useQuery(transactionsQuery(from, to, page, size))
  const transactions = data?.items ?? []
  const info = pageInfo(data?.total ?? 0, page, size)
  const { data: categories } = useSuspenseQuery(categoriesQuery)
  const categoryById = new Map(categories.map((c) => [c.id, c]))
  // El resumen es solo lectura; editar y eliminar requieren entrar al modo edición.
  const [editMode, setEditMode] = useState(false)

  return (
    <Card
      title="Movimientos"
      action={
        data && data.total > 0 ? (
          <Button variant={editMode ? 'primary' : 'secondary'} onClick={() => setEditMode((v) => !v)}>
            {editMode ? 'Listo' : 'Editar'}
          </Button>
        ) : undefined
      }
    >
      {!data ? (
        <p className="text-sm text-slate-400">Cargando…</p>
      ) : data.total === 0 ? (
        <p className="text-sm text-slate-400">Sin movimientos en este período.</p>
      ) : (
        <>
        <ul className={`divide-y divide-slate-100 ${isFetching ? 'opacity-60' : ''}`}>
          {transactions.map((t) => (
            <TransactionRow
              key={t.id}
              transaction={t}
              category={t.categoryId ? categoryById.get(t.categoryId) : undefined}
              categories={categories}
              editMode={editMode}
            />
          ))}
        </ul>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3 text-sm text-slate-500">
          <label className="flex items-center gap-2">
            Mostrar
            <select
              className={inputClass}
              value={size}
              onChange={(e) => {
                setSize(Number(e.target.value) as PageSize)
                setPage(0)
              }}
            >
              {PAGE_SIZES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            por página
          </label>
          <span className="tabular-nums">
            {info.from}–{info.to} de {data?.total.toLocaleString('es-CL')}
          </span>
          <span className="flex items-center gap-1">
            <Button variant="ghost" disabled={!info.hasPrev} onClick={() => setPage(0)} aria-label="Primera página">
              «
            </Button>
            <Button variant="ghost" disabled={!info.hasPrev} onClick={() => setPage((p) => p - 1)}>
              ← Anterior
            </Button>
            <span className="tabular-nums">
              {page + 1} / {info.pages}
            </span>
            <Button variant="ghost" disabled={!info.hasNext} onClick={() => setPage((p) => p + 1)}>
              Siguiente →
            </Button>
            <Button variant="ghost" disabled={!info.hasNext} onClick={() => setPage(info.pages - 1)} aria-label="Última página">
              »
            </Button>
          </span>
        </div>
        </>
      )}
    </Card>
  )
}

// --- Fila de movimiento: solo lectura, o con acciones en el modo edición ---

function TransactionRow({
  transaction: t,
  category,
  categories,
  editMode,
}: {
  transaction: Transaction
  category: Category | undefined
  categories: Category[]
  editMode: boolean
}) {
  const [mode, setMode] = useState<'view' | 'edit' | 'delete'>('view')
  const remove = useDeleteTransaction()
  const sign = t.kind === 'income' ? '+' : t.kind === 'expense' ? '−' : ''
  const active = editMode ? mode : 'view'

  return (
    <li className="py-2 text-sm">
      <div className="flex items-center gap-3">
        <span className="w-24 shrink-0 text-slate-400 tabular-nums">{formatDate(t.date)}</span>
        <span className="shrink-0">{category?.icon ?? '•'}</span>
        <span className="min-w-0 flex-1 truncate">
          {t.description ?? t.merchant ?? category?.name ?? '—'}
          {t.possibleDuplicateOf && <span className="ml-2 rounded bg-amber-100 px-1.5 text-xs text-amber-700">¿duplicado?</span>}
        </span>
        <span className={`tabular-nums ${t.kind === 'income' ? 'text-emerald-600' : t.kind === 'expense' ? 'text-rose-600' : ''}`}>
          {sign}
          {formatMoney(t.amountMinor, t.currency)}
        </span>
        {editMode &&
          (active === 'delete' ? (
            <span className="flex items-center gap-1">
              <span className="text-xs text-slate-500">¿Eliminar?</span>
              <Button variant="danger" disabled={remove.isPending} onClick={() => remove.mutate(t.id)}>
                Sí
              </Button>
              <Button variant="ghost" onClick={() => setMode('view')}>
                No
              </Button>
            </span>
          ) : (
            <span className="flex items-center gap-1">
              <Button variant="ghost" onClick={() => setMode(active === 'edit' ? 'view' : 'edit')}>
                Editar
              </Button>
              <Button variant="ghost" onClick={() => setMode('delete')}>
                Eliminar
              </Button>
            </span>
          ))}
      </div>
      {active === 'edit' && <EditForm transaction={t} categories={categories} onClose={() => setMode('view')} />}
      <ErrorText error={remove.error} />
    </li>
  )
}

function EditForm({ transaction, categories, onClose }: { transaction: Transaction; categories: Category[]; onClose: () => void }) {
  const [form, setForm] = useState<EditFormValues>(() => editForm(transaction))
  const [error, setError] = useState<string | null>(null)
  const update = useUpdateTransaction()
  const set = (key: keyof EditFormValues) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }))

  async function onSave(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const result = transactionPatch(transaction, form)
    if (!result.ok) return setError(result.error)
    if (Object.keys(result.patch).length > 0) await update.mutateAsync({ id: transaction.id, ...result.patch })
    onClose()
  }

  return (
    <form onSubmit={onSave} className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 p-2">
      <input className={inputClass} type="date" value={form.date} onChange={set('date')} required />
      <input className={`${inputClass} w-32`} inputMode="decimal" value={form.amount} onChange={set('amount')} aria-label="Monto" />
      <select className={inputClass} value={form.categoryId} onChange={set('categoryId')} aria-label="Categoría">
        <option value="">Sin categoría</option>
        {categories
          .filter((c) => c.kind === transaction.kind)
          .map((c) => (
            <option key={c.id} value={c.id}>
              {c.icon} {c.name}
            </option>
          ))}
      </select>
      <input className={`${inputClass} min-w-40 flex-1`} value={form.description} onChange={set('description')} placeholder="Descripción" />
      <Button disabled={update.isPending}>Guardar</Button>
      <Button type="button" variant="ghost" onClick={onClose}>
        Cancelar
      </Button>
      {(error || update.error) && <span className="w-full text-xs text-rose-600">{error ?? update.error?.message}</span>}
    </form>
  )
}
