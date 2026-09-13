/**
 * DTOs shared by the React client.
 *
 * These types intentionally mirror the existing FastAPI payloads.  A bill's
 * totals, status, finality, ownership and payment state are server-owned;
 * there is no client-side split model in this file.
 */

export type Identity = {
  id: string;
  name: string;
  /** Returned only to the identity's own device. Never put this in a URL. */
  secret?: string | null;
  has_code?: boolean;
  auto_accept?: boolean;
};

export type CreateIdentityRequest = {
  name: string;
  creator?: boolean;
};

export type RestoreIdentityRequest = {
  code: string;
};

export type IdentityProfile = {
  id: string;
  name: string;
  has_code: boolean;
  auto_accept: boolean;
};

export type IdentityNameRequest = {
  name: string;
};

export type IdentityCodeRequest = {
  code: string;
};

export type AutoAcceptRequest = {
  auto_accept: boolean;
};

export type PaymentAccountInput = {
  brand: string;
  account_no: string;
  holder_name?: string | null;
};

export type ApiErrorDetail = {
  msg?: string;
  type?: string;
  loc?: Array<string | number>;
};

export type ApiErrorShape = {
  detail?: string | ApiErrorDetail[] | ApiErrorDetail | null;
};

export type MutationOk = {
  ok: true;
};

export type BillStatus = "open" | "closed";
export type TaxMode = "proportional" | "equal" | "creator";

export type Bill = {
  id: string;
  title: string;
  merchant?: string | null;
  transacted_at?: string | null;
  created_at?: string | null;
  status: BillStatus;
  creator_identity_id: string;
  creator_left?: number | boolean;
  subtotal_idr: number;
  tax_idr: number;
  service_idr: number;
  order_discount_idr?: number;
  cashback_idr?: number;
  total_idr: number;
  tax_included?: number | boolean;
  tax_mode?: TaxMode;
  participant_count?: number | null;
  paid_by_name?: string | null;
  paid_by_identity_id?: string | null;
  paid_by_confirmed?: number | boolean;
  settled_manual?: number | boolean;
};

export type BillItem = {
  id: number;
  bill_id?: string;
  sort_order?: number;
  name: string;
  price_idr: number;
  discount_idr?: number;
  quantity?: number | string;
  mode?: "free" | "slot" | string;
  slot_count?: number | null;
};

export type BillItemInput = {
  id?: number;
  name: string;
  price: number;
  discount?: number;
  quantity?: number;
  mode?: "free" | "slot";
  slot_count?: number | null;
};

/** Create/update accepts a list of display names. Joined identities are
 * returned as objects in BillResponse.participants. */
export type ParticipantInput = string;

export type CreateBillRequest = {
  title?: string;
  merchant?: string | null;
  transacted_at?: string | null;
  tax_mode?: TaxMode;
  participant_count?: number | null;
  tax_included?: boolean;
  subtotal: number;
  tax: number;
  service: number;
  order_discount?: number;
  cashback?: number;
  total: number;
  items: BillItemInput[];
  participants?: ParticipantInput[];
  paid_by_name?: string | null;
  photos?: string[];
  photo_path?: string | null;
};

export type UpdateBillRequest = Omit<CreateBillRequest, "paid_by_name" | "photos" | "photo_path"> & {
  title?: string;
  /** Omitted participant fields keep the server's current roster. */
  participants?: ParticipantInput[];
};

export type Selector = {
  id?: string | null;
  name: string;
  qty: number;
};

export type Person = {
  identity_id: string;
  name: string;
  item_subtotal_idr?: number;
  order_discount_idr?: number;
  subtotal_idr: number;
  tax_idr: number;
  cashback_idr?: number;
  total_idr: number;
  paid?: "paid" | "unpaid" | string;
};

export type BillPhoto = {
  id: number;
  path: string;
  created_at?: string;
};

export type PendingInvite = {
  id: number;
  bill_id?: string;
  identity_id?: string;
  invited_by?: string;
  name?: string;
  bill_title?: string;
  bill_total?: number;
  status?: "pending" | "accepted" | "declined" | string;
  invited_by_name?: string;
  created_at?: string;
};

export type BillParticipant = {
  name: string;
  identity_id?: string | null;
};

export type UncoveredSlot = {
  item_id?: number;
  name?: string;
  per_slot?: number;
  empty: number;
  amount_idr?: number;
};

export type UnassignedItem = Pick<BillItem, "id" | "name" | "price_idr" | "discount_idr" | "quantity" | "mode" | "slot_count">;

