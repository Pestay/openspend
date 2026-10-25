import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useState, type ChangeEvent, type ReactNode } from 'react'
import { ADAPTERS } from '../shared/importers'
import type { ImportedTransaction } from '../shared/importers/types'
import { formatMoney } from '../shared/money'
import type { ImportPreview, ImportResult } from '../shared/types'
import {
  accountsQuery,
  categoriesQuery,
  importsQuery,
  useChunkedImport,
  useImportPreview,
  useRevertImport,
  type ImportOptionsInput,
  type ImportProgress,
} from './api'
import {
  accountChoices,
  decodeTarget,
  encodeTarget,
  importBlockReason,
  newAccountNameError,
  newCategoryNames,
  stepNumbers,
} from './import-logic'
import { Button, Card, ErrorText, inputClass } from './ui'

const clp = (n: number) => formatMoney(n, 'CLP')

type Options = Required<ImportOptionsInput>

const DEFAULT_OPTIONS: Options = {
  accounts: {},
  categoryStrategy: 'hybrid',
  categoryOverrides: {},
  reconcileCategories: {},
  labels: 'append',
  duplicates: 'skip',
}

export function ImportPage() {
  const adapters = Object.values(ADAPTERS)
  const [adapter, setAdapter] = useState(adapters[0]?.id ?? '')
  // El archivo se convierte en movimientos aquí, en el navegador; al servidor solo llegan
  // movimientos normalizados (y nunca el archivo).
  const [parsed, setParsed] = useState<{ fileNames: string[]; rows: ImportedTransaction[]; warnings: string[] } | null>(null)
  const rows = parsed?.rows ?? []
  const fileNames = parsed?.fileNames ?? []
  const [options, setOptions] = useState<Options>(DEFAULT_OPTIONS)
  const [result, setResult] = useState<ImportResult | null>(null)
  // Billeteras con "Nueva cuenta" elegida pero con un nombre inválido: bloquean la importación.
  const [invalidWallets, setInvalidWallets] = useState<string[]>([])
  const preview = useImportPreview(adapter, fileNames, rows, options)
  const setWalletValid = (wallet: string, valid: boolean) =>
    setInvalidWallets((list) => (valid ? list.filter((w) => w !== wallet) : list.includes(wallet) ? list : [...list, wallet]))
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const run = useChunkedImport(setProgress)

  const set = <K extends keyof Options>(key: K, value: Options[K]) => setOptions((o) => ({ ...o, [key]: value }))

  async function onFiles(e: ChangeEvent<HTMLInputElement>) {
    const list = Array.from(e.target.files ?? [])
    const files = await Promise.all(list.map(async (f) => ({ name: f.name, content: await f.text() })))
    const { transactions, warnings } = ADAPTERS[adapter].parse(files)
    setParsed(files.length ? { fileNames: files.map((f) => f.name), rows: transactions, warnings } : null)
    setProgress(null)
    setOptions(DEFAULT_OPTIONS)
    setInvalidWallets([])
    setResult(null)
  }

  async function onImport() {
    setResult(await run.mutateAsync({ adapter, fileNames, rows, options }))
    setParsed(null)
    setProgress(null)
  }

  const p = preview.data
  const accept = adapters.find((a) => a.id === adapter)?.accept
  const steps = p ? stepNumbers(p) : null

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Importar historial</h1>
        <p className="mt-1 text-sm text-slate-500">
          Trae tus movimientos de otra app. Nada se guarda hasta que confirmes, y cada importación se puede revertir
          completa.
        </p>
      </div>

      {result && <ResultCard result={result} />}

      <Step n={1} title="Archivo">
        <div className="flex flex-wrap gap-2">
          {adapters.map((a) => (
            <Choice key={a.id} checked={adapter === a.id} onChange={() => setAdapter(a.id)} label={a.label} />
          ))}
        </div>
        <input
          key={adapter + String(result?.batchId ?? '')}
          type="file"
          multiple
          accept={accept}
          onChange={onFiles}
          className="mt-3 block text-sm file:mr-3 file:rounded file:border-0 file:bg-emerald-700 file:px-3 file:py-1.5 file:text-white hover:file:bg-emerald-800"
        />
        <p className="mt-2 text-xs text-slate-400">
          Si tienes varias billeteras, selecciona todos los archivos juntos. Se leen en tu navegador: al servidor solo llegan
          los movimientos, y el archivo no se guarda.
        </p>
        <ErrorText error={preview.error} />
        {parsed && parsed.rows.length === 0 && (
          <p className="mt-2 text-sm text-rose-600">No se encontraron movimientos en los archivos elegidos.</p>
        )}
        {parsed && parsed.warnings.length > 0 && (
          <ul className="mt-2 list-inside list-disc text-sm text-amber-700">
            {parsed.warnings.slice(0, 5).map((w) => (
              <li key={w}>{w}</li>
            ))}
            {parsed.warnings.length > 5 && <li>…y {parsed.warnings.length - 5} advertencias más</li>}
          </ul>
        )}
      </Step>

      {p && steps && rows.length > 0 && (
        <div className={`space-y-6 ${preview.isFetching ? 'opacity-70 transition-opacity' : ''}`}>
          <AccountsStep
            n={steps.account}
            preview={p}
            options={options}
            onChange={(accounts) => set('accounts', accounts)}
            onValidity={setWalletValid}
          />
          <CategoriesStep
            n={steps.categories}
            preview={p}
            options={options}
            onStrategy={(s) => setOptions((o) => ({ ...o, categoryStrategy: s, categoryOverrides: {} }))}
            onOverride={(key, target) => set('categoryOverrides', { ...options.categoryOverrides, [key]: target })}
            onReconcile={(key, value) => set('reconcileCategories', { ...options.reconcileCategories, [key]: value })}
          />
          {p.labeledCount > 0 && (
            <Step n={steps.labels!} title="Etiquetas" question={`${p.labeledCount} movimientos tienen etiquetas. ¿Qué hago con ellas?`}>
              <Choice
                checked={options.labels === 'append'}
                onChange={() => set('labels', 'append')}
                label="Agregarlas a la descripción (recomendado)"
                hint='Ej. "Cena con amigos #peru": quedan buscables.'
              />
              <Choice checked={options.labels === 'discard'} onChange={() => set('labels', 'discard')} label="Descartarlas" />
            </Step>
          )}
          {p.duplicateCount > 0 && (
            <Step
              n={steps.duplicates!}
              title="Duplicados"
              question={`${p.duplicateCount} movimientos se parecen a otros que ya tienes (mismo monto y cuenta, ±2 días).`}
            >
              <Choice checked={options.duplicates === 'skip'} onChange={() => set('duplicates', 'skip')} label="Omitirlos (recomendado)" />
              <Choice
                checked={options.duplicates === 'mark'}
                onChange={() => set('duplicates', 'mark')}
                label="Importarlos marcados como ¿duplicado?"
                hint="Los revisas después en el dashboard."
              />
            </Step>
          )}
          <ReviewStep
            n={steps.review}
            preview={p}
            onImport={onImport}
            pending={run.isPending}
            progress={progress}
            error={run.error}
            blockReason={importBlockReason(p.summary.toImport, invalidWallets)}
          />
        </div>
      )}

      <History />
    </div>
  )
}

