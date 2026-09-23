import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Camera, Check, ClipboardText, PencilSimple, Plus, Receipt, Trash, UploadSimple, UsersThree } from "@phosphor-icons/react";
import { apiClient, apiJson } from "../lib/api";
import { useHashLeaveGuard } from "../lib/leave-guard";
import { navigate } from "../lib/routes";
import { rupiahFmt, rupiahParse } from "../lib/money";
import {
  applyContactToggle,
  contactInitial,
  inviteFailureNotice,
  participantPlaceholders,
  pickerContactCaption,
  typedNameRefusal,
  type BillDraft,
  type Contact,
  type CreateBillRequest,
  type DraftItem,
  type Identity,
  type PickedContact,
} from "../lib/types";
import { usePhotoCleanup, type PhotoCleanup } from "../lib/photos";
import { AppFrame, Topbar } from "../components/AppShell";
import { ReceiptPhotoGallery } from "../components/ReceiptPhotoGallery";
import { Button as ShadcnButton } from "../components/ui/button";
import { Button, Card, Input, Label, Spinner } from "../components/ui/primitives";
import { ConfirmDialog } from "../components/feedback";

type OcrItem = { name?: string; price?: number | string; price_idr?: number; discount?: number | string; discount_idr?: number; quantity?: number | string; mode?: "free" | "slot" | string; slot_count?: number };
/** The verify payload may carry already-picked proven contacts (the OCR/manual
    entry points do not, but a caller re-rendering a draft does). */
type VerifyPayload = Omit<Partial<BillDraft>, "items" | "picked_contacts"> & { merchant?: string; title?: string; transacted_at?: string; items?: OcrItem[]; subtotal?: number; tax?: number; service?: number; photos?: string[]; photo_path?: string; paidByMyself?: boolean; picked_contacts?: PickedContact[] };
type GlobalWindow = Window & { renderVerify?: (payload: VerifyPayload, manual?: boolean) => void; createBillFinal?: () => Promise<unknown>; apiJson?: typeof apiJson; __bagiinVerify?: { payload: VerifyPayload; manual?: boolean } };

const globalWindow = () => window as GlobalWindow;
const uid = () => { try { return crypto.randomUUID(); } catch { return `item-${Date.now()}-${Math.random()}`; } };
const emptyItem = (): DraftItem => ({ id: uid(), name: "", price: 0, discount: 0, quantity: 1, mode: "free", slot_count: 2 });
const blankDraft = (): BillDraft => ({ title: "", merchant: "", transacted_at: "", items: [emptyItem()], order_discount: 0, cashback: 0, tax: 0, service: 0, tax_included: false, paid_by_myself: true, paid_by_name: "", extra_names: [], picked_contacts: [], photos: [] });
const asMoney = (value: unknown): number => { const parsed = typeof value === "number" ? value : rupiahParse(value == null ? "" : String(value)); return parsed == null || !Number.isFinite(parsed) ? 0 : Math.max(0, parsed); };
const asQuantity = (value: unknown): number => { const parsed = Number(value); return Number.isInteger(parsed) && parsed >= 1 && parsed <= 99 ? parsed : Number.NaN; };
const payloadItem = (item: OcrItem): DraftItem => ({ id: uid(), serverId: typeof item === "object" && Number.isInteger((item as { id?: unknown }).id) ? Number((item as { id: number }).id) : undefined, name: String(item.name || ""), price: asMoney(item.price ?? item.price_idr), discount: asMoney(item.discount ?? item.discount_idr), quantity: asQuantity(item.quantity ?? 1), mode: item.mode === "slot" ? "slot" : "free", slot_count: Number.isInteger(item.slot_count) && Number(item.slot_count) > 0 ? Number(item.slot_count) : 2 });

/* Receipt-photo limits. One named set, shared by EVERY input path (picker,
   camera, gallery, drop-in paste, editor attach) so the start-screen copy and
   the editor card cannot drift apart — the legacy screen kept the same three
   constants (frontend/static/create.js:20-22) and the server re-checks all of
   them (/api/ocr, backend/main.py:2365-2400). The client copy here is an
   optimisation; the server stays the contract. */
const MAX_RECEIPT_PHOTOS = 2;
const MAX_RECEIPT_PHOTO_BYTES = 5 * 1024 * 1024;
const MAX_RECEIPT_BATCH_BYTES = 10 * 1024 * 1024;
const RECEIPT_PHOTO_LIMIT_COPY = "Maksimal 2 foto struk, pilih halaman 1 dan 2 saja.";
const RECEIPT_PHOTO_SIZE_COPY = "Ukuran foto maksimal 5 MiB per foto, total 10 MiB.";
const RECEIPT_PHOTO_TYPE_COPY = "File yang dipilih harus gambar.";
const RECEIPT_PHOTO_CAPACITY_COPY = "Foto struk sudah dua, hapus dulu lewat edit bill kalau mau ganti.";

type PhotoBatch = { files: File[] } | { error: string };

/** Shared cap/type/size gate. Runs before any network work on every path. */
function validateReceiptPhotoBatch(input: File[], slots = MAX_RECEIPT_PHOTOS): PhotoBatch {
  const photoFiles = input.filter((file): file is File => Boolean(file) && typeof file.type === "string");
  if (!photoFiles.length) return { error: "Tidak ada foto yang dipilih." };
  if (slots <= 0) return { error: RECEIPT_PHOTO_CAPACITY_COPY };
  if (photoFiles.length > slots) return { error: RECEIPT_PHOTO_LIMIT_COPY };
  let totalBytes = 0;
  for (const file of photoFiles) {
    if (!file.type.startsWith("image/")) return { error: RECEIPT_PHOTO_TYPE_COPY };
    if (file.size > MAX_RECEIPT_PHOTO_BYTES) return { error: "Ukuran foto maksimal 5 MiB per foto." };
    totalBytes += Number(file.size) || 0;
  }
  if (totalBytes > MAX_RECEIPT_BATCH_BYTES) return { error: RECEIPT_PHOTO_SIZE_COPY };
  return { files: photoFiles };
}

