import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, Copy, PencilSimple, Receipt, ShareNetwork, SignOut, UserCircle, WarningCircle, Wallet, X } from "@phosphor-icons/react";
import { apiClient, apiJson, apiJsonAs } from "../lib/api";
import { getStoredName, setStoredIdentity, setStoredName } from "../lib/identity-storage";
import { navigate } from "../lib/routes";
import { inputMoney, rupiahFmt, rupiahParse, shortDate } from "../lib/money";
import { createRequestGate } from "../lib/async-state";
import { createSelectionSaveQueue, serializeSelections } from "../lib/selection-queue";

import type { BillItem, BillResponse, Contact, Identity, PayerRequest, Person, Selector, UpdateBillRequest } from "../lib/types";
import { AccountRows, AppFrame, ErrorState, ShareDialogContent, Topbar } from "../components/AppShell";
import { ReceiptPhotoGallery } from "../components/ReceiptPhotoGallery";
import { Alert, Badge, Button, Card, Dialog, Input, Label, Spinner } from "../components/ui/primitives";

function quantity(value: number | string | null | undefined): number { const n = Number(value); return Number.isInteger(n) && n > 0 ? n : 1; }
function effectivePrice(item: BillItem): number { return Math.max(0, item.price_idr - (item.discount_idr || 0)); }
function selectorsFor(data: BillResponse, itemId: number): Selector[] { return data.sel_by_item?.[String(itemId)] || []; }
function selectedBy(identity: Identity, selectors: Selector[]): Selector | undefined { return selectors.find(item => item.id === identity.id) || selectors.filter(item => !item.id && item.name.trim().toLowerCase() === identity.name.trim().toLowerCase()).at(0); }
function hasPick(data: BillResponse, id: string): boolean { return Object.values(data.sel_by_item || {}).some(list => list.some(item => item.id === id)); }
function person(data: BillResponse, identity: Identity): Person | undefined { return data.people.find(item => item.identity_id === identity.id); }
function totalFor(data: BillResponse, identity: Identity): number { return person(data, identity)?.total_idr || 0; }
function paymentName(data: BillResponse): string { return data.paid_by_name || data.creator_name; }
/* Payer plus THEIR payment accounts. Restored from the legacy payerPayment()
   helper (frontend/static/bill.js) because the React port dropped it and used
   `paid_by_accounts || creator_accounts`.

   Only fall back to the creator's accounts when the creator IS the payer (or no
   payer is declared yet). A resolved payer who has not saved any method must
   NOT inherit the creator's accounts: with Amel set as payer and Amel having no
   accounts, the guest screen headed "Bayar ke Amel" was listing Aufa's GoPay
   and Mandiri, i.e. telling people to transfer to the wrong person. */
function payerAccounts(data: BillResponse): BillResponse["paid_by_accounts"] {
  const own = data.paid_by_accounts;
  if (own && own.length) return own;
  const isCreatorPayer = data.paid_by_id === data.bill.creator_identity_id
    || (!data.paid_by_id && !data.paid_by_name);
  return isCreatorPayer ? (data.creator_accounts || []) : [];
}
function pendingPickerNames(data: BillResponse): string[] {
  const payerId = data.paid_by_id;
  const names: string[] = [];
  const seen = new Set<string>();
  const add = (value: string) => {
    const name = value.trim();
    const key = name.toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    names.push(name);
  };
  data.people.forEach(item => {
    if (item.identity_id === payerId || hasPick(data, item.identity_id)) return;
    add(item.name);
  });
  (data.participants || []).forEach(item => {
    if (item.identity_id) {
      if (item.identity_id === payerId || hasPick(data, item.identity_id)) return;
    } else if (data.people.some(personItem => personItem.identity_id === payerId
      && personItem.name.trim().toLowerCase() === item.name.trim().toLowerCase())) {
      return;
    }
    add(item.name);
  });
  return names;
}
function isManualSettlement(data: BillResponse): boolean { return Boolean(data.settled_manual || data.bill.settled_manual); }
function isSettled(data: BillResponse): boolean { return Boolean(data.settled || isManualSettlement(data)); }
function statusLabel(data: BillResponse): { tone: "success" | "danger" | "neutral"; label: string } {
  if (isSettled(data)) return { tone: "success", label: "Lunas" };
  if (data.uncovered_idr > 0) return { tone: "danger", label: `${rupiahFmt(data.uncovered_idr)} belum terambil` };
  if (data.people.some(item => item.identity_id !== data.paid_by_id && !hasPick(data, item.identity_id))) return { tone: "neutral", label: "Menunggu memilih" };
  return { tone: "neutral", label: "Belum ada yang memilih" };
}

function GuestEntry({ billId, data, onIdentity }: { billId: string; data: BillResponse; onIdentity: (identity: Identity) => void }) {
  const [name, setName] = useState(getStoredName());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) { setError("Isi nama dulu"); return; }
    setBusy(true); setError("");
    try {
      const identity = await apiClient.identities.create({ name: name.trim() });
      setStoredIdentity(identity); setStoredName(name.trim());
      await apiJsonAs(identity, `/api/bills/${billId}/join`, "POST", {});
      onIdentity(identity);
    } catch (err) { setError(err instanceof Error ? err.message : "Gagal masuk ke bill"); }
    finally { setBusy(false); }
  };
  const payer = paymentName(data);
  return <AppFrame contextualDock><Topbar back={() => navigate({ kind: "home" })} /><div className="shell"><div className="stack"><Card className="bill-header"><p className="eyebrow">Kamu diundang untuk membagi bill</p><h1 className="section-title">{data.bill.title}</h1><strong className="hero-total money">{rupiahFmt(data.bill.total_idr)}</strong><div className="row wrap"><Badge tone="neutral"><Receipt /> {data.items.length} item</Badge><Badge tone="neutral"><UserCircle /> {data.people.length} orang sudah bergabung</Badge></div><p className="muted">Dibuat {data.creator_name}. Nanti bayarnya ke <strong>{payer}</strong>.</p></Card><Card><form id="guest-form" onSubmit={submit} noValidate className="stack-sm"><div className="field"><Label htmlFor="guest-name">Kamu siapa?</Label><Input id="guest-name" name="name" value={name} onChange={event => setName(event.target.value)} placeholder="Nama kamu" maxLength={60} autoComplete="name" autoFocus /></div>{error && <p className="error-text" role="alert">{error}</p>}<Button id="guest-go" type="submit" disabled={busy}>{busy ? <><Spinner /> Bentar...</> : "Lanjut, pilih item"}</Button></form><p className="muted">Tanpa akun. Namamu hanya untuk menandai item dan disimpan di perangkat ini.</p></Card></div></div></AppFrame>;
}

function ItemRow({ item, data, identity, qty, readOnly, onChange }: { item: BillItem; data: BillResponse; identity: Identity; qty: number; readOnly?: boolean; onChange?: (qty: number) => void }) {
  const selectors = selectorsFor(data, item.id);
  const mine = selectedBy(identity, selectors);
  const selected = qty > 0;
  const slot = item.mode === "slot" && Boolean(item.slot_count);
  const takenByOthers = selectors.filter(selector => selector.id !== identity.id).reduce((sum, selector) => sum + quantity(selector.qty), 0);
  const capacity = slot ? Math.max(0, (item.slot_count || 0) - takenByOthers) : 99;
  const full = slot && !selected && takenByOthers >= (item.slot_count || 0);
  const totalQty = selectors.reduce((sum, selector) => sum + quantity(selector.qty), 0) + (selected && !mine ? qty : 0);
  const share = slot ? `${Math.min(item.slot_count || 0, takenByOthers + qty)}/${item.slot_count} bagian` : totalQty > 0 ? `${totalQty} porsi` : "belum dipilih";
  const onActivate = () => { if (readOnly || full || !onChange) return; onChange(selected ? 0 : 1); };
  return <div className={`item-row bill-item ${selected ? "is-selected selected" : ""} ${full ? "is-full item-full" : ""}`} data-item={item.id} role={readOnly || full ? undefined : "checkbox"} tabIndex={readOnly || full ? undefined : 0} aria-checked={readOnly || full ? undefined : selected} aria-label={`${item.name}, ${rupiahFmt(effectivePrice(item) * quantity(item.quantity))}`} onClick={event => { if ((event.target as HTMLElement).closest(".step-button")) return; onActivate(); }} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onActivate(); } }}><div className="item-check" aria-hidden="true">{full ? <X /> : <Check />}</div><div className="item-copy"><div className="item-name">{item.name}</div><div className="item-share">{share}{slot ? " · dibagi per bagian" : " · dibagi sesuai porsi"}</div>{!readOnly && !full && <div className="item-stepper"><button type="button" className="step-button step-dec" aria-label="Kurangi" disabled={!selected} onClick={() => onChange?.(Math.max(0, qty - 1))}>-</button><span className="step-qty" aria-live="polite">{qty}</span><button type="button" className="step-button step-inc" aria-label="Tambah" disabled={slot ? qty >= capacity : qty >= 99} onClick={() => onChange?.(Math.min(slot ? capacity : 99, qty + 1))}>+</button></div>}</div><div className="item-price money">{rupiahFmt(effectivePrice(item) * quantity(item.quantity))}<small>{quantity(item.quantity)} dibeli</small></div></div>;
}