function Step({ n, title, question, children }: { n: number; title: string; question?: string; children: ReactNode }) {
  return (
    <Card title={`${n}. ${title}`}>
      {question && <p className="mb-3 text-sm font-medium text-slate-800">{question}</p>}
      <div className="space-y-2">{children}</div>
    </Card>
  )
}

function Choice({ checked, onChange, label, hint }: { checked: boolean; onChange: () => void; label: string; hint?: string }) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm ${checked ? 'border-emerald-600 bg-emerald-50' : 'border-slate-200 hover:bg-slate-50'}`}
    >
      <input type="radio" checked={checked} onChange={onChange} className="mt-0.5 accent-emerald-700" />
      <span>
        <span className="font-medium">{label}</span>
        {hint && <span className="block text-xs text-slate-500">{hint}</span>}
      </span>
    </label>
  )
}

function AccountsStep({
  n,
  preview,
  options,
  onChange,
  onValidity,
}: {
  n: number
  preview: ImportPreview
  options: Options
  onChange: (accounts: Options['accounts']) => void
  onValidity: (wallet: string, valid: boolean) => void
}) {
  return (
    <Step n={n} title="Cuenta">
      {preview.wallets.map((wallet) => (
        <WalletAccount
          key={wallet.name}
          wallet={wallet}
          choice={options.accounts[wallet.name]}
          onChange={(target) => onChange({ ...options.accounts, [wallet.name]: target })}
          onValidity={(valid) => onValidity(wallet.name, valid)}
        />
      ))}
    </Step>
  )
}

const ACCOUNT_TYPE_LABEL = {
  bank: 'Cuenta bancaria',
  cash: 'Efectivo',
  credit_card: 'Tarjeta de crédito',
  savings: 'Ahorro',
  investment: 'Inversión',
} as const

// Una billetera del origen: elige una cuenta existente (la por defecto primero) o crea una
// nueva con nombre y tipo escritos ahí mismo.
function WalletAccount({
  wallet,
  choice,
  onChange,
  onValidity,
}: {
  wallet: ImportPreview['wallets'][number]
  choice: Options['accounts'][string] | undefined
  onChange: (target: Options['accounts'][string]) => void
  onValidity: (valid: boolean) => void
}) {
  const { data: accounts = [] } = useQuery(accountsQuery)
  const choices = accountChoices(accounts)
  const [creating, setCreating] = useState(choice?.type === 'create')
  const [name, setName] = useState(choice?.type === 'create' ? choice.name : wallet.name)
  const [type, setType] = useState<keyof typeof ACCOUNT_TYPE_LABEL>(choice?.type === 'create' ? choice.accountType : 'bank')
  const nameError = newAccountNameError(name, accounts)
  const selectedId = choice?.type === 'existing' ? choice.accountId : wallet.target.type === 'existing' ? wallet.target.accountId : null

  // Solo se envía al servidor una cuenta nueva con nombre válido.
  const applyNew = (nextName: string, nextType: typeof type) => {
    setName(nextName)
    setType(nextType)
    const valid = !newAccountNameError(nextName, accounts)
    onValidity(valid)
    if (valid) onChange({ type: 'create', name: nextName.trim(), accountType: nextType })
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-slate-800">
        ¿En qué cuenta cargo los movimientos de “{wallet.name}”? <span className="font-normal text-slate-400">({wallet.count})</span>
      </p>
      {choices.map((a) => (
        <Choice
          key={a.id}
          checked={!creating && selectedId === a.id}
          onChange={() => {
            setCreating(false)
            onValidity(true)
            onChange({ type: 'existing', accountId: a.id })
          }}
          label={`“${a.name}”${a.isDefault ? ' (por defecto)' : ''}`}
        />
      ))}
      <Choice
        checked={creating}
        onChange={() => {
          setCreating(true)
          applyNew(name, type)
        }}
        label="Nueva cuenta"
        hint="Escribe el nombre y elige el tipo."
      />
      {creating && (
        <div className="ml-6 flex flex-wrap items-center gap-2">
          <input
            className={`${inputClass} min-w-48 flex-1`}
            value={name}
            onChange={(e) => applyNew(e.target.value, type)}
            placeholder="Nombre de la cuenta"
            autoFocus
          />
          <select className={inputClass} value={type} onChange={(e) => applyNew(name, e.target.value as typeof type)}>
            {Object.entries(ACCOUNT_TYPE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          {nameError && <span className="w-full text-xs text-rose-600">{nameError}</span>}
        </div>
      )}
    </div>
  )
}

// Nota del hover del checkbox de conciliación.
const RECONCILE_HINT =
  'Algunas personas usan una categoría para corregir el saldo (ej. "Ajuste"). Márcala si es tu caso: sus movimientos ' +
  'no se importan como gastos o ingresos, sino como conciliaciones (el saldo real de esa fecha). Si no, déjala sin marcar.'

const STRATEGIES = [
  { id: 'hybrid', label: 'Híbrido (recomendado)', hint: 'Las estándar se asignan a tus categorías y las personalizadas se crean como nuevas.' },
  { id: 'existing', label: 'Solo tus categorías', hint: 'No crea ninguna: todo cae en las que ya tienes (ej. Gaming → Entretenimiento).' },
  { id: 'copy', label: 'Copiar tal cual', hint: 'Crea las categorías de la app anterior con su nombre original.' },
] as const

function CategoriesStep({
  n,
  preview,
  options,
  onStrategy,
  onOverride,
  onReconcile,
}: {
  n: number
  preview: ImportPreview
  options: Options
  onStrategy: (s: Options['categoryStrategy']) => void
  onOverride: (key: string, target: Options['categoryOverrides'][string]) => void
  onReconcile: (key: string, value: boolean) => void
}) {
  const { data: categories } = useQuery(categoriesQuery)
  const [creating, setCreating] = useState<string | null>(null)

  return (
    <Step n={n} title="Categorías" question={`¿Cómo manejo las ${preview.categories.length} categorías de la app anterior?`}>
      {STRATEGIES.map((s) => (
        <Choice key={s.id} checked={options.categoryStrategy === s.id} onChange={() => onStrategy(s.id)} label={s.label} hint={s.hint} />
      ))}
      <p className="pt-2 text-xs text-slate-500">
        Puedes ajustar cada una. Para <strong>combinar</strong> varias, elige el mismo destino en varias filas. Si
        una categoría corresponde a correcciones de saldo, marca <strong>Conciliación</strong>: sus movimientos no
        se importan como gastos o ingresos, sino como conciliaciones de saldo.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-slate-400">
            <tr>
              <th className="py-1 font-medium">En la app anterior</th>
              <th className="font-medium">Mov.</th>
              <th className="font-medium">En OpenSpend</th>
              <th className="px-2 text-center font-medium" title={RECONCILE_HINT}>
                Conciliación <span className="cursor-help text-slate-300">ⓘ</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {preview.categories.map((c) => {
              const onSelect = (value: string) => {
                const decoded = decodeTarget(value)
                if (decoded === 'new') return setCreating(c.key)
                setCreating(null)
                onOverride(c.key, decoded)
              }
              return (
                <tr key={c.key} className={c.adjustment ? 'bg-amber-50/60' : undefined}>
                  <td className="py-1.5 pr-2">
                    {c.sourceName}
                    {c.suggestedAdjustment && !c.adjustment && (
                      <span className="ml-2 rounded bg-amber-100 px-1.5 text-xs text-amber-800" title={RECONCILE_HINT}>
                        ¿ajuste?
                      </span>
                    )}
                    <span className={`ml-2 rounded px-1.5 text-xs ${c.kind === 'expense' ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>
                      {c.kind === 'expense' ? 'gasto' : 'ingreso'}
                    </span>
                  </td>
                  <td className="pr-2 tabular-nums text-slate-500">{c.count}</td>
                  <td className="py-1">
                    {creating === c.key ? (
                      <form
                        className="flex gap-1"
                        onSubmit={(e) => {
                          e.preventDefault()
                          const name = String(new FormData(e.currentTarget).get('name')).trim()
                          if (name) onOverride(c.key, { type: 'create', name })
                          setCreating(null)
                        }}
                      >
                        <input name="name" className={`${inputClass} w-40`} autoFocus placeholder="Nombre" />
                        <Button>OK</Button>
                      </form>
                    ) : (
                      <select
                        className={`${inputClass} w-full max-w-64 disabled:opacity-40`}
                        value={encodeTarget(c.target)}
                        onChange={(e) => onSelect(e.target.value)}
                        disabled={c.adjustment}
                        title={c.adjustment ? 'Marcada como conciliación: no se importa como categoría' : undefined}
                      >
                        <optgroup label="Tus categorías">
                          {categories
                            ?.filter((x) => x.kind === c.kind)
                            .map((x) => (
                              <option key={x.id} value={`existing:${x.id}`}>
                                {x.icon} {x.name}
                              </option>
                            ))}
                        </optgroup>
                        <optgroup label="Nuevas en esta importación">
                          {newCategoryNames(preview.categories, c.kind).map((name) => (
                            <option key={name} value={`create:${name}`}>
                              + {name}
                            </option>
                          ))}
                        </optgroup>
                        <option value="new">+ Crear otra…</option>
                      </select>
                    )}
                  </td>
                  <td className="px-2 text-center">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-emerald-700"
                      checked={c.adjustment}
                      onChange={(e) => onReconcile(c.key, e.target.checked)}
                      aria-label={`Marcar “${c.sourceName}” como conciliación`}
                      title={RECONCILE_HINT}
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Step>
  )
}

