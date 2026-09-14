import type {
  AutoAcceptRequest,
  BillListRow,
  BillResponse,
  Contact,
  CreateBillRequest,
  CreateIdentityRequest,
  Identity,
  IdentityCodeRequest,
  IdentityNameRequest,
  IdentityProfile,
  InviteMutationResponse,
  InviteRequest,
  MutationOk,
  OcrItem,
  OcrResponse,
  PendingInvite,
  PaymentAccount,
  PaymentAccountInput,
  PhotoDeleteResponse,
  PhotoUploadResponse,
  PayerRequest,
  RecapResponse,
  RecapAction,
  RecapBill,
  RecapCounterparty,
  RecapCounterpartyBill,
  RecapPendingCounts,
  RestoreIdentityRequest,
  SelectionPick,
  SetSelectionsRequest,
  SlotCountRequest,
  UpdateBillRequest,
} from "./types";

export type HttpMethod = "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE";

export type ApiRequestInit = Omit<RequestInit, "body" | "method"> & {
  method?: HttpMethod;
  body?: BodyInit | null;
  json?: unknown;
  /** One request may need the identity returned by the previous request. */
  identity?: Identity | null;
};

export class ApiError extends Error {
  readonly status: number;
  readonly offline: boolean;
  readonly aborted: boolean;

  constructor(message: string, status = 0, offline = false, aborted = false) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.offline = offline;
    this.aborted = aborted;
  }
}

type IdentityGetter = () => Identity | null;
const listeners = new Set<() => void>();
let getIdentity: IdentityGetter = () => null;

export function configureApi(identityGetter: IdentityGetter): void {
  getIdentity = identityGetter;
}

export function onMutation(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Build the two auth headers in one place. The public id is useful for
 * identifying the viewer, while the secret is the credential and is omitted
 * unless it is a string returned to this device by the identity endpoints.
 */
export function identityHeaders(identity: Identity | null): Record<string, string> {
  if (!identity?.id) return {};
  const headers: Record<string, string> = { "X-Identity-Id": identity.id };
  if (typeof identity.secret === "string" && identity.secret) {
    headers["X-Identity-Secret"] = identity.secret;
  }
  return headers;
}

function detailMessage(detail: unknown): string | null {
  if (typeof detail === "string" && detail.trim()) return detail.trim();
  if (Array.isArray(detail)) {
    const messages = detail
      .map(item => detailMessage(item))
      .filter((item): item is string => Boolean(item));
    return messages.length ? messages.join(", ") : null;
  }
  if (detail && typeof detail === "object" && "msg" in detail) {
    const message = (detail as { msg?: unknown }).msg;
    return typeof message === "string" && message.trim() ? message.trim() : null;
  }
  return null;
}

function messageFromBody(body: unknown, status: number): string {
  const detail = body && typeof body === "object" && "detail" in body
    ? (body as { detail?: unknown }).detail
    : undefined;
  return detailMessage(detail)
    || (status === 429
      ? "Terlalu banyak permintaan, tunggu sebentar ya"
      : `Terjadi kendala (${status})`);
}

async function readBody(response: Response, status: number): Promise<unknown> {
  let text: string;
  try {
    text = await response.text();
  } catch {
    throw new ApiError("Respons server tidak dapat dibaca", status);
  }
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ApiError("Respons server tidak sesuai format", status);
  }
}

function notifyMutation(): void {
  // A cache listener is UI plumbing, not part of the request's success. One
  // broken subscriber must not turn a committed mutation into an offline
  // error shown to the user.
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // Keep the response usable even if a stale screen already unmounted.
    }
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function requiredText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isBillStatus(value: unknown): value is "open" | "closed" {
  return value === "open" || value === "closed";
}

/**
 * Keep response validation at the boundary instead of letting an unexpected
 * proxy/server payload become a half-rendered screen. These are deliberately
 * small structural checks; the server remains responsible for domain rules.
 */