function Breakdown({ data, identity }: { data: BillResponse; identity: Identity }) {
  const row = person(data, identity);
  if (!row) return null;
  return <div className="breakdown" aria-label="Rincian bagian kamu"><div className="breakdown-line"><span>Item</span><strong className="money">{rupiahFmt(row.subtotal_idr)}</strong></div>{(row.order_discount_idr || 0) > 0 && <div className="breakdown-line"><span>Diskon pesanan</span><strong className="money" style={{ color: "var(--green)" }}>-{rupiahFmt(row.order_discount_idr)}</strong></div>}<div className="breakdown-line"><span>Pajak dan service</span><strong className="money">{rupiahFmt(row.tax_idr)}</strong></div>{(row.cashback_idr || 0) > 0 && <div className="breakdown-line"><span>Cashback dibagi</span><strong className="money" style={{ color: "var(--green)" }}>-{rupiahFmt(row.cashback_idr)}</strong></div>}<div className="breakdown-line breakdown-total"><span>Total kamu</span><strong className="money">{rupiahFmt(row.total_idr)}</strong></div></div>;
}

function GuestPicker({ data: initialData, identity }: { data: BillResponse; identity: Identity }) {
  const [data, setData] = useState(initialData);
  const [quantities, setQuantities] = useState<Record<number, number>>(() => {
    const result: Record<number, number> = {};
    initialData.items.forEach(item => { const mine = selectedBy(identity, selectorsFor(initialData, item.id)); if (mine) result[item.id] = quantity(mine.qty); });
    return result;
  });
  const [dialog, setDialog] = useState(false);
  const [saveError, setSaveError] = useState("");
  const queue = useRef(createSelectionSaveQueue());
  const requestGate = useRef(createRequestGate());
  useEffect(() => () => requestGate.current.invalidate(), []);
  const save = useCallback((next: Record<number, number>) => {
    const token = requestGate.current.begin();
    const picks = serializeSelections(next);
    return queue.current.enqueue(async () => {
      try {
        const fresh = await apiClient.bills.selections(data.bill.id, picks);
        if (requestGate.current.isCurrent(token)) setData(fresh);
        return fresh;
      } catch (error) {
        if (requestGate.current.isCurrent(token)) setSaveError(error instanceof Error ? error.message : "Pilihan belum tersimpan");
        throw error;
      }
    });
  }, [data.bill.id]);
  const change = (itemId: number, value: number) => { const next = { ...quantities }; if (value > 0) next[itemId] = value; else delete next[itemId]; setQuantities(next); setSaveError(""); void save(next).catch(() => undefined); };
  const row = person(data, identity);
  const manualSettlement = isManualSettlement(data);
  const settled = isSettled(data);
  const minePaid = Boolean(manualSettlement || row?.paid === "paid");
  const payer = paymentName(data);
  const state = statusLabel(data);
  const closed = data.bill.status === "closed";
  return <AppFrame contextualDock={!closed}><Topbar title={data.bill.title} back={() => navigate({ kind: "home" })} actions={<Button id="share-btn" type="button" variant="ghost" size="icon" aria-label="Bagikan bill" onClick={() => setDialog(true)}><ShareNetwork /></Button>} /><div className="shell shell-with-rail"><div className="shell-main stack bill-detail-main"><Card className="bill-header"><div className="bill-total-line wrap"><div><p className="eyebrow">Total bill</p><strong className="hero-total money">{rupiahFmt(data.bill.total_idr)}</strong></div><Badge className="chip" tone={state.tone}>{state.label}</Badge></div>{data.bill.merchant && <p className="muted">{data.bill.merchant}</p>}{(data.bill.transacted_at || data.bill.created_at) && <p className="muted">{shortDate(data.bill.transacted_at || data.bill.created_at)}</p>}<p className="muted">Dibuat {data.creator_name}{data.paid_by_name && data.paid_by_name !== data.creator_name ? `, nalangin ${data.paid_by_name}` : ""}</p>{data.uncovered_idr > 0 && <p className="error-text"><WarningCircle /> Bagian kosong belum terambil ({rupiahFmt(data.uncovered_idr)})</p>}</Card><Card className="bill-mobile-breakdown"><div className="card-title">Bagian kamu</div><Breakdown data={data} identity={identity} /></Card><Card className="bill-payment-card"><div className="card-title">Bayar ke {payer}</div><p className="muted">Bagian kamu mengikuti hitungan server setelah kamu memilih item.</p><AccountRows accounts={payerAccounts(data)} name={payer} /></Card>{closed && <Alert tone="info">Bill ini sudah ditutup. Pembagian final dan tidak bisa diubah.</Alert>}<Card className="bill-items-card"><div className="card-title"><span>{closed ? "Item yang kamu tanggung" : "Centang yang kamu tanggung"}</span><span className="caption">{data.items.length} item</span></div>{saveError && <p className="error-text" role="alert">{saveError}</p>}<div id="pick-items" className="bill-item-list">{data.items.map(item => <ItemRow key={item.id} item={item} data={data} identity={identity} qty={quantities[item.id] || 0} readOnly={closed} onChange={value => change(item.id, value)} />)}</div></Card>{closed && <Card><div className="row-between"><div><p className="eyebrow">Total kamu</p><strong className="money hero-total">{rupiahFmt(totalFor(data, identity))}</strong></div><Badge tone={minePaid ? "success" : "danger"}>{minePaid ? "Sudah bayar" : "Belum bayar"}</Badge></div><Breakdown data={data} identity={identity} /></Card>}{!closed && data.owner_id !== identity.id && <Button variant="ghost" className="btn-danger-link" onClick={async () => { try { await apiClient.bills.leave(data.bill.id); navigate({ kind: "home" }); } catch { /* screen remains actionable */ } }}><SignOut /> Keluar dari bill</Button>}</div>{!closed && <aside className="shell-side"><div className="dock"><div className="dock-panel"><div className="dock-total"><span className="muted">Total kamu</span><strong id="my-total" className="money">{rupiahFmt(totalFor(data, identity))}</strong></div><div id="my-breakdown" style={{ marginTop: 9 }}><Breakdown data={data} identity={identity} /></div>{data.paid_by_id === identity.id ? <Badge tone="neutral"><Wallet /> Kamu yang nalangin</Badge> : settled ? <Badge tone="success"><Check /> Pembayaran selesai</Badge> : <Button id="pay-btn" className={minePaid ? "btn-success btn-block" : "btn-primary btn-block"} onClick={() => setDialog(true)}>{minePaid ? <><Check /> Sudah bayar</> : "Tandai sudah bayar"}</Button>}</div></div></aside>}</div><Dialog open={dialog} title={data.paid_by_id === identity.id ? "Bagian kamu" : `Bayar ke ${payer}`} description="Cek nominal dari server sebelum menandai pembayaran." onClose={() => setDialog(false)}><Breakdown data={data} identity={identity} /><AccountRows accounts={payerAccounts(data)} name={payer} /><div className="sheet-actions"><Button id="confirm-pay" onClick={async () => { try { const fresh = minePaid ? await apiClient.bills.markUnpaid(data.bill.id, identity.id) : await apiClient.bills.markPaid(data.bill.id, identity.id); setData(fresh); setDialog(false); } catch { /* keep dialog open for retry */ } }}>{minePaid ? "Batalkan status bayar" : "Tandai sudah bayar"}</Button><Button variant="outline" onClick={() => setDialog(false)}>Batal</Button></div></Dialog></AppFrame>;
}

type CreatorPickerProps = {
  data: BillResponse;
  identity: Identity;
  onDone: (data: BillResponse) => void;
};