function ReviewStep({
  n,
  preview,
  onImport,
  pending,
  progress,
  error,
  blockReason,
}: {
  n: number
  preview: ImportPreview
  onImport: () => void
  pending: boolean
  progress: ImportProgress | null
  error: Error | null
  blockReason: string | null
}) {
  const s = preview.summary
  const newCategories = [
    ...new Set(
      preview.categories.flatMap((c) =>
        !c.adjustment && c.target.type === 'create' ? [`${c.kind === 'expense' ? '' : '(ingreso) '}${c.target.name}`] : [],
      ),
    ),
  ]
  const newAccounts = preview.wallets.flatMap((w) => (w.target.type === 'create' ? [w.target.name] : []))
  return (
    <Step n={n} title="Revisión">
      <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <Stat label="Se importarán" value={`${s.toImport} de ${s.total}`} />
        <Stat label="Período" value={s.from ? `${s.from} → ${s.to}` : '—'} />
        <Stat label="Gastos" value={clp(s.expenseClp)} />
        <Stat label="Ingresos" value={clp(s.incomeClp)} />
      </div>
      <p className="text-xs text-slate-500">Por año: {s.byYear.map((y) => `${y.year}: ${y.count}`).join(' · ')}</p>
      {newCategories.length > 0 && <p className="text-sm">Categorías nuevas: {newCategories.join(', ')}</p>}
      {newAccounts.length > 0 && <p className="text-sm">Cuentas nuevas: {newAccounts.join(', ')}</p>}
      <Button onClick={onImport} disabled={pending || blockReason !== null}>
        {pending ? 'Importando…' : `Importar ${s.toImport} movimientos`}
      </Button>
      {blockReason && <p className="text-sm text-amber-700">{blockReason}</p>}
      {progress && progress.total > 0 && (
        <div className="space-y-1">
          <div className="h-2 overflow-hidden rounded bg-slate-100">
            <div className="h-2 bg-emerald-600 transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
          </div>
          <p className="text-xs tabular-nums text-slate-500">
            {progress.done.toLocaleString('es-CL')} de {progress.total.toLocaleString('es-CL')} movimientos
          </p>
        </div>
      )}
      {error && (
        <p className="text-xs text-slate-500">
          Si la importación quedó a medias, aparece abajo en “Importaciones anteriores” como incompleta y puedes revertirla.
        </p>
      )}
      <ErrorText error={error} />
    </Step>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="font-medium tabular-nums">{value}</p>
    </div>
  )
}

