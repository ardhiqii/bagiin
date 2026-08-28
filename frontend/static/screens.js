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

/** The row tone follows the same precedence and summary fields as the chip.
 *  In particular, a pending picker keeps a settled-looking bill neutral, and
 *  money still outstanding wins over the green settled state. */
function billListStatus(b) {
  const paid = !!(b.settled || b.all_paid);
  const pendingPickers = Array.isArray(b.pending_names) ? b.pending_names.length : 0;
  // v68: pending pickers block settle server-side now — show it first.
  if (pendingPickers) {
    return { tone: "idle", label: "Menunggu memilih item", icon: "people" };
  }
  if (Number(b.total_unpaid) > 0 || Number(b.uncovered_idr) > 0) {
    return { tone: "due", label: "Belum lunas", icon: "receipt" };
  }
  if (paid) return { tone: "ok", label: "Lunas", icon: "check" };
  return { tone: "idle", label: "Belum ada yang memilih", icon: "receipt" };
}

function billListStatusChip(b) {
  const myTotal = Number(b.my_total_idr || 0);
  if (!b.i_am_payer && !b.my_paid && b.has_picks && !b.settled) {
    return `<span class="chip chip-red">Kamu belum bayar${myTotal > 0 ? ` Rp ${fmt(myTotal)}` : ""}</span>`;
  }
  // List rows expose only summary fields; pending_names supplies the picker
  // identity shim so the shared helper can keep its single status decision.
  const pendingNames = Array.isArray(b.pending_names) ? b.pending_names : [];
  const data = {
    bill: { total_idr: b.total_idr || 0 },
    people: pendingNames.length
      ? pendingNames.map((name, i) => ({ identity_id: `__pending_${i}`, name, subtotal_idr: 0 }))
      : [],
    sel_by_item: {},
    paid_by_id: b.paid_by_identity_id, settled: b.settled,
    all_paid: b.all_paid, uncovered_idr: b.uncovered_idr,
  };
  return renderBillStatusChip(data, b.status === "closed", b.total_unpaid || 0, false);
}

// personal line for the CURRENT viewer — only meaningful while the bill is
// open (or closed-unsettled), has picks, and isn't fully settled.
// NOTE closed bills are NOT excluded: a closed bill that still has an unpaid
// share must keep telling the debtor "Kamu belum bayar" — hiding it made
// closed debts invisible (bug: chip said "Selesai" while the user still owed).
function personalStatusHtml(b) {
  if (b.settled || !b.has_picks) return "";
  // The red chip already says exactly what this viewer owes. Rendering the
  // old neutral line as well duplicates the same debt message in one row.
  if (!b.i_am_payer && !b.my_paid && b.has_picks && !b.settled) return "";
  // the payer never "paid" — they fronted the money. Calling that "sudah bayar"
  // is what made a fresh bill claim a payment that never happened.
  // personal lines are always neutral: the chip already owns the status colour,
  // so colouring the line too makes one row scream two messages at once.
  if (b.i_am_payer) return `<div class="item-share">Kamu yang nalangin</div>`;
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
      ${b.can_manage ? `<button class="icon-btn ghost delete-bill" data-id="${esc(b.id)}" data-title="${esc(b.title)}" aria-label="Hapus bill ${esc(b.title)}">${ic("trash")}</button>` : ""}
    </div>`;
}

function bindBillRows(box, onDone) {
  $$(".history-row", box).forEach(r => {
    const open = () => location.hash = "#/b/" + r.dataset.id;
    r.addEventListener("click", (e) => {
      const deleteButton = e.target.closest(".delete-bill");
      if (deleteButton) {
        e.stopPropagation();
        openDeleteBillConfirm(deleteButton.dataset.id, deleteButton.dataset.title, onDone);
        return;
      }
      open();
    });
    // the row is a div (it contains its own delete <button>, so it can't BE a
    // button) — give it real keyboard semantics instead
    r.addEventListener("keydown", (e) => {
      if (e.target !== r) return;
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
    });
  });
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
  if (histState.filter === "ok") return tone === "ok";
  if (histState.filter === "due") return tone === "due";
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
    // due first, then idle, then everything else (ok) — each group
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
          ${brandLogoHtml(a.brand)}
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
          <span class="paste-chip-wrap" data-i="${i}">${brandLogoHtml(p.brand)}</span>
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