function CreatorPicker({ data: initialData, identity, onDone }: CreatorPickerProps) {
  const [data, setData] = useState(initialData);
  const [quantities, setQuantities] = useState<Record<number, number>>(() => {
    const result: Record<number, number> = {};
    initialData.items.forEach(item => {
      const mine = selectedBy(identity, selectorsFor(initialData, item.id));
      if (mine) result[item.id] = quantity(mine.qty);
    });
    return result;
  });
  const [finishing, setFinishing] = useState(false);
  const [saveError, setSaveError] = useState("");
  const queue = useRef(createSelectionSaveQueue());
  const requestGate = useRef(createRequestGate());
  const latestData = useRef(initialData);
  const pendingSave = useRef<Promise<BillResponse>>(Promise.resolve(initialData));
  useEffect(() => () => requestGate.current.invalidate(), []);

  const save = useCallback((next: Record<number, number>) => {
    const token = requestGate.current.begin();
    const picks = serializeSelections(next);
    const request = queue.current.enqueue(async () => {
      try {
        const fresh = await apiClient.bills.selections(data.bill.id, picks);
        latestData.current = fresh;
        if (requestGate.current.isCurrent(token)) setData(fresh);
        return fresh;
      } catch (error) {
        if (requestGate.current.isCurrent(token)) setSaveError(error instanceof Error ? error.message : "Pilihan belum tersimpan");
        throw error;
      }
    });
    pendingSave.current = request;
    return request;
  }, [data.bill.id]);

  const change = (itemId: number, value: number) => {
    if (finishing) return;
    const next = { ...quantities };
    if (value > 0) next[itemId] = value;
    else delete next[itemId];
    setQuantities(next);
    setSaveError("");
    void save(next).catch(() => undefined);
  };

  const finish = useCallback(async () => {
    if (finishing) return;
    setFinishing(true);
    setSaveError("");
    try {
      await pendingSave.current.catch(() => latestData.current);
      const fresh = await apiClient.bills.get(data.bill.id);
      latestData.current = fresh;
      setData(fresh);
      onDone(fresh);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Pilihan belum tersimpan");
    } finally {
      setFinishing(false);
    }
  }, [data.bill.id, finishing, onDone]);

  const state = statusLabel(data);
  const closed = data.bill.status === "closed";
  return <AppFrame contextualDock={!closed}>
    <Topbar title={`Pilih bagian kamu`} backId="back-btn" back={() => void finish()} actions={<Button id="done-btn" type="button" size="sm" disabled={finishing} onClick={() => void finish()}>{finishing ? <><Spinner /> Menyimpan...</> : "Selesai"}</Button>} />
    <div className="shell shell-with-rail">
      <div className="shell-main stack bill-detail-main">
        <Card className="bill-header">
          <p className="eyebrow">Pilih item</p>
          <h1 className="section-title">{data.bill.title}</h1>
          <p className="muted">Centang item yang kamu tanggung. Nominal kamu mengikuti hitungan server.</p>
          <Badge tone={state.tone}>{state.label}</Badge>
        </Card>
        <Card className="bill-items-card">
          <div className="card-title"><span>Item bill</span><span className="caption">{data.items.length} item</span></div>
          {saveError && <p className="error-text" role="alert">{saveError}</p>}
          <div id="pick-items" className="bill-item-list">{data.items.map(item => <ItemRow key={item.id} item={item} data={data} identity={identity} qty={quantities[item.id] || 0} readOnly={closed} onChange={value => change(item.id, value)} />)}</div>
        </Card>
      </div>
      <aside className="shell-side">
        <div className="dock"><div className="dock-panel">
          <div className="dock-total"><span className="muted">Total kamu</span><strong className="money">{rupiahFmt(totalFor(data, identity))}</strong></div>
          <div className="dock-breakdown"><span>Status bill</span><Badge tone={state.tone}>{state.label}</Badge></div>
          <Button type="button" className="btn-block" disabled={finishing} onClick={() => void finish()}>{finishing ? <><Spinner /> Menyimpan...</> : "Selesai memilih"}</Button>
        </div></div>
      </aside>
    </div>
  </AppFrame>;
}

type EditItemDraft = {
  key: string;
  id?: number;
  name: string;
  price: number;
  discount: number;
  quantity: number;
  quantityDraft: string | null;
  mode: "free" | "slot";
  slot_count: number | null;
};

type EditDraft = {
  title: string;
  merchant: string;
  transacted_at: string;
  items: EditItemDraft[];
  order_discount: number;
  cashback: number;
  tax: number;
  service: number;
  tax_included: boolean;
  participants: string[];
};

type EditTotals = {
  subtotal: number | null;
  orderDiscount: number;
  cashback: number;
  tax: number;
  service: number;
  total: number | null;
  invalidQuantityKey: string | null;
  emptyItemKey: string | null;
  invalidDiscountKey: string | null;
  orderDiscountTooHigh: boolean;
  cashbackTooHigh: boolean;
  invalid: boolean;
};

type LegacyConfirmSheetOptions = {
  title: string;
  body: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
};

type LegacyConfirmSheet = (options: LegacyConfirmSheetOptions) => Promise<boolean>;

type BillWindow = Window & {
  apiJson?: typeof apiJson;
  saveEditBill?: (billId: string) => Promise<BillResponse | undefined>;
  confirmSheet?: LegacyConfirmSheet;
};

const billWindow = () => window as BillWindow;

function editMoney(value: number | string | null | undefined): number {
  const parsed = typeof value === "number" ? value : rupiahParse(value);
  return parsed == null ? 0 : parsed;
}

function editMoneyInput(value: number): string {
  return value > 0 ? inputMoney(value) : "";
}

