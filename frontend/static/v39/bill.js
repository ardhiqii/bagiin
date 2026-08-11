/* Bagiin frontend - bill view (guest picker + creator summary) */
console.log("BAGIIN_BILLVIEW_V4_LOADED");

// normalized name compare: "Amel" == "amel" == " AMEL "
const normName = (s) => String(s || "").trim().toLowerCase();

// status chip: Selesai (closed) / Lunas (open, all paid) / Aktif (open)
function statusChipHtml(data) {
  if (data.bill.status === "closed") return `<span class="chip chip-grey">Selesai</span>`;
  if (data.settled) return `<span class="chip chip-green">✓ Lunas</span>`;
  return `<span class="chip chip-green">Aktif</span>`;
}

// ---------- Receipt photo: view / upload ----------
function photoBtnHtml(data, me) {
  const isCreator = data.bill.creator_identity_id === me.id;
  if (data.bill.photo_path) {
    return `<button class="btn-outline btn-sm" id="view-photo-btn" style="width:100%;margin-top:10px;">🧾 Liat struk asli</button>`;
  }
  if (isCreator && data.bill.status === "open") {
    return `<button class="btn-outline btn-sm" id="add-photo-btn" style="width:100%;margin-top:10px;">📷 Tambah foto struk</button>`;
  }
  return "";
}

function openPhotoSheet(bill) {
  const fn = bill.photo_path.split("/").pop();
  const sheet = el(`
    <div class="sheet-overlay" id="photo-sheet">
      <div class="sheet">
        <div class="sheet-handle"></div>
        <div class="sheet-title">Struk asli</div>
        <img src="/uploads/${encodeURIComponent(fn)}" alt="Struk asli" style="width:100%;border-radius:var(--r-md);" loading="lazy">
        <button class="btn-outline" id="photo-close" style="width:100%;margin-top:10px;">Tutup</button>
      </div>
    </div>`);
  document.body.appendChild(sheet);
  $("#photo-close", sheet).addEventListener("click", () => sheet.remove());
  sheet.addEventListener("click", (e) => { if (e.target === sheet) sheet.remove(); });
}

function bindPhotoActions(data) {
  const vb = $("#view-photo-btn");
  if (vb) vb.addEventListener("click", () => openPhotoSheet(data.bill));
  const ab = $("#add-photo-btn");
  if (ab) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.style.display = "none";
    document.body.appendChild(input);
    ab.addEventListener("click", () => input.click());
    input.addEventListener("change", async () => {
      const f = input.files[0];
      if (!f) return;
      const fd = new FormData();
      fd.append("file", f);
      try {
        const res = await fetch(`/api/bills/${data.bill.id}/photo`, {
          method: "POST",
          headers: { "X-Identity-Id": state.identity.id },
          body: fd,
        });
        if (!res.ok) {
          let m = "Gagal upload";
          try { const d = await res.json(); m = d.detail || m; } catch (e) {}
          throw new Error(m);
        }
        toast("Struk ditambahkan ✓");
        loadBillView(data.bill.id);
      } catch (e) { toast(e.message); }
    });
  }
}