function photoPathsFrom(result: { photos?: string[]; photo_path?: string | null }): string[] {
  const paths: string[] = [];
  if (typeof result.photo_path === "string" && result.photo_path) paths.push(result.photo_path);
  for (const path of result.photos || []) if (typeof path === "string" && path && !paths.includes(path)) paths.push(path);
  return paths;
}

const isCoarsePointer = (): boolean => { try { return window.matchMedia("(pointer: coarse)").matches; } catch { return false; } };

/**
 * Read an image straight off the clipboard (mobile Chrome, iOS Safari 16.4+).
 * Every branch that cannot produce a file throws the SAME message the user sees
 * — the legacy screen did the same (frontend/static/create.js:512-537) because
 * a raw DOMException string ("NotAllowedError: ...") spliced into Indonesian
 * copy helps nobody. Support is checked rather than assumed: the caller hides
 * nothing, it says what to do instead.
 */
async function readClipboardImages(): Promise<File[]> {
  if (!navigator.clipboard || typeof navigator.clipboard.read !== "function") {
    throw new Error(isCoarsePointer()
      ? "Browser kamu tidak bisa baca clipboard — long-press terus pilih Paste"
      : "Browser kamu tidak bisa baca clipboard — tekan Ctrl+V aja");
  }
  let items: ClipboardItem[];
  try {
    items = await navigator.clipboard.read();
  } catch {
    throw new Error("Tidak bisa membaca clipboard (izin ditolak). Coba tempel menggunakan Ctrl+V ya");
  }
  const files: File[] = [];
  for (const item of items) {
    const type = item.types.find(candidate => candidate.startsWith("image/"));
    if (!type) continue;
    const blob = await item.getType(type);
    files.push(new File([blob], "clipboard-image.png", { type: blob.type || "image/png" }));
  }
  if (!files.length) throw new Error("Clipboard kamu tidak ada gambarnya");
  return files;
}

/**
 * System paste (desktop Ctrl+V, mobile long-press -> Paste). Bound only while
 * the create surface is mounted, and it never calls preventDefault unless it
 * actually took an image — otherwise a paste aimed at a notes app or at a
 * text field elsewhere would be swallowed. (bug history kept: a paste during
 * "Lagi baca struknya" used to be eaten silently.)
 */
function useReceiptPaste(enabled: boolean, onFiles: (files: File[]) => void): void {
  const handlerRef = useRef(onFiles);
  useEffect(() => { handlerRef.current = onFiles; }, [onFiles]);
  useEffect(() => {
    if (!enabled) return;
    const onPaste = (event: ClipboardEvent) => {
      const items = event.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        if (item.kind !== "file" || !item.type.startsWith("image/")) continue;
        const file = item.getAsFile();
        if (file) files.push(file);
      }
      if (!files.length) return;
      event.preventDefault();
      handlerRef.current(files);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [enabled]);
}

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
    picked_contacts: (Array.isArray(payload.picked_contacts) ? payload.picked_contacts : [])
      .filter(contact => contact && typeof contact.id === "string" && typeof contact.name === "string")
      .map(contact => ({ id: contact.id, name: contact.name, ...(contact.last_shared ? { last_shared: contact.last_shared } : {}) })),
    photos: Array.isArray(payload.photos) ? payload.photos.map(String).filter(Boolean) : [],
    photo_path: payload.photo_path
  };
}

function createPayload(draft: BillDraft, identity: Identity): CreateBillRequest {
  const items = draft.items.map(item => ({ ...(item.serverId ? { id: item.serverId } : {}), name: item.name.trim(), price: item.price, discount: item.discount, quantity: item.quantity, mode: item.mode, slot_count: item.mode === "slot" ? item.slot_count : null }));
  const subtotal = items.reduce((sum, item) => sum + Math.max(0, item.price - item.discount) * item.quantity, 0);
  const total = Math.max(0, subtotal - draft.order_discount - draft.cashback + (draft.tax_included ? 0 : draft.tax) + draft.service);
  /* `participants` is placeholder NAMES only. Picked proven contacts are real
     identities and are invited AFTER the bill exists, so they must never be
     folded in here (bug: one list feeding both paths put the same person on the
     bill twice — once as an identity-less placeholder, once as a member). */
  return { title: draft.title.trim() || draft.merchant.trim() || "Bill", merchant: draft.merchant.trim() || null, transacted_at: draft.transacted_at || null, items, participants: participantPlaceholders(draft), paid_by_name: draft.paid_by_myself ? identity.name : (draft.paid_by_name.trim() || null), subtotal, tax: draft.tax_included ? 0 : draft.tax, service: draft.service, order_discount: draft.order_discount, cashback: draft.cashback, total, tax_included: draft.tax_included, photos: draft.photos, photo_path: draft.photo_path || null };
}

/**
 * Put the picked proven contacts on the bill that now exists.
 *
 * Ported from the legacy submit path (frontend/static/create.js:1936-1947)
 * because it answers a question the naive version gets wrong: what happens to
 * an invite that has not come back yet? Four rules, all of them load-bearing:
 *   1. the bill is ALREADY created and the caller has already navigated to it,
 *      so a failed invite must never roll back or block anything;
 *   2. every invite goes out in ONE batch (`allSettled`) instead of a serial
 *      chain, so one slow contact cannot hold up the rest;
 *   3. the batch is bounded by an 8s race — an invite still in flight after that
 *      is reported as "masih diproses", not as a failure, because a slow network
 *      is not a failed invite;
 *   4. the copy is shown by `showBillNotice`, appending to `document.body`
 *      instead of lifting state. This function resolves AFTER the create screen
 *      has unmounted (the caller navigates to the bill first), so a `setState`
 *      here would render nothing — the legacy `toast()` had the same property
 *      and that is why it was a standalone DOM node in the first place
 *      (frontend/static/app.js:421).
 */
