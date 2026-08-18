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
      <p><strong>Sesi kamu udah gak dikenal server.</strong></p>
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
      <h1>Bagi bill bareng jadi gak ribet.</h1>
      <p class="muted" style="margin:8px 0 22px;">Foto struk, share link, semua milih itemnya sendiri. Pajaknya kebagi otomatis.</p>
      <form id="onboard-form" novalidate>
        <div class="field">
          <label for="name-input">Siapa nama kamu?</label>
          <input id="name-input" name="name" type="text" placeholder="Biar temen kamu tau ini kamu"
                 value="${esc(saved)}" maxlength="30" autocomplete="name">
        </div>
        <button class="btn-primary" type="submit" id="onboard-btn">Masuk</button>
      </form>
      <p class="muted" style="margin-top:14px;text-align:center;">Tanpa akun. Nama kamu cuma disimpen di device ini.</p>
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
        <button class="icon-btn" id="history-btn" aria-label="Riwayat bill">${ic("history")}</button>
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
      <!-- Home used to carry the whole history screen: the same list, the same
           four filter chips and the same two selects. On a 390px phone that
           pushed the first bill below the fold, and the app had two screens
           doing one job. Home = the last few bills; Riwayat owns the filters. -->
      <div class="card-title">
        <span>Bill Terakhir</span>
        <button type="button" class="link-btn" id="see-all-btn">Lihat Semua</button>
      </div>
      <div id="home-history">${skeletonRows(4)}</div>
    </div>`);
  watchDock();

  $("#create-btn").addEventListener("click", () => location.hash = "#/create");
  $("#history-btn").addEventListener("click", () => location.hash = "#/history");
  $("#settings-btn").addEventListener("click", () => location.hash = "#/settings");
  $("#see-all-btn").addEventListener("click", () => location.hash = "#/history");

  loadHomeHistory();
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
      <p class="muted" style="margin-top:8px;font-size:12.5px;">${invites.length > 1 ? "Kamu diundang ke beberapa bill. Terima yang mau kamu ikutin." : "Kamu diundang langsung — gak perlu link lagi."}</p>
    </div>`;
  $$(".inv-accept", box).forEach(b => b.addEventListener("click", async (ev) => {
    const row = b.closest(".invite-row");
    const invId = row.dataset.invite, billId = row.dataset.bill;
    // no busy lock meant a double-tap fired two accepts, and the second's
    // 400 replaced "Udah gabung 🎉" with "Undangan ini udah diproses" (bug)
    await withBusy(b, "Gabung...", async () => {
      try {
        await apiJson(`/api/bills/${billId}/invites/${invId}/accept`, "POST", {});
        toast("Udah gabung 🎉");
        // re-render the whole card, not just row.remove(): the footer line is
        // written from invites.length, so removing one of two rows left "Kamu
        // diundang ke beberapa bill" over a single invite
        loadHomeInvites();
        loadHomeHistory(false);  // bill baru muncul di Riwayat — force refetch (useCache=true reused the pre-join list and the new bill stayed invisible)
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
      body: "Undangan ini bakal ilang — buat nerima lagi nanti, minta yang ngundang kirim ulang.",
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
  // yet. Saying so put a red chip next to a green "Kamu udah bayar" on a bill
  // where literally nothing had happened (bug: chips contradicted each other).
  if (!b.has_picks) return { tone: "idle", label: "Belum ada yang milih", icon: "receipt" };
  return { tone: "due", label: "Belum lunas", icon: "receipt" };
}

// Colour means MONEY here: green = beres, red = masih ada yang belum dibayar,
// abu = gak ada yang ketagih (selesai / belum jalan). "Belum dipilih" used to
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
  // the payer never "paid" — they fronted the money. Calling that "udah bayar"
  // is what made a fresh bill claim a payment that never happened.
  // personal lines are always neutral: the chip already owns the status colour,
  // so colouring the line too makes one row scream two messages at once.
  if (b.i_am_payer) return `<div class="item-share">Kamu yang nalangin</div>`;
  return b.my_paid
    ? `<div class="item-share">Kamu udah bayar</div>`
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

// ---------- History ----------
// page size for history — renders in batches so a long list doesn't build one
// giant string / thousands of nodes at once (bug: everything rendered at once)
const HIST_PAGE = 20;
let histState = { filter: "all", year: "all", month: "all", limit: HIST_PAGE };
// client-side bill cache so switching filters re-renders instantly instead of
// refetching the whole list over the network every time (bug: sluggish filters)
let histBills = null;
// month options are fixed (Januari..Desember) — only the year list is derived
// from data, so a "all years + Juli" filter can span every July on record
const MONTH_OPTS = [
  ["01", "Januari"], ["02", "Februari"], ["03", "Maret"], ["04", "April"],
  ["05", "Mei"], ["06", "Juni"], ["07", "Juli"], ["08", "Agustus"],
  ["09", "September"], ["10", "Oktober"], ["11", "November"], ["12", "Desember"],
];

const HIST_CSS = `<style>
  .hist-filters { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:14px; }
  /* min-height:0 shrank these to ~37px next to 50px-tall selects — under the
     thumb minimum and visibly out of line with the row */
  .hist-filters .chip-btn { font-size:13px; padding:10px 14px; min-height:40px; }
  /* status chips on one line, the two date selects on their own: mixed
     together they wrapped unpredictably, and a 118px year select clipped its
     own "Semua tahun" option down to "Semua t" */
  .hist-selects { display:flex; gap:8px; margin-bottom:14px; }
  .hist-selects select { flex:1 1 0; min-width:0; }
</style>`;

// filter options map to billListStatus tones so chip, filter and row can't
// disagree about what "lunas" means
const HIST_FILTERS = [
  { v: "all", label: "Semua" },
  { v: "due", label: "Belum lunas" },
  { v: "ok",  label: "Lunas" },
  { v: "idle", label: "Belum dipilih" },
];

function renderHistory() {
  const app = $("#app");
  app.innerHTML = shell(`
    ${HIST_CSS}
    <div class="topbar">
      <button class="icon-btn" id="back-btn" aria-label="Kembali ke beranda">${ic("back")}</button>
      <div class="topbar-title">Riwayat</div>
      <div style="width:42px;flex-shrink:0;" aria-hidden="true"></div>
    </div>
    <div class="hist-filters">
      ${HIST_FILTERS.map(f =>
        `<button type="button" class="chip-btn ${histState.filter === f.v ? "chip-active" : ""}" data-filter="${f.v}"
                 aria-pressed="${histState.filter === f.v}">${esc(f.label)}</button>`).join("")}
    </div>
    <div class="hist-selects">
      <select class="hist-year-sel" id="hist-year" aria-label="Filter tahun">
        <option value="all">Semua tahun</option>
      </select>
      <select class="hist-month-sel" id="hist-month" aria-label="Filter bulan">
        <option value="all">Semua bulan</option>
        ${MONTH_OPTS.map(([v, l]) =>
          `<option value="${v}" ${histState.month === v ? "selected" : ""}>${l}</option>`).join("")}
      </select>
    </div>
    <div class="card" id="hist-list">${skeletonRows(4)}</div>`);
  watchDock();
  $("#back-btn").addEventListener("click", () => location.hash = "#/");
  $$(".hist-filters .chip-btn").forEach(btn =>
    btn.addEventListener("click", () => {
      histState.filter = btn.dataset.filter;
      histState.limit = HIST_PAGE;
      $$(".hist-filters .chip-btn").forEach(b => {
        const on = b === btn;
        b.classList.toggle("chip-active", on);
        b.setAttribute("aria-pressed", String(on));
      });
      loadHistoryList(true);
    }));
  const mSel = $("#hist-month");
  if (mSel) mSel.addEventListener("change", () => {
    histState.month = mSel.value;
    histState.limit = HIST_PAGE;
    loadHistoryList(true);
  });
  const ySel = $("#hist-year");
  if (ySel) ySel.addEventListener("change", () => {
    histState.year = ySel.value;
    histState.limit = HIST_PAGE;
    loadHistoryList(true);
  });
  // paging is per-visit: leaving the screen at "80 rows shown" and coming
  // back should start from the top page again
  histState.limit = HIST_PAGE;
  loadHistoryList();
}

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

// shared list renderer for home + history — same filter/pagination behaviour,
// different containers, so the two screens can't drift apart.
// `useCache` = reuse the previously fetched list (filter clicks, month/year
// changes); pass false when the data may have changed (initial load, delete).
async function loadBillList(boxSel, yearSelId, monthSelId, moreId, emptyMsg, useCache, opts = {}) {
  const box = $(boxSel);
  if (!box) return;
  // preview = the home card: newest few, no filters (a filter set on Riwayat
  // must not silently hide bills on home), no month headers, no paging.
  const preview = opts.preview || 0;
  try {
    if (!useCache || !histBills) {
      histBills = await api("/api/identities/" + state.identity.id + "/bills");
    }
    const bills = histBills;
    if (!bills.length) {
      box.innerHTML = `<div class="empty-state">${ic("empty")}
        <p>Belum ada bill.</p><p class="muted">${emptyMsg}</p></div>`;
      return;
    }
    const ySel = yearSelId ? $(yearSelId) : null;
    // rebuild the year options on every fetch — a conditional append left
    // stale years behind after a delete (bug: deleted bill's year stayed
    // selectable and returned an empty result). Keep "Semua tahun" at the top:
    // replacing the whole innerHTML wiped the static option, so the select
    // read "2026" on an unfiltered list and there was no way back to all
    // years once one was picked (bug: a filter you can't turn off).
    if (ySel) {
      const years = availableYears(bills);
      if (histState.year !== "all" && !years.includes(histState.year)) histState.year = "all";
      ySel.innerHTML = `<option value="all"${histState.year === "all" ? " selected" : ""}>Semua tahun</option>`
        + years.map(y => `<option value="${y}"${histState.year === y ? " selected" : ""}>${esc(y)}</option>`).join("");
    }
    // newest first, grouped by month so a long list stays scannable.
    // transacted_at is sometimes date-only ("2026-08-18") and sometimes a
    // datetime — comparing raw strings would order "2026-08-18" before
    // "2026-08-18 10:30:00" and shuffle same-day rows (bug: localeCompare on
    // mixed formats)
    const _ts = (b) => {
      const iso = String(b.transacted_at || b.created_at || "");
      const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(iso);
      const d = dateOnly ? new Date(iso + "T12:00:00") : new Date(iso.replace(" ", "T") + "Z");
      return isNaN(d) ? 0 : d.getTime();
    };
    const sorted = bills.slice().sort((a, b) => _ts(b) - _ts(a));
    if (preview) {
      box.innerHTML = sorted.slice(0, preview).map(billRowHtml).join("");
      bindBillRows(box, () => loadBillList(boxSel, yearSelId, monthSelId, moreId, emptyMsg, false, opts));
      // the count lives on the card's own "Lihat Semua" link — a second
      // full-width button underneath said the same thing twice
      const seeAll = $("#see-all-btn");
      if (seeAll && sorted.length > preview) seeAll.textContent = `Lihat Semua (${sorted.length})`;
      return;
    }
    const filtered = sorted.filter(passHistoryFilter);
    if (!filtered.length) {
      box.innerHTML = `<div class="empty-state">${ic("empty")}
        <p>Gak ada bill yang cocok.</p><p class="muted">Coba ganti filter-nya.</p></div>`;
      return;
    }
    const page = filtered.slice(0, histState.limit);
    let html = "", lastMonth = null;
    for (const b of page) {
      const m = monthLabel(b.transacted_at || b.created_at) || "Tanpa tanggal";
      if (m !== lastMonth) { html += `<div class="history-month">${esc(m)}</div>`; lastMonth = m; }
      html += billRowHtml(b);
    }
    if (filtered.length > histState.limit) {
      const rest = filtered.length - histState.limit;
      html += `<button type="button" class="btn-outline btn-sm" id="${moreId}" style="width:100%;margin-top:12px;">Muat ${Math.min(rest, HIST_PAGE)} lagi (${rest} tersisa)</button>`;
    }
    box.innerHTML = html;
    bindBillRows(box, () => loadBillList(boxSel, yearSelId, monthSelId, moreId, emptyMsg, false));
    const moreBtn = $( "#" + moreId);
    if (moreBtn) moreBtn.addEventListener("click", () => {
      histState.limit += HIST_PAGE;
      loadBillList(boxSel, yearSelId, monthSelId, moreId, emptyMsg, true);
    });
  } catch (e) {
    box.innerHTML = identityErrorHtml(e);
    bindIdentityError(box);
    if (!e || e.status !== 404) toast(e.message);
  }
}

async function loadHistoryList(useCache = false) {
  return loadBillList("#hist-list", "#hist-year", "#hist-month", "hist-more",
    "Bill yang kamu buat atau kamu ikutin bakal nongol di sini.", useCache);
}

const HOME_PREVIEW = 4;
async function loadHomeHistory(useCache = false) {
  return loadBillList("#home-history", null, null, "home-more",
    "Bill yang kamu buat atau kamu ikutin bakal nongol di sini.", useCache,
    { preview: HOME_PREVIEW });
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
        Kode buat mindahin akun kamu ke browser atau HP lain. Kodenya cuma ditampilin sekali
        — pas dibuat. Kalau kamu bikin kode baru, kode lama langsung mati.
      </p>
      <div id="code-box"><div class="sk sk-line" style="height:44px;"></div></div>
    </div>

    <div class="card">
      <div class="card-title"><span>Undangan</span></div>
      <div class="toggle-row" style="padding:10px 0;">
        <div>
          <span class="label-strong">Langsung masuk bill</span>
          <span class="muted" style="font-size:12.5px;display:block;margin-top:2px;">Kalau ada yang undang kamu ke bill, kamu langsung ikut — gak perlu klik apa-apa, kayak grup WA.</span>
        </div>
        <button class="switch" id="auto-accept-switch" role="switch" aria-checked="true" aria-label="Langsung masuk bill pas diundang" disabled></button>
      </div>
      <p class="muted" style="font-size:12.5px;">Matiin kalau kamu mau liat dulu siapa yang ngundang sebelum ikut. Undangan bakal muncul di beranda buat diterima atau ditolak.</p>
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
      <p class="muted" style="margin-top:8px;">Catat sekarang — kode ini gak bakal ditampilin lagi.
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
           ${ic("check")}<span>Kamu udah punya kode pemulihan. Simpan baik-baik ya — itu satu-satunya
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
        body: "Kode pemulihan yang lama <strong>langsung mati</strong> begitu kode baru dibuat. Kalau kamu udah nyatet yang lama, catatan itu jadi gak kepake.",
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
          body: acc ? `${esc(acc.brand)} · ${esc(acc.account_no)} bakal ilang dari semua bill kamu.` : "",
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
        ? "Device ini bakal lupa siapa kamu. Semua bill kamu masih ada, tapi cuma bisa dibuka lagi pakai <strong>kode pemulihan</strong> kamu."
        : hasCode === false
          ? "<strong>Kamu belum punya kode pemulihan.</strong> Kalau keluar sekarang, semua bill kamu gak bisa dibuka lagi — selamanya, di HP ini maupun di HP lain. Bikin kode pemulihan dulu kalau masih butuh billnya."
          : "Device ini bakal lupa siapa kamu. Status kode pemulihan kamu belum sempat kecek (cek koneksi) — kalau ternyata kamu belum bikin kode, bill kamu gak bisa dibuka lagi. Amanin dulu di halaman ini kalau masih butuh billnya.",
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
  // 1) token exact (word boundary), longest first — "Bowo" gak jadi OVO
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

  $("#close-sheet", s.sheet).addEventListener("click", s.close);
  $("#parse-acct-btn", s.sheet).addEventListener("click", () => {
    const parsed = parseAccountsText($("#paste-input", s.sheet).value);
    renderParsedResult(s, parsed, identityId, onAdded);
  });
}

function renderParsedResult(s, parsed, identityId, onAdded) {
  const box = $("#paste-result", s.sheet);
  if (!box) return;
  if (!parsed.length) {
    box.innerHTML = `<p class="error-text" style="margin-top:10px;">Gak nemu metode bayar.
      Cek formatnya: nama (opsional), nama bank, terus nomornya.</p>`;
    return;
  }
  box.innerHTML = `
    <div class="card card-flat" style="margin-top:12px;">
      <div class="card-title"><span>Ketemu ${parsed.length} metode</span></div>
      ${parsed.map((p, i) => `
        <div class="account-row">
          <span class="paste-chip-wrap" data-i="${i}">${brandChipHtml(p.brand)}</span>
          <div style="flex:1;min-width:0;">
            <label class="sr-only" for="paste-brand-${i}">Bank / e-wallet buat ${esc(p.account_no)}</label>
            <select class="paste-brand-sel" id="paste-brand-${i}" data-i="${i}" style="font-size:13px;font-weight:600;padding:8px 32px 8px 10px;">
              ${BRANDS.map(b => `<option value="${esc(b.c)}" ${b.c === p.brand ? "selected" : ""}>${esc(b.c)}</option>`).join("")}
            </select>
            <div class="muted" style="font-size:12px;margin-top:3px;">${esc(p.account_no)}${p.holder_name ? " · " + esc(p.holder_name) : ""}</div>
          </div>
          <button class="icon-btn ghost paste-rm" data-i="${i}" aria-label="Buang ${esc(p.account_no)} dari daftar">${ic("x")}</button>
        </div>`).join("")}
      <button class="btn-green btn-sm" id="save-parsed" style="width:100%;margin-top:10px;">Tambah Semua</button>
    </div>`;

  $$(".paste-brand-sel", box).forEach(sel => sel.addEventListener("change", () => {
    parsed[+sel.dataset.i].brand = sel.value;
    const chip = box.querySelector(`.paste-chip-wrap[data-i="${sel.dataset.i}"]`);
    if (chip) chip.innerHTML = brandChipHtml(sel.value);
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
    renderParsedResult(s, parsed, identityId, onAdded);
  }));

  $("#save-parsed", box).addEventListener("click", (e) => {
    const btn = e.currentTarget;
    // withBusy: the loop used to fire N POSTs with the button still live, so a
    // double tap duplicated every account and a failure halfway left the user
    // with no idea what had been saved (bug: partial save reported as failure)
    withBusy(btn, "Nyimpen", async () => {
      const queue = parsed.slice();
      let saved = 0, failMsg = "";
      for (const p of queue) {
        try {
          await apiJson(`/api/identities/${identityId}/accounts`, "POST", {
            brand: p.brand, account_no: p.account_no, holder_name: p.holder_name,
          });
          saved++;
          parsed.shift(); // drop what's already saved so a retry can't duplicate it
        } catch (err) { failMsg = err.message; break; }
      }
      if (onAdded) onAdded();   // refresh the list even on a partial failure
      if (!parsed.length) {
        s.close();
        toast(`Ditambah ${saved} metode`);
        return;
      }
      if (saved > 0) toast(`${saved} kesimpen, ${parsed.length} gagal: ${failMsg}`);
      else toast(failMsg || "Gagal nyimpen");
      renderParsedResult(s, parsed, identityId, onAdded);
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
        <p class="muted" style="margin-top:6px;">Nama pemilik gak wajib — boleh dikosongin kalau kamu mau anonim.</p>
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
function renderCreate(opts = {}) {
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
                the wrong cause here (bug: headline blamed OCR for an upload failure). -->
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
        <div style="font-weight:600;font-size:15.5px;color:var(--text);">Foto Struknya</div>
        <div class="muted">${hint}</div>
      </button>
      <input type="file" id="file-input" accept="image/*" class="hidden" tabindex="-1" aria-hidden="true">
      <button class="btn-outline" id="manual-btn" style="margin-top:12px;">${ic("pencil")} Bikin Manual (tanpa foto)</button>
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
    if (scanMode) await uploadAndOcr(f);
    else await uploadAndAttach(f);
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
            : "Foto cuma ditempel — item &amp; harga diisi manual"}</div>
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
      <p class="sheet-sub">Mau difoto langsung atau pilih dari galeri — dua-duanya bisa, tinggal atur mau dibaca otomatis atau nggak.</p>
      ${body}`, { noAutofocus: true });
    const tgl = s.sheet.querySelector("#dz-tgl");
    const tglDesc = s.sheet.querySelector("#dz-tgl-desc");
    if (tgl) tgl.addEventListener("click", () => {
      scanMode = !scanMode;
      tgl.setAttribute("aria-checked", String(scanMode));
      tglDesc.textContent = scanMode
        ? "Item & harga dibaca dari foto — langsung masuk ke daftar"
        : "Foto cuma ditempel — item & harga diisi manual";
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
      if (opts.ocrFile) uploadAndOcr(opts.ocrFile);
      else renderCreate();
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
async function uploadAndAttach(file, ocrReason) {
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
    if (location.hash !== routeAtStart) return;
    // keep the photo; items are filled manually
    renderVerify({ ...blankBillForVerify(), photos: [result.photo_path],
      ocrError: ocrReason || null, ocrRetryFile: ocrReason ? file : null }, true);
  } catch (e) {
    if (location.hash !== routeAtStart) return;
    renderCreate({ ocrError: e.message, ocrFile: file });
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
  const fd = new FormData();
  fd.append("file", file);
  const upload = async () => {
    try {
      const result = await api("/api/photos", { method: "POST", body: fd });
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

async function uploadAndOcr(file) {
  const body = $("#create-body");
  if (body) {
    body.innerHTML = `<div class="card" style="text-align:center;padding:40px 16px;">
      <div class="spinner" style="width:32px;height:32px;border-width:3px;"></div>
      <p style="margin-top:16px;font-weight:600;">Lagi baca struknya...</p>
      <p class="muted">Biasanya cuma butuh beberapa detik</p>
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
    if (location.hash !== routeAtStart) return;
    renderVerify(result);
  } catch (e) {
    if (location.hash !== routeAtStart) return;
    // v61: OCR failed — keep the photo anyway and drop into the manual
    // editor with it attached (before, the photo was thrown away and the
    // user had to re-pick it on the create screen). The reason used to only
    // go out as a toast, started before the extra /api/photos round-trip
    // below even began — by the time the (blank-looking) form appeared, the
    // 2.6s toast had usually already expired and nobody knew why they were
    // suddenly looking at "Bikin Manual" (bug). Carry it into the editor
    // instead, where it can't disappear before it's read.
    await uploadAndAttach(file, e.message);
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
        ? "Browser kamu gak bisa baca clipboard — long-press terus pilih Paste"
        : "Browser kamu gak bisa baca clipboard — tekan Ctrl+V aja");
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
    toast("Clipboard kamu gak ada gambarnya");
  } catch (e) {
    // a raw DOMException string ("NotAllowedError: ...") spliced into
    // Indonesian copy helps nobody — say what to do instead
    toast("Gak bisa baca clipboard. Coba tempel pakai Ctrl+V ya");
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
    body: "Semua yang udah kamu ketik di sini — item, harga, judul — bakal ilang.",
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
  .vf-item { display:grid; grid-template-columns:1fr 110px 40px; gap:8px; align-items:center;
             padding:12px 2px; border-bottom:1px solid var(--border); }
  /* "Nasi Goreng Spesial" in a 1fr column next to a 110px price box reads
     "Nasi Goreng Spe:" — give the name the whole width on a phone */
  @media (max-width:430px) {
    .vf-item { grid-template-columns:1fr 40px; }
    .vf-item [data-role=name] { grid-column:1 / -1; }
  }
  .vf-item:last-child { border-bottom:none; }
  .vf-item input { padding:9px 10px; }
  .vf-item .icon-btn { width:40px; height:40px; min-height:40px; }
  .vf-full { grid-column:1 / -1; }
  .vf-grid { display:grid; grid-template-columns:repeat(3, minmax(0,1fr)); gap:8px; }
  .vf-photos { display:grid; grid-template-columns:repeat(3, minmax(0,1fr)); gap:8px; }
  .vf-photo-wrap { position:relative; }
  .vf-photo-wrap .photo-preview { width:100%; height:110px; object-fit:cover; border-radius:var(--r-xs); display:block; }
  .vf-photo-wrap .photo-preview.expanded { position:fixed; inset:0; z-index:60; width:100%; height:100%;
    object-fit:contain; background:rgba(0,0,0,.86); border-radius:0; }
  .vf-photo-del { position:absolute; top:4px; right:4px; width:40px; height:40px; min-height:40px; padding:0;
    border-radius:var(--r-full); background:rgba(0,0,0,.62); color:#fff; border:none; display:flex;
    align-items:center; justify-content:center; }
  @media (max-width:399px) {
    .vf-grid { grid-template-columns:repeat(2, minmax(0,1fr)); }
    .vf-grid > .vf-sub { grid-column:1 / -1; }
    .vf-photos { grid-template-columns:repeat(2, minmax(0,1fr)); }
  }
  /* Same 40px floor as .vf-item .icon-btn above, applied consistently: the
     slot +/- steppers were 37x27 and 34x32 (mismatched with each other, both
     under the floor), the Bebas/Slot mode chips were 32px tall, and the
     add-item / paste-from-clipboard buttons were 38px — small enough that a
     thumb missed them (see the identical bug noted on .hist-filters .chip-btn
     in HIST_CSS: under the floor next to full-size controls reads as broken,
     not smaller). .chip-btn's own rule (index.html) has no min-height at all,
     so every place it's used inside this screen needs it re-asserted here. */
  .item-mode-btn, .slot-dec, .slot-inc { min-height:40px; min-width:40px; justify-content:center; }
  #add-item-btn, #verify-paste-photo, #verify-add-photo { min-height:40px; }
</style>`;

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
        transacted_at: ocr.transacted_at || ocr.date || "",
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
      <div class="topbar-title">${manual ? "Bikin Manual" : "Periksa Hasil"}</div>
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
      <p class="muted" style="text-align:center;margin-top:6px;">Opsional — foto cuma ditempel, gak dibaca otomatis.</p>
    </div>` : "")}

    <div class="card">
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

    ${verifyState.ocrError ? `
    <div class="warn-box">
      <div style="display:flex;gap:9px;align-items:flex-start;">
        <span style="color:var(--red);display:flex;">${ic("alert")}</span>
        <div><strong>Struknya Gagal Dibaca Otomatis</strong>
          <p class="muted" style="margin-top:4px;">${esc(verifyState.ocrError)}</p>
          <p class="muted" style="margin-top:4px;">Fotonya kesimpen kok — isi manual di bawah, atau coba baca otomatis lagi.</p></div>
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
      <p class="muted" style="margin:-4px 0 10px;"><strong style="color:var(--text-2);">Bebas</strong>
      = siapa pun boleh centang, harganya dibagi rata sesuai porsi yang keambil.
      <strong style="color:var(--text-2);">Slot</strong> = dibagi jadi N bagian tetap.</p>
      <div id="items-list"></div>
      <button class="btn-outline btn-sm" id="add-item-btn" style="width:100%;margin-top:10px;">${ic("plus")} Tambah Item</button>
    </div>

    <div class="card">
      <div class="card-title"><span>Total</span></div>
      <div class="vf-grid">
        <div class="vf-sub">
          <label for="subtotal-input">Subtotal (Rp)</label>
          <input class="input-money" type="text" inputmode="numeric" id="subtotal-input" placeholder="0" maxlength="16" value="${rupiahFmt(verifyState.subtotal)}">
        </div>
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
          <span class="muted" style="display:block;">Angka item yang kamu isi SUDAH termasuk PPN — PPN gak dihitung lagi dari total.</span>
        </span>
        <input type="checkbox" id="tax-included-toggle" ${verifyState.tax_included ? "checked" : ""}>
      </label>
      <div id="tax-included-badge" class="info-box ${verifyState.tax_included ? "" : "hidden"}"
           style="margin:8px 0 0;display:flex;gap:8px;align-items:flex-start;">
        ${ic("info")}<span>Total = subtotal + service aja — PPN udah masuk di harga item</span>
      </div>
      <div id="sum-warn" class="error-text hidden"></div>
    </div>

    <div class="card">
      <div class="card-title"><span>Yang Bayar</span></div>
      <label class="toggle-row" for="paid-by-me">
        <span style="flex:1;">
          <span class="label-strong">Aku yang bayar</span>
          <span class="muted" style="display:block;">Yang bayar dianggap udah lunas otomatis</span>
        </span>
        <input type="checkbox" id="paid-by-me" ${verifyState.paidByMyself ? "checked" : ""}>
      </label>
      <div id="paid-by-other" class="${verifyState.paidByMyself ? "hidden" : ""}" style="margin-top:10px;">
        <label for="paid-by-name-input">Nama Yang Bayar</label>
        <input id="paid-by-name-input" placeholder="Contoh: Budi" value="${esc(verifyState.paid_by_name || "")}" maxlength="30" autocomplete="off">
        <p class="muted" style="margin-top:5px;">Bisa diubah lagi nanti setelah orangnya join bill</p>
      </div>
    </div>

    <div class="card">
      <div class="card-title"><span>Siapa yang Ikut</span></div>
      <p class="muted" style="margin:-4px 0 10px;">Opsional, bisa diundang lagi nanti. Pilih dari orang yang pernah share bill sama kamu — yang auto-accept langsung masuk, sisanya dapat undangan di beranda. Nama lain bisa diketik manual.</p>
      <div id="people-pick" style="display:flex;flex-direction:column;gap:6px;"></div>
      <div style="display:flex;gap:8px;margin-top:10px;">
        <input id="person-name-input" placeholder="Nama lainnya (opsional)" maxlength="30" autocomplete="off" style="flex:1;">
        <button class="btn-outline btn-sm" id="person-name-add" style="flex-shrink:0;">${ic("plus")} Tambah</button>
      </div>
      <div id="people-chips" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;"></div>
    </div>`;

  const side = `
    <div class="dock"><div class="dock-inner">
      <div class="dock-total">
        <span class="label-sm">Total</span>
        <span class="money" id="total-display">${fmt(verifyState.total)}</span>
      </div>
      <button class="btn-primary" id="create-bill-btn">Bikin Bill &amp; Bagikan</button>
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
  guardHash(async () => !verifyHasTypedContent() || confirmDiscardVerify());
  $("#back-btn").addEventListener("click", async () => {
    if (verifyHasTypedContent()) {
      const ok = await confirmDiscardVerify();
      if (!ok) return;
    }
    clearHashGuard();
    location.hash = "#/create";
  });

  // v61: multi-photo preview — tap to zoom, ✕ to remove, + to add more
  const photoImgs = $$(".vf-photo-wrap .photo-preview");
  photoImgs.forEach(img => img.addEventListener("click", () => img.classList.toggle("expanded")));
  $$(".vf-photo-del").forEach(btn => btn.addEventListener("click", () => {
    const idx = parseInt(btn.dataset.idx, 10);
    if (!Number.isFinite(idx)) return;
    verifyState.photos.splice(idx, 1);
    verifyState.photo_path = verifyState.photos[0] || null;
    renderVerify({ ...verifyState, photos: verifyState.photos, paid_by_name: verifyState.paid_by_name }, verifyState.manual);
  }));
  const addPhotoBtn = $("#verify-add-photo");
  const pastePhotoBtn = $("#verify-paste-photo");
  if (pastePhotoBtn) pastePhotoBtn.addEventListener("click", () => readClipboardImage());
  const retryScanBtn = $("#verify-retry-scan");
  if (retryScanBtn) retryScanBtn.addEventListener("click", () => {
    const f = verifyState.ocrRetryFile;
    if (!f) { toast("Foto aslinya udah gak ada — upload ulang ya"); return; }
    // route through #/create first (clearing the guard on the way): this is
    // a deliberate hop back into the OCR flow, not a "leave and lose data"
    // the guard should question, and uploadAndOcr needs the create screen's
    // #create-body mounted for its spinner
    clearHashGuard();
    location.hash = "#/create";
    uploadAndOcr(f);
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
        try {
          const fd = new FormData();
          fd.append("file", f);
          const result = await api("/api/photos", { method: "POST", body: fd });
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
      if (verifyState.extraNames.includes(v)) { toast("Nama itu udah kepilih"); return; }
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
            peoplePick.innerHTML = `<p class="muted" style="padding:2px 0;">Belum ada kontak — undang orang lewat link dulu, nanti dia muncul di sini.</p>`;
            return;
          }
          peoplePick.innerHTML = contacts.map(c => `
            <label class="account-row" style="cursor:pointer;">
              <input type="checkbox" id="pp-cb-${esc(c.id)}" style="flex:0 0 auto;" />
              <div class="avatar" style="flex:0 0 auto;">${esc(initials(c.name))}</div>
              <div style="flex:1;min-width:0;">
                <div class="item-name">${esc(c.name)}</div>
                <div class="muted">${c.last_shared ? "pernah share bill" : "kontak"}</div>
              </div>
            </label>`).join("");
          $$("#people-pick input[type=checkbox]").forEach(cb => cb.addEventListener("change", () => {
            const label = cb.closest(".account-row");
            const name = label.querySelector(".item-name").textContent;
            const id = cb.id.slice(6); // strip "pp-cb-"
            if (cb.checked) {
              if (!verifyState.participants.some(p => p.id === id)) verifyState.participants.push({ id, name });
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
  if (paidByMe) {
    paidByMe.addEventListener("change", () => {
      $("#paid-by-other").classList.toggle("hidden", paidByMe.checked);
      verifyState.paidByMyself = paidByMe.checked;
      if (paidByMe.checked) {
        // re-checking "aku yang bayar" must clear a stale typed name,
        // otherwise the old placeholder gets sent and ownership shifts to
        // someone who never should have it
        verifyState.paid_by_name = null;
      } else {
        const inp = $("#paid-by-name-input");
        if (inp) { verifyState.paid_by_name = inp.value; inp.focus(); }
      }
    });
  }
  const paidByNameInput = $("#paid-by-name-input");
  if (paidByNameInput) {
    paidByNameInput.addEventListener("input", (e) => {
      if (paidByMe && paidByMe.checked) return; // ignore while "aku" checked
      verifyState.paid_by_name = e.target.value;
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
      <input data-role="price" data-idx="${idx}" class="input-money" type="text" inputmode="numeric" maxlength="16"
             value="${rupiahFmt(it.price)}" placeholder="0" aria-label="Harga item baris ${idx + 1}">
      <button type="button" data-role="del" data-idx="${idx}" class="icon-btn ghost"
              aria-label="Hapus item baris ${idx + 1}" style="color:var(--red);">${ic("trash")}</button>

      <div class="vf-full" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <label class="label-sm" for="disc-${idx}" style="margin:0;">Potongan (diskon)</label>
        <input id="disc-${idx}" data-role="discount" data-idx="${idx}" class="input-money" type="text"
               inputmode="numeric" maxlength="16" value="${rupiahFmt(it.discount)}" placeholder="0" style="max-width:110px;">
        ${/* "harga asli − potongan = yang dibayar" used to sit next to every
              discount box: five copies of the same subtraction, four lines each
              on a phone. The green result below says it better, and only when
              there is actually a discount. */ ""}
        ${it.discount > 0 ? `<span class="disc-bayar money-sm" style="color:var(--green);font-weight:700;">→ bayar ${rupiahFmt(eff)}</span>` : ""}
      </div>

      <div class="vf-full">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:5px;">
          <span class="label-sm">Cara Bagi</span>
          <button type="button" class="chip-btn item-mode-btn ${!isSlot ? "chip-active" : ""}" data-idx="${idx}" data-mode="free"
                  aria-pressed="${!isSlot}">${ic("people")} Bebas</button>
          <button type="button" class="chip-btn item-mode-btn ${isSlot ? "chip-active" : ""}" data-idx="${idx}" data-mode="slot"
                  aria-pressed="${isSlot}">${ic("slot")} Slot</button>
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
      warn.textContent = "Struknya gak kebaca jelas — tambah item manual aja, subtotal udah dibiarin dari struk.";
      warn.style.color = "var(--accent)";
    } else if (mismatch) {
      warn.classList.remove("hidden");
      warn.style.color = "";
      if (sumItems === total) {
        warn.textContent = `Harga item (${fmt(sumItems)}) kayaknya udah TERMASUK pajak, tapi kamu isi Subtotal ${fmt(subtotal)} + PPN. Aktifin toggle "Harga item sudah termasuk pajak" biar gak dobel.`;
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
    cta.disabled = mismatch;
    cta.textContent = mismatch ? "Subtotal belum cocok sama item" : "Bikin Bill & Bagikan";
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
    toast("Tulis dulu nama yang bayar (atau centang Aku yang bayar)");
    const inp = $("#paid-by-name-input");
    if (inp) { inp.style.borderColor = "var(--red)"; inp.focus(); }
    return;
  }

  await withBusy(btn, "Bikin bill", async () => {
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
        participants: verifyState.extraNames || [],
      });
      // invite the proven-contacts picked on the create screen: auto-accept
      // joins instantly, others get a pending card on their home. Done as a
      // chain because /invite needs an existing bill id. In PARALLEL — the old
      // sequential loop took N round-trips before the user even saw the bill
      // (bug: N contacts = N slow RTTs on one button press).
      if (verifyState.participants.length) {
        const results = await Promise.allSettled(
          verifyState.participants.map(p =>
            apiJson(`/api/bills/${bill.id}/invite`, "POST", { identity_id: p.id })
              .then(r => ({ name: p.name, status: r.status, ok: true }))
              .catch(e => ({ name: p.name, status: e.message, ok: false }))
          )
        );
        const values = results.map(r => r.status === "fulfilled" ? r.value
          : { name: (r.reason && r.reason.name) || "Seseorang", status: "error", ok: false });
        const joined = values.filter(v => v.ok && v.status === "joined");
        const pending = values.filter(v => v.ok && v.status !== "joined");
        const failed = values.filter(v => !v.ok);
        // five picked contacts used to join `invited.join(" · ")` into ONE
        // toast — ~100 chars in a pill capped at min(90%, 420px), gone after
        // 2.6s while the app was already navigating to the new bill (bug:
        // nobody could read it in time). Report counts instead — always
        // legible at a glance — plus a taste of who, not the full roster.
        const named = [...joined, ...pending].map(v => v.name).slice(0, 2);
        const extra = values.length - named.length;
        let msg = `${values.length} orang diundang`;
        if (joined.length) msg += ` · ${joined.length} langsung masuk`;
        if (named.length) msg += ` (${named.join(", ")}${extra > 0 ? ` +${extra} lagi` : ""})`;
        if (failed.length) msg += ` · ${failed.length} gagal`;
        toast(msg);
      }
      // a successful submit is not a "leave" the guard should question —
      // without this the router's leave-guard (armed on entry) would pop
      // "Buang isian ini?" right after the bill was already saved
      clearHashGuard();
      location.hash = "#/b/" + bill.id;
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
