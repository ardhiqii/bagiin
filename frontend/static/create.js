// ---------- Create bill ----------
/** Phones get camera/gallery/clipboard; desktops get file-picker/paste.
 *  (bug: desktop users were offered "Ambil Foto" and "Pilih dari Galeri" —
 *  two buttons that opened the exact same file dialog — and were told to
 *  long-press, while phone users were told to press Ctrl+V.) */
function isCoarsePointer() {
  try { return window.matchMedia("(pointer:coarse)").matches; } catch (e) { return false; }
}

// v62: source & scan are separate choices. The toggle decides whether the
// photo gets OCR'd (default on); Kamera/Upload/Paste decide where it comes from.
// Module-level so the global paste handlers honour the toggle too.
let scanMode = true;
let createFlowSession = 0;
function newCreateFlow() {
  createFlowSession += 1;
  scanMode = true;
  return createFlowSession;
}
// G2: scanMode is decided inside the photo-source sheet, but it governs the
// dropzone the user is looking at when they're NOT inside that sheet — with
// no hint on the dropzone itself, turning scanning off once meant the create
// screen looked identical and the next camera tap silently skipped OCR
// (bug: toggle state was invisible on the screen it actually affects).
function dzScanStateHtml() {
  return scanMode
    ? `${ic("check")}<span>Baca otomatis aktif — item &amp; harga langsung kebaca</span>`
    : `${ic("x")}<span>Baca otomatis nonaktif — item diisi manual</span>`;
}
function dzToggleDesc(scanMode) {
  return scanMode
    ? "Item & harga dibaca dari foto — langsung masuk ke daftar"
    : "Foto hanya ditempel — item & harga diisi manual";
}
function renderCreate(opts = {}) {
  if (!opts.preserveSession) newCreateFlow();
  const session = createFlowSession;
  const app = $("#app");
  const coarse = isCoarsePointer();
  const hint = coarse
    ? "Ketuk buat pilih kamera, galeri, atau tempel dari clipboard"
    : "Ketuk buat pilih file, tempel (Ctrl+V), atau tarik file ke sini";
  const errCard = opts.ocrError
    ? `<div class="warn-box">
         <div style="display:flex;gap:9px;align-items:flex-start;">
           <span style="color:var(--red);display:flex;">${ic("alert")}</span>
           <!-- this card only paints when /api/photos itself failed (uploadAndAttach's
                catch) — offline / rate-limit / >5MB. An OCR read failure never lands
                here: uploadAndOcr's catch falls through to uploadAndAttach, which
                re-uploads successfully and opens the manual editor instead (see the
                warn-box inside renderVerify for that case). "Gagal Baca Struk" named
                the wrong cause here (bug: headline blamed OCR for an upload failure).
                G3: "Coba Lagi" used to always retry via uploadAndOcr regardless of how
                this card was reached — a plain no-scan upload (scanMode off) that
                failed would silently retry WITH scanning on, overriding the toggle the
                user had just set (bug: retry named the wrong flow, not just the wrong
                title). opts.wasScan carries which flow actually failed. -->
           <div><strong>Gagal Upload Foto</strong>
             <p class="muted" style="margin-top:4px;">${esc(opts.ocrError)}</p></div>
         </div>
         <div class="btn-row" style="margin-top:12px;">
           <button class="btn-primary btn-sm" id="ocr-retry">${ic("refresh")} Coba Lagi</button>
           <button class="btn-outline btn-sm" id="ocr-manual">${ic("pencil")} Isi Manual</button>
         </div>
       </div>`
    : "";
  app.innerHTML = shell(`
    <div class="topbar">
      <button class="icon-btn" id="back-btn" aria-label="Kembali ke beranda">${ic("back")}</button>
      <div class="topbar-title">Buat Bill</div>
      <div style="width:42px;flex-shrink:0;" aria-hidden="true"></div>
    </div>
    <div id="create-body">
      ${errCard}
      <button type="button" class="dropzone" id="dz" style="width:100%;display:block;">
        <div class="dropzone-icon">${ic("camera")}</div>
        <div style="font-weight:700;font-size:16px;color:var(--text);">Scan struk otomatis</div>
        <div class="muted">Foto struk, lalu item dan harga dibaca otomatis</div>
        <div class="muted" style="margin-top:4px;">${hint}</div>
        <div class="muted" id="dz-scan-state" style="margin-top:8px;font-size:12.5px;display:flex;align-items:center;justify-content:center;gap:5px;">${dzScanStateHtml()}</div>
      </button>
      <input type="file" id="file-input" accept="image/*" class="hidden" tabindex="-1" aria-hidden="true">
      <button class="btn-outline" id="manual-btn" style="margin-top:12px;">${ic("pencil")} Isi manual tanpa scan</button>
    </div>`);
  watchDock();
  $("#back-btn").addEventListener("click", () => location.hash = "#/");

  const dz = $("#dz");
  const fileInput = $("#file-input");
  // v62 comment moved above — scanMode is module-level now so the global
  // paste handlers (pasteImageHandler, readClipboardImage) honour the toggle.
  const openPicker = (capture) => {
    fileInput.removeAttribute("capture");
    if (capture) fileInput.setAttribute("capture", "environment");
    fileInput.value = "";
    fileInput.click();
  };

  const handleImageFile = async (f) => {
    if (!f) return;
    if (!f.type || !f.type.startsWith("image/")) { toast("File harus gambar"); return; }
    if (f.size > 5 * 1024 * 1024) { toast("Foto maksimal 5MB"); return; }
    if (scanMode) await uploadAndOcr(f, session);
    else await uploadAndAttach(f, undefined, session);
  };

  dz.addEventListener("click", () => {
    // v62: pick WHERE the photo comes from (camera/gallery) and WHETHER it
    // gets scanned — two independent choices inside one sheet.
    const body = `
      <!-- scanMode is module-level and survives screen changes, so the switch
           has to be drawn from it. Hardcoding aria-checked="true" meant that
           after turning scanning off once, the sheet showed it ON while the
           camera still skipped OCR (bug: the toggle lied about its own state) -->
      <div class="tgl-row">
        <div>
          <div class="tgl-label">Baca Otomatis</div>
          <div class="muted tgl-desc" id="dz-tgl-desc">${dzToggleDesc(scanMode)}</div>
        </div>
        <button type="button" class="switch" id="dz-tgl" role="switch" aria-checked="${scanMode}" aria-label="Baca otomatis"></button>
      </div>
      <button class="src-btn btn-primary" id="dz-camera">
        <span class="src-main">${ic("camera")}<span>Kamera</span></span>
        <span class="muted">Ambil foto struk sekarang</span>
      </button>
      <button class="src-btn btn-outline" id="dz-upload">
        <span class="src-main">${ic("image")}<span>Upload Gambar</span></span>
        <span class="muted">Pilih foto dari galeri / file</span>
      </button>
      <button class="src-btn btn-outline" id="dz-paste">
        <span class="src-main">${ic("clipboard")}<span>Tempel dari Clipboard</span></span>
        <span class="muted">Screenshot / gambar struk yang disalin</span>
      </button>
      <button class="btn-ghost" id="dz-cancel">Batal</button>`;
    const s = openSheet(`
      <div class="sheet-handle"></div>
      <div class="sheet-title">Foto Struk</div>
      <p class="sheet-sub">Pilih sumber fotonya. Scan otomatis aktif secara default; matikan kalau mau mengisi item sendiri.</p>
      ${body}`, { noAutofocus: true });
    const tgl = s.sheet.querySelector("#dz-tgl");
    const tglDesc = s.sheet.querySelector("#dz-tgl-desc");
    if (tgl) tgl.addEventListener("click", () => {
      scanMode = !scanMode;
      tgl.setAttribute("aria-checked", String(scanMode));
      tglDesc.textContent = dzToggleDesc(scanMode);
      // the dropzone underneath this sheet must reflect the flip immediately
      // — the sheet closes back onto it, not onto a fresh render
      const dzState = document.getElementById("dz-scan-state");
      if (dzState) dzState.innerHTML = dzScanStateHtml();
    });
    const cameraBtn = s.sheet.querySelector("#dz-camera");
    if (cameraBtn) cameraBtn.addEventListener("click", () => { s.close(); openPicker(true); });
    const uploadBtn = s.sheet.querySelector("#dz-upload");
    if (uploadBtn) uploadBtn.addEventListener("click", () => { s.close(); openPicker(false); });
    const pasteBtn = s.sheet.querySelector("#dz-paste");
    if (pasteBtn) pasteBtn.addEventListener("click", () => { s.close(); readClipboardImage(); });
    const cancelBtn = s.sheet.querySelector("#dz-cancel");
    if (cancelBtn) cancelBtn.addEventListener("click", s.close);
  });

  // drag & drop a photo onto the dropzone
  ["dragenter", "dragover"].forEach(ev => dz.addEventListener(ev, e => {
    e.preventDefault();
    dz.classList.add("dragover");
  }));
  ["dragleave", "drop"].forEach(ev => dz.addEventListener(ev, e => {
    e.preventDefault();
    dz.classList.remove("dragover");
  }));
  dz.addEventListener("drop", e => {
    const f = (e.dataTransfer && e.dataTransfer.files) ? e.dataTransfer.files[0] : null;
    if (!f) return;
    // dropped files respect the sheet's toggle — no separate choice here
    handleImageFile(f);
  });
  fileInput.addEventListener("change", async () => {
    await handleImageFile(fileInput.files[0]);
  });

  $("#manual-btn").addEventListener("click", () => renderVerify(blankBillForVerify(), true));
  if (opts.ocrError) {
    $("#ocr-retry").addEventListener("click", () => {
      if (!opts.ocrFile) { renderCreate({ preserveSession: true }); return; }
      // retry the SAME flow that failed: if this was the OCR-fallback upload
      // (uploadAndOcr's catch, re-uploading after a scan failure) go back
      // through OCR; if this was a plain no-scan upload, retry the plain
      // upload — see the G3 comment on the card above
      if (opts.wasScan) uploadAndOcr(opts.ocrFile, session);
      else uploadAndAttach(opts.ocrFile, undefined, session);
    });
    $("#ocr-manual").addEventListener("click", () => renderVerify(blankBillForVerify(), true));
  }
}

