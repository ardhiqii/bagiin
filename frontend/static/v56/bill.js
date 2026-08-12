/* Bagiin frontend - bill screens (guest picker, creator summary, sheets) */

// normalized name compare: "Amel" == "amel" == " AMEL "
const normName = (s) => String(s || "").trim().toLowerCase();

// ---------- status ----------
// Closing a bill does NOT make it lunas — the backend stopped forcing
// settled=true on close (bug: every closed bill wore a green "semua lunas"
// chip while unpaid people were listed one scroll below it).
function statusChipHtml(data) {
  if (data.bill.status === "closed") {
    return data.settled
      ? `<span class="chip chip-green">${ic("check")}Ditutup · lunas</span>`
      : `<span class="chip chip-grey">Ditutup · Belum Lunas</span>`;
  }
  if (data.settled) return `<span class="chip chip-green">${ic("check")}Lunas</span>`;
  return `<span class="chip chip-red">Belum lunas</span>`;
}

// honest count of empty slots: uncovered_slots is empty when the leftover has
// no per-item breakdown (fully discounted items), so don't print "? bagian"
// (bug: "Ada ? bagian kosong belum keambil")
function uncoveredNoteHtml(data) {
  if (!(data.uncovered_idr > 0)) return "";
  const n = (data.uncovered_slots || []).reduce((s, u) => s + u.empty, 0);
  const what = n > 0 ? `${n} bagian kosong belum keambil` : "ada bagian yang belum keambil";
  return `<p class="muted" style="margin-top:8px;color:var(--red);">${ic("alert")} ${what} (${fmt(data.uncovered_idr)})</p>`;
}

// ---------- Receipt photo: view / upload ----------
function photoBtnHtml(data) {
  if (data.bill.photo_path) {
    return `<button class="btn-outline btn-sm" id="view-photo-btn" style="width:100%;margin-top:10px;">${ic("receipt")} Liat Struk Asli</button>`;
  }
  // uploading needs management rights, not payer-ness — the backend gates this
  // endpoint on _can_manage (bug: creator who handed the payer role away lost
  // the button on their own bill)
  if (data.can_manage && data.bill.status === "open") {
    return `<button class="btn-outline btn-sm" id="add-photo-btn" style="width:100%;margin-top:10px;">${ic("camera")} Tambah Foto Struk</button>`;
  }
  return "";
}

function openPhotoSheet(bill) {
  const fn = bill.photo_path.split("/").pop();
  const s = openSheet(`
    <div class="sheet-handle"></div>
    <div class="sheet-title">Struk asli</div>
    <img src="/uploads/${encodeURIComponent(fn)}" alt="Foto struk asli bill ini"
         style="width:100%;border-radius:var(--r-sm);" loading="lazy">
    <button class="btn-outline" data-act="close">Tutup</button>`, { noAutofocus: true });
  $('[data-act=close]', s.sheet).addEventListener("click", s.close);
}

function bindPhotoActions(data) {
  const vb = $("#view-photo-btn");
  if (vb) vb.addEventListener("click", () => openPhotoSheet(data.bill));
  const ab = $("#add-photo-btn");
  if (ab) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.className = "hidden";
    // live next to the button so a re-render disposes of it (the old code
    // appended one hidden input to <body> on every render)
    ab.insertAdjacentElement("afterend", input);
    ab.addEventListener("click", () => input.click());
    input.addEventListener("change", async () => {
      const f = input.files[0];
      if (!f) return;
      const fd = new FormData();
      fd.append("file", f);
      await withBusy(ab, "Upload...", async () => {
        try {
          const headers = { "X-Identity-Id": state.identity.id };
          if (state.identity.secret) headers["X-Identity-Secret"] = state.identity.secret;
          const res = await fetch(`/api/bills/${data.bill.id}/photo`, { method: "POST", headers, body: fd });
          if (!res.ok) {
            let m = "Gagal upload";
            try { const d = await res.json(); m = d.detail || m; } catch (e) {}
            throw new Error(m);
          }
          toast("Struk ditambahkan ✓");
          loadBillView(data.bill.id);
        } catch (e) { toast(e.message); }
      });
    });
  }
}

// ---------- helpers ----------
// Find "me" in a sel_by_item list. Identity id is authoritative (duplicate
// names must NEVER misattribute picks); name is only a fallback for legacy
// rows that predate identity ids.
function mySelEntry(selList, me) {
  if (!selList || !me) return null;
  const byId = selList.find(s => s.id === me.id);
  if (byId) return byId;
  // legacy rows without id: match by name, but only when unambiguous
  const sameName = selList.filter(s => normName(s.name) === normName(me.name));
  return sameName.length === 1 ? sameName[0] : null;
}
function othersSel(selList, me) {
  // Mirror mySelEntry's id-authoritative logic (inverted): exclude only me —
  // by id, or by name ONLY for legacy rows that predate identity ids. A
  // DIFFERENT person with the same name but their own id is still "other"
  // (bug: name-based exclusion dropped them, so row text said "1 porsi · Rp
  // 30.000/porsi" while computeMyBreakdown split the price by 2 → two
  // contradicting prices for the same item)
  return (selList || []).filter(s =>
    s.id !== me.id
    && !(s.id == null && normName(s.name) === normName(me.name))
  );
}

// The backend is the authority on money. computeMyBreakdown re-implements the
// split in JS and can only ever be an ESTIMATE, so once the server has spoken
// (page load, or a save response) we render its own row for the viewer.
// (bug: the JS copy skipped free items nobody picked — calc.py hands those to
// the creator, so they stay in the tax denominator — and a guest was shown
// Rp 145.000 for a share the backend priced at Rp 122.500, then transferred
// the bigger number)
function myPersonRow(data, me) {
  if (!data || !me) return null;
  return (data.people || []).find(p => p.identity_id === me.id) || null;
}
function myBreakdown(data, me, selQty) {
  const row = myPersonRow(data, me);
  if (row) return { sub: row.subtotal_idr || 0, tax: row.tax_idr || 0, total: row.total_idr || 0 };
  return computeMyBreakdown(data, selQty || state.selQty || new Map());
}

// Merge a mutating endpoint's payload into the bill object every open screen
// and sheet already holds, so they all read the same settled numbers.
function applyFresh(data, fresh) {
  if (!fresh || !fresh.bill) return data;
  Object.keys(fresh).forEach(k => { data[k] = fresh[k]; });
  state.bill = data;
  return data;
}

// ---------- Bill view ----------
async function loadBillView(billId) {
  const app = $("#app");
  state.currentBillId = billId;
  app.innerHTML = `
    <div class="topbar">
      <div class="sk" style="width:42px;height:42px;border-radius:var(--r-sm);"></div>
      <div class="sk sk-line" style="width:40%;"></div>
      <div style="width:42px;flex-shrink:0;"></div>
    </div>
    <div class="card">
      <div class="sk sk-line" style="width:34%;"></div>
      <div class="sk" style="width:56%;height:32px;margin-top:10px;border-radius:var(--r-xs);"></div>
    </div>
    <div class="card">${skeletonRows(4)}</div>`;
  try {
    const data = await api("/api/bills/" + billId);
    // stale response guard: a slower earlier request must not clobber a newer
    // navigation (rapid taps on people -> parallel loadBillView)
    if (state.currentBillId !== billId) return;
    state.bill = data;
    // who am I?
    if (!state.identity) {
      renderGuestNamePrompt(billId, data);
      return;
    }
    const me = state.identity;
    const myPeople = data.people.filter(p => p.identity_id === me.id);
    // can_manage, never owner_id: owner_id is now "confirmed payer or creator"
    // and no longer tracks who holds the powers (bug: gating on it stranded
    // the creator in the guest view with no share button on their own bill)
    if (data.can_manage) {
      renderCreatorView(data);
    } else if (myPeople.length === 0) {
      // identity exists but hasn't joined this bill yet -> join automatically
      // so the roster + payer-name resolution see them (bug: they were
      // invisible until they picked an item)
      try {
        const fresh = await apiJson("/api/bills/" + billId + "/join", "POST", {});
        if (state.currentBillId !== billId) return;
        renderGuestView(fresh, me);
      } catch (e) {
        // closed bill or join hiccup: guest can still view the final split
        renderGuestView(data, me);
      }
    } else {
      renderGuestView(data, me);
    }
  } catch (e) {
    if (state.currentBillId !== billId) return;
    // a 404 is the only "gak ketemu"; offline / 500 / rate limit are something
    // else entirely and deserve a retry, not a dead end (bug: "Bill gak
    // ketemu" was shown for every failure, including no internet)
    const notFound = e.status === 404;
    app.innerHTML = `
      <div class="card">
        <div class="empty-state">
          ${ic(notFound ? "empty" : "alert")}
          <p style="font-weight:700;color:var(--text);">${notFound ? "Bill gak ketemu" : "Gagal muat bill"}</p>
          <p class="muted">${esc(e.message)}</p>
        </div>
        <div class="btn-row" style="margin-top:4px;">
          ${notFound ? "" : `<button class="btn-primary" id="err-retry">${ic("refresh")} Coba lagi</button>`}
          <button class="btn-outline" id="err-home">Ke Beranda</button>
        </div>
      </div>`;
    const retry = $("#err-retry");
    if (retry) retry.addEventListener("click", () => loadBillView(billId));
    $("#err-home").addEventListener("click", () => location.hash = "#/");
  }
}

