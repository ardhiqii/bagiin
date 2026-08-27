/* Bagiin frontend - screens
   onboarding · home · history · settings · create · OCR verify editor · rupiah inputs

   Shared helpers live in app.js and must NOT be redefined here: esc(), shortDate(),
   monthLabel(), ic(), openSheet(), confirmSheet(), withBusy(), shell(), watchDock(),
   skeletonRows(). (bug: this file used to carry its own esc()/shortDate() copies;
   because screens.js loads after app.js they shadowed the fixed versions and brought
   back the "date renders one day early west of UTC" bug.) */

// ---------- stale identity recovery ----------
// A localStorage identity the server has never seen (DB restored from backup,
// identity deleted) used to dead-end every screen with "Identity not found"
// printed as body text and no way out (bug: app permanently bricked for that
// device). Any /api/identities/* 404 now offers a reset.
function identityErrorHtml(e) {
  if (e && e.status === 404) {
    return `<div class="empty-state">${ic("alert")}
      <p><strong>Sesi kamu sudah tidak dikenal server.</strong></p>
      <p class="muted">Biasanya ini kejadian kalau data device kamu kehapus atau kepindah.
        Mulai ulang buat bikin identitas baru.</p>
      <button class="btn-primary stale-identity-reset" style="margin-top:14px;">Mulai Ulang</button>
    </div>`;
  }
  return `<div class="empty-state">${ic("alert")}
    <p>${esc((e && e.message) || "Gagal muat")}</p>
    <p class="muted">Coba lagi sebentar ya.</p></div>`;
}
function bindIdentityError(box) {
  $$(".stale-identity-reset", box).forEach(b => b.addEventListener("click", () => logout()));
}

// ---------- Onboarding ----------
function renderOnboarding() {
  const app = $("#app");
  const saved = lsGet(LS_KEYS.name, "");
  app.innerHTML = shell(`
    <div style="min-height:66dvh;display:flex;flex-direction:column;justify-content:center;max-width:420px;margin:0 auto;">
      <div style="margin-bottom:14px;">${brandMark(52)}</div>
      <div class="brand" style="font-size:24px;margin-bottom:10px;">Bagiin<span class="dot">.</span></div>
      <h1>Bagi bill dengan teman jadi lebih mudah.</h1>
      <p class="muted" style="margin:8px 0 22px;">Foto struk, bagikan tautan, semua orang memilih itemnya sendiri. Pajak otomatis ikut terbagi.</p>
      <form id="onboard-form" novalidate>
        <div class="field">
          <label for="name-input">Siapa nama kamu?</label>
          <input id="name-input" name="name" type="text" placeholder="Biar temen kamu tau ini kamu"
                 value="${esc(saved)}" maxlength="30" autocomplete="name">
        </div>
        <button class="btn-primary" type="submit" id="onboard-btn">Masuk</button>
      </form>
      <p class="muted" style="margin-top:14px;text-align:center;">Tanpa akun. Nama kamu hanya disimpen di device ini.</p>
      <p style="margin-top:6px;text-align:center;">
        <button class="btn-ghost btn-sm btn-auto" id="restore-link" aria-expanded="false" aria-controls="restore-box">
          Punya kode pemulihan?
        </button>
      </p>
      <form id="restore-box" class="hidden" style="margin-top:6px;" novalidate>
        <div class="field">
          <label for="restore-code">Kode Pemulihan</label>
          <input id="restore-code" name="code" placeholder="XXXX-XXXX-XXXX" maxlength="30" autocomplete="one-time-code">
        </div>
        <button class="btn-outline" type="submit" id="restore-btn">Pulihkan Akun</button>
      </form>
    </div>`);
  watchDock();

  const input = $("#name-input");
  try { input.focus(); } catch (e) {}

  // real <form> so Enter submits on both fields (a11y: keyboard-only users)
  $("#onboard-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = input.value.trim();
    if (!name) { toast("Isi nama dulu ya"); input.focus(); return; }
    withBusy($("#onboard-btn"), "Bentar...", async () => {
      try { await ensureIdentity(name); render(); }
      catch (err) { toast(err.message); }
    });
  });

  $("#restore-link").addEventListener("click", (e) => {
    e.preventDefault();
    const box = $("#restore-box");
    const open = box.classList.toggle("hidden") === false;
    $("#restore-link").setAttribute("aria-expanded", open ? "true" : "false");
    if (open) $("#restore-code").focus();
  });

  $("#restore-box").addEventListener("submit", (e) => {
    e.preventDefault();
    const code = $("#restore-code").value.trim();
    if (!code) { toast("Isi kodenya dulu"); return; }
    withBusy($("#restore-btn"), "Memulihkan...", async () => {
      try {
        const ident = await apiJson("/api/identities/restore", "POST", { code });
        state.identity = ident;
        lsSet(LS_KEYS.ident, ident);
        lsSet(LS_KEYS.name, ident.name);
        toast("Akun dipulihkan 🎉");
        render();
      } catch (err) { toast(err.message); }
    });
  });
}

// ---------- Home (dashboard) ----------
// Home used to show only the last few bills, with a separate Riwayat screen
// carrying the full list, four filter chips and two date selects. On a 390px
// phone the Riwayat filter row alone pushed the first bill below the fold, so
// filtering lived off home — but that left the app with two screens doing one
// job and "which one has the bill I want" as a standing question. K1 (v67):
// Riwayat is gone, home IS the list, and the filter/sort controls are folded
// behind ONE control on phones (a sheet) so the first row still doesn't
// scroll away — see the .list-controls-inline / #list-ctl-btn split below and
// the matching CSS in index.html.
function renderHome() {
  const app = $("#app");
  // esc() the name — it's user-typed and interpolated into innerHTML; without
  // escaping, a name like `<svg/onload=...>` executed on every home visit
  // (bug: self-XSS + broken "Halo" layout for names containing < >)
  const name = esc(String(state.identity.name || "").split(" ")[0]);
  app.innerHTML = shell(`
    <div class="topbar">
      <div class="brand"><span class="brand-mark">${brandMark(26)}</span>Bagiin<span class="dot">.</span></div>
      <div class="right">
        <button class="icon-btn" id="settings-btn" aria-label="Akun kamu">${ic("user")}</button>
      </div>
    </div>
    <div style="margin-bottom:18px;">
      <p class="muted">Halo, ${name}</p>
      <!-- card titles and buttons are Title Case, but this is a sentence —
           Title Case on a full question reads like a headline in English -->
      <h1>Mau bagi bill apa hari ini?</h1>
    </div>
    <button class="btn-primary" id="create-btn" style="margin-bottom:20px;">${ic("plus")} Buat Bill Baru</button>
    <div id="home-invites"></div>
    <div class="card">
      <div class="card-title">
        <span>Bill Kamu <span class="muted" id="list-summary"></span></span>
        <!-- phone: the ONE control — opens a sheet with the chips + selects
             below. Desktop hides this and shows .list-controls-inline instead
             (CSS media query, not JS branching on width, so a resize can
             never leave the screen showing both or neither — K2). -->
        <button type="button" class="link-btn list-ctl-btn" id="list-ctl-btn" aria-haspopup="dialog">
          ⇅ Atur<span id="list-ctl-count"></span>
        </button>
      </div>
      <div class="list-controls-inline" id="list-controls-inline"></div>
      <div id="home-history">${skeletonRows(4)}</div>
    </div>`);
  watchDock();

  $("#create-btn").addEventListener("click", () => location.hash = "#/create");
  $("#settings-btn").addEventListener("click", () => location.hash = "#/settings");
  $("#list-ctl-btn").addEventListener("click", () => openListControlsSheet());

  // paging is per-visit: leaving home at "80 rows shown" and coming back
  // (from a bill, from settings) should start from the top page again. The
  // filter/year/month/sort choices are NOT reset here — they live for the
  // session (K5).
  histState.limit = HIST_PAGE;
  loadBillList(false);  // false: a fresh visit may follow a mutation (new bill, delete, join) — refetch
  loadHomeInvites();
}

/** Pending direct-invite cards (v64): someone who already has an identity
 *  invited you to a bill but your auto_accept is OFF. One tap = join, no link
 *  needed. Cards disappear once accepted/declined. */
