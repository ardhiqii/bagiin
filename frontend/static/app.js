/* Bagiin frontend - state, router, API, icons, sheets */
"use strict";

const $ = (sel, el) => (el || document).querySelector(sel);
const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));
const fmt = (n) => "Rp " + Number(n || 0).toLocaleString("id-ID");
const el = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c])); }

const LS_KEYS = { ident: "bagiin_identity", name: "bagiin_name", listSort: "bagiin_list_sort" };

function lsGet(key, fallback) {
  try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); }
  catch (e) { return fallback; }
}
function lsSet(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* private mode - ignore */ }
}

const state = {
  identity: lsGet(LS_KEYS.ident, null),
  bill: null,           // current bill data
  selected: new Set(),  // item ids selected by current viewer
  currentBillId: null,
};

/* ---------- icons ----------
   Hand-inlined because the project has no build step and no package manager
   (SPEC: vanilla JS, < 50KB gz, no npm). One stroke weight (1.75) and one
   24-box for every glyph so they sit together as a set. */
const ICONS = {
  back: '<path d="M15 5l-7 7 7 7"/>',
  history: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 1.8"/>',
  user: '<circle cx="12" cy="8.5" r="3.6"/><path d="M5 19.5c1.4-3.2 4-4.8 7-4.8s5.6 1.6 7 4.8"/>',
  share: '<path d="M12 15V4"/><path d="M8 7.5L12 3.5l4 4"/><path d="M5.5 13v5.5a1.5 1.5 0 001.5 1.5h10a1.5 1.5 0 001.5-1.5V13"/>',
  link: '<path d="M10 13.5a3.5 3.5 0 005 0l3-3a3.54 3.54 0 00-5-5L11.5 7"/><path d="M14 10.5a3.5 3.5 0 00-5 0l-3 3a3.54 3.54 0 005 5L12.5 17"/>',
  trash: '<path d="M4.5 6.5h15"/><path d="M9.5 6.5V5a1.5 1.5 0 011.5-1.5h2A1.5 1.5 0 0114.5 5v1.5"/><path d="M6.5 6.5l.8 12a1.5 1.5 0 001.5 1.4h6.4a1.5 1.5 0 001.5-1.4l.8-12"/>',
  camera: '<path d="M3.5 8.5A1.5 1.5 0 015 7h2l1.2-2h7.6L17 7h2a1.5 1.5 0 011.5 1.5v9A1.5 1.5 0 0119 19H5a1.5 1.5 0 01-1.5-1.5z"/><circle cx="12" cy="12.5" r="3.4"/>',
  image: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.6"/><path d="M4 17l4.5-4.5 3.5 3.5 3-3L20 17"/>',
  clipboard: '<rect x="6" y="4.5" width="12" height="15.5" rx="2"/><path d="M9.5 4.5V3.6A1.1 1.1 0 0110.6 2.5h2.8a1.1 1.1 0 011.1 1.1v.9z"/>',
  plus: '<path d="M12 5.5v13M5.5 12h13"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  pencil: '<path d="M4.5 19.5l.9-3.6 9.4-9.4 2.7 2.7-9.4 9.4z"/><path d="M14.8 6.5l1.9-1.9a1.3 1.3 0 011.9 0l.8.8a1.3 1.3 0 010 1.9l-1.9 1.9"/>',
  key: '<circle cx="8" cy="12" r="3.8"/><path d="M11.8 12H20"/><path d="M17 12v3M14.4 12v2.2"/>',
  wallet: '<rect x="3.5" y="6" width="17" height="12.5" rx="2.2"/><path d="M3.5 10h17"/><circle cx="16.5" cy="14.5" r="1.1"/>',
  receipt: '<path d="M6 3.5h12v17l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4z"/><path d="M9 8.5h6M9 12h6M9 15.5h3"/>',
  hand: '<path d="M8.5 11V5.8a1.4 1.4 0 012.8 0V11"/><path d="M11.3 10.4V4.6a1.4 1.4 0 012.8 0V11"/><path d="M14.1 10.8V6.6a1.4 1.4 0 012.8 0v7.6a6 6 0 01-6 6h-.6a5 5 0 01-4-2l-2.4-3.4a1.4 1.4 0 012.2-1.7l1.4 1.6"/>',
  chevron: '<path d="M9.5 5.5l6.5 6.5-6.5 6.5"/>',
  alert: '<path d="M12 4.5l8.5 15H3.5z"/><path d="M12 10v3.6"/><circle cx="12" cy="16.6" r=".6" fill="currentColor" stroke="none"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11.2v5"/><circle cx="12" cy="8.2" r=".7" fill="currentColor" stroke="none"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 5.5H6a1.5 1.5 0 00-1.5 1.5v9.5"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 11-2.2-5.3"/><path d="M19.8 4.5v4h-4"/>',
  logout: '<path d="M14 5.5H6.5A1.5 1.5 0 005 7v10a1.5 1.5 0 001.5 1.5H14"/><path d="M17 8.5l3.5 3.5L17 15.5"/><path d="M20 12h-9"/>',
  slot: '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="M12 5.5v13"/><path d="M7.8 12h.01M16.2 12h.01"/>',
  people: '<circle cx="9" cy="9" r="3.2"/><path d="M3.5 19c1.1-2.7 3.2-4.1 5.5-4.1s4.4 1.4 5.5 4.1"/><path d="M15.5 6.2a3.2 3.2 0 010 5.7"/><path d="M17 14.9c2 .3 3.1 1.7 3.5 4.1"/>',
  wave: '<path d="M4 12.5c1.6-3.5 3.2-5.2 4.8-5.2 2.4 0 2.4 9.4 4.8 9.4 1.6 0 3.1-1.7 4.6-5.2"/>',
  empty: '<rect x="3.5" y="6" width="17" height="13.5" rx="2.2"/><path d="M3.5 10.5h17"/><path d="M8.5 15h7"/>',
};
/** The actual product mark — a receipt torn down a zigzag seam, the same shape
 *  as the favicon. The UI used to show a generic "people" glyph instead, so the
 *  brand never appeared anywhere the user could see it. */