function renderGuestNamePrompt(billId, data) {
  const app = $("#app");
  const saved = lsGet(LS_KEYS.name, "");
  app.innerHTML = `
    <div class="topbar">
      <button class="icon-btn ghost" id="guest-back" aria-label="Ke beranda">${ic("back")}</button>
      <div class="topbar-title">Gabung Bill</div>
      <div style="width:42px;flex-shrink:0;"></div>
    </div>
    ${shell(`
      <div class="card">
        <div class="label-sm">Bill</div>
        <div style="font-size:21px;font-weight:800;margin-top:4px;letter-spacing:-.02em;">${esc(data.bill.title)}</div>
        <div class="money hero-total" style="margin-top:6px;">${fmt(data.bill.total_idr)}</div>
        ${data.bill.tax_included ? `<p class="muted" style="color:var(--green);margin-top:6px;">${ic("check")} Harga item sudah termasuk pajak — gak ada PPN tambahan</p>` : ""}
        <p class="muted" style="margin-top:6px;">dibuat oleh ${esc(data.creator_name)}</p>
      </div>
      <div class="card">
        <div class="field" style="margin-bottom:10px;">
          <label for="guest-name">Kamu siapa?</label>
          <input id="guest-name" placeholder="Nama Kamu" value="${esc(saved)}" maxlength="30" autocomplete="off">
        </div>
        <button class="btn-primary" id="guest-go">Lanjut, Milih Item</button>
      </div>`)}`;
  $("#guest-back").addEventListener("click", () => location.hash = "#/");
  const input = $("#guest-name");
  input.focus();
  const go = () => withBusy($("#guest-go"), "Bentar...", async () => {
    const name = input.value.trim();
    if (!name) { toast("Isi nama dulu"); return; }
    try {
      await ensureIdentity(name);
      const fresh = await apiJson("/api/bills/" + billId + "/join", "POST", {});
      renderGuestView(fresh, state.identity);
    } catch (e) {
      // closed bill or join hiccup: guest can still view the final split
      // (bug: without this fallback a nameless guest on a closed bill was
      // stuck at the name prompt forever)
      toast(e.message);
      renderGuestView(data, state.identity);
    }
  });
  $("#guest-go").addEventListener("click", go);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
}

// ---------- Guest view: pick items ----------
function renderGuestView(data, me) {
  const app = $("#app");
  state.bill = data;
  const closed = data.bill.status === "closed";
  const myPeople = data.people.filter(p => p.identity_id === me.id);
  const myPaid = myPeople.length ? myPeople[0].paid === "paid" : false;
  const iAmPayer = data.paid_by_id === me.id;
  const payerName = data.paid_by_name || data.creator_name;

  // build my picks (item_id -> qty) from backend selections
  const mySel = new Map();
  Object.entries(data.sel_by_item || {}).forEach(([itemId, selList]) => {
    const mine = mySelEntry(selList, me);
    if (mine) mySel.set(parseInt(itemId, 10), mine.qty || 1);
  });
  state.selQty = mySel;
  const bd = myBreakdown(data, me, mySel);
  const hasTax = taxServiceTotal(data) > 0 || (data.bill.service_idr || 0) > 0;

  const main = `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">
        <div style="min-width:0;">
          <div class="label-sm">Total bill</div>
          <div class="money hero-total">${fmt(data.bill.total_idr)}</div>
        </div>
        <span>${statusChipHtml(data)}</span>
      </div>
      ${data.bill.merchant ? `<p class="muted" style="margin-top:6px;">${esc(data.bill.merchant)}</p>` : ""}
      ${data.bill.transacted_at ? `<p class="muted">${esc(shortDate(data.bill.transacted_at))}</p>` : ""}
      <p class="muted" style="margin-top:6px;">dibuat oleh ${esc(data.creator_name)}</p>
      ${data.bill.tax_included ? `<p class="muted" style="margin-top:6px;color:var(--green);">${ic("check")} Harga item sudah termasuk pajak — gak ada PPN tambahan</p>` : ""}
      ${photoBtnHtml(data)}
      ${uncoveredNoteHtml(data)}
      ${data.all_paid && !closed ? `<p class="muted" style="margin-top:8px;color:var(--green);">${ic("check")} Semua yang milih item udah lunas 🎉</p>` : ""}
    </div>
    <button class="btn-outline" id="pay-methods-btn" style="margin-bottom:12px;">
      ${ic("wallet")} Metode Bayar ${esc(payerName)}
    </button>
    ${closed ? `
    <div class="info-box">Bill ini udah ditutup. Pembagiannya final dan gak bisa diubah lagi.</div>
    <div class="card card-flat">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
        <div>
          <div class="label-sm">Total kamu</div>
          <div class="money" style="font-size:23px;font-weight:800;">${fmt(bd.total)}</div>
        </div>
        ${iAmPayer
          ? `<span class="chip chip-grey">Kamu yang nalangin</span>`
          : `<span class="chip ${myPaid ? "chip-green" : "chip-red"}">${myPaid ? `${ic("check")} Udah Bayar` : "Belum Bayar"}</span>`}
      </div>
      ${hasTax ? `
      <div class="dock-split" style="margin-top:10px;flex-wrap:wrap;background:var(--surface-3);">
        <span>Item <b class="money-sm">${fmt(bd.sub)}</b></span>
        <span>Pajak &amp; service <b class="money-sm" style="color:var(--accent);">${fmt(bd.tax)}</b></span>
      </div>` : ""}
      ${!iAmPayer && !myPaid ? `
      <p class="muted" style="margin-top:10px;">Status bayar gak bisa diubah lagi di bill yang udah ditutup.
      Kalau kamu udah transfer, kabarin ${esc(payerName)} langsung ya — dia yang bisa nandain.</p>` : ""}
      ${iAmPayer ? `<p class="muted" style="margin-top:10px;">Kamu yang nalangin bill ini, jadi yang lain transfer ke kamu.</p>` : ""}
    </div>` : ""}
    <div class="card">
      <div class="card-title">${closed ? "Item yang kamu tanggung" : "Centang yang kamu tanggung"}</div>
      ${closed ? `<p class="muted" style="margin:-4px 0 8px;">Bill udah ditutup — daftar ini cuma buat dibaca.</p>` : ""}
      <div id="pick-items">${data.items.map(it => itemRowHtml(it, data, mySel, me.name, me, closed)).join("")}</div>
    </div>`;

  // the sticky bar lives in the rail on desktop and the bottom dock on phones
  const side = closed ? "" : `
    <div class="dock"><div class="dock-inner">
      <div class="dock-total">
        <span class="label">Total kamu</span>
        <span class="money" id="my-total">${fmt(bd.total)}</span>
      </div>
      <div class="dock-split" id="my-breakdown" style="flex-wrap:wrap;${hasTax ? "" : "display:none;"}">
        <span>Item <b class="money-sm" id="my-sub">${fmt(bd.sub)}</b></span>
        <span>Pajak &amp; service <b class="money-sm" id="my-tax" style="color:var(--accent);">${fmt(bd.tax)}</b></span>
      </div>
      ${iAmPayer
        ? `<div class="chip chip-grey" style="justify-content:center;padding:10px;">${ic("wallet")} Kamu yang Nalangin Bill Ini</div>`
        : `<button class="${myPaid ? "btn-green" : "btn-primary"}" id="pay-btn">${myPaid ? `${ic("check")} Udah bayar` : "Tandai Udah Bayar"}</button>`}
    </div></div>`;

  app.innerHTML = `
    <div class="topbar">
      <button class="icon-btn ghost" id="back-btn" aria-label="Ke beranda">${ic("back")}</button>
      <div class="topbar-title">${esc(data.bill.title)}</div>
      <div class="right">
        <button class="icon-btn ghost" id="share-btn" aria-label="Bagikan bill">${ic("share")}</button>
      </div>
    </div>
    ${shell(main, side)}`;

  $("#back-btn").addEventListener("click", () => location.hash = "#/");
  $("#share-btn").addEventListener("click", () => shareBill(data.bill.id, data.bill.title));
  $("#pay-methods-btn").addEventListener("click", () => openAccountsSheet(data));
  bindPhotoActions(data);
  bindItemRows(data, me);
  const payBtn = $("#pay-btn");
  if (payBtn) payBtn.addEventListener("click", () => openPaySheet(data, me, myPaid));
  watchDock();
}

function itemRowHtml(it, data, mySel, myName, me, readOnly) {
  const selList = (data.sel_by_item[it.id] || []);
  const mine = mySelEntry(selList, me) || (myName && selList.find(s => !s.id && normName(s.name) === normName(myName)));
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
    ? `<span class="price-was">${fmt(it.price_idr)}</span> <span class="price-now">${fmt(eff)}</span>`
    : fmt(eff);
  // Closed bills render plain rows: no checkbox affordance, no role, no
  // tabindex (bug: rows looked tappable and silently did nothing, because the
  // "Bill sudah ditutup" toast sat behind an early return)
  const a11y = readOnly
    ? ""
    : ` role="checkbox" tabindex="0" aria-checked="${isSel}" aria-label="${esc(it.name)}, ${fmt(eff)}"`;
  return `
    <div class="item-row${isSel ? " selected" : ""}${readOnly ? "" : " item-tappable"}" data-item="${it.id}"${a11y}>
      ${!readOnly || isSel ? `<div class="item-check">${ic("check")}</div>` : ""}
      <div class="item-info">
        <div class="item-name">${esc(it.name)}${isSlot ? ` <span class="slot-badge">Slot</span>` : ""}</div>
        <div class="item-share">${shareText}</div>
      </div>
      <div class="money item-price">${priceHtml}</div>
    </div>`;
}