async function loadHomeInvites() {
  const box = $("#home-invites");
  if (!box || !state.identity) return;
  let invites;
  try {
    invites = await api(`/api/identities/${state.identity.id}/invites`);
  } catch (e) {
    box.innerHTML = ""; return;  // home shouldn't die over a side section
  }
  if (!invites.length) { box.innerHTML = ""; return; }
  box.innerHTML = `
    <div class="card" style="border-color:var(--accent-line);background:var(--accent-soft);">
      <div class="card-title"><span>${ic("hand")} Undangan bill</span></div>
      ${invites.map(v => `
        <div class="invite-row" data-invite="${v.id}" data-bill="${esc(v.bill_id)}">
          <div class="invite-row-info">
            <div class="person-name">${esc(v.bill_title)}</div>
            <div class="muted">dari <strong style="color:var(--text);">${esc(v.invited_by_name)}</strong> · ${fmt(v.bill_total)}</div>
          </div>
          <button class="btn-primary btn-sm inv-accept">${ic("check")} Gabung</button>
          <button class="btn-ghost btn-sm inv-decline" aria-label="Tolak undangan">${ic("x")}</button>
        </div>`).join("")}
      <p class="muted" style="margin-top:8px;font-size:12.5px;">${invites.length > 1 ? "Kamu diundang ke beberapa bill. Terima yang mau kamu ikutin." : "Kamu diundang langsung — tidak perlu link lagi."}</p>
    </div>`;
  $$(".inv-accept", box).forEach(b => b.addEventListener("click", async (ev) => {
    const row = b.closest(".invite-row");
    const invId = row.dataset.invite, billId = row.dataset.bill;
    // no busy lock meant a double-tap fired two accepts, and the second's
    // 400 replaced "Udah gabung 🎉" with "Undangan ini sudah diproses" (bug)
    await withBusy(b, "Gabung...", async () => {
      try {
        await apiJson(`/api/bills/${billId}/invites/${invId}/accept`, "POST", {});
        toast("Sudah bergabung 🎉");
        // re-render the whole card, not just row.remove(): the footer line is
        // written from invites.length, so removing one of two rows left "Kamu
        // diundang ke beberapa bill" over a single invite
        loadHomeInvites();
        loadBillList(false);  // bill baru muncul di list — force refetch (useCache=true reused the pre-join list and the new bill stayed invisible)
      } catch (e) {
        toast(e.message);
        loadHomeInvites();  // failure used to leave the stale card inviting another tap (bug)
      }
    });
  }));
  $$(".inv-decline", box).forEach(b => b.addEventListener("click", async (ev) => {
    const row = b.closest(".invite-row");
    const invId = row.dataset.invite, billId = row.dataset.bill;
    // decline is permanent server-side with no undo — the X is small and easy
    // to fat-finger, so ask first (bug: one tap on a 38px button destroyed an
    // invite forever)
    const ok = await confirmSheet({
      title: "Tolak undangan?",
      body: "Undangan ini akan terhapus — untuk menerimanya lagi nanti, minta pengundangnya mengirim ulang.",
      confirmText: "Tolak", cancelText: "Kembali", danger: true,
    });
    if (!ok) return;
    await withBusy(b, "", async () => {
      try {
        await apiJson(`/api/bills/${billId}/invites/${invId}/decline`, "POST", {});
        toast("Undangan ditolak");
        loadHomeInvites();   // same reason as accept: the footer counts rows
      } catch (e) {
        toast(e.message);
        loadHomeInvites();  // failure used to leave the stale card inviting another tap (bug)
      }
    });
  }));
}

/** One status per bill row, so the chip, the colour and the icon can't drift
 *  apart. `tone` drives the row's colour anchor. */
function billListStatus(b) {
  if (b.status === "closed") return { tone: "done", label: "Selesai", icon: "check" };
  if (b.settled) return { tone: "ok", label: "Lunas", icon: "check" };
  // a bill nobody has picked from isn't "belum lunas" — nobody owes anything
  // yet. Saying so put a red chip next to a green "Kamu sudah bayar" on a bill
  // where literally nothing had happened (bug: chips contradicted each other).
  if (!b.has_picks) return { tone: "idle", label: "Belum ada yang milih", icon: "receipt" };
  return { tone: "due", label: "Belum lunas", icon: "receipt" };
}

// Colour means MONEY here: green = beres, red = masih ada yang belum dibayar,
// abu = tidak ada yang ketagih (selesai / belum jalan). "Belum dipilih" used to
// wear the accent, so a normal list came up with four orange rows shouting the
// same colour as the "Buat Bill Baru" button — nothing stood out any more.
const STATUS_CHIP = { ok: "chip-green", due: "chip-red", done: "chip-grey", idle: "chip-grey" };

function billListStatusChip(b) {
  // text-only chips: the row avatar already carries the status icon, so an icon
  // on SOME chips but not others is just noise.
  const s = billListStatus(b);
  return `<span class="chip ${STATUS_CHIP[s.tone]}">${esc(s.label)}</span>`;
}

// personal line for the CURRENT viewer — only meaningful while the bill is
// open (or closed-unsettled), has picks, and isn't fully settled.
// NOTE closed bills are NOT excluded: a closed bill that still has an unpaid
// share must keep telling the debtor "Kamu belum bayar" — hiding it made
// closed debts invisible (bug: chip said "Selesai" while the user still owed).
function personalStatusHtml(b) {
  if (b.settled || !b.has_picks) return "";
  // the payer never "paid" — they fronted the money. Calling that "sudah bayar"
  // is what made a fresh bill claim a payment that never happened.
  // personal lines are always neutral: the chip already owns the status colour,
  // so colouring the line too makes one row scream two messages at once.
  if (b.i_am_payer) return `<div class="item-share">Kamu yang membayar dahulu</div>`;
  return b.my_paid
    ? `<div class="item-share">Kamu sudah bayar</div>`
    : `<div class="item-share">Kamu belum bayar</div>`;
}

function billRowHtml(b) {
  const when = b.transacted_at || b.created_at;
  const s = billListStatus(b);
  // A list of identical grey rows is unreadable at a glance — you have to stop
  // and read each chip to know what needs doing. The colour bar + tinted icon
  // give the eye something to scan, and both come from the same status object
  // as the chip so they can never disagree.
  return `
    <div class="history-row is-${s.tone}" role="button" tabindex="0" data-id="${esc(b.id)}"
         aria-label="Buka bill ${esc(b.title)}, ${esc(s.label)}">
      <div class="avatar status-mark" aria-hidden="true">${ic(s.icon)}</div>
      <div class="row-body">
        <div class="row-title">
          <span class="item-name">${esc(b.title)}</span>
          <span class="muted row-date">${esc(shortDate(when))}</span>
        </div>
        <div class="row-meta">
          ${billListStatusChip(b)}
          <span class="money row-amount">${fmt(b.total_idr)}</span>
        </div>
        ${personalStatusHtml(b)}
      </div>
      <!-- keep the column width so the amounts line up down the list, but a
           bill you can't delete gets empty space, not a greyed-out trash can:
           a dead destructive control on most rows is noise, not information -->
      ${b.can_manage
        ? `<button class="icon-btn ghost delete-bill" data-id="${esc(b.id)}"
              data-title="${esc(b.title)}" aria-label="Hapus bill ${esc(b.title)}">${ic("trash")}</button>`
        : `<span class="row-gap" aria-hidden="true"></span>`}
    </div>`;
}

function bindBillRows(box, onDone) {
  $$(".history-row", box).forEach(r => {
    const open = () => location.hash = "#/b/" + r.dataset.id;
    r.addEventListener("click", (e) => { if (e.target.closest(".delete-bill")) return; open(); });
    // the row is a div (it contains its own delete <button>, so it can't BE a
    // button) — give it real keyboard semantics instead
    r.addEventListener("keydown", (e) => {
      if (e.target !== r) return;
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
    });
  });
  $$(".delete-bill", box).forEach(btn => btn.addEventListener("click", (e) => {
    e.stopPropagation();
    // openDeleteBillConfirm (bill.js) ends with location.hash = "#/" — which
    // fires no hashchange when we're already on "#/", so the deleted row stayed
    // on screen until a manual reload (bug: ghost row after delete from home).
    // The third arg re-renders the list ourselves.
    openDeleteBillConfirm(btn.dataset.id, btn.dataset.title, onDone);
  }));
}

// ---------- Bill list (home) — filter, sort, paging (K1-K6, v67) ----------
// page size — renders in batches so a long list doesn't build one giant
// string / thousands of nodes at once (bug: everything rendered at once)
const HIST_PAGE = 20;
const DEFAULT_SORT = "date_desc";
// sort persists across reloads (K5) — filter/year/month deliberately do NOT
// (see resetListControls callers and the histState init below): opening the
// app into a filtered list makes bills look missing, and that's a support
// nightmare this codebase has already been burned by.
let histState = {
  filter: "all", year: "all", month: "all",
  sort: lsGet(LS_KEYS.listSort, DEFAULT_SORT),
  limit: HIST_PAGE,
};
// client-side bill cache so switching filters/sort re-renders instantly
// instead of refetching the whole list over the network every time (bug:
// sluggish filters)
let histBills = null;
// years available in the current histBills — recomputed on every fetch,
// cached here so the sheet (opened on demand, no fetch of its own) can build
// its year <select> from the same data the inline controls used
let histYears = [];
// month options are fixed (Januari..Desember) — only the year list is derived
// from data, so a "all years + Juli" filter can span every July on record
const MONTH_OPTS = [
  ["01", "Januari"], ["02", "Februari"], ["03", "Maret"], ["04", "April"],
  ["05", "Mei"], ["06", "Juni"], ["07", "Juli"], ["08", "Agustus"],
  ["09", "September"], ["10", "Oktober"], ["11", "November"], ["12", "Desember"],
];
// K3: exact order and semantics. "date" always means transacted_at ?? created_at,
// parsed the same way shortDate/localYM/monthLabel do (see _billTs below) — a
// raw string compare is wrong (see the mixed date-only/datetime comment there).
const SORT_OPTS = [
  ["date_desc", "Terbaru"],
  ["date_asc", "Terlama"],
  ["amount_desc", "Paling besar"],
  ["amount_asc", "Paling kecil"],
  ["due_first", "Belum beres dulu"],
];