// v61: upload a photo WITHOUT scanning — it gets attached to the bill and
// the user fills items by hand. OCR failure also lands here (photo kept,
// items manual) instead of throwing the photo away.
// `ocrReason`, when set, is why OCR failed upstream (see uploadAndOcr's
// catch) — carried through so the manual editor that opens can explain
// itself instead of just appearing blank with no context.
async function uploadAndAttach(file, ocrReason, session = createFlowSession, preserved = null) {
  const body = $("#create-body");
  if (body) {
    body.innerHTML = `<div class="card" style="text-align:center;padding:40px 16px;">
      <div class="spinner" style="width:32px;height:32px;border-width:3px;"></div>
      <p style="margin-top:16px;font-weight:600;">Ngirim fotonya...</p>
    </div>`;
  }
  const routeAtStart = location.hash;
  try {
    const fd = new FormData();
    fd.append("file", file);
    const result = await api("/api/photos", { method: "POST", body: fd });
    if (location.hash !== routeAtStart || session !== createFlowSession) return;
    // keep the photo; items are filled manually
    renderVerify({ ...blankBillForVerify(), ...(preserved || {}), photos: [result.photo_path],
      ocrError: ocrReason || null, ocrRetryFile: ocrReason ? file : null }, true);
  } catch (e) {
    if (location.hash !== routeAtStart || session !== createFlowSession) return;
    // ocrReason set = this call came from uploadAndOcr's catch (scan failed,
    // now the plain re-upload failed too); unset = this was always a plain
    // no-scan upload. wasScan tells the retry button which flow to resume.
    renderCreate({ ocrError: e.message, ocrFile: file, wasScan: !!ocrReason, preserveSession: true });
  }
}

function blankBillForVerify() {
  // one empty row, not zero: a manual bill always needs at least one item, and
  // an empty card under a paragraph explaining "Bebas vs Slot" is an
  // explanation with nothing to point at
  return { items: [{ name: "", price: 0, quantity: 1, mode: "free" }], subtotal: 0, tax: 0,
           service: 0, total: 0, photo_path: null, merchant: "", date: "", photos: [] };
}

// attach a photo to the MANUAL verify screen (upload now, path carried into the
// bill on submit) — separate from uploadAndAttach because that one re-renders a
// blank verify with a single photo; here we must preserve every field the user
// already typed and push onto the existing photos array.
async function verifyAttachPhoto(file) {
  if (file.size > 5 * 1024 * 1024) { toast("Foto maksimal 5MB"); return; }
  // the button was looked up and never used, so a Ctrl+V on the editor spent
  // several silent seconds uploading and a second paste queued a duplicate
  const btn = $("#verify-add-photo");
  const routeAtStart = location.hash;
  const session = createFlowSession;
  const fd = new FormData();
  fd.append("file", file);
  const upload = async () => {
    try {
      const result = await api("/api/photos", { method: "POST", body: fd });
      if (location.hash !== routeAtStart || session !== createFlowSession) return;
      const next = { ...verifyState, photos: [...verifyState.photos, result.photo_path] };
      next.photo_path = next.photos[0] || null;
      renderVerify(next, verifyState.manual);
    } catch (e) {
      toast(e.message);
    }
  };
  if (btn) return withBusy(btn, "Upload...", upload);
  toast("Upload foto...");
  return upload();
}

// v67: release a photo the user attached and then threw away before the bill
// ever existed — DELETE /api/photos/{filename} (backend/main.py) unlinks the
// orphaned upload. `verifyState.photos` holds the full path /api/photos and
// /api/ocr hand back (e.g. "/var/www/bagiin-uploads/<hex>.jpg"); the endpoint
// takes the bare filename, so strip the path the same way the <img> preview
// already does. Best-effort and silent — the user asked to remove a
// thumbnail (or walked away from the whole editor), and a server hiccup
// cleaning up a stray file on disk is not their problem; log, never toast.
// Never call this for a photo that belongs to a SAVED bill — bill.js has its
// own DELETE /api/bills/{id}/photos/{id} for those, and this endpoint
// refuses (409) anything a bill still references anyway.
function releaseAbandonedPhoto(path) {
  if (!path) return;
  const filename = String(path).split("/").pop();
  if (!filename) return;
  api(`/api/photos/${filename}`, { method: "DELETE" })
    .catch(e => console.warn("releaseAbandonedPhoto: gagal hapus " + filename, e));
}
function releaseAbandonedPhotos(paths) {
  (paths || []).forEach(releaseAbandonedPhoto);
}

async function uploadAndOcr(file, session = createFlowSession, preserved = null) {
  const body = $("#create-body");
  if (body) {
    body.innerHTML = `<div class="card" style="text-align:center;padding:40px 16px;">
      <div class="spinner" style="width:32px;height:32px;border-width:3px;"></div>
      <p style="margin-top:16px;font-weight:600;">Lagi baca struknya...</p>
      <p class="muted">Biasanya hanya butuh beberapa detik</p>
    </div>`;
  }
  // OCR takes seconds; if the user navigates away meanwhile, the verify editor
  // used to paint itself over whatever screen they'd moved to (bug: mirrors the
  // state.currentBillId guard in bill.js — bail when the route changed).
  const routeAtStart = location.hash;
  try {
    const fd = new FormData();
    fd.append("file", file);
    const result = await api("/api/ocr", { method: "POST", body: fd });
    if (location.hash !== routeAtStart || session !== createFlowSession) return;
    renderVerify(preserved ? { ...result, ...preserved, photos: result.photos || (result.photo_path ? [result.photo_path] : []) } : result);
  } catch (e) {
    if (location.hash !== routeAtStart || session !== createFlowSession) return;
    // v61: OCR failed — keep the photo anyway and drop into the manual
    // editor with it attached (before, the photo was thrown away and the
    // user had to re-pick it on the create screen). The reason used to only
    // go out as a toast, started before the extra /api/photos round-trip
    // below even began — by the time the (blank-looking) form appeared, the
    // 2.6s toast had usually already expired and nobody knew why they were
    // suddenly looking at "Isi Manual" (bug). Carry it into the editor
    // instead, where it can't disappear before it's read.
    await uploadAndAttach(file, e.message, session, preserved);
  }
}

// ---------- Clipboard paste (Ctrl+V on desktop, paste menu on mobile) ----------

// Global paste listener — only acts when the create screen dropzone is mounted,
// so pasting an image elsewhere (notes, chat input) is never hijacked.
function pasteImageHandler(e) {
  const items = (e.clipboardData && e.clipboardData.items) || [];
  for (const it of items) {
    if (it.kind === "file" && it.type && it.type.startsWith("image/")) {
      const f = it.getAsFile();
      if (!f) continue;
      e.preventDefault();
      if (f.size > 5 * 1024 * 1024) { toast("Foto maksimal 5MB"); return; }
      // manual verify screen has its own photo row — attach there too, not
      // just the dropzone (user pasted a screenshot while filling the form)
      if (document.getElementById("verify-add-photo")) { verifyAttachPhoto(f); return; }
      if (!document.getElementById("dz")) {
        // create screen is mid-OCR (dropzone replaced by the spinner) or the
        // screen changed; don't hijack paste elsewhere, but don't swallow it
        // silently on the create flow (bug: paste during "Lagi baca struknya"
        // did nothing, no feedback)
        if (document.getElementById("create-body")) toast("Masih diproses — tunggu bentar");
        return;
      }
      if (scanMode) uploadAndOcr(f);
      else uploadAndAttach(f);
      return;
    }
  }
}
if (!window.__bagiinPasteBound) {
  window.__bagiinPasteBound = true;
  document.addEventListener("paste", pasteImageHandler);
}

// Explicit "Tempel dari Clipboard" for mobile where navigator.clipboard.read
// is supported (Android Chrome, iOS Safari 16.4+). Falls back to instructing
// the user to paste directly (long-press -> Paste) which fires the paste event.
async function readClipboardImage() {
  try {
    if (!navigator.clipboard || !navigator.clipboard.read) {
      toast(isCoarsePointer()
        ? "Browser kamu tidak bisa baca clipboard — long-press terus pilih Paste"
        : "Browser kamu tidak bisa baca clipboard — tekan Ctrl+V aja");
      return;
    }
    const items = await navigator.clipboard.read();
    for (const it of items) {
      const imgType = it.types.find(t => t.startsWith("image/"));
      if (!imgType) continue;
      const blob = await it.getType(imgType);
      const f = new File([blob], "clipboard-image.png", { type: blob.type });
      if (f.size > 5 * 1024 * 1024) { toast("Foto maksimal 5MB"); return; }
      if (document.getElementById("verify-add-photo")) { await verifyAttachPhoto(f); return; }
      if (scanMode) await uploadAndOcr(f);
      else await uploadAndAttach(f);
      return;
    }
    toast("Clipboard kamu tidak ada gambarnya");
  } catch (e) {
    // a raw DOMException string ("NotAllowedError: ...") spliced into
    // Indonesian copy helps nobody — say what to do instead
    toast("Tidak bisa membaca clipboard. Coba tempel menggunakan Ctrl+V ya");
  }
}

// ---------- Verify OCR result ----------
let __photoLayerActive = false;
let __photoLayerConsumeNextPop = false;