function editQuantity(value: string | number | null | undefined): number | null {
  const text = String(value ?? "").trim();
  if (!/^[1-9]\d*$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 99 ? parsed : null;
}

function editItemQuantity(item: EditItemDraft): number | null {
  return item.quantityDraft === null ? editQuantity(item.quantity) : editQuantity(item.quantityDraft);
}

function editDraftFromResponse(data: BillResponse): EditDraft {
  return {
    title: data.bill.title || "",
    merchant: data.bill.merchant || "",
    transacted_at: data.bill.transacted_at || "",
    items: data.items.map((item, index) => ({
      key: `server-${item.id}-${index}`,
      id: item.id,
      name: item.name,
      price: editMoney(item.price_idr),
      discount: editMoney(item.discount_idr),
      quantity: editQuantity(item.quantity) || 1,
      quantityDraft: null,
      mode: item.mode === "slot" ? "slot" : "free",
      slot_count: item.mode === "slot" ? editQuantity(item.slot_count) || 1 : null,
    })),
    order_discount: editMoney(data.bill.order_discount_idr),
    cashback: editMoney(data.bill.cashback_idr),
    tax: editMoney(data.bill.tax_idr),
    service: editMoney(data.bill.service_idr),
    tax_included: Boolean(data.bill.tax_included),
    // PUT deliberately omits participants: the server treats an absent
    // participant field as "keep the current roster" (including claims).
    participants: (data.participants || []).map(item => item.name.trim()).filter(Boolean),
  };
}

function calculateEditTotals(draft: EditDraft): EditTotals {
  const invalidQuantity = draft.items.find(item => editItemQuantity(item) == null);
  const emptyItem = draft.items.find(item => !item.name.trim());
  const invalidDiscount = draft.items.find(item => item.discount > item.price);
  const subtotalInvalid = Boolean(invalidQuantity || emptyItem || invalidDiscount || !draft.items.length);
  const subtotal = subtotalInvalid ? null : draft.items.reduce((sum, item) => {
    const qty = editItemQuantity(item) || 0;
    return sum + (item.price - item.discount) * qty;
  }, 0);
  const orderDiscount = Math.max(0, draft.order_discount);
  const cashback = Math.max(0, draft.cashback);
  const tax = draft.tax_included ? 0 : Math.max(0, draft.tax);
  const service = Math.max(0, draft.service);
  const orderDiscountTooHigh = subtotal != null && orderDiscount > subtotal;
  const preCashbackTotal = subtotal == null ? null : subtotal + tax + service - orderDiscount;
  const cashbackTooHigh = preCashbackTotal != null && cashback > preCashbackTotal;
  const total = subtotal == null || preCashbackTotal == null || orderDiscountTooHigh || cashbackTooHigh
    ? null
    : preCashbackTotal - cashback;
  return {
    subtotal,
    orderDiscount,
    cashback,
    tax,
    service,
    total,
    invalidQuantityKey: invalidQuantity?.key || null,
    emptyItemKey: emptyItem?.key || null,
    invalidDiscountKey: invalidDiscount?.key || null,
    orderDiscountTooHigh,
    cashbackTooHigh,
    invalid: subtotalInvalid || orderDiscountTooHigh || cashbackTooHigh,
  };
}

function editWarning(draft: EditDraft, totals: EditTotals): string {
  if (totals.invalidQuantityKey) {
    const item = draft.items.find(candidate => candidate.key === totals.invalidQuantityKey);
    return `Jumlah item${item?.name ? ` “${item.name}”` : ""} harus bilangan bulat 1-99 sebelum disimpan.`;
  }
  if (totals.emptyItemKey) return "Isi nama semua item sebelum menyimpan.";
  if (!draft.items.length) return "Minimal 1 item harus dipertahankan.";
  if (totals.invalidDiscountKey) {
    const item = draft.items.find(candidate => candidate.key === totals.invalidDiscountKey);
    return `Diskon${item?.name ? ` “${item.name}”` : " item"} tidak boleh lebih besar dari harga.`;
  }
  if (totals.orderDiscountTooHigh) return `Diskon pesanan tidak boleh lebih besar dari subtotal (${rupiahFmt(totals.subtotal)}).`;
  if (totals.cashbackTooHigh) return `Cashback tidak boleh lebih besar dari total sebelum cashback.`;
  return "";
}

function editPayload(draft: EditDraft, totals: EditTotals): UpdateBillRequest {
  return {
    title: draft.title.trim() || draft.merchant.trim() || "Bill",
    merchant: draft.merchant.trim() || null,
    transacted_at: draft.transacted_at || null,
    subtotal: totals.subtotal as number,
    tax: totals.tax,
    service: totals.service,
    order_discount: totals.orderDiscount,
    cashback: totals.cashback,
    total: totals.total as number,
    tax_included: draft.tax_included,
    items: draft.items.map(item => ({
      ...(item.id == null ? {} : { id: item.id }),
      name: item.name.trim(),
      price: item.price,
      discount: item.discount,
      quantity: editItemQuantity(item) as number,
      mode: item.mode,
      slot_count: item.mode === "slot" ? item.slot_count || 1 : null,
    })),
  };
}

function EditItemRow({ item, canDelete, onChange, onDelete }: { item: EditItemDraft; canDelete: boolean; onChange: (patch: Partial<EditItemDraft>) => void; onDelete: () => void }) {
  const currentQuantity = editItemQuantity(item);
  const quantityInvalid = currentQuantity == null;
  const lineTotal = currentQuantity == null ? null : Math.max(0, item.price - item.discount) * currentQuantity;
  const quantityText = item.quantityDraft === null ? String(item.quantity) : item.quantityDraft;
  const itemNameId = `edit-name-${item.key}`;
  const itemPriceId = `edit-price-${item.key}`;
  const itemQuantityId = `edit-quantity-${item.key}`;
  const itemDiscountId = `edit-discount-${item.key}`;
  return <div className="vf-item" data-edit-item={item.id ?? item.key}>
    <div className="vf-item-header"><div className="field"><Label htmlFor={itemNameId}>Nama item</Label><div className="row"><Input id={itemNameId} data-role="name" value={item.name} onChange={event => onChange({ name: event.currentTarget.value })} placeholder="Nama item" /><Button type="button" data-role="del" variant="ghost" size="icon" aria-label={`Hapus ${item.name || "item ini"}`} disabled={!canDelete} onClick={onDelete}>Hapus</Button></div></div></div>
    <div className="vf-input-group stack-sm"><div className="field"><Label htmlFor={itemPriceId}>Harga satuan</Label><Input id={itemPriceId} data-role="price" inputMode="numeric" value={editMoneyInput(item.price)} onChange={event => onChange({ price: editMoney(event.currentTarget.value) })} placeholder="0" /></div><div className="field"><Label htmlFor={itemQuantityId}>Jumlah dibeli</Label><div className="qty-control"><Button type="button" className="edit-qty-dec" variant="outline" size="icon" aria-label="Kurangi jumlah dibeli" disabled={currentQuantity === 1} onClick={() => onChange({ quantity: Math.max(1, (currentQuantity || 1) - 1), quantityDraft: null })}>−</Button><Input id={itemQuantityId} data-role="quantity" type="number" inputMode="numeric" min={1} max={99} step={1} value={quantityText} aria-invalid={quantityInvalid} aria-describedby={`${itemQuantityId}-error`} onChange={event => { const raw = event.currentTarget.value; const parsed = editQuantity(raw); onChange(parsed == null ? { quantityDraft: raw } : { quantity: parsed, quantityDraft: null }); }} /><Button type="button" className="edit-qty-inc" variant="outline" size="icon" aria-label="Tambah jumlah dibeli" disabled={currentQuantity === 99} onClick={() => onChange({ quantity: Math.min(99, (currentQuantity || 0) + 1), quantityDraft: null })}>+</Button></div><p id={`${itemQuantityId}-error`} data-role="quantity-error" className={`error-text${quantityInvalid ? "" : " hidden"}`} aria-live="polite" hidden={!quantityInvalid}>Jumlah harus bilangan bulat 1-99.</p></div></div>
    <div className="vf-line-total"><span>Total baris</span><strong data-role="line-total">{lineTotal == null ? "-" : rupiahFmt(lineTotal)}</strong></div>
    <div className="vf-discount"><div className="field"><Label htmlFor={itemDiscountId}>Potongan</Label><Input id={itemDiscountId} data-role="discount" inputMode="numeric" value={editMoneyInput(item.discount)} onChange={event => onChange({ discount: editMoney(event.currentTarget.value) })} placeholder="0" />{item.discount > item.price && <p className="error-text" role="alert">Diskon tidak boleh lebih besar dari harga.</p>}</div><div className="vf-mode"><span className="field-label">Cara bagi</span><div className="row wrap"><Button type="button" size="sm" variant={item.mode === "free" ? "primary" : "outline"} aria-pressed={item.mode === "free"} onClick={() => onChange({ mode: "free", slot_count: null })}>Bagi rata</Button><Button type="button" size="sm" variant={item.mode === "slot" ? "primary" : "outline"} aria-pressed={item.mode === "slot"} onClick={() => onChange({ mode: "slot", slot_count: item.slot_count || 2 })}>Bagi per porsi</Button>{item.mode === "slot" && <span className="field-hint">{item.slot_count || 2} bagian tetap</span>}</div></div></div>
  </div>;
}

function EditBillView({ data, identity, onCancel, onSaved }: { data: BillResponse; identity: Identity; onCancel: () => void; onSaved: (data: BillResponse) => void }) {
  const [draft, setDraft] = useState(() => editDraftFromResponse(data));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const draftRef = useRef(draft);
  const nextItemKey = useRef(0);
  const updateDraft = useCallback((updater: (current: EditDraft) => EditDraft) => {
    setDraft(current => {
      const next = updater(current);
      draftRef.current = next;
      return next;
    });
  }, []);
  useEffect(() => { draftRef.current = draft; }, [draft]);
  const updateItem = useCallback((key: string, patch: Partial<EditItemDraft>) => {
    updateDraft(current => ({ ...current, items: current.items.map(item => item.key === key ? { ...item, ...patch } : item) }));
  }, [updateDraft]);
  const totals = useMemo(() => calculateEditTotals(draft), [draft]);
  const warning = editWarning(draft, totals);
  const canSave = !busy && !totals.invalid && totals.subtotal != null && totals.total != null;
  const saveEditBill = useCallback(async (requestedBillId: string) => {
    if (requestedBillId !== data.bill.id) {
      throw new Error("Bill tidak cocok");
    }
    const currentDraft = draftRef.current;
    const currentTotals = calculateEditTotals(currentDraft);
    if (currentTotals.invalid || currentTotals.subtotal == null || currentTotals.total == null) {
      const message = editWarning(currentDraft, currentTotals) || "Perbaiki nilai item dulu.";
      setError(message);
      return undefined;
    }
    setBusy(true);
    setError("");
    try {
      const payload = editPayload(currentDraft, currentTotals);
      const path = `/api/bills/${encodeURIComponent(data.bill.id)}`;
      const request = billWindow().apiJson;
      if (request) await request(path, "PUT", payload);
      else await apiJsonAs(identity, path, "PUT", payload);
      // The low-level bridge returns an untyped response. Read the normalized
      // bill back so the summary never renders a client-side approximation.
      const fresh = await apiClient.bills.get(data.bill.id);
      setBusy(false);
      onSaved(fresh);
      return fresh;
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : "Bill belum dapat disimpan");
      throw err;
    }
  }, [data.bill.id, identity, onSaved]);
  useEffect(() => {
    const win = billWindow();
    const saveBridge = (billId: string) => saveEditBill(billId);
    const previousConfirmSheet = win.confirmSheet;
    const confirmBridge: LegacyConfirmSheet = options => previousConfirmSheet
      ? previousConfirmSheet(options)
      : Promise.resolve(false);
    win.saveEditBill = saveBridge;
    win.confirmSheet = confirmBridge;
    return () => {
      if (win.saveEditBill === saveBridge) delete win.saveEditBill;
      if (win.confirmSheet !== confirmBridge) return;
      if (previousConfirmSheet) win.confirmSheet = previousConfirmSheet;
      else delete win.confirmSheet;
    };
  }, [saveEditBill]);
  const submit = (event: React.FormEvent) => { event.preventDefault(); void saveEditBill(data.bill.id); };
  const addItem = () => updateDraft(current => ({ ...current, items: [...current.items, { key: `new-${nextItemKey.current++}`, name: "", price: 0, discount: 0, quantity: 1, quantityDraft: null, mode: "free", slot_count: null }] }));
  return <AppFrame contextualDock><Topbar title="Edit Bill" backId="back-btn" back={onCancel} /><main className="shell shell-with-rail edit-bill-shell"><form id="edit-bill-form" className="shell-main stack verify-editor-main edit-bill-main" onSubmit={submit} noValidate><Card className="verify-detail-card"><div className="form-grid"><div className="field full"><Label htmlFor="title-input">Judul bill</Label><Input id="title-input" value={draft.title} onChange={event => updateDraft(current => ({ ...current, title: event.currentTarget.value }))} placeholder="Contoh: Makan sushi" /></div><div className="field"><Label htmlFor="merchant-input">Tempat, opsional</Label><Input id="merchant-input" value={draft.merchant} onChange={event => updateDraft(current => ({ ...current, merchant: event.currentTarget.value }))} placeholder="Nama tempat" /></div><div className="field"><Label htmlFor="date-input">Tanggal transaksi</Label><Input id="date-input" type="date" value={draft.transacted_at} onChange={event => updateDraft(current => ({ ...current, transacted_at: event.currentTarget.value }))} /></div></div></Card><Card id="items-card"><div className="card-title"><span>Item bill</span><Button id="add-item-btn" type="button" size="sm" variant="outline" onClick={addItem}>Tambah item</Button></div><div className="vf-head" aria-hidden="true"><span>Nama item</span><span>Harga satuan</span><span>Jumlah dibeli</span><span>Potongan</span><span>Total</span></div><div id="items-list" className="stack-sm">{draft.items.map(item => <EditItemRow key={item.key} item={item} canDelete={draft.items.length > 1} onChange={patch => updateItem(item.key, patch)} onDelete={() => updateDraft(current => ({ ...current, items: current.items.filter(candidate => candidate.key !== item.key) }))} />)}</div><div className="info-box">Total baris dihitung dari harga, potongan, dan jumlah item.</div></Card><Card><div className="card-title"><span>Biaya tambahan</span><span className="muted">Opsional</span></div><div className="form-grid"><div className="field"><Label htmlFor="subtotal-input">Subtotal</Label><Input id="subtotal-input" inputMode="numeric" value={totals.subtotal == null ? "" : inputMoney(totals.subtotal)} readOnly aria-readonly="true" /><p className="field-hint">Dihitung otomatis dari item di atas.</p></div><div className="field"><Label htmlFor="tax-input">Pajak</Label><Input id="tax-input" inputMode="numeric" value={draft.tax_included ? "" : editMoneyInput(draft.tax)} disabled={draft.tax_included} onChange={event => updateDraft(current => ({ ...current, tax: editMoney(event.currentTarget.value) }))} placeholder="0" /></div><div className="field"><Label htmlFor="service-input">Service</Label><Input id="service-input" inputMode="numeric" value={editMoneyInput(draft.service)} onChange={event => updateDraft(current => ({ ...current, service: editMoney(event.currentTarget.value) }))} placeholder="0" /></div><div className="field"><Label htmlFor="order-discount-input">Diskon pesanan</Label><Input id="order-discount-input" inputMode="numeric" value={editMoneyInput(draft.order_discount)} onChange={event => updateDraft(current => ({ ...current, order_discount: editMoney(event.currentTarget.value) }))} placeholder="0" /></div><div className="field"><Label htmlFor="cashback-input">Cashback</Label><Input id="cashback-input" inputMode="numeric" value={editMoneyInput(draft.cashback)} onChange={event => updateDraft(current => ({ ...current, cashback: editMoney(event.currentTarget.value) }))} placeholder="0" /></div></div><label className="check-label"><input id="tax-included-toggle" type="checkbox" checked={draft.tax_included} onChange={event => updateDraft(current => ({ ...current, tax_included: event.currentTarget.checked }))} /> Pajak sudah termasuk dalam harga item</label></Card>{draft.participants.length > 0 && <Card><div className="card-title">Yang ikut</div><div className="row wrap">{draft.participants.map((name, index) => <Badge key={`${name}-${index}`} tone="neutral">{name}</Badge>)}</div><p className="field-hint" style={{ marginTop: 10 }}>Peserta dan klaim yang sudah ada tetap dipertahankan saat disimpan.</p></Card>}{warning && <p id="sum-warn" className="error-text" role="alert">{warning}</p>}{error && <p className="error-text" role="alert">{error}</p>}</form><aside className="shell-side"><div className="dock"><div className="dock-panel"><div className="dock-total"><span className="muted">Total bill</span><strong id="total-display" className="money">{totals.total == null ? "-" : rupiahFmt(totals.total)}</strong></div><p className="field-hint" style={{ margin: "8px 0 12px" }}>Subtotal dan total dihitung dari item di atas.</p><Button id="save-bill-btn" form="edit-bill-form" type="submit" className="btn-block" disabled={!canSave}>{busy ? <><Spinner /> Menyimpan...</> : "Simpan Perubahan"}</Button><Button type="button" variant="outline" className="btn-block" style={{ marginTop: 8 }} onClick={onCancel}>Batal</Button></div></div></aside></main></AppFrame>;
}