function ResultCard({ result }: { result: ImportResult }) {
  return (
    <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
      <p className="font-semibold">Importación lista ✓</p>
      <ul className="mt-2 list-inside list-disc space-y-0.5">
        <li>{result.inserted} movimientos importados</li>
        {result.skippedDuplicates > 0 && <li>{result.skippedDuplicates} duplicados omitidos</li>}
        {result.markedDuplicates > 0 && <li>{result.markedDuplicates} importados marcados como posibles duplicados</li>}
        {result.reconciliations > 0 && <li>{result.reconciliations} ajustes convertidos en conciliaciones</li>}
        {result.createdCategories.length > 0 && <li>Categorías creadas: {result.createdCategories.join(', ')}</li>}
        {result.createdAccounts.length > 0 && <li>Cuentas creadas: {result.createdAccounts.join(', ')}</li>}
      </ul>
      <Link to="/" className="mt-2 inline-block font-medium text-emerald-800 underline">
        Ver el resumen →
      </Link>
    </section>
  )
}

function History() {
  const { data: batches } = useSuspenseQuery(importsQuery)
  const revert = useRevertImport()
  const [confirming, setConfirming] = useState<number | null>(null)
  if (batches.length === 0) return null
  return (
    <Card title="Importaciones anteriores">
      <ul className="divide-y divide-slate-100">
        {batches.map((b) => (
          <li key={b.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
            <span className="min-w-0 flex-1">
              <span className="font-medium">{b.label}</span>
              <span className="ml-2 text-xs text-slate-400">
                {new Date(b.createdAt).toLocaleString('es-CL', { dateStyle: 'medium', timeStyle: 'short' })} ·{' '}
                {b.status === 'reverted'
                  ? 'revertida'
                  : b.status === 'importing'
                    ? `incompleta (${b.transactionCount} movimientos)`
                    : `${b.transactionCount} movimientos`}
              </span>
            </span>
            {b.status !== 'reverted' &&
              (confirming === b.id ? (
                <span className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">¿Borrar sus {b.transactionCount} movimientos?</span>
                  <Button variant="danger" disabled={revert.isPending} onClick={() => revert.mutate(b.id)}>
                    Revertir
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirming(null)}>
                    Cancelar
                  </Button>
                </span>
              ) : (
                <Button variant="ghost" onClick={() => setConfirming(b.id)}>
                  Revertir
                </Button>
              ))}
          </li>
        ))}
      </ul>
      <ErrorText error={revert.error} />
    </Card>
  )
}