// filter options map to billListStatus tones so chip, filter and row can't
// disagree about what "lunas" means
const HIST_FILTERS = [
  { v: "all", label: "Semua" },
  { v: "due", label: "Belum lunas" },
  { v: "ok",  label: "Lunas" },
  { v: "idle", label: "Belum dipilih" },
];

function availableYears(bills) {
  const years = [];
  for (const b of bills) {
    const ym = localYM(b.transacted_at || b.created_at);
    if (ym && !years.includes(ym.y)) years.push(ym.y);
  }
  return years.sort().reverse();
}

function passHistoryFilter(b) {
  // localYM, not a string slice: the month header is rendered in local time
  // (see app.js), so slicing the raw UTC timestamp filed late-night bills under
  // the previous month and the filter hid rows the list was still grouping
  // under the month you picked
  const ym = localYM(b.transacted_at || b.created_at);
  if (histState.year !== "all" && (!ym || ym.y !== histState.year)) return false;
  if (histState.month !== "all" && (!ym || ym.m !== histState.month)) return false;
  if (histState.filter === "all") return true;
  const tone = billListStatus(b).tone;
  // a closed bill wears "Selesai" (tone done), but if everyone settled it's
  // still lunas — filter "Lunas" must find it (bug: closed & settled bills
  // vanished from the Lunas filter; "Kitchen & Dimsum" case, 2026-08)
  if (histState.filter === "ok") return tone === "ok" || (tone === "done" && b.settled);
  if (histState.filter === "due")
    // a closed bill with unpaid shares wears "Selesai" (tone done) but is
    // still outstanding — "Belum lunas" must find it (bug: closed debts
    // vanished from the red filter)
    return tone === "due" || (tone === "done" && !b.settled);
  return tone === histState.filter;
}

// The one "what date is this bill" value — shared by sorting, the month
// headers (via monthLabel) and the row date (via shortDate) so none of them
// can disagree. transacted_at is sometimes date-only ("2026-08-18") and
// sometimes a datetime — comparing raw strings would order "2026-08-18"
// before "2026-08-18 10:30:00" and shuffle same-day rows (bug: localeCompare
// on mixed formats), so this always goes through Date.
function _billTs(b) {
  const iso = String(b.transacted_at || b.created_at || "");
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(iso);
  const d = dateOnly ? new Date(iso + "T12:00:00") : new Date(iso.replace(" ", "T") + "Z");
  return isNaN(d) ? 0 : d.getTime();
}

// K3: sorts a COPY of `bills`. Array#sort is stable in every engine this app
// ships to, so "equal keys keep their relative order" falls out for free as
// long as the comparator only returns 0 for a genuine tie — it's never forced.
function sortBills(bills, sortMode) {
  const dateDesc = (a, b) => _billTs(b) - _billTs(a);
  if (sortMode === "date_asc") return bills.slice().sort((a, b) => _billTs(a) - _billTs(b));
  if (sortMode === "amount_desc") return bills.slice().sort((a, b) => (b.total_idr - a.total_idr) || dateDesc(a, b));
  if (sortMode === "amount_asc") return bills.slice().sort((a, b) => (a.total_idr - b.total_idr) || dateDesc(a, b));
  if (sortMode === "due_first") {
    // due first, then idle, then everything else (ok/done) — each group
    // newest-first, same as the default sort
    const rank = (b) => { const t = billListStatus(b).tone; return t === "due" ? 0 : t === "idle" ? 1 : 2; };
    return bills.slice().sort((a, b) => (rank(a) - rank(b)) || dateDesc(a, b));
  }
  return bills.slice().sort(dateDesc);  // date_desc, the default
}

// ---------- controls: chips + selects, shared markup for the desktop inline
// row and the phone sheet so they can never drift apart (K2) ----------
function listFilterChipsHtml() {
  return HIST_FILTERS.map(f =>
    `<button type="button" class="chip-btn ${histState.filter === f.v ? "chip-active" : ""}"
             data-role="list-filter" data-filter="${f.v}"
             aria-pressed="${histState.filter === f.v}">${esc(f.label)}</button>`).join("");
}
function yearOptionsHtml(years) {
  return `<option value="all"${histState.year === "all" ? " selected" : ""}>Semua tahun</option>`
    + years.map(y => `<option value="${y}"${histState.year === y ? " selected" : ""}>${esc(y)}</option>`).join("");
}
function monthOptionsHtml() {
  return `<option value="all"${histState.month === "all" ? " selected" : ""}>Semua bulan</option>`
    + MONTH_OPTS.map(([v, l]) => `<option value="${v}"${histState.month === v ? " selected" : ""}>${l}</option>`).join("");
}
function sortOptionsHtml() {
  return SORT_OPTS.map(([v, l]) => `<option value="${v}"${histState.sort === v ? " selected" : ""}>${l}</option>`).join("");
}

function activeControlsCount() {
  let n = 0;
  if (histState.filter !== "all") n++;
  if (histState.year !== "all") n++;
  if (histState.month !== "all") n++;
  if (histState.sort !== DEFAULT_SORT) n++;
  return n;
}

// keeps whichever chip/badge/reset-button instances currently exist (inline
// AND, if open, the sheet) showing the same state — cheaper than re-rendering
// either block on every tap
function syncControlsDom() {
  $$('[data-role="list-filter"]').forEach(btn => {
    const on = btn.dataset.filter === histState.filter;
    btn.classList.toggle("chip-active", on);
    btn.setAttribute("aria-pressed", String(on));
  });
  const n = activeControlsCount();
  const badge = $("#list-ctl-count");
  if (badge) badge.textContent = n ? ` · ${n}` : "";
  const resetBtn = $("#list-ctl-reset");
  if (resetBtn) resetBtn.classList.toggle("hidden", n === 0);
}

function bindListControls(container) {
  $$('[data-role="list-filter"]', container).forEach(btn =>
    btn.addEventListener("click", () => setListFilter(btn.dataset.filter)));
  const ySel = $('[data-role="list-year"]', container);
  if (ySel) ySel.addEventListener("change", () => setListYear(ySel.value));
  const mSel = $('[data-role="list-month"]', container);
  if (mSel) mSel.addEventListener("change", () => setListMonth(mSel.value));
  const sSel = $('[data-role="list-sort"]', container);
  if (sSel) sSel.addEventListener("change", () => setListSort(sSel.value));
}

// every control change resets paging to page one (K4) — otherwise a filter
// change silently kept rendering however many rows "Muat lagi" had already
// grown the page to, and re-renders from the client cache, never refetching
function setListFilter(v) {
  if (histState.filter === v) return;
  histState.filter = v; histState.limit = HIST_PAGE;
  syncControlsDom(); loadBillList(true);
}
function setListYear(v) {
  histState.year = v; histState.limit = HIST_PAGE;
  syncControlsDom(); loadBillList(true);
}
function setListMonth(v) {
  histState.month = v; histState.limit = HIST_PAGE;
  syncControlsDom(); loadBillList(true);
}
function setListSort(v) {
  histState.sort = v; histState.limit = HIST_PAGE;
  lsSet(LS_KEYS.listSort, v);
  syncControlsDom(); loadBillList(true);
}
function resetListControls() {
  histState.filter = "all"; histState.year = "all"; histState.month = "all";
  histState.sort = DEFAULT_SORT; lsSet(LS_KEYS.listSort, DEFAULT_SORT);
  histState.limit = HIST_PAGE;
  syncControlsDom(); loadBillList(true);
}

// Desktop (>=1040px, CSS-only switch — see index.html): chips on one row,
// the three selects on the next, always visible, no sheet.
function renderListControlsInline() {
  const box = $("#list-controls-inline");
  if (!box) return;
  box.innerHTML = `
    <div class="list-chip-row">${listFilterChipsHtml()}</div>
    <div class="list-select-row">
      <select data-role="list-year" aria-label="Filter tahun">${yearOptionsHtml(histYears)}</select>
      <select data-role="list-month" aria-label="Filter bulan">${monthOptionsHtml()}</select>
      <select data-role="list-sort" aria-label="Urutan">${sortOptionsHtml()}</select>
    </div>`;
  bindListControls(box);
}

