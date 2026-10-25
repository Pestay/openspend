import { keepPreviousData, queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { z } from 'zod'
import type { ImportedTransaction } from '../shared/importers/types'
import { buildImportPayload, chunk, IMPORT_CHUNK_SIZE, type StartMappings } from '../shared/importers/payload'
import { DEFAULT_PAGE_SIZE } from './pagination'
import type { TransactionPatch } from './transaction-edit'
import type {
  accountInput,
  accountUpdateInput,
  categoryInput,
  categoryUpdateInput,
  importOptions,
  TransactionInput,
} from '../shared/schemas'
import type {
  AccountWithBalance,
  Category,
  Connection,
  CreateTransactionsResult,
  ImportBatch,
  ImportPreview,
  ImportResult,
  Reconciliation,
  Summary,
  Transaction,
} from '../shared/types'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  // La sesión expiró mientras la app estaba abierta: volver al login.
  if (res.status === 401) {
    window.location.href = `/auth/login?${new URLSearchParams({ returnTo: window.location.pathname + window.location.search })}`
    return new Promise<T>(() => {}) // la página se va a recargar
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? `Error ${res.status}`)
  }
  return res.status === 204 ? (undefined as T) : res.json()
}

// queryOptions compartidas entre los loaders del router (que precargan) y los componentes.
export const meQuery = queryOptions({
  queryKey: ['me'],
  queryFn: () => request<{ email: string }>('/me'),
  staleTime: Infinity,
})

export const accountsQuery = queryOptions({
  queryKey: ['accounts'],
  queryFn: () => request<AccountWithBalance[]>('/accounts'),
})

export const categoriesQuery = queryOptions({
  queryKey: ['categories'],
  queryFn: () => request<Category[]>('/categories'),
})

export const summaryQuery = (from: string, to: string) =>
  queryOptions({
    queryKey: ['summary', from, to],
    queryFn: () => request<Summary>(`/summary?${new URLSearchParams({ from, to })}`),
  })

// Una página de movimientos del período, con el total para el paginador.
export const transactionsQuery = (from: string, to: string, page = 0, size: number = DEFAULT_PAGE_SIZE) =>
  queryOptions({
    queryKey: ['transactions', from, to, page, size],
    queryFn: () =>
      request<{ items: Transaction[]; total: number }>(
        `/transactions?${new URLSearchParams({ from, to, limit: String(size), offset: String(page * size) })}`,
      ),
    placeholderData: keepPreviousData,
  })

function useInvalidateAll() {
  const queryClient = useQueryClient()
  return () =>
    Promise.all(
      ['transactions', 'summary', 'accounts', 'categories', 'imports', 'reconciliations'].map((key) =>
        queryClient.invalidateQueries({ queryKey: [key] }),
      ),
    )
}

export function useCreateTransactions() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: (transactions: TransactionInput[]) =>
      request<CreateTransactionsResult>('/transactions', { method: 'POST', body: JSON.stringify({ transactions }) }),
    onSuccess: invalidate,
  })
}

export function useUpdateTransaction() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: ({ id, ...patch }: TransactionPatch & { id: number }) =>
      request<Transaction>(`/transactions/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    onSuccess: invalidate,
  })
}

export function useDeleteTransaction() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: (id: number) => request<void>(`/transactions/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  })
}

// Mutación que, al terminar, refresca todo lo que depende de cuentas o categorías.
function useApiMutation<TVars, TResult>(mutationFn: (vars: TVars) => Promise<TResult>) {
  const invalidate = useInvalidateAll()
  return useMutation({ mutationFn, onSuccess: invalidate })
}

const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) })

export const useCreateCategory = () =>
  useApiMutation((input: z.input<typeof categoryInput>) => request<Category>('/categories', json('POST', input)))

export const useUpdateCategory = () =>
  useApiMutation(({ id, ...patch }: z.input<typeof categoryUpdateInput> & { id: number }) =>
    request<Category>(`/categories/${id}`, json('PATCH', patch)),
  )

export const useDeleteCategory = () =>
  useApiMutation(({ id, reassignTo }: { id: number; reassignTo?: number | null }) =>
    request<{ movedTransactions: number }>(
      `/categories/${id}${reassignTo === undefined ? '' : `?${new URLSearchParams({ reassignTo: String(reassignTo) })}`}`,
      { method: 'DELETE' },
    ),
  )

export const useCreateAccount = () =>
  useApiMutation((input: z.input<typeof accountInput>) => request<AccountWithBalance>('/accounts', json('POST', input)))

export const useUpdateAccount = () =>
  useApiMutation(({ id, ...patch }: z.input<typeof accountUpdateInput> & { id: number }) =>
    request<AccountWithBalance>(`/accounts/${id}`, json('PATCH', patch)),
  )

export const useDeleteAccount = () =>
  useApiMutation((id: number) => request<{ deleted: number }>(`/accounts/${id}`, { method: 'DELETE' }))

export const connectionsQuery = queryOptions({
  queryKey: ['connections'],
  queryFn: () => request<Connection[]>('/connections'),
})