type CreatorPhoto = {
  id?: number;
  path: string;
};

type CreatorRosterEntry = {
  id: string;
  name: string;
};

type CreatorManagerDialog = "payer" | "invite" | "remove" | "slot" | "reopen" | "delete" | "photo-delete" | null;

function creatorRoster(data: BillResponse): CreatorRosterEntry[] {
  const seen = new Set<string>();
  const roster: CreatorRosterEntry[] = [];
  const add = (id: string | null | undefined, name: string | null | undefined) => {
    const cleanId = id?.trim();
    const cleanName = name?.trim();
    if (!cleanId || !cleanName || seen.has(cleanId)) return;
    seen.add(cleanId);
    roster.push({ id: cleanId, name: cleanName });
  };
  if (!data.bill.creator_left) add(data.bill.creator_identity_id, data.creator_name);
  data.people.forEach(item => add(item.identity_id, item.name));
  (data.participants || []).forEach(item => add(item.identity_id, item.name));
  return roster;
}

function creatorPhotos(data: BillResponse): CreatorPhoto[] {
  const photos = (data.photos || [])
    .filter(photo => photo && typeof photo.path === "string" && photo.path.trim())
    .map(photo => ({ id: photo.id, path: photo.path }));
  if (photos.length) return photos;
  const legacyPath = (data.bill as BillResponse["bill"] & { photo_path?: string | null }).photo_path
    || (data as BillResponse & { photo_path?: string | null }).photo_path;
  return legacyPath?.trim() ? [{ path: legacyPath }] : [];
}

