/* Bagiin frontend - screens */

// ---------- Onboarding ----------
function renderOnboarding() {
  const app = $("#app");
  const saved = lsGet(LS_KEYS.name, "");
  app.innerHTML = `
    <div style="min-height:70dvh;display:flex;flex-direction:column;justify-content:center;max-width:400px;margin:0 auto;">
      <div style="font-size:40px;margin-bottom:16px;">🤝</div>
      <h1 style="font-size:24px;font-weight:800;letter-spacing:-0.02em;margin-bottom:8px;">Bagiin</h1>
      <p class="muted" style="margin-bottom:24px;">Bagi bill bareng jadi gak ribet. Foto struk, share link, semua milih itemnya sendiri.</p>
      <div class="field">
        <label for="name-input">Siapa namamu?</label>
        <input id="name-input" type="text" placeholder="Biar temenmu tau ini kamu" value="${saved}" maxlength="30" autocomplete="off">
      </div>
      <button class="btn-primary" id="onboard-btn">Masuk</button>
      <p class="muted" style="margin-top:16px;text-align:center;">Tanpa akun. Namamu cuma disimpan di device ini.</p>
      <p style="margin-top:8px;text-align:center;"><a href="#" id="restore-link" style="color:var(--accent);text-decoration:none;font-size:14px;">Punya kode pemulihan?</a></p>
      <div id="restore-box" class="hidden" style="margin-top:12px;">
        <div class="field" style="margin-bottom:8px;">
          <label for="restore-code">Kode pemulihan</label>
          <input id="restore-code" placeholder="XXXX-XXXX-XXXX" maxlength="30" autocomplete="off">
        </div>
        <button class="btn-outline" id="restore-btn" style="width:100%;">Pulihkan Akun</button>
      </div>
    </div>`;
  const input = $("#name-input");
  input.focus();
  const go = async () => {
    const name = input.value.trim();
    if (!name) { toast("Isi nama dulu"); return; }
    try { await ensureIdentity(name); render(); }
    catch (e) { toast(e.message); }
  };
  $("#onboard-btn").addEventListener("click", go);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
  $("#restore-link").addEventListener("click", (e) => {
    e.preventDefault();
    $("#restore-box").classList.toggle("hidden");
  });
  $("#restore-btn").addEventListener("click", async () => {
    const code = $("#restore-code").value.trim();
    if (!code) { toast("Isi kode dulu"); return; }
    try {
      const ident = await apiJson("/api/identities/restore", "POST", { code });
      state.identity = ident;
      lsSet(LS_KEYS.ident, ident);
      lsSet(LS_KEYS.name, ident.name);
      toast("Akun dipulihkan! 🎉");
      render();
    } catch (e) { toast(e.message); }
  });
}

// ---------- Home (dashboard) ----------
function renderHome() {
  const app = $("#app");
  const name = state.identity.name.split(" ")[0];
  app.innerHTML = `
    <div class="topbar">
      <div class="brand">Bagiin<span class="dot">.</span></div>
      <div class="right">
        <button class="btn-icon" id="history-btn" title="Riwayat">📋</button>
        <button class="btn-icon" id="settings-btn" title="Akun">👤</button>
      </div>
    </div>
    <div style="margin-bottom:20px;">
      <p class="muted">Halo, ${name}</p>
      <h1 style="font-size:26px;font-weight:800;letter-spacing:-0.02em;">Mau bagi bill apa hari ini?</h1>
    </div>
    <button class="btn-primary" id="create-btn" style="margin-bottom:24px;">＋ Buat Bill Baru</button>
    <div class="label-sm" style="margin-bottom:8px;">Riwayat</div>
    <div class="card" id="home-history"><div class="muted" style="text-align:center;padding:12px;">Memuat...</div></div>`;

  $("#create-btn").addEventListener("click", () => location.hash = "#/create");
  $("#history-btn").addEventListener("click", () => location.hash = "#/history");
  $("#settings-btn").addEventListener("click", () => location.hash = "#/settings");

  loadHomeHistory();
}

function billListStatusChip(b) {
  if (b.status === "closed") return `<span class="chip chip-grey">Selesai</span>`;
  if (b.settled) return `<span class="chip chip-green">Lunas</span>`;
  return `<span class="chip chip-red">Belum lunas</span>`;
}

async function loadHomeHistory() {
  const box = $("#home-history");
  if (!box) return;
  try {
    const bills = await api("/api/identities/" + state.identity.id + "/bills");
    if (!bills.length) {
      box.innerHTML = `<div class="empty-state"><div class="big">🧾</div>
        <p>Belum ada bill.</p><p class="muted">Bikin bill pertama lu sekarang!</p></div>`;
      return;
    }
    box.innerHTML = bills.slice(0, 5).map(b => `
      <div class="history-row" data-id="${b.id}">
        <div style="flex:1;min-width:0;">
          <div style="font-weight:600;font-size:15px;">${esc(b.title)}</div>
          <div class="muted" style="display:flex;align-items:center;gap:8px;margin-top:2px;">
            ${billListStatusChip(b)}
            <span>${b.transacted_at ? esc(shortDate(b.transacted_at)) : esc(shortDate(b.created_at))}</span>
          </div>
        </div>
        <div style="font-weight:700;" class="money">${fmt(b.total_idr)}</div>
        ${b.creator_identity_id === state.identity.id ? `<button class="btn-sm delete-bill" data-id="${b.id}" data-title="${esc(b.title)}" title="Hapus bill" style="background:var(--red-bg);color:var(--red);flex-shrink:0;">🗑️</button>` : ""}
      </div>`).join("");
    $$(".history-row", box).forEach(r => r.addEventListener("click", () => location.hash = "#/b/" + r.dataset.id));
    $$(".delete-bill", box).forEach(btn => btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openDeleteBillConfirm(btn.dataset.id, btn.dataset.title);
    }));
  } catch (e) {
    box.innerHTML = `<div class="muted" style="text-align:center;padding:12px;">${esc(e.message)}</div>`;
  }
}