function brandMark(size = 40) {
  const id = "bm" + Math.random().toString(36).slice(2, 8);
  return `<svg width="${size}" height="${size}" viewBox="0 0 512 512" role="img"
    aria-label="Bagiin" style="display:block;border-radius:${Math.round(size * 0.22)}px;">
    <defs>
      <linearGradient id="${id}g" x1="0" y1="0" x2=".25" y2="1">
        <stop offset="0" stop-color="#FB943C"/><stop offset="1" stop-color="#DF5208"/>
      </linearGradient>
      <clipPath id="${id}l"><polygon points="-20,-20 261.5,-20 235.5,26 261.5,72 235.5,118 261.5,164 235.5,210 261.5,256 235.5,302 261.5,348 235.5,394 261.5,440 235.5,486 261.5,532 -20,560"/></clipPath>
      <clipPath id="${id}r"><polygon points="560,-20 276.5,-20 250.5,26 276.5,72 250.5,118 276.5,164 250.5,210 276.5,256 250.5,302 276.5,348 250.5,394 276.5,440 250.5,486 276.5,532 560,560"/></clipPath>
      <g id="${id}s">
        <path d="M124 110 H388 a16 16 0 0 1 16 16 V366 H108 V126 a16 16 0 0 1 16-16 Z" fill="#FFFDFA"/>
        <polygon points="108,366 121.5,384 135,366 148.5,384 162,366 175.5,384 189,366 202.5,384 216,366 229.5,384 243,366 256.5,384 270,366 283.5,384 297,366 310.5,384 324,366 337.5,384 351,366 364.5,384 378,366 391.5,384 404,366" fill="#FFFDFA"/>
        <g fill="#D84E08">
          <rect x="138" y="166" width="98" height="17" rx="8.5"/>
          <rect x="138" y="214" width="98" height="17" rx="8.5"/>
          <rect x="138" y="262" width="61" height="17" rx="8.5"/>
          <rect x="276" y="166" width="98" height="17" rx="8.5"/>
          <rect x="276" y="214" width="98" height="17" rx="8.5"/>
          <rect x="276" y="262" width="61" height="17" rx="8.5"/>
        </g>
      </g>
    </defs>
    <rect width="512" height="512" rx="115" fill="url(#${id}g)"/>
    <g clip-path="url(#${id}l)"><g transform="translate(0 6)"><use href="#${id}s"/></g></g>
    <g clip-path="url(#${id}r)"><g transform="translate(0 -6)"><use href="#${id}s"/></g></g>
  </svg>`;
}