const INVITE_BATCH_TIMEOUT_MS = 8000;
async function invitePickedContacts(billId: string, contacts: PickedContact[]): Promise<void> {
  if (!contacts.length) return;
  const work = Promise.allSettled(contacts.map(contact => apiClient.bills.invite(billId, { identity_id: contact.id })));
  let timer: number | undefined;
  const timed = await Promise.race([
    work,
    new Promise<null>(resolve => { timer = window.setTimeout(() => resolve(null), INVITE_BATCH_TIMEOUT_MS); }),
  ]);
  if (timer) window.clearTimeout(timer);
  const notice = inviteFailureNotice(timed);
  if (notice) showBillNotice(notice);
}

/**
 * The React port's stand-in for the legacy `toast()`.
 *
 * Deliberately imperative: it is called from code that runs while the create
 * screen is unmounting, and it must keep painting after the route has changed
 * (that is the whole point of a toast). One node at a time, replaced rather
 * than stacked, and removed on a timer the same way the legacy one was.
 */
function showBillNotice(message: string): void {
  const previous = document.getElementById("app-notice");
  if (previous) previous.remove();
  const node = document.createElement("div");
  node.id = "app-notice";
  node.className = "app-notice";
  node.setAttribute("role", "status");
  node.textContent = message;
  document.body.appendChild(node);
  // Next frame, so the CSS transition has a painted start state to move from.
  window.requestAnimationFrame(() => node.classList.add("is-shown"));
  window.setTimeout(() => node.remove(), 4000);
}