export function normalizeIdentity(value: unknown): Identity {
  const data = record(value);
  if (!data || !requiredText(data.id) || typeof data.name !== "string") {
    throw new ApiError("Respons identitas tidak sesuai format");
  }
  const identity: Identity = { id: data.id, name: data.name };
  if (data.secret === null || typeof data.secret === "string") identity.secret = data.secret;
  if (typeof data.has_code === "boolean") identity.has_code = data.has_code;
  if (typeof data.auto_accept === "boolean") identity.auto_accept = data.auto_accept;
  return identity;
}

export function normalizeBillResponse(value: unknown): BillResponse {
  const data = record(value);
  const bill = data && record(data.bill);
  const requiredArrays = ["items", "people", "participants"];
  const requiredBooleans = ["can_manage", "all_paid", "settled"];
  const validBill = bill
    && requiredText(bill.id)
    && typeof bill.title === "string"
    && isBillStatus(bill.status)
    && requiredText(bill.creator_identity_id)
    && Number.isSafeInteger(bill.total_idr);
  const validArrays = data && requiredArrays.every(key => Array.isArray(data[key]));
  const validBooleans = data && requiredBooleans.every(key => typeof data[key] === "boolean");
  if (!data || !validBill || !validArrays || !validBooleans
    || !record(data.sel_by_item) || !Number.isSafeInteger(data.uncovered_idr)) {
    throw new ApiError("Respons bill tidak sesuai format");
  }
  return data as unknown as BillResponse;
}

export function normalizeBillList(value: unknown): BillListRow[] {
  if (!Array.isArray(value) || value.some(item => {
    const row = record(item);
    return !row || !requiredText(row.id) || typeof row.title !== "string"
      || !isBillStatus(row.status) || !requiredText(row.creator_identity_id)
      || !Number.isSafeInteger(row.total_idr) || typeof row.settled !== "boolean";
  })) {
    throw new ApiError("Respons daftar bill tidak sesuai format");
  }
  return value as BillListRow[];
}

export function normalizePaymentAccount(value: unknown): PaymentAccount {
  const data = record(value);
  if (!data || !Number.isSafeInteger(data.id) || !requiredText(data.brand) || !requiredText(data.account_no)) {
    throw new ApiError("Respons metode bayar tidak sesuai format");
  }
  return data as PaymentAccount;
}

export function normalizePaymentAccounts(value: unknown): PaymentAccount[] {
  if (!Array.isArray(value)) throw new ApiError("Respons metode bayar tidak sesuai format");
  return value.map(normalizePaymentAccount);
}

export function normalizeMutationOk(value: unknown): MutationOk {
  const data = record(value);
  if (!data || data.ok !== true) throw new ApiError("Respons perubahan tidak sesuai format");
  return { ok: true };
}

function optionalString(data: Record<string, unknown>, key: string): string | undefined {
  return data[key] == null ? undefined : typeof data[key] === "string" ? data[key] : undefined;
}

function optionalSafeInteger(data: Record<string, unknown>, key: string): number | undefined {
  return data[key] == null ? undefined : Number.isSafeInteger(data[key]) ? data[key] as number : undefined;
}

export function normalizeContact(value: unknown): Contact {
  const data = record(value);
  if (!data || !requiredText(data.id) || !requiredText(data.name)) {
    throw new ApiError("Respons kontak tidak sesuai format");
  }
  return { id: data.id, name: data.name };
}

export function normalizeContacts(value: unknown): Contact[] {
  if (!Array.isArray(value)) throw new ApiError("Respons kontak tidak sesuai format");
  return value.map(normalizeContact);
}

export function normalizePendingInvite(value: unknown): PendingInvite {
  const data = record(value);
  if (!data || !Number.isSafeInteger(data.id)) {
    throw new ApiError("Respons undangan tidak sesuai format");
  }
  const invite: PendingInvite = { id: data.id as number };
  for (const key of ["bill_id", "identity_id", "invited_by", "name", "bill_title", "invited_by_name", "created_at"] as const) {
    const stringValue = optionalString(data, key);
    if (stringValue !== undefined) invite[key] = stringValue;
  }
  const billTotal = optionalSafeInteger(data, "bill_total");
  if (billTotal !== undefined) invite.bill_total = billTotal;
  const status = optionalString(data, "status");
  if (status !== undefined) invite.status = status;
  return invite;
}