function collapseExpandedPhoto(fromHistory = false) {
  const expanded = document.querySelector(".vf-photo-wrap .photo-preview.expanded");
  if (expanded) expanded.classList.remove("expanded");
  if (!__photoLayerActive) return;
  __photoLayerActive = false;
  if (fromHistory) {
    __photoLayerConsumeNextPop = false;
    window.removeEventListener("popstate", __photoLayerPopstate);
    return;
  }
  // UI close: consume the same-URL sentinel without allowing it to reach the router.
  __photoLayerConsumeNextPop = true;
  try { history.back(); } catch (e) {
    __photoLayerConsumeNextPop = false;
    window.removeEventListener("popstate", __photoLayerPopstate);
  }
}

function __photoLayerPopstate() {
  if (__photoLayerConsumeNextPop) {
    __photoLayerConsumeNextPop = false;
    window.removeEventListener("popstate", __photoLayerPopstate);
    return;
  }
  collapseExpandedPhoto(true);
}

function expandPhoto(img) {
  if (__photoLayerActive) {
    // A re-render can replace the node while its sentinel is still live.
    img.classList.add("expanded");
    return;
  }
  img.classList.add("expanded");
  try { history.pushState({ bagiinPhoto: true }, ""); } catch (e) {}
  __photoLayerActive = true;
  window.addEventListener("popstate", __photoLayerPopstate);
}

let verifyState = {
  items: [], subtotal: 0, tax: 0, service: 0, total: 0, photo_path: null,
  title: "", merchant: "", transacted_at: "", manual: false, paid_by_name: null,
  tax_included: false, taxSaved: 0,
  // people invited from the create screen: kontak = proven contacts with
  // identity ids (chained into /invite after the bill exists); extraNames =
  // free-typed names with no identity (sent as legacy participant placeholders)
  participants: [], extraNames: [],
};

// Leaving this screen throws away every correction the user typed, so ask
// first when there is anything to lose (bug: one stray back tap and a whole
// re-typed receipt was gone). Global (not a closure inside renderVerify) so
// app.js's router-level leave-guard can call it too — it protects the
// browser/system Back path, not just the in-app back button.
// Was title/tax/service/items only — attaching photos, picking a date,
// naming a payer or picking participants all vanished silently too (bug:
// under-counted what "typed content" meant).
function verifyHasTypedContent() {
  return !!(String(verifyState.title || "").trim() ||
    verifyState.tax || verifyState.service ||
    verifyState.transacted_at ||
    (verifyState.photos || []).length ||
    (!verifyState.paidByMyself && String(verifyState.paid_by_name || "").trim()) ||
    (verifyState.participants || []).length ||
    (verifyState.extraNames || []).length ||
    (verifyState.items || []).some(i =>
      String(i.name || "").trim() || (i.price || 0) > 0 || (i.discount || 0) > 0));
}
function confirmDiscardVerify() {
  return confirmSheet({
    title: "Buang isian ini?",
    body: "Semua yang sudah kamu ketik di sini — item, harga, judul — akan terhapus.",
    confirmText: "Buang aja", cancelText: "Lanjut isi", danger: true,
  });
}

/* Layout rules that only this screen needs. Injected with the screen markup so
   there is no build step and nothing leaks to other screens.
   - .vf-item: the row used to be flex-wrap, so under ~360px the ✕ wrapped
     underneath the name and the row scrambled (bug: unusable on small phones).
   - .vf-grid: Subtotal/PPN/Service side by side is unreadable under ~380px,
     so Subtotal takes its own line and PPN/Service share the next one. */
const VERIFY_CSS = `<style>
  /* Fixed mobile dock reservation: keep the final controls reachable. */
  #app:has(#create-bill-btn) { padding-bottom:calc(124px + env(safe-area-inset-bottom)); scroll-padding-bottom:calc(124px + env(safe-area-inset-bottom)); }
  .vf-item { display:grid; grid-template-columns:minmax(0,1fr) minmax(130px,1.25fr) 44px; gap:8px; align-items:center;
             padding:12px 2px; border-bottom:1px solid var(--border); }
  /* "Nasi Goreng Spesial" in a 1fr column next to a 110px price box reads
     "Nasi Goreng Spe:" — give the name the whole width on a phone */
  @media (max-width:430px) {
    .vf-item { grid-template-columns:1fr 44px; }
    .vf-item [data-role=name] { grid-column:1 / -1; }
    .vf-item .vf-price { grid-column:1 / -1; }
    /* the price cell is label-on-top-of-input (64px) while the trash is a
       bare 44px box — align-items:center centered the trash on the CELL,
       10px above the input's center (user: "gk sejajar"). Bottom-aligning
       the 44px button makes its box coincide with the input's box, since
       the input is the last element in the wrap. Desktop hides the label
       (≥1040px) so centering is correct there and stays untouched. */
    .vf-item [data-role=del] { align-self:end; }
  }
  /* 431-1039px (small-zoom phones / tablets / narrow windows): the 3-column
     grid keeps the Harga label stacked on the input (64px cell) while name
     and trash are bare 44px boxes — center alignment put the price input
     ~10px BELOW both (user device sits in this range: "di gw masih").
     Bottom-aligning the row coincides all three boxes on the input's
     bottom edge; the label reads as a mini column header. >=1040 hides the
     label and shows vf-head, where plain centering is correct. */
  @media (min-width:431px) and (max-width:1039px) {
    .vf-item { align-items:end; }
  }
  .vf-item:last-child { border-bottom:none; }
  .vf-item input { padding:9px 10px; }
  .vf-item .icon-btn { width:44px; height:44px; min-width:44px; min-height:44px; }
  .vf-full { grid-column:1 / -1; }
  .vf-price { min-width:0; }
  .vf-qty { display:flex; align-items:center; gap:4px; margin-top:5px; }
  .vf-qty-label { font-size:11.5px; color:var(--text-3); white-space:nowrap; }
  .vf-qty button { width:44px; height:44px; min-width:44px; padding:0; }
  .vf-qty input { width:48px; height:44px; padding:8px 4px; text-align:center; }
  .vf-line-total { display:block; margin-top:3px; font-size:12px; color:var(--text-2); }
  /* discount box: label + input + optional "→ bayar X" result, wrapping as
     one unit on a phone — moved out of an inline style so the desktop rule
     below (L3) can restyle just this wrapper without fighting specificity */
  /* the column header only makes sense next to the compact desktop grid */
  .vf-head { display:none; }
  .vf-mobile-label { display:block; font-size:11.5px; font-weight:600; color:var(--text-3); margin:0 0 3px; }
  .vf-discount { display:block; }
  .vf-discount-fields { display:flex; align-items:center; gap:8px; min-width:0; }
  .vf-discount input { max-width:110px; }
  .disc-bayar { color:var(--green); font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-width:0; }
  .vf-mode-label { display:block; margin-bottom:5px; }
  .vf-mode-options { display:flex; flex-wrap:nowrap; align-items:center; gap:6px; min-width:0; }
  .vf-mode-options .item-mode-btn { flex:0 1 auto; white-space:nowrap; }
  .vf-mode-options > span { margin-left:auto; }
  .vf-grid { display:grid; grid-template-columns:repeat(3, minmax(0,1fr)); gap:8px; }
  .vf-grid > .vf-sub { grid-column:1 / -1; }
  .progressive-section { overflow:hidden; }
  .progressive-section > summary { cursor:pointer; list-style:none; }
  .progressive-section > summary::-webkit-details-marker { display:none; }
  .progressive-section > summary::after { content:"＋"; float:right; color:var(--text-3); font-weight:700; }
  .progressive-section[open] > summary::after { content:"−"; }
  .progressive-section > summary + * { margin-top:12px; }
  .vf-photos { display:grid; grid-template-columns:repeat(3, minmax(0,1fr)); gap:8px; }
  .vf-photo-actions { display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); gap:8px; margin-top:8px; }
  .vf-photo-actions > button { width:100%; margin-top:0 !important; }
  .vf-photo-actions > p { grid-column:1 / -1; margin:0; text-align:left; line-height:1.25; }
  .vf-photo-wrap { position:relative; }
  .vf-photo-wrap .photo-preview { width:100%; height:110px; object-fit:cover; border-radius:var(--r-xs); display:block; }
  .vf-photo-wrap .photo-preview.expanded { position:fixed; inset:0; z-index:60; width:100%; height:100%;
    object-fit:contain; background:rgba(0,0,0,.86); border-radius:0; }
  .vf-photo-del { position:absolute; top:4px; right:4px; width:44px; height:44px; min-width:44px; min-height:44px; padding:0;
    border-radius:var(--r-full); background:rgba(0,0,0,.62); color:#fff; border:none; display:flex;
    align-items:center; justify-content:center; }
  @media (max-width:399px) {
    .vf-grid { grid-template-columns:repeat(2, minmax(0,1fr)); }
    .vf-grid > .vf-sub { grid-column:1 / -1; }
    .vf-photos { grid-template-columns:repeat(2, minmax(0,1fr)); }
  }
  @media (min-width:720px) {
    #app:has(#create-bill-btn) { padding-bottom:56px; scroll-padding-bottom:56px; }
  }
  /* Same 44px floor as .vf-item .icon-btn above, applied consistently: the
     slot +/- steppers were 37x27 and 34x32 (mismatched with each other, both
     under the floor), the Bebas/Slot mode chips were 32px tall, and the
     add-item / paste-from-clipboard buttons were 38px — small enough that a
     thumb missed them (see the identical bug noted on .list-chip-row .chip-btn
     in index.html: under the floor next to full-size controls reads as broken,
     not smaller). .chip-btn's own rule (index.html) has no min-height at all,
     so every place it's used inside this screen needs it re-asserted here. */
  .item-mode-btn, .slot-dec, .slot-inc { min-height:44px; min-width:44px; justify-content:center; }
  #add-item-btn, #verify-paste-photo, #verify-add-photo { min-height:44px; }
  .people-empty-action { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
  .people-empty-action .btn-sm { min-height:44px; flex:0 0 auto; }
  #create-bill-helper { margin:0; font-size:12px; line-height:1.25; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:var(--text-3); }

  /* L3 (v68, desktop only): the editor gets denser instead of wider. Nothing
     here touches markup order in the DOM — .vf-item stays a CSS grid and
     the "order" property does the reflow — so the phone layout above is
     untouched byte for byte. */
  @media (min-width:1040px) {
    .vf-price .vf-mobile-label { display:none; }
    /* Judul Bill + Tanggal Transaksi share a row instead of each claiming
       the full (now much narrower) card width on its own line */
    .vf-field-pair { display:flex; gap:16px; align-items:flex-start; }
    .vf-field-pair > .field { flex:1; min-width:0; margin-bottom:0; }

    /* name | harga | potongan | delete on ONE line — the discount box used
       to drop to its own row and leave ~700px empty next to a 110px input */
    .vf-item { grid-template-columns:minmax(0,1fr) minmax(130px,150px) minmax(112px,130px) 44px; }
    .vf-item .vf-discount { order:2; grid-column:auto; }
    .vf-item .vf-discount-fields { flex-direction:column; align-items:stretch; gap:2px; }
    .vf-item .vf-discount input { max-width:none; }
    /* keep the label for screen readers (it's still the input's <label for>)
       but out of the compact column visually — display:none would drop it
       from the accessibility tree too, not just from view */
    .vf-item .vf-discount-label {
      position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden;
      clip:rect(0 0 0 0); white-space:nowrap; border:0;
    }
    .vf-item .disc-bayar { font-size:11px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .vf-head { display:grid; grid-template-columns:minmax(0,1fr) minmax(130px,150px) minmax(112px,130px) 44px; gap:8px;
               padding:0 2px 2px; font-size:11.5px; font-weight:600;
               color:var(--text-3); letter-spacing:.02em; }
    .vf-head span:nth-child(2), .vf-head span:nth-child(3) { text-align:right; }
    .vf-item [data-role="del"] { order:3; }
    /* Cara Bagi stays on its own line (unchanged in spirit, just after the
       four fields above instead of wherever DOM order would put it) */
    .vf-item .vf-mode { order:4; }
  }
  @media (min-width:1040px) and (max-width:1199px) {
    /* The shell gives this card less room at medium desktop widths. Keep the
       two metadata fields readable without changing the phone layout. */
    .vf-field-pair { gap:12px; }
    .vf-item { grid-template-columns:minmax(0,1fr) minmax(116px,132px) minmax(104px,120px) 44px; }
    .vf-head { grid-template-columns:minmax(0,1fr) minmax(116px,132px) minmax(104px,120px) 44px; }
  }
</style>`;