// ---------- helpers ----------
// Find "me" in a sel_by_item list. Prefer identity_id (duplicate names can
// otherwise misattribute picks); fall back to name for legacy rows.
function mySelEntry(selList, me) {
  if (!selList || !me) return null;
  return selList.find(s => s.id === me.id)
    || selList.find(s => normName(s.name) === normName(me.name)) || null;
}
function othersSel(selList, me) {
  return (selList || []).filter(s => s.id !== me.id && normName(s.name) !== normName(me.name));
}

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
    } else if (myPeople.length === 0) {
      // identity exists but hasn't joined this bill yet -> join automatically
      // so the roster + payer-name resolution see them (bug: they were
      // invisible until they picked an item)
      try {
        const fresh = await apiJson("/api/bills/" + billId + "/join", "POST", {});
        renderGuestView(fresh, me);
      } catch (e) {
        // closed bill or join hiccup: guest can still view the final split
        renderGuestView(data, me);
      }
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
    <div style="padding:8px 0;"><button class="btn-outline btn-sm" id="guest-back">← Ke Beranda</button></div>
    <div style="min-height:70dvh;display:flex;flex-direction:column;justify-content:center;max-width:400px;margin:0 auto;">
      <div class="card" style="margin-bottom:16px;">
        <div class="label-sm">Bill</div>
        <div style="font-size:22px;font-weight:800;margin-top:4px;">${esc(data.bill.title)}</div>
        <div class="money" style="font-size:28px;font-weight:800;margin-top:8px;">${fmt(data.bill.total_idr)}</div>
        ${data.bill.tax_included ? `<p class="muted" style="color:var(--green,#2ecc71);margin-top:6px;">✓ Harga item sudah termasuk pajak — gak ada PPN tambahan</p>` : ""}
        <div class="muted">dibuat oleh ${esc(data.creator_name)}</div>
      </div>
      <div class="field">
        <label>Kamu siapa?</label>
        <input id="guest-name" placeholder="Nama kamu" value="${saved}" maxlength="30" autocomplete="off">
      </div>
      <button class="btn-primary" id="guest-go">Lanjut, milih item</button>
    </div>`;
  $("button#guest-back").addEventListener("click", () => location.hash = "#/");
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
  const app = $("div#app");
  const appEl = app && app.length ? app[0] : app;
  state.bill = data;
  const myPeople = data.people.filter(p => p.identity_id === me.id);
  const myPaid = myPeople.length ? myPeople[0].paid === "paid" : false;
  const iAmPayer = data.paid_by_id === me.id;

  // build my picks (item_id -> qty) from backend selections
  const mySel = new Map();
  Object.entries(data.sel_by_item || {}).forEach(([itemId, selList]) => {
    const mine = mySelEntry(selList, me);
    if (mine) mySel.set(parseInt(itemId, 10), mine.qty || 1);
  });
  state.selQty = mySel;
  const totalMine = computeMyTotal(data, mySel, me.id);
  const myItemCount = mySel.size;

  appEl.innerHTML = `
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
        <span>${statusChipHtml(data)}</span>
      </div>
      ${data.bill.merchant ? `<p class="muted" style="margin-top:6px;">${esc(data.bill.merchant)}</p>` : ""}
      ${data.bill.transacted_at ? `<p class="muted" style="font-size:13px;">${esc(shortDate(data.bill.transacted_at))}</p>` : ""}
      <p class="muted" style="margin-top:6px;">dibuat oleh ${esc(data.creator_name)}</p>
      ${data.bill.tax_included ? `<p class="muted" style="margin-top:6px;color:var(--green,#2ecc71);">✓ Harga item sudah termasuk pajak — gak ada PPN tambahan</p>` : ""}
      ${photoBtnHtml(data, me)}
      ${data.uncovered_idr > 0 ? `<p class="muted" style="margin-top:6px;color:var(--red);">⚠️ Ada ${data.uncovered_slots.length ? data.uncovered_slots.reduce((s, u) => s + u.empty, 0) : "?"} bagian kosong belum keambil (${fmt(data.uncovered_idr)})</p>` : ""}
      ${data.settled && data.bill.status === "open" ? `<p class="muted" style="margin-top:6px;">Semua yang milih item udah bayar 🎉</p>` : ""}
    </div>
    <button class="btn-outline" id="pay-methods-btn" style="width:100%;margin-bottom:12px;">💳 Metode bayar ${esc(data.paid_by_name || data.creator_name)}</button>
    ${data.bill.status === "closed" ? `<div class="warn-box">Bill ini sudah ditutup. Pembagian sudah final.</div>` : ""}
    <div class="card">
      <div class="card-title">Centang yang kamu tanggung</div>
      <div id="pick-items">${data.items.map(it => itemRowHtml(it, data, mySel, me.name, me)).join("")}</div>
    </div>
    ${data.bill.status === "open" ? `
    <div class="sticky-bar"><div class="sticky-inner" style="flex-direction:column;align-items:stretch;gap:10px;">
      <div class="sticky-total" style="display:flex;justify-content:space-between;align-items:center;flex:none;">
        <div class="label">Total kamu</div>
        <div class="money" id="my-total">${fmt(totalMine)}</div>
      </div>
      ${iAmPayer
        ? `<div class="card" style="background:var(--surface-2);border:none;text-align:center;"><span class="chip chip-green">✓ Kamu yang bayar bill ini</span></div>`
        : `<button class="${myPaid ? "btn-green" : "btn-primary"}" id="pay-btn" style="width:100%;flex-shrink:0;">${myPaid ? "✓ Sudah bayar" : "Udah bayar"}</button>`}
    </div></div>` : ""}`;

  $("button#back-btn", appEl).addEventListener("click", () => location.hash = "#/");
  $("button#pay-methods-btn", appEl).addEventListener("click", () => openAccountsSheet(data));
  bindPhotoActions(data);
  bindItemRows(data, me, appEl);
  const payBtn = $("button#pay-btn", appEl);
  if (payBtn) payBtn.addEventListener("click", () => {
    const freshTotal = computeMyTotal(data, state.selQty, me.id);
    openPaySheet(data, me, freshTotal, myPaid);
  });
}

function itemRowHtml(it, data, mySel, myName, me) {
  const selList = (data.sel_by_item[it.id] || []);
  const mine = mySelEntry(selList, me) || selList.find(s => normName(s.name) === normName(myName));
  const myQty = mine ? (mine.qty || 1) : 0;
  const isSel = myQty > 0;
  const isSlot = it.mode === "slot" && it.slot_count;
  const eff = Math.max(0, it.price_idr - (it.discount_idr || 0));
  let shareText;
  if (isSlot) {
    const perSlot = Math.floor(eff / it.slot_count);
    const taken = selList.reduce((s, x) => s + (x.qty || 1), 0);
    const empty = Math.max(0, it.slot_count - taken);
    const mineTxt = myQty > 0 ? ` · kamu ${myQty}×` : "";
    shareText = `${taken}/${it.slot_count} bagian · ${fmt(perSlot)}/bagian${mineTxt}${empty > 0 ? ` · ${empty} kosong` : ""}`;
  } else if (selList.length === 0) {
    shareText = "belum dipilih";
  } else {
    const totalQty = selList.reduce((s, x) => s + (x.qty || 1), 0);
    const perServing = Math.floor(eff / totalQty);
    const mineTxt = myQty > 0 ? ` · kamu ${myQty}×` : "";
    shareText = `${totalQty} porsi · ${fmt(perServing)}/porsi${mineTxt}`;
  }
  const priceHtml = it.discount_idr > 0
    ? `<span style="opacity:.45;text-decoration:line-through;">${fmt(it.price_idr)}</span> <span style="color:var(--green);">${fmt(eff)}</span>`
    : fmt(eff);
  return `
    <div class="item-row ${isSel ? "selected" : ""}" data-item="${it.id}">
      <div class="item-check">${isSel ? "✓" : ""}</div>
      <div class="item-info">
        <div class="item-name">${esc(it.name)}${isSlot ? ` <span class="slot-badge">slot</span>` : ""}</div>
        <div class="item-share">${shareText}</div>
      </div>
      <div class="money item-price">${priceHtml}</div>
    </div>`;
}

function bindItemRows(data, me, root) {
  const scope = root || document;
  $$("#pick-items .item-row", scope).forEach(row => {
    row.addEventListener("click", () => {
      const id = parseInt(row.dataset.item, 10);
      if (state.bill.status === "closed") { toast("Bill sudah ditutup"); return; }
      buzz(10);
      const it = data.items.find(x => x.id === id);
      if (it && it.mode === "slot" && it.slot_count) {
        openSlotPickerSheet(data, me, it);
      } else if (state.selQty.has(id)) {
        // already picked -> open portion picker to change qty / release
        openFreePickerSheet(data, me, it);
      } else {
        state.selQty.set(id, 1);
        updateGuestSelection(data, me);
      }
    });
  });
}

let selectionSaveChain = Promise.resolve();

// Serialize selection POSTs so rapid taps can't reorder them (last tap wins),
// and route picker confirms through the same chain so a queued tap POST can't
// land AFTER a sheet confirm and erase it (bug: raw POSTs raced the chain).
function saveSelectionsViaChain(data, picks) {
  const p = selectionSaveChain.then(() =>
    apiJson(`/api/bills/${data.bill.id}/selections`, "POST", { picks }));
  selectionSaveChain = p.catch(() => {});
  return p;
}

function renderPickRows(data, me) {
  const totalMine = computeMyTotal(data, state.selQty, me.id);
  const mt = $("div#my-total, #my-total");
  const mtEl = mt && mt.length ? mt[0] : mt;
  if (mtEl) mtEl.textContent = fmt(totalMine);
  $$("#pick-items .item-row").forEach(row => {
    const id = parseInt(row.dataset.item, 10);
    const qty = state.selQty.get(id) || 0;
    const sel = qty > 0;
    row.classList.toggle("selected", sel);
    const check = $(".item-check", row);
    if (check) check.textContent = sel ? "✓" : "";
    const share = $(".item-share", row);
    if (share) {
      const it = data.items.find(x => x.id === id);
      const selList = othersSel(data.sel_by_item[id], me);
      if (it && it.mode === "slot" && it.slot_count) {
        const taken = selList.reduce((s, x) => s + (x.qty || 1), 0) + qty;
        const empty = Math.max(0, it.slot_count - taken);
        share.textContent = `${taken}/${it.slot_count} bagian${qty > 0 ? ` · kamu ${qty}×` : ""}${empty > 0 ? ` · ${empty} kosong` : ""}`;
      } else if (sel || selList.length > 0) {
        const totalQty = selList.reduce((s, x) => s + (x.qty || 1), 0) + qty;
        const eff = Math.max(0, it.price_idr - (it.discount_idr || 0));
        const perServing = Math.floor(eff / totalQty);
        share.textContent = `${totalQty} porsi · ${fmt(perServing)}/porsi${qty > 0 ? ` · kamu ${qty}×` : ""}`;
      } else {
        share.textContent = "belum dipilih";
      }
    }
  });
}

async function updateGuestSelection(data, me) {
  // optimistic UI
  const prev = new Map(state.selQty);
  renderPickRows(data, me);
  // persist — serialize saves so rapid taps can't reorder POSTs (last tap wins)
  const picks = Array.from(state.selQty.entries()).map(([itemId, qty]) => ({ item_id: itemId, qty }));
  try {
    await saveSelectionsViaChain(data, picks);
  } catch (e) {
    // rollback on failure so the UI doesn't show picks the backend rejected
    state.selQty = prev;
    renderPickRows(data, me);
    toast(e.message);
  }
}

// ---------- Slot picker sheet (choose how many slots of this item) ----------
function openSlotPickerSheet(data, me, it) {
  const selList = (data.sel_by_item[it.id] || []);
  const othersTaken = othersSel(selList, me).reduce((s, x) => s + (x.qty || 1), 0);
  const myQty = (mySelEntry(selList, me) || {}).qty || 0;
  const max = it.slot_count - othersTaken;
  const leftEmpty = Math.max(0, max - myQty);
  const perSlot = Math.floor(Math.max(0, it.price_idr - (it.discount_idr || 0)) / it.slot_count);
  let qty = myQty || 1;

  const sheet = el(`
    <div class="sheet-overlay" id="slot-picker-sheet">
      <div class="sheet">
        <div class="sheet-handle"></div>
        <div class="sheet-title">${esc(it.name)}</div>
        <p class="muted" style="margin-bottom:4px;">${fmt(perSlot)}/bagian · ${it.slot_count} bagian · ${othersTaken} keambil orang lain</p>
        <p class="muted" style="margin-bottom:4px;">Item ini dibagi ${it.slot_count} bagian tetap. Kamu bisa ambil lebih dari 1 kalau pesennya lebih dari satu.</p>
        <p class="muted" style="margin-bottom:14px;">${leftEmpty > 0 ? `Sisa bagian kosong: ${leftEmpty}` : "Bagian udah abis"}</p>
        ${max > 0 ? `
        <div style="display:flex;align-items:center;justify-content:center;gap:20px;margin-bottom:16px;">
          <button class="btn-outline btn-sm slot-qty-dec" style="width:52px;height:52px;font-size:22px;border-radius:50%;">−</button>
          <div style="text-align:center;">
            <div style="font-size:40px;font-weight:800;" class="slot-qty">${qty}</div>
            <div class="muted" style="font-size:12px;">slot kamu</div>
          </div>
          <button class="btn-outline btn-sm slot-qty-inc" style="width:52px;height:52px;font-size:22px;border-radius:50%;">＋</button>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
          <span class="label">Total kamu</span>
          <span class="money slot-total" style="font-size:24px;font-weight:800;">${fmt(perSlot * qty)}</span>
        </div>
        <button class="btn-primary" id="slot-confirm" style="width:100%;">Ambil ${qty} slot</button>
        ` : ""}
        ${myQty > 0 ? `<button class="btn-outline" id="slot-release" style="width:100%;margin-top:8px;color:var(--red);border-color:var(--red);">Lepas slot (${myQty})</button>` : ""}
        <button class="btn-outline" id="slot-close" style="width:100%;margin-top:8px;">${max > 0 ? "Batal" : "Tutup"}</button>
      </div>
    </div>`);
  document.body.appendChild(sheet);

  const render = () => {
    $(".slot-qty", sheet).textContent = qty;
    $(".slot-total", sheet).textContent = fmt(perSlot * qty);
    $(".slot-qty-inc", sheet).disabled = qty >= max;
    $(".slot-qty-dec", sheet).disabled = qty <= 1;
    $("button#slot-confirm", sheet).textContent = `Ambil ${qty} slot`;
  };
  if (max > 0) {
    $(".slot-qty-dec", sheet).addEventListener("click", () => { qty = Math.max(1, qty - 1); render(); });
    $(".slot-qty-inc", sheet).addEventListener("click", () => { qty = Math.min(max, qty + 1); render(); });
    $("button#slot-confirm", sheet).addEventListener("click", async () => {
      try {
        const picks = [...state.selQty.entries()].filter(([iid]) => iid !== it.id).map(([iid, q]) => ({ item_id: iid, qty: q }))
          .concat([{ item_id: it.id, qty }]);
        state.selQty.set(it.id, qty);
        await saveSelectionsViaChain(data, picks);
        sheet.remove();
        buzz(20);
        loadBillView(data.bill.id);
      } catch (e) { toast(e.message); }
    });
  }
  $("button#slot-release", sheet)?.addEventListener("click", async () => {
    try {
      await api(`/api/bills/${data.bill.id}/items/${it.id}/selections/${me.id}`, { method: "DELETE" });
      sheet.remove();
      toast("Slot dilepas ↩️");
      loadBillView(data.bill.id);
    } catch (e) { toast(e.message); }
  });
  $("button#slot-close", sheet).addEventListener("click", () => sheet.remove());
  sheet.addEventListener("click", (e) => { if (e.target === sheet) sheet.remove(); });
  render();
}

// ---------- Free portion picker sheet (bebas: pick 1+ portions) ----------
function openFreePickerSheet(data, me, it) {
  const selList = (data.sel_by_item[it.id] || []);
  const othersQty = othersSel(selList, me).reduce((s, x) => s + (x.qty || 1), 0);
  const myQty = (mySelEntry(selList, me) || {}).qty || 0;
  const MAX_P = 99;
  let qty = myQty || 1;

  const sheet = el(`
    <div class="sheet-overlay" id="free-picker-sheet">
      <div class="sheet">
        <div class="sheet-handle"></div>
        <div class="sheet-title">${esc(it.name)}</div>
        <p class="muted" style="margin-bottom:4px;">Pilih bebas — ambil 1 porsi atau lebih kalau pesennya lebih dari satu. Harga dibagi sesuai porsi yang keambil.</p>
        <p class="muted" style="margin-bottom:14px;">${othersQty > 0 ? `${othersQty} porsi keambil orang lain` : "Belum ada yang ambil item ini"}</p>
        <div style="display:flex;align-items:center;justify-content:center;gap:20px;margin-bottom:16px;">
          <button class="btn-outline btn-sm fr-qty-dec" style="width:52px;height:52px;font-size:22px;border-radius:50%;">−</button>
          <div style="text-align:center;">
            <div style="font-size:40px;font-weight:800;" class="fr-qty">${qty}</div>
            <div class="muted" style="font-size:12px;">porsi kamu</div>
          </div>
          <button class="btn-outline btn-sm fr-qty-inc" style="width:52px;height:52px;font-size:22px;border-radius:50%;">＋</button>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
          <span class="label">Estimasi kamu</span>
          <span class="money fr-total" style="font-size:24px;font-weight:800;">${fmt(perServingEst(it, othersQty, qty) * qty)}</span>
        </div>
        <button class="btn-primary" id="fr-confirm" style="width:100%;">Simpan ${qty} porsi</button>
        ${myQty > 0 ? `<button class="btn-outline" id="fr-release" style="width:100%;margin-top:8px;color:var(--red);border-color:var(--red);">Lepas pilihan (${myQty})</button>` : ""}
        <button class="btn-outline" id="fr-close" style="width:100%;margin-top:8px;">${myQty > 0 ? "Batal" : "Tutup"}</button>
      </div>
    </div>`);
  document.body.appendChild(sheet);

  const render = () => {
    $(".fr-qty", sheet).textContent = qty;
    $(".fr-total", sheet).textContent = fmt(perServingEst(it, othersQty, qty) * qty);
    $(".fr-qty-inc", sheet).disabled = qty >= MAX_P;
    $(".fr-qty-dec", sheet).disabled = qty <= 1;
    $("button#fr-confirm", sheet).textContent = `Simpan ${qty} porsi`;
  };
  $(".fr-qty-dec", sheet).addEventListener("click", () => { qty = Math.max(1, qty - 1); render(); });
  $(".fr-qty-inc", sheet).addEventListener("click", () => { qty = Math.min(MAX_P, qty + 1); render(); });
  $("button#fr-confirm", sheet).addEventListener("click", async () => {
    try {
      const picks = [...state.selQty.entries()].filter(([iid]) => iid !== it.id).map(([iid, q]) => ({ item_id: iid, qty: q }))
        .concat([{ item_id: it.id, qty }]);
      state.selQty.set(it.id, qty);
      await saveSelectionsViaChain(data, picks);
      sheet.remove();
      buzz(20);
      loadBillView(data.bill.id);
    } catch (e) { toast(e.message); }
  });
  $("button#fr-release", sheet)?.addEventListener("click", async () => {
    try {
      await api(`/api/bills/${data.bill.id}/items/${it.id}/selections/${me.id}`, { method: "DELETE" });
      sheet.remove();
      toast("Pilihan dilepas ↩️");
      loadBillView(data.bill.id);
    } catch (e) { toast(e.message); }
  });
  $("button#fr-close", sheet).addEventListener("click", () => sheet.remove());
  sheet.addEventListener("click", (e) => { if (e.target === sheet) sheet.remove(); });
  render();
}
function perServingEst(it, othersQty, myQty) {
  const totalQty = othersQty + myQty;
  const eff = Math.max(0, it.price_idr - (it.discount_idr || 0));
  return totalQty > 0 ? Math.floor(eff / totalQty) : eff;
}
function computeMyBreakdown(data, selQty) {
  // Mirror backend calc:
  // - free item: price / (others + me), rounded like backend (floor + rem)
  // - slot item: per-slot price (price // slot_count) * my qty
  // - tax proportional to total subtotal across ALL people, rounded down.
  let sub = 0;
  let totalSelAll = 0;
  const myName = state.identity ? state.identity.name : "";
  const myId = state.identity ? state.identity.id : "";
  data.items.forEach(it => {
    const myQty = selQty.get(it.id) || 0;
    if (it.mode === "slot" && it.slot_count) {
      const eff = Math.max(0, it.price_idr - (it.discount_idr || 0));
      const perSlot = Math.floor(eff / it.slot_count);
      if (myQty > 0) sub += perSlot * myQty;
      // total assigned subtotal for tax: all taken slots * perSlot
      const selList = (data.sel_by_item[it.id] || []);
      const taken = selList.reduce((s, x) => s + (x.qty || 1), 0);
      totalSelAll += perSlot * taken;
      return;
    }
    const selList = (data.sel_by_item[it.id] || []);
    if (!myQty && selList.length === 0) return; // nobody picked -> not in tax base
    // free item: per-serving split (my qty of total qty taken)
    let othersQty = 0;
    selList.forEach(s => {
      const isMe = (s.id && s.id === myId) ? true : normName(s.name) === normName(myName);
      if (!isMe) othersQty += (s.qty || 1);
    });
    const totalQty = othersQty + myQty;
    const eff = Math.max(0, it.price_idr - (it.discount_idr || 0));
    if (myQty > 0 && totalQty > 0) sub += Math.floor(eff / totalQty) * myQty;
    totalSelAll += eff;
  });
  const taxService = (data.bill.tax_idr || 0) + (data.bill.service_idr || 0);
  let tax = 0;
  if (totalSelAll > 0) tax = Math.floor(sub * taxService / totalSelAll);
  return { sub, tax, total: sub + tax };
}

function computeMyTotal(data, selQty, myIdentityId) {
  return computeMyBreakdown(data, selQty).total;
}

// ---------- Pay sheet (confirm items -> mark paid) ----------
function openPaySheet(data, me, totalMine, alreadyPaid) {
  const sheet = el(`
    <div class="sheet-overlay" id="pay-sheet">
      <div class="sheet">
        <div class="sheet-handle"></div>
        <div class="sheet-title">Konfirmasi item</div>
        <p class="muted" style="margin-bottom:10px;">Ini item yang kamu pilih. Ketuk item buat batalkan.</p>
        <div id="pay-items"></div>
        <div id="pay-total"></div>
        <button class="${alreadyPaid ? "btn-green" : "btn-primary"}" id="confirm-pay">
          ${alreadyPaid ? "✓ Sudah bayar" : "Tandai sudah bayar"}
        </button>
        ${alreadyPaid ? `<button class="btn-outline" id="undo-pay" style="width:100%;margin-top:8px;color:var(--red);border-color:var(--red);">↩️ Batalkan sudah bayar</button>` : ""}
        <button class="btn-outline" id="close-sheet" style="width:100%;margin-top:8px;">Batal</button>
      </div>
    </div>`);
  document.body.appendChild(sheet);
  $("#close-sheet", sheet).addEventListener("click", () => sheet.remove());
  sheet.addEventListener("click", (e) => { if (e.target === sheet) sheet.remove(); });

  const renderItems = () => {
    const items = data.items.filter(it => (state.selQty.get(it.id) || 0) > 0);
    const bd = computeMyBreakdown(data, state.selQty);
    const taxService = (data.bill.tax_idr || 0) + (data.bill.service_idr || 0);
    const itemsBox = $("div#pay-items", sheet);
    itemsBox.innerHTML = items.length ? `
      <div class="card" style="background:var(--surface-2);border:none;margin-bottom:12px;">
        <div class="label-sm" style="margin-bottom:4px;">Item kamu (${items.length})</div>
        ${items.map(it => {
          const myQty = state.selQty.get(it.id) || 1;
          const eff = Math.max(0, it.price_idr - (it.discount_idr || 0));
          let myPrice;
          let shareNote;
          if (it.mode === "slot" && it.slot_count) {
            const perSlot = Math.floor(eff / it.slot_count);
            myPrice = perSlot * myQty;
            shareNote = `${myQty} slot · ${fmt(perSlot)}/slot`;
          } else {
            // free item: split by total portions taken (others + mine), like
            // the backend and like computeMyBreakdown — NOT by selector count
            const n = (data.sel_by_item[it.id] || []).reduce((s, x) => s + (x.qty || 1), 0);
            myPrice = n > 1 ? Math.floor(eff / n) * myQty : eff;
            shareNote = n > 1 ? `dibagi ${n} porsi` : "";
          }
          return `
          <div class="pay-item" data-item="${it.id}">
            <div style="flex:1;min-width:0;">${esc(it.name)}${shareNote ? ` <span class="muted">· ${shareNote}</span>` : ""}</div>
            <div style="text-align:right;flex-shrink:0;">
              <div class="money">${fmt(myPrice)}</div>
              ${it.discount_idr > 0 ? `<div class="muted" style="font-size:11px;">diskon ${fmt(it.discount_idr)} · dari ${fmt(it.price_idr)}</div>` : (it.mode !== "slot" && (data.sel_by_item[it.id] || []).length > 1 ? `<div class="muted" style="font-size:11px;">dari ${fmt(eff)}</div>` : "")}
            </div>
            <span class="pay-item-x">✕</span>
          </div>`;
        }).join("")}
        <div class="break-row" style="margin-top:8px;">
          <span class="muted">Subtotal item</span>
          <span class="money">${fmt(bd.sub)}</span>
        </div>
        ${taxService > 0 ? `
        <div class="break-row">
          <span class="muted">Pajak & service <span class="label-sm" style="text-transform:none;">(PPN ${fmt(data.bill.tax_idr || 0)} + SC ${fmt(data.bill.service_idr || 0)})</span></span>
          <span class="money">${fmt(bd.tax)}</span>
        </div>` : ""}
      </div>` : `<div class="card" style="background:var(--surface-2);border:none;margin-bottom:12px;text-align:center;color:var(--text-3);font-size:14px;">Belum ada item dipilih</div>`;
    $("div#pay-total", sheet).innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <span class="label">Total kamu</span>
        <span class="money" style="font-size:32px;font-weight:800;">${fmt(bd.total)}</span>
      </div>`;
    $$(".pay-item", itemsBox).forEach(row => row.addEventListener("click", () => {
      const id = parseInt(row.dataset.item, 10);
      const it = data.items.find(x => x.id === id);
      if (it && it.mode === "slot" && it.slot_count) {
        sheet.remove();
        openSlotPickerSheet(data, me, it);
        return;
      }
      if (state.selQty.has(id)) state.selQty.delete(id);
      else state.selQty.set(id, 1);
      updateGuestSelection(data, me);
      renderItems();
    }));
    $("button#confirm-pay", sheet).disabled = items.length === 0;
  };

  renderItems();
  $("#confirm-pay", sheet).addEventListener("click", async () => {
    try {
      await api(`/api/bills/${data.bill.id}/payments/${me.id}/paid`, { method: "POST" });
      buzz(20);
      sheet.remove();
      toast("Udah dicatat! 🎉");
      loadBillView(data.bill.id);
    } catch (e) { toast(e.message); }
  });
  const undoBtn = $("#undo-pay", sheet);
  if (undoBtn) undoBtn.addEventListener("click", async () => {
    try {
      await api(`/api/bills/${data.bill.id}/payments/${me.id}/unpaid`, { method: "POST" });
      buzz(10);
      sheet.remove();
      toast("Status bayar dibatalkan ↩️");
      loadBillView(data.bill.id);
    } catch (e) { toast(e.message); }
  });
}

