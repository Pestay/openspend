import { useSuspenseQuery } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import type { Category } from '../shared/types'
import { categoriesQuery, useCreateCategory, useDeleteCategory, useUpdateCategory } from './api'
import { Button, Card, ErrorText, inputClass } from './ui'

const KIND_LABEL = { expense: 'Gastos', income: 'Ingresos' } as const
const DEFAULT_COLOR = '#94a3b8'

export function CategoriesPage() {
  const { data: categories } = useSuspenseQuery(categoriesQuery)
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Categorías</h1>
      <NewCategory />
      <div className="grid gap-6 md:grid-cols-2">
        {(['expense', 'income'] as const).map((kind) => (
          <Card key={kind} title={KIND_LABEL[kind]}>
            <ul className="divide-y divide-slate-100">
              {categories
                .filter((c) => c.kind === kind)
                .map((c) => (
                  <CategoryRow key={c.id} category={c} siblings={categories.filter((o) => o.kind === kind && o.id !== c.id)} />
                ))}
            </ul>
          </Card>
        ))}
      </div>
    </div>
  )
}

function NewCategory() {
  const create = useCreateCategory()
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const data = new FormData(form)
    await create.mutateAsync({
      kind: data.get('kind') as 'expense' | 'income',
      name: String(data.get('name')),
      icon: String(data.get('icon')) || undefined,
      color: String(data.get('color')),
    })
    form.reset()
  }
  return (
    <Card title="Nueva categoría">
      <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-2">
        <select className={inputClass} name="kind" defaultValue="expense">
          <option value="expense">Gasto</option>
          <option value="income">Ingreso</option>
        </select>
        <input className={`${inputClass} w-14 text-center`} name="icon" placeholder="🙂" maxLength={8} />
        <input className={`${inputClass} min-w-40 flex-1`} name="name" placeholder="Nombre" required />
        <input className="h-9 w-10 cursor-pointer rounded border border-slate-300" type="color" name="color" defaultValue={DEFAULT_COLOR} />
        <Button disabled={create.isPending}>Agregar</Button>
      </form>
      <ErrorText error={create.error} />
    </Card>
  )
}

function CategoryRow({ category, siblings }: { category: Category; siblings: Category[] }) {
  const [mode, setMode] = useState<'view' | 'edit' | 'delete'>('view')
  const update = useUpdateCategory()
  const remove = useDeleteCategory()

  if (mode === 'edit') {
    const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault()
      const data = new FormData(e.currentTarget)
      await update.mutateAsync({
        id: category.id,
        name: String(data.get('name')),
        icon: String(data.get('icon')) || null,
        color: String(data.get('color')),
      })
      setMode('view')
    }
    return (
      <li className="py-2">
        <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-2">
          <input className={`${inputClass} w-14 text-center`} name="icon" defaultValue={category.icon ?? ''} maxLength={8} />
          <input className={`${inputClass} min-w-32 flex-1`} name="name" defaultValue={category.name} required autoFocus />
          <input
            className="h-9 w-10 cursor-pointer rounded border border-slate-300"
            type="color"
            name="color"
            defaultValue={category.color ?? DEFAULT_COLOR}
          />
          <Button disabled={update.isPending}>Guardar</Button>
          <Button type="button" variant="ghost" onClick={() => setMode('view')}>
            Cancelar
          </Button>
        </form>
        <ErrorText error={update.error} />
      </li>
    )
  }

  if (mode === 'delete') {
    const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault()
      const target = new FormData(e.currentTarget).get('reassignTo')
      await remove.mutateAsync({
        id: category.id,
        reassignTo: category.transactionCount === 0 ? undefined : target === 'none' ? null : Number(target),
      })
    }
    return (
      <li className="space-y-2 py-2">
        <p className="text-sm">
          ¿Eliminar <strong>{category.icon} {category.name}</strong>?
        </p>
        <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-2">
          {category.transactionCount > 0 && (
            <label className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
              Mover sus {category.transactionCount} movimiento(s) a
              <select className={inputClass} name="reassignTo" defaultValue={siblings[0]?.id ?? 'none'}>
                {siblings.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.icon} {s.name}
                  </option>
                ))}
                <option value="none">Sin categoría</option>
              </select>
            </label>
          )}
          <Button variant="danger" disabled={remove.isPending}>
            Eliminar
          </Button>
          <Button type="button" variant="ghost" onClick={() => setMode('view')}>
            Cancelar
          </Button>
        </form>
        <ErrorText error={remove.error} />
      </li>
    )
  }

  return (
    <li className="group flex items-center gap-3 py-2 text-sm">
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: category.color ?? DEFAULT_COLOR }} />
      <span className="w-6 shrink-0 text-center">{category.icon ?? '•'}</span>
      <span className="min-w-0 flex-1 truncate">{category.name}</span>
      <span className="text-xs text-slate-400 tabular-nums">{category.transactionCount} mov.</span>
      <span className="flex gap-1 sm:opacity-0 sm:group-hover:opacity-100">
        <Button variant="ghost" onClick={() => setMode('edit')}>
          Editar
        </Button>
        <Button variant="ghost" onClick={() => setMode('delete')}>
          Eliminar
        </Button>
      </span>
    </li>
  )
}
