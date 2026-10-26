// Bentuk data yang benar-benar dikirim backend. Diambil dari respons nyata
// (lihat API_CONTRACT.md), bukan ditebak dari nama endpoint.

export type Identity = {
  id: string
  name: string
  role: string
  secret?: string | null
  auto_accept?: number
  created_at?: string
}

export type BillItem = {
  id: number
  bill_id: string
  name: string
  price_idr: number
  discount_idr: number
  quantity: number
  mode: 'free' | 'slot'
  slot_count: number | null
  sort_order: number
}

export type Person = {
  identity_id: string
  name: string
  item_subtotal_idr: number
  order_discount_idr: number
  subtotal_idr: number
  tax_idr: number
  cashback_idr: number
  total_idr: number
  paid: 'paid' | 'unpaid' | string
}

export type Selector = { name: string; qty: number; id: string }

export type BillCore = {
  id: string
  creator_identity_id: string
  title: string
  merchant: string | null
  transacted_at: string | null
  photo_path: string | null
  paid_by_name: string | null
  paid_by_identity_id: string | null
  subtotal_idr: number
  tax_idr: number
  service_idr: number
  total_idr: number
  tax_mode: string
  status: 'open' | 'closed' | string
  created_at: string
  closed_at: string | null
  tax_included: number
  paid_by_confirmed: number
  creator_left: number
  settled_manual: number
  order_discount_idr: number
  cashback_idr: number
}

export type PendingInvite = {
  id: string
  identity_id: string
  name: string
  status: string
}

export type BillResponse = {
  bill: BillCore
  items: BillItem[]
  people: Person[]
  participants: { identity_id: string | null; name: string }[]
  photos: { id: number; path: string }[]
  sel_by_item: Record<string, Selector[]>
  warnings: string[]
  all_paid: boolean
  settled_manual: boolean
  settled: boolean
  can_manage: boolean
  owner_id: string
  creator_name: string
  paid_by_id: string | null
  paid_by_name: string | null
  paid_by_confirmed: boolean
  pending_invites: PendingInvite[]
  creator_accounts: { id: number; identity_id: string; brand: string; account_no: string; holder_name: string | null; sort_order: number }[]
  paid_by_accounts: { id: number; identity_id: string; brand: string; account_no: string; holder_name: string | null; sort_order: number }[]
  total_ok: boolean
  remaining_to_creator: number
  uncovered_idr: number
  unassigned_items: BillItem[]
  uncovered_slots: { item_id: number; name: string; per_slot: number; empty: number; amount_idr: number }[]
}

export type BillRow = {
  id: string
  title: string
  merchant: string | null
  transacted_at: string | null
  total_idr: number
  status: string
  created_at: string
  closed_at: string | null
  creator_identity_id: string
  paid_by_identity_id: string | null
  settled: boolean
  pending_names: string[]
  total_unpaid: number
  uncovered_idr: number
  all_paid: boolean
  owner_id: string
  can_manage: boolean
  i_am_payer: boolean
  my_paid: boolean
  my_total_idr: number
  has_picks: boolean
}

export type RecapBill = {
  bill_id: string
  title: string
  status: string
  created_at: string | null
  reason_codes: string[]
  estimated_payable_idr: number
  estimated_receivable_idr: number
  current_user: { total_idr: number; paid: boolean; direction: string }
  /** nominal porsi yang belum ada pengakunya (mode per porsi) */
  uncovered_idr: number
  uncovered_items: { name: string; amount_idr: number }[]
  /** item yang sama sekali belum dipilih siapa pun */
  unassigned_items: string[]
  paid_by_name: string | null
  can_manage: boolean
}

/** Satu baris bill yang pembagiannya sudah final (belum tentu lunas). */
export type RecapFinalBill = {
  bill_id: string
  title: string
  created_at: string | null
  merchant: string | null
  my_total_idr: number
  total_idr: number
}

export type Recap = {
  identity: { id: string; name: string }
  final: {
    payable_idr: number
    receivable_idr: number
    net_idr: number
    counterparties: {
      identity_id: string
      name: string
      /** bruto: satu orang bisa sekaligus piutang dan utang */
      payable_idr: number
      receivable_idr: number
      net_idr: number
    }[]
    bill_count: number
    bills: RecapFinalBill[]
  }
  provisional: {
    bill_count: number
    payable_idr: number
    receivable_idr: number
    bills: RecapBill[]
  }
  actions: { current_user: unknown[]; waiting_other: unknown[] }
}