// ---------- History ----------
function renderHistory() {
  const app = $("#app");
  app.innerHTML = `
    <div class="topbar">
      <button class="btn-icon" id="back-btn">←</button>
      <div class="brand" style="font-size:16px;">Riwayat</div>
      <div style="width:44px;"></div>
    </div>
    <div class="card" id="hist-list"><div class="muted" style="text-align:center;padding:12px;">Memuat...</div></div>`;
  $("#back-btn").addEventListener("click", () => location.hash = "#/");
  (async () => {
    try {
      const bills = await api("/api/identities/" + state.identity.id + "/bills");
      const box = $("#hist-list");
      if (!bills.length) {
        box.innerHTML = `<div class="empty-state"><div class="big">🧾</div><p>Belum ada bill.</p></div>`;
        return;
      }
      box.innerHTML = bills.map(b => `
        <div class="history-row" data-id="${b.id}">
          <div style="flex:1;min-width:0;">
            <div style="font-weight:600;font-size:15px;">${esc(b.title)}</div>
            <div class="muted" style="display:flex;align-items:center;gap:8px;margin-top:2px;">
              ${billListStatusChip(b)}
              <span>${b.transacted_at ? esc(shortDate(b.transacted_at)) : esc(shortDate(b.created_at))}</span>
            </div>
          </div>
          <div class="money" style="font-weight:700;">${fmt(b.total_idr)}</div>
          ${b.creator_identity_id === state.identity.id ? `<button class="btn-sm delete-bill" data-id="${b.id}" data-title="${esc(b.title)}" title="Hapus bill" style="background:var(--red-bg);color:var(--red);flex-shrink:0;">🗑️</button>` : ""}
        </div>`).join("");
      $$(".history-row", box).forEach(r => r.addEventListener("click", () => location.hash = "#/b/" + r.dataset.id));
      $$(".delete-bill", box).forEach(btn => btn.addEventListener("click", (e) => {
        e.stopPropagation();
        openDeleteBillConfirm(btn.dataset.id, btn.dataset.title);
      }));
    } catch (e) { toast(e.message); }
  })();
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
];
function brandInfo(code) { return BRANDS.find(b => b.c === code) || null; }
function chipTextColor(hex) {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) > 165 ? "#18181B" : "#fff";
}
function brandChipHtml(code) {
  const b = brandInfo(code);
  const bg = b ? b.hex : "#52525B";
  return `<span class="brand-chip" style="background:${bg};color:${chipTextColor(bg)}">${esc(code)}</span>`;
}

