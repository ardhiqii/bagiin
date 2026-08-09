/* Bagiin frontend - bill view (guest picker + creator summary) */
console.log("BAGIIN_BILLVIEW_V4_LOADED");

// normalized name compare: "Amel" == "amel" == " AMEL "
const normName = (s) => String(s || "").trim().toLowerCase();

// ---------- Bill view ----------
async function loadBillView(billId) {
  const app = $("#app");
  state.currentBillId = billId;
  app.innerHTML = `<div class="card" style="text-align:center;padding:40px;"><div class="spinner"></div><p style="margin-top:12px;" class="muted">Memuat bill...</p></div>`;
  try {
    const data = await api("/api/bills/" + billId);
    state.bill = data;
    // who am I?
    if (!state.identity) {
      renderGuestNamePrompt(billId, data);
      return;
    }
    const me = state.identity;
    const myPeople = data.people.filter(p => p.identity_id === me.id);
    if (data.bill.creator_identity_id === me.id) {
      renderCreatorView(data);
    } else {
      renderGuestView(data, me);
    }
  } catch (e) {
    app.innerHTML = `<div class="card" style="text-align:center;padding:40px;">
      <div style="font-size:36px;margin-bottom:12px;">😕</div>
      <p style="font-weight:600;">Bill gak ketemu</p>
      <p class="muted" style="margin:8px 0 20px;">${esc(e.message)}</p>
      <button class="btn-primary" onclick="location.hash='#/'">Ke Beranda</button>
    </div>`;
  }
}

function renderGuestNamePrompt(billId, data) {
  const app = $("#app");
  const saved = lsGet(LS_KEYS.name, "");
  app.innerHTML = `
    <div style="min-height:70dvh;display:flex;flex-direction:column;justify-content:center;max-width:400px;margin:0 auto;">
      <div class="card" style="margin-bottom:16px;">
        <div class="label-sm">Bill</div>
        <div style="font-size:22px;font-weight:800;margin-top:4px;">${esc(data.bill.title)}</div>
        <div class="money" style="font-size:28px;font-weight:800;margin-top:8px;">${fmt(data.bill.total_idr)}</div>
        <div class="muted">dibuat oleh ${esc(data.creator_name)}</div>
      </div>
      <div class="field">
        <label>Kamu siapa?</label>
        <input id="guest-name" placeholder="Nama kamu" value="${saved}" maxlength="30" autocomplete="off">
      </div>
      <button class="btn-primary" id="guest-go">Lanjut, milih item</button>
    </div>`;
  const input = $("#guest-name");
  input.focus();
  const go = async () => {
    const name = input.value.trim();
    if (!name) { toast("Isi nama dulu"); return; }
    try {
      await ensureIdentity(name);
      const fresh = await apiJson("/api/bills/" + billId + "/join", "POST", {});
      renderGuestView(fresh, state.identity);
    } catch (e) { toast(e.message); }
  };
  $("#guest-go").addEventListener("click", go);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
}