// Phone (<1040px): the ONE control on the card header opens this. Chips +
// selects apply live (same handlers as the inline row) so the list behind
// the sheet updates as you tap; Terapkan just closes, Reset clears everything
// back to default and closes too.
function openListControlsSheet() {
  const s = openSheet(`
    <div class="sheet-handle"></div>
    <div class="sheet-title">Filter &amp; Urutkan</div>
    <div class="list-chip-row">${listFilterChipsHtml()}</div>
    <div class="field">
      <label for="list-year-sheet">Tahun</label>
      <select id="list-year-sheet" data-role="list-year">${yearOptionsHtml(histYears)}</select>
    </div>
    <div class="field">
      <label for="list-month-sheet">Bulan</label>
      <select id="list-month-sheet" data-role="list-month">${monthOptionsHtml()}</select>
    </div>
    <div class="field">
      <label for="list-sort-sheet">Urutan</label>
      <select id="list-sort-sheet" data-role="list-sort">${sortOptionsHtml()}</select>
    </div>
    <button class="btn-primary" id="list-ctl-apply">Terapkan</button>
    <button class="btn-outline ${activeControlsCount() ? "" : "hidden"}" id="list-ctl-reset">Reset</button>`);
  bindListControls(s.sheet);
  $("#list-ctl-apply", s.sheet).addEventListener("click", () => s.close());
  $("#list-ctl-reset", s.sheet).addEventListener("click", () => { resetListControls(); s.close(); });
}

function updateListSummary(shown, total) {
  const box = $("#list-summary");
  if (!box) return;
  box.textContent = total === 0 ? "" : (shown === total ? `${total} bill` : `${shown} dari ${total}`);
}

// the one list renderer — home is the only screen bills live on now (K1).
// `useCache` = reuse the previously fetched list (filter/sort/paging
// changes); pass false when the data may have changed (fresh visit, delete,
// a join/accept elsewhere).
async function loadBillList(useCache) {
  const box = $("#home-history");
  if (!box) return;
  try {
    if (!useCache || !histBills) {
      histBills = await api("/api/identities/" + state.identity.id + "/bills");
    }
    const bills = histBills;
    const ctlBtn = $("#list-ctl-btn"), inlineBox = $("#list-controls-inline");
    if (!bills.length) {
      // nothing to filter yet — hide the controls rather than show a live
      // "Atur" button and an inline row over an empty card
      if (ctlBtn) ctlBtn.classList.add("hidden");
      if (inlineBox) inlineBox.innerHTML = "";
      updateListSummary(0, 0);
      box.innerHTML = `<div class="empty-state">${ic("empty")}
        <p>Belum ada bill.</p><p class="muted">Bill yang kamu buat atau kamu ikuti akan muncul di sini.</p></div>`;
      return;
    }
    if (ctlBtn) ctlBtn.classList.remove("hidden");
    // rebuild the year list on every fetch — a conditional append left stale
    // years behind after a delete (bug: deleted bill's year stayed
    // selectable and returned an empty result). Keep "Semua tahun" as an
    // actual option (not a hardcoded default the select falls back to): once
    // a specific year was picked there used to be no way back to "all" (bug:
    // a filter you can't turn off).
    histYears = availableYears(bills);
    if (histState.year !== "all" && !histYears.includes(histState.year)) {
      // the year the user had selected no longer exists (its bills got
      // deleted) — fall back rather than strand them on a dead filter
      histState.year = "all";
    }
    renderListControlsInline();
    syncControlsDom();

    const filtered = bills.filter(passHistoryFilter);
    updateListSummary(filtered.length, bills.length);
    if (!filtered.length) {
      box.innerHTML = `<div class="empty-state">${ic("empty")}
        <p>Tidak ada bill yang cocok.</p><p class="muted">Coba ganti filternya.</p>
        <button type="button" class="btn-outline btn-sm" id="list-empty-reset" style="margin-top:14px;">Reset filter</button></div>`;
      $("#list-empty-reset", box).addEventListener("click", resetListControls);
      return;
    }
    const sorted = sortBills(filtered, histState.sort);
    const page = sorted.slice(0, histState.limit);
    // month headers only mean something when the list is actually ordered by
    // date — over an amount or status sort, a "AGUSTUS 2026" header sitting
    // above rows from four different months would just be a lie (K3)
    const showMonths = histState.sort === "date_desc" || histState.sort === "date_asc";
    let html = "", lastMonth = null;
    for (const b of page) {
      if (showMonths) {
        const m = monthLabel(b.transacted_at || b.created_at) || "Tanpa tanggal";
        if (m !== lastMonth) { html += `<div class="history-month">${esc(m)}</div>`; lastMonth = m; }
      }
      html += billRowHtml(b);
    }
    if (sorted.length > histState.limit) {
      const rest = sorted.length - histState.limit;
      html += `<button type="button" class="btn-outline btn-sm" id="home-more" style="width:100%;margin-top:12px;">Muat ${Math.min(rest, HIST_PAGE)} lagi (${rest} tersisa)</button>`;
    }
    box.innerHTML = html;
    bindBillRows(box, () => loadBillList(false));
    const moreBtn = $("#home-more");
    if (moreBtn) moreBtn.addEventListener("click", () => {
      histState.limit += HIST_PAGE;
      loadBillList(true);
    });
  } catch (e) {
    box.innerHTML = identityErrorHtml(e);
    bindIdentityError(box);
    if (!e || e.status !== 404) toast(e.message);
  }
}

// ---------- Settings / Akun ----------
const BRANDS = [
  { c: "BCA", hex: "#0060AF" }, { c: "BNI", hex: "#F15A23" }, { c: "BRI", hex: "#00529C" },
  { c: "Mandiri", hex: "#003A70" }, { c: "BTN", hex: "#0069AB" }, { c: "CIMB", hex: "#790008" },
  { c: "Permata", hex: "#007592" }, { c: "BSI", hex: "#00A39D" }, { c: "Danamon", hex: "#046148" },
  { c: "Maybank", hex: "#231F20" }, { c: "Panin", hex: "#007DC5" }, { c: "Mega", hex: "#FFCA08" },
  { c: "OCBC", hex: "#D10A10" }, { c: "BTPN", hex: "#EF7D00" }, { c: "UOB", hex: "#F5333F" },
  { c: "Jatim", hex: "#E5252A" }, { c: "DKI", hex: "#E62129" }, { c: "BJB", hex: "#1B517E" },
  { c: "Sinarmas", hex: "#ED1D24" }, { c: "Jago", hex: "#FDAF27" }, { c: "Jenius", hex: "#00A4DE" },
  { c: "SeaBank", hex: "#EA5F00" }, { c: "BNC", hex: "#FFBE00" }, { c: "Superbank", hex: "#AFEE01" },
  { c: "Allo", hex: "#FFBC25" }, { c: "Blu", hex: "#33CDCF" }, { c: "Krom", hex: "#6936D3" },
  { c: "LINE", hex: "#00D200" }, { c: "GoPay", hex: "#00AED6" }, { c: "OVO", hex: "#5827D4" },
  { c: "DANA", hex: "#008CEB" }, { c: "ShopeePay", hex: "#E8451E" }, { c: "LinkAja", hex: "#E82529" },
  // parseAccountsText falls back to "Lainnya" for a bare number with no brand
  // above it. It was NOT in this list, so the <select> fell back to its first
  // option ("BCA") while "Lainnya" was still what got POSTed (bug: saved brand
  // silently disagreed with what the user saw selected).
  { c: "Lainnya", hex: "#6B6259" },
];
// case-insensitive: accounts saved by an older build (or by the paste parser
// before it canonicalised) carry values like "bca", and an exact match dropped
// them to a grey unbranded chip
function brandInfo(code) {
  const k = String(code || "").toLowerCase();
  return BRANDS.find(b => b.c.toLowerCase() === k) || null;
}

/** Display name for a stored brand: canonical casing when we know the brand
 *  ("bca" -> "BCA", "gopay" -> "GoPay"), the raw value otherwise. */
function brandLabel(code) {
  const b = brandInfo(code);
  return b ? b.c : String(code || "");
}
function chipTextColor(hex) {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) > 165 ? "#18181B" : "#fff";
}
function brandChipHtml(code) {
  const b = brandInfo(code);
  const bg = b ? b.hex : "#6B6259";
  return `<span class="brand-chip" style="background:${bg};color:${chipTextColor(bg)}">${esc(code)}</span>`;
}