function renderSettings() {
  const app = $("#app");
  const me = state.identity;
  app.innerHTML = `
    <div class="topbar">
      <button class="btn-icon" id="back-btn">←</button>
      <div class="brand" style="font-size:16px;">Akun</div>
      <div style="width:44px;"></div>
    </div>
    <div class="card">
      <div class="card-title">Nama</div>
      <div style="display:flex;gap:8px;align-items:center;">
        <input id="name-input" value="${esc(me.name)}" maxlength="30" style="flex:1;">
        <button class="btn-primary btn-sm" id="save-name" style="width:auto;">Simpan</button>
      </div>
      <p class="muted" style="margin-top:6px;">Nama ini yang dilihat orang pas milih item bill.</p>
    </div>
    <div class="card">
      <div class="card-title">Kode pemulihan</div>
      <p class="muted" style="margin-bottom:10px;">Buat kode buat pindah akun ke browser/HP lain. Kode cuma muncul sekali pas dibuat.</p>
      <div id="code-box"><button class="btn-outline" id="gen-code" style="width:100%;">🔑 Buat Kode</button></div>
    </div>
    <div class="card">
      <div class="card-title">Metode bayar</div>
      <p class="muted" style="margin-bottom:10px;">Nomor ini bakal ditampilin ke orang yang mau bayar bill lu.</p>
      <div id="accounts-list"><div class="muted" style="text-align:center;padding:8px;">Memuat...</div></div>
      <button class="btn-outline btn-sm" id="add-account-btn" style="width:100%;margin-top:8px;">＋ Tambah metode bayar</button>
      <button class="btn-outline btn-sm" id="paste-account-btn" style="width:100%;margin-top:8px;">📋 Tempel teks metode bayar</button>
      <div id="account-form" class="hidden" style="margin-top:10px;">
        <select id="acct-brand"></select>
        <input id="acct-no" placeholder="Nomor rekening / e-money" maxlength="40" style="margin-top:8px;">
        <input id="acct-holder" placeholder="Atas nama (opsional)" maxlength="40" style="margin-top:8px;">
        <div style="display:flex;gap:8px;margin-top:8px;">
          <button class="btn-primary btn-sm" id="save-account" style="width:auto;">Simpan</button>
          <button class="btn-ghost btn-sm" id="cancel-account" style="width:auto;">Batal</button>
        </div>
      </div>
    </div>
    <button class="btn-outline" id="logout-btn" style="width:100%;color:var(--red);border-color:var(--red);">Keluar</button>`;

  $("#back-btn").addEventListener("click", () => location.hash = "#/");

  // name
  $("#save-name").addEventListener("click", async () => {
    const name = $("#name-input").value.trim();
    if (!name) { toast("Isi nama dulu"); return; }
    try {
      await apiJson(`/api/identities/${me.id}/name`, "POST", { name });
      state.identity.name = name;
      lsSet(LS_KEYS.name, name);
      toast("Nama diupdate ✓");
    } catch (e) { toast(e.message); }
  });

  // recovery code
  const genCode = async () => {
    try {
      const r = await apiJson(`/api/identities/${me.id}/code/generate`, "POST", {});
      showGeneratedCode(r.code);
    } catch (e) { toast(e.message); }
  };
  const showGeneratedCode = (code) => {
    const box = $("#code-box");
    box.innerHTML = `
      <div class="code-display">${esc(code)}</div>
      <button class="btn-primary btn-sm" id="copy-code" style="width:100%;margin-top:8px;">📋 Salin Kode</button>
      <button class="btn-ghost btn-sm" id="regen-code" style="width:100%;">Bikin Kode Baru</button>
      <p class="muted" style="margin-top:6px;">Kode lama langsung mati kalau bikin yang baru. Simpan baik-baik!</p>`;
    $("#copy-code").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(code); toast("Kode disalin 📋"); }
      catch (e) { toast("Gagal salin, ketik manual aja"); }
    });
    $("#regen-code").addEventListener("click", () => {
      if (confirm("Kode lama langsung mati. Bikin kode baru?")) genCode();
    });
  };
  $("#gen-code").addEventListener("click", genCode);

  // payment accounts
  const loadAccounts = async () => {
    const box = $("#accounts-list");
    if (!box) return;
    try {
      const accts = await api(`/api/identities/${me.id}/accounts`);
      if (!accts.length) {
        box.innerHTML = `<div class="muted" style="text-align:center;padding:8px;">Belum ada metode bayar.</div>`;
        return;
      }
      box.innerHTML = accts.map(a => `
        <div class="account-row">
          ${brandChipHtml(a.brand)}
          <div style="flex:1;min-width:0;">
            <div style="font-weight:600;font-size:14px;">${esc(a.brand)}</div>
            <div class="muted">${esc(a.account_no)}${a.holder_name ? " · " + esc(a.holder_name) : ""}</div>
          </div>
          <button class="btn-sm" data-edit="${a.id}" style="background:var(--surface-2);flex-shrink:0;">✏️</button>
          <button class="btn-sm" data-del="${a.id}" style="background:var(--red-bg);color:var(--red);flex-shrink:0;">✕</button>
        </div>`).join("");
      $$("[data-edit]", box).forEach(b => b.addEventListener("click", () => {
        const acc = accts.find(x => x.id == b.dataset.edit);
        if (acc) openEditAccountSheet(acc, loadAccounts);
      }));
      $$("[data-del]", box).forEach(b => b.addEventListener("click", async () => {
        if (!confirm("Hapus metode bayar ini?")) return;
        try { await api("/api/accounts/" + b.dataset.del, { method: "DELETE" }); loadAccounts(); }
        catch (e) { toast(e.message); }
      }));
    } catch (e) {
      box.innerHTML = `<div class="muted" style="text-align:center;padding:8px;">${esc(e.message)}</div>`;
    }
  };
  loadAccounts();

  $("#add-account-btn").addEventListener("click", () => {
    const form = $("#account-form");
    form.classList.toggle("hidden");
    if (!form.classList.contains("hidden")) $("#acct-no").focus();
  });
  $("#cancel-account").addEventListener("click", () => $("#account-form").classList.add("hidden"));
  $("#acct-brand").innerHTML = BRANDS.map(b => `<option value="${b.c}">${b.c}</option>`).join("");
  $("#save-account").addEventListener("click", async () => {
    const brand = $("#acct-brand").value;
    const account_no = $("#acct-no").value.trim();
    const holder_name = $("#acct-holder").value.trim();
    if (!account_no) { toast("Isi nomornya dulu"); return; }
    try {
      await apiJson(`/api/identities/${me.id}/accounts`, "POST", { brand, account_no, holder_name });
      $("#account-form").classList.add("hidden");
      $("#acct-no").value = ""; $("#acct-holder").value = "";
      toast("Metode bayar ditambah ✓");
      loadAccounts();
    } catch (e) { toast(e.message); }
  });

  // paste-text account parser
  $("#paste-account-btn").addEventListener("click", () => openPasteAccountsSheet(me.id, loadAccounts));

  // logout
  $("#logout-btn").addEventListener("click", () => {
    if (confirm("Keluar dari akun ini? Nama & riwayat di device ini bakal dihapus.")) logout();
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
  const sheet = el(`
    <div class="sheet-overlay" id="paste-acct-sheet">
      <div class="sheet">
        <div class="sheet-handle"></div>
        <div class="sheet-title">Tempel teks metode bayar</div>
        <p class="muted" style="margin-bottom:10px;">Copy dari notes/m-banking, contoh:</p>
        <div class="card" style="background:var(--surface-2);border:none;margin-bottom:10px;padding:10px 12px;font-family:ui-monospace,monospace;font-size:12px;line-height:1.6;">
          BUDI SANTOSO<br>Bank BCA<br>1234567890<br>OVO<br>081234567890
        </div>
        <textarea id="paste-input" rows="6" placeholder="Tempel teks di sini..." style="width:100%;resize:vertical;margin-bottom:10px;"></textarea>
        <button class="btn-primary" id="parse-acct-btn" style="width:100%;">Parse</button>
        <div id="paste-result"></div>
        <button class="btn-outline" id="close-sheet" style="width:100%;margin-top:8px;">Tutup</button>
      </div>
    </div>`);
  document.body.appendChild(sheet);
  $("#close-sheet", sheet).addEventListener("click", () => sheet.remove());
  sheet.addEventListener("click", (e) => { if (e.target === sheet) sheet.remove(); });

  $("#parse-acct-btn", sheet).addEventListener("click", () => {
    const parsed = parseAccountsText($("#paste-input", sheet).value);
    renderParsedResult(sheet, parsed, identityId, onAdded);
  });
}

function renderParsedResult(sheet, parsed, identityId, onAdded) {
  const box = $("#paste-result", sheet);
  if (!parsed.length) {
    box.innerHTML = `<p class="muted" style="margin-top:10px;color:var(--red);">Gak nemu metode bayar. Cek formatnya: nama (opsional), nama bank, nomor.</p>`;
    return;
  }
  box.innerHTML = `
    <div class="card" style="background:var(--surface-2);border:none;margin-top:10px;">
      <div class="label-sm" style="margin-bottom:6px;">Ketemu ${parsed.length} metode</div>
      ${parsed.map((p, i) => `
        <div class="account-row">
          <span class="paste-chip-wrap" data-i="${i}">${brandChipHtml(p.brand)}</span>
          <div style="flex:1;min-width:0;">
            <select class="paste-brand-sel" data-i="${i}" style="width:100%;font-size:13px;font-weight:600;">
              ${BRANDS.map(b => `<option value="${b.c}" ${b.c === p.brand ? "selected" : ""}>${b.c}</option>`).join("")}
            </select>
            <div class="muted" style="font-size:12px;">${esc(p.account_no)}${p.holder_name ? " · " + esc(p.holder_name) : ""}</div>
          </div>
          <button class="btn-sm paste-rm" data-i="${i}" style="background:var(--red-bg);color:var(--red);flex-shrink:0;">✕</button>
        </div>`).join("")}
      <button class="btn-green btn-sm" id="save-parsed" style="width:100%;margin-top:8px;">Tambah Semua</button>
    </div>`;
  $$(".paste-brand-sel", box).forEach(sel => sel.addEventListener("change", () => {
    parsed[+sel.dataset.i].brand = sel.value;
    const chip = box.querySelector(`.paste-chip-wrap[data-i="${sel.dataset.i}"]`);
    if (chip) chip.innerHTML = brandChipHtml(sel.value);
  }));
  $$(".paste-rm", box).forEach(btn => btn.addEventListener("click", () => {
    const idx = +btn.dataset.i;
    parsed.splice(idx, 1);
    btn.closest(".card").remove();
    if (!parsed.length) box.innerHTML = `<p class="muted" style="margin-top:10px;">Semua dihapus. Tempel teks lain kalau mau.</p>`;
  }));
  $("#save-parsed", box).addEventListener("click", async () => {
    try {
      for (const p of parsed) {
        await apiJson(`/api/identities/${identityId}/accounts`, "POST", {
          brand: p.brand, account_no: p.account_no, holder_name: p.holder_name,
        });
      }
      sheet.remove();
      toast(`Ditambah ${parsed.length} metode ✓`);
      if (onAdded) onAdded();
    } catch (e) { toast(e.message); }
  });
}

// ---------- Edit payment account ----------
function openEditAccountSheet(acct, onDone) {
  const sheet = el(`
    <div class="sheet-overlay" id="edit-acct-sheet">
      <div class="sheet">
        <div class="sheet-handle"></div>
        <div class="sheet-title">Edit metode bayar</div>
        <select id="edit-acct-brand"></select>
        <input id="edit-acct-no" placeholder="Nomor rekening / e-money" maxlength="40" style="margin-top:8px;">
        <input id="edit-acct-holder" placeholder="Atas nama (opsional)" maxlength="40" style="margin-top:8px;">
        <p class="muted" style="font-size:12px;margin-top:6px;">Nama pemilik gak wajib — bisa dikosongin kalau emang gak ada / mau anonim.</p>
        <div style="display:flex;gap:8px;margin-top:10px;">
          <button class="btn-primary btn-sm" id="edit-save" style="flex:1;">Simpan</button>
          <button class="btn-outline btn-sm" id="edit-close" style="flex:1;">Batal</button>
        </div>
      </div>
    </div>`);
  document.body.appendChild(sheet);
  const brandSel = $("#edit-acct-brand", sheet);
  brandSel.innerHTML = BRANDS.map(b => `<option value="${b.c}" ${b.c === acct.brand ? "selected" : ""}>${b.c}</option>`).join("");
  $("#edit-acct-no", sheet).value = acct.account_no || "";
  $("#edit-acct-holder", sheet).value = acct.holder_name || "";
  $("#edit-close", sheet).addEventListener("click", () => sheet.remove());
  sheet.addEventListener("click", (e) => { if (e.target === sheet) sheet.remove(); });
  $("#edit-save", sheet).addEventListener("click", async () => {
    const brand = brandSel.value;
    const account_no = $("#edit-acct-no", sheet).value.trim();
    const holder = $("#edit-acct-holder", sheet).value.trim() || null;
    if (!account_no) { toast("Nomor rekening wajib diisi"); return; }
    try {
      await api(`/api/accounts/${acct.id}`, {
        method: "PUT",
        json: { brand, account_no, holder_name: holder },
      });
      sheet.remove();
      toast("Metode bayar diupdate ✓");
      if (onDone) onDone();
    } catch (e) { toast(e.message); }
  });
}

// ---------- Create bill ----------
function renderCreate(opts = {}) {
  const app = $("div#app");
  const errCard = opts.ocrError
    ? `<div class="card" style="border:1px solid var(--danger,#e05252);margin-bottom:12px;">
        <div style="font-weight:600;color:var(--danger,#e05252);">❌ Gagal baca struk</div>
        <p class="muted" style="margin:6px 0 10px;">${esc(opts.ocrError)}</p>
        <button class="btn-primary" id="ocr-retry" style="width:100%;margin-bottom:8px;">🔄 Coba Lagi</button>
        <button class="btn-outline" id="ocr-manual" style="width:100%;">✍️ Isi Manual Aja</button>
      </div>`
    : "";
  app.innerHTML = `
    <div class="topbar">
      <button class="btn-icon" id="back-btn">←</button>
      <div class="brand" style="font-size:16px;">Buat Bill</div>
      <div style="width:44px;"></div>
    </div>
    <div id="create-body">
      ${errCard}
      <div class="dropzone" id="dz">
        <div style="font-size:32px;margin-bottom:8px;">📷</div>
        <div style="font-weight:600;">Foto struknya</div>
        <div class="muted">Biar gak ribet ngetik manual</div>
      </div>
      <input type="file" id="file-input" accept="image/*" class="hidden">
      <button class="btn-outline" id="manual-btn" style="width:100%;margin-top:12px;">✍️ Bikin Manual (tanpa foto)</button>
    </div>`;
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
    // bottom sheet: [Ambil Foto] [Pilih dari Galeri]
    const sheet = el(`
      <div class="sheet-overlay" id="dz-sheet">
        <div class="sheet">
          <div class="sheet-handle"></div>
          <div class="sheet-title">Foto struk</div>
          <button class="btn-primary" id="dz-camera" style="width:100%;margin-bottom:8px;">📷 Ambil Foto</button>
          <button class="btn-outline" id="dz-gallery" style="width:100%;margin-bottom:8px;">🖼️ Pilih dari Galeri</button>
          <button class="btn-ghost" id="dz-cancel" style="width:100%;">Batal</button>
        </div>
      </div>`);
    document.body.appendChild(sheet);
    $("#dz-camera", sheet).addEventListener("click", () => { sheet.remove(); openPicker(true); });
    $("#dz-gallery", sheet).addEventListener("click", () => { sheet.remove(); openPicker(false); });
    $("#dz-cancel", sheet).addEventListener("click", () => sheet.remove());
    sheet.addEventListener("click", (e) => { if (e.target === sheet) sheet.remove(); });
  });
  fileInput.addEventListener("change", async () => {
    const f = fileInput.files[0];
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) { toast("Foto maksimal 5MB"); return; }
    await uploadAndOcr(f);
  });
  $("#manual-btn").addEventListener("click", () => {
    renderVerify({
      items: [], subtotal: 0, tax: 0, service: 0, total: 0,
      photo_path: null, merchant: "", date: "",
    }, true);
  });
  if (opts.ocrError) {
    $("#ocr-retry").addEventListener("click", () => {
      if (opts.ocrFile) uploadAndOcr(opts.ocrFile);
      else renderCreate();
    });
    $("#ocr-manual").addEventListener("click", () => {
      renderVerify({
        items: [], subtotal: 0, tax: 0, service: 0, total: 0,
        photo_path: null, merchant: "", date: "",
      }, true);
    });
  }
}

