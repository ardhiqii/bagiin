import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './api'
import { invalidateMoneyViews } from './mutations'
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

export type PaymentAccount = {
  id: number
  identity_id: string
  brand: string
  account_no: string
  holder_name: string | null
  sort_order: number
}

export function useAccounts(identityId: string | null) {
  return useQuery({
    queryKey: ['accounts', identityId ?? ''],
    queryFn: () => api<PaymentAccount[]>('/api/identities/' + identityId + '/accounts'),
    enabled: Boolean(identityId),
  })
}

export const accountActions = {
  add: (identityId: string, body: { brand: string; account_no: string; holder_name?: string | null }) => ({
    path: '/api/identities/' + identityId + '/accounts',
    body,
  }),
  update: (accountId: number, body: { brand: string; account_no: string; holder_name?: string | null }) => ({
    path: '/api/accounts/' + accountId,
    method: 'PUT' as const,
    body,
  }),
  remove: (accountId: number) => ({
    path: '/api/accounts/' + accountId,
    method: 'DELETE' as const,
  }),
  autoAccept: (identityId: string, on: boolean) => ({
    path: '/api/identities/' + identityId + '/auto_accept',
    body: { auto_accept: on ? 1 : 0 },
  }),
}

export type Contact = {
  id: string
  name: string
  /** nama pembeda yang SAYA beri (privat) */
  alias: string | null
  /** alias ?? name — pakai ini di semua teks */
  display_name: string
  username: string | null
  handle: string
  last_shared: string
  last_bill_title: string | null
  shared_count: number
}

export function useContacts(identityId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['contacts', identityId ?? ''],
    queryFn: () => api<Contact[]>('/api/identities/' + identityId + '/contacts'),
    enabled: Boolean(identityId) && enabled,
  })
}

export type PendingInviteCard = {
  id: number
  bill_id: string
  invited_by: string
  invited_by_name: string
  bill_title: string
  bill_total: number
  created_at: string
}

/**
 * Undangan yang masih menunggu jawaban. Biasanya kosong: kalau orang yang
 * diundang punya auto_accept (bawaan), backend langsung memasukkannya ke bill
 * tanpa kartu ini. Kartu hanya muncul kalau dia mematikan auto_accept, atau
 * pernah menolak undangan sebelumnya — di situlah jalurnya dulu panjang:
 * buka bill dulu, baru tekan "Ikut bill ini".
 */
export function useInvites(identityId: string | null) {
  return useQuery({
    queryKey: ['invites', identityId ?? ''],
    queryFn: () => api<PendingInviteCard[]>('/api/identities/' + identityId + '/invites'),
    enabled: Boolean(identityId),
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
    onSuccess: () => invalidateMoneyViews(qc, { billId, identityId }),
  })
}

export const inviteActions = {
  accept: (billId: string, inviteId: number) => ({
    path: '/api/bills/' + billId + '/invites/' + inviteId + '/accept',
  }),
  decline: (billId: string, inviteId: number) => ({
    path: '/api/bills/' + billId + '/invites/' + inviteId + '/decline',
  }),
}

export const billActions = {
  /**
   * Backend menyimpan pilihan sebagai satu set: POST /selections dengan daftar
   * picks. Tidak ada endpoint PUT per item (yang ada hanya DELETE untuk melepas),
   * jadi UI selalu mengirim set lengkap.
   */
  setPicks: (billId: string, picks: { item_id: number; qty: number }[]) => ({
    path: '/api/bills/' + billId + '/selections',
    body: { picks },
  }),
  setSlots: (billId: string, itemId: number, slotCount: number) => ({
    path: '/api/bills/' + billId + '/items/' + itemId + '/slots',
    method: 'PUT' as const,
    body: { slot_count: slotCount },
  }),
  releaseSlots: (billId: string, itemId: number, identityId: string) => ({
    path: '/api/bills/' + billId + '/items/' + itemId + '/selections/' + identityId,
    method: 'DELETE' as const,
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
  setPayer: (billId: string, identityId: string) => ({
    path: '/api/bills/' + billId + '/paid_by',
    method: 'PUT' as const,
    body: { identity_id: identityId },
  }),
  removePhoto: (billId: string, photoId: number) => ({
    path: '/api/bills/' + billId + '/photos/' + photoId,
    method: 'DELETE' as const,
  }),
  settle: (billId: string) => ({ path: '/api/bills/' + billId + '/settle' }),
  unsettle: (billId: string) => ({ path: '/api/bills/' + billId + '/unsettle' }),
  removePerson: (billId: string, identityId: string) => ({
    path: '/api/bills/' + billId + '/people/' + identityId,
    method: 'DELETE' as const,
  }),
  removeBill: (billId: string) => ({
    path: '/api/bills/' + billId,
    method: 'DELETE' as const,
  }),
  cancelInvite: (billId: string, inviteId: string) => ({
    path: '/api/bills/' + billId + '/invites/' + inviteId,
    method: 'DELETE' as const,
  }),
}
