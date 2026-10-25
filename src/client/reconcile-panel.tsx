import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { formatMoney, type Currency } from '../shared/money'
import type { AccountWithBalance } from '../shared/types'
import { reconciliationsQuery, useDeleteReconciliation, useReconcile, useReconciliationPreview } from './api'
import { today } from './dates'
import { differenceLabel, parseAmountInput } from './reconcile-logic'
import { Button, ErrorText, inputClass } from './ui'

const toneClass = { ok: 'text-emerald-700', warn: 'text-amber-700' } as const

/** Resumen de la última conciliación de una cuenta (para listas de cuentas). */
export function LastReconciliation({ account }: { account: AccountWithBalance }) {
  const last = account.lastReconciliation
  if (!last) return <span className="text-xs text-slate-400">Sin conciliar</span>
  const label = differenceLabel(last.differenceMinor, account.currency)
  return (
    <span className="text-xs text-slate-500">
      Conciliada el {last.date} · <span className={toneClass[label.tone]}>{label.text}</span>
    </span>
  )
}

/** Formulario para conciliar una cuenta: saldo real, fecha y nota, con la diferencia en vivo. */
export function ReconcilePanel({ account, onDone }: { account: AccountWithBalance; onDone: () => void }) {
  const [date, setDate] = useState(today())
  const [balanceText, setBalanceText] = useState('')
  const [note, setNote] = useState('')
  const currency = account.currency as Currency
  const balance = parseAmountInput(balanceText, currency)
  const preview = useReconciliationPreview(balance === null ? null : { accountId: account.id, date, balance })
  const reconcile = useReconcile()
  const label = preview.data ? differenceLabel(preview.data.differenceMinor, currency) : null

  async function onSubmit() {
    if (balance === null) return
    await reconcile.mutateAsync({ accountId: account.id, date, balance, note: note || undefined })
    onDone()
  }

  return (
    <div className="mt-2 space-y-3 rounded-lg border border-emerald-200 bg-emerald-50/40 p-3 text-sm">
      <p className="font-medium">Conciliar “{account.name}”: ¿cuál es el saldo real según tu banco o billetera?</p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          className={`${inputClass} w-40`}
          inputMode="decimal"
          placeholder={currency === 'CLP' ? 'Ej. 1.234.567' : 'Ej. 1.234,56'}
          value={balanceText}
          onChange={(e) => setBalanceText(e.target.value)}
          autoFocus
        />
        <label className="flex items-center gap-1 text-slate-500">
          al cierre del
          <input className={inputClass} type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
        </label>
        <input className={`${inputClass} min-w-40 flex-1`} placeholder="Nota (opcional), ej. Cartola octubre" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      {balanceText && balance === null && <p className="text-xs text-rose-600">Escribe un monto válido</p>}
      {preview.data && label && (
        <div className="grid gap-2 sm:grid-cols-3">
          <Stat label="Calculado por OpenSpend" value={formatMoney(preview.data.calculatedMinor, currency)} />
          <Stat label="Saldo real" value={formatMoney(preview.data.balanceMinor, currency)} />
          <div className="rounded bg-white px-3 py-2">
            <p className="text-xs text-slate-500">Diferencia sin registrar</p>
            <p className={`font-medium ${toneClass[label.tone]}`}>{label.text}</p>
          </div>
        </div>
      )}
      <ErrorText error={preview.error ?? reconcile.error} />
      <div className="flex gap-2">
        <Button disabled={balance === null || reconcile.isPending} onClick={onSubmit}>
          Conciliar
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancelar
        </Button>
      </div>
      <p className="text-xs text-slate-500">
        La conciliación no crea movimientos ni cambia tus estadísticas: desde esa fecha, el saldo parte del monto real.
      </p>
    </div>
  )
}

/** Historial de conciliaciones de una cuenta, con opción de eliminar. */
export function ReconciliationHistory({ account }: { account: AccountWithBalance }) {
  const { data = [] } = useQuery(reconciliationsQuery(account.id))
  const remove = useDeleteReconciliation()
  if (data.length === 0) return <p className="mt-2 text-xs text-slate-400">Esta cuenta no tiene conciliaciones.</p>
  return (
    <ul className="mt-2 divide-y divide-slate-100 rounded border border-slate-200 bg-white text-xs">
      {data.map((r) => {
        const label = differenceLabel(r.differenceMinor, account.currency)
        return (
          <li key={r.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
            <span className="w-24 tabular-nums text-slate-500">{r.date}</span>
            <span className="tabular-nums">{formatMoney(r.balanceMinor, account.currency)}</span>
            <span className={`flex-1 ${toneClass[label.tone]}`}>{label.text}</span>
            {r.note && <span className="text-slate-400">{r.note}</span>}
            <Button variant="ghost" disabled={remove.isPending} onClick={() => remove.mutate(r.id)}>
              Eliminar
            </Button>
          </li>
        )
      })}
    </ul>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-white px-3 py-2">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="font-medium tabular-nums">{value}</p>
    </div>
  )
}
