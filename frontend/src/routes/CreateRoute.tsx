import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { ArrowLeft, Camera, Check, ClipboardText, PencilSimple, Plus, Receipt, Trash, UploadSimple, UsersThree } from "@phosphor-icons/react";
import { apiClient, apiJson } from "../lib/api";
import { useHashLeaveGuard } from "../lib/leave-guard";
import { navigate } from "../lib/routes";
import { rupiahFmt, rupiahParse } from "../lib/money";
import type { BillDraft, CreateBillRequest, DraftItem, Identity } from "../lib/types";
import { usePhotoCleanup, type PhotoCleanup } from "../lib/photos";
import { AppFrame, Topbar } from "../components/AppShell";
import { ConfirmDialog } from "../components/feedback";
import { Button, Card, Input, Label, Spinner } from "../components/ui/primitives";

type OcrItem = { name?: string; price?: number | string; price_idr?: number; discount?: number | string; discount_idr?: number; quantity?: number | string; mode?: "free" | "slot" | string; slot_count?: number };
type VerifyPayload = Partial<BillDraft> & { merchant?: string; title?: string; transacted_at?: string; items?: OcrItem[]; subtotal?: number; tax?: number; service?: number; photos?: string[]; photo_path?: string; paidByMyself?: boolean };
type GlobalWindow = Window & { renderVerify?: (payload: VerifyPayload, manual?: boolean) => void; createBillFinal?: () => Promise<unknown>; apiJson?: typeof apiJson; __bagiinVerify?: { payload: VerifyPayload; manual?: boolean } };

const globalWindow = () => window as GlobalWindow;
const uid = () => { try { return crypto.randomUUID(); } catch { return `item-${Date.now()}-${Math.random()}`; } };
const emptyItem = (): DraftItem => ({ id: uid(), name: "", price: 0, discount: 0, quantity: 1, mode: "free", slot_count: 2 });
const blankDraft = (): BillDraft => ({ title: "", merchant: "", transacted_at: "", items: [emptyItem()], order_discount: 0, cashback: 0, tax: 0, service: 0, tax_included: false, paid_by_myself: true, paid_by_name: "", extra_names: [], photos: [] });
const asMoney = (value: unknown): number => { const parsed = typeof value === "number" ? value : rupiahParse(value == null ? "" : String(value)); return parsed == null || !Number.isFinite(parsed) ? 0 : Math.max(0, parsed); };
const asQuantity = (value: unknown): number => { const parsed = Number(value); return Number.isInteger(parsed) && parsed >= 1 && parsed <= 99 ? parsed : Number.NaN; };
const payloadItem = (item: OcrItem): DraftItem => ({ id: uid(), serverId: typeof item === "object" && Number.isInteger((item as { id?: unknown }).id) ? Number((item as { id: number }).id) : undefined, name: String(item.name || ""), price: asMoney(item.price ?? item.price_idr), discount: asMoney(item.discount ?? item.discount_idr), quantity: asQuantity(item.quantity ?? 1), mode: item.mode === "slot" ? "slot" : "free", slot_count: Number.isInteger(item.slot_count) && Number(item.slot_count) > 0 ? Number(item.slot_count) : 2 });

function normalizePayload(payload: VerifyPayload): BillDraft {
  const items = Array.isArray(payload.items) && payload.items.length ? payload.items.map(payloadItem) : [emptyItem()];
  return {
    title: String(payload.title || payload.merchant || ""),
    merchant: String(payload.merchant || ""),
    transacted_at: String(payload.transacted_at || ""),
    items,
    order_discount: asMoney(payload.order_discount),
    cashback: asMoney(payload.cashback),
    tax: asMoney(payload.tax),
    service: asMoney(payload.service),
    tax_included: Boolean(payload.tax_included),
    paid_by_myself: payload.paidByMyself ?? payload.paid_by_myself ?? true,
    paid_by_name: String(payload.paid_by_name || ""),
    extra_names: Array.isArray(payload.extra_names) ? payload.extra_names.map(String).filter(Boolean) : [],
    photos: Array.isArray(payload.photos) ? payload.photos.map(String).filter(Boolean) : [],
    photo_path: payload.photo_path
  };
}