function ic(name, cls) {
  const d = ICONS[name] || "";
  return `<svg class="ico ${cls || ""}" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
}

// Shared bill status source of truth. app.js loads before screen-specific scripts.
function renderBillStatusChip(data, closed, totalUnpaid, soloSoFar) {
  if (soloSoFar) return `<span class="chip chip-grey">Belum ada yang gabung</span>`;
  const pendingPickers = !closed ? (data.people || []).filter((p) =>
    p.identity_id !== data.paid_by_id &&
    !p.subtotal_idr && !Object.values(data.sel_by_item || {}).some(list =>
      list.some(s => s.id === p.identity_id))) : [];
  if ((data.settled || data.all_paid) && pendingPickers.length) {
    if (pendingPickers.length === 1) {
      const name = String(pendingPickers[0].name || "");
      const displayName = name.length > 14 ? `${name.slice(0, 14)}…` : name;
      return `<span class="chip chip-grey">Menunggu ${esc(displayName)} memilih item</span>`;
    }
    return `<span class="chip chip-grey">Menunggu ${pendingPickers.length} orang memilih item</span>`;
  }
  if (data.settled) {
    return closed
      ? `<span class="chip chip-green">${ic("check")}Ditutup · lunas</span>`
      : `<span class="chip chip-green">${ic("check")}Lunas</span>`;
  }
  if (closed) {
    if ((data.people || []).length <= 1) return `<span class="chip chip-grey">Ditutup · selesai</span>`;
    return totalUnpaid > 0 || data.uncovered_idr > 0
      ? `<span class="chip chip-red">Ditutup · belum lunas</span>`
      : `<span class="chip chip-grey">Ditutup · selesai</span>`;
  }
  if (data.all_paid && data.uncovered_idr === 0)
    return `<span class="chip chip-green">${ic("check")} Semua lunas</span>`;
  const total = Math.max(0, data.bill.total_idr || 0);
  const collected = Math.max(0, Math.min(total, (data.people || [])
    .filter(p => p.paid === "paid" && p.identity_id !== data.paid_by_id)
    .reduce((sum, p) => sum + (p.total_idr || 0), 0)));
  if (collected > 0 && collected < total)
    return `<span class="chip chip-red">Sebagian lunas<br><small>Sudah masuk ${fmt(collected)} · Belum ${fmt(total - collected)}</small></span>`;
  if (totalUnpaid > 0) return `<span class="chip chip-red">${fmt(totalUnpaid)} belum dibayar</span>`;
  if (data.uncovered_idr > 0) return `<span class="chip chip-red">${fmt(data.uncovered_idr)} belum terambil</span>`;
  return `<span class="chip chip-grey">Belum ada yang memilih</span>`;
}

// ---------- API ----------
async function api(path, opts = {}) {
  const headers = Object.assign({}, opts.headers || {});
  if (state.identity) {
    headers["X-Identity-Id"] = state.identity.id;
    // the id is public (it appears in every bill payload) — the secret is what
    // proves this device owns the identity
    if (state.identity.secret) headers["X-Identity-Secret"] = state.identity.secret;
  }
  const fetchOpts = Object.assign({}, opts);
  if (opts.json !== undefined) {
    headers["Content-Type"] = "application/json";
    fetchOpts.body = JSON.stringify(opts.json);
    delete fetchOpts.json;
  }
  let res;
  try {
    res = await fetch(path, Object.assign({}, fetchOpts, { headers }));
  } catch (e) {
    // fetch rejections are English browser strings in an otherwise Indonesian app
    const err = new Error("Koneksi bermasalah. Periksa koneksi internet kamu, lalu coba lagi.");
    err.offline = true;
    throw err;
  }
  if (res.status === 429) throw new Error("Terlalu banyak permintaan, tunggu sebentar ya");
  if (!res.ok) {
    let msg = "Terjadi kendala (" + res.status + ")";
    try {
      const d = await res.json();
      if (typeof d.detail === "string") msg = d.detail;
      // FastAPI validation errors come back as a LIST of objects — printing it
      // raw showed the user "[object Object]"
      else if (Array.isArray(d.detail)) msg = d.detail.map(x => x.msg || "").filter(Boolean).join(", ") || msg;
    } catch (e) { /* non-JSON body */ }
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

function apiJson(path, method, data) {
  return api(path, { method, json: data });
}

// ---------- toast ----------
let toastTimer = null;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
}

// ---------- haptic ----------
function buzz(ms = 10) {
  if (navigator.vibrate) { try { navigator.vibrate(ms); } catch (e) {} }
}

// ---------- identity ----------
async function ensureIdentity(name) {
  if (!state.identity) {
    state.identity = await apiJson("/api/identities", "POST", { name });
    lsSet(LS_KEYS.ident, state.identity);
    lsSet(LS_KEYS.name, name);
  }
  return state.identity;
}

/** Identities created before v51 hold no secret. Claim one, once. */
async function ensureSecret() {
  if (!state.identity || state.identity.secret) return;
  try {
    const r = await apiJson(`/api/identities/${state.identity.id}/bind`, "POST", {});
    if (r && r.secret) {
      state.identity.secret = r.secret;
      lsSet(LS_KEYS.ident, state.identity);
    }
  } catch (e) { /* already bound elsewhere, or offline — requests will say so */ }
}

function logout() {
  state.identity = null;
  try {
    localStorage.removeItem(LS_KEYS.ident);
    localStorage.removeItem(LS_KEYS.name);
  } catch (e) {}
  render();
}

// ---------- sheets ----------
// One helper for every bottom sheet / dialog: role, Esc, background scroll
// lock, focus handling, and a click-outside close. Replaces the mix of
// hand-rolled overlays and native confirm() dialogs.
//
// History integration: each opened sheet pushes ONE same-URL "sentinel"
// entry, so the Android system back gesture / browser Back dismisses the
// top-most sheet first instead of blasting straight through the dialog to
// whatever route happens to sit under it (bug: back gesture while the
// payer/guest sheet was open landed on the home list). Because the sentinel
// keeps the current URL, popping it fires only `popstate` — never
// `hashchange` — so closing a sheet costs zero router churn. A real route
// pop fires BOTH events; we detect that by comparing hashes and let the
// normal leave-guard/render pipeline win.
let sheetDepth = 0;
const sheetStack = [];       // live sheet handles, LIFO
let consumeNextSelfPop = false; // one self-initiated history.back() in flight
let pendingSelfPops = 0;        // unconsumed sentinels owed after UI closes
let drainingPops = false;

function drainSelfPops() {
  // Closing sheets from UI owes one back() per opened-but-unconsumed
  // sentinel. Confirms stacked ON another sheet bury their inner sentinel,
  // so more than one may be owed. Drain strictly sequentially: the next
  // back() only goes out after the previous one's popstate landed.
  if (consumeNextSelfPop) return;    // one already in flight
  if (sheetStack.length > 0) return; // finish live sheets first
  if (pendingSelfPops <= 0) { drainingPops = false; return; }
  drainingPops = true;
  consumeNextSelfPop = true;
  try { history.back(); } catch (e) { consumeNextSelfPop = false; drainingPops = false; }
}

function openSheet(html, opts = {}) {
  const overlay = el(`<div class="sheet-overlay" role="dialog" aria-modal="true">
    <div class="sheet" role="document">${html}</div></div>`);
  const sheet = $(".sheet", overlay);
  const prevFocus = document.activeElement;
  document.body.appendChild(overlay);
  sheetDepth++;
  document.body.style.overflow = "hidden";

  // One handle holds everything the popstate machinery needs. Pushing THIS
  // object (not a look-alike) into the stack is what makes top-sheet close
  // dispatch work — earlier version pushed a bare {overlay} twin while the
  // close method lived on another object, so popstate crashed calling
  // undefined and left overlays/scroll-lock stranded.
  const handle = {};
  const bornAtHash = location.hash;
  const close = (fromHistory) => {
    if (!overlay.isConnected) return;
    const idx = sheetStack.indexOf(handle);
    if (idx !== -1) sheetStack.splice(idx, 1);
    overlay.remove();
    sheetDepth = Math.max(0, sheetDepth - 1);
    if (!sheetDepth) document.body.style.overflow = "";
    document.removeEventListener("keydown", onKey);
    if (prevFocus && prevFocus.focus) { try { prevFocus.focus(); } catch (e) {} }
    if (opts.onClose) opts.onClose();
    if (!fromHistory) {
      // Closing from UI: this sheet's sentinel becomes an owed back().
      // Top-most single-sheet case drains immediately; buried ones (cancel
      // a confirm sitting on another sheet) join the queue.
      pendingSelfPops++;
      drainSelfPops();
    }
  };
  handle.overlay = overlay;
  handle.close = close;
  handle.bornAtHash = bornAtHash;

  sheetStack.push(handle);
  try { history.pushState({ bagiinSheet: true }, ""); } catch (e) {}

  const onKey = (e) => {
    if (e.key === "Escape") { e.stopPropagation(); close(); }
  };
  document.addEventListener("keydown", onKey);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  // focus the first control so keyboard users land inside the dialog
  setTimeout(() => {
    const first = sheet.querySelector("input,textarea,select,button");
    if (first && !opts.noAutofocus) { try { first.focus(); } catch (e) {} }
  }, 30);
  return { overlay, sheet, close };
}

// Fires on back gesture / browser Back. A sentinel pop keeps the SAME URL
// (pushState was called with an unchanged href), so we detect it purely by
// comparing against the bornAtHash of the live top sheet — do NOT trust
// e.state here, because popstate reports the DESTINATION entry's state,
// not the marker of the entry being discarded. Sentinel pop -> close top
// sheet and swallow the rest of the navigation. Any other pop changes the
// URL underneath -> it is a genuine route move; drop remaining sheets
// silently and let the hashchange/leave-guard pipeline own the transition.
if (typeof window !== "undefined" && window.__bagiinBackWired !== true) {
  window.__bagiinBackWired = true;
  window.addEventListener("popstate", () => {
    if (consumeNextSelfPop) {
      // Our own sentinel consumption landed — settle one debt unit and keep
      // draining if stacked confirms left more buried sentinels behind.
      consumeNextSelfPop = false;
      if (pendingSelfPops > 0) {
        pendingSelfPops--;
        if (sheetStack.length === 0 && pendingSelfPops > 0) setTimeout(drainSelfPops, 0);
        else if (pendingSelfPops === 0) drainingPops = false;
      } else { drainingPops = false; }
      return;
    }
    if (!sheetStack.length) return;
    const top = sheetStack[sheetStack.length - 1];
    if (top && top.bornAtHash !== null && location.hash === top.bornAtHash) {
      top.close(true);
      return;
    }
    while (sheetStack.length) {
      sheetStack[sheetStack.length - 1].close(true);
    }
  });
}
// Debug/test surface (read-only introspection).
window.__sheets = { isOpen: () => sheetStack.length > 0, size: () => sheetStack.length };

/** Styled replacement for window.confirm(). Resolves true/false. */
function confirmSheet({ title, body, confirmText = "Lanjut", cancelText = "Batal", danger = false }) {
  return new Promise((resolve) => {
    let done = false;
    const s = openSheet(`
      <div class="sheet-handle"></div>
      <div class="sheet-title">${esc(title)}</div>
      ${body ? `<p class="sheet-sub">${body}</p>` : ""}
      <button class="${danger ? "btn-danger" : "btn-primary"}" data-act="ok">${esc(confirmText)}</button>
      <button class="btn-outline" data-act="cancel">${esc(cancelText)}</button>`,
      { onClose: () => { if (!done) resolve(false); }, noAutofocus: true });
    $('[data-act=ok]', s.sheet).addEventListener("click", () => { done = true; s.close(); resolve(true); });
    $('[data-act=cancel]', s.sheet).addEventListener("click", () => { done = true; s.close(); resolve(false); });
  });
}

/** Disable a button while an async action runs, so nothing double-submits. */
async function withBusy(btn, label, fn) {
  if (!btn || btn.disabled) return;
  const old = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span> ${esc(label || "Tunggu sebentar...")}`;
  try { return await fn(); }
  finally {
    if (btn.isConnected) { btn.disabled = false; btn.innerHTML = old; }
  }
}