// ---------- Guest view: pick items ----------
function renderGuestView(data, me) {
  const app = $("#app");
  state.bill = data;
  const myPeople = data.people.filter(p => p.identity_id === me.id);
  const myPaid = myPeople.length ? myPeople[0].paid === "paid" : false;

  // build selected set from data (my existing selections)
  const selected = new Set();
  data.items.forEach(it => {
    if (data.sel_by_item[it.id] && data.sel_by_item[it.id].length) {
      // check if me among selectors - need identity names; approximate via people matching
    }
  });
  // simpler: fetch my selections from selections list - we store only in sel_by_item with names
  // backend returns sel_by_item item_id -> [identity_name]. We match by name.
  Object.entries(data.sel_by_item || {}).forEach(([itemId, names]) => {
    if (names.some(n => normName(n) === normName(me.name))) selected.add(parseInt(itemId, 10));
  });
  state.selected = selected;

  const totalMine = computeMyTotal(data, selected, me.id);
  const myItemCount = selected.size;

  app.innerHTML = `
    <div class="topbar">
      <button class="btn-icon" id="back-btn">←</button>
      <div class="brand" style="font-size:16px;">${esc(data.bill.title)}</div>
      <div style="width:44px;"></div>
    </div>
    <div class="card" style="margin-bottom:12px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;">
        <div>
          <div class="label-sm">Total bill</div>
          <div class="money hero-total">${fmt(data.bill.total_idr)}</div>
        </div>
        <span class="chip ${data.bill.status === "closed" ? "chip-grey" : "chip-green"}">${data.bill.status === "closed" ? "Selesai" : "Aktif"}</span>
      </div>
      ${data.bill.merchant ? `<p class="muted" style="margin-top:6px;">${esc(data.bill.merchant)}</p>` : ""}
      ${data.bill.transacted_at ? `<p class="muted" style="font-size:13px;">${esc(shortDate(data.bill.transacted_at))}</p>` : ""}
      <p class="muted" style="margin-top:6px;">dibuat oleh ${esc(data.creator_name)}</p>
    </div>
    <button class="btn-outline" id="pay-methods-btn" style="width:100%;margin-bottom:12px;">💳 Metode bayar ${esc(data.creator_name)}</button>
    ${data.bill.status === "closed" ? `<div class="warn-box">Bill ini sudah ditutup. Pembagian sudah final.</div>` : ""}
    <div class="card">
      <div class="card-title">Centang yang kamu tanggung</div>
      <div id="pick-items">${data.items.map(it => itemRowHtml(it, data, selected, me.name)).join("")}</div>
    </div>
    ${data.bill.status === "open" ? `
    <div class="sticky-bar"><div class="sticky-inner" style="flex-direction:column;align-items:stretch;gap:10px;">
      <div class="sticky-total" style="display:flex;justify-content:space-between;align-items:center;flex:none;">
        <div class="label">Total kamu</div>
        <div class="money" id="my-total">${fmt(totalMine)}</div>
      </div>
      <button class="${myPaid ? "btn-green" : "btn-primary"}" id="pay-btn" style="width:100%;flex-shrink:0;">${myPaid ? "✓ Sudah bayar" : "Udah bayar"}</button>
    </div></div>` : ""}`;

  $("#back-btn").addEventListener("click", () => location.hash = "#/");
  $("#pay-methods-btn").addEventListener("click", () => openAccountsSheet(data));
  bindItemRows(data, me);
  $("#pay-btn").addEventListener("click", () => {
    const freshTotal = computeMyTotal(data, state.selected, me.id);
    openPaySheet(data, me, freshTotal, myPaid);
  });
}

function itemRowHtml(it, data, selected, myName) {
  const isSel = selected.has(it.id);
  const selectors = (data.sel_by_item[it.id] || []);
  const mine = selectors.some(n => normName(n) === normName(myName));
  let shareText;
  if (selectors.length === 0) shareText = "belum dipilih";
  else if (selectors.length === 1) shareText = mine ? "kamu" : selectors[0];
  else if (mine && selectors.length > 1) shareText = `dishare ${selectors.length} orang (termasuk kamu): ${selectors.map(esc).join(", ")}`;
  else shareText = `dishare ${selectors.length} orang: ${selectors.map(esc).join(", ")}`;
  return `
    <div class="item-row ${isSel ? "selected" : ""}" data-item="${it.id}">
      <div class="item-check">${isSel ? "✓" : ""}</div>
      <div class="item-info">
        <div class="item-name">${esc(it.name)}</div>
        <div class="item-share">${shareText}</div>
      </div>
      <div class="money item-price">${fmt(it.price_idr)}</div>
    </div>`;
}

function bindItemRows(data, me) {
  $$("#pick-items .item-row").forEach(row => {
    row.addEventListener("click", () => {
      const id = parseInt(row.dataset.item, 10);
      if (state.bill.status === "closed") { toast("Bill sudah ditutup"); return; }
      buzz(10);
      if (state.selected.has(id)) state.selected.delete(id);
      else state.selected.add(id);
      updateGuestSelection(data, me);
    });
  });
}

let selectionSaveChain = Promise.resolve();

async function updateGuestSelection(data, me) {
  // optimistic UI
  const totalMine = computeMyTotal(data, state.selected, me.id);
  const mt = $("#my-total");
  if (mt) mt.textContent = fmt(totalMine);
  $$("#pick-items .item-row").forEach(row => {
    const id = parseInt(row.dataset.item, 10);
    const sel = state.selected.has(id);
    row.classList.toggle("selected", sel);
    const check = $(".item-check", row);
    if (check) check.textContent = sel ? "✓" : "";
    // optimistic share label (server will confirm on next full load)
    const share = $(".item-share", row);
    if (share) {
      const others = (data.sel_by_item[id] || []).filter(n => normName(n) !== normName(me.name)).length;
      share.textContent = sel
        ? (others > 0 ? `dishare ${others + 1} orang (termasuk kamu)` : "kamu")
        : (others > 0 ? data.sel_by_item[id].join(", ") : "belum dipilih");
    }
  });
  // persist — serialize saves so rapid taps can't reorder POSTs (last tap wins)
  const ids = Array.from(state.selected);
  selectionSaveChain = selectionSaveChain
    .then(() => apiJson(`/api/bills/${data.bill.id}/selections`, "POST", { item_ids: ids }))
    .catch(e => toast(e.message));
  await selectionSaveChain;
}