function createPayload(draft: BillDraft, identity: Identity): CreateBillRequest {
  const items = draft.items.map(item => ({ ...(item.serverId ? { id: item.serverId } : {}), name: item.name.trim(), price: item.price, discount: item.discount, quantity: item.quantity, mode: item.mode, slot_count: item.mode === "slot" ? item.slot_count : null }));
  const subtotal = items.reduce((sum, item) => sum + Math.max(0, item.price - item.discount) * item.quantity, 0);
  const total = Math.max(0, subtotal - draft.order_discount - draft.cashback + (draft.tax_included ? 0 : draft.tax) + draft.service);
  return { title: draft.title.trim() || draft.merchant.trim() || "Bill", merchant: draft.merchant.trim() || null, transacted_at: draft.transacted_at || null, items, participants: draft.extra_names.map(name => name.trim()).filter(Boolean), paid_by_name: draft.paid_by_myself ? identity.name : (draft.paid_by_name.trim() || null), subtotal, tax: draft.tax_included ? 0 : draft.tax, service: draft.service, order_discount: draft.order_discount, cashback: draft.cashback, total, tax_included: draft.tax_included, photos: draft.photos, photo_path: draft.photo_path || null };
}

export function CreateRoute({ identity, initialVerify = false }: { identity: Identity; initialVerify?: boolean }) {
  const [verify, setVerify] = useState(initialVerify);
  const [draft, setDraft] = useState<BillDraft>(() => blankDraft());
  const draftRef = useRef(draft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const photoCleanup = usePhotoCleanup();
  const [leavePrompt, setLeavePrompt] = useState<((allowed: boolean) => void) | null>(null);

  const replaceDraft = useCallback((next: BillDraft) => { draftRef.current = next; setDraft(next); }, []);
  const updateDraft = useCallback((updater: (current: BillDraft) => BillDraft) => { setDraft(current => { const next = updater(current); draftRef.current = next; return next; }); }, []);

  useEffect(() => { draftRef.current = draft; }, [draft]);
  const saveBill = useCallback(async () => {
    const current = draftRef.current;
    if (!validDraft(current)) { setError("Lengkapi nama item, harga, dan jumlahnya dulu ya"); throw new Error("Draft bill belum lengkap"); }
    // Keep the legacy global interception/API bridge working while the typed
    // client owns normal screen requests. (bug: the React route bypassed the
    // global apiJson hook, so browser harnesses and legacy integrations saw no
    // create payload even though the server received it.)
    const request = globalWindow().apiJson || apiJson;
    const result = await request<{ id: string }>("/api/bills", "POST", createPayload(current, identity));
    const billId = result.id;
    if (!billId) throw new Error("Bill belum mendapat link");
    return { billId, result };
  }, [identity]);

  const requestLeave = useCallback(() => new Promise<boolean>(resolve => {
    setLeavePrompt(() => resolve);
  }), []);
  const draftDirty = verify && isDraftDirty(draft);
  useHashLeaveGuard(draftDirty, useCallback(() => requestLeave(), [requestLeave]));

  useEffect(() => {
    const applyVerifyPayload = (payload: VerifyPayload, manual = false) => { const next = normalizePayload(payload); replaceDraft(next); setVerify(true); setError(""); if (!manual && location.hash !== "#/create/verify") navigate({ kind: "verify" }); };
    const onRenderVerify = (event: Event) => { const detail = (event as CustomEvent<{ payload: VerifyPayload; manual?: boolean }>).detail; if (detail?.payload) flushSync(() => applyVerifyPayload(detail.payload, detail.manual)); };
    const pending = globalWindow().__bagiinVerify;
    if (pending) { delete globalWindow().__bagiinVerify; applyVerifyPayload(pending.payload, pending.manual); }
    window.addEventListener("bagiin:render-verify", onRenderVerify);
    const createBillFinal = async () => {
      const saved = await saveBill();
      draftRef.current.photos.forEach(photo => photoCleanup.markAttached(photo));
      navigate({ kind: "bill", billId: saved.billId });
      return saved.result;
    };
    globalWindow().createBillFinal = createBillFinal;
    return () => { window.removeEventListener("bagiin:render-verify", onRenderVerify); if (globalWindow().createBillFinal === createBillFinal) delete globalWindow().createBillFinal; };
  }, [identity, photoCleanup, replaceDraft, saveBill]);

  const startVerify = (fromPhoto = false) => { replaceDraft(blankDraft()); setError(""); setVerify(true); navigate({ kind: "verify" }); if (fromPhoto) window.setTimeout(() => document.getElementById("verify-file-input")?.click(), 0); };
  const submit = async (event: React.FormEvent) => { event.preventDefault(); setBusy(true); setError(""); try { await globalWindow().createBillFinal?.(); } catch (err) { setError(err instanceof Error ? err.message : "Bill belum dapat dibuat"); } finally { setBusy(false); } };
  if (!verify) return <CreateStart onManual={() => startVerify(false)} onPhoto={() => startVerify(true)} />;
  const finishLeave = (allowed: boolean) => { const resolve = leavePrompt; setLeavePrompt(null); resolve?.(allowed); };
  return <><VerifyEditor draft={draft} updateDraft={updateDraft} cleanup={photoCleanup} onBack={() => { void photoCleanup.releaseAll(); setVerify(false); navigate({ kind: "create" }); }} onSubmit={submit} busy={busy} error={error} onError={setError} /><ConfirmDialog open={Boolean(leavePrompt)} onClose={() => finishLeave(false)} onConfirm={() => finishLeave(true)} /></>;
}

function CreateStart({ onManual, onPhoto }: { onManual: () => void; onPhoto: () => void }) {
  return <AppFrame contextualDock><Topbar title="Buat bill" back={() => navigate({ kind: "home" })} /><main className="shell"><div className="page-intro"><p className="eyebrow">Mulai patungan</p><h1>Pilih cara masukin struk.</h1><p className="muted">Foto struk untuk dibaca otomatis, atau isi item satu per satu.</p></div><div className="choice-grid"><Card id="dz"><Button id="ocr-btn" className="btn-block" onClick={onPhoto}><Camera /> Foto struk</Button><p className="muted">Bisa menambahkan sampai dua foto.</p></Card><Card><Button id="manual-btn" variant="outline" className="btn-block" onClick={onManual}><PencilSimple /> Isi manual</Button><p className="muted">Kamu tetap bisa menambahkan foto nanti.</p></Card></div></main></AppFrame>;
}

function VerifyEditor({ draft, updateDraft, cleanup, onBack, onSubmit, busy, error, onError }: { draft: BillDraft; updateDraft: (updater: (current: BillDraft) => BillDraft) => void; cleanup: PhotoCleanup; onBack: () => void; onSubmit: (event: React.FormEvent) => void; busy: boolean; error: string; onError: (error: string) => void }) {
  const [photoBusy, setPhotoBusy] = useState(false);
  const [desktopRail, setDesktopRail] = useState(() => typeof window !== "undefined" && window.innerWidth >= 1040);
  const [, refreshDerived] = useState(0);
  useEffect(() => {
    const updateRail = () => setDesktopRail(window.innerWidth >= 1040);
    window.addEventListener("resize", updateRail);
    return () => window.removeEventListener("resize", updateRail);
  }, []);
  const subtotal = useMemo(() => draft.items.every(item => validQuantity(item.quantity)) ? draft.items.reduce((sum, item) => sum + Math.max(0, item.price - item.discount) * item.quantity, 0) : null, [draft.items]);
  const total = subtotal == null ? null : Math.max(0, subtotal - draft.order_discount - draft.cashback + (draft.tax_included ? 0 : draft.tax) + draft.service);
  const valid = validDraft(draft);
  const setField = (patch: Partial<BillDraft>) => updateDraft(current => ({ ...current, ...patch }));
  const updateItem = (id: string, patch: Partial<DraftItem>) => updateDraft(current => ({ ...current, items: current.items.map(item => item.id === id ? { ...item, ...patch } : item) }));
  const addPhoto = async (event: React.ChangeEvent<HTMLInputElement>) => { const files = [...(event.target.files || [])].slice(0, 2); if (!files.length) return; setPhotoBusy(true); onError(""); try { const result = await apiClient.photos.upload(files[0]); const path = result.photo_path; if (path) { cleanup.track(path); updateDraft(current => ({ ...current, photos: [...current.photos, path], photo_path: current.photo_path || path })); } } catch (err) { onError(err instanceof Error ? err.message : "Foto belum dapat disimpan"); } finally { setPhotoBusy(false); event.target.value = ""; } };
  return <AppFrame contextualDock><Topbar title="Periksa bill" back={onBack} /><main className="shell shell-with-rail" style={desktopRail ? undefined : { display: "block" }}><div className="shell-main stack"><Card className="verify-detail-card"><div className="form-grid"><div className="field full"><Label htmlFor="title-input">Judul bill</Label><Input id="title-input" value={draft.title} onChange={event => setField({ title: event.target.value })} placeholder="Contoh: Makan sushi" /></div><div className="field"><Label htmlFor="merchant-input">Tempat, opsional</Label><Input id="merchant-input" value={draft.merchant} onChange={event => setField({ merchant: event.target.value })} placeholder="Nama tempat" /></div><div className="field"><Label htmlFor="date-input">Tanggal transaksi</Label><div id="date-input-wrap" className={`date-input-wrap ${draft.transacted_at ? "" : "is-empty"}`}><Input id="date-input" type="date" value={draft.transacted_at} onChange={event => setField({ transacted_at: event.target.value })} /><span className="vf-date-placeholder" aria-hidden="true">dd/mm/yyyy</span></div><p className="date-helper">Opsional, pilih tanggal transaksi.</p></div></div></Card>
    <Card id="items-card"><div className="card-title"><span><Receipt /> Item</span><Button id="add-item-btn" size="sm" variant="outline" type="button" onClick={() => updateDraft(current => ({ ...current, items: [...current.items, emptyItem()] }))}><Plus /> Tambah</Button></div><div className="vf-head" aria-hidden="true"><span>Nama item</span><span>Harga satuan</span><span>Jumlah dibeli</span><span>Potongan</span><span>Total</span></div><div id="items-list" className="stack-sm">{draft.items.map((item, index) => <VerifyItem key={item.id} item={item} index={index} canDelete={draft.items.length > 1} onChange={patch => updateItem(item.id, patch)} onDelete={() => updateDraft(current => ({ ...current, items: current.items.filter(candidate => candidate.id !== item.id) }))} />)}</div><div className="info-box">Total baris dihitung dari harga, potongan, dan jumlah item.</div></Card>
    <Card><div className="card-title"><span>Biaya tambahan</span><span className="muted">Opsional</span></div><div className="form-grid"><MoneyField id="subtotal-input" label="Subtotal" value={subtotal || 0} displayValue={subtotal == null ? "" : new Intl.NumberFormat("id-ID").format(subtotal)} onValue={() => refreshDerived(value => value + 1)} /><MoneyField id="tax-input" label="Pajak" value={draft.tax} onValue={tax => setField({ tax })} /><MoneyField id="service-input" label="Service" value={draft.service} onValue={service => setField({ service })} /><MoneyField id="order-discount-input" label="Diskon pesanan" value={draft.order_discount} onValue={order_discount => setField({ order_discount })} /><MoneyField id="cashback-input" label="Cashback" value={draft.cashback} onValue={cashback => setField({ cashback })} /></div><label className="check-label"><input type="checkbox" checked={draft.tax_included} onChange={event => setField({ tax_included: event.target.checked })} /> Pajak sudah termasuk dalam harga item</label></Card>
    <details className="card verify-people-card" open><summary className="details-summary"><span><UsersThree /> Yang ikut</span><span className="muted">Opsional</span></summary><div className="details-body stack-sm"><p className="field-hint">Tambahkan nama teman yang akan menerima undangan, atau biarkan mereka masuk dari link.</p>{draft.extra_names.map((name, index) => <div className="row" key={`${name}-${index}`}><Input aria-label={`Nama peserta ${index + 1}`} value={name} onChange={event => updateDraft(current => ({ ...current, extra_names: current.extra_names.map((currentName, currentIndex) => currentIndex === index ? event.target.value : currentName) }))} /><Button type="button" variant="ghost" size="icon" aria-label={`Hapus peserta ${name}`} onClick={() => updateDraft(current => ({ ...current, extra_names: current.extra_names.filter((_, currentIndex) => currentIndex !== index) }))}><Trash /></Button></div>)}<div className="row"><Input id="person-name-input" aria-label="Nama peserta baru" placeholder="Nama teman" onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); const input = event.currentTarget; const name = input.value.trim(); if (name) { updateDraft(current => ({ ...current, extra_names: [...current.extra_names, name] })); input.value = ""; } } }} /><Button id="person-name-add" type="button" variant="outline" aria-label="Tambah peserta" onClick={() => { const input = document.getElementById("person-name-input") as HTMLInputElement | null; const name = input?.value.trim(); if (name) { updateDraft(current => ({ ...current, extra_names: [...current.extra_names, name] })); if (input) input.value = ""; } }}><Plus /> Tambah</Button></div></div></details>
    <Card><div className="card-title"><span>Foto struk</span><span className="muted">Boleh dilewati</span></div><input id="verify-file-input" className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" onChange={addPhoto} /><div className="row wrap"><Button id="verify-add-photo" type="button" variant="outline" onClick={() => document.getElementById("verify-file-input")?.click()} disabled={photoBusy}><UploadSimple /> {photoBusy ? "Menyimpan..." : "Tambah foto"}</Button><Button id="verify-paste-photo" type="button" variant="ghost" onClick={() => onError("Tempel foto dari tombol tambah foto dulu ya")}>Tempel foto</Button></div>{draft.photos.length > 0 && <p className="field-hint">{draft.photos.length} foto siap dilampirkan.</p>}</Card>
    {error && <p className="error-text" role="alert">{error}</p>}<p className="vf-mode-helper">Bagi rata dan Bagi per porsi tersedia di halaman bill. Jumlah porsi bukan batas jumlah peserta.</p>
  </div><aside className="shell-side"><div className="dock"><div className="dock-panel"><div className="dock-total"><span className="muted">Total baris dihitung</span><strong id="total-display" className="money">{total == null ? "—" : rupiahFmt(total)}</strong></div><div id="sum-warn" className="caption">{subtotal == null ? "Lengkapi jumlah item untuk melihat total." : ""}</div><Button id="create-bill-btn" type="submit" className="btn-block" style={{ marginTop: 12 }} disabled={!valid || busy} onClick={onSubmit}>{busy ? <><Spinner /> Membuat...</> : <><Check /> Buat bill</>}</Button></div></div></aside></main></AppFrame>;
}