export function CreateRoute({ identity, initialVerify = false }: { identity: Identity; initialVerify?: boolean }) {
  const [verify, setVerify] = useState(initialVerify);
  const [draft, setDraft] = useState<BillDraft>(() => blankDraft());
  const draftRef = useRef(draft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [photoError, setPhotoError] = useState("");
  const photoCleanup = usePhotoCleanup();
  const [leavePrompt, setLeavePrompt] = useState<((allowed: boolean) => void) | null>(null);
  // One counter guards every async photo/OCR run, mirroring the legacy
  // createFlowSession: a result that lands after the user navigated away must
  // release its uploads instead of painting over whatever screen is current.
  const runRef = useRef(0);

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

  /**
   * Create the bill, then put the picked proven contacts on it.
   *
   * The order is the contract: navigate FIRST (the bill exists, so the user is
   * never made to wait on other people's invite round-trips), then fire the
   * invites in the background. `invitePickedContacts` never throws — its result
   * is reported with a toast, not by failing this call.
   */
  const createBillAndInvite = useCallback(async () => {
    const current = draftRef.current;
    const saved = await saveBill();
    current.photos.forEach(photo => photoCleanup.markAttached(photo));
    navigate({ kind: "bill", billId: saved.billId });
    void invitePickedContacts(saved.billId, current.picked_contacts);
    return saved.result;
  }, [photoCleanup, saveBill]);

  useEffect(() => {
    const applyVerifyPayload = (payload: VerifyPayload, manual = false) => { const next = normalizePayload(payload); replaceDraft(next); setVerify(true); setError(""); setPhotoError(""); if (!manual && location.hash !== "#/create/verify") navigate({ kind: "verify" }); };
    const onRenderVerify = (event: Event) => { const detail = (event as CustomEvent<{ payload: VerifyPayload; manual?: boolean }>).detail; if (detail?.payload) flushSync(() => applyVerifyPayload(detail.payload, detail.manual)); };
    const pending = globalWindow().__bagiinVerify;
    if (pending) { delete globalWindow().__bagiinVerify; applyVerifyPayload(pending.payload, pending.manual); }
    window.addEventListener("bagiin:render-verify", onRenderVerify);
    const createBillFinal = async () => createBillAndInvite();
    globalWindow().createBillFinal = createBillFinal;
    return () => { window.removeEventListener("bagiin:render-verify", onRenderVerify); if (globalWindow().createBillFinal === createBillFinal) delete globalWindow().createBillFinal; };
  }, [createBillAndInvite, replaceDraft]);

  const startVerify = (fromPhoto = false) => { replaceDraft(blankDraft()); setError(""); setPhotoError(""); setVerify(true); navigate({ kind: "verify" }); if (fromPhoto) window.setTimeout(() => document.getElementById("verify-file-input")?.click(), 0); };
  const submit = async (event: React.FormEvent) => { event.preventDefault(); setBusy(true); setError(""); try { await globalWindow().createBillFinal?.(); } catch (err) { setError(err instanceof Error ? err.message : "Bill belum dapat dibuat"); } finally { setBusy(false); } };

  /**
   * Plain attachment fallback: upload each photo as a stored file with NO
   * scan, then open the manual editor carrying them. This is the v61 behaviour
   * the React port dropped — an OCR read failure must never throw the photo
   * away and must never land on a blank screen.
   */
  const attachThenManual = useCallback(async (files: File[], message: string, runId: number) => {
    const uploaded: string[] = [];
    try {
      for (const file of files) {
        const result = await apiClient.photos.upload(file);
        if (result.photo_path) { uploaded.push(result.photo_path); photoCleanup.track(result.photo_path); }
      }
    } catch (uploadError) {
      uploaded.forEach(path => photoCleanup.markRemoved(path));
      if (runRef.current !== runId) return;
      setError("");
      replaceDraft(blankDraft());
      setVerify(true);
      navigate({ kind: "verify" });
      setPhotoError(uploadError instanceof Error ? uploadError.message : "Foto belum dapat disimpan");
      return;
    }
    if (runRef.current !== runId) { uploaded.forEach(path => { void photoCleanup.release(path); }); return; }
    const next = normalizePayload({ ...blankDraft(), photos: uploaded, photo_path: uploaded[0] });
    replaceDraft(next);
    setVerify(true);
    navigate({ kind: "verify" });
    setPhotoError(message);
  }, [photoCleanup, replaceDraft]);

  /** The "Foto struk" path: picker/camera -> POST /api/ocr -> verify review. */
  const startPhotoFlow = useCallback(async (input: File[]) => {
    const batch = validateReceiptPhotoBatch(input);
    if ("error" in batch) { setError(batch.error); return; }
    const runId = runRef.current + 1;
    runRef.current = runId;
    setBusy(true);
    setError("");
    setPhotoError("");
    try {
      const result = await apiClient.photos.ocr(batch.files);
      const photos = photoPathsFrom(result);
      photos.forEach(path => photoCleanup.track(path));
      if (runRef.current !== runId) { photos.forEach(path => { void photoCleanup.release(path); }); return; }
      const next = normalizePayload({
        title: result.title || result.merchant,
        merchant: result.merchant,
        transacted_at: result.transacted_at || result.date,
        items: result.items,
        tax: result.tax,
        service: result.service,
        tax_included: result.tax_included,
        photos,
        photo_path: photos[0]
      });
      replaceDraft(next);
      setVerify(true);
      navigate({ kind: "verify" });
    } catch (ocrError) {
      if (runRef.current !== runId) return;
      // OCR failures still deserve a usable screen: keep the photo and let the
      // user type the items. /api/ocr answers 422 with a safe Indonesian
      // sentence, and ApiError carries that `detail` verbatim as its message.
      const message = ocrError instanceof Error ? ocrError.message : "Struknya belum kebaca, isi manual dulu ya";
      await attachThenManual(batch.files, message, runId);
    } finally {
      if (runRef.current === runId) setBusy(false);
    }
  }, [attachThenManual, photoCleanup, replaceDraft]);

  const startAttachFlow = useCallback(async (input: File[]) => {
    const batch = validateReceiptPhotoBatch(input);
    if ("error" in batch) { setError(batch.error); return; }
    const runId = runRef.current + 1;
    runRef.current = runId;
    setBusy(true);
    setError("");
    setPhotoError("");
    try {
      await attachThenManual(batch.files, "", runId);
    } finally {
      if (runRef.current === runId) setBusy(false);
    }
  }, [attachThenManual]);
  const readPhotoClipboard = useCallback(() => readClipboardImages(), []);

  if (!verify) return <CreateStart busy={busy} error={error} onManual={() => startVerify(false)} onPhoto={files => { void startPhotoFlow(files); }} onAttach={files => { void startAttachFlow(files); }} onReadClipboard={readPhotoClipboard} />;
  const finishLeave = (allowed: boolean) => { const resolve = leavePrompt; setLeavePrompt(null); resolve?.(allowed); };
  return <><VerifyEditor draft={draft} identity={identity} updateDraft={updateDraft} cleanup={photoCleanup} onBack={() => { void photoCleanup.releaseAll(); setVerify(false); navigate({ kind: "create" }); }} onSubmit={submit} busy={busy} error={error} photoError={photoError} onError={setError} onPhotoError={setPhotoError} /><ConfirmDialog open={Boolean(leavePrompt)} onClose={() => finishLeave(false)} onConfirm={() => finishLeave(true)} /></>;
}

/**
 * Start with the photo source, then ask how it should be processed. The old
 * screen made "Pilih foto struk" mean OCR immediately and put "Tempel foto
 * tanpa OCR" in a separate card, so the same choice was split across two
 * unrelated places. Keeping the decision after a real file exists makes the
 * flow the same for upload, camera, paste, and desktop Ctrl+V.
 */
function CreateStart({ busy, error, onManual, onPhoto, onAttach, onReadClipboard }: {
  busy: boolean;
  error: string;
  onManual: () => void;
  onPhoto: (files: File[]) => void;
  onAttach: (files: File[]) => void;
  onReadClipboard: () => Promise<File[]>;
}) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [photoChoiceOpen, setPhotoChoiceOpen] = useState(false);
  const [sourceError, setSourceError] = useState("");
  const queueFiles = useCallback((files: File[]) => {
    const batch = validateReceiptPhotoBatch(files);
    if ("error" in batch) { setSourceError(batch.error); return; }
    setSourceError("");
    setPendingFiles(batch.files);
    setPhotoChoiceOpen(true);
  }, []);
  const pick = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files || [])];
    event.target.value = "";
    if (files.length) queueFiles(files);
  };
  const choosePhotoHandling = (mode: "ocr" | "attach") => {
    const files = pendingFiles;
    setPendingFiles([]);
    setPhotoChoiceOpen(false);
    if (mode === "ocr") onPhoto(files);
    else onAttach(files);
  };
  const paste = async () => {
    try {
      queueFiles(await onReadClipboard());
    } catch (clipboardError) {
      setSourceError(clipboardError instanceof Error
        ? clipboardError.message
        : "Tidak bisa membaca clipboard. Coba tempel menggunakan Ctrl+V ya");
    }
  };
  useReceiptPaste(true, queueFiles);
  useEffect(() => {
    if (!photoChoiceOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPhotoChoiceOpen(false);
        setPendingFiles([]);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [photoChoiceOpen]);
  const displayedError = sourceError || error;
  return <AppFrame contextualDock>
    <Topbar title="Buat bill" back={() => navigate({ kind: "home" })} />
    <main className="shell">
      <div className="page-intro">
        <p className="eyebrow">Mulai patungan</p>
        <h1>Masukkan struk atau isi manual.</h1>
        <p className="muted">Pilih sumber foto dulu. Setelah itu kamu yang menentukan mau dibaca otomatis atau cuma dilampirkan.</p>
      </div>
      <div className="choice-grid">
        <Card id="dz" className="card-accent">
          <div className="card-title"><span><Camera /> Foto struk</span><span className="muted">Upload, kamera, atau tempel</span></div>
          <p className="muted">Setelah fotonya masuk, pilih Baca otomatis (OCR) atau Lampirkan saja untuk isi item sendiri.</p>
          <input ref={cameraRef} id="create-camera-input" className="visually-hidden" type="file" accept="image/*" capture="environment" tabIndex={-1} aria-label="Ambil foto struk dengan kamera" onChange={pick} />
          <input ref={galleryRef} id="create-gallery-input" className="visually-hidden" type="file" accept="image/*" multiple tabIndex={-1} aria-label="Pilih foto struk dari galeri atau file" onChange={pick} />
          <ShadcnButton id="ocr-btn" className="btn-block" disabled={busy} onClick={() => galleryRef.current?.click()}>
            {busy ? <><Spinner /> Memproses foto...</> : <><UploadSimple /> Upload foto</>}
          </ShadcnButton>
          <div className="btn-row create-photo-actions">
            <ShadcnButton variant="outline" disabled={busy} onClick={() => cameraRef.current?.click()}><Camera /> Kamera</ShadcnButton>
            <ShadcnButton variant="outline" disabled={busy} onClick={() => { void paste(); }}><ClipboardText /> Tempel</ShadcnButton>
          </div>
          <p className="field-hint">Bisa pilih sampai 2 foto struk, maksimal 5 MiB per foto.</p>
          {displayedError && <p className="error-text" role="alert">{displayedError}</p>}
        </Card>
        <Card>
          <div className="card-title"><span><PencilSimple /> Isi manual</span><span className="muted">Tanpa foto</span></div>
          <p className="muted">Masukkan item, harga, dan jumlah sendiri tanpa melampirkan foto.</p>
          <ShadcnButton id="manual-btn" variant="outline" className="btn-block" disabled={busy} onClick={onManual}><PencilSimple /> Isi manual</ShadcnButton>
        </Card>
      </div>
    </main>
    {photoChoiceOpen && <div className="sheet-overlay" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) { setPhotoChoiceOpen(false); setPendingFiles([]); } }}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="photo-choice-title">
        <div className="sheet-handle" />
        <h2 className="sheet-title" id="photo-choice-title">Foto siap dipakai</h2>
        <p className="sheet-sub">{pendingFiles.length} foto dipilih. Mau item dan harganya dibaca otomatis, atau kamu isi sendiri?</p>
        <div className="stack-sm">
          <ShadcnButton className="btn-block" onClick={() => choosePhotoHandling("ocr")}><Receipt /> Baca otomatis (OCR)</ShadcnButton>
          <ShadcnButton variant="outline" className="btn-block" onClick={() => choosePhotoHandling("attach")}><PencilSimple /> Lampirkan saja, isi manual</ShadcnButton>
          <ShadcnButton variant="ghost" className="btn-block" onClick={() => { setPhotoChoiceOpen(false); setPendingFiles([]); }}>Batal</ShadcnButton>
        </div>
      </div>
    </div>}
  </AppFrame>;
}