// ---------- layout ----------
/** Wrap screen markup: main column + (optional) rail that holds the dock. */
function shell(main, side) {
  if (!side) return `<div class="shell shell-solo">${main}</div>`;
  return `<div class="shell"><div class="shell-main">${main}</div>
          <aside class="shell-side">${side}</aside></div>`;
}

/** Reserve exactly as much bottom padding as the dock actually occupies.
 *  The old fixed 96px was ~50px short of the guest bar, so the last item row
 *  sat underneath it and could not be tapped. */
function syncDockSpace() {
  const app = $("#app");
  if (!app) return;
  const dock = $(".dock, .sticky-bar");
  const onDesktop = window.matchMedia("(min-width:1040px)").matches;
  if (!dock || (onDesktop && dock.closest(".shell-side"))) { app.style.paddingBottom = ""; return; }
  app.style.paddingBottom = `calc(env(safe-area-inset-bottom) + ${dock.offsetHeight + 24}px)`;
  const t = $("#toast");
  if (t) t.style.bottom = `calc(env(safe-area-inset-bottom) + ${dock.offsetHeight + 16}px)`;
}
const dockObserver = window.ResizeObserver ? new ResizeObserver(syncDockSpace) : null;
function watchDock() {
  syncDockSpace();
  const dock = $(".dock, .sticky-bar");
  if (dock && dockObserver) { dockObserver.disconnect(); dockObserver.observe(dock); }
}
window.addEventListener("resize", syncDockSpace);