function normalizeTransactionDate(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})/);
  if (!match) return "";
  const candidate = `${match[1]}-${match[2]}-${match[3]}`;
  const d = new Date(`${candidate}T12:00:00`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === candidate ? candidate : "";
}

function validQuantity(value) {
  return /^(?:[1-9]|[1-9][0-9])$/.test(String(value ?? "")) ? Number(value) : null;
}

function itemQuantity(it) {
  return validQuantity(it.quantity) || 1;
}

function renderVerify(ocr, manual = false) {
  // v61: photos is an array now; legacy single photo_path folds in so OCR
  // results (which still carry photo_path) keep working
  const photos = Array.isArray(ocr.photos) ? ocr.photos.slice()
    : (ocr.photo_path ? [ocr.photo_path] : []);
  verifyState = {
        items: (ocr.items || []).map(i => {
          const quantity = validQuantity(i.quantity);
          return { ...i, quantity: quantity || 1, quantityDraft: quantity ? null : (i.quantity == null ? null : String(i.quantity)) };
        }),
        subtotal: ocr.subtotal || 0,
        tax: ocr.tax || 0,
        service: ocr.service || 0,
        total: ocr.total || 0,
        photo_path: photos[0] || null,
        photos,
        title: ocr.title || ocr.merchant || "",
        merchant: ocr.merchant || "",
        transacted_at: normalizeTransactionDate(ocr.transacted_at || ocr.date || ""),
        manual,
        paid_by_name: (ocr && ocr.paid_by_name) || null,
        // explicit flag: re-renders (photo add/remove/paste) rebuild the whole
        // state object, and reading "paid by me" off `paid_by_name` truthiness
        // silently flipped an un-checked "Aku yang bayar" back to checked —
        // the bill got recorded as paid-by-self even when the user picked
        // someone else and typed a name (bug: state reset on re-render)
        paidByMyself: (ocr && typeof ocr.paidByMyself === "boolean")
          ? ocr.paidByMyself
          : ((ocr && ocr.paid_by_name) == null),
        tax_included: !!(ocr.tax_included),
        // last PPN the user typed, so switching "termasuk pajak" off can put it
        // back (see the toggle handler). Every re-render (add/remove photo,
        // paste) feeds verifyState back through here — reading only `tax` lost
        // the saved number whenever "termasuk pajak" was on, because that
        // forces tax to 0 (bug: PPN vanished after attaching a photo)
        taxSaved: (ocr && typeof ocr.taxSaved === "number") ? ocr.taxSaved : (ocr.tax || 0),
        participants: (ocr && ocr.participants) || [],
        extraNames: (ocr && ocr.extraNames) || [],
        // why OCR failed, if that's how we got here (see uploadAndOcr's catch
        // and uploadAndAttach) — carried across re-renders (photo add/remove)
        // the same way every other field here is, by reading it off `ocr`.
        ocrError: (ocr && ocr.ocrError) || null,
        ocrRetryFile: (ocr && ocr.ocrRetryFile) || null,
      };
  // subtotal auto-follows the item sum UNLESS the user explicitly typed their
  // own subtotal. For OCR: when the receipt's subtotal differs from the items
  // (LLM missed an item line), keep the receipt value & show the warning —
  // otherwise let it follow the items so editing a price updates the total.
  const _sumItems = (verifyState.items || []).reduce((s, i) => s + Math.max(0, (i.price || 0) - (i.discount || 0)) * itemQuantity(i), 0);
  // preserve the user's "I typed this" flag across re-renders instead of
  // recomputing it — recomputing made a typed subtotal that happened to equal
  // the item sum silently switch back to auto-follow (bug: user input ignored)
  verifyState.subtotalTouched = (ocr && typeof ocr.subtotalTouched === "boolean")
    ? ocr.subtotalTouched
    : (!manual && _sumItems !== (verifyState.subtotal || 0));

  const main = `
    ${VERIFY_CSS}
    <div class="topbar">
      <button class="icon-btn" id="back-btn" aria-label="Kembali">${ic("back")}</button>
      <div class="topbar-title">${manual ? "Isi Manual" : "Periksa Hasil"}</div>
      <div style="width:42px;flex-shrink:0;" aria-hidden="true"></div>
    </div>
    ${verifyState.photos.length ? `
    <div class="card" style="padding:8px;">
      <div class="vf-photos">
        ${verifyState.photos.map((p, i) => `
        <div class="vf-photo-wrap">
          <img class="photo-preview" src="/uploads/${esc(p.split("/").pop())}" alt="Foto struk ${i + 1}" loading="lazy" data-idx="${i}">
          <button class="vf-photo-del" data-idx="${i}" aria-label="Hapus foto ${i + 1}">${ic("x")}</button>
        </div>`).join("")}
      </div>
      <div class="vf-photo-actions">
        <button class="btn-outline btn-sm" id="verify-add-photo">${ic("camera")} Tambah Foto</button>
        <button class="btn-outline btn-sm" id="verify-paste-photo">${ic("clipboard")} Tempel</button>
        <p class="muted">Ketuk foto untuk memperbesar.</p>
      </div>
    </div>` : (manual ? `
    <div class="card" style="padding:8px;">
      <button class="btn-outline" id="verify-add-photo" style="width:100%;">${ic("camera")} Tambah Foto Struk</button>
      <button class="btn-outline" id="verify-paste-photo" style="width:100%;margin-top:8px;">${ic("clipboard")} Tempel dari Clipboard</button>
      <p class="muted" style="text-align:center;margin-top:6px;">Opsional — foto hanya dilampirkan, tidak dibaca otomatis.</p>
    </div>` : "")}

    <div class="card">
      <div class="card-title"><span>Detail Bill</span></div>
      <div class="vf-field-pair">
        <div class="field">
          <label for="title-input">Judul Bill</label>
          <input id="title-input" placeholder="Contoh: Makan Sushi" value="${esc(verifyState.title)}" maxlength="60">
          ${!manual && verifyState.merchant ? `<p class="muted" style="margin-top:5px;">Dibaca dari struk: ${esc(verifyState.merchant)}</p>` : ""}
        </div>
        <div class="field" style="margin-bottom:0;">
          <label for="date-input">Tanggal Transaksi</label>
          <input type="date" id="date-input" value="${esc(verifyState.transacted_at)}">
        </div>
      </div>
    </div>

    ${verifyState.ocrError ? `
    <div class="warn-box">
      <div style="display:flex;gap:9px;align-items:flex-start;">
        <span style="color:var(--red);display:flex;">${ic("alert")}</span>
        <div><strong>Struknya Gagal Dibaca Otomatis</strong>
          <p class="muted" style="margin-top:4px;">${esc(verifyState.ocrError)}</p>
          <p class="muted" style="margin-top:4px;">Foto tersimpan — isi secara manual di bawah, atau coba baca otomatis lagi.</p></div>
      </div>
      ${verifyState.ocrRetryFile ? `
      <div class="btn-row" style="margin-top:12px;">
        <button class="btn-outline btn-sm" id="verify-retry-scan">${ic("refresh")} Coba Scan Lagi</button>
      </div>` : ""}
    </div>` : ""}

    <div class="card" id="items-card">
      <div class="card-title">
        <span>Item</span>
        <span class="muted">${manual ? "Ketik item &amp; harganya" : "cek ulang, edit kalau salah"}</span>
      </div>
      <div class="info-box" style="margin:0 0 10px;">Mulai dari <strong>item dan total</strong>. Pastikan keduanya cocok sebelum lanjut; cara bagi tiap item bisa diatur di bawah.</div>
      ${/* desktop packs name/harga/potongan onto one line, which left two
            identical "0" boxes with the discount's label visually clipped —
            you could not tell which box was which. A column header restores
            that, and only exists where the compact grid does. */ ""}
      <div class="vf-head" role="presentation"><span>Nama item</span><span>Harga</span><span>Potongan</span><span></span></div>
      <div id="items-list"></div>
      <button class="btn-outline btn-sm" id="add-item-btn" style="width:100%;margin-top:10px;">${ic("plus")} Tambah Item</button>
      <div id="sum-warn" class="error-text hidden" style="margin-top:8px;"></div>
    </div>

    <div class="card">
      <div class="card-title"><span>Rincian Biaya</span></div>
      <div class="vf-grid">
        <div class="vf-sub">
          <label for="subtotal-input">Subtotal (Rp)</label>
          <input class="input-money" type="text" inputmode="numeric" id="subtotal-input" placeholder="0" maxlength="16" value="${rupiahFmt(verifyState.subtotal)}">
        </div>
      </div>
      <details class="progressive-section" ${verifyState.tax || verifyState.service || verifyState.tax_included ? "open" : ""}>
        <summary class="label-strong">PPN &amp; service <span class="muted">(opsional)</span></summary>
        <div class="vf-grid">
          <div>
            <label for="tax-input">PPN (Rp)</label>
            <input class="input-money" type="text" inputmode="numeric" id="tax-input" placeholder="0" maxlength="16" value="${rupiahFmt(verifyState.tax)}">
          </div>
          <div>
            <label for="service-input">Service (Rp)</label>
            <input class="input-money" type="text" inputmode="numeric" id="service-input" placeholder="0" maxlength="16" value="${rupiahFmt(verifyState.service)}">
          </div>
        </div>
        <label class="toggle-row" for="tax-included-toggle" style="margin-top:10px;">
          <span style="flex:1;">
            <span class="label-strong">Harga item sudah termasuk pajak</span>
            <span class="muted" style="display:block;">Angka item yang kamu isi SUDAH termasuk PPN — PPN tidak dihitung ulang dari total.</span>
          </span>
          <input type="checkbox" id="tax-included-toggle" ${verifyState.tax_included ? "checked" : ""}>
        </label>
        <div id="tax-included-badge" class="info-box ${verifyState.tax_included ? "" : "hidden"}"
             style="margin:8px 0 0;display:flex;gap:8px;align-items:flex-start;">
          ${ic("info")}<span>Total = subtotal + service aja — PPN sudah masuk di harga item</span>
        </div>
      </details>

    </div>

    <div class="card">
      <div class="card-title"><span>Yang Bayar</span></div>
      <div role="radiogroup" aria-label="Pilih yang membayar" style="display:grid;gap:8px;">
        <label class="account-row" for="paid-by-myself-choice" style="cursor:pointer;border:1px solid var(--border);border-radius:var(--r-sm);padding:12px;">
          <input type="radio" id="paid-by-myself-choice" name="payer-choice" value="me" ${verifyState.paidByMyself ? "checked" : ""}>
          <span style="flex:1;"><strong>Aku yang bayar</strong><span class="muted" style="display:block;">Aku yang nalangin.</span></span>
        </label>
        <label class="account-row" for="paid-by-other-choice" style="cursor:pointer;border:1px solid var(--border);border-radius:var(--r-sm);padding:12px;">
          <input type="radio" id="paid-by-other-choice" name="payer-choice" value="other" ${verifyState.paidByMyself ? "" : "checked"}>
          <span style="flex:1;"><strong>Orang lain yang bayar</strong><span class="muted" style="display:block;">Tulis nama orang yang nalangin.</span></span>
        </label>
      </div>
      <input type="checkbox" id="paid-by-me" class="hidden" ${verifyState.paidByMyself ? "checked" : ""} aria-hidden="true" tabindex="-1">
      <div id="paid-by-other" class="${verifyState.paidByMyself ? "hidden" : ""}" style="margin-top:10px;">
        <label for="paid-by-name-input">Nama Yang Bayar</label>
        <input id="paid-by-name-input" placeholder="Contoh: Budi" value="${esc(verifyState.paid_by_name || "")}" maxlength="30" autocomplete="off">
        <p id="paid-by-name-error" class="error-text ${verifyState.paidByMyself || String(verifyState.paid_by_name || "").trim() ? "hidden" : ""}" style="margin-top:5px;">Tulis nama orang yang bayar.</p>
      </div>
    </div>

    <details class="card progressive-section">
      <summary class="card-title"><span>Siapa yang Ikut</span><span class="muted">(opsional)</span></summary>
      <p class="muted" style="margin:-4px 0 10px;">Pilih kontak atau tambahkan nama. Mereka bisa diundang lagi nanti.</p>
      <div id="people-pick" style="display:flex;flex-direction:column;gap:6px;"></div>
      <div style="display:flex;gap:8px;margin-top:10px;">
        <input id="person-name-input" placeholder="Nama lainnya (opsional)" maxlength="30" autocomplete="off" style="flex:1;">
        <button class="btn-outline btn-sm" id="person-name-add" style="flex-shrink:0;">${ic("plus")} Tambah</button>
      </div>
      <div id="people-chips" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;"></div>
    </details>`;

  const side = `
    <div class="dock"><div class="dock-inner">
      <div class="dock-total">
        <span class="label-sm">Total</span>
        <span class="money" id="total-display">${fmt(verifyState.total)}</span>
      </div>
      <button class="btn-primary" id="create-bill-btn" disabled>Buat Tagihan</button>
      <p id="create-bill-helper" aria-live="polite">Isi nama item dan total untuk lanjut.</p>
    </div></div>`;

  $("#app").innerHTML = shell(main, side);
  watchDock();

  // #/create/verify is this screen's own route (see render() in app.js) —
  // give it one on entry so the leave-guard below has a hash to protect.
  // Re-renders while already here (photo add/remove, paste) leave the hash
  // alone, since it already matches.
  if (location.hash !== "#/create/verify") history.replaceState(null, "", "#/create/verify");
  // Router-level leave-guard (onHashChange in app.js): the browser/system
  // Back gesture fires `hashchange` directly, bypassing the in-app back
  // button below entirely — this makes ANY way of leaving the hash ask
  // first. Re-registered every render so the guard closure always reads the
  // CURRENT verifyState, not whatever it was when first armed.
  guardHash(async () => {
    if (!verifyHasTypedContent()) return true;
    const ok = await confirmDiscardVerify();
    // confirmed leaving with photos already on the server and no bill ever
    // created to reference them — release them (J1: the system Back /
    // browser Back path, not just the in-app button below)
    if (ok) releaseAbandonedPhotos(verifyState.photos);
    return ok;
  });
  $("#back-btn").addEventListener("click", async () => {
    if (verifyHasTypedContent()) {
      const ok = await confirmDiscardVerify();
      if (!ok) return;
    }
    releaseAbandonedPhotos(verifyState.photos);
    clearHashGuard();
    location.hash = "#/create";
  });

  // v61: multi-photo preview — tap to zoom, ✕ to remove, + to add more
  const photoImgs = $$(".vf-photo-wrap .photo-preview");
  photoImgs.forEach(img => img.addEventListener("click", () => {
    if (img.classList.contains("expanded")) collapseExpandedPhoto();
    else expandPhoto(img);
  }));
  $$(".vf-photo-del").forEach(btn => btn.addEventListener("click", () => {
    const idx = parseInt(btn.dataset.idx, 10);
    if (!Number.isFinite(idx)) return;
    const [removed] = verifyState.photos.splice(idx, 1);
    // J1: the bill doesn't exist yet, so nothing else references this file —
    // release it on the server instead of just forgetting the path client-side
    releaseAbandonedPhoto(removed);
    verifyState.photo_path = verifyState.photos[0] || null;
    renderVerify({ ...verifyState, photos: verifyState.photos, paid_by_name: verifyState.paid_by_name }, verifyState.manual);
  }));
  const addPhotoBtn = $("#verify-add-photo");
  const pastePhotoBtn = $("#verify-paste-photo");
  if (pastePhotoBtn) pastePhotoBtn.addEventListener("click", () => readClipboardImage());
  const retryScanBtn = $("#verify-retry-scan");
  if (retryScanBtn) retryScanBtn.addEventListener("click", async () => {
    const f = verifyState.ocrRetryFile;
    const preserved = { title: verifyState.title, merchant: verifyState.merchant,
      transacted_at: verifyState.transacted_at, items: verifyState.items.map(i => ({ ...i })),
      subtotal: verifyState.subtotal, tax: verifyState.tax, service: verifyState.service,
      total: verifyState.total, subtotalTouched: verifyState.subtotalTouched,
      tax_included: verifyState.tax_included, taxSaved: verifyState.taxSaved,
      paidByMyself: verifyState.paidByMyself, paid_by_name: verifyState.paid_by_name,
      photos: verifyState.photos.slice(), participants: verifyState.participants.slice(),
      extraNames: verifyState.extraNames.slice(), manual: verifyState.manual };
    if (verifyHasTypedContent()) {
      const ok = await confirmSheet({ title: "Coba baca ulang struk?",
        body: "Koreksi item, judul, pembayaran, biaya, dan peserta akan tetap dipakai.",
        confirmText: "Baca ulang", cancelText: "Batal" });
      if (!ok) return;
    }
    // a File held across a bfcache restore or a stale re-render could still
    // end up here empty — never leave the button silently dead (J3)
    if (!f) { toast("Foto aslinya sudah tidak ada — upload ulang ya"); return; }
    const staleOnRetry = verifyState.photos.slice();
    // route through #/create first (clearing the guard on the way): this is
    // a deliberate hop back into the OCR flow, not a "leave and lose data"
    // the guard should question, and uploadAndOcr needs the create screen's
    // #create-body mounted for its spinner.
    // history.replaceState (not location.hash=) so this doesn't fire an
    // async hashchange: `location.hash=` used to win a race against
    // uploadAndOcr's own synchronous lookup of #create-body, which ran
    // before the router's renderCreate() had painted it, so the "Lagi baca
    // struknya..." spinner silently never appeared (bug: J3). Render the
    // create screen ourselves, synchronously, the same way renderVerify
    // claims its own route above.
    clearHashGuard();
    history.replaceState(null, "", "#/create");
    renderCreate({ preserveSession: true });
    await uploadAndOcr(f, createFlowSession, preserved);
    // uploadAndOcr always ends by replacing verifyState wholesale (success:
    // renderVerify(result); OCR-fail-again: uploadAndAttach's own re-upload)
    // with a FRESH upload — the file(s) attached before this retry are now
    // orphaned server-side unless the new state still points at them (J1)
    releaseAbandonedPhotos(staleOnRetry.filter(p => !verifyState.photos.includes(p)));
  });
  if (addPhotoBtn) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.className = "hidden";
    addPhotoBtn.insertAdjacentElement("afterend", input);
    addPhotoBtn.addEventListener("click", () => input.click());
    input.addEventListener("change", async () => {
      const f = input.files[0];
      if (!f) return;
      if (f.size > 5 * 1024 * 1024) { toast("Foto maksimal 5MB"); return; }
      await withBusy(addPhotoBtn, "Upload...", async () => {
        const routeAtStart = location.hash;
        const session = createFlowSession;
        try {
          const fd = new FormData();
          fd.append("file", f);
          const result = await api("/api/photos", { method: "POST", body: fd });
          if (location.hash !== routeAtStart || session !== createFlowSession) return;
          verifyState.photos.push(result.photo_path);
          renderVerify({ ...verifyState, photos: verifyState.photos, paid_by_name: verifyState.paid_by_name }, verifyState.manual);
        } catch (e) { toast(e.message); }
      });
    });
  }
  renderVerifyItems();
  bindVerifyInputs();

  // ---------- "Siapa yang Ikut" picker ----------
  const peoplePick = $("#people-pick");
  const chipsBox = $("#people-chips");
  const personNameInput = $("#person-name-input");
  const personNameAdd = $("#person-name-add");
  const renderPeopleChips = () => {
    if (!chipsBox) return;
    const all = [
      ...verifyState.participants.map(p => ({ key: "id:" + p.id, label: p.name, kind: "kontak" })),
      ...verifyState.extraNames.map(n => ({ key: "name:" + n, label: n, kind: "nama" })),
    ];
    chipsBox.innerHTML = all.map(p => `
      <span class="people-chip" data-key="${esc(p.key)}">
        ${esc(p.label)} <button class="people-chip-x" data-key="${esc(p.key)}" aria-label="Hapus ${esc(p.label)}">${ic("x")}</button>
      </span>`).join("");
    $$(".people-chip-x", chipsBox).forEach(btn => btn.addEventListener("click", () => {
      const key = btn.dataset.key;
      if (key.startsWith("id:")) {
        const id = key.slice(3);
        verifyState.participants = verifyState.participants.filter(p => p.id !== id);
        const cb = $(`#pp-cb-${id}`);
        if (cb) cb.checked = false;
      } else {
        const name = key.slice(5);
        verifyState.extraNames = verifyState.extraNames.filter(n => n !== name);
      }
      renderPeopleChips();
    }));
  };
  if (personNameAdd) {
    const addName = () => {
      const v = (personNameInput.value || "").trim();
      if (!v) return;
      if (verifyState.extraNames.some(n => normName(n) === normName(v)) ||
          verifyState.participants.some(p => normName(p.name) === normName(v))) { toast("Nama itu sudah kepilih"); return; }
      verifyState.extraNames.push(v);
      personNameInput.value = "";
      renderPeopleChips();
    };
    personNameAdd.addEventListener("click", addName);
    personNameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addName(); } });
  }
  if (peoplePick) {
    const me = state.identity;
    peoplePick.innerHTML = `<p class="muted" style="padding:2px 0;">Muat kontak...</p>`;
    if (me && me.id) {
      (async () => {
        try {
          const contacts = await api(`/api/identities/${me.id}/contacts`);
          if (!document.getElementById("people-pick")) return; // left the screen
          if (!contacts || !contacts.length) {
            peoplePick.innerHTML = `<div class="people-empty-action"><p class="muted" style="margin:0;">Belum ada kontak — undang orang lewat tautan agar mereka muncul di sini.</p><button type="button" class="btn-outline btn-sm" id="copy-invite-link">${ic("copy")} Salin tautan undangan</button></div>`;
            const copyInvite = $("#copy-invite-link");
            if (copyInvite) copyInvite.addEventListener("click", async () => {
              const url = location.origin + location.pathname;
              try {
                if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(url);
                else {
                  const ta = document.createElement("textarea"); ta.value = url; ta.style.position = "fixed"; ta.style.opacity = "0";
                  document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove();
                }
                toast("Tautan undangan disalin");
              } catch (e) { toast("Gagal menyalin tautan"); }
            });
            return;
          }
          peoplePick.innerHTML = contacts.map(c => `
            <label class="account-row" style="cursor:pointer;">
              <input type="checkbox" id="pp-cb-${esc(c.id)}" style="flex:0 0 auto;" />
              <div class="avatar" style="flex:0 0 auto;">${esc(initials(c.name))}</div>
              <div style="flex:1;min-width:0;">
                <div class="item-name">${esc(c.name)}</div>
                <div class="muted">${c.last_shared ? "pernah berbagi bill" : "kontak"}</div>
              </div>
            </label>`).join("");
          $$("#people-pick input[type=checkbox]").forEach(cb => cb.addEventListener("change", () => {
            const label = cb.closest(".account-row");
            const name = label.querySelector(".item-name").textContent;
            const id = cb.id.slice(6); // strip "pp-cb-"
            if (cb.checked) {
              if (!verifyState.participants.some(p => p.id === id)) verifyState.participants.push({ id, name });
              verifyState.extraNames = verifyState.extraNames.filter(n => normName(n) !== normName(name));
            } else {
              verifyState.participants = verifyState.participants.filter(p => p.id !== id);
            }
            renderPeopleChips();
          }));
          // restore previously selected checkboxes on re-render (photo added etc.)
          verifyState.participants.forEach(p => { const cb = $(`#pp-cb-${p.id}`); if (cb) cb.checked = true; });
        } catch (e) {
          if (document.getElementById("people-pick")) peoplePick.innerHTML = `<p class="muted" style="padding:2px 0;">${esc(e.message)}</p>`;
        }
      })();
    } else {
      peoplePick.innerHTML = `<p class="muted" style="padding:2px 0;">Login dulu buat milih siapa yang ikut.</p>`;
    }
  }
  renderPeopleChips();

  $("#add-item-btn").addEventListener("click", () => {
    verifyState.items.push({ name: "", price: 0, discount: 0, quantity: 1 });
    renderVerifyItems();
    updateVerifyTotal();
    const inputs = $$("#items-list [data-role=name]");
    const last = inputs[inputs.length - 1];
    if (last) last.focus();
  });
  $("#title-input").addEventListener("input", (e) => verifyState.title = e.target.value);
  $("#date-input").addEventListener("input", (e) => verifyState.transacted_at = e.target.value);
  bindRupiahInput($("#subtotal-input"), () => { verifyState.subtotalTouched = true; updateVerifyTotal(); });
  bindRupiahInput($("#tax-input"), (v) => { verifyState.taxSaved = v; updateVerifyTotal(); });
  bindRupiahInput($("#service-input"), () => updateVerifyTotal());

  const paidByMe = $("#paid-by-me");
  const payerChoices = $$("input[name=payer-choice]");
  const setPayer = (isMe, focusOther = false) => {
    if (paidByMe) paidByMe.checked = isMe;
    verifyState.paidByMyself = isMe;
    $("#paid-by-other").classList.toggle("hidden", isMe);
    if (isMe) verifyState.paid_by_name = null;
    const inp = $("#paid-by-name-input");
    const nameError = $("#paid-by-name-error");
    if (nameError) nameError.classList.toggle("hidden", isMe || !!String(verifyState.paid_by_name || "").trim());
    if (!isMe && focusOther && inp) inp.focus();
  };
  payerChoices.forEach(choice => choice.addEventListener("change", () => setPayer(choice.value === "me", choice.value !== "me")));
  if (paidByMe) paidByMe.addEventListener("change", () => setPayer(paidByMe.checked, !paidByMe.checked));
  const paidByNameInput = $("#paid-by-name-input");
  if (paidByNameInput) {
    paidByNameInput.addEventListener("input", (e) => {
      if (paidByMe && paidByMe.checked) return; // ignore while "aku" checked
      verifyState.paid_by_name = e.target.value;
      e.target.style.borderColor = "";
      const nameError = $("#paid-by-name-error");
      if (nameError) nameError.classList.toggle("hidden", !!String(e.target.value || "").trim());
    });
    paidByNameInput.addEventListener("change", (e) => {
      if (paidByMe && paidByMe.checked) return;
      verifyState.paid_by_name = e.target.value;
      const nameError = $("#paid-by-name-error");
      if (nameError) nameError.classList.toggle("hidden", !!String(e.target.value || "").trim());
    });
  }

  const taxIncToggle = $("#tax-included-toggle");
  if (taxIncToggle) {
    taxIncToggle.addEventListener("change", (e) => {
      const ti = $("#tax-input");
      // tax-included bills still carry a separate service charge — calc.py
      // splits it. Blanking BOTH fields (and forgetting the typed PPN forever)
      // was wrong (bug: toggling by accident wiped PPN + service permanently).
      if (e.target.checked) {
        if (ti) verifyState.taxSaved = rupiahParse(ti.value);
      } else if (ti) {
        ti.disabled = false;
        ti.value = rupiahFmt(verifyState.taxSaved || 0);
      }
      verifyState.tax_included = e.target.checked;
      updateVerifyTotal();
    });
  }
  $("#create-bill-btn").addEventListener("click", createBillFinal);
}