function VerifyEditor({ draft, identity, updateDraft, cleanup, onBack, onSubmit, busy, error, photoError, onError, onPhotoError }: { draft: BillDraft; identity: Identity; updateDraft: (updater: (current: BillDraft) => BillDraft) => void; cleanup: PhotoCleanup; onBack: () => void; onSubmit: (event: React.FormEvent) => void; busy: boolean; error: string; photoError: string; onError: (error: string) => void; onPhotoError: (error: string) => void }) {
  const [photoBusy, setPhotoBusy] = useState(false);
  const [, refreshDerived] = useState(0);
  const subtotal = useMemo(() => draft.items.every(item => validQuantity(item.quantity)) ? draft.items.reduce((sum, item) => sum + Math.max(0, item.price - item.discount) * item.quantity, 0) : null, [draft.items]);
  const total = subtotal == null ? null : Math.max(0, subtotal - draft.order_discount - draft.cashback + (draft.tax_included ? 0 : draft.tax) + draft.service);
  const valid = validDraft(draft);
  const setField = (patch: Partial<BillDraft>) => updateDraft(current => ({ ...current, ...patch }));
  /* Rule 2 of the legacy duplicate guards (frontend/static/create.js:1341-1342):
     a typed name that matches an already-picked proven contact is REFUSED with
     the legacy's toast copy and is NOT pushed into `extra_names`. Two lists
     feeding one roster is what produced a placeholder row next to the invited
     member for the same person. The refusal is announced the same way the
     legacy did it — a transient toast (`showBillNotice`, role="status") — not
     as a persistent form error, because nothing is actually wrong with the
     form. */
  const addTypedName = (input: HTMLInputElement | null) => {
    const name = (input?.value || "").trim();
    if (!name) return;
    const refusal = typedNameRefusal(draft, name);
    if (refusal) { showBillNotice(refusal); return; }
    updateDraft(current => ({ ...current, extra_names: [...current.extra_names, name] }));
    if (input) input.value = "";
  };
  const updateItem = (id: string, patch: Partial<DraftItem>) => updateDraft(current => ({ ...current, items: current.items.map(item => item.id === id ? { ...item, ...patch } : item) }));
  const addPhotos = async (input: File[]) => {
    const slots = MAX_RECEIPT_PHOTOS - draft.photos.filter(Boolean).length;
    const batch = validateReceiptPhotoBatch(input, slots);
    if ("error" in batch) { onPhotoError(batch.error); return; }
    setPhotoBusy(true); onPhotoError("");
    try {
      const uploaded: string[] = [];
      for (const file of batch.files) {
        const result = await apiClient.photos.upload(file);
        if (result.photo_path) { cleanup.track(result.photo_path); uploaded.push(result.photo_path); }
      }
      if (uploaded.length) updateDraft(current => ({ ...current, photos: [...current.photos, ...uploaded], photo_path: current.photo_path || uploaded[0] }));
    } catch (err) { onPhotoError(err instanceof Error ? err.message : "Foto belum dapat disimpan"); } finally { setPhotoBusy(false); }
  };
  const addPhoto = async (event: React.ChangeEvent<HTMLInputElement>) => { const files = [...(event.target.files || [])]; event.target.value = ""; if (files.length) await addPhotos(files); };
  const pastePhoto = async () => {
    try {
      const files = await readClipboardImages();
      await addPhotos(files);
    } catch (clipboardError) {
      onPhotoError(clipboardError instanceof Error ? clipboardError.message : "Tidak bisa membaca clipboard. Coba tempel menggunakan Ctrl+V ya");
    }
  };
  useReceiptPaste(true, useCallback((files: File[]) => { void addPhotos(files); }, [draft.photos]));
  return <AppFrame contextualDock><Topbar title="Periksa bill" back={onBack} /><main className="shell shell-with-rail"><div className="shell-main stack verify-editor-main"><Card className="verify-detail-card"><div className="form-grid"><div className="field full"><Label htmlFor="title-input">Judul bill</Label><Input id="title-input" value={draft.title} onChange={event => setField({ title: event.target.value })} placeholder="Contoh: Makan sushi" /></div><div className="field"><Label htmlFor="merchant-input">Tempat, opsional</Label><Input id="merchant-input" value={draft.merchant} onChange={event => setField({ merchant: event.target.value })} placeholder="Nama tempat" /></div><div className="field"><Label htmlFor="date-input">Tanggal transaksi</Label><div id="date-input-wrap" className={`date-input-wrap ${draft.transacted_at ? "" : "is-empty"}`}><Input id="date-input" type="date" value={draft.transacted_at} onChange={event => setField({ transacted_at: event.target.value })} /><span className="vf-date-placeholder" aria-hidden="true">dd/mm/yyyy</span></div><p className="date-helper">Opsional, pilih tanggal transaksi.</p></div></div></Card>
    <Card className="verify-photo-card"><div className="card-title"><span>Foto struk</span><span className="muted">{draft.photos.length} dari {MAX_RECEIPT_PHOTOS} foto</span></div><input id="verify-file-input" className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" tabIndex={-1} aria-label="Pilih foto struk dari file" onChange={addPhoto} />{draft.photos.length > 0 && <ReceiptPhotoGallery paths={draft.photos} />}<div className="btn-row"><Button id="verify-add-photo" type="button" size="sm" variant="outline" disabled={photoBusy} aria-label="Tambah foto struk" onClick={() => document.getElementById("verify-file-input")?.click()}><UploadSimple /> {photoBusy ? "Menyimpan..." : "Tambah"}</Button><Button id="verify-paste-photo" type="button" size="sm" variant="outline" disabled={photoBusy} aria-label="Tempel foto dari clipboard" onClick={() => { void pastePhoto(); }}><ClipboardText /> Tempel</Button></div>{photoError && <p id="photo-error" className="error-text photo-inline-error" role="alert">{photoError}</p>}{draft.photos.length > 0 ? <p className="field-hint">{draft.photos.length} foto siap dilampirkan. Maksimal {MAX_RECEIPT_PHOTOS} foto, 5 MiB per foto.</p> : <p className="field-hint">Opsional. Item bisa diisi manual walau tanpa foto.</p>}</Card>
    <Card id="items-card" className="verify-items-card"><div className="card-title"><span><Receipt /> Item</span><Button id="add-item-btn" size="sm" variant="outline" type="button" onClick={() => updateDraft(current => ({ ...current, items: [...current.items, emptyItem()] }))}><Plus /> Tambah</Button></div><div className="vf-head" aria-hidden="true"><span>Nama item</span><span>Harga satuan</span><span>Jumlah dibeli</span><span>Potongan</span><span>Total</span></div><div id="items-list" className="stack-sm">{draft.items.map((item, index) => <VerifyItem key={item.id} item={item} index={index} canDelete={draft.items.length > 1} onChange={patch => updateItem(item.id, patch)} onDelete={() => updateDraft(current => ({ ...current, items: current.items.filter(candidate => candidate.id !== item.id) }))} />)}</div><div className="info-box">Total baris dihitung dari harga, potongan, dan jumlah item.</div></Card>
    <Card><div className="card-title"><span>Biaya tambahan</span><span className="muted">Opsional</span></div><div className="form-grid"><MoneyField id="subtotal-input" label="Subtotal" value={subtotal || 0} displayValue={subtotal == null ? "" : new Intl.NumberFormat("id-ID").format(subtotal)} onValue={() => refreshDerived(value => value + 1)} /><MoneyField id="tax-input" label="Pajak" value={draft.tax} onValue={tax => setField({ tax })} /><MoneyField id="service-input" label="Service" value={draft.service} onValue={service => setField({ service })} /><MoneyField id="order-discount-input" label="Diskon pesanan" value={draft.order_discount} onValue={order_discount => setField({ order_discount })} /><MoneyField id="cashback-input" label="Cashback" value={draft.cashback} onValue={cashback => setField({ cashback })} /></div><label className="check-label"><input type="checkbox" checked={draft.tax_included} onChange={event => setField({ tax_included: event.target.checked })} /> Pajak sudah termasuk dalam harga item</label></Card>
    <details className="card verify-people-card" open><summary className="details-summary"><span><UsersThree /> Yang ikut</span><span className="muted">Opsional</span></summary><div className="details-body stack-sm"><PeoplePicker identity={identity} picked={draft.picked_contacts} onToggle={contact => updateDraft(current => ({ ...current, ...applyContactToggle(current, contact) }))} /><p className="field-hint">Tambahkan nama teman yang akan menerima undangan, atau biarkan mereka masuk dari link.</p>{draft.extra_names.map((name, index) => <div className="row" key={`${name}-${index}`}><Input aria-label={`Nama peserta ${index + 1}`} value={name} onChange={event => updateDraft(current => ({ ...current, extra_names: current.extra_names.map((currentName, currentIndex) => currentIndex === index ? event.target.value : currentName) }))} /><Button type="button" variant="ghost" size="icon" aria-label={`Hapus peserta ${name}`} onClick={() => updateDraft(current => ({ ...current, extra_names: current.extra_names.filter((_, currentIndex) => currentIndex !== index) }))}><Trash /></Button></div>)}<div className="row"><Input id="person-name-input" aria-label="Nama peserta baru" placeholder="Nama teman" onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); addTypedName(event.currentTarget); } }} /><Button id="person-name-add" type="button" variant="outline" aria-label="Tambah peserta" onClick={() => addTypedName(document.getElementById("person-name-input") as HTMLInputElement | null)}><Plus /> Tambah</Button></div></div></details>
    {error && <p className="error-text" role="alert">{error}</p>}<p className="vf-mode-helper">Bagi rata dan Bagi per porsi tersedia di halaman bill. Jumlah porsi bukan batas jumlah peserta.</p>
  </div><aside className="shell-side"><div className="dock"><div className="dock-panel dock-panel-create"><div className="dock-total"><span className="muted">Total baris dihitung</span><strong id="total-display" className="money">{total == null ? "-" : rupiahFmt(total)}</strong></div><div id="sum-warn" className="caption" role="status" aria-live="polite">{subtotal == null ? "Lengkapi jumlah item untuk melihat total." : ""}</div><Button id="create-bill-btn" type="submit" className="btn-block" disabled={!valid || busy} onClick={onSubmit}>{busy ? <><Spinner /> Membuat...</> : <><Check /> Buat bill</>}</Button></div></div></aside></main></AppFrame>;
}