export function normalizePendingInvites(value: unknown): PendingInvite[] {
  if (!Array.isArray(value)) throw new ApiError("Respons undangan tidak sesuai format");
  return value.map(normalizePendingInvite);
}

function normalizeInviteMutation(value: unknown): InviteMutationResponse {
  const data = record(value);
  if (!data || (data.status !== "joined" && data.status !== "pending")) {
    throw new ApiError("Respons undangan tidak sesuai format");
  }
  return { status: data.status };
}

function normalizeGeneratedCode(value: unknown): { code: string } {
  const data = record(value);
  if (!data || !requiredText(data.code)) throw new ApiError("Respons kode pemulihan tidak sesuai format");
  return { code: data.code };
}

function normalizeOcrItem(value: unknown): OcrItem {
  const data = record(value);
  if (!data) throw new ApiError("Respons OCR tidak sesuai format");
  const item: OcrItem = {};
  for (const key of ["name", "mode"] as const) {
    const stringValue = optionalString(data, key);
    if (stringValue !== undefined) item[key] = stringValue;
  }
  for (const key of ["price", "price_idr", "discount", "discount_idr", "quantity", "slot_count"] as const) {
    if (data[key] == null) continue;
    if (key === "price" || key === "discount" || key === "quantity") {
      if (typeof data[key] !== "number" && typeof data[key] !== "string") {
        throw new ApiError("Respons OCR tidak sesuai format");
      }
      item[key] = data[key] as number & string;
    } else if (Number.isSafeInteger(data[key])) {
      item[key] = data[key] as number;
    } else {
      throw new ApiError("Respons OCR tidak sesuai format");
    }
  }
  return item;
}

export function normalizeOcrResponse(value: unknown): OcrResponse {
  const data = record(value);
  if (!data) throw new ApiError("Respons OCR tidak sesuai format");
  const response: OcrResponse = {};
  for (const key of ["merchant", "title", "transacted_at", "date"] as const) {
    const stringValue = optionalString(data, key);
    if (stringValue !== undefined) response[key] = stringValue;
  }
  for (const key of ["subtotal", "tax", "service"] as const) {
    const numericValue = optionalSafeInteger(data, key);
    if (numericValue !== undefined) response[key] = numericValue;
  }
  if (data.tax_included != null) {
    if (typeof data.tax_included !== "boolean") throw new ApiError("Respons OCR tidak sesuai format");
    response.tax_included = data.tax_included;
  }
  if (data.items != null) {
    if (!Array.isArray(data.items)) throw new ApiError("Respons OCR tidak sesuai format");
    response.items = data.items.map(normalizeOcrItem);
  }
  if (data.photos != null) {
    if (!Array.isArray(data.photos) || data.photos.some(item => typeof item !== "string")) {
      throw new ApiError("Respons OCR tidak sesuai format");
    }
    response.photos = data.photos as string[];
  }
  if (data.photo_path != null) {
    if (typeof data.photo_path !== "string") throw new ApiError("Respons OCR tidak sesuai format");
    response.photo_path = data.photo_path;
  }
  return response;
}

function normalizePhotoUpload(value: unknown): PhotoUploadResponse {
  const data = record(value);
  if (!data || !requiredText(data.photo_path) || !requiredText(data.filename)) {
    throw new ApiError("Respons foto tidak sesuai format");
  }
  return { photo_path: data.photo_path, filename: data.filename };
}

function normalizePhotoDelete(value: unknown): PhotoDeleteResponse {
  const data = record(value);
  if (!data || typeof data.deleted !== "boolean") throw new ApiError("Respons foto tidak sesuai format");
  return { deleted: data.deleted };
}

function requiredSafeInteger(data: Record<string, unknown>, key: string): number {
  if (!Number.isSafeInteger(data[key])) throw new ApiError("Respons rekap tidak sesuai format");
  return data[key] as number;
}