function renderSettings() {
  const app = $("#app");
  const me = state.identity;
  // null = belum ketauan (request /me masih jalan / gagal). Dipakai buat copy
  // logout, jadi default-nya sengaja yang paling hati-hati.
  let hasCode = null;

  app.innerHTML = shell(`
    <div class="topbar">
      <button class="icon-btn" id="back-btn" aria-label="Kembali ke beranda">${ic("back")}</button>
      <div class="topbar-title">Akun</div>
      <div style="width:42px;flex-shrink:0;" aria-hidden="true"></div>
    </div>

    <form class="card" id="name-form" novalidate>
      <div class="card-title"><span>Nama</span></div>
      <label for="name-input">Nama ini yang dilihat orang pas milih item bill</label>
      <div class="field-row">
        <input id="name-input" name="name" value="${esc(me.name)}" maxlength="30" autocomplete="name">
        <button class="btn-primary btn-sm" type="submit" id="save-name" style="flex:0 0 auto;">Simpan</button>
      </div>
    </form>

    <div class="card">
      <div class="card-title"><span>Kode Pemulihan</span></div>
      <p class="muted" style="margin-bottom:12px;">
        Kode untuk memindahkan akun kamu ke browser atau perangkat lain. Kode ini hanya ditampilkan sekali
        — pas dibuat. Kalau kamu bikin kode baru, kode lama langsung mati.
      </p>
      <div id="code-box"><div class="sk sk-line" style="height:44px;"></div></div>
    </div>

    <div class="card">
      <div class="card-title"><span>Undangan</span></div>
      <div class="toggle-row" style="padding:10px 0;">
        <div>
          <span class="label-strong">Langsung masuk bill</span>
          <span class="muted" style="font-size:12.5px;display:block;margin-top:2px;">Kalau ada yang undang kamu ke bill, kamu langsung ikut — tidak perlu klik apa-apa, kayak grup WA.</span>
        </div>
        <button class="switch" id="auto-accept-switch" role="switch" aria-checked="true" aria-label="Langsung masuk bill pas diundang" disabled></button>
      </div>
      <p class="muted" style="font-size:12.5px;">Nonaktifkan kalau kamu ingin melihat dulu siapa yang mengundang sebelum ikut. Undangan akan muncul di beranda untuk diterima atau ditolak.</p>
    </div>

    <div class="card">
      <div class="card-title"><span>Metode Bayar</span></div>
      <p class="muted" style="margin-bottom:10px;">Nomor ini bakal ditampilin ke orang yang mau bayar bill kamu.</p>
      <div id="accounts-list">${skeletonRows(2)}</div>
      <div class="btn-row" style="margin-top:10px;">
        <button class="btn-outline btn-sm" id="add-account-btn">${ic("plus")} Tambah</button>
        <button class="btn-outline btn-sm" id="paste-account-btn">${ic("clipboard")} Tempel Teks</button>
      </div>
      <form id="account-form" class="hidden" style="margin-top:12px;" novalidate>
        <div class="field">
          <label for="acct-brand">Bank / E-Wallet</label>
          <select id="acct-brand" name="brand"></select>
        </div>
        <div class="field">
          <label for="acct-no">Nomor Rekening / E-Money</label>
          <input id="acct-no" name="account_no" maxlength="40" inputmode="numeric" autocomplete="off">
        </div>
        <div class="field">
          <label for="acct-holder">Atas Nama (Opsional)</label>
          <input id="acct-holder" name="holder_name" maxlength="40" autocomplete="off">
        </div>
        <div class="btn-row">
          <button class="btn-primary btn-sm" type="submit" id="save-account">Simpan</button>
          <button class="btn-ghost btn-sm" type="button" id="cancel-account">Batal</button>
        </div>
      </form>
    </div>

    <button class="btn-danger-ghost" id="logout-btn">${ic("logout")} Keluar</button>`);
  watchDock();

  $("#back-btn").addEventListener("click", () => location.hash = "#/");

  // ----- name -----
  $("#name-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("#name-input").value.trim();
    if (!name) { toast("Isi nama dulu ya"); return; }
    withBusy($("#save-name"), "Nyimpen", async () => {
      try {
        await apiJson(`/api/identities/${me.id}/name`, "POST", { name });
        state.identity.name = name;
        lsSet(LS_KEYS.name, name);
        toast("Nama diupdate");
      } catch (err) { toast(err.message); }
    });
  });

  // ----- recovery code -----
  // The box used to always render "Buat Kode", and tapping it POSTed straight
  // to /code/generate — silently killing a code the user had already written
  // down (bug: recovery code destroyed by a curious tap). GET /me tells us
  // whether one exists, and regenerating now goes through a confirm.
  const showGeneratedCode = (code) => {
    const box = $("#code-box");
    if (!box) return;
    hasCode = true;
    box.innerHTML = `
      <div class="code-display">${esc(code)}</div>
      <div class="btn-row" style="margin-top:10px;">
        <button class="btn-primary btn-sm" id="copy-code">${ic("copy")} Salin</button>
      </div>
      <p class="muted" style="margin-top:8px;">Catat sekarang — kode ini tidak bakal ditampilin lagi.
        Kalau kamu bikin kode baru nanti, yang ini langsung mati.</p>`;
    $("#copy-code").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(code); toast("Kode disalin"); }
      catch (err) { toast("Gagal salin, catat manual aja ya"); }
    });
  };

  const generate = (btn) => withBusy(btn, "Bikin kode", async () => {
    try {
      const r = await apiJson(`/api/identities/${me.id}/code/generate`, "POST", {});
      showGeneratedCode(r.code);
    } catch (err) { toast(err.message); }
  });

  const renderCodeBox = (has) => {
    const box = $("#code-box");
    if (!box) return;
    hasCode = has;
    box.innerHTML = has
      ? `<div class="info-box" style="display:flex;gap:9px;align-items:flex-start;margin-bottom:10px;">
           ${ic("check")}<span>Kamu sudah punya kode pemulihan. Simpan baik-baik ya — itu satu-satunya
           cara balik ke akun ini kalau data browser kamu kehapus.</span>
         </div>
         <button class="btn-outline btn-sm" id="regen-code" style="width:100%;">${ic("refresh")} Bikin Kode Baru</button>`
      : `<button class="btn-outline" id="gen-code">${ic("key")} Buat Kode</button>`;
    const gen = $("#gen-code");
    if (gen) gen.addEventListener("click", () => generate(gen));
    const regen = $("#regen-code");
    if (regen) regen.addEventListener("click", async () => {
      const ok = await confirmSheet({
        title: "Bikin kode baru?",
        body: "Kode pemulihan yang lama <strong>langsung mati</strong> begitu kode baru dibuat. Kalau kamu sudah nyatet yang lama, catatan itu jadi tidak kepake.",
        confirmText: "Bikin kode baru",
        danger: true,
      });
      if (ok) generate(regen);
    });
  };

  (async () => {
    try {
      const info = await api(`/api/identities/${me.id}/me`);
      renderCodeBox(!!info.has_code);
      const sw = $("#auto-accept-switch");
      if (sw) {
        const on = info.auto_accept !== false;
        sw.setAttribute("aria-checked", String(on));
        sw.disabled = false;  // only clickable once /me resolved (no state flash)
        sw.addEventListener("click", async () => {
          const next = sw.getAttribute("aria-checked") !== "true";
          sw.setAttribute("aria-checked", String(next));
          try {
            await apiJson(`/api/identities/${me.id}/auto_accept`, "POST", { auto_accept: next });
            toast(next ? "Undangan langsung masuk ya" : "Undangan bakal nunggu kamu terima");
          } catch (e) {
            sw.setAttribute("aria-checked", String(!next));  // rollback optimistically
            toast(e.message);
          }
        });
      }
    } catch (e) {
      const box = $("#code-box");
      if (box) { box.innerHTML = identityErrorHtml(e); bindIdentityError(box); }
    }
  })();

  // ----- payment accounts -----
  const loadAccounts = async () => {
    const box = $("#accounts-list");
    if (!box) return;
    try {
      const accts = await api(`/api/identities/${me.id}/accounts`);
      if (!accts.length) {
        box.innerHTML = `<div class="empty-state" style="padding:18px 8px;">${ic("wallet")}
          <p class="muted">Belum ada metode bayar.</p></div>`;
        return;
      }
      box.innerHTML = accts.map(a => `
        <div class="account-row">
          ${brandChipHtml(a.brand)}
          <div style="flex:1;min-width:0;">
            <div class="item-name">${esc(brandLabel(a.brand))}</div>
            <div class="muted">${esc(a.account_no)}${a.holder_name ? " · " + esc(a.holder_name) : ""}</div>
          </div>
          <button class="icon-btn ghost" data-edit="${a.id}" aria-label="Edit ${esc(a.brand)} ${esc(a.account_no)}">${ic("pencil")}</button>
          <button class="icon-btn ghost" data-del="${a.id}" aria-label="Hapus ${esc(a.brand)} ${esc(a.account_no)}">${ic("trash")}</button>
        </div>`).join("");
      $$("[data-edit]", box).forEach(b => b.addEventListener("click", () => {
        const acc = accts.find(x => String(x.id) === String(b.dataset.edit));
        if (acc) openEditAccountSheet(acc, loadAccounts);
      }));
      $$("[data-del]", box).forEach(b => b.addEventListener("click", async () => {
        const acc = accts.find(x => String(x.id) === String(b.dataset.del));
        const ok = await confirmSheet({
          title: "Hapus metode bayar?",
          body: acc ? `${esc(acc.brand)} · ${esc(acc.account_no)} akan terhapus dari semua bill kamu.` : "",
          confirmText: "Hapus", danger: true,
        });
        if (!ok) return;
        try { await api("/api/accounts/" + b.dataset.del, { method: "DELETE" }); loadAccounts(); }
        catch (e) { toast(e.message); }
      }));
    } catch (e) {
      box.innerHTML = identityErrorHtml(e);
      bindIdentityError(box);
    }
  };
  loadAccounts();

  $("#acct-brand").innerHTML = BRANDS.map(b => `<option value="${esc(b.c)}">${esc(b.c)}</option>`).join("");
  $("#add-account-btn").addEventListener("click", () => {
    const form = $("#account-form");
    form.classList.toggle("hidden");
    if (!form.classList.contains("hidden")) $("#acct-no").focus();
  });
  $("#cancel-account").addEventListener("click", () => $("#account-form").classList.add("hidden"));
  $("#account-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const brand = $("#acct-brand").value;
    const account_no = $("#acct-no").value.trim();
    const holder_name = $("#acct-holder").value.trim();
    if (!account_no) { toast("Isi nomornya dulu"); $("#acct-no").focus(); return; }
    withBusy($("#save-account"), "Nyimpen", async () => {
      try {
        await apiJson(`/api/identities/${me.id}/accounts`, "POST", { brand, account_no, holder_name });
        $("#account-form").classList.add("hidden");
        $("#acct-no").value = ""; $("#acct-holder").value = "";
        toast("Metode bayar ditambah");
        loadAccounts();
      } catch (err) { toast(err.message); }
    });
  });

  // paste-text account parser
  $("#paste-account-btn").addEventListener("click", () => openPasteAccountsSheet(me.id, loadAccounts));

  // ----- logout -----
  // Old copy claimed the name & history get deleted. Nothing server-side is
  // deleted — what actually happens is the device forgets the identity, and
  // without a recovery code every bill becomes unreachable forever
  // (bug: users tapped "Keluar" expecting a cleanup and lost all their bills).
  $("#logout-btn").addEventListener("click", async () => {
    const ok = await confirmSheet({
      title: "Keluar dari akun ini?",
      body: hasCode === true
        ? "Device ini bakal lupa siapa kamu. Semua bill kamu masih ada, tapi hanya bisa dibuka lagi pakai <strong>kode pemulihan</strong> kamu."
        : hasCode === false
          ? "<strong>Kamu belum punya kode pemulihan.</strong> Kalau keluar sekarang, semua bill kamu tidak bisa dibuka lagi — selamanya, di HP ini maupun di HP lain. Bikin kode pemulihan dulu kalau masih butuh billnya."
          : "Device ini bakal lupa siapa kamu. Status kode pemulihan kamu belum sempat kecek (cek koneksi) — kalau ternyata kamu belum bikin kode, bill kamu tidak bisa dibuka lagi. Amanin dulu di halaman ini kalau masih butuh billnya.",
      confirmText: "Keluar",
      danger: true,
    });
    if (ok) logout();
  });
}