/**
 * The "Yang ikut" proven-contact list.
 *
 * Ports the BEHAVIOUR of the legacy `#people-pick` block
 * (frontend/static/create.js:1309-1400) into the React verify editor. Three
 * details are deliberate ports rather than improvements, because each one fixed
 * a real complaint in the legacy screen:
 *
 *   - only PROVEN contacts are offered (`GET /api/identities/{id}/contacts`
 *     returns identities that have shared a bill in either direction), so the
 *     creator never gets a "who is this?" stranger list;
 *   - the empty state is an ACTION, not a dead end: the legacy copy told the
 *     user to invite people via the link, and that is the only way a first-time
 *     user can grow this list (`contacts` is server-derived, not typed);
 *   - a stale response can never paint. The app runs under `<StrictMode>`, so
 *     effects mount twice in development; the generation counter makes the
 *     discarded run a no-op instead of a second render of the same list with a
 *     different loading state.
 *
 * The free-typed name input that lives NEXT TO this list is a separate draft
 * field on purpose (see `PickedContact` in lib/types.ts): typed names are
 * placeholders on the created bill, picked contacts are identities that get a
 * real invite after the bill exists. What the two fields may NOT do is name the
 * same person — `applyContactToggle` (types.ts) strips a same-named typed entry
 * when a contact is ticked, `typedNameRefusal` refuses a typed name that matches
 * a picked contact, and `participantPlaceholders` filters picked names out of
 * the create payload as the last line of defence.
 */