export type BillResponse = {
  bill: Bill;
  items: BillItem[];
  people: Person[];
  participants: BillParticipant[];
  sel_by_item: Record<string, Selector[]>;
  photos?: BillPhoto[];
  creator_name: string;
  creator_accounts?: PaymentAccount[];
  paid_by_id?: string | null;
  paid_by_name?: string | null;
  paid_by_confirmed?: boolean;
  paid_by_accounts?: PaymentAccount[];
  owner_id?: string;
  can_manage: boolean;
  pending_invites?: PendingInvite[];
  warnings?: string[];
  total_ok?: boolean;
  remaining_to_creator?: number;
  unassigned_items?: UnassignedItem[];
  uncovered_slots?: UncoveredSlot[];
  uncovered_idr: number;
  all_paid: boolean;
  settled_manual?: boolean;
  settled: boolean;
};

export type BillListRow = {
  id: string;
  title: string;
  merchant?: string | null;
  transacted_at?: string | null;
  created_at?: string | null;
  status: BillStatus;
  creator_identity_id: string;
  paid_by_identity_id?: string | null;
  paid_by_confirmed?: boolean;
  owner_id?: string;
  total_idr: number;
  settled: boolean;
  settled_manual?: boolean;
  all_paid?: boolean;
  total_unpaid?: number;
  uncovered_idr?: number;
  pending_names?: string[];
  can_manage?: boolean;
  i_am_payer?: boolean;
  my_paid?: boolean;
  my_total_idr?: number;
  has_picks?: boolean;
};

export type PaymentAccount = {
  id: number;
  brand: string;
  account_no: string;
  holder_name?: string | null;
};

export type Contact = {
  id: string;
  name: string;
};

export type SelectionPick = {
  item_id: number;
  qty: number;
};

export type SetSelectionsRequest = {
  picks: SelectionPick[];
};

export type SlotCountRequest = {
  slot_count: number;
};

export type PayerRequest = {
  identity_id?: string;
  name?: string;
};

export type InviteRequest = {
  identity_id: string;
};

export type InviteMutationResponse = {
  status: "joined" | "pending";
};

export type PhotoUploadResponse = {
  photo_path: string;
  filename: string;
};

export type PhotoDeleteResponse = {
  deleted: boolean;
};

export type OcrItem = {
  name?: string;
  price?: number | string;
  price_idr?: number;
  discount?: number | string;
  discount_idr?: number;
  quantity?: number | string;
  mode?: "free" | "slot" | string;
  slot_count?: number;
};

export type OcrResponse = {
  merchant?: string;
  title?: string;
  transacted_at?: string;
  date?: string;
  items?: OcrItem[];
  subtotal?: number;
  tax?: number;
  service?: number;
  tax_included?: boolean;
  photos?: string[];
  photo_path?: string | null;
};

export type RecapAction = {
  bill_id: string;
  title: string;
  kind?: "select_items" | "pay_share" | "confirm_payer" | "wait_selection" | "wait_payment" | "wait_invite" | "accept_invite" | string;
  type?: string;
  reason?: string;
  owner?: "current_user" | "other" | string;
  identity_id?: string;
  name?: string;
  amount_idr?: number;
  counterparty_id?: string;
  counterparty_name?: string;
  provisional?: boolean;
  href?: string;
  invite_id?: number;
  invited_by?: string;
  invited_by_name?: string;
};

export type RecapBill = {
  bill_id: string;
  title: string;
  total_idr?: number;
  status?: string;
  reason_codes?: string[];
  amount_idr?: number;
  counterparty_name?: string;
  final?: boolean;
};

export type RecapCounterpartyBill = {
  bill_id: string;
  title: string;
  amount_idr: number;
  direction: "pay" | "receive";
  status: BillStatus;
};

export type RecapPendingCounts = {
  count: number;
  current_user: number;
  waiting_other: number;
  bill_ids: string[];
};

export type RecapCounterparty = {
  identity_id: string;
  name: string;
  net_idr: number;
  direction: "pay" | "receive";
  amount_idr: number;
  bills: RecapCounterpartyBill[];
  pending: RecapPendingCounts;
};

export type RecapResponse = {
  identity: { id: string; name: string };
  final: {
    payable_idr: number;
    receivable_idr: number;
    net_idr: number;
    counterparties: RecapCounterparty[];
    bill_count: number;
  };
  provisional: {
    bill_count: number;
    payable_idr: number;
    receivable_idr: number;
    bills: RecapBill[];
  };
  actions: {
    current_user: RecapAction[];
    waiting_other: RecapAction[];
  };
  counts: {
    current_user: number;
    waiting_other: number;
    provisional_bills: number;
  };
};

export type DraftItem = {
  id: string;
  serverId?: number;
  name: string;
  price: number;
  discount: number;
  quantity: number;
  mode: "free" | "slot";
  slot_count: number;
};

export type BillDraft = {
  title: string;
  merchant: string;
  transacted_at: string;
  items: DraftItem[];
  order_discount: number;
  cashback: number;
  tax: number;
  service: number;
  tax_included: boolean;
  paid_by_myself: boolean;
  paid_by_name: string;
  extra_names: string[];
  photos: string[];
  photo_path?: string;
};