function computeMyTotal(data, selected, myIdentityId) {
  // Mirror backend calc: item price split among selectors, tax proportional to
  // the TOTAL SELECTED subtotal (not the whole bill), remainder rounds away.
  let sub = 0;
  let totalSel = 0;
  const myName = state.identity ? state.identity.name : "";
  data.items.forEach(it => {
    if (!selected.has(it.id)) return;
    const existing = (data.sel_by_item[it.id] || []);
    // selectors count: existing selectors that aren't me, +1 if I just selected
    let count = existing.filter(n => normName(n) !== normName(myName)).length;
    if (selected.has(it.id)) count += 1;
    if (count <= 0) return;
    sub += Math.round(it.price_idr / count);
    totalSel += it.price_idr;
  });
  // tax proportional
  const taxService = (data.bill.tax_idr || 0) + (data.bill.service_idr || 0);
  let tax = 0;
  if (totalSel > 0) tax = Math.round(sub * taxService / totalSel);
  return sub + tax;
}

// ---------- Pay sheet ----------
function openPaySheet(data, me, totalMine, alreadyPaid) {
  const myItems = data.items.filter(it => state.selected.has(it.id));
  const sheet = el(`
    <div class="sheet-overlay" id="pay-sheet">
      <div class="sheet">
        <div class="sheet-handle"></div>
        <div class="sheet-title">Konfirmasi & bayar</div>
        ${myItems.length ? `
        <div class="card" style="background:var(--surface-2);border:none;margin-bottom:12px;">
          <div class="label-sm" style="margin-bottom:8px;">Item kamu (${myItems.length})</div>
          ${myItems.map(it => {
            const n = (data.sel_by_item[it.id] || []).length;
            return `<div style="display:flex;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);font-size:14px;">
              <div style="flex:1;min-width:0;">${esc(it.name)}${n > 1 ? ` <span class="muted">· dibagi ${n}</span>` : ""}</div>
              <div class="money">${fmt(it.price_idr)}</div>
            </div>`;
          }).join("")}
        </div>` : ""}
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
          <span class="label">Total kamu</span>
          <span class="money" style="font-size:32px;font-weight:800;">${fmt(totalMine)}</span>
        </div>
        <div class="card" style="background:var(--surface-2);border:none;margin-bottom:16px;">
          <div class="label-sm" style="margin-bottom:8px;">Kirim ke (pembuat bill)</div>
          <div style="font-size:15px;font-weight:600;">${esc(data.creator_name)}</div>
          ${(data.creator_accounts || []).length ? `<div style="margin-top:8px;">${data.creator_accounts.map(a => `
            <div class="account-row">
              ${brandChipHtml(a.brand)}
              <div style="flex:1;min-width:0;">
                <div style="font-weight:600;font-size:13px;">${esc(a.brand)}</div>
                <div class="muted" style="font-size:12px;">${esc(a.account_no)}${a.holder_name ? " · " + esc(a.holder_name) : ""}</div>
              </div>
              <button class="btn-sm copy-acct" data-no="${esc(a.account_no)}" style="flex-shrink:0;">📋</button>
            </div>`).join("")}</div>`
            : `<div class="muted" style="margin-top:4px;">Minta nomor rekening/e-money ke ${esc(data.creator_name)} ya</div>`}
        </div>
        <button class="${alreadyPaid ? "btn-green" : "btn-primary"}" id="confirm-pay">
          ${alreadyPaid ? "✓ Sudah bayar" : "Tandai sudah bayar"}
        </button>
        <button class="btn-outline" id="close-sheet" style="width:100%;margin-top:8px;">Batal</button>
      </div>
    </div>`);
  document.body.appendChild(sheet);
  $$(".copy-acct", sheet).forEach(b => b.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(b.dataset.no); toast("Nomor disalin 📋"); }
    catch (e) { toast("Gagal salin"); }
  }));
  $("#close-sheet", sheet).addEventListener("click", () => sheet.remove());
  sheet.addEventListener("click", (e) => { if (e.target === sheet) sheet.remove(); });
  $("#confirm-pay", sheet).addEventListener("click", async () => {
    try {
      await api(`/api/bills/${data.bill.id}/payments/${me.id}/paid`, { method: "POST" });
      buzz(20);
      sheet.remove();
      toast("Udah dicatat! 🎉");
      loadBillView(data.bill.id);
    } catch (e) { toast(e.message); }
  });
}