function normalizeRecapBill(value: unknown): RecapBill {
  const data = record(value);
  if (!data || !requiredText(data.bill_id) || typeof data.title !== "string") {
    throw new ApiError("Respons rekap tidak sesuai format");
  }
  const bill: RecapBill = { bill_id: data.bill_id, title: data.title };
  for (const key of ["total_idr", "amount_idr"] as const) {
    const amount = optionalSafeInteger(data, key);
    if (amount !== undefined) bill[key] = amount;
  }
  const status = optionalString(data, "status");
  if (status !== undefined) bill.status = status;
  if (data.reason_codes != null) {
    if (!Array.isArray(data.reason_codes) || data.reason_codes.some(item => typeof item !== "string")) {
      throw new ApiError("Respons rekap tidak sesuai format");
    }
    bill.reason_codes = data.reason_codes as string[];
  }
  const counterpartyName = optionalString(data, "counterparty_name");
  if (counterpartyName !== undefined) bill.counterparty_name = counterpartyName;
  if (typeof data.final === "boolean") bill.final = data.final;
  return bill;
}

function normalizeRecapAction(value: unknown): RecapAction {
  const data = record(value);
  if (!data || !requiredText(data.bill_id) || typeof data.title !== "string") {
    throw new ApiError("Respons rekap tidak sesuai format");
  }
  const action: RecapAction = { bill_id: data.bill_id, title: data.title };
  for (const key of ["kind", "type", "reason", "owner", "identity_id", "name", "counterparty_id", "counterparty_name", "href", "invited_by", "invited_by_name"] as const) {
    const stringValue = optionalString(data, key);
    if (stringValue !== undefined) action[key] = stringValue;
  }
  const amount = optionalSafeInteger(data, "amount_idr");
  if (amount !== undefined) action.amount_idr = amount;
  const inviteId = optionalSafeInteger(data, "invite_id");
  if (inviteId !== undefined) action.invite_id = inviteId;
  if (typeof data.provisional === "boolean") action.provisional = data.provisional;
  return action;
}

function normalizeRecapCounterpartyBill(value: unknown): RecapCounterpartyBill {
  const data = record(value);
  if (!data || !requiredText(data.bill_id) || typeof data.title !== "string"
    || !Number.isSafeInteger(data.amount_idr)
    || (data.direction !== "pay" && data.direction !== "receive")
    || (data.status !== "open" && data.status !== "closed")) {
    throw new ApiError("Respons rekap tidak sesuai format");
  }
  return {
    bill_id: data.bill_id,
    title: data.title,
    amount_idr: data.amount_idr as number,
    direction: data.direction,
    status: data.status,
  };
}

function normalizeRecapPendingCounts(value: unknown): RecapPendingCounts {
  const data = record(value);
  if (!data) throw new ApiError("Respons rekap tidak sesuai format");
  if (!Array.isArray(data.bill_ids) || data.bill_ids.some(item => typeof item !== "string")) {
    throw new ApiError("Respons rekap tidak sesuai format");
  }
  return {
    count: requiredSafeInteger(data, "count"),
    current_user: requiredSafeInteger(data, "current_user"),
    waiting_other: requiredSafeInteger(data, "waiting_other"),
    bill_ids: data.bill_ids as string[],
  };
}

function normalizeRecapCounterparty(value: unknown): RecapCounterparty {
  const data = record(value);
  if (!data || !requiredText(data.identity_id) || typeof data.name !== "string"
    || !Number.isSafeInteger(data.net_idr) || (data.direction !== "pay" && data.direction !== "receive")
    || !Number.isSafeInteger(data.amount_idr) || !Array.isArray(data.bills)) {
    throw new ApiError("Respons rekap tidak sesuai format");
  }
  return {
    identity_id: data.identity_id,
    name: data.name,
    net_idr: data.net_idr as number,
    direction: data.direction,
    amount_idr: data.amount_idr as number,
    bills: data.bills.map(normalizeRecapCounterpartyBill),
    pending: normalizeRecapPendingCounts(data.pending),
  };
}