/** Sticky header shadow once the page scrolls. */
window.addEventListener("scroll", () => {
  const bar = $(".topbar");
  if (bar) bar.classList.toggle("scrolled", window.scrollY > 4);
}, { passive: true });

// ---------- skeletons ----------
function skeletonRows(n = 3) {
  return Array.from({ length: n }, () => `
    <div class="sk-row">
      <div class="sk" style="width:38px;height:38px;border-radius:12px;flex-shrink:0;"></div>
      <div style="flex:1;">
        <div class="sk sk-line" style="width:52%;"></div>
        <div class="sk sk-line" style="width:32%;margin-top:7px;height:10px;"></div>
      </div>
      <div class="sk sk-line" style="width:72px;"></div>
    </div>`).join("");
}

// ---------- dates ----------
function shortDate(iso) {
  if (!iso) return "";
  try {
    // date-only values are calendar dates, not instants — parsing "2026-08-08"
    // as UTC midnight rendered the day before for anyone west of UTC
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(String(iso).trim());
    const d = dateOnly ? new Date(iso + "T12:00:00") : new Date(String(iso).replace(" ", "T") + "Z");
    if (isNaN(d)) return iso;
    return d.toLocaleDateString("id-ID", { day: "numeric", month: "short" });
  } catch (e) { return iso; }
}
/** Year+month of a bill date AS RENDERED — same parse as shortDate/monthLabel.
 *  The filters used to slice the raw ISO string, which is UTC for created_at:
 *  a bill made at 01:00 WIB on 1 September sat under a "SEPTEMBER 2026" header
 *  and then vanished when you filtered by September (bug: the list and its own
 *  filter disagreed about which month a bill is in). */