// ---------- Accounts sheet (standalone payment methods) ----------
function openAccountsSheet(data) {
  const sheet = el(`
    <div class="sheet-overlay" id="accounts-sheet">
      <div class="sheet">
        <div class="sheet-handle"></div>
        <div class="sheet-title">Metode bayar ${esc(data.creator_name)}</div>
        <div class="muted" style="margin-bottom:12px;">Bayar langsung ke ${esc(data.creator_name)} lewat:</div>
        ${(data.creator_accounts || []).length ? `<div>${data.creator_accounts.map(a => `
          <div class="account-row">
            ${brandChipHtml(a.brand)}
            <div style="flex:1;min-width:0;">
              <div style="font-weight:600;font-size:14px;">${esc(a.brand)}</div>
              <div class="muted" style="font-size:13px;">${esc(a.account_no)}${a.holder_name ? " · " + esc(a.holder_name) : ""}</div>
            </div>
            <button class="btn-sm copy-acct" data-no="${esc(a.account_no)}" style="flex-shrink:0;">📋 Salin</button>
          </div>`).join("")}</div>`
          : `<div class="card" style="background:var(--surface-2);border:none;"><div class="muted">${esc(data.creator_name)} belum nambah metode bayar. Minta nomor rekening/e-money-nya langsung ya.</div></div>`}
        <button class="btn-outline" id="close-sheet" style="width:100%;margin-top:16px;">Tutup</button>
      </div>
    </div>`);
  document.body.appendChild(sheet);
  $$(".copy-acct", sheet).forEach(b => b.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(b.dataset.no); toast("Nomor disalin 📋"); }
    catch (e) { toast("Gagal salin"); }
  }));
  $("#close-sheet", sheet).addEventListener("click", () => sheet.remove());
  sheet.addEventListener("click", (e) => { if (e.target === sheet) sheet.remove(); });
}

