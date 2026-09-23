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
  /**
   * v97 — pending-invite row fields, additive and present on EVERY row (stable
   * shape, so no null-vs-missing branching is needed).
   *
   * True only for a row this identity can reach PURELY through a pending
   * invite: no payment row, no selection, not an un-left creator. The invitee
   * is therefore NOT on the roster, and every money-derived list state
   * (`settled` / `total_unpaid` / `can_manage` / `my_*`) stays server-owned and
   * unchanged — `can_manage` is already false for these rows, so owner actions
   * keep gating on it alone.
   *
   * `GET /api/identities/{id}/bills` and `GET /api/identities/{id}/recap`
   * enumerate the SAME bill id set for the same identity (backend v97), so the
   * Home row and the Recap drilldown/action always point at one bill id. The
   * client must read this flag off the LIST row and never infer invite state
   * from the recap's actions: that would be a second source of truth for the
   * same question, which is exactly the drift this field removes.
   */
  pending_invite?: boolean;
  /** `bill_invite.id`; null unless `pending_invite` is true. */
  pending_invite_id?: number | null;
  /** Inviter display name; null unless `pending_invite` is true. */
  pending_invited_by_name?: string | null;
};

/* ------------------------------------------------------------------ bill list
   The Home list's row status, kept next to the DTO it reads so the chip, the
   status mark, the sort rank and the filter buckets all share ONE definition.
   Pure mapping of server-owned booleans/counts into a label — it computes no
   money, and it never re-derives invite state from any other endpoint. */

export type BillListStatus = { tone: "success" | "danger" | "neutral"; label: string };

/**
 * The ONE status for a Home row.
 *
 * A pending invite OUTRANKS every money-derived label: the invitee has no
 * allocation, no payment row and no ownership, so "Belum dipilih" or "Belum
 * lunas" would state something about money the viewer does not owe yet (bug
 * class this guards: a bill list asserting a balance for someone who is not on
 * the bill). `row.pending_invite` comes from the list API (v97) and is read
 * here — never inferred from the recap's `accept_invite` actions, which would
 * be a second source of truth for the same question.
 *
 * The tone stays inside the existing three-value scale on purpose: the
 * status-mark tint and the filter buckets (Semua / Belum lunas / Lunas / Belum
 * dipilih) are keyed on `success | danger | neutral`, so a fourth tone would
 * need new CSS and would silently fall out of every filter.
 */
export function billListStatus(row: BillListRow): BillListStatus {
  if (row.pending_invite) return { tone: "neutral", label: "Menunggu jawabanmu" };
  if (row.settled || row.settled_manual) return { tone: "success", label: "Lunas" };
  if (row.pending_names?.length) return { tone: "neutral", label: "Menunggu memilih" };
  if ((row.total_unpaid || 0) > 0 || (row.uncovered_idr || 0) > 0) return { tone: "danger", label: "Belum lunas" };
  return { tone: "neutral", label: "Belum dipilih" };
}

/** The inviter named by a pending-invite row, for the row's helper line. */
export function billListInviter(row: BillListRow): string {
  const name = String(row.pending_invited_by_name ?? "").trim();
  return name || "pengundang";
}

export type PaymentAccount = {
  id: number;
  brand: string;
  account_no: string;
  holder_name?: string | null;
};