// ---------- Paste-text account parser ----------
const BRAND_ALIASES = {
  "gopay": "GoPay", "go pay": "GoPay", "go-pay": "GoPay",
  "shopeepay": "ShopeePay", "shopee": "ShopeePay", "shopee pay": "ShopeePay",
  "seabank": "SeaBank", "sea bank": "SeaBank",
  "linkaja": "LinkAja", "link aja": "LinkAja",
  "jenius": "Jenius",
};
function _normBrandToken(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, ""); }
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
    dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[m][n];
}
function matchBrand(line) {
  const lower = String(line || "").toLowerCase();
  // 1) token exact (word boundary), longest first — "Bowo" tidak jadi OVO
  const sorted = BRANDS.slice().sort((x, y) => y.c.length - x.c.length);
  for (const b of sorted) {
    const tok = b.c.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (tok && new RegExp(`\\b${tok}\\b`).test(lower)) return b.c;
  }
  // 2) alias: go pay, shopee, sea bank, link aja
  const norm = _normBrandToken(line);
  for (const [alias, brand] of Object.entries(BRAND_ALIASES)) {
    if (norm === _normBrandToken(alias)) return brand;
    if (new RegExp(`\\b${alias.replace(/[^a-z0-9]+/g, "\\s+")}\\b`).test(lower)) return brand;
  }
  // 3) fuzzy typo: "goapy" -> GoPay, "shopeepy" -> ShopeePay
  if (norm.length >= 3 && norm.length <= 12 && /^[a-z]+$/.test(norm)) {
    let best = null, bestD = 99, tie = false;
    for (const b of BRANDS) {
      const bt = _normBrandToken(b.c);
      if (!bt) continue;
      const d = levenshtein(norm, bt);
      if (d < bestD) { bestD = d; best = b.c; tie = false; }
      else if (d === bestD) tie = true;
    }
    const maxD = norm.length >= 5 ? 2 : 1;
    if (best && bestD <= maxD && !tie) return best;
  }
  return null;
}
function parseAccountsText(text) {
  // Accepts lines like:
  //   AUFA FAUQI ARDHIQI          <- holder (applies to following methods)
  //   Bank Mandiri                <- brand (bare "mandiri" juga jalan)
  //   1630004111673               <- account number
  //   Bank Jago 104276913799      <- brand + number on one line
  //   GoPay 08990821878           <- e-money brand + number
  // Returns [{brand, account_no, holder_name}]
  const lines = String(text || "").split("\n").map(l => l.trim()).filter(Boolean);
  const out = [];
  let holder = "";
  let pendingBrand = null;
  for (const line of lines) {
    // number-like chunk on this line: digits, optionally grouped with spaces/dashes
    const numMatch = line.match(/(?:^|\s)([0-9][0-9\s\-]{5,})/);
    const number = numMatch ? numMatch[1].replace(/[\s\-]/g, "") : null;
    // brand is only trusted next to its number ("Bank Jago 1042...") or on a
    // bare brand line ("OVO", "Bank Mandiri"). A name like "DANA PRASETYO" or
    // "JAGO CAFE" must NOT set the brand — mid-line tokens inside a person's
    // name silently relabeled the next number (bug: "DANA PRASETYO / Bank
    // Jago / 104276913799" got parsed as brand DANA with Jago's number)
    const brand = number ? matchBrandNearNumber(line, number) : lineBrandOnly(line);
    if (brand && number) {
      out.push({ brand, account_no: number, holder_name: holder || null });
      pendingBrand = null;
    } else if (brand) {
      pendingBrand = brand;
    } else if (number) {
      // "Lainnya" is a real entry in BRANDS — see the comment there
      out.push({ brand: pendingBrand || "Lainnya", account_no: number, holder_name: holder || null });
      pendingBrand = null;
    } else {
      holder = line;
      pendingBrand = null;
    }
  }
  return out;
}

// brand match for lines WITHOUT a number: only a bare brand ("OVO") or a
// "Bank <brand>" line counts — anything longer is a person's name / cafe name.
function lineBrandOnly(line) {
  const stripped = String(line || "").toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  const words = stripped.split(" ").filter(w => w && w !== "bank");
  if (words.length > 1) return null;
  return matchBrand(line);
}

// brand match for lines WITH a number: look only in the few words adjacent to
// the number ("Bank Jago 1042..." → Jago), never across the whole line, so a
// name that contains a brand word ("DANA PRASETYO") can't hijack the brand.
function matchBrandNearNumber(line, number) {
  const idx = line.indexOf(number);
  if (idx < 0) return matchBrand(line);
  const before = String(line.slice(0, idx)).trim();
  const lastWords = before.split(/[\s/]+/).filter(Boolean).slice(-3).join(" ");
  const after = String(line.slice(idx + number.length)).trim();
  return matchBrand(lastWords) || matchBrand(after.split(/[\s/]+/).slice(0, 3).join(" "));
}

// G1: same account pasted twice (against what's already saved, or twice in
// one block) used to silently create a duplicate row — these numbers are
// what people copy to transfer money, so three identical BCA numbers in the
// list is a hazard, not just clutter (bug: paste parser had no dup check at
// all). Key on digits-only account number + brand so casing/spacing/"Bank "
// prefixes can't dodge the check.
function normAcctDigits(no) { return String(no || "").replace(/\D/g, ""); }
function acctDupKey(brand, account_no) {
  return String(brand || "").trim().toLowerCase() + "|" + normAcctDigits(account_no);
}
// Marks p._dup on every entry that matches an already-saved account OR an
// earlier entry in this same paste — first occurrence of a combo stays
// addable, later repeats are flagged. Recomputed on every render so editing
// a row's brand (which can turn a dup into a new entry, or vice versa) stays
// correct.
function markAcctDuplicates(parsed, existing) {
  const existingKeys = new Set((existing || []).map(a => acctDupKey(a.brand, a.account_no)));
  const seen = new Set();
  parsed.forEach(p => {
    const key = acctDupKey(p.brand, p.account_no);
    p._dup = existingKeys.has(key) || seen.has(key);
    seen.add(key);
  });
}