function VerifyItem({ item, index, canDelete, onChange, onDelete }: { item: DraftItem; index: number; canDelete: boolean; onChange: (patch: Partial<DraftItem>) => void; onDelete: () => void }) {
  const line = validQuantity(item.quantity) ? Math.max(0, item.price - item.discount) * item.quantity : null;
  const quantityError = !validQuantity(item.quantity);
  return <div className="vf-item"><div className="vf-item-header"><div className="field"><Label htmlFor={`item-name-${index}`}>Nama item</Label><div className="row"><Input id={`item-name-${index}`} data-role="name" value={item.name} onChange={event => onChange({ name: event.target.value })} placeholder="Nama item" /><Button type="button" data-role="del" variant="ghost" size="icon" aria-label={`Hapus ${item.name || "item"}`} disabled={!canDelete} onClick={onDelete}><Trash /></Button></div></div></div><div className="vf-input-group form-grid"><div className="field"><Label htmlFor={`item-price-${index}`}>Harga satuan</Label><Input id={`item-price-${index}`} data-role="price" inputMode="numeric" value={item.price || ""} onChange={event => onChange({ price: asMoney(event.target.value) })} placeholder="0" /></div><div className="field"><Label htmlFor={`item-qty-${index}`}>Jumlah dibeli</Label><div className="qty-control"><Button type="button" className="qty-dec" variant="outline" size="icon" aria-label="Kurangi jumlah" onClick={() => onChange({ quantity: validQuantity(item.quantity) ? Math.max(1, item.quantity - 1) : 1 })}>-</Button><Input id={`item-qty-${index}`} data-role="quantity" inputMode="numeric" value={validQuantity(item.quantity) ? item.quantity : ""} aria-invalid={quantityError} onChange={event => onChange({ quantity: asQuantity(event.target.value) })} /><Button type="button" className="qty-inc" variant="outline" size="icon" aria-label="Tambah jumlah" onClick={() => onChange({ quantity: validQuantity(item.quantity) ? Math.min(99, item.quantity + 1) : 1 })}>+</Button></div><p data-role="quantity-error" className={`error-text${quantityError ? "" : " hidden"}`} aria-hidden={!quantityError} hidden={!quantityError}>Jumlah harus bilangan bulat minimal 1.</p></div><MoneyField id={`item-discount-${index}`} label="Potongan" value={item.discount} onValue={discount => onChange({ discount })} dataRole="discount" /></div><div className="vf-line-total" style={{ gridColumn: "1 / -1" }}><span>Total baris</span><strong data-role="line-total" className="money">{line == null ? "—" : rupiahFmt(line)}</strong></div><div className="vf-discount"><span className="muted">Mode pembagian</span><select className="input vf-mode" value={item.mode} onChange={event => onChange({ mode: event.target.value === "slot" ? "slot" : "free" })}><option value="free">Bagi rata</option><option value="slot">Bagi per porsi</option></select></div></div>;
}