function PeoplePicker({ identity, picked, onToggle }: { identity: Identity; picked: PickedContact[]; onToggle: (contact: PickedContact) => void }) {
  /* `Contact` IS the endpoint's shape, `last_shared` included: `normalizeContact`
     (lib/api.ts) now carries the field through instead of dropping it, so the
     caption below reads the same value the API sent. Re-declaring the field
     locally (the old `LastSharedContact` alias) is exactly how the caption
     became unreachable dead code — the type promised a field nothing populated. */
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const generation = useRef(0);
  /* The flag is SET here, not just cleared, and that matters: the app renders
     under `<StrictMode>`, which in development mounts every effect twice
     (setup -> cleanup -> setup). An effect that only clears the flag in its
     cleanup leaves it cleared after the second setup, so `isCurrent()` is false
     forever and the picker sits on "Muat kontak..." with no error. (bug caught
     on the dev server; the production build does not double-invoke, which is why
     the browser harness — built assets — never saw it.) */
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    const token = generation.current + 1;
    generation.current = token;
    const isCurrent = () => mounted.current && generation.current === token;
    // The identity has no `secret` until it is bound (pre-v51 identities) and
    // the endpoint resolves the caller FROM the headers. Without a secret the
    // fetch can only 404, so say the same "no contacts yet" thing rather than
    // dressing an auth limitation up as an error.
    if (!identity.secret) { setContacts([]); setLoading(false); setError(""); return; }
    setLoading(true);
    setError("");
    apiClient.identities.contacts(identity.id)
      .then(result => { if (isCurrent()) setContacts(result); })
      .catch(err => { if (isCurrent()) setError(err instanceof Error ? err.message : "Kontak belum dapat dimuat"); })
      .finally(() => { if (isCurrent()) setLoading(false); });
    return () => { generation.current += 1; };
  }, [identity.id, identity.secret]);

  if (loading) {
    return <div className="stack-sm" id="people-pick" aria-live="polite" aria-busy="true"><div className="account-row"><Spinner /><div className="grow"><strong>Muat kontak...</strong><div className="caption">Mencari orang yang pernah berbagi bill dengan kamu.</div></div></div></div>;
  }
  if (error) {
    // Carries the API's own message. `role="alert"` so a screen reader hears it
    // without the user having to go looking for it.
    return <div className="stack-sm" id="people-pick"><p className="error-text" role="alert">{error}</p></div>;
  }
  if (!contacts.length) {
    return <div className="stack-sm" id="people-pick"><p className="muted">Belum ada kontak — undang orang lewat tautan agar mereka muncul di sini.</p></div>;
  }
  const selected = new Set(picked.map(contact => contact.id));
  return <div className="stack-sm" id="people-pick" aria-label="Kontak terbukti">{contacts.map(contact => {
    const isPicked = selected.has(contact.id);
    /* The row is a real `<label>` for its checkbox, exactly like the legacy row
       (frontend/static/create.js:1375). As a plain `<div>` the only hit target
       was the 19px box — 361 px² of a 332x66 row (~1.6%) — so tapping the name
       or the caption did nothing. The `htmlFor`/`id` pair is explicit as well
       as implicit, and `cursor: pointer` is the legacy row's own affordance. */
    return <label className={`account-row${isPicked ? " selected" : ""}`} key={contact.id} htmlFor={`people-pick-${contact.id}`} style={{ cursor: "pointer" }}>
      {/* A real checkbox: keyboard-toggleable, and the accessible name carries
          the person AND the state so "Rina" alone is not an ambiguous target. */}
      <input id={`people-pick-${contact.id}`} type="checkbox" checked={isPicked} aria-label={`Ikut sertakan ${contact.name}`} onChange={() => onToggle({ id: contact.id, name: contact.name, last_shared: contact.last_shared })} />
      <div className="avatar" aria-hidden="true">{contactInitial(contact.name)}</div>
      <div className="grow"><div className="item-name">{contact.name}</div><div className="caption">{pickerContactCaption(contact)}</div></div>
    </label>;
  })}</div>;
}