function bindItemRows(data, me, root) {
  const scope = root || document;
  if (data.bill.status === "closed") return; // rows render read-only, nothing to bind
  $$("#pick-items .item-row", scope).forEach(row => {
    const activate = () => {
      const id = parseInt(row.dataset.item, 10);
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
    };
    row.addEventListener("click", activate);
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") { e.preventDefault(); activate(); }
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

// useServer=true renders the backend's own numbers for my row; false keeps the
// local estimate that bridges the gap between a tap and the response.
function renderPickRows(data, me, useServer) {
  const bd = useServer ? myBreakdown(data, me) : computeMyBreakdown(data, state.selQty);
  const mtEl = $("#my-total");
  if (mtEl) mtEl.textContent = fmt(bd.total);
  const mbEl = $("#my-breakdown");
  if (mbEl) {
    const subEl = $("#my-sub", mbEl);
    const taxEl = $("#my-tax", mbEl);
    if (subEl) subEl.textContent = fmt(bd.sub);
    if (taxEl) taxEl.textContent = fmt(bd.tax);
  }
  $$("#pick-items .item-row").forEach(row => {
    const id = parseInt(row.dataset.item, 10);
    const qty = state.selQty.get(id) || 0;
    const sel = qty > 0;
    row.classList.toggle("selected", sel);
    if (row.hasAttribute("role")) row.setAttribute("aria-checked", sel ? "true" : "false");
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
  // optimistic UI (local estimate only — the server number lands below)
  const prev = new Map(state.selQty);
  renderPickRows(data, me, false);
  // persist — serialize saves so rapid taps can't reorder POSTs (last tap wins)
  const picks = Array.from(state.selQty.entries()).map(([itemId, qty]) => ({ item_id: itemId, qty }));
  try {
    const fresh = await saveSelectionsViaChain(data, picks);
    applyFresh(data, fresh);
    // only trust the server's totals when they answer the picks we still hold;
    // a newer tap made mid-flight has its own response coming
    const stillCurrent = state.selQty.size === picks.length
      && picks.every(p => state.selQty.get(p.item_id) === p.qty);
    renderPickRows(data, me, stillCurrent);
  } catch (e) {
    // rollback on failure so the UI doesn't show picks the backend rejected —
    // but only if the user hasn't made NEW changes while the POST was in
    // flight (rolling back then would erase their newer taps)
    const same = state.selQty.size === prev.size
      && Array.from(prev.entries()).every(([id, q]) => state.selQty.get(id) === q);
    if (same) {
      state.selQty = prev;
      renderPickRows(data, me, false);
    }
    toast(e.message);
  }
}

// ---------- Slot picker sheet (choose how many slots of this item) ----------
function openSlotPickerSheet(data, me, it) {
  const selList = (data.sel_by_item[it.id] || []);
  const othersTaken = othersSel(selList, me).reduce((s, x) => s + (x.qty || 1), 0);
  // live state for my picks (same stale-snapshot bug as free picker: after an
  // optimistic pick the snapshot lacks my row, so release button + empty count
  // were wrong)
  const myQty = state.selQty.get(it.id) || (mySelEntry(selList, me) || {}).qty || 0;
  const max = it.slot_count - othersTaken;
  const leftEmpty = Math.max(0, max - myQty);
  const perSlot = Math.floor(Math.max(0, it.price_idr - (it.discount_idr || 0)) / it.slot_count);
  let qty = myQty || 1;

  const s = openSheet(`
    <div class="sheet-handle"></div>
    <div class="sheet-title">${esc(it.name)}</div>
    <p class="muted">${fmt(perSlot)}/bagian · ${it.slot_count} bagian · ${othersTaken} keambil orang lain</p>
    <p class="muted" style="margin-top:4px;">Item ini dibagi ${it.slot_count} bagian tetap. Kamu bisa ambil lebih dari 1 kalau pesennya lebih dari satu.</p>
    <p class="muted" style="margin:4px 0 14px;">${leftEmpty > 0 ? `Sisa bagian kosong: ${leftEmpty}` : "Bagian udah abis"}</p>
    ${max > 0 ? `
    <div style="display:flex;align-items:center;justify-content:center;gap:20px;margin-bottom:16px;">
      <button class="btn-outline slot-qty-dec" style="width:52px;height:52px;min-height:52px;font-size:22px;border-radius:var(--r-full);padding:0;" aria-label="Kurangi slot">−</button>
      <div style="text-align:center;">
        <div style="font-size:40px;font-weight:800;" class="slot-qty">${qty}</div>
        <div class="muted" style="font-size:12px;">Slot Kamu</div>
      </div>
      <button class="btn-outline slot-qty-inc" style="width:52px;height:52px;min-height:52px;font-size:22px;border-radius:var(--r-full);padding:0;" aria-label="Tambah slot">＋</button>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <span class="label">Total kamu</span>
      <span class="money slot-total" style="font-size:24px;font-weight:800;">${fmt(perSlot * qty)}</span>
    </div>
    <button class="btn-primary" id="slot-confirm">Ambil ${qty} slot</button>` : ""}
    ${myQty > 0 ? `<button class="btn-danger-ghost" id="slot-release">${ic("x")} Lepas Slot (${myQty})</button>` : ""}
    <button class="btn-outline" id="slot-close">${max > 0 ? "Batal" : "Tutup"}</button>`, { noAutofocus: true });

  const sync = () => {
    if (max <= 0) return; // no qty controls rendered when slots are full
    $(".slot-qty", s.sheet).textContent = qty;
    $(".slot-total", s.sheet).textContent = fmt(perSlot * qty);
    $(".slot-qty-inc", s.sheet).disabled = qty >= max;
    $(".slot-qty-dec", s.sheet).disabled = qty <= 1;
    $("#slot-confirm", s.sheet).textContent = `Ambil ${qty} slot`;
  };
  if (max > 0) {
    $(".slot-qty-dec", s.sheet).addEventListener("click", () => { qty = Math.max(1, qty - 1); sync(); });
    $(".slot-qty-inc", s.sheet).addEventListener("click", () => { qty = Math.min(max, qty + 1); sync(); });
    // (bug: no in-flight guard — a double tap fired two POSTs)
    $("#slot-confirm", s.sheet).addEventListener("click", (ev) =>
      withBusy(ev.currentTarget, "Nyimpen...", async () => {
        try {
          const picks = [...state.selQty.entries()].filter(([iid]) => iid !== it.id).map(([iid, q]) => ({ item_id: iid, qty: q }))
            .concat([{ item_id: it.id, qty }]);
          state.selQty.set(it.id, qty);
          await saveSelectionsViaChain(data, picks);
          s.close();
          buzz(20);
          loadBillView(data.bill.id);
        } catch (e) { toast(e.message); }
      }));
  }
  const rel = $("#slot-release", s.sheet);
  if (rel) rel.addEventListener("click", (ev) =>
    withBusy(ev.currentTarget, "Melepas...", async () => {
      try {
        await api(`/api/bills/${data.bill.id}/items/${it.id}/selections/${me.id}`, { method: "DELETE" });
        s.close();
        toast("Slot dilepas ✓");
        loadBillView(data.bill.id);
      } catch (e) { toast(e.message); }
    }));
  $("#slot-close", s.sheet).addEventListener("click", s.close);
  sync();
}

// ---------- Free portion picker sheet (bebas: pick 1+ portions) ----------
function openFreePickerSheet(data, me, it) {
  const selList = (data.sel_by_item[it.id] || []);
  const othersQty = othersSel(selList, me).reduce((s, x) => s + (x.qty || 1), 0);
  // myQty MUST come from live state.selQty, not the backend snapshot: after an
  // optimistic pick the snapshot still lacks my row, so reading it here showed
  // "Belum ada yang ambil" while I already had picks (bug: status + release
  // button both used the stale myQty)
  const myQty = state.selQty.get(it.id) || (mySelEntry(selList, me) || {}).qty || 0;
  // status must count MY picks too — "Belum ada yang ambil" is only true
  // when nobody (including me) picked it (bug: showed "Belum ada" while I
  // already had picks, because othersQty excludes me)
  let statusText;
  if (myQty > 0 && othersQty > 0) statusText = `Kamu ${myQty} porsi · ${othersQty} porsi orang lain`;
  else if (myQty > 0) statusText = `Kamu udah ambil ${myQty} porsi`;
  else if (othersQty > 0) statusText = `${othersQty} porsi keambil orang lain`;
  else statusText = "Belum ada yang ambil item ini";
  const MAX_P = 99;
  let qty = myQty || 1;

  const s = openSheet(`
    <div class="sheet-handle"></div>
    <div class="sheet-title">${esc(it.name)}</div>
    <p class="muted">Pilih bebas — ambil 1 porsi atau lebih kalau pesennya lebih dari satu. Harga dibagi sesuai porsi yang keambil.</p>
    <p class="muted" style="margin:4px 0 14px;">${statusText}</p>
    <div style="display:flex;align-items:center;justify-content:center;gap:20px;margin-bottom:16px;">
      <button class="btn-outline fr-qty-dec" style="width:52px;height:52px;min-height:52px;font-size:22px;border-radius:var(--r-full);padding:0;" aria-label="Kurangi porsi">−</button>
      <div style="text-align:center;">
        <div style="font-size:40px;font-weight:800;" class="fr-qty">${qty}</div>
        <div class="muted" style="font-size:12px;">Porsi Kamu</div>
      </div>
      <button class="btn-outline fr-qty-inc" style="width:52px;height:52px;min-height:52px;font-size:22px;border-radius:var(--r-full);padding:0;" aria-label="Tambah porsi">＋</button>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <span class="label">Estimasi Kamu</span>
      <span class="money fr-total" style="font-size:24px;font-weight:800;">${fmt(perServingEst(it, othersQty, qty) * qty)}</span>
    </div>
    <button class="btn-primary" id="fr-confirm">Simpan ${qty} porsi</button>
    ${myQty > 0 ? `<button class="btn-danger-ghost" id="fr-release">${ic("x")} Lepas Pilihan (${myQty})</button>` : ""}
    <button class="btn-outline" id="fr-close">${myQty > 0 ? "Batal" : "Tutup"}</button>`, { noAutofocus: true });

  const sync = () => {
    $(".fr-qty", s.sheet).textContent = qty;
    $(".fr-total", s.sheet).textContent = fmt(perServingEst(it, othersQty, qty) * qty);
    $(".fr-qty-inc", s.sheet).disabled = qty >= MAX_P;
    $(".fr-qty-dec", s.sheet).disabled = qty <= 1;
    $("#fr-confirm", s.sheet).textContent = `Simpan ${qty} porsi`;
  };
  $(".fr-qty-dec", s.sheet).addEventListener("click", () => { qty = Math.max(1, qty - 1); sync(); });
  $(".fr-qty-inc", s.sheet).addEventListener("click", () => { qty = Math.min(MAX_P, qty + 1); sync(); });
  // (bug: no in-flight guard — a double tap fired two POSTs)
  $("#fr-confirm", s.sheet).addEventListener("click", (ev) =>
    withBusy(ev.currentTarget, "Nyimpen...", async () => {
      try {
        const picks = [...state.selQty.entries()].filter(([iid]) => iid !== it.id).map(([iid, q]) => ({ item_id: iid, qty: q }))
          .concat([{ item_id: it.id, qty }]);
        state.selQty.set(it.id, qty);
        await saveSelectionsViaChain(data, picks);
        s.close();
        buzz(20);
        loadBillView(data.bill.id);
      } catch (e) { toast(e.message); }
    }));
  const rel = $("#fr-release", s.sheet);
  if (rel) rel.addEventListener("click", (ev) =>
    withBusy(ev.currentTarget, "Melepas...", async () => {
      try {
        await api(`/api/bills/${data.bill.id}/items/${it.id}/selections/${me.id}`, { method: "DELETE" });
        s.close();
        toast("Pilihan dilepas ✓");
        loadBillView(data.bill.id);
      } catch (e) { toast(e.message); }
    }));
  $("#fr-close", s.sheet).addEventListener("click", s.close);
  sync();
}

function perServingEst(it, othersQty, myQty) {
  const totalQty = othersQty + myQty;
  const eff = Math.max(0, it.price_idr - (it.discount_idr || 0));
  return totalQty > 0 ? Math.floor(eff / totalQty) : eff;
}

// LOCAL ESTIMATE ONLY — see myBreakdown(). Mirrors backend calc:
// - free item: price / (others + me), rounded like backend (floor + rem)
// - slot item: per-slot price (price // slot_count) * my qty
// - tax proportional to total subtotal across ALL people, rounded down.
function computeMyBreakdown(data, selQty) {
  let sub = 0;
  let totalSelAll = 0;
  const myName = state.identity ? state.identity.name : "";
  const myId = state.identity ? state.identity.id : "";
  const iAmCreator = data.bill.creator_identity_id === myId;
  data.items.forEach(it => {
    const myQty = selQty.get(it.id) || 0;
    if (it.mode === "slot" && it.slot_count) {
      const eff = Math.max(0, it.price_idr - (it.discount_idr || 0));
      const perSlot = Math.floor(eff / it.slot_count);
      if (myQty > 0) sub += perSlot * myQty;
      // total assigned subtotal for tax: all taken slots * perSlot. Use
      // OTHERS from the snapshot + MY LIVE qty — the snapshot lacks my
      // just-added slots after an optimistic tap (bug: all-slot bill + fresh
      // pick → totalSelAll 0 → tax 0 → pay sheet understated the total by the
      // whole tax). Empty slots stay uncovered_idr, never in the tax base.
      const selList = (data.sel_by_item[it.id] || []);
      let othersTaken = 0;
      selList.forEach(s => {
        const isMe = (s.id && s.id === myId) ? true : (!s.id && normName(s.name) === normName(myName));
        if (!isMe) othersTaken += (s.qty || 1);
      });
      const taken = othersTaken + myQty;
      totalSelAll += perSlot * taken;
      return;
    }
    // free item: per-serving split (my qty of total qty taken)
    const selList = (data.sel_by_item[it.id] || []);
    let othersQty = 0;
    selList.forEach(s => {
      const isMe = (s.id && s.id === myId) ? true : (!s.id && normName(s.name) === normName(myName));
      if (!isMe) othersQty += (s.qty || 1);
    });
    const totalQty = othersQty + myQty;
    const eff = Math.max(0, it.price_idr - (it.discount_idr || 0));
    if (myQty > 0 && totalQty > 0) sub += Math.floor(eff / totalQty) * myQty;
    // a free item NOBODY picked still belongs to someone — calc.py hands it to
    // the creator, so it stays in the tax denominator (and in the creator's own
    // subtotal). Dropping it inflated everyone else's tax share (bug: estimate
    // said Rp 145.000, the backend said Rp 122.500, and the number jumped the
    // moment the response landed)
    else if (totalQty === 0 && iAmCreator) sub += eff;
    totalSelAll += eff;
  });
  let taxService = (data.bill.tax_idr || 0) + (data.bill.service_idr || 0);
  if (data.bill.tax_included) taxService = (data.bill.service_idr || 0);
  let tax = 0;
  if (totalSelAll > 0) tax = Math.floor(sub * taxService / totalSelAll);
  return { sub, tax, total: sub + tax };
}

function computeMyTotal(data, selQty) {
  return computeMyBreakdown(data, selQty).total;
}

function taxServiceTotal(data) {
  return (data.bill.tax_idr || 0) + (data.bill.service_idr || 0);
}

// did this identity actually pick something? (subtotal_idr alone lies for
// discount==price items — legal pick, subtotal 0 — bug: "belum pilih item")
function hasPickedAny(data, pid) {
  return Object.values(data.sel_by_item || {}).some(list =>
    list.some(s => s.id === pid));
}

// ---------- Pay sheet (confirm items -> mark paid) ----------
function openPaySheet(data, me, alreadyPaid) {
  const s = openSheet(`
    <div class="sheet-handle"></div>
    <div class="sheet-title">Konfirmasi Item</div>
    <p class="sheet-sub">Ini item yang kamu pilih. Ketuk item buat batalin.</p>
    <div id="pay-items"></div>
    <div id="pay-total"></div>
    <button class="${alreadyPaid ? "btn-green" : "btn-primary"}" id="confirm-pay">
      ${alreadyPaid ? `${ic("check")} Udah bayar` : "Tandai Udah Bayar"}
    </button>
    ${alreadyPaid ? `<button class="btn-danger-ghost" id="undo-pay">${ic("refresh")} Batalin Status Bayar</button>` : ""}
    <button class="btn-outline" id="close-sheet">Batal</button>`, { noAutofocus: true });
  $("#close-sheet", s.sheet).addEventListener("click", s.close);

  const renderItems = () => {
    const items = data.items.filter(it => (state.selQty.get(it.id) || 0) > 0);
    // totals come from the backend's row for me, never the local estimate
    const bd = myBreakdown(data, me);
    const taxService = (data.bill.tax_idr || 0) + (data.bill.service_idr || 0);
    const taxServiceShow = data.bill.tax_included ? (data.bill.service_idr || 0) : taxService;
    const itemsBox = $("#pay-items", s.sheet);
    itemsBox.innerHTML = items.length ? `
      <div class="card card-flat">
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
            // the backend and like computeMyBreakdown — NOT by selector count.
            // Use the LIVE state.selQty for my qty so the row matches the
            // sheet total (bug: stale snapshot made row show full price while
            // the total used the new qty)
            const myLive = state.selQty.get(it.id) || 0;
            const othersN = othersSel(data.sel_by_item[it.id], me).reduce((x, y) => x + (y.qty || 1), 0);
            const n = Math.max(1, othersN + myLive);
            myPrice = n > 1 ? Math.floor(eff / n) * myLive : eff;
            shareNote = n > 1 ? `dibagi ${n} porsi` : "";
          }
          return `
          <div class="pay-item" data-item="${it.id}">
            <div style="flex:1;min-width:0;">${esc(it.name)}${shareNote ? ` <span class="muted">· ${shareNote}</span>` : ""}</div>
            <div style="text-align:right;flex-shrink:0;">
              <div class="money">${fmt(myPrice)}</div>
              ${it.discount_idr > 0 ? `<div class="muted" style="font-size:11px;">diskon ${fmt(it.discount_idr)} · dari ${fmt(it.price_idr)}</div>` : (it.mode !== "slot" && (data.sel_by_item[it.id] || []).length > 1 ? `<div class="muted" style="font-size:11px;">dari ${fmt(eff)}</div>` : "")}
            </div>
            <span class="pay-item-x" aria-hidden="true">${ic("x")}</span>
          </div>`;
        }).join("")}
        <div class="break-row" style="margin-top:8px;">
          <span class="muted">Subtotal Item</span>
          <span class="money">${fmt(bd.sub)}</span>
        </div>
        ${taxServiceShow > 0 ? `
        <div class="break-row">
          <span class="muted">Pajak &amp; service <span class="label-sm" style="text-transform:none;">(PPN ${fmt(data.bill.tax_idr || 0)} + SC ${fmt(data.bill.service_idr || 0)})</span></span>
          <span class="money">${fmt(bd.tax)}</span>
        </div>` : ""}
      </div>`
      : `<div class="card card-flat" style="text-align:center;color:var(--text-3);font-size:14px;">Belum ada item dipilih</div>`;
    $("#pay-total", s.sheet).innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin-bottom:8px;">
        <span class="label">Total kamu</span>
        <span class="money" style="font-size:30px;font-weight:800;letter-spacing:-.02em;">${fmt(bd.total)}</span>
      </div>`;
    $$(".pay-item", itemsBox).forEach(row => row.addEventListener("click", async () => {
      const id = parseInt(row.dataset.item, 10);
      const it = data.items.find(x => x.id === id);
      if (it && it.mode === "slot" && it.slot_count) {
        s.close();
        openSlotPickerSheet(data, me, it);
        return;
      }
      if (state.selQty.has(id)) state.selQty.delete(id);
      else state.selQty.set(id, 1);
      // wait for the save to settle before repainting the sheet, otherwise a
      // rejected change rolls the rows back behind the overlay while the sheet
      // keeps showing items and a total the backend never agreed to
      // (bug: stale sheet after a failed POST)
      await updateGuestSelection(data, me);
      renderItems();
    }));
    $("#confirm-pay", s.sheet).disabled = items.length === 0;
  };

  renderItems();
  $("#confirm-pay", s.sheet).addEventListener("click", (ev) =>
    withBusy(ev.currentTarget, "Nyimpen...", async () => {
      try {
        await api(`/api/bills/${data.bill.id}/payments/${me.id}/paid`, { method: "POST" });
        buzz(20);
        s.close();
        toast("Udah dicatat! 🎉");
        loadBillView(data.bill.id);
      } catch (e) { toast(e.message); }
    }));
  const undoBtn = $("#undo-pay", s.sheet);
  if (undoBtn) undoBtn.addEventListener("click", (ev) =>
    withBusy(ev.currentTarget, "Bentar...", async () => {
      try {
        await api(`/api/bills/${data.bill.id}/payments/${me.id}/unpaid`, { method: "POST" });
        buzz(10);
        s.close();
        toast("Status bayar dibatalin");
        loadBillView(data.bill.id);
      } catch (e) { toast(e.message); }
    }));
}

// ---------- Accounts sheet (standalone payment methods) ----------
function openAccountsSheet(data) {
  const payerName = data.paid_by_name || data.creator_name;
  // Only fall back to the creator's accounts when the creator IS the payer
  // (or no payer is declared yet). A resolved payer who hasn't added any
  // payment method must NOT show the creator's accounts (bug: 'Metode bayar
  // amel' was listing Aufa's GoPay/Mandiri/Jago because paid_by_accounts was
  // empty and the sheet silently fell back to creator_accounts).
  const isCreatorPayer = data.paid_by_id === data.bill.creator_identity_id
    || (!data.paid_by_id && !data.paid_by_name);
  const accounts = (data.paid_by_accounts && data.paid_by_accounts.length)
    ? data.paid_by_accounts
    : (isCreatorPayer ? (data.creator_accounts || []) : []);
  const s = openSheet(`
    <div class="sheet-handle"></div>
    <div class="sheet-title">Metode Bayar ${esc(payerName)}</div>
    <p class="sheet-sub">Transfer langsung ke ${esc(payerName)} lewat:</p>
    ${accounts.length ? accounts.map(a => `
      <div class="account-row">
        ${brandChipHtml(a.brand)}
        <div style="flex:1;min-width:0;">
          <div style="font-weight:600;font-size:14px;">${esc(a.brand)}</div>
          <div class="muted" style="font-size:13px;">${esc(a.account_no)}${a.holder_name ? " · " + esc(a.holder_name) : ""}</div>
        </div>
        <button class="btn-outline btn-sm copy-acct" data-no="${esc(a.account_no)}" aria-label="Salin nomor ${esc(a.brand)}">${ic("copy")} Salin</button>
      </div>`).join("")
      : `<div class="card card-flat"><div class="muted">${esc(payerName)} belum nambah metode bayar. Minta nomor rekening/e-money-nya langsung ya.</div></div>`}
    <button class="btn-outline" id="close-sheet">Tutup</button>`, { noAutofocus: true });
  $$(".copy-acct", s.sheet).forEach(b => b.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(b.dataset.no); toast("Nomor disalin 📋"); }
    catch (e) { toast("Gagal salin, copy manual ya"); }
  }));
  $("#close-sheet", s.sheet).addEventListener("click", s.close);
}

// ---------- Creator view: summary ----------
function renderCreatorView(data) {
  const app = $("#app");
  const me = state.identity;
  const closed = data.bill.status === "closed";
  const payerId = data.paid_by_id;
  const payerName = data.paid_by_name || data.creator_name;
  // The payer is force-marked paid because they fronted the money — counting
  // that as "dibayar" made a brand-new untouched bill announce "✓ Rp 245.000
  // dibayar" when nobody had transferred a rupiah (bug: fake payment total)
  const totalPaid = data.people
    .filter(p => p.paid === "paid" && p.identity_id !== payerId)
    .reduce((s, p) => s + p.total_idr, 0);
  const totalUnpaid = data.people.filter(p => p.paid !== "paid").reduce((s, p) => s + p.total_idr, 0);
  const payerRow = data.people.find(p => p.identity_id === payerId);
  const notPicked = data.people.filter(p => !p.subtotal_idr && !hasPickedAny(data, p.identity_id) && p.identity_id !== me.id);

  // status chip: all_paid, NOT settled — settled folds in uncovered slots and
  // a closed bill is no longer settled by fiat (bug: "semua lunas" on a closed
  // bill with unpaid people right below it)
  let statusChip;
  if (data.all_paid && data.uncovered_idr === 0) {
    statusChip = `<span class="chip chip-green">${ic("check")} Semua Lunas</span>`;
  } else if (totalUnpaid > 0) {
    statusChip = `<span class="chip chip-red">${fmt(totalUnpaid)} belum lunas</span>`;
  } else if (data.uncovered_idr > 0) {
    statusChip = `<span class="chip chip-red">${fmt(data.uncovered_idr)} belum keambil</span>`;
  } else {
    statusChip = `<span class="chip chip-grey">Belum ada yang milih</span>`;
  }
  const closedNotSettled = closed && (totalUnpaid > 0 || data.uncovered_idr > 0);

  // consolidated "perhatian" rows (single card, one row each)
  const warnRows = [];
  if (data.uncovered_slots.length) {
    warnRows.push({
      icon: "slot",
      // per_slot × empty != amount when eff % slot_count has a remainder —
      // show the honest total instead of misleading arithmetic
      text: `Bagian kosong belum keambil: ${data.uncovered_slots.map(u => `${esc(u.name)} (${u.empty} bagian kosong = ${fmt(u.amount_idr)})`).join(", ")}`,
      red: true,
    });
  }
  if (data.warnings.length) {
    // esc() the whole joined string: warnings embed user-typed item names.
    // Skip "Bagian kosong: ..." — already shown as its own slot row above.
    // Backend formats with Python's US comma ("Rp 45,000") — normalize to
    // Indonesian dots; ASCII arrow -> real arrow (bug: double info + wrong
    // thousands separator)
    const dedup = data.warnings
      .filter(w => !w.startsWith("Bagian kosong:"))
      .join(" · ")
      .replace(/(\d),(\d{3})/g, "$1.$2")
      .replace(/->/g, "→");
    if (dedup) warnRows.push({ icon: "receipt", text: esc(dedup) });
  }
  if (notPicked.length) {
    warnRows.push({ icon: "pencil", text: `Belum pilih item: ${notPicked.map(m => esc(m.name)).join(", ")}` });
  }
  const warnHtml = warnRows.length ? `
    <div class="warn-card">
      ${warnRows.map(w => `<div class="warn-row${w.red ? " is-red" : ""}"${w.red ? ` style="color:var(--red);"` : ""}>${ic(w.icon)}<span>${w.text}</span></div>`).join("")}
    </div>` : "";

  const main = `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">
        <div style="min-width:0;">
          <div class="label-sm">Total bill</div>
          <div class="money hero-total">${fmt(data.bill.total_idr)}</div>
        </div>
        <span>${statusChipHtml(data)}</span>
      </div>
      ${data.bill.merchant ? `<div class="muted" style="margin-top:4px;">${esc(data.bill.merchant)}</div>` : ""}
      ${data.bill.transacted_at ? `<div class="muted">${esc(shortDate(data.bill.transacted_at))}</div>` : ""}
      ${data.bill.tax_included ? `<div class="muted" style="margin-top:4px;color:var(--green);">${ic("check")} Harga item sudah termasuk pajak — gak ada PPN tambahan</div>` : ""}
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;">
        <span class="chip ${totalPaid > 0 ? "chip-green" : "chip-grey"}">${totalPaid > 0 ? ic("check") : ""}${fmt(totalPaid)} udah masuk</span>
        ${statusChip}
      </div>
      ${closedNotSettled ? `<p class="muted" style="margin-top:8px;color:var(--red);">${ic("alert")} Bill udah ditutup tapi ${totalUnpaid > 0 ? `masih ada ${fmt(totalUnpaid)} yang belum lunas` : `masih ada ${fmt(data.uncovered_idr)} bagian yang gak keambil`}. Buka lagi kalau mau dibenerin.</p>` : ""}
      ${photoBtnHtml(data)}
      ${uncoveredNoteHtml(data)}
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:12px;">
        <span class="muted">Yang nalangin: <strong style="color:var(--text);">${esc(payerName)}</strong>${payerRow && payerRow.total_idr > 0 ? ` · bagian dia ${fmt(payerRow.total_idr)}` : ""}</span>
        ${!closed ? `<button class="btn-outline btn-sm" id="set-payer-btn" style="flex-shrink:0;">${ic("pencil")} Ubah</button>` : ""}
      </div>
      <button class="btn-outline btn-sm" id="pay-methods-btn" style="width:100%;margin-top:10px;">
        ${ic("wallet")} Metode Bayar ${esc(payerName)}
      </button>
    </div>
    ${warnHtml}
    <div class="card">
      <div class="card-title">Pembagian <span class="muted">(${data.people.length} orang)</span></div>
      <div id="people-list">
        ${data.people.map(p => {
          const isMe = p.identity_id === me.id;
          const isPayer = p.identity_id === payerId;
          const paid = p.paid === "paid";
          const sub = (p.subtotal_idr || hasPickedAny(data, p.identity_id))
            ? (p.subtotal_idr
              ? `${fmt(p.subtotal_idr)} item · ${fmt(p.tax_idr)} pajak`
              : `item gratis · ${fmt(p.tax_idr)} pajak`)
            : "belum pilih item";
          // the payer never "bayar" themselves — they fronted the money
          const statusHtml = isPayer
            ? `<span class="chip chip-grey">${ic("wallet")} Nalangin</span>`
            : (!closed
              ? `<button class="${paid ? "btn-sm" : "btn-outline btn-sm"} toggle-paid" data-id="${esc(p.identity_id)}" data-name="${esc(p.name)}" data-paid="${paid ? "1" : "0"}"
                   style="${paid ? "background:var(--green-soft);color:var(--green);border:1px solid color-mix(in srgb, var(--green) 28%, transparent);" : ""}">${paid ? `${ic("check")} Lunas` : "Tandai Lunas"}</button>`
              : `<span class="chip ${paid ? "chip-green" : "chip-red"}">${paid ? `${ic("check")} Lunas` : "Belum lunas"}</span>`);
          return `
          <div class="person-row">
            <div class="avatar${isMe ? " avatar-me" : ""}">${esc(initials(p.name))}</div>
            <div class="person-info">
              <div class="person-name">${esc(p.name)}${isMe ? ' <span class="muted">(kamu)</span>' : ""}</div>
              <div class="person-sub">${sub}</div>
            </div>
            <div class="person-right">
              <div class="money person-total">${fmt(p.total_idr)}</div>
              ${statusHtml}
            </div>
            ${!closed && !isMe ? `
              <span aria-hidden="true" style="width:1px;align-self:stretch;background:var(--border);margin-left:8px;flex-shrink:0;"></span>
              <button class="person-remove remove-person" style="width:38px;height:38px;" data-id="${esc(p.identity_id)}" data-name="${esc(p.name)}" aria-label="Hapus ${esc(p.name)} dari bill">${ic("trash")}</button>` : ""}
          </div>`;
        }).join("")}
      </div>
    </div>
    <div class="card">
      <div class="card-title">Item &amp; Siapa yang Pilih</div>
      ${!closed ? `<div class="btn-row" style="margin-bottom:10px;">
        <button class="btn-outline btn-sm" id="pick-mine-btn">${ic("hand")} Pilih Item Kamu</button>
        <button class="btn-outline btn-sm" id="edit-bill-btn">${ic("pencil")} Edit Bill</button>
      </div>` : ""}
      ${data.items.map(it => {
        const selList = (data.sel_by_item[it.id] || []);
        const isSlot = it.mode === "slot" && it.slot_count;
        const eff = Math.max(0, it.price_idr - (it.discount_idr || 0));
        const priceHtml = it.discount_idr > 0
          ? `<span class="price-was">${fmt(it.price_idr)}</span> <span class="price-now">${fmt(eff)}</span>`
          : fmt(eff);
        let shareText;
        if (isSlot) {
          const perSlot = Math.floor(eff / it.slot_count);
          const taken = selList.reduce((s, x) => s + (x.qty || 1), 0);
          const empty = Math.max(0, it.slot_count - taken);
          shareText = `${taken}/${it.slot_count} bagian · ${fmt(perSlot)}/bagian`
            + (selList.length ? ` · ${selList.map(s => `${esc(s.name)}${(s.qty || 1) > 1 ? ` ×${s.qty}` : ""}`).join(", ")}` : "")
            + (empty > 0 ? ` · <span style="color:var(--red);">${empty} kosong</span>` : "");
        } else {
          shareText = selList.length ? selList.map(s => `${esc(s.name)}${(s.qty || 1) > 1 ? ` ×${s.qty}` : ""}`).join(", ") : "belum dipilih";
        }
        return `
        <div class="item-row">
          <div class="item-info">
            <div class="item-name">${esc(it.name)}${isSlot ? ` <span class="slot-badge">Slot</span>` : ""}</div>
            <div class="item-share">${shareText}</div>
          </div>
          <div class="money item-price">${priceHtml}</div>
          ${!closed && isSlot ? `<button class="icon-btn slot-mgr" data-item="${it.id}" aria-label="Atur bagian ${esc(it.name)}" style="margin-left:8px;">${ic("slot")}</button>` : ""}
        </div>`;
      }).join("")}
    </div>
    <button class="btn-danger-ghost" id="delete-bill-btn">${ic("trash")} Hapus Bill</button>`;

  const side = `
    <div class="dock"><div class="dock-inner">
      <div class="dock-total">
        <span class="label">${data.all_paid && data.uncovered_idr === 0 ? "Semua" : "Belum lunas"}</span>
        <span class="money" id="my-total">${data.all_paid && data.uncovered_idr === 0 ? "Lunas" : fmt(totalUnpaid + data.uncovered_idr)}</span>
      </div>
      <div class="dock-split" style="flex-wrap:wrap;">
        <span>Udah masuk <b class="money-sm">${fmt(totalPaid)}</b></span>
        <span>${data.people.length} orang</span>
      </div>
      ${!closed
        ? `<button class="btn-primary" id="close-bill-btn">Tutup Bill</button>`
        : `<button class="btn-outline" id="reopen-bill-btn" style="color:var(--accent);border-color:var(--accent);">${ic("refresh")} Buka Bill Lagi</button>`}
    </div></div>`;

  app.innerHTML = `
    <div class="topbar">
      <button class="icon-btn ghost" id="back-btn" aria-label="Ke beranda">${ic("back")}</button>
      <div class="topbar-title">${esc(data.bill.title)}</div>
      <div class="right">
        <button class="icon-btn ghost" id="share-btn" aria-label="Bagikan bill">${ic("share")}</button>
      </div>
    </div>
    ${shell(main, side)}`;

  $("#back-btn").addEventListener("click", () => location.hash = "#/");
  $("#share-btn").addEventListener("click", () => shareBill(data.bill.id, data.bill.title));
  bindPhotoActions(data);
  const pickBtn = $("#pick-mine-btn");
  if (pickBtn) pickBtn.addEventListener("click", () => renderCreatorPick(data));
  const setPayerBtn = $("#set-payer-btn");
  if (setPayerBtn) setPayerBtn.addEventListener("click", () => openSetPayerSheet(data));
  const methodsBtn = $("#pay-methods-btn");
  if (methodsBtn) methodsBtn.addEventListener("click", () => openAccountsSheet(data));
  const editBtn = $("#edit-bill-btn");
  if (editBtn) editBtn.addEventListener("click", () => renderEditBill(data));
  const closeBtn = $("#close-bill-btn");
  if (closeBtn) closeBtn.addEventListener("click", () => openCloseConfirm(data));
  const reopenBtn = $("#reopen-bill-btn");
  if (reopenBtn) reopenBtn.addEventListener("click", () => openReopenConfirm(data));
  $$(".slot-mgr").forEach(b => b.addEventListener("click", () => {
    const it = data.items.find(x => x.id === parseInt(b.dataset.item, 10));
    if (it) openSlotManagerSheet(data, it);
  }));
  $$(".remove-person").forEach(b => b.addEventListener("click", () =>
    openRemovePersonConfirm(data, b.dataset.id, b.dataset.name)));
  $$(".toggle-paid").forEach(b => b.addEventListener("click", () => togglePaidByCreator(data, b)));
  $("#delete-bill-btn").addEventListener("click", () => openDeleteBillConfirm(data.bill.id, data.bill.title));
  watchDock();
}

// ---------- Creator toggles someone's paid status ----------
async function togglePaidByCreator(data, btn) {
  const identityId = btn.dataset.id;
  const name = btn.dataset.name;
  const currentlyPaid = btn.dataset.paid === "1";
  const action = currentlyPaid ? "unpaid" : "paid";
  // disable while in flight so a fast double-tap can't fire two racing POSTs
  // that end up toggling twice (bug: paid + unpaid raced, last one won,
  // status ended opposite of what was tapped)
  await withBusy(btn, "Bentar...", async () => {
    try {
      await api(`/api/bills/${data.bill.id}/payments/${identityId}/${action}`, { method: "POST" });
      toast(currentlyPaid ? `${name} dibatalin lunasnya` : `${name} ditandai lunas ✓`);
      loadBillView(data.bill.id);
    } catch (e) { toast(e.message); }
  });
}

// ---------- Slot manager (creator): change N / free slots ----------
function openSlotManagerSheet(data, it) {
  const selList = (data.sel_by_item[it.id] || []);
  const taken = selList.reduce((s, x) => s + (x.qty || 1), 0);
  const eff = Math.max(0, it.price_idr - (it.discount_idr || 0));
  const perSlot = Math.floor(eff / it.slot_count);
  let n = it.slot_count;
  const s = openSheet(`
    <div class="sheet-handle"></div>
    <div class="sheet-title">Atur bagian: ${esc(it.name)}</div>
    <p class="sheet-sub">${it.discount_idr > 0 ? `<s style="opacity:.5">${fmt(it.price_idr)}</s> → ${fmt(eff)}` : fmt(eff)} · ${fmt(perSlot)}/bagian · ${taken}/${n} keambil</p>
    <div style="display:flex;align-items:center;justify-content:center;gap:20px;margin-bottom:12px;">
      <button class="btn-outline mgr-dec" style="width:52px;height:52px;min-height:52px;font-size:22px;border-radius:var(--r-full);padding:0;" aria-label="Kurangi bagian">−</button>
      <div style="text-align:center;">
        <div style="font-size:40px;font-weight:800;" class="mgr-n">${n}</div>
        <div class="muted" style="font-size:12px;">Total Bagian</div>
      </div>
      <button class="btn-outline mgr-inc" style="width:52px;height:52px;min-height:52px;font-size:22px;border-radius:var(--r-full);padding:0;" aria-label="Tambah bagian">＋</button>
    </div>
    <p class="muted" style="margin-bottom:6px;">Minimal ${taken} bagian (yang udah keambil). Harga per bagian ngikut total bagian.</p>
    <button class="btn-primary" id="mgr-save">Simpan</button>
    ${selList.length ? `<div class="label-sm" style="margin:16px 0 4px;">Pemegang Bagian</div>` : ""}
    ${selList.map(p => `
      <div class="account-row">
        <div style="flex:1;min-width:0;">${esc(p.name)} <span class="muted">×${p.qty || 1}</span></div>
        <button class="btn-outline btn-sm mgr-free" data-id="${esc(p.id || "")}" data-name="${esc(p.name)}"
                style="color:var(--red);" aria-label="Lepas bagian ${esc(p.name)}">Lepas</button>
      </div>`).join("")}
    <button class="btn-outline" id="mgr-close">Tutup</button>`, { noAutofocus: true });

  const sync = () => {
    $(".mgr-n", s.sheet).textContent = n;
    $(".mgr-dec", s.sheet).disabled = n <= taken;
  };
  $(".mgr-dec", s.sheet).addEventListener("click", () => { n = Math.max(taken, n - 1); sync(); });
  $(".mgr-inc", s.sheet).addEventListener("click", () => { n = Math.min(99, n + 1); sync(); });
  // (bug: no in-flight guard — a double tap fired two PUTs)
  $("#mgr-save", s.sheet).addEventListener("click", (ev) =>
    withBusy(ev.currentTarget, "Nyimpen...", async () => {
      try {
        await apiJson(`/api/bills/${data.bill.id}/items/${it.id}/slots`, "PUT", { slot_count: n });
        s.close();
        toast("Bagian diupdate ✓");
        loadBillView(data.bill.id);
      } catch (e) { toast(e.message); }
    }));
  $$(".mgr-free", s.sheet).forEach(b => b.addEventListener("click", async () => {
    // styled sheet instead of native confirm(), which can't be themed and
    // showed raw "&amp;" entities for escaped names
    const ok = await confirmSheet({
      title: `Lepas bagian ${b.dataset.name}?`,
      body: `Bagiannya di <strong>${esc(it.name)}</strong> balik jadi kosong dan bisa diambil orang lain.`,
      confirmText: "Lepas",
      danger: true,
    });
    if (!ok) return;
    await withBusy(b, "Melepas...", async () => {
      try {
        await api(`/api/bills/${data.bill.id}/items/${it.id}/selections/${b.dataset.id}`, { method: "DELETE" });
        s.close();
        toast("Bagian dilepas ✓");
        loadBillView(data.bill.id);
      } catch (e) { toast(e.message); }
    });
  }));
  $("#mgr-close", s.sheet).addEventListener("click", s.close);
  sync();
}

// ---------- Set payer (who fronted the money) ----------
function openSetPayerSheet(data) {
  // roster = people with a share + everyone who joined (participants). The
  // payer themselves often has no share (fronted the bill, picked nothing) —
  // they must still be selectable, or switching the payer becomes one-way.
  const seen = new Set();
  const roster = [];
  (data.people || []).forEach(p => {
    if (!seen.has(p.identity_id)) { seen.add(p.identity_id); roster.push(p); }
  });
  (data.participants || []).forEach(p => {
    if (p.identity_id && !seen.has(p.identity_id)) { seen.add(p.identity_id); roster.push(p); }
  });
  const s = openSheet(`
    <div class="sheet-handle"></div>
    <div class="sheet-title">Siapa yang nalangin bill ini?</div>
    <p class="sheet-sub">Yang dipilih dianggap udah lunas otomatis (dia yang keluar duit duluan), dan metode bayar yang ditampilin ke orang lain pake akun dia.</p>
    <div style="display:flex;flex-direction:column;gap:8px;">
      <button class="btn-outline payer-opt" data-id="${esc(data.bill.creator_identity_id)}" data-name="${esc(data.creator_name)}" style="text-align:left;justify-content:flex-start;">
        ${data.paid_by_id === data.bill.creator_identity_id ? ic("check") : ""}<strong>${esc(data.creator_name)}</strong>
        <span class="muted">(${state.identity && data.bill.creator_identity_id === state.identity.id ? "kamu, pembuat" : "pembuat"})</span>
      </button>
      ${roster.filter(p => p.identity_id !== data.bill.creator_identity_id).map(p => `
        <button class="btn-outline payer-opt" data-id="${esc(p.identity_id)}" data-name="${esc(p.name)}" style="text-align:left;justify-content:flex-start;">
          ${data.paid_by_id === p.identity_id ? ic("check") : ""}<strong>${esc(p.name)}</strong>
        </button>`).join("")}
    </div>
    <div style="height:1px;background:var(--border);margin:14px 0;"></div>
    <label for="payer-name-input">Atau ketik nama (buat yang belum join)</label>
    <input id="payer-name-input" placeholder="Nama Yang Nalangin" value="${esc(data.paid_by_name || "")}" maxlength="30" autocomplete="off">
    <button class="btn-primary" id="payer-name-save">Pakai Nama Ini</button>
    <button class="btn-outline" id="payer-cancel">Batal</button>`, { noAutofocus: true });

  const savePayer = (btn, body, name) => withBusy(btn, "Nyimpen...", async () => {
    try {
      await apiJson(`/api/bills/${data.bill.id}/paid_by`, "PUT", body);
      s.close();
      toast(`${name} ditandai yang nalangin ✓`);
      loadBillView(data.bill.id);
    } catch (e) { toast(e.message); }
  });
  // (bug: no in-flight guard — tapping two people fired two racing PUTs)
  $$(".payer-opt", s.sheet).forEach(b => b.addEventListener("click", () =>
    savePayer(b, { identity_id: b.dataset.id }, b.dataset.name)));
  const nameInput = $("#payer-name-input", s.sheet);
  const saveBtn = $("#payer-name-save", s.sheet);
  nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") saveBtn.click(); });
  saveBtn.addEventListener("click", () => {
    const name = nameInput.value.trim();
    if (!name) { toast("Isi nama dulu"); return; }
    savePayer(saveBtn, { name }, name);
  });
  $("#payer-cancel", s.sheet).addEventListener("click", s.close);
}

// ---------- Remove person confirm ----------
function openRemovePersonConfirm(data, identityId, name) {
  const s = openSheet(`
    <div class="sheet-handle"></div>
    <div class="sheet-title">Hapus ${esc(name)}?</div>
    <p class="sheet-sub">Item yang dia pilih, status bayar, dan catatannya di bill ini ikut kehapus. Cocok buat yang salah join atau dobel.</p>
    <button class="btn-danger" id="confirm-remove">Hapus</button>
    <button class="btn-outline" id="cancel-remove">Batal</button>`, { noAutofocus: true });
  $("#cancel-remove", s.sheet).addEventListener("click", s.close);
  // (bug: no in-flight guard — a double tap fired two DELETEs)
  $("#confirm-remove", s.sheet).addEventListener("click", (ev) =>
    withBusy(ev.currentTarget, "Menghapus...", async () => {
      try {
        await apiJson(`/api/bills/${data.bill.id}/people/${identityId}`, "DELETE", {});
        s.close();
        toast(`${name} dihapus dari bill`);
        loadBillView(data.bill.id);
      } catch (e) { toast(e.message); }
    }));
}

// ---------- Delete bill confirm ----------
// onDone lets a caller (history list) refresh in place instead of navigating.
function openDeleteBillConfirm(billId, title, onDone) {
  const s = openSheet(`
    <div class="sheet-handle"></div>
    <div class="sheet-title">Hapus bill ini?</div>
    <p class="sheet-sub"><strong style="color:var(--text);">${esc(title)}</strong> — semua item, pembagian, dan catatan bayar di bill ini bakal kehapus permanen.</p>
    <p class="sheet-sub">Gak bisa dibatalin. Orang lain yang udah join juga gak bakal bisa liat bill ini lagi.</p>
    <button class="btn-danger" id="confirm-delete-bill">Hapus Selamanya</button>
    <button class="btn-outline" id="cancel-delete-bill">Batal</button>`, { noAutofocus: true });
  $("#cancel-delete-bill", s.sheet).addEventListener("click", s.close);
  // (bug: no in-flight guard — a double tap fired two DELETEs)
  $("#confirm-delete-bill", s.sheet).addEventListener("click", (ev) =>
    withBusy(ev.currentTarget, "Menghapus...", async () => {
      try {
        await api(`/api/bills/${billId}`, { method: "DELETE" });
        s.close();
        toast("Bill dihapus 🗑️");
        if (onDone) { onDone(); return; }
        // assigning the SAME hash fires no hashchange, so the screen never
        // repainted and the deleted row stayed on it (bug: ghost row)
        if (location.hash === "#/" || location.hash === "") render();
        else location.hash = "#/";
      } catch (e) { toast(e.message); }
    }));
}

// ---------- Creator pick mode: pick your own items ----------
function renderCreatorPick(data) {
  const app = $("#app");
  const me = state.identity;
  state.bill = data;
  // build my picks (item_id -> qty) for creator
  const mySel = new Map();
  Object.entries(data.sel_by_item || {}).forEach(([itemId, selList]) => {
    const mine = mySelEntry(selList, me);
    if (mine) mySel.set(parseInt(itemId, 10), mine.qty || 1);
  });
  state.selQty = mySel;
  const bd = myBreakdown(data, me, mySel);
  const hasTax = taxServiceTotal(data) > 0;

  const main = `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">
        <div style="min-width:0;">
          <div class="label-sm">Total bill</div>
          <div class="money hero-total">${fmt(data.bill.total_idr)}</div>
        </div>
        <span class="chip chip-accent">Kamu pembuat</span>
      </div>
      ${data.bill.merchant ? `<p class="muted" style="margin-top:6px;">${esc(data.bill.merchant)}</p>` : ""}
      <p class="muted" style="margin-top:8px;">Ketuk item yang kamu tanggung. Item slot bisa diambil lebih dari 1 bagian. Item bebas yang gak dicentang siapa-siapa masuk ke kamu; bagian slot yang kosong tetep keliatan buat diambil.</p>
    </div>
    <div class="card">
      <div class="card-title">Centang yang kamu tanggung</div>
      <div id="pick-items">${data.items.map(it => itemRowHtml(it, data, mySel, me.name, me, false)).join("")}</div>
    </div>`;

  const side = `
    <div class="dock"><div class="dock-inner">
      <div class="dock-total">
        <span class="label">Total kamu</span>
        <span class="money" id="my-total">${fmt(bd.total)}</span>
      </div>
      <div class="dock-split" id="my-breakdown" style="flex-wrap:wrap;${hasTax ? "" : "display:none;"}">
        <span>Item <b class="money-sm" id="my-sub">${fmt(bd.sub)}</b></span>
        <span>Pajak &amp; service <b class="money-sm" id="my-tax" style="color:var(--accent);">${fmt(bd.tax)}</b></span>
      </div>
      <button class="btn-primary" id="done-btn">Selesai</button>
    </div></div>`;

  app.innerHTML = `
    <div class="topbar">
      <button class="icon-btn ghost" id="back-btn" aria-label="Balik ke ringkasan bill">${ic("back")}</button>
      <div class="topbar-title">${esc(data.bill.title)}</div>
      <div style="width:42px;flex-shrink:0;"></div>
    </div>
    ${shell(main, side)}`;

  $("#back-btn").addEventListener("click", () => loadBillView(data.bill.id));
  bindItemRows(data, me);
  $("#done-btn").addEventListener("click", () => loadBillView(data.bill.id));
  watchDock();
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
  const main = `
    <div class="card">
      <div class="field" style="margin-bottom:0;">
        <label for="title-input">Judul Bill</label>
        <input id="title-input" value="${esc(editState.title)}" maxlength="60">
      </div>
      ${editState.merchant ? `<div class="muted" style="margin-top:4px;">${esc(editState.merchant)}</div>` : ""}
      <div class="field" style="margin:10px 0 0;">
        <label for="date-input">Tanggal Transaksi</label>
        <input type="date" id="date-input" value="${esc(editState.transacted_at)}">
      </div>
    </div>
    <div class="card" id="items-card">
      <div class="card-title">Item <span class="muted">(edit kalau salah)</span></div>
      <div id="items-list"></div>
      <button class="btn-outline btn-sm" id="add-item-btn" style="width:100%;margin-top:8px;">${ic("plus")} Tambah Item</button>
    </div>
    <div class="card">
      <div class="card-title">Total</div>
      <div class="field-row">
        <div><label for="subtotal-input">Subtotal</label><input type="text" inputmode="numeric" class="input-money" id="subtotal-input" value="${rupiahFmt(editState.subtotal)}"></div>
        <div><label for="tax-input">PPN</label><input type="text" inputmode="numeric" class="input-money" id="tax-input" value="${rupiahFmt(editState.tax)}"></div>
        <div><label for="service-input">Service</label><input type="text" inputmode="numeric" class="input-money" id="service-input" value="${rupiahFmt(editState.service)}"></div>
      </div>
      <label class="toggle-row" style="margin-top:10px;">
        <span style="flex:1;">
          <span class="label-strong">Harga Item Sudah Termasuk Pajak</span>
          <span class="muted">Kalau struk nulis "termasuk pajak", harga item udah kehitung pajaknya</span>
        </span>
        <input type="checkbox" id="tax-included-toggle" ${editState.tax_included ? "checked" : ""}>
      </label>
      <div id="tax-included-badge" class="info-box ${editState.tax_included ? "" : "hidden"}" style="margin-top:8px;color:var(--green);">${ic("check")} Harga item sudah termasuk pajak — PPN &amp; service dikosongin, total ngikut item</div>
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:10px;">
        <span class="label-sm">Total</span>
        <span class="money" style="font-size:22px;font-weight:800;" id="total-display">${fmt(editState.total)}</span>
      </div>
      <div id="sum-warn" class="error-text hidden"></div>
    </div>`;

  const side = `
    <div class="dock"><div class="dock-inner">
      <div class="dock-total">
        <span class="label">Total bill</span>
        <span class="money" id="dock-total-display">${fmt(editState.total)}</span>
      </div>
      <button class="btn-primary" id="save-bill-btn">Simpan Perubahan</button>
    </div></div>`;

  app.innerHTML = `
    <div class="topbar">
      <button class="icon-btn ghost" id="back-btn" aria-label="Balik ke ringkasan bill">${ic("back")}</button>
      <div class="topbar-title">Edit Bill</div>
      <div style="width:42px;flex-shrink:0;"></div>
    </div>
    ${shell(main, side)}`;

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
  watchDock();
}

function renderEditItems() {
  const elList = $("#items-list");
  if (!elList) return;
  elList.innerHTML = editState.items.map((it, idx) => `
    <div class="item-row" style="flex-wrap:wrap;">
      <div style="flex:2;min-width:140px;">
        <input data-role="name" data-idx="${idx}" value="${esc(it.name)}" placeholder="Nama Item" aria-label="Nama item" style="padding:9px 10px;">
      </div>
      <div style="flex:1;min-width:100px;">
        <input data-role="price" data-idx="${idx}" type="text" inputmode="numeric" class="input-money" value="${rupiahFmt(it.price)}" placeholder="0" aria-label="Harga item" style="padding:9px 10px;">
      </div>
      <button data-role="del" data-idx="${idx}" class="icon-btn" aria-label="Hapus item ini" style="color:var(--red);">${ic("trash")}</button>
      <div style="flex-basis:100%;padding:6px 0 0;display:flex;align-items:center;gap:8px;">
        <span class="label-sm" style="flex-shrink:0;">Diskon:</span>
        <input data-role="discount" data-idx="${idx}" type="text" inputmode="numeric" class="input-money" value="${rupiahFmt(it.discount)}" placeholder="0" aria-label="Diskon item" style="padding:7px 9px;max-width:120px;">
        ${it.discount > 0 ? `<span class="disc-bayar" style="color:var(--green);font-weight:700;font-size:13px;">→ bayar ${rupiahFmt(Math.max(0, it.price - it.discount))}</span>` : ""}
      </div>
      <div style="flex-basis:100%;padding:2px 0 8px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap;">
          <span class="label-sm" style="flex-shrink:0;">Cara Bagi:</span>
          <button class="btn-outline btn-sm item-mode-btn ${it.mode !== "slot" ? "chip-active" : ""}" data-idx="${idx}" data-mode="free">Bebas</button>
          <button class="btn-outline btn-sm item-mode-btn ${it.mode === "slot" ? "chip-active" : ""}" data-idx="${idx}" data-mode="slot">Slot</button>
          ${it.mode === "slot" ? `
          <div style="display:flex;align-items:center;gap:6px;margin-left:auto;">
            <span class="muted">bagi</span>
            <button class="btn-outline btn-sm slot-dec" data-idx="${idx}" aria-label="Kurangi bagian">−</button>
            <span class="slot-count" style="font-weight:700;min-width:18px;text-align:center;">${it.slot_count || 2}</span>
            <button class="btn-outline btn-sm slot-inc" data-idx="${idx}" aria-label="Tambah bagian">＋</button>
            <span class="muted">orang</span>
          </div>` : ""}
        </div>
        <div class="muted" style="font-size:12px;line-height:1.45;">
          ${it.mode === "slot"
            ? `Dibagi ${it.slot_count || 2} bagian tetap${it.price > 0 ? ` · ${rupiahFmt(Math.floor(it.price / (it.slot_count || 2)))}/bagian` : ""}. Tiap orang bisa ambil 1+ bagian, yang kosong keliatan.`
            : `Pilih bebas: centang item yang kamu makan — bisa ambil 1 porsi atau lebih. Harga dibagi sesuai porsi yang keambil.`}
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
        bayar.style.cssText = "color:var(--green);font-weight:700;font-size:13px;";
        inp.parentElement.appendChild(bayar);
      }
      if (bayar) bayar.textContent = `→ bayar ${rupiahFmt(eff)}`;
    } else if (bayar) bayar.remove();
    updateEditTotal();
  }));
  $$("[data-role=del]", elList).forEach(btn => btn.addEventListener("click", () => {
    editState.items.splice(+btn.dataset.idx, 1);
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
  const dt = $("#dock-total-display");
  if (dt) dt.textContent = fmt(total);
  const badge = $("#tax-included-badge");
  if (badge) badge.classList.toggle("hidden", !editState.tax_included);
  const warn = $("#sum-warn");
  if (warn) {
    if (sumItems !== subtotal) {
      warn.classList.remove("hidden");
      if (editState.tax_included) {
        warn.textContent = `Total item (${fmt(sumItems)}) beda dari subtotal (${fmt(subtotal)}). Total item ini yang dipakai — cek harga & diskon tiap item.`;
      } else if (sumItems === total) {
        warn.textContent = `Harga item (${fmt(sumItems)}) kayaknya udah TERMASUK pajak, tapi kamu isi subtotal ${fmt(subtotal)} + PPN. Aktifin toggle "Harga item sudah termasuk pajak" biar gak dobel.`;
      } else {
        warn.textContent = `Total item (${fmt(sumItems)}) beda dari subtotal (${fmt(subtotal)}). Cek kolom diskon tiap item.`;
      }
    } else warn.classList.add("hidden");
  }
}

async function saveEditBill(billId) {
  const btn = $("#save-bill-btn");
  const items = editState.items.filter(i => i.name && i.price > 0);
  if (!items.length) { toast("Minimal 1 item"); return; }
  await withBusy(btn, "Nyimpen...", async () => {
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
    } catch (e) { toast(e.message); }
  });
}

function initials(name) {
  const parts = String(name || "?").trim().split(/\s+/);
  return (parts[0][0] + (parts[1] ? parts[1][0] : "")).toUpperCase();
}

// ---------- Share ----------
function shareBill(billId, title) {
  const url = location.origin + "/#/b/" + billId;
  const text = `Yuk bagi bill "${title}" di Bagiin: ${url}`;
  const s = openSheet(`
    <div class="sheet-handle"></div>
    <div class="sheet-title">Bagikan bill</div>
    <p class="sheet-sub">Siapa pun yang pegang link ini bisa milih itemnya sendiri — gak perlu bikin akun.</p>
    <div class="code-display" style="font-size:13px;letter-spacing:0;word-break:break-all;">${esc(url)}</div>
    <button class="btn-primary" id="share-copy">${ic("copy")} Salin Link</button>
    <button class="btn-outline" id="share-wa">${ic("share")} Kirim Lewat WhatsApp</button>
    ${navigator.share ? `<button class="btn-outline" id="share-native">${ic("share")} Bagikan Lewat Aplikasi Lain</button>` : ""}
    <button class="btn-ghost" id="share-close">Tutup</button>`, { noAutofocus: true });

  // desktop rarely has navigator.share, and copying is what people actually
  // want there (bug: the only path was "open WhatsApp Web")
  $("#share-copy", s.sheet).addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(url); toast("Link disalin 📋"); s.close(); }
    catch (e) { toast("Gagal salin — copy manual dari kotak di atas ya"); }
  });
  $("#share-wa", s.sheet).addEventListener("click", () => {
    window.open("https://wa.me/?text=" + encodeURIComponent(text), "_blank");
    s.close();
  });
  const nat = $("#share-native", s.sheet);
  if (nat) nat.addEventListener("click", async () => {
    try {
      await navigator.share({ title: "Bagiin", text });
      s.close();
    } catch (e) {
      // dismissing the native sheet throws AbortError — that is a "no thanks",
      // not a failure (bug: cancelling the share sheet opened WhatsApp Web)
      if (e && e.name === "AbortError") return;
      toast("Gagal bagikan, coba salin linknya");
    }
  });
  $("#share-close", s.sheet).addEventListener("click", s.close);
}

