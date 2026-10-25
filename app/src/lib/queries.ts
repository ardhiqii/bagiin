import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './api'
import type { BillResponse, BillRow, Recap } from './types'

export const keys = {
  bills: (identityId: string) => ['bills', identityId] as const,
  bill: (billId: string) => ['bill', billId] as const,
  recap: (identityId: string) => ['recap', identityId] as const,
}

export function useBills(identityId: string | null) {
  return useQuery({
    queryKey: keys.bills(identityId ?? ''),
    queryFn: () => api<BillRow[]>('/api/identities/' + identityId + '/bills'),
    enabled: Boolean(identityId),
  })
}

export function useBill(billId: string | null) {
  return useQuery({
    queryKey: keys.bill(billId ?? ''),
    queryFn: () => api<BillResponse>('/api/bills/' + billId),
    enabled: Boolean(billId),
    retry: (count, error) => {
      const status = (error as { status?: number }).status
      if (status === 404 || status === 403) return false
      return count < 2
    },
  })
}

export function useRecap(identityId: string | null) {
  return useQuery({
    queryKey: keys.recap(identityId ?? ''),
    queryFn: () => api<Recap>('/api/identities/' + identityId + '/recap'),
    enabled: Boolean(identityId),
  })
}

export type BillAction = {
  path: string
  method?: 'POST' | 'PUT' | 'DELETE'
  body?: unknown
}

/**
 * Semua aksi bill lewat satu pintu: kirim, lalu segarkan bill + daftar + rekap
 * supaya angka di layar mana pun tidak pernah berbeda cerita.
 */
export function useBillAction(billId: string | null, identityId: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (action: BillAction) =>
      api<unknown>(action.path, { method: action.method ?? 'POST', body: action.body ?? {} }),
    onSuccess: () => {
      if (billId) qc.invalidateQueries({ queryKey: keys.bill(billId) })
      if (identityId) {
        qc.invalidateQueries({ queryKey: keys.bills(identityId) })
        qc.invalidateQueries({ queryKey: keys.recap(identityId) })
      }
    },
  })
}

export const billActions = {
  /**
   * Backend menyimpan pilihan sebagai satu set: POST /selections dengan daftar
   * picks. Tidak ada endpoint PUT per item (yang ada hanya DELETE untuk melepas),
   * jadi UI selalu mengirim set lengkap.
   */
  setPicks: (billId: string, itemIds: number[]) => ({
    path: '/api/bills/' + billId + '/selections',
    body: { picks: itemIds.map((id) => ({ item_id: id, qty: 1 })) },
  }),
  markPaid: (billId: string, identityId: string) => ({
    path: '/api/bills/' + billId + '/payments/' + identityId + '/paid',
  }),
  markUnpaid: (billId: string, identityId: string) => ({
    path: '/api/bills/' + billId + '/payments/' + identityId + '/unpaid',
  }),
  close: (billId: string) => ({ path: '/api/bills/' + billId + '/close' }),
  reopen: (billId: string) => ({ path: '/api/bills/' + billId + '/reopen' }),
  join: (billId: string) => ({ path: '/api/bills/' + billId + '/join' }),
  leave: (billId: string) => ({ path: '/api/bills/' + billId + '/leave' }),
  invite: (billId: string, identityId: string) => ({
    path: '/api/bills/' + billId + '/invite',
    body: { identity_id: identityId },
  }),
  setPayer: (billId: string, identityId: string | null) => ({
    path: '/api/bills/' + billId + '/paid_by',
    body: { identity_id: identityId },
  }),
}