function openPasteAccountsSheet(identityId, onAdded) {
  const s = openSheet(`
    <div class="sheet-handle"></div>
    <div class="sheet-title">Tempel Teks Metode Bayar</div>
    <p class="sheet-sub">Copy dari notes atau m-banking, contoh:</p>
    <div class="card card-flat" style="padding:10px 12px;font-family:ui-monospace,monospace;font-size:12px;line-height:1.6;">
      BUDI SANTOSO<br>Bank BCA<br>1234567890<br>OVO<br>081234567890
    </div>
    <label for="paste-input">Teks Metode Bayar</label>
    <textarea id="paste-input" rows="6" placeholder="Tempel teks di sini..." style="resize:vertical;"></textarea>
    <button class="btn-primary" id="parse-acct-btn">Cek Teksnya</button>
    <div id="paste-result"></div>
    <button class="btn-outline" id="close-sheet">Tutup</button>`, { noAutofocus: true });

  // fetched once per sheet open — used to catch a paste that repeats an
  // account already saved from BEFORE this sheet opened, not just repeats
  // within the pasted text itself
  const existingP = api(`/api/identities/${identityId}/accounts`).catch(() => []);

  $("#close-sheet", s.sheet).addEventListener("click", s.close);
  $("#parse-acct-btn", s.sheet).addEventListener("click", () => {
    const parsed = parseAccountsText($("#paste-input", s.sheet).value);
    existingP.then(existing => renderParsedResult(s, parsed, identityId, onAdded, existing));
  });
}

function renderParsedResult(s, parsed, identityId, onAdded, existing) {
  const box = $("#paste-result", s.sheet);
  if (!box) return;
  if (!parsed.length) {
    box.innerHTML = `<p class="error-text" style="margin-top:10px;">Metode bayar tidak ditemukan.
      Cek formatnya: nama (opsional), nama bank, terus nomornya.</p>`;
    return;
  }
  markAcctDuplicates(parsed, existing);
  const addCount = parsed.filter(p => !p._dup).length;
  const dupCount = parsed.length - addCount;
  box.innerHTML = `
    <div class="card card-flat" style="margin-top:12px;">
      <div class="card-title"><span>Ditemukan ${parsed.length} metode${dupCount ? `, ${dupCount} sudah ada` : ""}</span></div>
      ${parsed.map((p, i) => `
        <div class="account-row" style="${p._dup ? "opacity:.55;" : ""}">
          <span class="paste-chip-wrap" data-i="${i}">${brandChipHtml(p.brand)}</span>
          <div style="flex:1;min-width:0;">
            <label class="sr-only" for="paste-brand-${i}">Bank / e-wallet buat ${esc(p.account_no)}</label>
            <select class="paste-brand-sel" id="paste-brand-${i}" data-i="${i}" style="font-size:13px;font-weight:600;padding:8px 32px 8px 10px;">
              ${BRANDS.map(b => `<option value="${esc(b.c)}" ${b.c === p.brand ? "selected" : ""}>${esc(b.c)}</option>`).join("")}
            </select>
            <div class="muted" style="font-size:12px;margin-top:3px;">${esc(p.account_no)}${p.holder_name ? " · " + esc(p.holder_name) : ""}${p._dup ? ` · <strong style="color:var(--text-2);">sudah tersimpan</strong>` : ""}</div>
          </div>
          <button class="icon-btn ghost paste-rm" data-i="${i}" aria-label="Buang ${esc(p.account_no)} dari daftar">${ic("x")}</button>
        </div>`).join("")}
      <button class="btn-green btn-sm" id="save-parsed" style="width:100%;margin-top:10px;" ${addCount ? "" : "disabled"}>
        ${addCount ? `Tambah ${addCount} Baru` : "Semua Sudah Tersimpan"}
      </button>
    </div>`;

  $$(".paste-brand-sel", box).forEach(sel => sel.addEventListener("change", () => {
    parsed[+sel.dataset.i].brand = sel.value;
    // brand affects the dup key, so a re-render (not just a chip swap) is
    // needed here — changing "Lainnya" to "BCA" can turn a fresh row into a
    // duplicate of one already saved, or the other way round
    renderParsedResult(s, parsed, identityId, onAdded, existing);
  }));

  $$(".paste-rm", box).forEach(btn => btn.addEventListener("click", () => {
    parsed.splice(+btn.dataset.i, 1);
    // re-render from the array: every row lives in ONE .card, so the old
    // `btn.closest(".card").remove()` wiped the whole result list plus the
    // submit button — and after a splice every remaining data-i was stale
    // (bug: removing row #2 deleted rows #1-#5 and the "Tambah Semua" button)
    if (!parsed.length) {
      box.innerHTML = `<p class="muted" style="margin-top:10px;">Semua dibuang. Tempel teks lain kalau mau.</p>`;
      return;
    }
    renderParsedResult(s, parsed, identityId, onAdded, existing);
  }));

  $("#save-parsed", box).addEventListener("click", (e) => {
    const btn = e.currentTarget;
    // withBusy: the loop used to fire N POSTs with the button still live, so a
    // double tap duplicated every account and a failure halfway left the user
    // with no idea what had been saved (bug: partial save reported as failure)
    withBusy(btn, "Nyimpen", async () => {
      const dupCount = parsed.filter(p => p._dup).length;
      const queue = parsed.filter(p => !p._dup);   // never POST what's flagged as a duplicate
      if (!queue.length) {
        toast(dupCount ? "Semua sudah tersimpan, tidak ada yang baru" : "Tidak ada yang ditambahkan");
        return;
      }
      let saved = 0, failMsg = "";
      for (const p of queue) {
        try {
          await apiJson(`/api/identities/${identityId}/accounts`, "POST", {
            brand: p.brand, account_no: p.account_no, holder_name: p.holder_name,
          });
          saved++;
          // drop the exact saved entry (not shift() — the queue skips dup
          // rows so it's no longer index-aligned with `parsed`) so a retry
          // after a partial failure can't duplicate what already landed
          const idx = parsed.indexOf(p);
          if (idx >= 0) parsed.splice(idx, 1);
        } catch (err) { failMsg = err.message; break; }
      }
      if (onAdded) onAdded();   // refresh the list even on a partial failure
      const remaining = parsed.filter(p => !p._dup);
      if (!remaining.length) {
        s.close();
        toast(dupCount ? `Ditambah ${saved} metode, ${dupCount} sudah ada sebelumnya` : `Ditambah ${saved} metode`);
        return;
      }
      if (saved > 0) toast(`${saved} tersimpan, ${remaining.length} gagal: ${failMsg}`);
      else toast(failMsg || "Gagal menyimpan");
      renderParsedResult(s, parsed, identityId, onAdded, existing);
    });
  });
}