function openReopenConfirm(data) {
  const s = openSheet(`
    <div class="sheet-handle"></div>
    <div class="sheet-title">Buka bill lagi?</div>
    <p class="sheet-sub">Bill balik ke status aktif. Semua orang bisa milih item, ubah pembagian, dan update status bayar lagi.</p>
    <button class="btn-primary" id="confirm-reopen">Buka Lagi</button>
    <button class="btn-outline" id="cancel-reopen">Batal</button>`, { noAutofocus: true });
  $("#cancel-reopen", s.sheet).addEventListener("click", s.close);
  $("#confirm-reopen", s.sheet).addEventListener("click", (ev) =>
    withBusy(ev.currentTarget, "Bentar...", async () => {
      try {
        await api(`/api/bills/${data.bill.id}/reopen`, { method: "POST" });
        s.close();
        toast("Bill dibuka lagi ✓");
        loadBillView(data.bill.id);
      } catch (e) { toast(e.message); }
    }));
}

function openCloseConfirm(data) {
  const ownerish = new Set([data.paid_by_id, data.bill.creator_identity_id].filter(Boolean));
  const notPicked = data.people.filter(p => !p.subtotal_idr && !hasPickedAny(data, p.identity_id) && !ownerish.has(p.identity_id));
  const emptySlots = data.uncovered_slots || [];
  const s = openSheet(`
    <div class="sheet-handle"></div>
    <div class="sheet-title">Tutup bill?</div>
    <p class="sheet-sub">Setelah ditutup, pembagian jadi final dan status bayar gak bisa diubah lagi. Kamu masih bisa buka lagi kapan pun.</p>
    ${emptySlots.length ? `<div class="warn-box"><strong>Bagian kosong belum keambil:</strong><ul>
      ${emptySlots.map(u => `<li>${esc(u.name)} — ${u.empty} bagian (${fmt(u.amount_idr)})</li>`).join("")}
    </ul></div>` : ""}
    ${notPicked.length ? `<div class="warn-box"><strong>Belum pilih item:</strong><ul>${notPicked.map(m => `<li>${esc(m.name)}</li>`).join("")}</ul></div>` : ""}
    <button class="btn-primary" id="confirm-close">Tutup Bill Sekarang</button>
    <button class="btn-outline" id="cancel-close">Batal, Tunggu yang Lain</button>`, { noAutofocus: true });
  $("#cancel-close", s.sheet).addEventListener("click", s.close);
  $("#confirm-close", s.sheet).addEventListener("click", (ev) =>
    withBusy(ev.currentTarget, "Bentar...", async () => {
      try {
        await api(`/api/bills/${data.bill.id}/close`, { method: "POST" });
        s.close();
        toast("Bill ditutup");
        loadBillView(data.bill.id);
      } catch (e) { toast(e.message); }
    }));
}