// ---------- Creator view: summary ----------
function renderCreatorView(data) {
  const app = $("#app");
  const me = state.identity;
  const totalPaid = data.people.filter(p => p.paid === "paid").reduce((s, p) => s + p.total_idr, 0);
  const totalUnpaid = data.people.filter(p => p.paid !== "paid").reduce((s, p) => s + p.total_idr, 0);
  const hasAssignments = data.people.some(p => p.total_idr > 0);
  const notJoined = data.bill.participant_count && data.people.length < data.bill.participant_count;
  const notPicked = data.people.filter(p => !p.subtotal_idr && p.identity_id !== me.id);

  app.innerHTML = `
    <div class="topbar">
      <button class="btn-icon" id="back-btn">←</button>
      <div class="brand" style="font-size:16px;">${esc(data.bill.title)}</div>
      <button class="btn-icon" id="share-btn" title="Bagikan">🔗</button>
    </div>
    <div class="card" style="margin-bottom:12px;">
      <div class="label-sm">Total bill</div>
      <div class="money hero-total">${fmt(data.bill.total_idr)}</div>
      ${data.bill.merchant ? `<div class="muted" style="font-size:13px;margin-top:4px;">${esc(data.bill.merchant)}</div>` : ""}
      ${data.bill.transacted_at ? `<div class="muted" style="font-size:13px;">${esc(shortDate(data.bill.transacted_at))}</div>` : ""}
      <div style="display:flex;gap:16px;margin-top:12px;">
        <div><span class="chip chip-green">✓ ${fmt(totalPaid)} dibayar</span></div>
        <div>${!hasAssignments
          ? `<span class="chip chip-grey">Belum ada yang milih</span>`
          : (totalUnpaid > 0
            ? `<span class="chip chip-red">${fmt(totalUnpaid)} belum</span>`
            : `<span class="chip chip-green">semua lunas</span>`)}</div>
      </div>
    </div>
    ${data.warnings.length ? `<div class="warn-box"><strong>Perhatian:</strong><ul>${data.warnings.map(w => `<li>${esc(w)}</li>`).join("")}</ul></div>` : ""}
    ${notJoined ? `<div class="warn-box"><strong>Belum join:</strong> baru ${data.people.length} dari ${data.bill.participant_count} orang. Share link-nya ya 🔗</div>` : ""}
    ${notPicked.length ? `<div class="warn-box"><strong>Belum pilih item:</strong><ul>${notPicked.map(m => `<li>${esc(m.name)}</li>`).join("")}</ul></div>` : ""}
    <div class="card">
      <div class="card-title">Pembagian</div>
      <div id="people-list">
        ${data.people.map(p => `
          <div class="person-row">
            <div class="avatar">${esc(initials(p.name))}</div>
            <div class="person-info">
              <div class="person-name">${esc(p.name)}${p.identity_id === me.id ? ' <span class="muted">(kamu)</span>' : ""}</div>
              <div class="person-sub">${p.subtotal_idr ? fmt(p.subtotal_idr) + " + pajak " + fmt(p.tax_idr) : "belum pilih item"}</div>
            </div>
            <div style="text-align:right;">
              <div class="money person-total">${fmt(p.total_idr)}</div>
              <span class="chip ${p.paid === "paid" ? "chip-green" : "chip-red"}">${p.paid === "paid" ? "✓ bayar" : "belum"}</span>
              ${data.bill.status === "open" && p.identity_id !== me.id ? `<button class="btn-sm remove-person" data-id="${esc(p.identity_id)}" data-name="${esc(p.name)}" style="background:var(--red-bg);color:var(--red);margin-top:6px;display:block;margin-left:auto;">✕</button>` : ""}
            </div>
          </div>`).join("")}
      </div>
    </div>
    <div class="card">
      <div class="card-title">Item & siapa yang pilih</div>
      ${data.bill.status === "open" ? `<div style="display:flex;gap:8px;margin-bottom:8px;">
        <button class="btn-outline btn-sm" id="pick-mine-btn" style="flex:1;">🖐️ Pilih item kamu</button>
        <button class="btn-outline btn-sm" id="edit-bill-btn" style="flex:1;">✏️ Edit</button>
      </div>` : ""}
      ${data.items.map(it => `
        <div class="item-row" style="border-bottom:1px solid var(--border);">
          <div class="item-info">
            <div class="item-name">${esc(it.name)}</div>
            <div class="item-share">${(data.sel_by_item[it.id] || []).length ? data.sel_by_item[it.id].map(esc).join(", ") : "belum dipilih"}</div>
          </div>
          <div class="money item-price">${fmt(it.price_idr)}</div>
        </div>`).join("")}
    </div>
    ${data.bill.status === "open" ? `
    <div class="sticky-bar"><div class="sticky-inner">
      <button class="btn-primary" id="close-bill-btn" style="flex:1;">Tutup Bill</button>
    </div></div>` : `<div class="card" style="text-align:center;background:var(--surface-2);border:none;"><span class="chip chip-grey">Bill selesai</span></div>`}`;

  $("#back-btn").addEventListener("click", () => location.hash = "#/");
  $("#share-btn").addEventListener("click", () => shareBill(data.bill.id, data.bill.title));
  const pickBtn = $("#pick-mine-btn");
  if (pickBtn) pickBtn.addEventListener("click", () => renderCreatorPick(data));
  const editBtn = $("#edit-bill-btn");
  if (editBtn) editBtn.addEventListener("click", () => renderEditBill(data));
  const closeBtn = $("#close-bill-btn");
  if (closeBtn) closeBtn.addEventListener("click", () => openCloseConfirm(data));
  $$(".remove-person").forEach(b => b.addEventListener("click", () =>
    openRemovePersonConfirm(data, b.dataset.id, b.dataset.name)));
}