function updateVerifyLineTotal(idx) {
  const it = verifyState.items[idx];
  const row = $(`#items-list .vf-item[data-idx="${idx}"]`);
  const line = row && row.querySelector("[data-role=line-total] strong");
  if (line) line.textContent = rupiahFmt(Math.max(0, (it.price || 0) - (it.discount || 0)) * itemQuantity(it));
}

function renderVerifyItems() {
  const elList = $("#items-list");
  if (!elList) return;
  elList.innerHTML = verifyState.items.map((it, idx) => {
    const eff = Math.max(0, (it.price || 0) - (it.discount || 0));
    const quantity = itemQuantity(it);
    const quantityDraft = it.quantityDraft != null ? String(it.quantityDraft) : String(quantity);
    const slots = it.slot_count || 2;
    // per-slot price is the EFFECTIVE price / slots — dividing the pre-discount
    // price quoted a per-bagian number nobody would ever be charged
    // (bug: slot preview ignored the discount column)
    const perSlot = Math.floor(eff * quantity / slots);
    const isSlot = it.mode === "slot";
    return `
    <div class="vf-item" data-idx="${idx}">
      <input data-role="name" data-idx="${idx}" value="${esc(it.name)}" placeholder="Nama Item"
             maxlength="60" aria-label="Nama item baris ${idx + 1}">
      <div class="vf-price">
        <label class="vf-mobile-label" for="price-${idx}">Harga satuan</label>
        <input id="price-${idx}" data-role="price" data-idx="${idx}" class="input-money" type="text" inputmode="numeric" maxlength="16"
               value="${rupiahFmt(it.price)}" placeholder="0" aria-label="Harga satuan item baris ${idx + 1}">
        <div class="vf-qty" aria-label="Jumlah dibeli item baris ${idx + 1}">
          <span class="vf-qty-label">Jumlah dibeli</span>
          <button type="button" class="btn-outline qty-dec" data-idx="${idx}" aria-label="Kurangi jumlah dibeli"${quantity <= 1 ? " disabled" : ""}>−</button>
          <input data-role="quantity" data-idx="${idx}" type="number" min="1" max="99" step="1" value="${esc(quantityDraft)}" aria-label="Jumlah dibeli item baris ${idx + 1}">
          <button type="button" class="btn-outline qty-inc" data-idx="${idx}" aria-label="Tambah jumlah dibeli"${quantity >= 99 ? " disabled" : ""}>+</button>
          <span class="error-text quantity-error${it.quantityDraft != null ? "" : " hidden"}" data-role="quantity-error">Jumlah harus bilangan bulat 1–99.</span>
        </div>
        <span class="vf-line-total" data-role="line-total">Total baris: <strong>${rupiahFmt(eff * quantity)}</strong></span>
      </div>
      <button type="button" data-role="del" data-idx="${idx}" class="icon-btn ghost"
              aria-label="Hapus item baris ${idx + 1}" style="color:var(--red);">${ic("trash")}</button>

      <div class="vf-full vf-discount">
        <label class="label-sm vf-discount-label vf-mobile-label" for="disc-${idx}" style="margin:0;">Potongan</label>
        <div class="vf-discount-fields">
          <input id="disc-${idx}" data-role="discount" data-idx="${idx}" class="input-money" type="text"
                 inputmode="numeric" maxlength="16" value="${rupiahFmt(it.discount)}" placeholder="0">
          ${/* "harga asli − potongan = yang dibayar" used to sit next to every
                discount box: five copies of the same subtraction, four lines each
                on a phone. The green result below says it better, and only when
                there is actually a discount. */ ""}
          ${it.discount > 0 ? `<span class="disc-bayar money-sm">→ bayar ${rupiahFmt(eff)}</span>` : ""}
        </div>
      </div>

      <div class="vf-full vf-mode">
        <span class="label-sm vf-mode-label">Cara Bagi</span>
        <div class="vf-mode-options">
          <button type="button" class="chip-btn item-mode-btn ${!isSlot ? "chip-active" : ""}" data-idx="${idx}" data-mode="free"
                  aria-pressed="${!isSlot}">${ic("people")} Bagi rata</button>
          <button type="button" class="chip-btn item-mode-btn ${isSlot ? "chip-active" : ""}" data-idx="${idx}" data-mode="slot"
                  aria-pressed="${isSlot}">${ic("slot")} Bagi per porsi</button>
          ${isSlot ? `
          <span style="display:inline-flex;align-items:center;gap:6px;margin-left:auto;">
            <button type="button" class="chip-btn slot-dec" data-idx="${idx}" aria-label="Kurangi jumlah bagian"><span aria-hidden="true">−</span></button>
            <span class="slot-count money-sm" style="min-width:20px;text-align:center;color:var(--text);">${slots}</span>
            <button type="button" class="chip-btn slot-inc" data-idx="${idx}" aria-label="Tambah jumlah bagian">${ic("plus")}</button>
            <span class="muted" style="font-size:12px;">bagian</span>
          </span>` : ""}
        </div>
        ${/* Only "slot" needs a per-item line, because the numbers differ per
              item. The "bebas" explainer is identical for every row — printed
              under all of them it filled the form with the same paragraph four
              times over. It lives once, above the list. */ ""}
        ${isSlot ? `<div class="muted" style="font-size:12px;line-height:1.45;">
          Dibagi ${slots} bagian tetap${eff > 0 ? ` · ${rupiahFmt(perSlot)}/bagian` : ""}. Tiap orang bisa ambil 1 bagian atau lebih, sisanya keliatan kosong.
        </div>` : ""}
      </div>
    </div>`;
  }).join("");

  $$("[data-role=name]", elList).forEach(inp => inp.addEventListener("input", (e) => {
    verifyState.items[+e.target.dataset.idx].name = e.target.value;
    e.target.style.borderColor = "";   // clear the "row rejected" marker
    updateVerifyTotal();
  }));
  $$("[data-role=price]", elList).forEach(inp => bindRupiahInput(inp, (v) => {
    verifyState.items[+inp.dataset.idx].price = v;
    inp.style.borderColor = "";
    updateVerifyLineTotal(+inp.dataset.idx);
    updateVerifyTotal();
  }));
  $$("[data-role=quantity]", elList).forEach(inp => {
    const commit = () => {
      const idx = +inp.dataset.idx;
      const it = verifyState.items[idx];
      const value = validQuantity(inp.value);
      const error = inp.parentElement.querySelector("[data-role=quantity-error]");
      if (value == null) {
        it.quantityDraft = inp.value;
        if (error) error.classList.remove("hidden");
        return;
      }
      it.quantity = value;
      it.quantityDraft = null;
      if (error) error.classList.add("hidden");
      updateVerifyLineTotal(idx);
      updateVerifyTotal();
    };
    inp.addEventListener("input", commit);
    inp.addEventListener("change", commit);
  });
  $$(".qty-dec", elList).forEach(btn => btn.addEventListener("click", () => {
    const it = verifyState.items[+btn.dataset.idx];
    it.quantityDraft = null;
    it.quantity = Math.max(1, (it.quantity || 1) - 1);
    renderVerifyItems(); updateVerifyTotal();
  }));
  $$(".qty-inc", elList).forEach(btn => btn.addEventListener("click", () => {
    const it = verifyState.items[+btn.dataset.idx];
    it.quantityDraft = null;
    it.quantity = Math.min(99, (it.quantity || 1) + 1);
    renderVerifyItems(); updateVerifyTotal();
  }));
  $$("[data-role=discount]", elList).forEach(inp => bindRupiahInput(inp, (v) => {
    const it = verifyState.items[+inp.dataset.idx];
    it.discount = v;
    inp.style.borderColor = "";
    const row = inp.closest(".vf-item");
    let bayar = row ? row.querySelector(".disc-bayar") : null;
    const eff = Math.max(0, (it.price || 0) - v);
    updateVerifyLineTotal(+inp.dataset.idx);
    if (v > 0) {
      if (!bayar && row) {
        bayar = document.createElement("span");
        bayar.className = "disc-bayar money-sm";
        bayar.style.cssText = "color:var(--green);font-weight:700;";
        inp.parentElement.appendChild(bayar);
      }
      if (bayar) bayar.textContent = `→ bayar ${rupiahFmt(eff)}`;
    } else if (bayar) bayar.remove();
    updateVerifyTotal();
  }));
  $$("[data-role=del]", elList).forEach(btn => btn.addEventListener("click", () => {
    verifyState.items.splice(+btn.dataset.idx, 1);
    renderVerifyItems();
    updateVerifyTotal();
  }));
  $$(".item-mode-btn", elList).forEach(btn => btn.addEventListener("click", () => {
    const it = verifyState.items[+btn.dataset.idx];
    const mode = btn.dataset.mode;
    it.mode = mode;
    if (mode === "slot" && !it.slot_count) it.slot_count = 2;
    renderVerifyItems();
    updateVerifyTotal();
  }));
  $$(".slot-inc", elList).forEach(btn => btn.addEventListener("click", () => {
    const it = verifyState.items[+btn.dataset.idx];
    it.slot_count = Math.min(99, (it.slot_count || 2) + 1);
    renderVerifyItems();
  }));
  $$(".slot-dec", elList).forEach(btn => btn.addEventListener("click", () => {
    const it = verifyState.items[+btn.dataset.idx];
    it.slot_count = Math.max(2, (it.slot_count || 2) - 1);
    renderVerifyItems();
  }));
}

