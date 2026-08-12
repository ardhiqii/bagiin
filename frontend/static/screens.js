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
    withBusy($("#restore-btn"), "Mulihin...", async () => {
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
      <h1>Mau Bagi Bill Apa Hari Ini?</h1>
    </div>
    <button class="btn-primary" id="create-btn" style="margin-bottom:20px;">${ic("plus")} Buat Bill Baru</button>
    <div class="card">
      <div class="card-title">
        <span>Riwayat</span>
        <button class="btn-ghost btn-sm btn-auto hidden" id="see-all">Lihat semua ${ic("chevron")}</button>
      </div>
      <div id="home-history">${skeletonRows(3)}</div>
    </div>`);
  watchDock();

  $("#create-btn").addEventListener("click", () => location.hash = "#/create");
  $("#history-btn").addEventListener("click", () => location.hash = "#/history");
  $("#settings-btn").addEventListener("click", () => location.hash = "#/settings");
  $("#see-all").addEventListener("click", () => location.hash = "#/history");

  loadHomeHistory();
}

/** One status per bill row, so the chip, the colour and the icon can't drift
 *  apart. `tone` drives the row's colour anchor. */
function billListStatus(b) {
  if (b.status === "closed") return { tone: "done", label: "Selesai", icon: "check" };
  if (b.settled) return { tone: "ok", label: "Lunas", icon: "check" };
  // a bill nobody has picked from isn't "belum lunas" — nobody owes anything
  // yet. Saying so put a red chip next to a green "Kamu udah bayar" on a bill
  // where literally nothing had happened (bug: chips contradicted each other).
  if (!b.has_picks) return { tone: "idle", label: "Belum dipilih", icon: "receipt" };
  return { tone: "due", label: "Belum lunas", icon: "receipt" };
}

const STATUS_CHIP = { ok: "chip-green", due: "chip-red", done: "chip-grey", idle: "chip-grey" };

function billListStatusChip(b) {
  const s = billListStatus(b);
  const withIcon = s.tone === "ok" ? ic("check") : "";
  return `<span class="chip ${STATUS_CHIP[s.tone]}">${withIcon}${s.label}</span>`;
}

// personal line for the CURRENT viewer — only meaningful while the bill is
// open, has picks, and isn't fully settled ("Selesai"/"Lunas" say enough).
function personalStatusHtml(b) {
  if (b.status === "closed" || b.settled || !b.has_picks) return "";
  // the payer never "paid" — they fronted the money. Calling that "udah bayar"
  // is what made a fresh bill claim a payment that never happened.
  if (b.i_am_payer) return `<div class="item-share">Kamu yang nalangin</div>`;
  return b.my_paid
    ? `<div class="item-share" style="color:var(--green);">Kamu udah bayar</div>`
    : `<div class="item-share" style="color:var(--red);">Kamu belum bayar</div>`;
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
      ${b.can_manage
        // gate on can_manage (creator OR resolved payer), not owner_id — the
        // creator keeps management powers even when someone else fronted the
        // money, and owner_id alone hid the delete button from them
        ? `<button class="icon-btn ghost delete-bill" data-id="${esc(b.id)}" data-title="${esc(b.title)}"
                   aria-label="Hapus bill ${esc(b.title)}">${ic("trash")}</button>`
        : ""}
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

async function loadHomeHistory() {
  const box = $("#home-history");
  if (!box) return;
  box.innerHTML = skeletonRows(3);
  try {
    const bills = await api("/api/identities/" + state.identity.id + "/bills");
    const seeAll = $("#see-all");
    if (seeAll) seeAll.classList.toggle("hidden", bills.length <= 5);
    if (!bills.length) {
      box.innerHTML = `<div class="empty-state">${ic("receipt")}
        <p>Belum ada bill.</p><p class="muted">Bikin Bill Pertama Kamu Sekarang!</p></div>`;
      return;
    }
    box.innerHTML = bills.slice(0, 5).map(billRowHtml).join("");
    bindBillRows(box, loadHomeHistory);
  } catch (e) {
    box.innerHTML = identityErrorHtml(e);
    bindIdentityError(box);
  }
}

// ---------- History ----------
function renderHistory() {
  const app = $("#app");
  app.innerHTML = shell(`
    <div class="topbar">
      <button class="icon-btn" id="back-btn" aria-label="Kembali ke beranda">${ic("back")}</button>
      <div class="topbar-title">Riwayat</div>
      <div style="width:42px;flex-shrink:0;" aria-hidden="true"></div>
    </div>
    <div class="card" id="hist-list">${skeletonRows(4)}</div>`);
  watchDock();
  $("#back-btn").addEventListener("click", () => location.hash = "#/");
  loadHistoryList();
}

async function loadHistoryList() {
  const box = $("#hist-list");
  if (!box) return;
  try {
    const bills = await api("/api/identities/" + state.identity.id + "/bills");
    if (!bills.length) {
      box.innerHTML = `<div class="empty-state">${ic("empty")}
        <p>Belum ada bill.</p><p class="muted">Bill yang kamu buat atau kamu ikutin bakal nongol di sini.</p></div>`;
      return;
    }
    // newest first, grouped by month so a long list stays scannable
    const sorted = bills.slice().sort((a, b) =>
      String(b.transacted_at || b.created_at || "").localeCompare(String(a.transacted_at || a.created_at || "")));
    let html = "", lastMonth = null;
    for (const b of sorted) {
      const m = monthLabel(b.transacted_at || b.created_at) || "Tanpa tanggal";
      if (m !== lastMonth) { html += `<div class="history-month">${esc(m)}</div>`; lastMonth = m; }
      html += billRowHtml(b);
    }
    box.innerHTML = html;
    bindBillRows(box, loadHistoryList);
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
function brandInfo(code) { return BRANDS.find(b => b.c === code) || null; }
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
         <button class="btn-outline btn-sm" id="regen-code" style="width:100%;">${ic("refresh")} Bikin kode baru</button>`
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
            <div class="item-name">${esc(a.brand)}</div>
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
        : "<strong>Kamu belum punya kode pemulihan.</strong> Kalau keluar sekarang, semua bill kamu gak bisa dibuka lagi — selamanya, di HP ini maupun di HP lain. Bikin kode pemulihan dulu kalau masih butuh billnya.",
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
    const brand = matchBrand(line);
    // number-like chunk on this line: digits, optionally grouped with spaces/dashes
    const numMatch = line.match(/(?:^|\s)([0-9][0-9\s\-]{5,})/);
    const number = numMatch ? numMatch[1].replace(/[\s\-]/g, "") : null;
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
    <button class="btn-primary" id="parse-acct-btn">Parse</button>
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

function renderCreate(opts = {}) {
  const app = $("#app");
  const coarse = isCoarsePointer();
  const hint = coarse
    ? "Ketuk buat ambil foto atau pilih dari galeri"
    : "Ketuk buat pilih file, tempel (Ctrl+V), atau tarik file ke sini";
  const errCard = opts.ocrError
    ? `<div class="warn-box">
         <div style="display:flex;gap:9px;align-items:flex-start;">
           <span style="color:var(--red);display:flex;">${ic("alert")}</span>
           <div><strong>Gagal Baca Struk</strong>
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
  const openPicker = (capture) => {
    fileInput.removeAttribute("capture");
    if (capture) fileInput.setAttribute("capture", "environment");
    fileInput.value = "";
    fileInput.click();
  };

  dz.addEventListener("click", () => {
    const body = coarse
      ? `<button class="btn-primary" id="dz-camera">${ic("camera")} Ambil Foto</button>
         <button class="btn-outline" id="dz-gallery">${ic("image")} Pilih dari Galeri</button>
         <button class="btn-outline" id="dz-clipboard">${ic("clipboard")} Tempel dari Clipboard</button>`
      : `<button class="btn-primary" id="dz-gallery">${ic("image")} Pilih file</button>
         <button class="btn-outline" id="dz-clipboard">${ic("clipboard")} Tempel (Ctrl+V)</button>`;
    const s = openSheet(`
      <div class="sheet-handle"></div>
      <div class="sheet-title">Foto Struk</div>
      <p class="sheet-sub">${coarse ? "Struk yang kefoto lurus & terang paling gampang kebaca." : "Bisa juga langsung tarik filenya ke area foto."}</p>
      ${body}
      <button class="btn-ghost" id="dz-cancel">Batal</button>`, { noAutofocus: true });
    const cam = $("#dz-camera", s.sheet);
    if (cam) cam.addEventListener("click", () => { s.close(); openPicker(true); });
    $("#dz-gallery", s.sheet).addEventListener("click", () => { s.close(); openPicker(false); });
    $("#dz-clipboard", s.sheet).addEventListener("click", () => { s.close(); readClipboardImage(); });
    $("#dz-cancel", s.sheet).addEventListener("click", s.close);
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
    if (!f.type || !f.type.startsWith("image/")) { toast("File harus gambar"); return; }
    if (f.size > 5 * 1024 * 1024) { toast("Foto maksimal 5MB"); return; }
    uploadAndOcr(f);
  });
  fileInput.addEventListener("change", async () => {
    const f = fileInput.files[0];
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) { toast("Foto maksimal 5MB"); return; }
    await uploadAndOcr(f);
  });

  const blankBill = () => ({
    items: [], subtotal: 0, tax: 0, service: 0, total: 0,
    photo_path: null, merchant: "", date: "",
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
    renderCreate({ ocrError: e.message, ocrFile: file });
  }
}

// ---------- Clipboard paste (Ctrl+V on desktop, paste menu on mobile) ----------

// Global paste listener — only acts when the create screen dropzone is mounted,
// so pasting an image elsewhere (notes, chat input) is never hijacked.
function pasteImageHandler(e) {
  if (!document.getElementById("dz")) return;
  const items = (e.clipboardData && e.clipboardData.items) || [];
  for (const it of items) {
    if (it.kind === "file" && it.type && it.type.startsWith("image/")) {
      const f = it.getAsFile();
      if (!f) continue;
      e.preventDefault();
      if (f.size > 5 * 1024 * 1024) { toast("Foto maksimal 5MB"); return; }
      uploadAndOcr(f);
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
      await uploadAndOcr(f);
      return;
    }
    toast("Clipboard kamu gak ada gambarnya");
  } catch (e) {
    toast("Gak bisa baca clipboard: " + e.message);
  }
}

// ---------- Verify OCR result ----------
let verifyState = {
  items: [], subtotal: 0, tax: 0, service: 0, total: 0, photo_path: null,
  title: "", merchant: "", transacted_at: "", manual: false, paid_by_name: null,
  tax_included: false, taxSaved: 0,
};

/* Layout rules that only this screen needs. Injected with the screen markup so
   there is no build step and nothing leaks to other screens.
   - .vf-item: the row used to be flex-wrap, so under ~360px the ✕ wrapped
     underneath the name and the row scrambled (bug: unusable on small phones).
   - .vf-grid: Subtotal/PPN/Service side by side is unreadable under ~380px,
     so Subtotal takes its own line and PPN/Service share the next one. */
const VERIFY_CSS = `<style>
  .vf-item { display:grid; grid-template-columns:1fr 110px 40px; gap:8px; align-items:center;
             padding:12px 2px; border-bottom:1px solid var(--border); }
  .vf-item:last-child { border-bottom:none; }
  .vf-item input { padding:9px 10px; }
  .vf-item .icon-btn { width:40px; height:40px; min-height:40px; }
  .vf-full { grid-column:1 / -1; }
  .vf-grid { display:grid; grid-template-columns:repeat(3, minmax(0,1fr)); gap:8px; }
  @media (max-width:399px) {
    .vf-grid { grid-template-columns:repeat(2, minmax(0,1fr)); }
    .vf-grid > .vf-sub { grid-column:1 / -1; }
  }
</style>`;

function renderVerify(ocr, manual = false) {
  verifyState = {
    items: ocr.items || [],
    subtotal: ocr.subtotal || 0,
    tax: ocr.tax || 0,
    service: ocr.service || 0,
    total: ocr.total || 0,
    photo_path: ocr.photo_path || null,
    title: ocr.merchant || "",
    merchant: ocr.merchant || "",
    transacted_at: ocr.date || "",
    manual,
    paid_by_name: null,
    tax_included: !!(ocr.tax_included),
    // last PPN the user typed, so switching "termasuk pajak" off can put it
    // back (see the toggle handler)
    taxSaved: ocr.tax || 0,
  };
  // subtotal auto-follows the item sum UNLESS the user explicitly typed their
  // own subtotal. For OCR: when the receipt's subtotal differs from the items
  // (LLM missed an item line), keep the receipt value & show the warning —
  // otherwise let it follow the items so editing a price updates the total.
  const _sumItems = (verifyState.items || []).reduce((s, i) => s + Math.max(0, (i.price || 0) - (i.discount || 0)), 0);
  verifyState.subtotalTouched = !manual && _sumItems !== (verifyState.subtotal || 0);

  const main = `
    ${VERIFY_CSS}
    <div class="topbar">
      <button class="icon-btn" id="back-btn" aria-label="Kembali">${ic("back")}</button>
      <div class="topbar-title">${manual ? "Bikin Manual" : "Periksa Hasil"}</div>
      <div style="width:42px;flex-shrink:0;" aria-hidden="true"></div>
    </div>
    ${verifyState.photo_path ? `
    <div class="card" style="padding:8px;">
      <img class="photo-preview" id="receipt-photo" src="/uploads/${esc(verifyState.photo_path.split("/").pop())}" alt="Foto struk asli" loading="lazy">
      <div class="muted" style="text-align:center;margin-top:4px;">Struk asli · ketuk buat perbesar</div>
    </div>` : ""}

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

    <div class="card" id="items-card">
      <div class="card-title">
        <span>Item</span>
        <span class="muted">${manual ? "Ketik item &amp; harganya" : "cek ulang, edit kalau salah"}</span>
      </div>
      <div id="items-list"></div>
      <button class="btn-outline btn-sm" id="add-item-btn" style="width:100%;margin-top:10px;">${ic("plus")} Tambah Item</button>
    </div>

    <div class="card">
      <div class="card-title"><span>Total</span></div>
      <div class="vf-grid">
        <div class="vf-sub">
          <label for="subtotal-input">Subtotal</label>
          <input class="input-money" type="text" inputmode="numeric" id="subtotal-input" value="${rupiahFmt(verifyState.subtotal)}">
        </div>
        <div>
          <label for="tax-input">PPN</label>
          <input class="input-money" type="text" inputmode="numeric" id="tax-input" placeholder="0" value="${rupiahFmt(verifyState.tax)}">
        </div>
        <div>
          <label for="service-input">Service</label>
          <input class="input-money" type="text" inputmode="numeric" id="service-input" placeholder="0" value="${rupiahFmt(verifyState.service)}">
        </div>
      </div>
      <label class="toggle-row" for="tax-included-toggle" style="margin-top:10px;">
        <span style="flex:1;">
          <span class="label-strong">Harga Item Sudah Termasuk Pajak</span>
          <span class="muted" style="display:block;">Kalau struk nulis "termasuk pajak", harga tiap item udah kehitung pajaknya</span>
        </span>
        <input type="checkbox" id="tax-included-toggle" ${verifyState.tax_included ? "checked" : ""}>
      </label>
      <div id="tax-included-badge" class="info-box ${verifyState.tax_included ? "" : "hidden"}"
           style="margin:8px 0 0;display:flex;gap:8px;align-items:flex-start;">
        ${ic("info")}<span>PPN dikosongin — service charge tetep dibagi</span>
      </div>
      <div id="sum-warn" class="error-text hidden"></div>
    </div>

    <div class="card">
      <div class="card-title"><span>Yang Bayar</span></div>
      <label class="toggle-row" for="paid-by-me">
        <span style="flex:1;">
          <span class="label-strong">Aku Yang Bayar</span>
          <span class="muted" style="display:block;">Yang bayar dianggap udah lunas otomatis</span>
        </span>
        <input type="checkbox" id="paid-by-me" ${verifyState.paid_by_name ? "" : "checked"}>
      </label>
      <div id="paid-by-other" class="${verifyState.paid_by_name ? "" : "hidden"}" style="margin-top:10px;">
        <label for="paid-by-name-input">Nama Yang Bayar</label>
        <input id="paid-by-name-input" placeholder="Contoh: Budi" value="${esc(verifyState.paid_by_name || "")}" maxlength="30" autocomplete="off">
        <p class="muted" style="margin-top:5px;">Bisa diubah lagi nanti setelah orangnya join bill</p>
      </div>
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

  // leaving this screen throws away every correction the user typed, so ask
  // first when there is anything to lose (bug: one stray back tap and a whole
  // re-typed receipt was gone)
  const hasTypedContent = () =>
    !!(String(verifyState.title || "").trim() ||
       verifyState.tax || verifyState.service ||
       (verifyState.items || []).some(i => String(i.name || "").trim() || (i.price || 0) > 0));
  $("#back-btn").addEventListener("click", async () => {
    if (hasTypedContent()) {
      const ok = await confirmSheet({
        title: "Buang isian ini?",
        body: "Semua yang udah kamu ketik di sini — item, harga, judul — bakal ilang.",
        confirmText: "Buang aja", cancelText: "Lanjut isi", danger: true,
      });
      if (!ok) return;
    }
    renderCreate();
  });

  const photo = $("#receipt-photo");
  if (photo) photo.addEventListener("click", () => photo.classList.toggle("expanded"));
  renderVerifyItems();
  bindVerifyInputs();

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
      <input data-role="price" data-idx="${idx}" class="input-money" type="text" inputmode="numeric"
             value="${rupiahFmt(it.price)}" placeholder="0" aria-label="Harga item baris ${idx + 1}">
      <button type="button" data-role="del" data-idx="${idx}" class="icon-btn ghost"
              aria-label="Hapus item baris ${idx + 1}">${ic("x")}</button>

      <div class="vf-full" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <label class="label-sm" for="disc-${idx}" style="margin:0;">Diskon</label>
        <input id="disc-${idx}" data-role="discount" data-idx="${idx}" class="input-money" type="text"
               inputmode="numeric" value="${rupiahFmt(it.discount)}" placeholder="0" style="max-width:120px;">
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
            <span class="muted" style="font-size:12px;">orang</span>
          </span>` : ""}
        </div>
        <div class="muted" style="font-size:12px;line-height:1.45;">
          ${isSlot
            ? `Dibagi ${slots} bagian tetap${eff > 0 ? ` · ${rupiahFmt(perSlot)}/bagian` : ""}. Tiap orang bisa ambil 1 bagian atau lebih, sisanya keliatan kosong.`
            : `Pilih bebas: centang item yang kamu makan — bisa ambil 1 porsi atau lebih. Harganya dibagi sesuai porsi yang keambil.`}
        </div>
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
    if (ti) { ti.value = ""; ti.disabled = true; }
    tax = 0;
  } else if (ti) {
    ti.disabled = false;
  }
  const total = subtotal + tax + service;
  verifyState.subtotal = subtotal; verifyState.tax = tax; verifyState.service = service;
  verifyState.total = total;
  const td = $("#total-display");
  if (td) td.textContent = fmt(total);
  const badge = $("#tax-included-badge");
  if (badge) badge.classList.toggle("hidden", !verifyState.tax_included);

  const mismatch = sumItems !== subtotal;
  const warn = $("#sum-warn");
  if (warn) {
    if (mismatch) {
      warn.classList.remove("hidden");
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
      badMsg = `Diskon "${it.name}" lebih gede dari harganya`;
    }
  });
  if (badInput) {
    badInput.style.borderColor = "var(--red)";
    try { badInput.scrollIntoView({ block: "center", behavior: "smooth" }); badInput.focus(); } catch (e) {}
    toast(badMsg);
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
        paid_by_name: verifyState.paid_by_name || null,
        tax_included: verifyState.tax_included ? 1 : 0,
      });
      location.hash = "#/b/" + bill.id;
    } catch (e) {
      toast(e.message);
    }
  });
}

// ---------- rupiah input helpers ----------
function rupiahDigits(v) { return String(v == null ? "" : v).replace(/\D/g, "").replace(/^0+(?=\d)/, ""); }
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