// ---------- Remove person confirm ----------
function openRemovePersonConfirm(data, identityId, name) {
  const sheet = el(`
    <div class="sheet-overlay" id="remove-person-sheet">
      <div class="sheet">
        <div class="sheet-handle"></div>
        <div class="sheet-title">Hapus ${esc(name)}?</div>
        <p class="muted" style="margin-bottom:16px;">Item yang dia pilih, status bayar, dan catatannya di bill ini ikut kehapus. Cocok buat yang salah join atau dobel.</p>
        <button class="btn-primary" id="confirm-remove" style="width:100%;background:var(--red);border-color:var(--red);">Hapus</button>
        <button class="btn-outline" id="cancel-remove" style="width:100%;margin-top:8px;">Batal</button>
      </div>
    </div>`);
  document.body.appendChild(sheet);
  $("#cancel-remove", sheet).addEventListener("click", () => sheet.remove());
  sheet.addEventListener("click", (e) => { if (e.target === sheet) sheet.remove(); });
  $("#confirm-remove", sheet).addEventListener("click", async () => {
    try {
      const fresh = await apiJson(`/api/bills/${data.bill.id}/people/${identityId}`, "DELETE", {});
      sheet.remove();
      toast(`${name} dihapus dari bill 🗑️`);
      loadBillView(data.bill.id);
    } catch (e) { toast(e.message); }
  });
}

// ---------- Creator pick mode: pick your own items ----------
function renderCreatorPick(data) {
  const app = $("#app");
  const me = state.identity;
  state.bill = data;
  // build selected set for creator (match by name like guest view)
  const selected = new Set();
  Object.entries(data.sel_by_item || {}).forEach(([itemId, names]) => {
    if (names.some(n => normName(n) === normName(me.name))) selected.add(parseInt(itemId, 10));
  });
  state.selected = selected;
  const totalMine = computeMyTotal(data, selected, me.id);

  app.innerHTML = `
    <div class="topbar">
      <button class="btn-icon" id="back-btn">←</button>
      <div class="brand" style="font-size:16px;">${esc(data.bill.title)}</div>
      <div style="width:44px;"></div>
    </div>
    <div class="card" style="margin-bottom:12px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;">
        <div>
          <div class="label-sm">Total bill</div>
          <div class="money hero-total">${fmt(data.bill.total_idr)}</div>
        </div>
        <span class="chip chip-green">kamu pembuat</span>
      </div>
      ${data.bill.merchant ? `<p class="muted" style="margin-top:6px;">${esc(data.bill.merchant)}</p>` : ""}
      <p class="muted" style="margin-top:6px;">Ketuk item yang kamu tanggung. Yang gak dicentang siapa-siapa masuk ke kamu pas bill ditutup.</p>
    </div>
    <div class="card">
      <div class="card-title">Centang yang kamu tanggung</div>
      <div id="pick-items">${data.items.map(it => itemRowHtml(it, data, selected, me.name)).join("")}</div>
    </div>
    <div class="sticky-bar"><div class="sticky-inner" style="flex-direction:column;align-items:stretch;gap:10px;">
      <div class="sticky-total" style="display:flex;justify-content:space-between;align-items:center;flex:none;">
        <div class="label">Total kamu</div>
        <div class="money" id="my-total">${fmt(totalMine)}</div>
      </div>
      <button class="btn-primary" id="done-btn" style="width:100%;flex-shrink:0;">Selesai</button>
    </div></div>`;

  $("#back-btn").addEventListener("click", () => loadBillView(data.bill.id));
  bindItemRows(data, me);
  $("#done-btn").addEventListener("click", () => loadBillView(data.bill.id));
}

// ---------- Creator edit bill ----------
let editState = { items: [], subtotal: 0, tax: 0, service: 0, total: 0, title: "", transacted_at: "", participant_count: null, merchant: "" };