function CreatorManagerControls({ data, identity, onData }: { data: BillResponse; identity: Identity; onData: (data: BillResponse) => void }) {
  const [dialog, setDialog] = useState<CreatorManagerDialog>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [payerDraft, setPayerDraft] = useState("");
  const [removeTarget, setRemoveTarget] = useState<CreatorRosterEntry | null>(null);
  const [slotItemId, setSlotItemId] = useState<number | null>(null);
  const [slotCount, setSlotCount] = useState(1);
  const [releaseTarget, setReleaseTarget] = useState<{ itemId: number; identityId: string; name: string } | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactSearch, setContactSearch] = useState("");
  const [contactLoading, setContactLoading] = useState(false);
  const [contactError, setContactError] = useState("");
  const [inviteStatus, setInviteStatus] = useState<Record<string, "joined" | "pending"> >({});
  const [photoDeleteTarget, setPhotoDeleteTarget] = useState<CreatorPhoto | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const contactSequence = useRef(0);

  const openBill = data.can_manage && data.bill.status === "open" && !isSettled(data);
  const closedBill = data.can_manage && data.bill.status === "closed";
  const roster = useMemo(() => creatorRoster(data), [data]);
  const photos = useMemo(() => creatorPhotos(data), [data]);
  const slotItem = slotItemId == null ? undefined : data.items.find(item => item.id === slotItemId);
  const slotSelections = slotItem ? selectorsFor(data, slotItem.id) : [];
  const slotsTaken = slotSelections.reduce((sum, selection) => sum + quantity(selection.qty), 0);
  const pendingPayer = Boolean(
    openBill
      && data.paid_by_id
      && data.paid_by_id !== data.bill.creator_identity_id
      && !Boolean(data.paid_by_confirmed ?? data.bill.paid_by_confirmed),
  );
  const payerName = data.paid_by_name || data.creator_name;
  const onBill = useMemo(() => new Set(roster.map(item => item.id)), [roster]);
  const pendingInviteIds = useMemo(() => new Set((data.pending_invites || []).map(item => item.identity_id).filter((id): id is string => Boolean(id))), [data.pending_invites]);

  useEffect(() => {
    if (dialog !== "invite") return undefined;
    const sequence = ++contactSequence.current;
    const timer = window.setTimeout(() => {
      setContactLoading(true);
      setContactError("");
      void apiClient.identities.contacts(identity.id, contactSearch.trim())
        .then(result => {
          if (sequence === contactSequence.current) setContacts(result);
        })
        .catch(err => {
          if (sequence === contactSequence.current) setContactError(err instanceof Error ? err.message : "Kontak belum dapat dimuat");
        })
        .finally(() => {
          if (sequence === contactSequence.current) setContactLoading(false);
        });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [contactSearch, dialog, identity.id]);

  const closeDialog = () => {
    if (busy) return;
    setDialog(null);
    setError("");
  };

  const openPayerDialog = () => {
    setError("");
    setPayerDraft(data.paid_by_id ? "" : data.paid_by_name || "");
    setDialog("payer");
  };

  const savePayer = async (payload: PayerRequest, name: string) => {
    if (!openBill || busy) return;
    setBusy("payer");
    setError("");
    try {
      const fresh = await apiClient.bills.setPayer(data.bill.id, payload);
      onData(fresh);
      setDialog(null);
      setNotice(`${name} ditandai sebagai yang nalangin ✓`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pembayar belum dapat diubah");
    } finally {
      setBusy("");
    }
  };

  const confirmPayer = async () => {
    if (!data.paid_by_id) return;
    await savePayer({ identity_id: data.paid_by_id }, payerName);
  };

  const invite = async (contact: Contact) => {
    const currentStatus = inviteStatus[contact.id] || (pendingInviteIds.has(contact.id) ? "pending" : undefined);
    if (!openBill || busy || onBill.has(contact.id) || currentStatus) return;
    setBusy(`invite-${contact.id}`);
    setContactError("");
    try {
      const result = await apiClient.bills.invite(data.bill.id, { identity_id: contact.id });
      setInviteStatus(current => ({ ...current, [contact.id]: result.status }));
      try {
        onData(await apiClient.bills.get(data.bill.id));
      } catch {
        // The invite response is authoritative even if the follow-up refresh is unavailable.
      }
      setNotice(result.status === "joined" ? `${contact.name} langsung masuk bill ✓` : `Undangan ke ${contact.name} dikirim`);
    } catch (err) {
      setContactError(err instanceof Error ? err.message : "Undangan belum dapat dikirim");
    } finally {
      setBusy("");
    }
  };

  const removePerson = async () => {
    if (!openBill || !removeTarget || busy) return;
    setBusy("remove");
    setError("");
    try {
      const fresh = await apiClient.bills.removePerson(data.bill.id, removeTarget.id);
      onData(fresh);
      setDialog(null);
      setRemoveTarget(null);
      setNotice(`${removeTarget.name} dihapus dari bill`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Peserta belum dapat dihapus");
    } finally {
      setBusy("");
    }
  };

  const openSlotDialog = (item: BillItem) => {
    setSlotItemId(item.id);
    setSlotCount(Math.max(1, item.slot_count || 1));
    setError("");
    setDialog("slot");
  };

  const saveSlots = async () => {
    if (!openBill || !slotItem || busy) return;
    const count = Math.max(slotsTaken, Math.min(99, Math.trunc(slotCount)));
    if (count < 1 || count < slotsTaken || count > 99) {
      setError(`Jumlah bagian minimal ${slotsTaken} dan maksimal 99.`);
      return;
    }
    setBusy("slots");
    setError("");
    try {
      const fresh = await apiClient.bills.setSlots(data.bill.id, slotItem.id, { slot_count: count });
      onData(fresh);
      setDialog(null);
      setNotice("Jumlah bagian diupdate ✓");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Jumlah bagian belum dapat diubah");
    } finally {
      setBusy("");
    }
  };

  const releaseSlot = async () => {
    if (!openBill || !releaseTarget || busy) return;
    setBusy("release");
    setError("");
    try {
      const fresh = await apiClient.bills.releaseSelection(data.bill.id, releaseTarget.itemId, releaseTarget.identityId);
      onData(fresh);
      setReleaseTarget(null);
      setNotice(`Bagian ${releaseTarget.name} dilepas ✓`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bagian belum dapat dilepas");
    } finally {
      setBusy("");
    }
  };

  const uploadPhoto = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file || !openBill || busy) return;
    if (file.size > 5 * 1024 * 1024) {
      setError("Foto maksimal 5MB");
      return;
    }
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("Format foto tidak didukung, pilih JPEG/PNG/WEBP");
      return;
    }
    setBusy("photo-upload");
    setError("");
    try {
      onData(await apiClient.bills.addPhoto(data.bill.id, file));
      setNotice("Struk ditambahkan ✓");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Foto belum dapat ditambahkan");
    } finally {
      setBusy("");
    }
  };

  const deletePhoto = async () => {
    if (!openBill || !photoDeleteTarget?.id || busy) return;
    setBusy("photo-delete");
    setError("");
    try {
      onData(await apiClient.bills.deletePhoto(data.bill.id, photoDeleteTarget.id));
      setPhotoDeleteTarget(null);
      setDialog(null);
      setNotice("Foto dihapus ✓");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Foto belum dapat dihapus");
    } finally {
      setBusy("");
    }
  };

  const reopen = async () => {
    if (!closedBill || busy) return;
    setBusy("reopen");
    setError("");
    try {
      onData(await apiClient.bills.reopen(data.bill.id));
      setDialog(null);
      setNotice("Bill dibuka lagi ✓");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bill belum dapat dibuka lagi");
    } finally {
      setBusy("");
    }
  };

  const deleteBill = async () => {
    if (!data.can_manage || busy) return;
    setBusy("delete");
    setError("");
    try {
      await apiClient.bills.remove(data.bill.id);
      setDialog(null);
      navigate({ kind: "home" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bill belum dapat dihapus");
    } finally {
      setBusy("");
    }
  };

  const inviteableContacts = contacts.filter(contact => contact.id !== identity.id && !onBill.has(contact.id));
  const removeablePeople = roster.filter(personItem => personItem.id !== identity.id);
  const selectedPhoto = photoDeleteTarget;

  if (!data.can_manage) return null;
  return <>
    <Card id="creator-controls" className="stack-sm">
      <div className="card-title"><span>Kelola bill</span><span className="caption">Aksi manager</span></div>
      {notice && <Alert tone="success" role="status">{notice}</Alert>}
      {error && !dialog && <Alert tone="danger">{error}</Alert>}
      {closedBill && <Alert tone="info">Bill sudah ditutup. Buka lagi untuk mengubah pembagian.</Alert>}
      {!closedBill && !openBill && <Alert tone="success">Bill ini sudah lunas. Pembagian tidak dapat diubah lagi.</Alert>}
      <div className="btn-row row wrap">
        {closedBill && <Button id="reopen-bill-btn" type="button" variant="outline" disabled={Boolean(busy)} onClick={() => { setError(""); setDialog("reopen"); }}>Buka Bill Lagi</Button>}
        {openBill && <>
          <Button id="set-payer-btn" type="button" variant="outline" disabled={Boolean(busy)} onClick={openPayerDialog}>Ubah pembayar</Button>
          <Button id="invite-person-btn" type="button" variant="outline" disabled={Boolean(busy)} onClick={() => { setError(""); setContactError(""); setContactSearch(""); setDialog("invite"); }}>Undang Orang</Button>
        </>}
      </div>
      {pendingPayer && <Alert tone="info"><div className="stack-sm"><span><strong>{payerName}</strong> sudah bergabung dan ditandai sebagai yang nalangin. Konfirmasi supaya statusnya tidak lagi sementara.</span><Button id="confirm-payer-btn" type="button" size="sm" disabled={Boolean(busy)} onClick={() => void confirmPayer()}>{busy === "payer" ? <><Spinner /> Menyimpan...</> : <><Check /> Konfirmasi pembayar</>}</Button></div></Alert>}
      {openBill && <>
        <div className="stack-sm">
          <strong>Peserta</strong>
          {removeablePeople.length ? removeablePeople.map(personItem => <div className="account-row" key={personItem.id}>
            <div className="avatar" aria-hidden="true">{personItem.name.slice(0, 1).toUpperCase()}</div>
            <div className="grow"><strong>{personItem.name}</strong><div className="caption">Bisa dihapus dari bill</div></div>
            <Button type="button" variant="ghost" size="sm" className="remove-person" data-remove-person={personItem.id} aria-label={`Hapus ${personItem.name} dari bill`} disabled={Boolean(busy)} onClick={() => { setRemoveTarget(personItem); setError(""); setDialog("remove"); }}>Hapus</Button>
          </div>) : <p className="muted">Belum ada peserta lain.</p>}
        </div>
        <div className="stack-sm">
          <strong>Bagian per porsi</strong>
          {data.items.filter(item => item.mode === "slot" && Number.isSafeInteger(item.slot_count) && (item.slot_count || 0) > 0).length ? data.items.filter(item => item.mode === "slot" && Number.isSafeInteger(item.slot_count) && (item.slot_count || 0) > 0).map(item => <div className="account-row" key={item.id}>
            <div className="grow"><strong>{item.name}</strong><div className="caption">{selectorsFor(data, item.id).reduce((sum, selection) => sum + quantity(selection.qty), 0)}/{item.slot_count} bagian terambil</div></div>
            <Button type="button" variant="outline" size="sm" className="slot-mgr" data-item={item.id} aria-label={`Atur bagian ${item.name}`} disabled={Boolean(busy)} onClick={() => openSlotDialog(item)}>Atur bagian</Button>
          </div>) : <p className="muted">Belum ada item bagi per porsi.</p>}
        </div>
      </>}
      {(photos.length > 0 || openBill) && <div className="stack-sm">
        <div className="row-between"><strong>Foto struk</strong>{openBill && <><input ref={photoInputRef} id="creator-photo-input" className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" aria-label="Pilih foto struk" onChange={event => void uploadPhoto(event)} /><Button id="add-photo-btn" type="button" variant="outline" size="sm" disabled={Boolean(busy)} onClick={() => photoInputRef.current?.click()}>{busy === "photo-upload" ? <><Spinner /> Upload...</> : photos.length ? "Tambah foto" : "Tambah foto struk"}</Button></>}</div>
        {photos.length > 0 && <ReceiptPhotoGallery paths={photos.map(photo => photo.path)} onRemove={openBill ? index => { const photo = photos[index]; if (!photo) return; setPhotoDeleteTarget(photo); setError(""); setDialog("photo-delete"); } : undefined} removeDisabled={Boolean(busy)} />}
      </div>}
      <Button id="delete-bill-btn" type="button" variant="danger" className="btn-block" disabled={Boolean(busy)} onClick={() => { setError(""); setDialog("delete"); }}>Hapus Bill Permanen</Button>
    </Card>

    <Dialog open={dialog === "reopen"} title="Buka bill lagi?" description="Bill balik ke status aktif. Semua orang bisa memilih item, mengubah pembagian, dan memperbarui status bayar lagi." onClose={closeDialog}>
      {error && <p className="error-text" role="alert">{error}</p>}
      <div className="row wrap sheet-actions"><Button type="button" variant="outline" disabled={Boolean(busy)} onClick={closeDialog}>Batal</Button><Button id="confirm-reopen" type="button" disabled={Boolean(busy)} onClick={() => void reopen()}>{busy === "reopen" ? <><Spinner /> Bentar...</> : "Buka Lagi"}</Button></div>
    </Dialog>

    <Dialog open={dialog === "payer"} title="Siapa yang nalangin?" description="Orang yang dipilih dianggap sudah mengeluarkan uang lebih dahulu. Nama saja tetap menunggu konfirmasi identitas." onClose={closeDialog}>
      {error && <p className="error-text" role="alert">{error}</p>}
      <div role="radiogroup" aria-label="Pilih orang yang nalangin" className="stack-sm">{roster.map(personItem => <Button key={personItem.id} type="button" variant="outline" role="radio" aria-checked={data.paid_by_id === personItem.id} disabled={Boolean(busy)} data-payer-id={personItem.id} onClick={() => void savePayer({ identity_id: personItem.id }, personItem.name)}>{data.paid_by_id === personItem.id && <Check />}<strong>{personItem.name}</strong>{personItem.id === data.bill.creator_identity_id && <span className="muted">(pembuat)</span>}</Button>)}</div>
      <div className="separator" role="separator" />
      <div className="field"><Label htmlFor="payer-name-input">Atau ketik nama</Label><Input id="payer-name-input" value={payerDraft} onChange={event => setPayerDraft(event.currentTarget.value)} placeholder="Nama yang nalangin" maxLength={60} autoComplete="off" /></div>
      <div className="row wrap sheet-actions"><Button id="payer-name-save" type="button" disabled={Boolean(busy) || !payerDraft.trim()} onClick={() => void savePayer({ name: payerDraft.trim() }, payerDraft.trim())}>{busy === "payer" ? <><Spinner /> Menyimpan...</> : "Pakai Nama Ini"}</Button><Button type="button" variant="outline" disabled={Boolean(busy)} onClick={closeDialog}>Batal</Button></div>
    </Dialog>

    <Dialog open={dialog === "invite"} title="Undang Orang" description="Pilih kontak yang sudah pernah berbagi bill dengan kamu. Auto-accept langsung masuk; yang lain menerima undangan di beranda." onClose={closeDialog}>
      {contactError && <p className="error-text" role="alert">{contactError}</p>}
      <div className="field"><Label htmlFor="invite-search">Cari kontak</Label><Input id="invite-search" value={contactSearch} onChange={event => setContactSearch(event.currentTarget.value)} placeholder="Cari nama..." maxLength={60} autoComplete="off" /></div>
      <div className="stack-sm" aria-live="polite">{contactLoading ? <><Spinner /> Memuat kontak...</> : inviteableContacts.length ? inviteableContacts.map(contact => { const status = inviteStatus[contact.id] || (pendingInviteIds.has(contact.id) ? "pending" : undefined); const sending = busy === `invite-${contact.id}`; return <div className="account-row" key={contact.id}><div className="avatar" aria-hidden="true">{contact.name.slice(0, 1).toUpperCase()}</div><div className="grow"><strong>{contact.name}</strong><div className="caption">{status === "joined" ? "Sudah masuk bill" : status === "pending" ? "Menunggu jawaban" : "Kontak terbukti"}</div></div><Button type="button" size="sm" variant={status ? "outline" : "primary"} data-invite-id={contact.id} disabled={Boolean(busy) || Boolean(status)} onClick={() => void invite(contact)}>{sending ? <><Spinner /> Mengundang...</> : status === "joined" ? "Sudah masuk" : status === "pending" ? "Menunggu" : "Undang"}</Button></div>; }) : <p className="muted">{contactSearch.trim() ? "Kontak tidak ditemukan." : "Belum ada kontak yang bisa diundang. Bagikan link dulu."}</p>}</div>
      <div className="row wrap sheet-actions"><Button type="button" variant="outline" disabled={Boolean(busy)} onClick={closeDialog}>Selesai</Button></div>
    </Dialog>

    <Dialog open={dialog === "remove" && Boolean(removeTarget)} title={`Hapus ${removeTarget?.name || "peserta"}?`} description="Item yang dia pilih, status bayar, dan catatannya di bill ini ikut terhapus." onClose={closeDialog}>
      {error && <p className="error-text" role="alert">{error}</p>}
      <div className="row wrap sheet-actions"><Button type="button" variant="outline" disabled={Boolean(busy)} onClick={closeDialog}>Batal</Button><Button id="confirm-remove-person" type="button" variant="danger" disabled={Boolean(busy)} onClick={() => void removePerson()}>{busy === "remove" ? <><Spinner /> Menghapus...</> : "Hapus"}</Button></div>
    </Dialog>

    <Dialog open={dialog === "slot" && Boolean(slotItem)} title={`Atur bagian: ${slotItem?.name || "item"}`} description={slotItem ? `${slotsTaken}/${slotItem.slot_count} bagian terambil. Minimal jumlah bagian mengikuti yang sudah dipilih.` : undefined} onClose={closeDialog}>
      {error && <p className="error-text" role="alert">{error}</p>}
      {slotItem && <><div className="row wrap slot-adjuster"><Button type="button" variant="outline" size="icon" aria-label="Kurangi bagian" disabled={Boolean(busy) || slotCount <= slotsTaken} onClick={() => setSlotCount(value => Math.max(slotsTaken, value - 1))}>−</Button><strong className="hero-total money" aria-live="polite">{slotCount}</strong><Button type="button" variant="outline" size="icon" aria-label="Tambah bagian" disabled={Boolean(busy) || slotCount >= 99} onClick={() => setSlotCount(value => Math.min(99, value + 1))}>+</Button></div><p className="muted">Harga per bagian dihitung ulang oleh server setelah disimpan.</p><Button id="mgr-save" type="button" disabled={Boolean(busy)} onClick={() => void saveSlots()}>{busy === "slots" ? <><Spinner /> Menyimpan...</> : "Simpan"}</Button>{slotSelections.length > 0 && <div className="stack-sm"><strong>Pemegang bagian</strong>{slotSelections.map(selection => selection.id ? <div className="account-row" key={selection.id}><div className="grow">{selection.name} <span className="muted">×{quantity(selection.qty)}</span></div><Button type="button" variant="outline" size="sm" className="mgr-free" aria-label={`Lepas bagian ${selection.name}`} disabled={Boolean(busy)} onClick={() => setReleaseTarget({ itemId: slotItem.id, identityId: selection.id as string, name: selection.name })}>Lepas</Button></div> : <div className="account-row" key={selection.name}><div className="grow">{selection.name} <span className="muted">×{quantity(selection.qty)}</span></div></div>)}</div>}</>}
      <Button type="button" variant="outline" disabled={Boolean(busy)} onClick={closeDialog}>Tutup</Button>
    </Dialog>

    <Dialog open={Boolean(releaseTarget)} title={`Lepas bagian ${releaseTarget?.name || "ini"}?`} description="Bagian ini kembali kosong dan bisa diambil orang lain." onClose={() => { if (!busy) setReleaseTarget(null); }}>
      {error && <p className="error-text" role="alert">{error}</p>}
      <div className="row wrap sheet-actions"><Button type="button" variant="outline" disabled={Boolean(busy)} onClick={() => setReleaseTarget(null)}>Batal</Button><Button id="confirm-release-slot" type="button" variant="danger" disabled={Boolean(busy)} onClick={() => void releaseSlot()}>{busy === "release" ? <><Spinner /> Melepas...</> : "Lepas"}</Button></div>
    </Dialog>

    <Dialog open={dialog === "photo-delete" && Boolean(selectedPhoto)} title="Hapus foto ini?" description="Foto akan dihapus dari bill. Item dan pembagiannya tidak berubah." onClose={closeDialog}>
      {error && <p className="error-text" role="alert">{error}</p>}
      <div className="row wrap sheet-actions"><Button type="button" variant="outline" disabled={Boolean(busy)} onClick={closeDialog}>Batal</Button><Button id="confirm-delete-photo" type="button" variant="danger" disabled={Boolean(busy)} onClick={() => void deletePhoto()}>{busy === "photo-delete" ? <><Spinner /> Menghapus...</> : "Hapus"}</Button></div>
    </Dialog>

    <Dialog open={dialog === "delete"} title="Hapus bill ini?" description={`${data.bill.title}. Semua item, pembagian, dan catatan bayar akan terhapus permanen. Tidak bisa dibatalkan.`} onClose={closeDialog}>
      {error && <p className="error-text" role="alert">{error}</p>}
      <div className="row wrap sheet-actions"><Button type="button" variant="outline" disabled={Boolean(busy)} onClick={closeDialog}>Batal</Button><Button id="confirm-delete-bill" type="button" variant="danger" disabled={Boolean(busy)} onClick={() => void deleteBill()}>{busy === "delete" ? <><Spinner /> Menghapus...</> : "Hapus Selamanya"}</Button></div>
    </Dialog>
  </>;
}

function CreatorView({ data: initialData, identity }: { data: BillResponse; identity: Identity }) {
  const [data, setData] = useState(initialData);
  const [shareOpen, setShareOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const state = statusLabel(data);
  const manualSettlement = isManualSettlement(data);
  const namedPending = pendingPickerNames(data);
  const unclaimed = data.items.filter(item => selectorsFor(data, item.id).length === 0);
  const markPaid = async (personId: string, paid: boolean) => { try { setData(await (paid ? apiClient.bills.markPaid(data.bill.id, personId) : apiClient.bills.markUnpaid(data.bill.id, personId))); } catch { /* the control remains usable for a retry */ } };
  const saveEditedData = useCallback((fresh: BillResponse) => { setData(fresh); setEditing(false); }, []);
  if (editing) return <EditBillView data={data} identity={identity} onCancel={() => setEditing(false)} onSaved={saveEditedData} />;
  if (pickerOpen) return <CreatorPicker data={data} identity={identity} onDone={fresh => { setData(fresh); setPickerOpen(false); }} />;
  if (!data.can_manage) return <GuestPicker data={data} identity={identity} />;
  return <AppFrame contextualDock><Topbar title={data.bill.title} back={() => navigate({ kind: "home" })} actions={<><Button id="share-btn" type="button" variant="ghost" size="icon" aria-label="Bagikan bill" onClick={() => setShareOpen(true)}><ShareNetwork /></Button>{data.can_manage && data.bill.status === "open" && !isSettled(data) && <Button id="edit-bill-btn" type="button" variant="outline" size="sm" aria-label="Edit bill" onClick={() => setEditing(true)}><PencilSimple /> Edit Bill</Button>}</>} /><div className="shell shell-with-rail"><div className="shell-main stack bill-detail-main"><CreatorManagerControls data={data} identity={identity} onData={setData} /><Card className="bill-header bill-summary-card"><div className="bill-total-line wrap"><div><p className="eyebrow">Total bill</p><strong className="hero-total money">{rupiahFmt(data.bill.total_idr)}</strong></div><Badge className="chip" tone={state.tone}>{state.label}</Badge></div><p className="muted">Dibuat oleh {data.creator_name}{data.paid_by_name ? `, nalangin ${data.paid_by_name}` : ""}</p></Card><Card className="bill-action-card"><div className="btn-row row wrap"><Button id="pay-methods-btn" type="button" variant="outline" onClick={() => setPaymentOpen(true)}><Wallet /> Metode pembayaran</Button>{data.can_manage && data.bill.status === "open" && !isSettled(data) && <Button id="pick-mine-btn" type="button" variant="primary" onClick={() => setPickerOpen(true)}><Check /> Pilih bagian kamu</Button>}</div></Card>{(namedPending.length > 0 || data.uncovered_idr > 0 || unclaimed.length > 0) && <Card className="card-danger"><div className="card-title"><span><WarningCircle /> Perlu dibereskan</span></div>{namedPending.length > 0 && <div className="stack-sm"><strong>Belum pilih item</strong><p className="muted">{namedPending.join(", ")}</p></div>}{data.uncovered_idr > 0 && <p className="error-text" style={{ marginTop: 10 }}>Bagian kosong belum terambil: {rupiahFmt(data.uncovered_idr)}</p>}{unclaimed.length > 0 && <ul className="warning-list">{unclaimed.map(item => <li key={item.id}>{item.name} otomatis dibebankan ke {data.paid_by_name || data.creator_name}</li>)}</ul>}</Card>}<Card className="bill-items-card"><div className="card-title">Item bill</div><div id="pick-items" className="bill-item-list">{data.items.map(item => <ItemRow key={item.id} item={item} data={data} identity={identity} qty={selectedBy(identity, selectorsFor(data, item.id))?.qty || 0} readOnly />)}</div></Card><Card><div className="card-title"><span>Status pembayaran</span><span className="caption">{data.people.length} orang</span></div><div className="account-list">{data.people.map(item => <div className="account-row" key={item.identity_id}><div className="avatar">{item.name.slice(0, 1).toUpperCase()}</div><div className="grow"><strong>{item.name}</strong><div className="caption money">{rupiahFmt(item.total_idr)}</div></div>{item.identity_id === data.paid_by_id ? <Badge tone="neutral">Nalangin</Badge> : manualSettlement || data.bill.status !== "open" || isSettled(data) ? <Badge tone={item.paid === "paid" ? "success" : "neutral"}>{item.paid === "paid" ? <><Check /> Lunas</> : "Belum bayar"}</Badge> : <Button type="button" size="sm" variant={item.paid === "paid" ? "success" : "outline"} className="toggle-paid" onClick={() => void markPaid(item.identity_id, item.paid !== "paid")}>{item.paid === "paid" ? <><Check /> Lunas</> : "Tandai lunas"}</Button>}</div>)}</div></Card><Button variant="outline" onClick={() => navigate({ kind: "create" })}><PencilSimple /> Buat bill baru</Button></div><aside className="shell-side"><div className="dock"><div className="dock-panel"><div className="dock-total"><span className="muted">Total bill</span><strong className="money">{rupiahFmt(data.bill.total_idr)}</strong></div><div className="dock-breakdown"><span>Status bill</span><Badge tone={state.tone}>{state.label}</Badge></div>{data.uncovered_idr > 0 && <p className="error-text">{rupiahFmt(data.uncovered_idr)} belum terbagi</p>}</div></div></aside></div><Dialog open={shareOpen} title="Bagikan bill" onClose={() => setShareOpen(false)}><ShareDialogContent billId={data.bill.id} title={data.bill.title} onClose={() => setShareOpen(false)} /></Dialog><Dialog open={paymentOpen} title={`Metode pembayaran untuk ${paymentName(data)}`} description="Gunakan rekening ini untuk membayar bagian bill kamu." onClose={() => setPaymentOpen(false)}><AccountRows accounts={payerAccounts(data)} name={paymentName(data)} /><div className="sheet-actions"><Button type="button" variant="outline" onClick={() => setPaymentOpen(false)}>Tutup</Button></div></Dialog></AppFrame>;
}

export function BillRoute({ billId, identity, onIdentity }: { billId: string; identity: Identity | null; onIdentity: (identity: Identity) => void }) {
  const [data, setData] = useState<BillResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => { let active = true; setLoading(true); setError(""); void apiClient.bills.get(billId).then(async value => { if (!active) return; if (!identity) { setData(value); return; } if (value.can_manage || value.people.some(item => item.identity_id === identity.id)) { setData(value); return; } try { const joined = await apiClient.bills.join(billId); if (active) setData(joined); } catch { if (active) setData(value); } }).catch(err => { if (active) setError(err instanceof Error ? err.message : "Gagal memuat bill"); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [billId, identity?.id]);
  if (loading) return <AppFrame contextualDock><Topbar back={() => navigate({ kind: "home" })} /><div className="shell stack"><Card><div className="stack-sm"><span className="skeleton" style={{ width: "35%", height: 12 }} /><span className="skeleton" style={{ width: "62%", height: 38 }} /></div></Card><Card><div className="stack-sm">{[1, 2, 3].map(item => <span className="skeleton" style={{ height: 54 }} key={item} />)}</div></Card></div></AppFrame>;
  if (error || !data) return <AppFrame contextualDock><Topbar back={() => navigate({ kind: "home" })} /><div className="shell"><ErrorState message={error || "Bill tidak ditemukan"} retry={() => window.location.reload()} /></div></AppFrame>;
  if (!identity) return <GuestEntry billId={billId} data={data} onIdentity={onIdentity} />;
  return data.can_manage ? <CreatorView data={data} identity={identity} /> : <GuestPicker data={data} identity={identity} />;
}