function localYM(iso) {
  try {
    const s = String(iso || "").trim();
    if (!s) return null;
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(s);
    const d = dateOnly ? new Date(s + "T12:00:00") : new Date(s.replace(" ", "T") + "Z");
    if (isNaN(d)) return null;
    return { y: String(d.getFullYear()), m: String(d.getMonth() + 1).padStart(2, "0") };
  } catch (e) { return null; }
}

function monthLabel(iso) {
  try {
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(String(iso).trim());
    const d = dateOnly ? new Date(iso + "T12:00:00") : new Date(String(iso).replace(" ", "T") + "Z");
    if (isNaN(d)) return "";
    return d.toLocaleDateString("id-ID", { month: "long", year: "numeric" });
  } catch (e) { return ""; }
}

// Small shell-only additions stay here so the screen modules can remain
// focused on their existing form/event wiring.
function addOnboardingSteps() {
  const form = $("#onboard-form");
  const valueProp = form && form.previousElementSibling;
  if (!valueProp || $(".onboarding-steps")) return;
  valueProp.insertAdjacentHTML("afterend", `<ol class="onboarding-steps" aria-label="Cara kerja Bagiin">
    <li><b>1.</b><span>Buat bill + foto struk.</span></li>
    <li><b>2.</b><span>Pembayar membagi tiap item lewat tautan.</span></li>
    <li><b>3.</b><span>Semua orang transfer ke satu rekening metode bayar.</span></li>
  </ol>`);
}

