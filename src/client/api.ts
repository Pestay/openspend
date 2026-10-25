import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { TransactionInput } from '../shared/schemas'
import type {
  AccountWithBalance,
  Category,
  CreateTransactionsResult,
  Summary,
  Transaction,
} from '../shared/types'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  if (res.status === 401) {
    window.location.href = `/auth/login?${new URLSearchParams({ returnTo: window.location.pathname })}`
    return new Promise<T>(() => {}) // la página se va a recargar
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? `Error ${res.status}`)
  }
  return res.status === 204 ? (undefined as T) : res.json()
}

export const useMe = () =>
  useQuery({ queryKey: ['me'], queryFn: () => request<{ email: string }>('/me'), staleTime: Infinity })

export const useAccounts = () =>
  useQuery({ queryKey: ['accounts'], queryFn: () => request<AccountWithBalance[]>('/accounts') })

export const useCategories = () =>
  useQuery({ queryKey: ['categories'], queryFn: () => request<Category[]>('/categories'), staleTime: Infinity })

export const useSummary = (from: string, to: string) =>
  useQuery({
    queryKey: ['summary', from, to],
    queryFn: () => request<Summary>(`/summary?${new URLSearchParams({ from, to })}`),
  })

export const useTransactions = (from: string, to: string) =>
  useQuery({
    queryKey: ['transactions', from, to],
    queryFn: () => request<Transaction[]>(`/transactions?${new URLSearchParams({ from, to })}`),
  })

function useInvalidateAll() {
  const queryClient = useQueryClient()
  return () =>
    Promise.all(['transactions', 'summary', 'accounts'].map((key) => queryClient.invalidateQueries({ queryKey: [key] })))
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