// ---------- Edit payment account ----------
function openEditAccountSheet(acct, onDone) {
  const s = openSheet(`
    <div class="sheet-handle"></div>
    <div class="sheet-title">Edit Metode Bayar</div>
    <form id="edit-acct-form" novalidate>
      <div class="field">
        <label for="edit-acct-brand">Bank / E-Wallet</label>
        <select id="edit-acct-brand" name="brand"></select>
      </div>
      <div class="field">
        <label for="edit-acct-no">Nomor Rekening / E-Money</label>
        <input id="edit-acct-no" name="account_no" maxlength="40" inputmode="numeric" autocomplete="off">
      </div>
      <div class="field">
        <label for="edit-acct-holder">Atas Nama (Opsional)</label>
        <input id="edit-acct-holder" name="holder_name" maxlength="40" autocomplete="off">
        <p class="muted" style="margin-top:6px;">Nama pemilik tidak wajib — boleh dikosongin kalau kamu mau anonim.</p>
      </div>
      <div class="btn-row">
        <button class="btn-primary btn-sm" type="submit" id="edit-save">Simpan</button>
        <button class="btn-outline btn-sm" type="button" id="edit-close">Batal</button>
      </div>
    </form>`, { noAutofocus: true });

  const brandSel = $("#edit-acct-brand", s.sheet);
  brandSel.innerHTML = BRANDS.map(b => `<option value="${esc(b.c)}" ${b.c === acct.brand ? "selected" : ""}>${esc(b.c)}</option>`).join("");
  $("#edit-acct-no", s.sheet).value = acct.account_no || "";
  $("#edit-acct-holder", s.sheet).value = acct.holder_name || "";
  $("#edit-close", s.sheet).addEventListener("click", s.close);

  $("#edit-acct-form", s.sheet).addEventListener("submit", (e) => {
    e.preventDefault();
    const brand = brandSel.value;
    const account_no = $("#edit-acct-no", s.sheet).value.trim();
    const holder = $("#edit-acct-holder", s.sheet).value.trim() || null;
    if (!account_no) { toast("Nomor rekening wajib diisi"); return; }
    withBusy($("#edit-save", s.sheet), "Nyimpen", async () => {
      try {
        await api(`/api/accounts/${acct.id}`, { method: "PUT", json: { brand, account_no, holder_name: holder } });
        s.close();
        toast("Metode bayar diupdate");
        if (onDone) onDone();
      } catch (err) { toast(err.message); }
    });
  });
}

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
          <div class="muted tgl-desc" id="dz-tgl-desc">${scanMode
            ? "Item &amp; harga dibaca dari foto — langsung masuk ke daftar"
            : "Foto hanya ditempel — item &amp; harga diisi manual"}</div>
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
        <span class="muted">Struk yang barusan disalin (screenshot / copy gambar)</span>
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
      tglDesc.textContent = scanMode
        ? "Item & harga dibaca dari foto — langsung masuk ke daftar"
        : "Foto hanya ditempel — item & harga diisi manual";
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

  // one empty row, not zero: a manual bill always needs at least one item, and
  // an empty card under a paragraph explaining "Bebas vs Slot" is an
  // explanation with nothing to point at (see blankBillForVerify)
  const blankBill = () => ({
    items: [{ name: "", price: 0, mode: "free" }],
    subtotal: 0, tax: 0, service: 0, total: 0,
    photo_path: null, photos: [], merchant: "", date: "",
  });
  $("#manual-btn").addEventListener("click", () => renderVerify(blankBill(), true));
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
    $("#ocr-manual").addEventListener("click", () => renderVerify(blankBill(), true));
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
  return { items: [{ name: "", price: 0, mode: "free" }], subtotal: 0, tax: 0,
           service: 0, total: 0, photo_path: null, merchant: "", date: "" };
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
  .vf-item { display:grid; grid-template-columns:minmax(0,1fr) minmax(96px,110px) 44px; gap:8px; align-items:center;
             padding:12px 2px; border-bottom:1px solid var(--border); }
  /* "Nasi Goreng Spesial" in a 1fr column next to a 110px price box reads
     "Nasi Goreng Spe:" — give the name the whole width on a phone */
  @media (max-width:430px) {
    .vf-item { grid-template-columns:1fr 44px; }
    .vf-item [data-role=name] { grid-column:1 / -1; }
  }
  .vf-item:last-child { border-bottom:none; }
  .vf-item input { padding:9px 10px; }
  .vf-item .icon-btn { width:44px; height:44px; min-width:44px; min-height:44px; }
  .vf-full { grid-column:1 / -1; }
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
    .vf-item { grid-template-columns:minmax(0,1fr) minmax(104px,120px) minmax(112px,130px) 44px; }
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
    .vf-head { display:grid; grid-template-columns:minmax(0,1fr) minmax(104px,120px) minmax(112px,130px) 44px; gap:8px;
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
    .vf-item { grid-template-columns:minmax(0,1fr) minmax(96px,112px) minmax(104px,120px) 44px; }
    .vf-head { grid-template-columns:minmax(0,1fr) minmax(96px,112px) minmax(104px,120px) 44px; }
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

function renderVerify(ocr, manual = false) {
  // v61: photos is an array now; legacy single photo_path folds in so OCR
  // results (which still carry photo_path) keep working
  const photos = Array.isArray(ocr.photos) ? ocr.photos.slice()
    : (ocr.photo_path ? [ocr.photo_path] : []);
  verifyState = {
        items: ocr.items || [],
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
  const _sumItems = (verifyState.items || []).reduce((s, i) => s + Math.max(0, (i.price || 0) - (i.discount || 0)), 0);
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
      <div class="btn-row" style="margin-top:8px;">
        <button class="btn-outline btn-sm" id="verify-add-photo" style="margin-top:0;">${ic("camera")} Tambah Foto</button>
        <button class="btn-outline btn-sm" id="verify-paste-photo" style="margin-top:0;">${ic("clipboard")} Tempel</button>
        <span class="muted btn-auto" style="align-self:center;">Ketuk foto buat perbesar</span>
      </div>
    </div>` : (manual ? `
    <div class="card" style="padding:8px;">
      <button class="btn-outline" id="verify-add-photo" style="width:100%;">${ic("camera")} Tambah Foto Struk</button>
      <button class="btn-outline btn-sm" id="verify-paste-photo" style="width:100%;margin-top:8px;">${ic("clipboard")} Tempel dari Clipboard</button>
      <p class="muted" style="text-align:center;margin-top:6px;">Opsional — foto hanya dilampirkan, tidak dibaca otomatis.</p>
    </div>` : "")}

    <details class="card progressive-section">
      <summary class="card-title"><span>Detail Bill</span><span class="muted">(opsional)</span></summary>
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
    </details>

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
      <div class="card-title"><span>Total</span></div>
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
          <span style="flex:1;"><strong>Aku yang bayar</strong><span class="muted" style="display:block;">Aku yang membayar dahulu.</span></span>
        </label>
        <label class="account-row" for="paid-by-other-choice" style="cursor:pointer;border:1px solid var(--border);border-radius:var(--r-sm);padding:12px;">
          <input type="radio" id="paid-by-other-choice" name="payer-choice" value="other" ${verifyState.paidByMyself ? "" : "checked"}>
          <span style="flex:1;"><strong>Orang lain yang bayar</strong><span class="muted" style="display:block;">Tulis nama orang yang membayar dahulu.</span></span>
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
  photoImgs.forEach(img => img.addEventListener("click", () => img.classList.toggle("expanded")));
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
    verifyState.items.push({ name: "", price: 0, discount: 0 });
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

function renderVerifyItems() {
  const elList = $("#items-list");
  if (!elList) return;
  elList.innerHTML = verifyState.items.map((it, idx) => {
    const eff = Math.max(0, (it.price || 0) - (it.discount || 0));
    const slots = it.slot_count || 2;
    // per-slot price is the EFFECTIVE price / slots — dividing the pre-discount
    // price quoted a per-bagian number nobody would ever be charged
    // (bug: slot preview ignored the discount column)
    const perSlot = Math.floor(eff / slots);
    const isSlot = it.mode === "slot";
    return `
    <div class="vf-item" data-idx="${idx}">
      <input data-role="name" data-idx="${idx}" value="${esc(it.name)}" placeholder="Nama Item"
             maxlength="60" aria-label="Nama item baris ${idx + 1}">
      <div class="vf-price">
        <label class="vf-mobile-label" for="price-${idx}">Harga</label>
        <input id="price-${idx}" data-role="price" data-idx="${idx}" class="input-money" type="text" inputmode="numeric" maxlength="16"
               value="${rupiahFmt(it.price)}" placeholder="0" aria-label="Harga item baris ${idx + 1}">
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
    updateVerifyTotal();
  }));
  $$("[data-role=discount]", elList).forEach(inp => bindRupiahInput(inp, (v) => {
    const it = verifyState.items[+inp.dataset.idx];
    it.discount = v;
    inp.style.borderColor = "";
    const row = inp.closest(".vf-item");
    let bayar = row ? row.querySelector(".disc-bayar") : null;
    const eff = Math.max(0, (it.price || 0) - v);
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
  const sumItems = verifyState.items.reduce((s, i) => s + Math.max(0, (i.price || 0) - (i.discount || 0)), 0);
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
    const hasNamedItem = verifyState.items.some(i => String(i.name || "").trim());
    const hasTotal = total > 0;
    const payerChosen = !!verifyState.paidByMyself || !!String(verifyState.paid_by_name || "").trim();
    const missing = [];
    if (!hasNamedItem) missing.push("nama item");
    if (!hasTotal) missing.push("total");
    if (!payerChosen) missing.push("pembayar");
    cta.disabled = mismatch || !hasNamedItem || !hasTotal || !payerChosen;
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

// ---------- rupiah input helpers ----------
// Capped at 12 digits (a trillion rupiah — far past any real receipt).
// Uncapped, 20 digits parsed to 1e20 and crashed bill creation with a sqlite
// OverflowError -> HTTP 500 (bug); at >=17 digits parseInt already loses
// precision (the field shows one number, state holds another), and at >=22
// digits ANY re-render wiped the field to "122", because JS stringifies
// numbers that big in exponent form ("1e+22") and \D strips everything but
// the digits out of the exponent.
function rupiahDigits(v) { return String(v == null ? "" : v).replace(/\D/g, "").replace(/^0+(?=\d)/, "").slice(0, 12); }
function rupiahFmt(v) { const d = rupiahDigits(v); return d ? d.replace(/\B(?=(\d{3})+(?!\d))/g, ".") : ""; }
function rupiahParse(s) { return parseInt(rupiahDigits(s) || "0", 10); }
function bindRupiahInput(input, onChange) {
  if (!input) return;
  input.setAttribute("inputmode", "numeric");
  input.addEventListener("input", () => {
    const caret = input.selectionStart;
    const digitsBefore = input.value.slice(0, caret).replace(/\D/g, "").length;
    const formatted = rupiahFmt(input.value);
    input.value = formatted;
    let pos = 0, seen = 0;
    while (pos < formatted.length && seen < digitsBefore) { if (/\d/.test(formatted[pos])) seen++; pos++; }
    try { input.setSelectionRange(pos, pos); } catch (e) {}
    if (onChange) onChange(rupiahParse(formatted));
  });
  input.addEventListener("blur", () => { input.value = rupiahFmt(input.value); });
}
