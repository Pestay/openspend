import { useSuspenseQuery } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { formatMoney, fromMinor, type Currency } from '../shared/money'
import { ACCOUNT_TYPES } from '../shared/schemas'
import type { AccountWithBalance } from '../shared/types'
import { accountsQuery, useCreateAccount, useDeleteAccount, useUpdateAccount } from './api'
import { LastReconciliation, ReconcilePanel, ReconciliationHistory } from './reconcile-panel'
import { Button, Card, ErrorText, inputClass } from './ui'

type AccountType = (typeof ACCOUNT_TYPES)[number]

const TYPE_LABEL: Record<AccountType, string> = {
  bank: 'Cuenta bancaria',
  cash: 'Efectivo',
  credit_card: 'Tarjeta de crédito',
  savings: 'Ahorro',
  investment: 'Inversión',
}

function TypeSelect({ defaultValue = 'bank' }: { defaultValue?: string }) {
  return (
    <select className={inputClass} name="type" defaultValue={defaultValue}>
      {ACCOUNT_TYPES.map((t) => (
        <option key={t} value={t}>
          {TYPE_LABEL[t]}
        </option>
      ))}
    </select>
  )
}

export function AccountsPage() {
  const { data: accounts } = useSuspenseQuery(accountsQuery)
  const active = accounts.filter((a) => !a.archived)
  const archived = accounts.filter((a) => a.archived)
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Cuentas</h1>
      <NewAccount />
      <Card title="Activas">
        <ul className="divide-y divide-slate-100">
          {active.map((a) => (
            <AccountRow key={a.id} account={a} isLastActive={active.length === 1} />
          ))}
        </ul>
      </Card>
      {archived.length > 0 && (
        <Card title="Archivadas">
          <ul className="divide-y divide-slate-100">
            {archived.map((a) => (
              <AccountRow key={a.id} account={a} isLastActive={false} />
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}

function NewAccount() {
  const create = useCreateAccount()
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const data = new FormData(form)
    await create.mutateAsync({
      name: String(data.get('name')),
      type: data.get('type') as AccountType,
      currency: data.get('currency') as Currency,
      initialBalance: Number(data.get('initialBalance') || 0),
    })
    form.reset()
  }
  return (
    <Card title="Nueva cuenta">
      <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-2">
        <input className={`${inputClass} min-w-40 flex-1`} name="name" placeholder="Nombre (ej. Tarjeta Visa)" required />
        <TypeSelect />
        <select className={inputClass} name="currency" defaultValue="CLP">
          <option>CLP</option>
          <option>USD</option>
        </select>
        <input className={`${inputClass} w-36`} name="initialBalance" type="number" step="any" placeholder="Saldo inicial" />
        <Button disabled={create.isPending}>Agregar</Button>
      </form>
      <ErrorText error={create.error} />
    </Card>
  )
}

function AccountRow({ account, isLastActive }: { account: AccountWithBalance; isLastActive: boolean }) {
  const [editing, setEditing] = useState(false)
  const [panel, setPanel] = useState<'reconcile' | 'history' | null>(null)
  const toggle = (next: 'reconcile' | 'history') => setPanel((p) => (p === next ? null : next))
  const update = useUpdateAccount()
  const remove = useDeleteAccount()
  const error = update.error ?? remove.error

  if (editing) {
    const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault()
      const data = new FormData(e.currentTarget)
      await update.mutateAsync({
        id: account.id,
        name: String(data.get('name')),
        type: data.get('type') as AccountType,
        initialBalance: Number(data.get('initialBalance') || 0),
      })
      setEditing(false)
    }
    return (
      <li className="py-2">
        <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-2">
          <input className={`${inputClass} min-w-32 flex-1`} name="name" defaultValue={account.name} required autoFocus />
          <TypeSelect defaultValue={account.type} />
          <label className="flex items-center gap-1 text-sm text-slate-500">
            Saldo inicial
            <input
              className={`${inputClass} w-32`}
              name="initialBalance"
              type="number"
              step="any"
              defaultValue={fromMinor(account.initialBalanceMinor, account.currency)}
            />
          </label>
          <Button disabled={update.isPending}>Guardar</Button>
          <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
            Cancelar
          </Button>
        </form>
        <ErrorText error={update.error} />
      </li>
    )
  }

  return (
    <li className="py-2">
      <div className="group flex flex-wrap items-center gap-3 text-sm">
        <span className="min-w-0 flex-1">
          <span className="font-medium">{account.name}</span>
          <span className="ml-2 text-xs text-slate-400">
            {TYPE_LABEL[account.type as AccountType] ?? account.type} · {account.currency} · {account.transactionCount} mov.
          </span>
          <span className="block">
            <LastReconciliation account={account} />
          </span>
        </span>
        <span className="tabular-nums">{formatMoney(account.balanceMinor, account.currency)}</span>
        <span className="flex gap-1">
          {!account.archived && (
            <Button variant="secondary" onClick={() => toggle('reconcile')}>
              Conciliar
            </Button>
          )}
          <Button variant="ghost" onClick={() => toggle('history')}>
            Historial
          </Button>
        </span>
        <span className="flex gap-1 sm:opacity-0 sm:group-hover:opacity-100">
          <Button variant="ghost" onClick={() => setEditing(true)}>
            Editar
          </Button>
          <Button
            variant="ghost"
            disabled={update.isPending || (!account.archived && isLastActive)}
            title={!account.archived && isLastActive ? 'Debe quedar al menos una cuenta activa' : undefined}
            onClick={() => update.mutate({ id: account.id, archived: !account.archived })}
          >
            {account.archived ? 'Reactivar' : 'Archivar'}
          </Button>
          <Button
            variant="ghost"
            disabled={remove.isPending || account.transactionCount > 0 || isLastActive}
            title={account.transactionCount > 0 ? 'Tiene movimientos: archívala en vez de eliminarla' : undefined}
            onClick={() => remove.mutate(account.id)}
          >
            Eliminar
          </Button>
        </span>
      </div>
      {panel === 'reconcile' && <ReconcilePanel account={account} onDone={() => setPanel(null)} />}
      {panel === 'history' && <ReconciliationHistory account={account} />}
      <ErrorText error={error} />
    </li>
  )
}