function renderEditBill(data) {
  const app = $("#app");
  editState = {
    items: data.items.map(it => ({ id: it.id, name: it.name, price: it.price_idr })),
    subtotal: data.bill.subtotal_idr || 0,
    tax: data.bill.tax_idr || 0,
    service: data.bill.service_idr || 0,
    total: data.bill.total_idr || 0,
    title: data.bill.title || "",
    merchant: data.bill.merchant || "",
    transacted_at: data.bill.transacted_at || "",
    participant_count: data.bill.participant_count ?? ((data.participants || []).length || null),
  };
  app.innerHTML = `
    <div class="topbar">
      <button class="btn-icon" id="back-btn">←</button>
      <div class="brand" style="font-size:16px;">Edit Bill</div>
      <div style="width:44px;"></div>
    </div>
    <div class="card" style="margin-bottom:12px;">
      <div class="label-sm">Judul bill</div>
      <input id="title-input" value="${esc(editState.title)}" maxlength="60" style="margin-top:4px;">
      ${editState.merchant ? `<div class="muted" style="font-size:13px;margin-top:4px;">${esc(editState.merchant)}</div>` : ""}
      <div class="field-row" style="margin-top:10px;">
        <div style="flex:1;">
          <label>Tanggal transaksi</label>
          <input type="date" id="date-input" value="${esc(editState.transacted_at)}">
        </div>
      </div>
    </div>
    <div class="card" id="items-card">
      <div class="card-title">Item <span class="muted">(edit kalau salah)</span></div>
      <div id="items-list"></div>
      <button class="btn-outline btn-sm" id="add-item-btn" style="width:100%;margin-top:8px;">＋ Tambah item</button>
    </div>
    <div class="card">
      <div class="card-title">Total</div>
      <div class="field-row">
        <div><label>Subtotal</label><input type="text" inputmode="numeric" id="subtotal-input" value="${rupiahFmt(editState.subtotal)}"></div>
        <div><label>PPN</label><input type="text" inputmode="numeric" id="tax-input" value="${rupiahFmt(editState.tax)}"></div>
        <div><label>Service</label><input type="text" inputmode="numeric" id="service-input" value="${rupiahFmt(editState.service)}"></div>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;">
        <span class="label-sm">Total</span>
        <span class="money" style="font-size:22px;font-weight:800;" id="total-display">${fmt(editState.total)}</span>
      </div>
      <div id="sum-warn" class="error-text hidden" style="margin-top:6px;"></div>
    </div>
    <div class="card">
      <div class="card-title">Berapa orang ikut?</div>
      <p class="muted" style="font-size:13px;margin-bottom:8px;">Yang join kelihatan di halaman bill — gak usah tulis nama.</p>
      <input type="text" inputmode="numeric" id="count-input" placeholder="cth: 4" value="${editState.participant_count || ""}" maxlength="2" style="max-width:120px;">
    </div>
    <div style="height:12px;"></div>
    <div class="sticky-bar"><div class="sticky-inner">
      <button class="btn-primary" id="save-bill-btn">Simpan Perubahan</button>
    </div></div>`;

  $("#back-btn").addEventListener("click", () => loadBillView(data.bill.id));
  renderEditItems();
  updateEditTotal();
  bindRupiahInput($("#subtotal-input"), () => updateEditTotal());
  bindRupiahInput($("#tax-input"), () => updateEditTotal());
  bindRupiahInput($("#service-input"), () => updateEditTotal());
  $("#add-item-btn").addEventListener("click", () => { editState.items.push({ id: null, name: "", price: 0 }); renderEditItems(); });
  $("#count-input").addEventListener("input", (e) => {
    const d = e.target.value.replace(/\D/g, "").slice(0, 2);
    editState.participant_count = d ? parseInt(d, 10) : null;
    e.target.value = d;
  });
  $("#title-input").addEventListener("input", (e) => editState.title = e.target.value);
  $("#date-input").addEventListener("input", (e) => editState.transacted_at = e.target.value);
  $("#save-bill-btn").addEventListener("click", () => saveEditBill(data.bill.id));
}

function renderEditItems() {
  const list = $("#items-list");
  if (!list) return;
  list.innerHTML = editState.items.map((it, idx) => `
    <div class="item-row" style="border-bottom:1px solid var(--border);">
      <div style="flex:2;">
        <input data-role="name" data-idx="${idx}" value="${esc(it.name)}" placeholder="Nama item" style="padding:8px;">
      </div>
      <div style="flex:1;">
        <input data-role="price" data-idx="${idx}" type="text" inputmode="numeric" value="${rupiahFmt(it.price)}" placeholder="0" style="padding:8px;">
      </div>
      <button data-role="del" data-idx="${idx}" class="btn-sm" style="background:var(--red-bg);color:var(--red);flex-shrink:0;">✕</button>
    </div>`).join("");
  $$("[data-role=name]", list).forEach(inp => inp.addEventListener("input", (e) => {
    editState.items[+e.target.dataset.idx].name = e.target.value;
  }));
  $$("[data-role=price]", list).forEach(inp => bindRupiahInput(inp, (v) => {
    editState.items[+inp.dataset.idx].price = v;
    updateEditTotal();
  }));
  $$("[data-role=del]", list).forEach(btn => btn.addEventListener("click", (e) => {
    editState.items.splice(+e.target.dataset.idx, 1);
    renderEditItems();
    updateEditTotal();
  }));
}