export function useRevokeConnection() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => request<{ revoked: string }>(`/connections/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['connections'] }),
  })
}

export const useMergeCategories = () =>
  useApiMutation((input: { sourceIds: number[]; targetId: number }) =>
    request<{ movedTransactions: number }>('/categories/merge', json('POST', input)),
  )

// --- Importación ---

export type ImportOptionsInput = z.input<typeof importOptions>

export const importsQuery = queryOptions({
  queryKey: ['imports'],
  queryFn: () => request<ImportBatch[]>('/imports'),
})

// La vista previa se recalcula en el servidor cada vez que cambia una respuesta del usuario;
// mientras tanto se sigue mostrando la anterior. Recibe los movimientos ya normalizados.
export function useImportPreview(adapter: string, fileNames: string[], rows: ImportedTransaction[], options: ImportOptionsInput) {
  return useQuery({
    queryKey: ['import-preview', adapter, fileNames, rows.length, options],
    // La vista previa no usa las notas: no se envían, para aligerar la request.
    queryFn: () =>
      request<ImportPreview>(
        '/imports/preview',
        json('POST', { adapter, fileNames, rows: rows.map((t) => ({ ...t, description: null })), options }),
      ),
    enabled: rows.length > 0,
    placeholderData: keepPreviousData,
    staleTime: Infinity,
  })
}

export interface ImportProgress {
  done: number
  total: number
}

/**
 * Importa en etapas para respetar el límite de CPU por request del servidor:
 * start (lote, cuentas, categorías) → tandas de ≤ 500 movimientos → finish (conciliaciones).
 */
export function useChunkedImport(onProgress: (progress: ImportProgress) => void) {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: async (input: { adapter: string; fileNames: string[]; rows: ImportedTransaction[]; options: Required<ImportOptionsInput> }) => {
      const categories = [...new Map(input.rows.map((t) => [`${t.kind}|${t.sourceCategory}`, { kind: t.kind, sourceCategory: t.sourceCategory }])).values()]
      const wallets = [...new Set(input.rows.map((t) => t.sourceWallet))]
      const start = await request<StartMappings & { batchId: number; createdAccounts: string[]; createdCategories: string[] }>(
        '/imports/start',
        json('POST', { adapter: input.adapter, fileNames: input.fileNames, categories, wallets, options: input.options }),
      )
      const payload = buildImportPayload(input.rows, start, input.options.labels)
      const result: ImportResult = {
        batchId: start.batchId,
        inserted: 0,
        skippedDuplicates: 0,
        markedDuplicates: 0,
        reconciliations: 0,
        createdAccounts: start.createdAccounts,
        createdCategories: start.createdCategories,
      }
      onProgress({ done: 0, total: payload.transactions.length })
      for (const transactions of chunk(payload.transactions, IMPORT_CHUNK_SIZE)) {
        const r = await request<{ inserted: number; skippedDuplicates: number; markedDuplicates: number }>(
          `/imports/${start.batchId}/rows`,
          json('POST', { transactions, skipDuplicates: input.options.duplicates === 'skip' }),
        )
        result.inserted += r.inserted
        result.skippedDuplicates += r.skippedDuplicates
        result.markedDuplicates += r.markedDuplicates
        onProgress({ done: result.inserted + result.skippedDuplicates, total: payload.transactions.length })
      }
      const finish = await request<{ reconciliations: number }>(
        `/imports/${start.batchId}/finish`,
        json('POST', { adjustments: payload.adjustments }),
      )
      result.reconciliations = finish.reconciliations
      return result
    },
    // Aunque falle a mitad de camino, el lote parcial ya existe: refrescar para poder revertirlo.
    onSettled: invalidate,
  })
}

export const useRevertImport = () =>
  useApiMutation((id: number) => request<{ deletedTransactions: number }>(`/imports/${id}`, { method: 'DELETE' }))

// --- Conciliaciones ---

export const reconciliationsQuery = (accountId: number) =>
  queryOptions({
    queryKey: ['reconciliations', accountId],
    queryFn: () => request<Reconciliation[]>(`/reconciliations?${new URLSearchParams({ accountId: String(accountId) })}`),
  })

type ReconcileVars = { accountId: number; date: string; balance: number; note?: string }

// Vista previa en vivo mientras el usuario escribe el saldo real (solo con un monto válido).
export function useReconciliationPreview(vars: Omit<ReconcileVars, 'note'> | null) {
  return useQuery({
    queryKey: ['reconciliation-preview', vars],
    queryFn: () =>
      request<{ calculatedMinor: number; balanceMinor: number; differenceMinor: number }>('/reconciliations/preview', json('POST', vars)),
    enabled: vars !== null,
    placeholderData: keepPreviousData,
  })
}

export const useReconcile = () => useApiMutation((vars: ReconcileVars) => request<Reconciliation>('/reconciliations', json('POST', vars)))

export const useDeleteReconciliation = () =>
  useApiMutation((id: number) => request<{ deleted: number }>(`/reconciliations/${id}`, { method: 'DELETE' }))