// ---------- Accounts sheet (standalone payment methods) ----------
function openAccountsSheet(data) {
  const payerName = data.paid_by_name || data.creator_name;
  const accounts = data.paid_by_accounts && data.paid_by_accounts.length ? data.paid_by_accounts : (data.creator_accounts || []);
  const sheet = el(`
    <div class="sheet-overlay" id="accounts-sheet">
      <div class="sheet">
        <div class="sheet-handle"></div>
        <div class="sheet-title">Metode bayar ${esc(payerName)}</div>
        <div class="muted" style="margin-bottom:12px;">Bayar langsung ke ${esc(payerName)} lewat:</div>
        ${accounts.length ? `<div>${accounts.map(a => `
          <div class="account-row">
            ${brandChipHtml(a.brand)}
            <div style="flex:1;min-width:0;">
              <div style="font-weight:600;font-size:14px;">${esc(a.brand)}</div>
              <div class="muted" style="font-size:13px;">${esc(a.account_no)}${a.holder_name ? " · " + esc(a.holder_name) : ""}</div>
            </div>
            <button class="btn-sm copy-acct" data-no="${esc(a.account_no)}" style="flex-shrink:0;">📋 Salin</button>
          </div>`).join("")}</div>`
          : `<div class="card" style="background:var(--surface-2);border:none;"><div class="muted">${esc(payerName)} belum nambah metode bayar. Minta nomor rekening/e-money-nya langsung ya.</div></div>`}
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
  const notPicked = data.people.filter(p => !p.subtotal_idr && p.identity_id !== me.id);

  // consolidated "perhatian" rows (single card, one row each)
  const warnRows = [];
  if (data.uncovered_slots.length) {
    warnRows.push({
      icon: "🧩",
      text: `Bagian kosong belum keambil: ${data.uncovered_slots.map(u => `${esc(u.name)} (${u.empty} × ${fmt(u.per_slot)} = ${fmt(u.amount_idr)})`).join(", ")}`,
      red: true,
    });
  }
  if (data.warnings.length) {
    // esc() the whole joined string: warnings embed user-typed item names
    warnRows.push({ icon: "🧾", text: esc(data.warnings.join(" · ")) });
  }
  if (notPicked.length) {
    warnRows.push({ icon: "✏️", text: `Belum pilih item: ${notPicked.map(m => esc(m.name)).join(", ")}` });
  }
  const warnHtml = warnRows.length ? `
    <div class="warn-card">
      ${warnRows.map(w => `<div class="warn-row" style="${w.red ? "color:var(--red);" : ""}"><span class="warn-icon">${w.icon}</span><span>${w.text}</span></div>`).join("")}
    </div>` : "";

  app.innerHTML = `
    <div class="topbar">
      <button class="btn-icon" id="back-btn">←</button>
      <div class="brand" style="font-size:16px;">${esc(data.bill.title)}</div>
      <button class="btn-icon" id="share-btn" title="Bagikan">🔗</button>
    </div>
    <div class="card" style="margin-bottom:12px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;">
        <div>
          <div class="label-sm">Total bill</div>
          <div class="money hero-total">${fmt(data.bill.total_idr)}</div>
        </div>
        <span>${statusChipHtml(data)}</span>
      </div>
      ${data.bill.merchant ? `<div class="muted" style="font-size:13px;margin-top:4px;">${esc(data.bill.merchant)}</div>` : ""}
      ${data.bill.transacted_at ? `<div class="muted" style="font-size:13px;">${esc(shortDate(data.bill.transacted_at))}</div>` : ""}
      ${data.bill.tax_included ? `<div class="muted" style="font-size:13px;margin-top:4px;color:var(--green,#2ecc71);">✓ Harga item sudah termasuk pajak — gak ada PPN tambahan</div>` : ""}
      <div style="display:flex;gap:16px;margin-top:12px;">
        <div><span class="chip chip-green">✓ ${fmt(totalPaid)} dibayar</span></div>
        <div>${!hasAssignments
          ? `<span class="chip chip-grey">Belum ada yang milih</span>`
          : (totalUnpaid > 0
            ? `<span class="chip chip-red">${fmt(totalUnpaid)} belum</span>`
            : `<span class="chip chip-green">semua lunas</span>`)}</div>
      </div>
      ${photoBtnHtml(data, me)}
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:10px;">
        <span class="muted" style="font-size:13px;">Yang bayar: <strong style="color:var(--text);">${esc(data.paid_by_name || data.creator_name)}</strong></span>
        ${data.bill.status === "open" ? `<button class="btn-outline btn-sm" id="set-payer-btn" style="flex-shrink:0;">Ubah</button>` : ""}
      </div>
    </div>
    ${warnHtml}
    <div class="card">
      <div class="card-title">Pembagian <span class="muted">(${data.people.length} orang)</span></div>
      <div id="people-list">
        ${data.people.map(p => `
          <div class="person-row">
            <div class="avatar">${esc(initials(p.name))}</div>
            <div class="person-info">
              <div class="person-name">${esc(p.name)}${p.identity_id === me.id ? ' <span class="muted">(kamu)</span>' : ""}</div>
              <div class="person-sub">${p.subtotal_idr ? `${fmt(p.subtotal_idr)} item · ${fmt(p.tax_idr)} pajak` : "belum pilih item"}</div>
            </div>
            <div class="person-right">
              <div class="money person-total">${fmt(p.total_idr)}</div>
              ${data.bill.status === "open" && p.identity_id !== data.paid_by_id
                ? `<button class="chip-btn toggle-paid" data-id="${esc(p.identity_id)}" data-name="${esc(p.name)}" data-paid="${p.paid === "paid" ? "1" : "0"}" style="${p.paid === "paid" ? "background:var(--green-bg);color:var(--green);border-color:var(--green);" : "background:var(--red-bg);color:var(--red);border-color:var(--red);"}">${p.paid === "paid" ? "✓ lunas" : "Tandai lunas"}</button>`
                : `<span class="chip ${p.paid === "paid" ? "chip-green" : "chip-red"}">${p.paid === "paid" ? "✓ bayar" : "belum"}</span>`}
              ${p.identity_id === data.paid_by_id ? `<div class="muted" style="font-size:11px;text-align:right;margin-top:2px;">yang bayar</div>` : ""}
            </div>
            ${data.bill.status === "open" && p.identity_id !== me.id ? `<button class="person-remove remove-person" data-id="${esc(p.identity_id)}" data-name="${esc(p.name)}" title="Hapus ${esc(p.name)}">✕</button>` : ""}
          </div>`).join("")}
      </div>
    </div>
    <div class="card">
      <div class="card-title">Item & siapa yang pilih</div>
      ${data.bill.status === "open" ? `<div style="display:flex;gap:8px;margin-bottom:8px;">
        <button class="btn-outline btn-sm" id="pick-mine-btn" style="flex:1;">🖐️ Pilih item kamu</button>
        <button class="btn-outline btn-sm" id="edit-bill-btn" style="flex:1;">✏️ Edit</button>
      </div>` : ""}
      ${data.items.map(it => {
        const selList = (data.sel_by_item[it.id] || []);
        const isSlot = it.mode === "slot" && it.slot_count;
        const eff = Math.max(0, it.price_idr - (it.discount_idr || 0));
        const priceHtml = it.discount_idr > 0
          ? `<span style="opacity:.45;text-decoration:line-through;">${fmt(it.price_idr)}</span> <span style="color:var(--green);">${fmt(eff)}</span>`
          : fmt(eff);
        let shareText;
        if (isSlot) {
          const perSlot = Math.floor(Math.max(0, it.price_idr - (it.discount_idr || 0)) / it.slot_count);
          const taken = selList.reduce((s, x) => s + (x.qty || 1), 0);
          const empty = Math.max(0, it.slot_count - taken);
          shareText = `${taken}/${it.slot_count} bagian · ${fmt(perSlot)}/bagian`
            + (selList.length ? ` · ${selList.map(s => `${esc(s.name)}${(s.qty || 1) > 1 ? ` ×${s.qty}` : ""}`).join(", ")}` : "")
            + (empty > 0 ? ` · <span style="color:var(--red);">${empty} kosong</span>` : "");
        } else {
          shareText = selList.length ? selList.map(s => `${esc(s.name)}${(s.qty || 1) > 1 ? ` ×${s.qty}` : ""}`).join(", ") : "belum dipilih";
        }
        return `
        <div class="item-row" style="border-bottom:1px solid var(--border);">
          <div class="item-info">
            <div class="item-name">${esc(it.name)}${isSlot ? ` <span class="slot-badge">slot</span>` : ""}</div>
            <div class="item-share">${shareText}</div>
          </div>
          <div class="money item-price">${priceHtml}</div>
          ${data.bill.status === "open" && isSlot ? `<button class="btn-sm slot-mgr" data-item="${it.id}" data-name="${esc(it.name)}" title="Atur bagian" style="flex-shrink:0;margin-left:6px;">⚙️</button>` : ""}
        </div>`;
      }).join("")}
    </div>
    ${data.bill.status === "open" ? `
    <div class="sticky-bar"><div class="sticky-inner">
      <button class="btn-primary" id="close-bill-btn" style="flex:1;">Tutup Bill</button>
    </div></div>` : `<div class="card" style="text-align:center;background:var(--surface-2);border:none;"><span class="chip chip-grey">Bill selesai</span><button class="btn-outline" id="reopen-bill-btn" style="width:100%;margin-top:10px;color:var(--accent);border-color:var(--accent);">↩️ Buka Bill Lagi</button></div>`}
    <button class="btn-outline" id="delete-bill-btn" style="width:100%;color:var(--red);border-color:var(--red);margin-top:8px;">🗑️ Hapus Bill</button>`;

  $("#back-btn").addEventListener("click", () => location.hash = "#/");
  $("#share-btn").addEventListener("click", () => shareBill(data.bill.id, data.bill.title));
  bindPhotoActions(data);
  const pickBtn = $("#pick-mine-btn");
  if (pickBtn) pickBtn.addEventListener("click", () => renderCreatorPick(data));
  const setPayerBtn = $("#set-payer-btn");
  if (setPayerBtn) setPayerBtn.addEventListener("click", () => openSetPayerSheet(data));
  const editBtn = $("#edit-bill-btn");
  if (editBtn) editBtn.addEventListener("click", () => renderEditBill(data));
  const closeBtn = $("button#close-bill-btn");
  if (closeBtn) closeBtn.addEventListener("click", () => openCloseConfirm(data));
  const reopenBtn = $("button#reopen-bill-btn");
  if (reopenBtn) reopenBtn.addEventListener("click", () => openReopenConfirm(data));
  $$(".slot-mgr").forEach(b => b.addEventListener("click", () => {
    const it = data.items.find(x => x.id === parseInt(b.dataset.item, 10));
    if (it) openSlotManagerSheet(data, it);
  }));
  $$(".remove-person").forEach(b => b.addEventListener("click", () =>
    openRemovePersonConfirm(data, b.dataset.id, b.dataset.name)));
  $$(".toggle-paid").forEach(b => b.addEventListener("click", () => togglePaidByCreator(data, b)));
  $("button#delete-bill-btn").addEventListener("click", () => openDeleteBillConfirm(data.bill.id, data.bill.title));
}

// ---------- Creator toggles someone's paid status ----------
async function togglePaidByCreator(data, btn) {
  const identityId = btn.dataset.id;
  const name = btn.dataset.name;
  const currentlyPaid = btn.dataset.paid === "1";
  const action = currentlyPaid ? "unpaid" : "paid";
  try {
    await api(`/api/bills/${data.bill.id}/payments/${identityId}/${action}`, { method: "POST" });
    toast(currentlyPaid ? `${name} dibatalkan lunasnya ↩️` : `${name} ditandai lunas ✓`);
    loadBillView(data.bill.id);
  } catch (e) { toast(e.message); }
}

// ---------- Slot manager (creator): change N / free slots ----------
function openSlotManagerSheet(data, it) {
  const selList = (data.sel_by_item[it.id] || []);
  const taken = selList.reduce((s, x) => s + (x.qty || 1), 0);
  const eff = Math.max(0, it.price_idr - (it.discount_idr || 0));
  const perSlot = Math.floor(eff / it.slot_count);
  let n = it.slot_count;
  const sheet = el(`
    <div class="sheet-overlay" id="slot-mgr-sheet">
      <div class="sheet">
        <div class="sheet-handle"></div>
        <div class="sheet-title">Atur bagian: ${esc(it.name)}</div>
        <p class="muted" style="margin-bottom:12px;">${it.discount_idr > 0 ? `<s style="opacity:.5">${fmt(it.price_idr)}</s> → ${fmt(eff)}` : fmt(eff)} · ${fmt(perSlot)}/bagian · ${taken}/${n} keambil</p>
        <div style="display:flex;align-items:center;justify-content:center;gap:20px;margin-bottom:12px;">
          <button class="btn-outline btn-sm mgr-dec" style="width:52px;height:52px;font-size:22px;border-radius:50%;">−</button>
          <div style="text-align:center;">
            <div style="font-size:40px;font-weight:800;" class="mgr-n">${n}</div>
            <div class="muted" style="font-size:12px;">total slot</div>
          </div>
          <button class="btn-outline btn-sm mgr-inc" style="width:52px;height:52px;font-size:22px;border-radius:50%;">＋</button>
        </div>
        <p class="muted" style="font-size:13px;margin-bottom:12px;">Bagian minimal ${taken} (yang udah keambil). Harga per bagian ngikut total bagian.</p>
        <button class="btn-primary" id="mgr-save" style="width:100%;">Simpan</button>
        ${selList.length ? `<div class="label-sm" style="margin:14px 0 6px;">Pemegang bagian</div>` : ""}
        ${selList.map(s => `
          <div class="account-row">
            <div style="flex:1;">${esc(s.name)} <span class="muted">×${s.qty || 1}</span></div>
            <button class="btn-sm mgr-free" data-id="${esc(s.id || "")}" data-name="${esc(s.name)}" style="background:var(--red-bg);color:var(--red);flex-shrink:0;">Lepas</button>
          </div>`).join("")}
        <button class="btn-outline" id="mgr-close" style="width:100%;margin-top:10px;">Tutup</button>
      </div>
    </div>`);
  document.body.appendChild(sheet);
  const render = () => {
    $(".mgr-n", sheet).textContent = n;
    $(".mgr-dec", sheet).disabled = n <= taken;
  };
  $(".mgr-dec", sheet).addEventListener("click", () => { n = Math.max(taken, n - 1); render(); });
  $(".mgr-inc", sheet).addEventListener("click", () => { n = Math.min(99, n + 1); render(); });
  $("button#mgr-save", sheet).addEventListener("click", async () => {
    try {
      await apiJson(`/api/bills/${data.bill.id}/items/${it.id}/slots`, "PUT", { slot_count: n });
      sheet.remove();
      toast("Slot diupdate ✓");
      loadBillView(data.bill.id);
    } catch (e) { toast(e.message); }
  });
  $$(".mgr-free", sheet).forEach(b => b.addEventListener("click", async () => {
    if (!confirm(`Lepas slot ${esc(b.dataset.name)} dari "${esc(it.name)}"?`)) return;
    try {
      await api(`/api/bills/${data.bill.id}/items/${it.id}/selections/${b.dataset.id}`, { method: "DELETE" });
      sheet.remove();
      toast("Slot dilepas ↩️");
      loadBillView(data.bill.id);
    } catch (e) { toast(e.message); }
  }));
  $("button#mgr-close", sheet).addEventListener("click", () => sheet.remove());
  sheet.addEventListener("click", (e) => { if (e.target === sheet) sheet.remove(); });
  render();
}

// ---------- Set payer (who paid the bill) ----------
function openSetPayerSheet(data) {
  const roster = data.people || [];
  const sheet = el(`
    <div class="sheet-overlay" id="set-payer-sheet">
      <div class="sheet">
        <div class="sheet-handle"></div>
        <div class="sheet-title">Yang bayar bill ini?</div>
        <p class="muted" style="margin-bottom:12px;">Yang dipilih dianggap sudah lunas otomatis, dan metode bayar yang ditampilkan ke orang lain pake akun dia.</p>
        <div style="display:flex;flex-direction:column;gap:8px;">
          <button class="btn-outline payer-opt" data-id="${esc(data.bill.creator_identity_id)}" data-name="${esc(data.creator_name)}" style="text-align:left;justify-content:flex-start;">
            ${data.paid_by_id === data.bill.creator_identity_id ? "✓ " : ""}<strong>${esc(data.creator_name)}</strong> <span class="muted">(kamu, pembuat)</span>
          </button>
          ${roster.filter(p => p.identity_id !== data.bill.creator_identity_id).map(p => `
            <button class="btn-outline payer-opt" data-id="${esc(p.identity_id)}" data-name="${esc(p.name)}" style="text-align:left;justify-content:flex-start;">
              ${data.paid_by_id === p.identity_id ? "✓ " : ""}<strong>${esc(p.name)}</strong>
            </button>`).join("")}
        </div>
        <div style="height:1px;background:var(--border);margin:12px 0;"></div>
        <div class="muted" style="font-size:13px;margin-bottom:8px;">Atau ketik nama (buat yang belum join):</div>
        <input id="payer-name-input" placeholder="Nama orang yang bayar" value="${esc(data.paid_by_name || "")}" maxlength="30" autocomplete="off">
        <button class="btn-primary" id="payer-name-save" style="width:100%;margin-top:8px;">Pakai nama ini</button>
        <button class="btn-outline" id="payer-cancel" style="width:100%;margin-top:8px;">Batal</button>
      </div>
    </div>`);
  document.body.appendChild(sheet);
  $$(".payer-opt", sheet).forEach(b => b.addEventListener("click", async () => {
    try {
      await apiJson(`/api/bills/${data.bill.id}/paid_by`, "PUT", { identity_id: b.dataset.id });
      sheet.remove();
      toast("Yang bayar diubah ✓");
      loadBillView(data.bill.id);
    } catch (e) { toast(e.message); }
  }));
  $("input#payer-name-input", sheet).addEventListener("keydown", (e) => { if (e.key === "Enter") $("button#payer-name-save", sheet).click(); });
  $("button#payer-name-save", sheet).addEventListener("click", async () => {
    const name = $("input#payer-name-input", sheet).value.trim();
    if (!name) { toast("Isi nama dulu"); return; }
    try {
      await apiJson(`/api/bills/${data.bill.id}/paid_by`, "PUT", { name });
      sheet.remove();
      toast("Yang bayar diubah ✓");
      loadBillView(data.bill.id);
    } catch (e) { toast(e.message); }
  });
  $("button#payer-cancel", sheet).addEventListener("click", () => sheet.remove());
  sheet.addEventListener("click", (e) => { if (e.target === sheet) sheet.remove(); });
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

// ---------- Delete bill confirm ----------
function openDeleteBillConfirm(billId, title) {
  const sheet = el(`
    <div class="sheet-overlay" id="delete-bill-sheet">
      <div class="sheet">
        <div class="sheet-handle"></div>
        <div class="sheet-title">Hapus bill ini?</div>
        <p class="muted" style="margin-bottom:8px;"><strong style="color:var(--text);">${esc(title)}</strong> — semua item, pembagian, dan catatan bayar di bill ini bakal kehapus permanen.</p>
        <p class="muted" style="margin-bottom:16px;">Gak bisa dibatalkan. Orang lain yang udah join juga gak bakal bisa liat bill ini lagi.</p>
        <button class="btn-primary" id="confirm-delete-bill" style="width:100%;background:var(--red);border-color:var(--red);">Hapus Selamanya</button>
        <button class="btn-outline" id="cancel-delete-bill" style="width:100%;margin-top:8px;">Batal</button>
      </div>
    </div>`);
  document.body.appendChild(sheet);
  $("#cancel-delete-bill", sheet).addEventListener("click", () => sheet.remove());
  sheet.addEventListener("click", (e) => { if (e.target === sheet) sheet.remove(); });
  $("#confirm-delete-bill", sheet).addEventListener("click", async () => {
    try {
      await api(`/api/bills/${billId}`, { method: "DELETE" });
      sheet.remove();
      toast("Bill dihapus 🗑️");
      location.hash = "#/";
    } catch (e) { toast(e.message); }
  });
}

// ---------- Creator pick mode: pick your own items ----------
function renderCreatorPick(data) {
  const app = $("div#app");
  const appEl = app && app.length ? app[0] : app;
  const me = state.identity;
  state.bill = data;
  // build my picks (item_id -> qty) for creator
  const mySel = new Map();
  Object.entries(data.sel_by_item || {}).forEach(([itemId, selList]) => {
    const mine = mySelEntry(selList, me);
    if (mine) mySel.set(parseInt(itemId, 10), mine.qty || 1);
  });
  state.selQty = mySel;
  const totalMine = computeMyTotal(data, mySel, me.id);

  appEl.innerHTML = `
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
      <p class="muted" style="margin-top:6px;">Ketuk item yang kamu tanggung. Item slot bisa diambil lebih dari 1 slot. Yang gak dicentang siapa-siapa masuk ke kamu pas bill ditutup.</p>
    </div>
    <div class="card">
      <div class="card-title">Centang yang kamu tanggung</div>
      <div id="pick-items">${data.items.map(it => itemRowHtml(it, data, mySel, me.name, me)).join("")}</div>
    </div>
    <div class="sticky-bar"><div class="sticky-inner" style="flex-direction:column;align-items:stretch;gap:10px;">
      <div class="sticky-total" style="display:flex;justify-content:space-between;align-items:center;flex:none;">
        <div class="label">Total kamu</div>
        <div class="money" id="my-total">${fmt(totalMine)}</div>
      </div>
      <button class="btn-primary" id="done-btn" style="width:100%;flex-shrink:0;">Selesai</button>
    </div></div>`;

  $("button#back-btn", appEl).addEventListener("click", () => loadBillView(data.bill.id));
  bindItemRows(data, me, appEl);
  $("button#done-btn", appEl).addEventListener("click", () => loadBillView(data.bill.id));
}

// ---------- Creator edit bill ----------
let editState = { items: [], subtotal: 0, tax: 0, service: 0, total: 0, title: "", transacted_at: "", merchant: "", tax_included: false };

function renderEditBill(data) {
  const app = $("#app");
  editState = {
    items: data.items.map(it => ({ id: it.id, name: it.name, price: it.price_idr, discount: it.discount_idr || 0, mode: it.mode || "free", slot_count: it.slot_count || null })),
    subtotal: data.bill.subtotal_idr || 0,
    tax: data.bill.tax_idr || 0,
    service: data.bill.service_idr || 0,
    total: data.bill.total_idr || 0,
    title: data.bill.title || "",
    transacted_at: data.bill.transacted_at || "",
    merchant: data.bill.merchant || "",
    tax_included: !!(data.bill.tax_included),
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
      <label class="toggle-row" style="display:flex;align-items:center;justify-content:space-between;gap:12px;cursor:pointer;margin-top:10px;">
        <span style="flex:1;">
          <span style="font-weight:600;">Harga item sudah termasuk pajak</span>
          <div class="muted" style="font-size:13px;">Kalau struk nulis "termasuk pajak", harga item udah kehitung pajaknya</div>
        </span>
        <input type="checkbox" id="tax-included-toggle" ${editState.tax_included ? "checked" : ""} style="width:20px;height:20px;accent-color:var(--accent);">
      </label>
      <div id="tax-included-badge" class="${editState.tax_included ? "" : "hidden"}" style="margin-top:8px;padding:8px 10px;background:rgba(46,204,113,.12);border-radius:8px;color:var(--green,#2ecc71);font-size:13px;">✓ Harga item sudah termasuk pajak — PPN & Service dikosongin, total ngikut item</div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;">
        <span class="label-sm">Total</span>
        <span class="money" style="font-size:22px;font-weight:800;" id="total-display">${fmt(editState.total)}</span>
      </div>
      <div id="sum-warn" class="error-text hidden" style="margin-top:6px;"></div>
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
  const taxIncToggle = $("#tax-included-toggle");
  if (taxIncToggle) {
    taxIncToggle.addEventListener("change", (e) => {
      editState.tax_included = e.target.checked;
      updateEditTotal();
    });
  }
  $("#add-item-btn").addEventListener("click", () => { editState.items.push({ id: null, name: "", price: 0, discount: 0 }); renderEditItems(); });
  $("#title-input").addEventListener("input", (e) => editState.title = e.target.value);
  $("#date-input").addEventListener("input", (e) => editState.transacted_at = e.target.value);
  $("#save-bill-btn").addEventListener("click", () => saveEditBill(data.bill.id));
}
function renderEditItems() {
  const list = $("div#items-list, #items-list");
  const elList = list && list.length ? list[0] : list;
  if (!elList) return;
  elList.innerHTML = editState.items.map((it, idx) => `
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
    editState.items[+e.target.dataset.idx].name = e.target.value;
  }));
  $$("[data-role=price]", elList).forEach(inp => bindRupiahInput(inp, (v) => {
    editState.items[+inp.dataset.idx].price = v;
    updateEditTotal();
  }));
  $$("[data-role=discount]", elList).forEach(inp => bindRupiahInput(inp, (v) => {
    const it = editState.items[+inp.dataset.idx];
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
    updateEditTotal();
  }));
  $$("[data-role=del]", elList).forEach(btn => btn.addEventListener("click", (e) => {
    editState.items.splice(+e.target.dataset.idx, 1);
    renderEditItems();
    updateEditTotal();
  }));
  $$(".item-mode-btn", elList).forEach(btn => btn.addEventListener("click", () => {
    const it = editState.items[+btn.dataset.idx];
    const mode = btn.dataset.mode;
    it.mode = mode;
    if (mode === "slot" && !it.slot_count) it.slot_count = 2;
    renderEditItems();
  }));
  $$(".slot-inc", elList).forEach(btn => btn.addEventListener("click", () => {
    const it = editState.items[+btn.dataset.idx];
    it.slot_count = Math.min(99, (it.slot_count || 2) + 1);
    renderEditItems();
  }));
  $$(".slot-dec", elList).forEach(btn => btn.addEventListener("click", () => {
    const it = editState.items[+btn.dataset.idx];
    it.slot_count = Math.max(2, (it.slot_count || 2) - 1);
    renderEditItems();
  }));
}