export function normalizeRecap(value: unknown): RecapResponse {
  const data = record(value);
  const identity = data && record(data.identity);
  const final = data && record(data.final);
  const provisional = data && record(data.provisional);
  const actions = data && record(data.actions);
  const counts = data && record(data.counts);
  if (!identity || !requiredText(identity.id) || typeof identity.name !== "string"
    || !final || !provisional || !actions || !counts
    || !Array.isArray(final.counterparties) || !Array.isArray(provisional.bills)
    || !Array.isArray(actions.current_user) || !Array.isArray(actions.waiting_other)) {
    throw new ApiError("Respons rekap tidak sesuai format");
  }
  return {
    identity: { id: identity.id, name: identity.name },
    final: {
      payable_idr: requiredSafeInteger(final, "payable_idr"),
      receivable_idr: requiredSafeInteger(final, "receivable_idr"),
      net_idr: requiredSafeInteger(final, "net_idr"),
      counterparties: final.counterparties.map(normalizeRecapCounterparty),
      bill_count: requiredSafeInteger(final, "bill_count"),
    },
    provisional: {
      bill_count: requiredSafeInteger(provisional, "bill_count"),
      payable_idr: requiredSafeInteger(provisional, "payable_idr"),
      receivable_idr: requiredSafeInteger(provisional, "receivable_idr"),
      bills: provisional.bills.map(normalizeRecapBill),
    },
    actions: {
      current_user: actions.current_user.map(normalizeRecapAction),
      waiting_other: actions.waiting_other.map(normalizeRecapAction),
    },
    counts: {
      current_user: requiredSafeInteger(counts, "current_user"),
      waiting_other: requiredSafeInteger(counts, "waiting_other"),
      provisional_bills: requiredSafeInteger(counts, "provisional_bills"),
    },
  };
}

function normalizeIdentityProfile(value: unknown): IdentityProfile {
  const data = record(value);
  if (!data || !requiredText(data.id) || typeof data.name !== "string"
    || typeof data.has_code !== "boolean" || typeof data.auto_accept !== "boolean") {
    throw new ApiError("Respons profil tidak sesuai format");
  }
  return {
    id: data.id,
    name: data.name,
    has_code: data.has_code,
    auto_accept: data.auto_accept,
  };
}

function normalizeCreatedBill(value: unknown): { id: string } {
  const data = record(value);
  if (!data || !requiredText(data.id)) throw new ApiError("Respons bill tidak sesuai format");
  return { id: data.id };
}

export async function api<T = unknown>(path: string, options: ApiRequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  const { json, identity: requestIdentity, ...requestOptions } = options;
  const identity = requestIdentity === undefined ? getIdentity() : requestIdentity;
  for (const [name, value] of Object.entries(identityHeaders(identity))) headers.set(name, value);

  const method = (options.method || (json === undefined ? "GET" : "POST")).toUpperCase() as HttpMethod;
  let body = requestOptions.body;
  if (json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(json);
  }

  let payload: unknown;
  try {
    const response = await fetch(path, { ...requestOptions, method, headers, body });
    if (!response.ok) {
      let parsed: unknown = null;
      try {
        parsed = await readBody(response, response.status);
      } catch {
        // A proxy may return HTML or close the body. The status still gives a
        // useful, safe message to the caller.
      }
      throw new ApiError(messageFromBody(parsed, response.status), response.status);
    }
    payload = await readBody(response, response.status);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (options.signal?.aborted) {
      throw new ApiError("Permintaan dibatalkan", 0, false, true);
    }
    if (typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "AbortError") {
      throw new ApiError("Permintaan dibatalkan", 0, false, true);
    }
    throw new ApiError("Koneksi bermasalah. Periksa koneksi internet kamu, lalu coba lagi.", 0, true);
  }

  if (method !== "GET" && method !== "HEAD") notifyMutation();
  return payload as T;
}

export function apiJson<T = unknown>(path: string, method: HttpMethod, json: unknown): Promise<T> {
  return api<T>(path, { method, json });
}

export function apiJsonAs<T = unknown>(identity: Identity | null, path: string, method: HttpMethod, json: unknown): Promise<T> {
  return api<T>(path, { method, json, identity });
}