function VerifyItem({ item, index, canDelete, onChange, onDelete }: { item: DraftItem; index: number; canDelete: boolean; onChange: (patch: Partial<DraftItem>) => void; onDelete: () => void }) {
  const line = validQuantity(item.quantity) ? Math.max(0, item.price - item.discount) * item.quantity : null;
  const quantityError = !validQuantity(item.quantity);
  return <div className="vf-item"><div className="vf-item-header"><div className="field"><Label htmlFor={`item-name-${index}`}>Nama item</Label><div className="row"><Input id={`item-name-${index}`} data-role="name" value={item.name} onChange={event => onChange({ name: event.target.value })} placeholder="Nama item" /><Button type="button" data-role="del" variant="ghost" size="icon" aria-label={`Hapus ${item.name || "item"}`} disabled={!canDelete} onClick={onDelete}><Trash /></Button></div></div></div><div className="vf-input-group stack-sm"><div className="field"><Label htmlFor={`item-price-${index}`}>Harga satuan</Label><Input id={`item-price-${index}`} data-role="price" inputMode="numeric" value={item.price || ""} onChange={event => onChange({ price: asMoney(event.target.value) })} placeholder="0" /></div><div className="field"><Label htmlFor={`item-qty-${index}`}>Jumlah dibeli</Label><div className="qty-control"><Button type="button" className="qty-dec" variant="outline" size="icon" aria-label="Kurangi jumlah" onClick={() => onChange({ quantity: validQuantity(item.quantity) ? Math.max(1, item.quantity - 1) : 1 })}>-</Button><Input id={`item-qty-${index}`} data-role="quantity" inputMode="numeric" value={validQuantity(item.quantity) ? item.quantity : ""} aria-invalid={quantityError} onChange={event => onChange({ quantity: asQuantity(event.target.value) })} /><Button type="button" className="qty-inc" variant="outline" size="icon" aria-label="Tambah jumlah" onClick={() => onChange({ quantity: validQuantity(item.quantity) ? Math.min(99, item.quantity + 1) : 1 })}>+</Button></div><p data-role="quantity-error" className={`error-text${quantityError ? "" : " hidden"}`} aria-hidden={!quantityError} hidden={!quantityError}>Jumlah harus bilangan bulat minimal 1.</p></div><MoneyField id={`item-discount-${index}`} label="Potongan" value={item.discount} onValue={discount => onChange({ discount })} dataRole="discount" /></div><div className="vf-line-total"><span>Total baris</span><strong data-role="line-total" className="money">{line == null ? "-" : rupiahFmt(line)}</strong></div><div className="vf-discount"><span className="muted">Mode pembagian</span><select className="input vf-mode" value={item.mode} onChange={event => onChange({ mode: event.target.value === "slot" ? "slot" : "free" })}><option value="free">Bagi rata</option><option value="slot">Bagi per porsi</option></select></div></div>;
}

function MoneyField({ id, label, value, displayValue, onValue, dataRole }: { id: string; label: string; value: number; displayValue?: string; onValue: (value: number) => void; dataRole?: string }) { return <div className="field"><Label htmlFor={id}>{label}</Label><Input id={id} data-role={dataRole} inputMode="numeric" value={displayValue ?? (value || "")} onChange={event => onValue(asMoney(event.target.value))} placeholder="0" /></div>; }
function validQuantity(value: number) { return Number.isInteger(value) && value >= 1 && value <= 99; }
function validDraft(draft: BillDraft) { return Boolean(draft.items.length && draft.items.every(item => item.name.trim() && item.price >= 0 && validQuantity(item.quantity) && item.discount >= 0 && item.discount <= item.price)); }
function isDraftDirty(draft: BillDraft): boolean {
  return Boolean(
    draft.title.trim() || draft.merchant.trim() || draft.transacted_at || draft.photos.length
    || draft.order_discount || draft.cashback || draft.tax || draft.service
    || draft.extra_names.some(name => name.trim())
    /* A picked contact counts as content the user would lose. The legacy guard
       already did (`(verifyState.participants || []).length`,
       frontend/static/create.js:614) — dropping it here would have reintroduced
       the bug that comment documents: one stray Back tap discarding a whole
       chosen roster without asking. */
    || draft.picked_contacts.length > 0
    || draft.items.some(item => item.name.trim() || item.price || item.discount || item.quantity !== 1)
  );
}

export function billDraftFromResponse(response: { bill: { title?: string; merchant?: string | null; transacted_at?: string | null; tax_idr?: number; service_idr?: number; order_discount_idr?: number; cashback_idr?: number; tax_included?: number | boolean; paid_by_name?: string | null }; items: Array<{ id: number; name: string; price_idr: number; discount_idr?: number; quantity?: number; mode?: string; slot_count?: number | null }>; photos?: Array<{ path: string }> }): BillDraft { return { title: response.bill.title || "", merchant: response.bill.merchant || "", transacted_at: response.bill.transacted_at || "", items: response.items.map(item => ({ id: `server-${item.id}`, serverId: item.id, name: item.name, price: item.price_idr, discount: item.discount_idr || 0, quantity: Number(item.quantity || 1), mode: item.mode === "slot" ? "slot" : "free", slot_count: Number(item.slot_count || 2) })), order_discount: response.bill.order_discount_idr || 0, cashback: response.bill.cashback_idr || 0, tax: response.bill.tax_idr || 0, service: response.bill.service_idr || 0, tax_included: Boolean(response.bill.tax_included), paid_by_myself: true, paid_by_name: response.bill.paid_by_name || "", extra_names: [], picked_contacts: [], photos: response.photos?.map(photo => photo.path) || [] }; }