async function uploadAndOcr(file) {
  const body = $("#create-body");
  body.innerHTML = `<div class="card" style="text-align:center;padding:40px 16px;">
    <div class="spinner" style="width:32px;height:32px;border-width:3px;"></div>
    <p style="margin-top:16px;font-weight:600;">Membaca struk...</p>
    <p class="muted">Biasanya cuma butuh beberapa detik</p>
  </div>`;
  try {
    const fd = new FormData();
    fd.append("file", file);
    const result = await api("/api/ocr", { method: "POST", body: fd });
    renderVerify(result);
  } catch (e) {
    renderCreate({ ocrError: e.message, ocrFile: file });
  }
}

// ---------- Verify OCR result ----------
let verifyState = { items: [], subtotal: 0, tax: 0, service: 0, total: 0, photo_path: null, title: "", merchant: "", transacted_at: "", manual: false, paid_by_name: null, tax_included: false };

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
  };
  const app = $("div#app");
  app.innerHTML = `
    <div class="topbar">
      <button class="btn-icon" id="back-btn">←</button>
      <div class="brand" style="font-size:16px;">${manual ? "Bikin Manual" : "Periksa Hasil"}</div>
      <div style="width:44px;"></div>
    </div>
    ${verifyState.photo_path ? `
    <div class="card" style="padding:8px;">
      <img class="photo-preview" id="receipt-photo" src="/uploads/${esc(verifyState.photo_path.split("/").pop())}" alt="Struk asli" loading="lazy">
      <div class="muted" style="text-align:center;margin-top:4px;">Struk asli · ketuk buat perbesar</div>
    </div>` : ""}
    <div class="card" style="margin-bottom:12px;">
      <div class="label-sm">Judul bill</div>
      <input id="title-input" placeholder="Contoh: Makan Sushi" value="${esc(verifyState.title)}" maxlength="60" style="margin-top:4px;">
      ${!manual && verifyState.merchant ? `<div class="muted" style="font-size:13px;margin-top:4px;">Dibaca dari struk: ${esc(verifyState.merchant)}</div>` : ""}
      <div class="field-row" style="margin-top:10px;">
        <div style="flex:1;">
          <label>Tanggal transaksi</label>
          <input type="date" id="date-input" value="${esc(verifyState.transacted_at)}">
        </div>
      </div>
    </div>
    <div class="card" id="items-card">
      <div class="card-title">Item <span class="muted">(${manual ? "ketik item & harganya" : "cek ulang, edit kalau salah"})</span></div>
      <div id="items-list"></div>
      <button class="btn-outline btn-sm" id="add-item-btn" style="width:100%;margin-top:8px;">＋ Tambah item</button>
    </div>
    <div class="card">
      <div class="card-title">Total</div>
      <div class="field-row">
        <div><label>Subtotal</label><input type="text" inputmode="numeric" id="subtotal-input" value="${rupiahFmt(verifyState.subtotal)}"></div>
        <div><label>PPN</label><input type="text" inputmode="numeric" id="tax-input" value="${rupiahFmt(verifyState.tax)}"></div>
        <div><label>Service</label><input type="text" inputmode="numeric" id="service-input" value="${rupiahFmt(verifyState.service)}"></div>
      </div>
      <label class="toggle-row" style="display:flex;align-items:center;justify-content:space-between;gap:12px;cursor:pointer;margin-top:10px;">
        <span style="flex:1;">
          <span style="font-weight:600;">Harga item sudah termasuk pajak</span>
          <div class="muted" style="font-size:13px;">Kalau struk nulis "termasuk pajak", harga item udah kehitung pajaknya</div>
        </span>
        <input type="checkbox" id="tax-included-toggle" ${verifyState.tax_included ? "checked" : ""} style="width:20px;height:20px;accent-color:var(--accent);">
      </label>
      <div id="tax-included-badge" class="${verifyState.tax_included ? "" : "hidden"}" style="margin-top:8px;padding:8px 10px;background:rgba(46,204,113,.12);border-radius:8px;color:var(--green,#2ecc71);font-size:13px;">✓ Harga item sudah termasuk pajak — PPN & Service dikosongin, total ngikut item</div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;">
        <span class="label-sm">Total</span>
        <span class="money" style="font-size:22px;font-weight:800;" id="total-display">${fmt(verifyState.total)}</span>
      </div>
      <div id="sum-warn" class="error-text hidden" style="margin-top:6px;"></div>
    </div>
    <div class="card">
      <div class="card-title">Yang bayar</div>
      <label class="toggle-row" style="display:flex;align-items:center;justify-content:space-between;gap:12px;cursor:pointer;">
        <span style="flex:1;">
          <span style="font-weight:600;">Saya yang bayar</span>
          <div class="muted" style="font-size:13px;">Yang bayar dianggap sudah lunas otomatis</div>
        </span>
        <input type="checkbox" id="paid-by-me" ${verifyState.paid_by_name ? "" : "checked"} style="width:20px;height:20px;accent-color:var(--accent);">
      </label>
      <div id="paid-by-other" class="${verifyState.paid_by_name ? "" : "hidden"}" style="margin-top:10px;">
        <label>Nama yang bayar</label>
        <input id="paid-by-name-input" placeholder="Contoh: Amel" value="${esc(verifyState.paid_by_name || "")}" maxlength="30" autocomplete="off" style="margin-top:4px;">
        <div class="muted" style="font-size:13px;margin-top:4px;">Bisa diubah lagi nanti setelah orangnya join bill</div>
      </div>
    </div>
    <div style="height:12px;"></div>
    <div class="sticky-bar"><div class="sticky-inner">
      <button class="btn-primary" id="create-bill-btn">Bikin Bill & Bagikan</button>
    </div></div>`;

  $("#back-btn").addEventListener("click", () => renderCreate());
  const photo = $("#receipt-photo");
  if (photo) photo.addEventListener("click", () => photo.classList.toggle("expanded"));
  renderVerifyItems();
  bindVerifyInputs();

  $("#add-item-btn").addEventListener("click", () => {
    verifyState.items.push({ name: "", price: 0, discount: 0 });
    renderVerifyItems();
  });
  $("#title-input").addEventListener("input", (e) => verifyState.title = e.target.value);
  $("#date-input").addEventListener("input", (e) => verifyState.transacted_at = e.target.value);
  bindRupiahInput($("#subtotal-input"), () => { verifyState.subtotalTouched = true; updateVerifyTotal(); });
  bindRupiahInput($("#tax-input"), () => updateVerifyTotal());
  bindRupiahInput($("#service-input"), () => updateVerifyTotal());
  const paidByMe = $("#paid-by-me");
  if (paidByMe) {
    paidByMe.addEventListener("change", () => {
      $("#paid-by-other").classList.toggle("hidden", paidByMe.checked);
    });
  }
  const paidByNameInput = $("#paid-by-name-input");
  if (paidByNameInput) {
    paidByNameInput.addEventListener("input", (e) => verifyState.paid_by_name = e.target.value);
  }
  const taxIncToggle = $("#tax-included-toggle");
  if (taxIncToggle) {
    taxIncToggle.addEventListener("change", (e) => {
      verifyState.tax_included = e.target.checked;
      updateVerifyTotal();
    });
  }
  $("#create-bill-btn").addEventListener("click", createBillFinal);
}
function renderVerifyItems() {
  const list = $("div#items-list, #items-list");
  const elList = list && list.length ? list[0] : list;
  if (!elList) return;
  elList.innerHTML = verifyState.items.map((it, idx) => `
    <div class="item-row" style="border-bottom:1px solid var(--border);flex-wrap:wrap;">
      <div style="flex:2;min-width:140px;">
        <input data-role="name" data-idx="${idx}" value="${esc(it.name)}" placeholder="Nama item" style="padding:8px;">
      </div>
      <div style="flex:1;min-width:100px;">
        <input data-role="price" data-idx="${idx}" type="text" inputmode="numeric" value="${rupiahFmt(it.price)}" placeholder="0" style="padding:8px;">
      </div>
      <button data-role="del" data-idx="${idx}" class="btn-sm" style="background:var(--red-bg);color:var(--red);flex-shrink:0;">✕</button>
      <div style="flex-basis:100%;padding:6px 0 0;display:flex;align-items:center;gap:8px;">
        <span class="label-sm" style="flex-shrink:0;">Diskon:</span>
        <input data-role="discount" data-idx="${idx}" type="text" inputmode="numeric" value="${rupiahFmt(it.discount)}" placeholder="0" style="padding:6px;max-width:110px;text-align:right;">
        ${it.discount > 0 ? `<span class="disc-bayar" style="color:var(--green,#2ecc71);font-weight:700;font-size:13px;">→ bayar ${rupiahFmt(Math.max(0, it.price - it.discount))}</span>` : ""}
      </div>
      <div style="flex-basis:100%;padding:2px 0 8px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
          <span class="label-sm" style="flex-shrink:0;">Cara bagi:</span>
          <button class="btn-sm item-mode-btn ${it.mode !== "slot" ? "chip-active" : ""}" data-idx="${idx}" data-mode="free" style="background:${it.mode !== "slot" ? "var(--surface-2)" : "var(--bg)"};border:1px solid var(--border);">Bebas</button>
          <button class="btn-sm item-mode-btn ${it.mode === "slot" ? "chip-active" : ""}" data-idx="${idx}" data-mode="slot" style="background:${it.mode === "slot" ? "var(--surface-2)" : "var(--bg)"};border:1px solid var(--border);">Slot</button>
          ${it.mode === "slot" ? `
          <div style="display:flex;align-items:center;gap:6px;margin-left:auto;">
            <span class="muted" style="font-size:12px;">bagi</span>
            <button class="btn-sm slot-dec" data-idx="${idx}" style="border:1px solid var(--border);">−</button>
            <span class="slot-count" style="font-weight:700;min-width:18px;text-align:center;">${it.slot_count || 2}</span>
            <button class="btn-sm slot-inc" data-idx="${idx}" style="border:1px solid var(--border);">＋</button>
            <span class="muted" style="font-size:12px;">orang</span>
          </div>` : ""}
        </div>
        <div class="muted" style="font-size:12px;line-height:1.45;">
          ${it.mode === "slot"
            ? `Dibagi ${it.slot_count || 2} bagian tetap${it.price > 0 ? ` · ${rupiahFmt(Math.floor(it.price / (it.slot_count || 2)))}/bagian` : ""}. Tiap orang bisa ambil 1+ bagian, yang kosong keliatan.`
            : `Pilih bebas: centang item yang lu makan — bisa ambil 1 porsi atau lebih. Harga dibagi sesuai porsi yang keambil.`}
        </div>
      </div>
    </div>`).join("");
  $$("[data-role=name]", elList).forEach(inp => inp.addEventListener("input", (e) => {
    verifyState.items[+e.target.dataset.idx].name = e.target.value;
  }));
  $$("[data-role=price]", elList).forEach(inp => bindRupiahInput(inp, (v) => {
    verifyState.items[+inp.dataset.idx].price = v;
    updateVerifyTotal();
  }));
  $$("[data-role=discount]", elList).forEach(inp => bindRupiahInput(inp, (v) => {
    const it = verifyState.items[+inp.dataset.idx];
    it.discount = v;
    const row = inp.closest(".item-row");
    let bayar = row ? row.querySelector(".disc-bayar") : null;
    const eff = Math.max(0, (it.price || 0) - v);
    if (v > 0) {
      if (!bayar && row) {
        bayar = document.createElement("span");
        bayar.className = "disc-bayar";
        bayar.style.cssText = "color:var(--green,#2ecc71);font-weight:700;font-size:13px;";
        inp.parentElement.appendChild(bayar);
      }
      if (bayar) bayar.textContent = `→ bayar ${rupiahFmt(eff)}`;
    } else if (bayar) bayar.remove();
    updateVerifyTotal();
  }));
  $$("[data-role=del]", elList).forEach(btn => btn.addEventListener("click", (e) => {
    verifyState.items.splice(+e.target.dataset.idx, 1);
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
  // manual mode: subtotal auto-follows items unless user typed their own value
  let subtotal = rupiahParse($("#subtotal-input").value);
  if (verifyState.manual && !verifyState.subtotalTouched) {
    subtotal = sumItems;
    const si = $("#subtotal-input");
    if (si) si.value = rupiahFmt(subtotal);
  }
  let tax = rupiahParse($("#tax-input").value);
  let service = rupiahParse($("#service-input").value);
  if (verifyState.tax_included) {
    // prices include tax -> subtotal = items, PPN/Service forced empty
    subtotal = sumItems;
    const si = $("#subtotal-input"); if (si) si.value = rupiahFmt(subtotal);
    const ti = $("#tax-input"); if (ti) ti.value = "";
    const svi = $("#service-input"); if (svi) svi.value = "";
    tax = 0; service = 0;
  }
  const total = subtotal + tax + service;
  verifyState.subtotal = subtotal; verifyState.tax = tax; verifyState.service = service;
  const td = $("#total-display");
  if (td) td.textContent = fmt(total);
  const badge = $("#tax-included-badge");
  if (badge) badge.classList.toggle("hidden", !verifyState.tax_included);
  const warn = $("#sum-warn");
  if (warn) {
    if (sumItems !== subtotal) {
      warn.classList.remove("hidden");
      if (verifyState.tax_included) {
        warn.textContent = `Total item (${fmt(sumItems)}) beda dari Subtotal (${fmt(subtotal)}). Total item ini yang dipakai — cek harga & diskon tiap item.`;
      } else if (sumItems === rupiahParse($("#total-display").textContent.replace(/\D/g, ""))) {
        warn.textContent = `Harga item (${fmt(sumItems)}) kayaknya udah TERMASUK pajak, tapi lu isi Subtotal ${fmt(subtotal)} + PPN. Aktifin toggle "Harga item sudah termasuk pajak" biar gak dobel.`;
      } else {
        warn.textContent = `Total item (${fmt(sumItems)}) beda dari subtotal (${fmt(subtotal)}). Cek kolom Diskon tiap item.`;
      }
    } else warn.classList.add("hidden");
  }
}

function bindVerifyInputs() { updateVerifyTotal(); }

async function createBillFinal() {
  const btn = $("#create-bill-btn");
  btn.disabled = true;
  btn.textContent = "Membuat...";
  const items = verifyState.items.filter(i => i.name && i.price > 0);
  if (!items.length) { toast("Minimal 1 item"); btn.disabled = false; btn.textContent = "Bikin Bill & Bagikan"; return; }
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
        price: i.price,
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
    btn.disabled = false;
    btn.textContent = "Bikin Bill & Bagikan";
  }
}

// ---------- rupiah input helpers ----------
function rupiahDigits(v) { return String(v == null ? "" : v).replace(/\D/g, "").replace(/^0+(?=\d)/, ""); }
function rupiahFmt(v) { const d = rupiahDigits(v); return d ? d.replace(/\B(?=(\d{3})+(?!\d))/g, ".") : ""; }
function rupiahParse(s) { return parseInt(rupiahDigits(s) || "0", 10); }
function bindRupiahInput(input, onChange) {
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

// ---------- helpers ----------
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c])); }
function shortDate(iso) {
  try {
    const d = new Date(iso.replace(" ", "T") + "Z");
    return d.toLocaleDateString("id-ID", { day: "numeric", month: "short" });
  } catch (e) { return iso; }
}