function updateVerifyTotal() {
  const sumItems = verifyState.items.reduce((s, i) => s + Math.max(0, (i.price || 0) - (i.discount || 0)) * itemQuantity(i), 0);
  // subtotal auto-follows items unless the user typed their own value
  // (bug: manual-mode-only check meant OCR bills never updated the total when
  // item prices were edited)
  const si = $("#subtotal-input");
  const ti = $("#tax-input");
  const svi = $("#service-input");
  if (!si) return;
  let subtotal = rupiahParse(si.value);
  if (!verifyState.subtotalTouched) {
    subtotal = sumItems;
    si.value = rupiahFmt(subtotal);
  }
  let tax = ti ? rupiahParse(ti.value) : 0;
  const service = svi ? rupiahParse(svi.value) : 0;
  if (verifyState.tax_included) {
    // prices include tax -> subtotal = items and PPN is forced to 0 (the
    // backend 400s on tax > 0 here). Service is NOT touched: calc.py still
    // splits a service charge on a tax-included bill.
    subtotal = sumItems;
    si.value = rupiahFmt(subtotal);
    // disabled, not just overwritten: a keystroke here used to still fire
    // (this field isn't readonly) and set subtotalTouched = true even
    // though the value it "typed" was instantly stomped right back to
    // sumItems above. Turning tax-included back OFF then stopped
    // re-deriving the subtotal at all (subtotalTouched was already true),
    // so editing any item price left it permanently mismatched with no fix
    // but retyping the subtotal by hand (bug: CTA stuck on "Subtotal belum
    // cocok sama item" forever). Disabling means the keystroke never happens.
    si.disabled = true;
    if (ti) { ti.value = ""; ti.disabled = true; }
    tax = 0;
  } else {
    si.disabled = false;
    if (ti) ti.disabled = false;
  }
  const total = subtotal + tax + service;
  verifyState.subtotal = subtotal; verifyState.tax = tax; verifyState.service = service;
  verifyState.total = total;
  const td = $("#total-display");
  if (td) td.textContent = fmt(total);
  const badge = $("#tax-included-badge");
  if (badge) badge.classList.toggle("hidden", !verifyState.tax_included);

  // OCR that found no items (receipt unreadable) isn't the user's error —
    // forcing them to "match" numbers they can't see blocked the CTA on a
    // mistake they didn't make (bug: fake mismatch blamed the user)
    const ocrEmpty = !verifyState.manual && verifyState.items.length === 0 && (verifyState.subtotal || 0) > 0;
    const mismatch = sumItems !== subtotal && !ocrEmpty;
  const warn = $("#sum-warn");
  if (warn) {
    if (ocrEmpty) {
      warn.classList.remove("hidden");
      warn.textContent = "Struknya tidak terbaca jelas — tambahkan item manual saja, subtotal dipertahankan dari struk.";
      warn.style.color = "var(--accent)";
    } else if (mismatch) {
      warn.classList.remove("hidden");
      warn.style.color = "";
      if (sumItems === total) {
        warn.textContent = `Harga item (${fmt(sumItems)}) tampaknya sudah TERMASUK pajak, tetapi kamu mengisi Subtotal ${fmt(subtotal)} + PPN. Aktifkan toggle "Harga item sudah termasuk pajak" agar tidak dihitung ganda.`;
      } else {
        warn.textContent = `Total item (${fmt(sumItems)}) beda dari Subtotal (${fmt(subtotal)}). Samain dulu — cek harga & kolom Diskon tiap item.`;
      }
    } else warn.classList.add("hidden");
  }
  // The server hard-rejects subtotal != sum(item price - discount) with a 400,
  // so this was never just advisory (bug: the CTA looked ready, then failed
  // with a raw error toast). Block the button until the numbers reconcile.
  const cta = $("#create-bill-btn");
  if (cta) {
    // `some()` made a partially filled form look ready: after tapping Tambah
    // Item, one named row was enough to enable the CTA even when the new row
    // was blank. The submit validator caught it only after a confusing tap.
    const unnamedIndex = verifyState.items.findIndex(i => !String(i.name || "").trim());
    const invalidDiscountIndex = verifyState.items.findIndex(i => (i.discount || 0) > (i.price || 0));
    const allItemsNamed = verifyState.items.length > 0 && unnamedIndex === -1;
    const hasValidDiscounts = invalidDiscountIndex === -1;
    const hasTotal = total > 0;
    const payerChosen = !!verifyState.paidByMyself || !!String(verifyState.paid_by_name || "").trim();
    const missing = [];
    if (!allItemsNamed) missing.push(unnamedIndex >= 0 ? `nama item baris ${unnamedIndex + 1}` : "nama item");
    if (!hasValidDiscounts) missing.push(`potongan baris ${invalidDiscountIndex + 1}`);
    if (!hasTotal) missing.push("total");
    if (!payerChosen) missing.push("pembayar");
    cta.disabled = mismatch || !allItemsNamed || !hasValidDiscounts || !hasTotal || !payerChosen;
    cta.textContent = mismatch ? "Subtotal belum cocok sama item" : "Buat Tagihan";
    const helper = $("#create-bill-helper");
    if (helper) helper.textContent = mismatch ? "Samakan subtotal dengan total item untuk lanjut." :
      (missing.length ? `Lengkapi ${missing.join(", ")} untuk lanjut.` : "Siap membuat tagihan.");
  }
}