export type Contact = {
  id: string;
  name: string;
  /**
   * `MAX(b.created_at) AS last_shared` from `GET /api/identities/{id}/contacts`
   * (`db.get_contacts`, backend/db.py:478) — when the caller last shared a bill
   * with this person. Absent (not merely empty) when the server sends none.
   *
   * This is the ONE definition of the contacts row shape: the "Yang ikut"
   * picker's caption reads it, and it survives `normalizeContact` so no caller
   * has to re-declare the field locally and silently lose it.
   */
  last_shared?: string;
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

/**
 * A proven contact PICKED on the create screen ("Yang ikut").
 *
 * This is deliberately NOT the same thing as `CreateBillRequest.participants`.
 * That field is a list of free-typed NAMES that the server stores as
 * placeholder rows with no identity behind them. A picked contact is a real
 * identity: it cannot be sent to `POST /api/bills` (the endpoint takes names,
 * and the person must accept/link up as a real member), so it is put on the
 * bill AFTERWARDS with `POST /api/bills/{id}/invite`, exactly like the legacy
 * client did (frontend/static/create.js:1936). Keeping the two in separate
 * draft fields is what stops a proven contact from becoming a duplicate
 * placeholder row (bug history: the legacy code had to drop same-named typed
 * rows when a contact was picked, because both lists fed one roster).
 */
export type PickedContact = {
  id: string;
  name: string;
  /** `last_shared` from GET /api/identities/{id}/contacts, when available. */
  last_shared?: string;
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
  /** Proven contacts picked from the contact list — see `PickedContact`. */
  picked_contacts: PickedContact[];
  photos: string[];
  photo_path?: string;
};

/* ------------------------------------------------------------------ picker
   Pure derivations of the "Yang ikut" picker, kept next to the DTOs they
   operate on so the create screen and the logic suite share ONE definition of
   what each helper means. They live here rather than in the route because the
   picker's load-bearing rules are the kind that must be testable without a
   DOM: (a) a picked contact never becomes a `participants` placeholder, and
   (b) the same person can never be recorded twice, and (c) the caption never
   claims a shared bill it cannot prove. */

/**
 * The ONE "is this the same person?" normalisation.
 *
 * Legacy equivalent: `normName` (`frontend/static/bill.js:4`:
 * `String(s || "").trim().toLowerCase()`), which the create screen used for the
 * two duplicate guards the React port dropped
 * (frontend/static/create.js:1341-1342 and :1389). Exported and singular on
 * purpose: two inline copies of this comparison is exactly how the guards drift
 * apart again.
 */
export function normalizePersonName(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

/** The legacy refusal toast (frontend/static/create.js:1342), verbatim. */
export const DUPLICATE_TYPED_NAME_NOTICE = "Nama itu sudah kepilih";

/** Legacy's caption (frontend/static/create.js:1380) for a contact row. */
export function pickerContactCaption(contact: Pick<PickedContact, "last_shared">): string {
  return contact.last_shared ? "pernah berbagi bill" : "kontak terbukti";
}

/** `.avatar` initial, matching the invite sheet's `name.slice(0,1)` display. */
export function contactInitial(name: string): string {
  return String(name || "").trim().slice(0, 1).toUpperCase();
}

/** Add/remove one contact from the picked list without mutating the draft. */
export function togglePickedContact(picked: PickedContact[], contact: PickedContact): PickedContact[] {
  if (picked.some(item => item.id === contact.id)) return picked.filter(item => item.id !== contact.id);
  return [...picked, { id: contact.id, name: contact.name, last_shared: contact.last_shared }];
}

/**
 * Rule 1 of the legacy duplicate guards: ticking a contact REMOVES any
 * free-typed entry that names the same person.
 *
 * Ports `frontend/static/create.js:1389`
 * (`verifyState.extraNames = verifyState.extraNames.filter(n => normName(n) !== normName(name))`).
 * Without it, one person ends up on the created bill twice: once as the
 * identity-less placeholder fed by `participants`, once as the invited member.
 */
export function removeTypedName(extraNames: string[], contactName: string): string[] {
  const target = normalizePersonName(contactName);
  return extraNames.filter(name => normalizePersonName(name) !== target);
}

/**
 * The WHOLE reaction to a contact checkbox toggle: apply the picked-list
 * toggle AND the same-named free-typed strip in one step.
 *
 * Both halves are one helper because they must not be separable — calling the
 * toggle without the strip is the exact regression this pair exists to close.
 */
export function applyContactToggle(
  draft: Pick<BillDraft, "extra_names" | "picked_contacts">,
  contact: PickedContact,
): Pick<BillDraft, "extra_names" | "picked_contacts"> {
  const picked_contacts = togglePickedContact(draft.picked_contacts, contact);
  const picked = picked_contacts.some(item => item.id === contact.id);
  return {
    picked_contacts,
    extra_names: picked ? removeTypedName(draft.extra_names, contact.name) : draft.extra_names,
  };
}

/**
 * Rule 2 of the legacy duplicate guards: refuse a free-typed name that matches
 * an already-picked contact.
 *
 * Ports the refusal branch of `frontend/static/create.js:1341-1342`, which
 * toasted `Nama itu sudah kepilih` and returned WITHOUT pushing the name.
 * Returns `null` when the name may be added, otherwise the notice to show.
 */
export function typedNameRefusal(
  draft: Pick<BillDraft, "extra_names" | "picked_contacts">,
  rawName: string,
): string | null {
  const name = normalizePersonName(rawName);
  if (!name) return null;
  const collides = draft.extra_names.some(existing => normalizePersonName(existing) === name)
    || draft.picked_contacts.some(contact => normalizePersonName(contact.name) === name);
  return collides ? DUPLICATE_TYPED_NAME_NOTICE : null;
}

/**
 * The placeholder names that go into `CreateBillRequest.participants`.
 *
 * Takes the whole draft rather than `extra_names` alone so the separation is
 * enforced in ONE place: a picked contact has an identity and MUST NOT appear
 * here, or the bill would carry both a placeholder row and an invite for the
 * same person.
 *
 * The picked-contact exclusion is not belt-and-braces invention: the legacy
 * submit path did the same filter on the same two fields
 * (`frontend/static/create.js:1927-1928`), which is why the legacy build could
 * not produce the duplicate row at all. Keeping it here means the create payload
 * cannot name a picked contact even if a widget-level guard is bypassed.
 */
export function participantPlaceholders(
  draft: Pick<BillDraft, "extra_names"> & { picked_contacts?: PickedContact[] },
): string[] {
  const pickedNames = (draft.picked_contacts ?? []).map(contact => normalizePersonName(contact.name));
  return draft.extra_names
    .map(name => name.trim())
    .filter(Boolean)
    .filter(name => !pickedNames.includes(normalizePersonName(name)));
}

/** Legacy's bounded-invite copy, as a pure mapping of the settled results. */
export function inviteFailureNotice(results: Array<{ status: "fulfilled" | "rejected" }> | null): string {
  if (!results) return "Bill sudah jadi. Sebagian undangan masih diproses, cek lagi nanti.";
  const failed = results.filter(result => result.status === "rejected").length;
  return failed ? `Bill sudah jadi, tapi ${failed} undangan gagal. Coba undang lagi dari bill.` : "";
}