export async function upload<T = unknown>(path: string, file: File | File[], field = "file"): Promise<T> {
  const form = new FormData();
  for (const item of Array.isArray(file) ? file : [file]) form.append(field, item);
  return api<T>(path, { method: "POST", body: form });
}

const segment = (value: string | number): string => encodeURIComponent(String(value));

/**
 * Typed endpoint facade for feature routes. The low-level `api` function stays
 * available for narrowly scoped additions, but normal screens should use this
 * facade so request and response shapes cannot drift independently.
 */
export const apiClient = {
  identities: {
    create: (input: CreateIdentityRequest) => api<unknown>("/api/identities", { method: "POST", json: input }).then(normalizeIdentity),
    restore: (input: RestoreIdentityRequest) => api<unknown>("/api/identities/restore", { method: "POST", json: input }).then(normalizeIdentity),
    bind: (identityId: string, input: IdentityCodeRequest) => api<unknown>(`/api/identities/${segment(identityId)}/bind`, { method: "POST", json: input }).then(normalizeIdentity),
    profile: (identityId: string) => api<unknown>(`/api/identities/${segment(identityId)}/me`).then(normalizeIdentityProfile),
    rename: (identityId: string, input: IdentityNameRequest) => api<unknown>(`/api/identities/${segment(identityId)}/name`, { method: "POST", json: input }).then(normalizeMutationOk),
    setCode: (identityId: string, input: IdentityCodeRequest) => api<unknown>(`/api/identities/${segment(identityId)}/code`, { method: "POST", json: input }).then(normalizeMutationOk),
    generateCode: (identityId: string) => api<unknown>(`/api/identities/${segment(identityId)}/code/generate`, { method: "POST", json: {} }).then(normalizeGeneratedCode),
    setAutoAccept: (identityId: string, input: AutoAcceptRequest) => api<unknown>(`/api/identities/${segment(identityId)}/auto_accept`, { method: "POST", json: input }).then(normalizeMutationOk),
    accounts: (identityId: string) => api<unknown>(`/api/identities/${segment(identityId)}/accounts`).then(normalizePaymentAccounts),
    addAccount: (identityId: string, input: PaymentAccountInput) => api<unknown>(`/api/identities/${segment(identityId)}/accounts`, { method: "POST", json: input }).then(normalizePaymentAccount),
    contacts: (identityId: string, query = "") => api<unknown>(`/api/identities/${segment(identityId)}/contacts${query ? `?q=${segment(query)}` : ""}`).then(normalizeContacts),
    bills: (identityId: string) => api<unknown>(`/api/identities/${segment(identityId)}/bills`).then(normalizeBillList),
    invites: (identityId: string) => api<unknown>(`/api/identities/${segment(identityId)}/invites`).then(normalizePendingInvites),
    recap: (identityId: string) => api<unknown>(`/api/identities/${segment(identityId)}/recap`).then(normalizeRecap),
  },
  accounts: {
    update: (accountId: number, input: PaymentAccountInput) => api<unknown>(`/api/accounts/${segment(accountId)}`, { method: "PUT", json: input }).then(normalizePaymentAccount),
    remove: (accountId: number) => api<unknown>(`/api/accounts/${segment(accountId)}`, { method: "DELETE" }).then(normalizeMutationOk),
  },
  bills: {
    create: (input: CreateBillRequest) => api<unknown>("/api/bills", { method: "POST", json: input }).then(normalizeCreatedBill),
    get: (billId: string) => api<unknown>(`/api/bills/${segment(billId)}`).then(normalizeBillResponse),
    update: (billId: string, input: UpdateBillRequest) => api<unknown>(`/api/bills/${segment(billId)}`, { method: "PUT", json: input }).then(normalizeBillResponse),
    setPayer: (billId: string, input: PayerRequest) => api<unknown>(`/api/bills/${segment(billId)}/paid_by`, { method: "PUT", json: input }).then(normalizeBillResponse),
    remove: (billId: string) => api<unknown>(`/api/bills/${segment(billId)}`, { method: "DELETE" }).then(normalizeMutationOk),
    close: (billId: string) => api<unknown>(`/api/bills/${segment(billId)}/close`, { method: "POST", json: {} }).then(normalizeMutationOk),
    reopen: (billId: string) => api<unknown>(`/api/bills/${segment(billId)}/reopen`, { method: "POST", json: {} }).then(normalizeBillResponse),
    settle: (billId: string) => api<unknown>(`/api/bills/${segment(billId)}/settle`, { method: "POST", json: {} }).then(normalizeBillResponse),
    unsettle: (billId: string) => api<unknown>(`/api/bills/${segment(billId)}/unsettle`, { method: "POST", json: {} }).then(normalizeBillResponse),
    join: (billId: string) => api<unknown>(`/api/bills/${segment(billId)}/join`, { method: "POST", json: {} }).then(normalizeBillResponse),
    invite: (billId: string, input: InviteRequest) => api<unknown>(`/api/bills/${segment(billId)}/invite`, { method: "POST", json: input }).then(normalizeInviteMutation),
    acceptInvite: (billId: string, inviteId: number) => api<unknown>(`/api/bills/${segment(billId)}/invites/${segment(inviteId)}/accept`, { method: "POST", json: {} }).then(normalizeBillResponse),
    declineInvite: (billId: string, inviteId: number) => api<unknown>(`/api/bills/${segment(billId)}/invites/${segment(inviteId)}/decline`, { method: "POST", json: {} }).then(normalizeMutationOk),
    cancelInvite: (billId: string, inviteId: number) => api<unknown>(`/api/bills/${segment(billId)}/invites/${segment(inviteId)}`, { method: "DELETE" }).then(normalizeBillResponse),
    removePerson: (billId: string, identityId: string) => api<unknown>(`/api/bills/${segment(billId)}/people/${segment(identityId)}`, { method: "DELETE" }).then(normalizeBillResponse),
    leave: (billId: string) => api<unknown>(`/api/bills/${segment(billId)}/leave`, { method: "POST", json: {} }).then(normalizeBillResponse),
    selections: (billId: string, picks: SelectionPick[]) => {
      const input: SetSelectionsRequest = { picks };
      return api<unknown>(`/api/bills/${segment(billId)}/selections`, { method: "POST", json: input }).then(normalizeBillResponse);
    },
    setSlots: (billId: string, itemId: number, input: SlotCountRequest) => api<unknown>(`/api/bills/${segment(billId)}/items/${segment(itemId)}/slots`, { method: "PUT", json: input }).then(normalizeBillResponse),
    releaseSelection: (billId: string, itemId: number, identityId: string) => api<unknown>(`/api/bills/${segment(billId)}/items/${segment(itemId)}/selections/${segment(identityId)}`, { method: "DELETE" }).then(normalizeBillResponse),
    markPaid: (billId: string, identityId: string) => api<unknown>(`/api/bills/${segment(billId)}/payments/${segment(identityId)}/paid`, { method: "POST", json: {} }).then(normalizeBillResponse),
    markUnpaid: (billId: string, identityId: string) => api<unknown>(`/api/bills/${segment(billId)}/payments/${segment(identityId)}/unpaid`, { method: "POST", json: {} }).then(normalizeBillResponse),
    addPhoto: (billId: string, file: File) => upload<unknown>(`/api/bills/${segment(billId)}/photo`, file).then(normalizeBillResponse),
    deletePhoto: (billId: string, photoId: number) => api<unknown>(`/api/bills/${segment(billId)}/photos/${segment(photoId)}`, { method: "DELETE" }).then(normalizeBillResponse),
  },
  photos: {
    upload: (file: File) => upload<unknown>("/api/photos", file).then(normalizePhotoUpload),
    remove: (filename: string) => api<unknown>(`/api/photos/${segment(filename)}`, { method: "DELETE" }).then(normalizePhotoDelete),
    ocr: (files: File[]) => upload<unknown>("/api/ocr", files).then(normalizeOcrResponse),
  },
} as const;