function bindVerifyInputs() { updateVerifyTotal(); }

async function createBillFinal() {
  const btn = $("#create-bill-btn");
  const items = verifyState.items;
  if (!items.length) { toast("Minimal 1 item"); return; }

  // Per-row validation. The old code filtered out `!i.name || i.price <= 0`
  // while the subtotal still counted those rows, so the POST 400'd every time
  // and the user was never told which row was wrong (bug). Price 0 is legal —
  // the backend accepts it, and a free item still has to be picked by someone.
  $$("#items-list input").forEach(i => { i.style.borderColor = ""; });
  let badInput = null, badMsg = "";
  items.forEach((it, idx) => {
    if (badInput) return;
    if (!String(it.name || "").trim()) {
      badInput = $(`#items-list [data-role=name][data-idx="${idx}"]`);
      badMsg = `Item baris ${idx + 1} belum ada namanya`;
    } else if (it.quantityDraft != null || validQuantity(it.quantity) == null) {
      badInput = $(`#items-list [data-role=quantity][data-idx="${idx}"]`);
      badMsg = `Jumlah item baris ${idx + 1} harus bilangan bulat 1–99`;
    } else if ((it.discount || 0) > (it.price || 0)) {
      badInput = $(`#items-list [data-role=discount][data-idx="${idx}"]`);
      badMsg = `Potongan "${it.name}" lebih gede dari harganya`;
    }
  });
  if (badInput) {
    badInput.style.borderColor = "var(--red)";
    try { badInput.scrollIntoView({ block: "center", behavior: "smooth" }); badInput.focus(); } catch (e) {}
    toast(badMsg);
    return;
  }
  // paid-by-someone needs a name — sending null while the flag says "not me"
  // would silently record the bill as paid by the creator (bug: un-checked
  // "Aku yang bayar" with an empty name became self-paid)
  if (!verifyState.paidByMyself && !String(verifyState.paid_by_name || "").trim()) {
    toast("Tulis nama orang yang bayar atau pilih Aku yang bayar");
    const inp = $("#paid-by-name-input");
    const nameError = $("#paid-by-name-error");
    if (inp) { inp.style.borderColor = "var(--red)"; inp.focus(); }
    if (nameError) nameError.classList.remove("hidden");
    return;
  }

  await withBusy(btn, "Buat tagihan", async () => {
    try {
      const bill = await apiJson("/api/bills", "POST", {
        title: verifyState.title || verifyState.merchant || "Bill",
        merchant: verifyState.merchant || null,
        transacted_at: verifyState.transacted_at || null,
        tax_mode: "proportional",
        subtotal: verifyState.subtotal,
        tax: verifyState.tax,
        service: verifyState.service,
        total: verifyState.subtotal + verifyState.tax + verifyState.service,
        items: items.map(i => ({
          name: i.name,
          price: i.price || 0,
          discount: i.discount || 0,
          quantity: i.quantity || 1,
          mode: i.mode === "slot" ? "slot" : "free",
          slot_count: i.mode === "slot" ? (i.slot_count || 2) : null,
        })),
        photo_path: verifyState.photo_path,
        photos: verifyState.photos || [],
        paid_by_name: verifyState.paidByMyself ? null : (verifyState.paid_by_name || null),
        tax_included: verifyState.tax_included ? 1 : 0,
        // free-typed names become legacy participant placeholders; proven
        // contacts are NOT sent here (avoids double rows) — they're invited by
        // identity right after the bill exists, below
        participants: [...new Map((verifyState.extraNames || []).map(n => [normName(n), n])).values()]
          .filter(n => !(verifyState.participants || []).some(p => normName(p.name) === normName(n))),
      });
      // Navigate as soon as the bill exists. Invites are a follow-up and must
      // not make the creator wait for every contact request.
      clearHashGuard();
      location.hash = "#/b/" + bill.id;
      toast("Bill sudah jadi. Bagikan linknya ke teman kamu.");
      if (verifyState.participants.length) {
        const inviteWork = Promise.allSettled(verifyState.participants.map(p =>
          apiJson(`/api/bills/${bill.id}/invite`, "POST", { identity_id: p.id })));
        const timed = Promise.race([inviteWork, new Promise(resolve => setTimeout(() => resolve(null), 8000))]);
        timed.then(results => {
          if (!results) { toast("Bill sudah jadi. Sebagian undangan masih diproses, cek lagi nanti."); return; }
          const failed = results.filter(r => r.status === "rejected");
          if (failed.length) toast(`Bill sudah jadi, tapi ${failed.length} undangan gagal. Coba undang lagi dari bill.`);
        });
      }
    } catch (e) {
      toast(e.message);
    }
  });
}

