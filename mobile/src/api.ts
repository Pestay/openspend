import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import type { TransactionInput } from '../../src/shared/schemas'
import type { AccountWithBalance, Category, CreateTransactionsResult, Summary, Transaction } from '../../src/shared/types'
import { API_URL } from './config'

// Mismo cliente que src/client/api.ts, pero contra la URL del Worker y con el ID token como Bearer.

let getToken: () => Promise<string | null> = async () => null
let onUnauthorized = () => {}

export function configureApi(options: { getToken: typeof getToken; onUnauthorized: typeof onUnauthorized }) {
  getToken = options.getToken
  onUnauthorized = options.onUnauthorized
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getToken()
  const res = await fetch(`${API_URL}/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }), ...init?.headers },
  })
  if (res.status === 401) {
    onUnauthorized()
    throw new Error('Sesión expirada')
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? `Error ${res.status}`)
  }
  return res.status === 204 ? (undefined as T) : res.json()
}

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

export const transactionsQuery = (from: string, to: string) =>
  queryOptions({
    queryKey: ['transactions', from, to],
    queryFn: () => request<Transaction[]>(`/transactions?${new URLSearchParams({ from, to })}`),
  })

function useInvalidateAll() {
  const queryClient = useQueryClient()
  return () =>
    Promise.all(
      ['transactions', 'summary', 'accounts', 'categories'].map((key) => queryClient.invalidateQueries({ queryKey: [key] })),
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

export function useDeleteTransaction() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: (id: number) => request<void>(`/transactions/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  })
}