function updateEditTotal() {
  let subtotal = rupiahParse($("#subtotal-input").value);
  let tax = rupiahParse($("#tax-input").value);
  let service = rupiahParse($("#service-input").value);
  const sumItems = editState.items.reduce((s, i) => s + Math.max(0, (i.price || 0) - (i.discount || 0)), 0);
  if (editState.tax_included) {
    subtotal = sumItems;
    const si = $("#subtotal-input"); if (si) si.value = rupiahFmt(subtotal);
    const ti = $("#tax-input"); if (ti) ti.value = "";
    const svi = $("#service-input"); if (svi) svi.value = "";
    tax = 0; service = 0;
  }
  const total = subtotal + tax + service;
  editState.subtotal = subtotal; editState.tax = tax; editState.service = service;
  const td = $("#total-display");
  if (td) td.textContent = fmt(total);
  const badge = $("#tax-included-badge");
  if (badge) badge.classList.toggle("hidden", !editState.tax_included);
  const warn = $("#sum-warn");
  if (warn) {
    if (sumItems !== subtotal) {
      warn.classList.remove("hidden");
      if (editState.tax_included) {
        warn.textContent = `Total item (${fmt(sumItems)}) beda dari Subtotal (${fmt(subtotal)}). Total item ini yang dipakai — cek harga & diskon tiap item.`;
      } else if (sumItems === total) {
        warn.textContent = `Harga item (${fmt(sumItems)}) kayaknya udah TERMASUK pajak, tapi lu isi Subtotal ${fmt(subtotal)} + PPN. Aktifin toggle "Harga item sudah termasuk pajak" biar gak dobel.`;
      } else {
        warn.textContent = `Total item (${fmt(sumItems)}) beda dari subtotal (${fmt(subtotal)}). Cek kolom Diskon tiap item.`;
      }
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
      tax_included: editState.tax_included ? 1 : 0,
      items: items.map(i => ({
        id: i.id,
        name: i.name,
        price: i.price,
        discount: i.discount || 0,
        mode: i.mode === "slot" ? "slot" : "free",
        slot_count: i.mode === "slot" ? (i.slot_count || 2) : null,
      })),
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

function openReopenConfirm(data) {
  const sheet = el(`
    <div class="sheet-overlay" id="reopen-sheet">
      <div class="sheet">
        <div class="sheet-handle"></div>
        <div class="sheet-title">Buka Bill Lagi?</div>
        <p class="muted" style="margin-bottom:16px;">Bill balik ke status aktif. Semua orang bisa milih item, ubah pembagian, dan update status bayar lagi.</p>
        <button class="btn-primary" id="confirm-reopen">Buka Lagi</button>
        <button class="btn-outline" id="cancel-reopen" style="width:100%;margin-top:8px;">Batal</button>
      </div>
    </div>`);
  document.body.appendChild(sheet);
  $("button#cancel-reopen", sheet).addEventListener("click", () => sheet.remove());
  sheet.addEventListener("click", (e) => { if (e.target === sheet) sheet.remove(); });
  $("button#confirm-reopen", sheet).addEventListener("click", async () => {
    try {
      await api(`/api/bills/${data.bill.id}/reopen`, { method: "POST" });
      sheet.remove();
      toast("Bill dibuka lagi ↩️");
      loadBillView(data.bill.id);
    } catch (e) { toast(e.message); }
  });
}

function openCloseConfirm(data) {
  const notPicked = data.people.filter(p => !p.subtotal_idr && p.identity_id !== data.bill.creator_identity_id);
  // "mungkin mau dishare?" — only flag plausible SHARED dishes: exactly one
  // person, qty 1, and expensive enough (>= Rp 50k) to be a platter/pizza/
  // bucket. Personal meals (< 50k) are normal and don't need a warning.
  const singles = (data.sel_by_item && data.people.length > 1
    ? Object.entries(data.sel_by_item).filter(([id, selList]) => {
        if (selList.length !== 1 || selList[0].qty !== 1) return false;
        const it = data.items.find(i => i.id === +id);
        if (!it || (it.mode === "slot" && it.slot_count)) return false; // slot items covered by the empty-slot warning
        const eff = Math.max(0, it.price_idr - (it.discount_idr || 0));
        return eff >= 50000;
      })
    : []);
  const emptySlots = data.uncovered_slots || [];
  const sheet = el(`
    <div class="sheet-overlay" id="close-sheet">
      <div class="sheet">
        <div class="sheet-handle"></div>
        <div class="sheet-title">Tutup Bill?</div>
        <p class="muted" style="margin-bottom:16px;">Setelah ditutup, pembagian jadi final dan gak bisa diubah.</p>
        ${emptySlots.length ? `<div class="warn-box" style="color:var(--red);"><strong>Bagian kosong belum keambil:</strong><ul>
          ${emptySlots.map(u => `<li>${esc(u.name)} — ${u.empty} bagian (${fmt(u.amount_idr)})</li>`).join("")}
        </ul></div>` : ""}
        ${notPicked.length ? `<div class="warn-box"><strong>Belum pilih item:</strong><ul>${notPicked.map(m => `<li>${esc(m.name)}</li>`).join("")}</ul></div>` : ""}
        ${singles.length ? `<div class="warn-box" style="color:var(--red);"><strong>Item gede cuma dicentang 1 orang (kalau mau dishare, minta yang lain centang juga):</strong><ul>
          ${singles.map(([id, selList]) => { const it = data.items.find(i => i.id === +id); return it ? `<li>${esc(it.name)} - ${esc(selList[0].name)} aja</li>` : ""; }).join("")}
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