// ---------- router ----------
function parseHash() {
  const h = location.hash.replace(/^#\/?/, "");
  const parts = h.split("/").filter(Boolean);
  return { parts };
}

function render() {
  const app = $("#app");
  const { parts } = parseHash();
  if (parts[0] === "b" && parts[1]) { loadBillView(parts[1]); return; }
  // leaving a bill: reset the stale-guard and drop any floating sheets so a
  // lingering confirm can't re-render the bill over the new screen (bug:
  // browser-back while a sheet was open + sheet confirm yanked the user back
  // into the bill while the URL said home)
  state.currentBillId = null;
  // Route render tears overlays down wholesale — sync the sheet registry too
  // so no orphan handle eats a later legitimate back press. Sentinel history
  // entries left behind are harmless: they duplicate the current URL, so
  // popping them changes nothing visually.
  $$(".sheet-overlay").forEach((s) => {
    const idx = sheetStack.findIndex((h) => h.overlay === s);
    if (idx !== -1) {
      const [dead] = sheetStack.splice(idx, 1);
      dead.overlay = null; // mark detached; its close() is a safe no-op now
      pendingSelfPops++;   // its sentinel is now an orphaned duplicate entry
    }
    s.remove();
  });
  if (pendingSelfPops > 0) drainSelfPops();
  sheetDepth = 0;
  document.body.style.overflow = "";
  app.classList.remove("settings-page");
  if (!state.identity) { renderOnboarding(); addOnboardingSteps(); return; }
  // History uses the same list data, but keeps its URL and heading honest.
  if (parts[0] === "settings") { app.classList.add("settings-page"); renderSettings(); return; }
  if (parts[0] === "create") {
    // #/create/verify is the OCR/manual editor (see renderVerify in
    // screens.js) — a real route so a page load / forward-nav / the guard
    // revert below all land on the right screen instead of a blank form.
    if (parts[1] === "verify") {
      if (typeof verifyHasTypedContent === "function" && verifyHasTypedContent()) {
        renderVerify(verifyState, verifyState.manual);
      } else {
        // direct hit / reload with nothing retained to show — bounce to a
        // fresh create screen rather than render an editor with no data
        location.hash = "#/create";
      }
      return;
    }
    renderCreate();
    return;
  }
  renderHome();
  if (parts[0] === "history") {
    const heading = $(".shell-main h1, .shell-solo h1");
    if (heading) heading.textContent = "Riwayat Bill";
  }
}

// ---------- navigation leave-guard ----------
// A screen can ask to be asked-before-leaving on ANY hashchange, not just
// clicks on its own in-app back button. Needed because the verify editor
// (renderVerify) has no route of its own by default in a hash router built
// only around #/, #/history, #/settings, #/create, #/b/<id> — so the
// Android system back gesture / browser Back fires `hashchange` straight
// into the router, bypassing whatever confirm the screen wired to its own
// back BUTTON (bug: system Back destroyed a re-typed receipt with zero
// warning, because popping the hash entry and re-rendering happens before
// any in-app handler gets a say).
//
// A pushState "sentinel" entry pushed on enter was the other option, but
// undoing a *cancelled* back with it means pushing a brand new entry every
// time (the popped one is gone from the back-stack for good) — the history
// stack grows by one per cancelled back press. `replaceState` instead
// mutates the CURRENT entry in place, so a cancelled leave costs nothing,
// and the rewrite happens synchronously BEFORE the async confirm sheet, so
// the address bar and the screen can never be caught disagreeing mid-ask.
let leaveGuardFn = null;   // async () => boolean; true = ok to leave
let guardedHash = null;    // the hash the current guard is protecting
let guardBusy = false;     // one confirm at a time — a double back-press must not stack sheets

function guardHash(fn) { guardedHash = location.hash; leaveGuardFn = fn; }
function clearHashGuard() { guardedHash = null; leaveGuardFn = null; }

async function onHashChange() {
  if (!leaveGuardFn || location.hash === guardedHash) { render(); return; }
  if (guardBusy) { history.replaceState(null, "", guardedHash); return; }
  guardBusy = true;
  const dest = location.hash;
  const fn = leaveGuardFn;
  history.replaceState(null, "", guardedHash);
  const ok = await fn();
  guardBusy = false;
  if (ok) {
    leaveGuardFn = null; guardedHash = null;
    history.replaceState(null, "", dest);
    render();
  }
  // not ok: already reverted above, screen was never touched — done.
}
window.addEventListener("hashchange", onHashChange);
// a dropped file anywhere outside the dropzone used to navigate the tab to the
// image and destroy the whole session
["dragover", "drop"].forEach(ev =>
  window.addEventListener(ev, (e) => { if (!e.target.closest(".dropzone")) e.preventDefault(); }));

ensureSecret();