function updateEditTotal() {
  const subtotal = rupiahParse($("#subtotal-input").value);
  const tax = rupiahParse($("#tax-input").value);
  const service = rupiahParse($("#service-input").value);
  const total = subtotal + tax + service;
  editState.subtotal = subtotal; editState.tax = tax; editState.service = service;
  const td = $("#total-display");
  if (td) td.textContent = fmt(total);
  const sumItems = editState.items.reduce((s, i) => s + (i.price || 0), 0);
  const warn = $("#sum-warn");
  if (warn) {
    if (sumItems !== subtotal) {
      warn.classList.remove("hidden");
      warn.textContent = `Total item (${fmt(sumItems)}) beda dari subtotal (${fmt(subtotal)}). Kemungkinan ada diskon.`;
    } else warn.classList.add("hidden");
  }
}

async function saveEditBill(billId) {
  const btn = $("#save-bill-btn");
  btn.disabled = true; btn.textContent = "Menyimpan...";
  const items = editState.items.filter(i => i.name && i.price > 0);
  if (!items.length) { toast("Minimal 1 item"); btn.disabled = false; btn.textContent = "Simpan Perubahan"; return; }
  try {
    await apiJson(`/api/bills/${billId}`, "PUT", {
      title: editState.title || editState.merchant || "Bill",
      merchant: editState.merchant || null,
      transacted_at: editState.transacted_at || null,
      subtotal: editState.subtotal,
      tax: editState.tax,
      service: editState.service,
      total: editState.subtotal + editState.tax + editState.service,
      items,
      participant_count: editState.participant_count,
    });
    toast("Bill diupdate ✓");
    loadBillView(billId);
  } catch (e) {
    toast(e.message);
    btn.disabled = false; btn.textContent = "Simpan Perubahan";
  }
}

function initials(name) {
  const parts = String(name || "?").trim().split(/\s+/);
  return (parts[0][0] + (parts[1] ? parts[1][0] : "")).toUpperCase();
}

async function shareBill(billId, title) {
  const url = location.origin + "/#/b/" + billId;
  const text = `Yuk bagi bill "${title}" di Bagiin: ${url}`;
  if (navigator.share) {
    try { await navigator.share({ title: "Bagiin", text }); return; } catch (e) { /* fallthrough */ }
  }
  const wa = "https://wa.me/?text=" + encodeURIComponent(text);
  window.open(wa, "_blank");
}

function openCloseConfirm(data) {
  const notPicked = data.people.filter(p => !p.subtotal_idr && p.identity_id !== data.bill.creator_identity_id);
  const singles = (data.sel_by_item ? Object.entries(data.sel_by_item).filter(([id, names]) => names.length === 1) : []);
  const sheet = el(`
    <div class="sheet-overlay" id="close-sheet">
      <div class="sheet">
        <div class="sheet-handle"></div>
        <div class="sheet-title">Tutup Bill?</div>
        <p class="muted" style="margin-bottom:16px;">Setelah ditutup, pembagian jadi final dan gak bisa diubah.</p>
        ${notPicked.length ? `<div class="warn-box"><strong>Belum pilih item:</strong><ul>${notPicked.map(m => `<li>${esc(m.name)}</li>`).join("")}</ul></div>` : ""}
        ${singles.length ? `<div class="warn-box"><strong>Item cuma dicentang 1 orang (mungkin mau dishare?):</strong><ul>
          ${singles.map(([id, names]) => { const it = data.items.find(i => i.id === +id); return it ? `<li>${esc(it.name)} - ${esc(names[0])} aja</li>` : ""; }).join("")}
        </ul></div>` : ""}
        <button class="btn-primary" id="confirm-close">Tutup Bill Sekarang</button>
        <button class="btn-outline" id="cancel-close" style="width:100%;margin-top:8px;">Batal, tunggu yang lain</button>
      </div>
    </div>`);
  document.body.appendChild(sheet);
  $("#cancel-close", sheet).addEventListener("click", () => sheet.remove());
  sheet.addEventListener("click", (e) => { if (e.target === sheet) sheet.remove(); });
  $("#confirm-close", sheet).addEventListener("click", async () => {
    try {
      await api(`/api/bills/${data.bill.id}/close`, { method: "POST" });
      sheet.remove();
      toast("Bill ditutup");
      loadBillView(data.bill.id);
    } catch (e) { toast(e.message); }
  });
}