function MoneyField({ id, label, value, displayValue, onValue, dataRole }: { id: string; label: string; value: number; displayValue?: string; onValue: (value: number) => void; dataRole?: string }) { return <div className="field"><Label htmlFor={id}>{label}</Label><Input id={id} data-role={dataRole} inputMode="numeric" value={displayValue ?? (value || "")} onChange={event => onValue(asMoney(event.target.value))} placeholder="0" /></div>; }
function validQuantity(value: number) { return Number.isInteger(value) && value >= 1 && value <= 99; }
function validDraft(draft: BillDraft) { return Boolean(draft.items.length && draft.items.every(item => item.name.trim() && item.price >= 0 && validQuantity(item.quantity) && item.discount >= 0 && item.discount <= item.price)); }
function isDraftDirty(draft: BillDraft): boolean {
  return Boolean(
    draft.title.trim() || draft.merchant.trim() || draft.transacted_at || draft.photos.length
    || draft.order_discount || draft.cashback || draft.tax || draft.service
    || draft.extra_names.some(name => name.trim())
    || draft.items.some(item => item.name.trim() || item.price || item.discount || item.quantity !== 1)
  );
}

export function billDraftFromResponse(response: { bill: { title?: string; merchant?: string | null; transacted_at?: string | null; tax_idr?: number; service_idr?: number; order_discount_idr?: number; cashback_idr?: number; tax_included?: number | boolean; paid_by_name?: string | null }; items: Array<{ id: number; name: string; price_idr: number; discount_idr?: number; quantity?: number; mode?: string; slot_count?: number | null }>; photos?: Array<{ path: string }> }): BillDraft { return { title: response.bill.title || "", merchant: response.bill.merchant || "", transacted_at: response.bill.transacted_at || "", items: response.items.map(item => ({ id: `server-${item.id}`, serverId: item.id, name: item.name, price: item.price_idr, discount: item.discount_idr || 0, quantity: Number(item.quantity || 1), mode: item.mode === "slot" ? "slot" : "free", slot_count: Number(item.slot_count || 2) })), order_discount: response.bill.order_discount_idr || 0, cashback: response.bill.cashback_idr || 0, tax: response.bill.tax_idr || 0, service: response.bill.service_idr || 0, tax_included: Boolean(response.bill.tax_included), paid_by_myself: true, paid_by_name: response.bill.paid_by_name || "", extra_names: [], photos: response.photos?.map(photo => photo.path) || [] }; }
