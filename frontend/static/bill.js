/* Bagiin frontend - bill screens (guest picker, creator summary, sheets) */

// normalized name compare: "Amel" == "amel" == " AMEL "
const normName = (s) => String(s || "").trim().toLowerCase();

// ---------- status ----------
// Closing a bill does NOT make it lunas — the backend stopped forcing
// settled=true on close (bug: every closed bill wore a green "semua lunas"
// chip while unpaid people were listed one scroll below it).
function statusChipHtml(data) {
  if (data.bill.status === "closed") {
    if (data.settled)
      return `<span class="chip chip-green">${ic("check")}Ditutup · lunas</span>`;
    // a closed bill nobody but the creator ever joined isn't "Belum Lunas" —
    // nobody owes anybody anything (bug: solo closed bill said "Belum Lunas")
    if ((data.people || []).length <= 1)
      return `<span class="chip chip-grey">Ditutup · selesai</span>`;
    return `<span class="chip chip-grey">Ditutup · belum lunas</span>`;
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
  const what = n > 0 ? `${n} bagian kosong belum terambil` : "ada bagian yang belum terambil";
  return `<p class="muted" style="margin-top:8px;color:var(--red);">${ic("alert")} ${what} (${fmt(data.uncovered_idr)})</p>`;
}

// ---------- Receipt photos: view / upload / remove ----------
function photoThumbHtml(p, i, canManage) {
  // a row can outlive its file (older data, a failed upload) — onerror swaps
  // the <img> for a neutral placeholder instead of the browser's broken-image
  // glyph (bug: a missing file rendered as a giant broken-image icon in the grid)
  return `
    <div class="bill-photo-wrap" style="position:relative;">
      <img src="/uploads/${esc(p.path.split("/").pop())}" alt="Struk ${i + 1}" loading="lazy"
           data-photo="${esc(p.path)}" data-idx="${i}" style="width:100%;height:110px;object-fit:cover;border-radius:var(--r-xs);display:block;"
           onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
      <div class="photo-missing" style="width:100%;height:110px;">${ic("image")}<span>Foto tidak ditemukan</span></div>
      ${canManage ? `<button class="bill-photo-del" data-id="${p.id}" aria-label="Hapus foto ${i + 1}" style="position:absolute;top:4px;right:4px;width:40px;height:40px;min-height:40px;padding:0;border-radius:var(--r-full);background:rgba(0,0,0,.62);color:#fff;border:none;display:flex;align-items:center;justify-content:center;">${ic("x")}</button>` : ""}
    </div>`;
}

function photoBtnHtml(data) {
  const photos = data.photos || [];
  // uploading needs management rights, not payer-ness — the backend gates this
  // endpoint on _can_manage (bug: creator who handed the payer role away lost
  // the button on their own bill)
  const canManage = data.can_manage && data.bill.status === "open";
  if (!photos.length && !canManage) return "";
  const thumbs = photos.map((p, i) => photoThumbHtml(p, i, canManage)).join("");
  return `
    <div style="margin-top:10px;">
      ${photos.length ? `<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;">${thumbs}</div>` : ""}
      ${canManage ? `<button class="btn-outline btn-sm" id="add-photo-btn" style="width:100%;margin-top:8px;">${ic("camera")} ${photos.length ? "Tambah Foto Lagi" : "Tambah Foto Struk"}</button>` : ""}
    </div>`;
}

/** Same two pieces, split so the manager card can put the thumbnails in the
 *  card body and the button in a row next to the other utility. */
function photoThumbsHtml(data) {
  const photos = data.photos || [];
  if (!photos.length) return "";
  const canManage = data.can_manage && data.bill.status === "open";
  return `
    <div style="margin-top:10px;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;">
      ${photos.map((p, i) => photoThumbHtml(p, i, canManage)).join("")}
    </div>`;
}

function photoAddBtnHtml(data) {
  const canManage = data.can_manage && data.bill.status === "open";
  if (!canManage) return "";
  const n = (data.photos || []).length;
  return `<button class="btn-outline btn-sm" id="add-photo-btn">${ic("camera")} ${n ? "Tambah Foto" : "Foto Struk"}</button>`;
}

function openPhotoSheet(bill, photos, idx) {
  const list = photos && photos.length ? photos : (bill.photo_path ? [{ path: bill.photo_path }] : []);
  const start = Math.min(Math.max(idx || 0, 0), list.length - 1);
  let cur = start;
  // same fallback as the thumbnail grid: reset both panes before swapping
  // src so a working photo after a missing one isn't left hidden behind the
  // placeholder from the previous onerror
  const renderImg = () => {
    const p = list[cur];
    if (!p) return;
    const img = $("img", s.sheet);
    const missing = $(".photo-missing", s.sheet);
    img.style.display = "block";
    if (missing) missing.style.display = "none";
    img.src = `/uploads/${encodeURIComponent(p.path.split("/").pop())}`;
    if (list.length > 1) $(".sheet-title", s.sheet).textContent = `Struk asli ${cur + 1}/${list.length}`;
  };
  const s = openSheet(`
    <div class="sheet-handle"></div>
    <div class="sheet-title">Struk asli ${list.length > 1 ? `${cur + 1}/${list.length}` : ""}</div>
    <img src="/uploads/${encodeURIComponent(list[start].path.split("/").pop())}" alt="Foto struk asli bill ini"
         style="width:100%;border-radius:var(--r-sm);" loading="lazy"
         onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
    <div class="photo-missing" style="width:100%;height:220px;">${ic("image")}<span>Foto struk tidak ditemukan</span></div>
    <div class="btn-row" style="margin-top:10px;">
      ${list.length > 1 ? `<button class="btn-outline btn-sm" id="ph-prev" style="margin-top:0;">${ic("chevron")} Sebelumnya</button>
      <button class="btn-outline btn-sm" id="ph-next" style="margin-top:0;">Berikutnya</button>` : ""}
      <button class="btn-primary btn-sm" data-act="close" style="margin-top:0;">Tutup</button>
    </div>`, { noAutofocus: true });
  const prev = $("#ph-prev", s.sheet), next = $("#ph-next", s.sheet);
  if (prev) prev.addEventListener("click", () => { cur = (cur - 1 + list.length) % list.length; renderImg(); });
  if (next) next.addEventListener("click", () => { cur = (cur + 1) % list.length; renderImg(); });
  $('[data-act=close]', s.sheet).addEventListener("click", s.close);
}

function bindPhotoActions(data) {
  // thumbnail tap -> view (with prev/next for multi-photo)
  $$(".bill-photo-wrap img").forEach(img => img.addEventListener("click", () => {
    const idx = parseInt(img.dataset.idx, 10);
    openPhotoSheet(data.bill, data.photos || [], Number.isFinite(idx) ? idx : 0);
  }));
  // remove a photo (owner only — button only rendered for can_manage)
  $$(".bill-photo-del").forEach(btn => btn.addEventListener("click", async () => {
    const pid = parseInt(btn.dataset.id, 10);
    if (!Number.isFinite(pid)) return;
    const ok = await confirmSheet({
      title: "Hapus foto ini?",
      body: "Foto akan dihapus dari bill. Item & pembagiannya tidak berubah.",
      confirmText: "Hapus",
      danger: true,
    });
    if (!ok) return;
    await withBusy(btn, "", async () => {
      try {
        await api(`/api/bills/${data.bill.id}/photos/${pid}`, { method: "DELETE" });
        toast("Foto dihapus ✓");
        loadBillView(data.bill.id);
      } catch (e) { toast(e.message); }
    });
  }));
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
      // every other photo entry point checks first; without it a 12MB phone
      // photo uploads in full over mobile data and is rejected on arrival
      if (f.size > 5 * 1024 * 1024) { toast("Foto maksimal 5MB"); input.value = ""; return; }
      const fd = new FormData();
      fd.append("file", f);
      await withBusy(ab, "Upload...", async () => {
        try {
          await api(`/api/bills/${data.bill.id}/photo`, { method: "POST", body: fd });
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
        // closed bill or join hiccup: guest can still view the final split.
        // Joining a CLOSED bill always 403s, so this is the routine path, not
        // an edge case — without the same guard as the success branch, bill
        // A's split paints over bill B when you tap through fast.
        if (state.currentBillId !== billId) return;
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
          <p style="font-weight:700;color:var(--text);">${notFound ? "Bill tidak ditemukan" : "Gagal memuat bill"}</p>
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

let guestLayer = null;

function enterGuestViewFromName(billId, data, me) {
  if (guestLayer) guestLayer.finishQuiet();
  guestLayer = beginEditorLayer(billId);
  const layer = guestLayer;
  addEventListener("popstate", () => { if (guestLayer === layer) guestLayer = null; }, { once: true });
  renderGuestView(data, me);
}

function renderGuestNamePrompt(billId, data) {
  // A gesture-pop reloads the bill; the session then decides whether gate or picker is valid.
  if (guestLayer) guestLayer.finishQuiet();
  guestLayer = beginEditorLayer(billId);
  const layer = guestLayer;
  addEventListener("popstate", () => { if (guestLayer === layer) guestLayer = null; }, { once: true });
  const app = $("#app");
  const saved = lsGet(LS_KEYS.name, "");
  const payerName = data.paid_by_name || data.creator_name;
  const joined = (data.people || []).length;
  // Every guest arrives here from a WhatsApp link, cold. It used to show a bare
  // total and a name box on an unbranded page — no idea what this is, who is
  // asking, or what happens next. Give them the product name, what the bill
  // contains, who is already on it, and who they will end up paying.
  app.innerHTML = `
    <div class="topbar">
      <button class="icon-btn ghost" id="guest-back" aria-label="Ke beranda">${ic("back")}</button>
      <div class="brand" style="font-size:17px;"><span class="brand-mark">${brandMark(24)}</span>Bagiin<span class="dot">.</span></div>
      <div style="width:42px;flex-shrink:0;"></div>
    </div>
    ${shell(`
      <div class="card">
        <div class="label-sm">Kamu diundang untuk membagi bill</div>
        <div style="font-size:21px;font-weight:800;margin-top:4px;letter-spacing:-.02em;">${esc(data.bill.title)}</div>
        <div class="money hero-total" style="margin-top:6px;">${fmt(data.bill.total_idr)}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;">
          <span class="chip chip-grey">${ic("receipt")}${data.items.length} item</span>
          <span class="chip chip-grey">${ic("people")}${joined} orang sudah bergabung</span>
        </div>
        ${data.bill.tax_included ? `<p class="muted" style="color:var(--green);margin-top:10px;">${ic("check")} Harga item sudah termasuk pajak — tidak ada PPN tambahan</p>` : ""}
        <p class="muted" style="margin-top:10px;">${payerName === data.creator_name
          ? `Dibuat <strong style="color:var(--text);">${esc(data.creator_name)}</strong> — nanti bayarnya ke dia`
          : `Dibuat ${esc(data.creator_name)} · nanti bayarnya ke <strong style="color:var(--text);">${esc(payerName)}</strong>`}</p>
      </div>
      <div class="card">
        <form id="guest-form" novalidate>
          <div class="field" style="margin-bottom:10px;">
            <label for="guest-name">Kamu siapa?</label>
            <input id="guest-name" name="name" placeholder="Nama kamu" value="${esc(saved)}"
                   maxlength="30" autocomplete="name">
          </div>
          <button class="btn-primary" type="submit" id="guest-go">Lanjut, Pilih Item</button>
        </form>
        <p class="muted" style="margin-top:12px;">Tanpa akun. Namamu hanya untuk menandai item yang kamu ambil, dan hanya tersimpan di perangkat ini.</p>
      </div>`)}`;
  $("#guest-back").addEventListener("click", () => {
    const layer = guestLayer;
    guestLayer = null;
    if (layer) layer.finishQuiet();
    location.hash = "#/";
  });
  const input = $("#guest-name");
  input.focus();
  $("#guest-form").addEventListener("submit", (e) => {
    e.preventDefault();
    withBusy($("#guest-go"), "Bentar...", async () => {
      const name = input.value.trim();
      if (!name) { toast("Isi nama dulu"); input.focus(); return; }
      const layer = guestLayer;
      guestLayer = null;
      if (layer) layer.finishQuiet();
      try {
        await ensureIdentity(name);
        const fresh = await apiJson("/api/bills/" + billId + "/join", "POST", {});
        enterGuestViewFromName(billId, fresh, state.identity);
      } catch (e2) {
        toast(e2.message);
        // A closed bill still 403s on join — that guest should see the final
        // split anyway. But if we never got an identity (the create call
        // itself failed), renderGuestView would blow up on me.id, so stay put
        // and let them retry (bug: offline at this step = white screen).
        if (state.identity) enterGuestViewFromName(billId, data, state.identity);
      }
    });
  });
}

// ---------- Guest view: pick items ----------
function renderGuestView(data, me) {
  const app = $("#app");
  state.bill = data;
  const closed = data.bill.status === "closed";
  const myPeople = data.people.filter(p => p.identity_id === me.id);
  // "Tandai Lunas" (v60) settles the WHOLE bill without touching anyone's
  // payment row, so reading p.paid alone put a red "Belum Bayar" chip and a
  // "Tandai Udah Bayar" button under a green "Lunas" header — and on a closed
  // bill that button could only ever 403 (bug: one screen, two answers).
  const myPaid = !!data.settled_manual
    || (myPeople.length ? myPeople[0].paid === "paid" : false);
  const iAmPayer = data.paid_by_id === me.id;
  const payerName = data.paid_by_name || data.creator_name;
  const payment = payerPayment(data);
  // nobody but the creator is on the bill yet — the product moment is
  // "share the link", not "belum lunas". Mirror the creator view's guard so
  // a fresh solo bill never wears a misleading status (bug: "blom ada yg
  // join tp keterangannya lunas").
  const soloSoFar = data.people.length <= 1 && !closed && !data.settled;

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
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap;">
        <div style="min-width:0;">
          <div class="label-sm">Total bill</div>
          <div class="money hero-total">${fmt(data.bill.total_idr)}</div>
        </div>
        <span>${soloSoFar ? `<span class="chip chip-grey">Belum ada yang gabung</span>` : statusChipHtml(data)}</span>
      </div>
      ${data.bill.merchant ? `<p class="muted" style="margin-top:6px;">${esc(data.bill.merchant)}</p>` : ""}
      ${data.bill.transacted_at ? `<p class="muted">${esc(shortDate(data.bill.transacted_at))}</p>` : ""}
      <p class="muted" style="margin-top:6px;">dibuat ${esc(data.creator_name)}${
        data.paid_by_name && data.paid_by_name !== data.creator_name
          // one line, and the fact a guest actually needs: who fronted the
          // money. "Dikelola oleh" was manager jargon on a screen with no
          // manager actions on it
          ? ` · nalangin: ${esc(payerName)}` : ""}</p>
      ${data.bill.tax_included ? `<p class="muted" style="margin-top:6px;color:var(--green);">${ic("check")} Harga item sudah termasuk pajak — tidak ada PPN tambahan</p>` : ""}
      ${photoBtnHtml(data)}
      ${uncoveredNoteHtml(data)}
      ${data.all_paid && !closed && !soloSoFar ? `<p class="muted" style="margin-top:8px;color:var(--green);">${ic("check")} Semua yang memilih item sudah lunas 🎉</p>` : ""}
    </div>
    <div class="card card-flat payment-destination">
      <div class="card-title">Bayar ke ${esc(payment.name)}</div>
      <p class="muted" style="margin-top:4px;">Bagian kamu: <strong style="color:var(--text);">${fmt(bd.total)}</strong>. Transfer ke ${esc(payment.name)} lewat kanal berikut:</p>
      <div style="margin-top:10px;">${accountRowsHtml(payment.name, payment.accounts)}</div>
    </div>
    <button class="btn-outline btn-sm" id="pay-methods-btn" style="margin-bottom:12px;">
      ${ic("wallet")} Lihat metode bayar lagi
    </button>
    ${closed ? `
    <div class="info-box">Bill ini sudah ditutup. Pembagiannya final dan tidak bisa diubah lagi.</div>
    <div class="card card-flat">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
        <div>
          <div class="label-sm">Total kamu</div>
          <div class="money" style="font-size:23px;font-weight:800;">${fmt(bd.total)}</div>
        </div>
        ${iAmPayer
          ? `<span class="chip chip-grey">Kamu yang nalangin</span>`
          : `<span class="chip ${myPaid ? "chip-green" : "chip-red"}">${myPaid ? `${ic("check")} Sudah bayar` : "Belum bayar"}</span>`}
      </div>
      ${hasTax ? `
      <div class="dock-split" style="margin-top:10px;flex-wrap:wrap;background:var(--surface-3);">
        <span>Item <b class="money-sm">${fmt(bd.sub)}</b></span>
        <span>Pajak &amp; service <b class="money-sm" style="color:var(--accent);">${fmt(bd.tax)}</b></span>
      </div>` : ""}
      ${!iAmPayer && !myPaid ? `
      <p class="muted" style="margin-top:10px;">Status bayar tidak bisa diubah lagi di bill yang sudah ditutup.
      Kalau kamu sudah transfer, beri tahu ${esc(payerName)} langsung ya — dia yang bisa menandai.</p>` : ""}
      ${iAmPayer ? `<p class="muted" style="margin-top:10px;">Kamu yang nalangin untuk bill ini, jadi yang lain transfer ke kamu.</p>` : ""}
      ${closed && !iAmPayer ? `<p class="muted" style="margin-top:10px;">${esc(payerName)} nalangin; transfer pembayaran ke ${esc(payerName)} sesuai kanal yang ditentukan.</p>` : ""}
    </div>` : ""}
    <div class="card">
      <div class="card-title">${closed ? "Item yang kamu tanggung" : "Centang yang kamu tanggung"}</div>
      ${closed ? `<p class="muted" style="margin:-4px 0 8px;">Bill sudah ditutup — daftar ini hanya untuk dibaca.</p>` : ""}
      <div id="pick-items">${data.items.map(it => itemRowHtml(it, data, mySel, me.name, me, closed)).join("")}</div>
    </div>
    ${!closed && data.owner_id !== me.id ? `
    <button class="btn-danger-ghost" id="leave-bill-btn">
      ${ic("logout")} Keluar dari Bill
    </button>` : ""}`;

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
        ? `<div class="chip chip-grey" style="justify-content:center;padding:10px;">${ic("wallet")} Kamu yang nalangin</div>`
        : `<button class="${myPaid ? "btn-green" : "btn-primary"}" id="pay-btn">${myPaid ? `${ic("check")} Sudah bayar` : "Tandai sudah bayar"}</button>`}
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
  const leaveBtn = $("#leave-bill-btn");
  if (leaveBtn) leaveBtn.addEventListener("click", async () => {
    // the creator leaving needs a different reassurance: they're used to this
    // being *their* bill, so say out loud that it keeps running without them
    const iMadeIt = data.bill.creator_identity_id === me.id;
    const ok = await confirmSheet({
      title: "Keluar dari bill ini?",
      body: "Pilihan item kamu dihapus dan bill ini tidak lagi muncul di daftar kamu. Kamu masih bisa bergabung lagi lewat link selama bill masih aktif."
        // confirmSheet renders `body` as markup, so the typed name needs esc()
        + (iMadeIt ? ` Billnya tetap berjalan, sekarang dipegang ${esc(data.paid_by_name || "yang nalangin")}.` : ""),
      confirmText: "Keluar",
      danger: true,
    });
    if (!ok) return;
    withBusy(leaveBtn, "Bentar...", async () => {
      try {
        await apiJson(`/api/bills/${data.bill.id}/leave`, "POST", {});
        toast("Kamu sudah keluar dari bill");
        if (location.hash === "#/") render(); else location.hash = "#/";
      } catch (e) { toast(e.message); }
    });
  });
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
  const modeLabel = isSlot ? "Bagi per porsi" : "Dibagi rata";
  let shareText;
  // "kamu N×" only where there is no stepper to read it off (closed bills).
  // On an open bill the stepper sits right there showing the same number, and
  // on a 390px phone that duplicate pushed the detail line onto three rows.
  if (isSlot) {
    const perSlot = Math.floor(eff / it.slot_count);
    const perSlotMax = Math.ceil(eff / it.slot_count);
    const shareLabel = perSlot === perSlotMax
      ? `${fmt(perSlot)}/bagian`
      : `${fmt(perSlot)}–${fmt(perSlotMax).replace(/^Rp\s*/, "")}/bagian`;
    const taken = selList.reduce((s, x) => s + (x.qty || 1), 0);
    const empty = Math.max(0, it.slot_count - taken);
    const mineTxt = readOnly && myQty > 0 ? ` · kamu ${myQty}×` : "";
    shareText = `${taken}/${it.slot_count} bagian · ${shareLabel}${mineTxt}${empty > 0 ? ` · ${empty} kosong` : ""}`;
  } else if (selList.length === 0) {
    shareText = "belum dipilih";
  } else {
    const totalQty = selList.reduce((s, x) => s + (x.qty || 1), 0);
    const perServing = Math.floor(eff / totalQty);
    const mineTxt = readOnly && myQty > 0 ? ` · kamu ${myQty}×` : "";
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
  // Slot items with no room left must not look tappable — a dead row that
  // flashes "slot abis" every tap is noise. The stepper stays hidden and the
  // row drops the checkbox affordance (bug: full-slot rows kept the checkbox
  // visual and invited taps that did nothing).
  const isFull = isSlot && (selList.reduce((s, x) => s + (x.qty || 1), 0) >= it.slot_count) && myQty === 0;
  return `
    <div class="item-row${isSel ? " selected" : ""}${!readOnly && !isFull ? " item-tappable" : ""}${isFull ? " item-full" : ""}" data-item="${it.id}"${a11y}>
      ${!readOnly || isSel ? (isFull ? `<div class="item-check item-check-full">${ic("x")}</div>` : `<div class="item-check">${ic("check")}</div>`) : ""}
      <div class="item-info">
        <div class="item-name">${esc(it.name)} <span class="slot-badge">${modeLabel}</span></div>
        <div class="item-share">${shareText}</div>
      </div>
      ${!readOnly ? `
      <!-- the +/- disabled state used to be set only by renderPickRows, i.e.
           AFTER the first tap: a maxed-out slot row painted an enabled "+"
           that could only toast "slot sudah penuh" (bug: dead button that looked
           alive until you touched something else) -->
      <div class="item-stepper" data-step-for="${it.id}">
        <button type="button" class="step-btn step-dec" aria-label="Kurangi"${myQty <= 0 ? " disabled" : ""}>−</button>
        <span class="step-qty" aria-live="polite">${myQty || 0}</span>
        <button type="button" class="step-btn step-inc" aria-label="Tambah"${isSlot && myQty >= it.slot_count - (selList.reduce((s, x) => s + (x.qty || 1), 0) - myQty) ? " disabled" : ""}>+</button>
      </div>` : ""}
      <div class="money item-price">${priceHtml}</div>
    </div>`;
}

function bindItemRows(data, me, root) {
  const scope = root || document;
  if (data.bill.status === "closed") return; // rows render read-only, nothing to bind
  $$("#pick-items .item-row", scope).forEach(row => {
    const id = parseInt(row.dataset.item, 10);
    const it = data.items.find(x => x.id === id);
    if (!it) return;
    const isSlot = it.mode === "slot" && it.slot_count;

    const slotsLeft = () => {
      if (!isSlot) return Infinity;
      const taken = othersSel(data.sel_by_item[id] || [], me).reduce((s, x) => s + (x.qty || 1), 0);
      return it.slot_count - taken; // slots NOT held by me
    };

    const activate = () => {
      const myQty = state.selQty.get(id) || 0;
      buzz(10);
      if (isSlot) {
        if (myQty > 0) {
          // already holding slots -> tap releases one (same as minus)
          state.selQty.set(id, Math.max(0, myQty - 1));
          if (state.selQty.get(id) === 0) state.selQty.delete(id);
          updateGuestSelection(data, me);
        } else if (slotsLeft() > 0) {
          state.selQty.set(id, 1);
          updateGuestSelection(data, me);
        } else {
          toast("Bagian item ini sudah habis");
        }
      } else if (myQty > 0) {
        state.selQty.delete(id);
        updateGuestSelection(data, me);
      } else {
        state.selQty.set(id, 1);
        updateGuestSelection(data, me);
      }
    };

    const changeQty = (delta) => {
      const myQty = state.selQty.get(id) || 0;
      const next = myQty + delta;
      buzz(8);
      if (next <= 0) {
        state.selQty.delete(id);
      } else if (isSlot && next > slotsLeft()) {
        toast("Bagian item ini sudah habis");
        return;
      } else {
        state.selQty.set(id, next);
      }
      updateGuestSelection(data, me);
    };

    row.addEventListener("click", (e) => {
      // stepper buttons are interactive — don't let a click on minus/plus
      // bubble up and ALSO toggle the row (double-fire bug)
      if (e.target.closest(".step-btn")) return;
      activate();
    });
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") { e.preventDefault(); activate(); }
    });
    const dec = $(".step-dec", row);
    const inc = $(".step-inc", row);
    if (dec) dec.addEventListener("click", (e) => { e.stopPropagation(); changeQty(-1); });
    if (inc) inc.addEventListener("click", (e) => { e.stopPropagation(); changeQty(1); });
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
  // #my-total is the dock number on the guest view, the creator-pick view AND
  // the manager view (where it is labelled "Belum beres"). A selection POST
  // that lands after the user opened another bill used to write this bill's
  // personal total into that bill's dock (bug: right number, wrong screen).
  if (!data.bill || state.currentBillId !== data.bill.id) return;
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
    const it = data.items.find(x => x.id === id);
    const shareEl = $(".item-share", row);
    const isSlot = it && it.mode === "slot" && it.slot_count;
    const selList = othersSel(data.sel_by_item[id], me);
    if (shareEl && it) {
      if (isSlot) {
        const taken = selList.reduce((s, x) => s + (x.qty || 1), 0) + qty;
        const empty = Math.max(0, it.slot_count - taken);
        shareEl.textContent = `${taken}/${it.slot_count} bagian${empty > 0 ? ` · ${empty} kosong` : ""}`;
      } else if (sel || selList.length > 0) {
        const totalQty = selList.reduce((s, x) => s + (x.qty || 1), 0) + qty;
        const eff = Math.max(0, it.price_idr - (it.discount_idr || 0));
        const perServing = Math.floor(eff / totalQty);
        shareEl.textContent = `${totalQty} porsi · ${fmt(perServing)}/porsi`;
      } else {
        shareEl.textContent = "belum dipilih";
      }
    }
    // stepper live state: qty number, minus dead only at 0, plus dead when a
    // slot item is maxed. Minus used to die at 1 on slot items while tapping
    // the row still released the slot — same gesture, two rules, depending on
    // the item type (bug: "−" greys out but the row still lets go)
    const qtyEl = $(".step-qty", row);
    const dec = $(".step-dec", row);
    const inc = $(".step-inc", row);
    if (qtyEl) qtyEl.textContent = qty;
    if (dec) dec.disabled = qty <= 0;
    if (inc && it) {
      if (isSlot) {
        const othersTaken = selList.reduce((s, x) => s + (x.qty || 1), 0);
        inc.disabled = qty >= it.slot_count - othersTaken;
      } else {
        inc.disabled = false;
      }
    }
    // full-slot rows lose the tappable affordance live (someone else claimed
    // the last slot while we looked)
    const fullNow = isSlot && !sel && (othersSel(data.sel_by_item[id], me).reduce((s, x) => s + (x.qty || 1), 0) >= it.slot_count);
    row.classList.toggle("item-full", fullNow && !sel);
    row.classList.toggle("item-tappable", !fullNow || sel);
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
    <p class="muted">${fmt(perSlot)}/bagian · ${it.slot_count} bagian · ${othersTaken} terambil oleh orang lain</p>
    <p class="muted" style="margin-top:4px;">Item ini dibagi ${it.slot_count} bagian tetap. Kamu bisa ambil lebih dari 1 kalau pesennya lebih dari satu.</p>
    <p class="muted" style="margin:4px 0 14px;">${leftEmpty > 0 ? `Sisa bagian kosong: ${leftEmpty}` : "Bagian sudah habis"}</p>
    ${max > 0 ? `
    <div style="display:flex;align-items:center;justify-content:center;gap:20px;margin-bottom:16px;">
      <button class="btn-outline slot-qty-dec" style="width:52px;height:52px;min-height:52px;font-size:22px;border-radius:var(--r-full);padding:0;" aria-label="Kurangi bagian">−</button>
      <div style="text-align:center;">
        <div style="font-size:40px;font-weight:800;" class="slot-qty">${qty}</div>
        <div class="muted" style="font-size:12px;">Bagian kamu</div>
      </div>
      <button class="btn-outline slot-qty-inc" style="width:52px;height:52px;min-height:52px;font-size:22px;border-radius:var(--r-full);padding:0;" aria-label="Tambah bagian">＋</button>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <span class="label">Total kamu</span>
      <span class="money slot-total" style="font-size:24px;font-weight:800;">${fmt(perSlot * qty)}</span>
    </div>
    <button class="btn-primary" id="slot-confirm">Ambil ${qty} bagian</button>` : ""}
    ${myQty > 0 ? `<button class="btn-danger-ghost" id="slot-release">${ic("x")} Lepas bagian (${myQty})</button>` : ""}
    <button class="btn-outline" id="slot-close">${max > 0 ? "Batal" : "Tutup"}</button>`, { noAutofocus: true });

  const sync = () => {
    if (max <= 0) return; // no qty controls rendered when slots are full
    $(".slot-qty", s.sheet).textContent = qty;
    $(".slot-total", s.sheet).textContent = fmt(perSlot * qty);
    $(".slot-qty-inc", s.sheet).disabled = qty >= max;
    $(".slot-qty-dec", s.sheet).disabled = qty <= 1;
    $("#slot-confirm", s.sheet).textContent = `Ambil ${qty} bagian`;
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
        // release must ride the same save chain as picks — a raw DELETE here
        // could land BEFORE a queued optimistic POST that still contains this
        // item, resurrecting a pick the user just released (bug: races)
        const picks = [...state.selQty.entries()]
          .filter(([iid]) => iid !== it.id)
          .map(([iid, q]) => ({ item_id: iid, qty: q }));
        state.selQty.delete(it.id);
        await saveSelectionsViaChain(data, picks);
        s.close();
        toast("Bagian dilepas ✓");
        loadBillView(data.bill.id);
      } catch (e) { toast(e.message); }
    }));
  $("#slot-close", s.sheet).addEventListener("click", s.close);
  sync();
}

function perServingEst(it, othersQty, myQty) {
  const totalQty = othersQty + myQty;
  const eff = Math.max(0, it.price_idr - (it.discount_idr || 0));
  return totalQty > 0 ? Math.floor(eff / totalQty) : eff;
}

// Merge the live (post-tap) qty for ME into a server-snapshot selector list,
// keeping everyone else's order as returned. If I'm already in `selList`
// (an earlier pick, now just changing qty) I keep that slot; a brand-new
// pick is appended at the end, since calc.py orders selectors by each
// identity's first-ever appearance in the raw selection rows and mine would
// be the newest. selQty===0 drops me out entirely (a release).
function mergeLiveSelectors(selList, myId, myName, myQty) {
  const isMe = s => (s.id ? s.id === myId : (!s.id && normName(s.name) === normName(myName)));
  const out = [];
  let found = false;
  (selList || []).forEach(s => {
    if (isMe(s)) {
      found = true;
      if (myQty > 0) out.push({ id: myId, qty: myQty });
    } else {
      out.push({ id: s.id, qty: s.qty || 1 });
    }
  });
  if (!found && myQty > 0) out.push({ id: myId, qty: myQty });
  return out;
}

// LOCAL ESTIMATE ONLY — see myBreakdown(). Mirrors backend calc.py exactly
// (not just its shape): both item modes' rounding remainder are distributed
// the same way calc.py distributes them, instead of being floor()ed away, so
// this number no longer ticks by a rupiah the moment the real response lands.
// - free item: price // (others + me) per serving, then the leftover
//   (eff - share*totalQty) round-robins across SELECTOR ENTRIES in order,
//   one rupiah each, same as calc.py's `for i in range(rem): selectors[i %
//   len(selectors)]` — a person with qty>1 only gets at most +1 from this,
//   not +1 per unit.
// - slot item: per-slot price (price // slot_count) * my qty, then — only
//   once every slot is taken — the leftover (eff - per_slot*slot_count)
//   hands out +1 per SLOT UNIT in order (a person holding qty>1 slots can
//   get multiple), same as calc.py's nested slot loop. Uncovered items never
//   get a remainder — that money sits in uncovered_idr, not in the tax base.
// - tax proportional to total subtotal across ALL people, rounded down —
//   exact for everyone except the bill owner, who additionally absorbs
//   calc.py's leftover tax rounding rupiah (see note below).
//
// ORDERING ASSUMPTION: calc.py decides who gets the remainder by walking
// identities in the order they first appear anywhere in the raw selection
// rows, then that identity's items in the order they were first picked. The
// API payload only gives per-item order (`sel_by_item[id]`, i.e. the order
// selection rows for THIS item were inserted) — it doesn't expose the
// cross-item global order calc.py actually uses. The two agree whenever
// nobody's first-ever pick in the bill was on a DIFFERENT item than the one
// being estimated (true for the common case: a single contested item, or
// everyone picking items in the same order they joined). They can disagree
// only when two people's relative order differs between "first item each of
// them ever picked" and "order of rows on this specific item" — genuinely
// rare, and not detectable from this payload without a backend change, which
// is out of scope here (bill.js/index.html only).
function computeMyBreakdown(data, selQty) {
  let sub = 0;
  let totalSelAll = 0;
  const myName = state.identity ? state.identity.name : "";
  const myId = state.identity ? state.identity.id : "";
  // the owner (confirmed payer, else creator) absorbs items nobody picked —
  // mirror calc.py's fallback_id, not the creator specifically
  const iAmOwner = data.owner_id === myId;
  data.items.forEach(it => {
    const myQty = selQty.get(it.id) || 0;
    const eff = Math.max(0, it.price_idr - (it.discount_idr || 0));
    if (it.mode === "slot" && it.slot_count) {
      const perSlot = Math.floor(eff / it.slot_count);
      const order = mergeLiveSelectors(data.sel_by_item[it.id], myId, myName, myQty);
      const taken = order.reduce((s, x) => s + x.qty, 0);
      order.forEach(x => { if (x.id === myId) sub += perSlot * x.qty; });
      if (taken >= it.slot_count) {
        // all slots taken: distribute eff - perSlot*slotCount across SLOTS
        // (per unit, not per person) — mirrors calc.py's inner `for _ in
        // range(qty)` loop
        let rem = eff - perSlot * it.slot_count;
        for (const x of order) {
          for (let i = 0; i < x.qty && rem > 0; i++) {
            if (x.id === myId) sub += 1;
            rem -= 1;
          }
          if (rem <= 0) break;
        }
        totalSelAll += perSlot * taken + (eff - perSlot * it.slot_count);
      } else {
        // still uncovered: the leftover stays in uncovered_idr, never in
        // anyone's subtotal or the tax base
        totalSelAll += perSlot * taken;
      }
      return;
    }
    // free item: per-serving split (my qty of total qty taken)
    const order = mergeLiveSelectors(data.sel_by_item[it.id], myId, myName, myQty);
    const totalQty = order.reduce((s, x) => s + x.qty, 0);
    if (myQty > 0 && totalQty > 0) {
      const portion = Math.floor(eff / totalQty);
      sub += portion * myQty;
      const rem = eff - portion * totalQty;
      for (let i = 0; i < rem; i++) {
        if (order[i % order.length].id === myId) sub += 1;
      }
    }
    // a free item NOBODY picked still belongs to someone — calc.py hands it to
    // the bill owner, so it stays in the tax denominator (and in the owner's own
    // subtotal). Dropping it inflated everyone else's tax share (bug: estimate
    // said Rp 145.000, the backend said Rp 122.500, and the number jumped the
    // moment the response landed)
    else if (totalQty === 0 && iAmOwner) sub += eff;
    totalSelAll += eff;
  });
  let taxService = (data.bill.tax_idr || 0) + (data.bill.service_idr || 0);
  if (data.bill.tax_included) taxService = (data.bill.service_idr || 0);
  let tax = 0;
  if (totalSelAll > 0) tax = Math.floor(sub * taxService / totalSelAll);
  // NOT mirrored: in proportional tax mode calc.py additionally hands the
  // OWNER any leftover rupiah from truncating everyone's tax share (`diff`
  // in calc.py's proportional branch) — computing that exactly here would
  // mean re-deriving every other person's live subtotal, i.e. re-running the
  // whole split client-side, which is what this function deliberately avoids.
  // Only the owner's own dock can be off by that rounding rupiah until the
  // server responds; every other participant's tax share above is exact.
  return { sub, tax, total: sub + tax };
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
  // This sheet is the last mile of the whole product: the moment someone
  // actually transfers money. It used to be titled "Konfirmasi Item" and list
  // only the picks — the person was asked to mark themselves paid without ever
  // being told WHERE to send it (the accounts sat behind a separate button on
  // the screen behind). Amount, destination, then the button.
  const pay = payerPayment(data);
  const iAmPayer = data.paid_by_id === me.id;
  const s = openSheet(`
    <div class="sheet-handle"></div>
    <div class="sheet-title">${iAmPayer ? "Bagian kamu" : `Bayar ke ${esc(pay.name)}`}</div>
    <p class="sheet-sub">${iAmPayer
      ? "Kamu yang nalangin untuk bill ini — ini bagian kamu sendiri."
      : "Cek item kamu, transfer, lalu tandai sudah bayar. Ketuk item untuk membatalkan."}</p>
    <div id="pay-items"></div>
    <div id="pay-total"></div>
    ${iAmPayer ? "" : `
    <div class="card card-flat" style="margin-bottom:12px;">
      <div class="label-sm" style="margin-bottom:8px;">Kirim ke ${esc(pay.name)}</div>
      ${accountRowsHtml(pay.name, pay.accounts)}
    </div>`}
    <button class="${alreadyPaid ? "btn-green" : "btn-primary"}" id="confirm-pay">
      ${alreadyPaid ? `${ic("check")} Sudah bayar` : "Tandai sudah bayar"}
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
        <p class="muted" style="margin:-2px 0 6px;font-size:12px;">Angka per item perkiraan (≈) — total di bawah pakai hitungan final.</p>
        ${items.map(it => {
          const myQty = state.selQty.get(it.id) || 1;
          const eff = Math.max(0, it.price_idr - (it.discount_idr || 0));
          let myPrice;
          let shareNote;
          if (it.mode === "slot" && it.slot_count) {
            const perSlot = Math.floor(eff / it.slot_count);
            myPrice = perSlot * myQty;
            shareNote = `${myQty} bagian · ${fmt(perSlot)}/bagian`;
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
          const priceNote = it.discount_idr > 0
            ? `diskon ${fmt(it.discount_idr)} dari ${fmt(it.price_idr)}`
            : (it.mode !== "slot" && (data.sel_by_item[it.id] || []).length > 1
              ? `dari ${fmt(eff)}` : "");
          return `
          <div class="pay-item" data-item="${it.id}">
            <div style="flex:1;min-width:0;">
              <div class="item-name" style="font-size:14px;">${esc(it.name)}</div>
              ${/* the price note used to sit in the RIGHT column, which is
                    flex-shrink:0 — "diskon Rp 3.000 · dari Rp 38.000" then
                    pinned that column ~180px wide and squeezed the name into
                    one word per line on a 390px phone. It describes the
                    item's price, so it belongs under the item's name where
                    there is room to wrap (bug: v67 visual sweep). */ ""}
              ${priceNote || shareNote ? `<div class="item-share">${esc([shareNote, priceNote].filter(Boolean).join(" · "))}</div>` : ""}
            </div>
            <div style="text-align:right;flex-shrink:0;min-width:0;">
              <!-- client-side per-item price can drift 1 rupiah from the
                   backend's remainder distribution; the sheet total below is
                   the server's number, so label the row as an estimate
                   (bug: row said 33, subtotal said 34, same item) -->
              <div class="money">≈ ${fmt(myPrice)}</div>
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
          <!-- the bill's own PPN + SC used to be printed right next to the
               viewer's share, so two different numbers sat side by side and
               the row wrapped onto three lines. Their share is the only
               number that belongs in a personal confirmation. -->
          <span class="muted">Pajak &amp; service</span>
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
  bindCopyAccounts(s.sheet);
  $("#confirm-pay", s.sheet).addEventListener("click", (ev) =>
    withBusy(ev.currentTarget, "Nyimpen...", async () => {
      try {
        await api(`/api/bills/${data.bill.id}/payments/${me.id}/paid`, { method: "POST" });
        buzz(20);
        s.close();
        toast("Sudah dicatat! 🎉");
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
        toast("Status bayar dibatalkan");
        loadBillView(data.bill.id);
      } catch (e) { toast(e.message); }
    }));
}

// ---------- Where the money goes ----------
/** Payer + their payment accounts. ONE resolver, because the pay sheet and the
 *  standalone methods sheet must never name different destinations.
 *  Only fall back to the creator's accounts when the creator IS the payer (or
 *  no payer is declared yet). A resolved payer who hasn't added any payment
 *  method must NOT show the creator's accounts (bug: 'Metode bayar amel' was
 *  listing Aufa's GoPay/Mandiri/Jago because paid_by_accounts was empty and
 *  the sheet silently fell back to creator_accounts). */
function payerPayment(data) {
  const name = data.paid_by_name || data.creator_name;
  const isCreatorPayer = data.paid_by_id === data.bill.creator_identity_id
    || (!data.paid_by_id && !data.paid_by_name);
  const accounts = (data.paid_by_accounts && data.paid_by_accounts.length)
    ? data.paid_by_accounts
    : (isCreatorPayer ? (data.creator_accounts || []) : []);
  return { name, accounts };
}

function accountRowsHtml(name, accounts) {
  return accounts.length ? accounts.map(a => `
      <div class="account-row">
        ${brandLogoHtml(a.brand)}
        <div style="flex:1;min-width:0;">
          <div style="font-weight:600;font-size:14px;">${esc(brandLabel(a.brand))}</div>
          <div class="muted" style="font-size:13px;">${esc(a.account_no)}${a.holder_name ? " · " + esc(a.holder_name) : ""}</div>
        </div>
        <button class="btn-outline btn-sm copy-acct" data-no="${esc(a.account_no)}" aria-label="Salin nomor ${esc(a.brand)}">${ic("copy")} Salin</button>
      </div>`).join("")
    : `<div class="card card-flat"><div class="muted">${esc(name)} belum nambah metode bayar. Minta nomor rekening/e-money-nya langsung ya.</div></div>`;
}

function bindCopyAccounts(root) {
  $$(".copy-acct", root).forEach(b => b.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(b.dataset.no); toast("Nomor disalin 📋"); }
    catch (e) { toast("Gagal salin, copy manual ya"); }
  }));
}

// ---------- Accounts sheet (standalone payment methods) ----------
function openAccountsSheet(data) {
  const { name, accounts } = payerPayment(data);
  const s = openSheet(`
    <div class="sheet-handle"></div>
    <div class="sheet-title">Metode Bayar ${esc(name)}</div>
    <p class="sheet-sub">Transfer langsung ke ${esc(name)} lewat:</p>
    ${accountRowsHtml(name, accounts)}
    <button class="btn-outline" id="close-sheet">Tutup</button>`, { noAutofocus: true });
  bindCopyAccounts(s.sheet);
  $("#close-sheet", s.sheet).addEventListener("click", s.close);
}

// ---------- Creator view: summary ----------
// ONE creator-view status chip. source of truth order:
// settled (manual "Tandai Lunas" wins) -> closed states -> all_paid ->
// unpaid people -> uncovered slots -> fallback. The old code computed
// `statusChipHtml` (settled-based) for the header AND a separate chip
// (all_paid/totalUnpaid-based) for the second row, so one card could show
// "Lunas" next to "Rp X belum dibayar" (bug: two status systems, one screen).
function creatorStatusChip(data, closed, totalUnpaid, soloSoFar) {
  return renderBillStatusChip(data, closed, totalUnpaid, soloSoFar);
}

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
  const nonPayer = data.people.filter(p => p.identity_id !== payerId);
  const owedByOthers = nonPayer.reduce((s, p) => s + (p.total_idr || 0), 0);
  const totalUnpaid = nonPayer.filter(p => p.paid !== "paid").reduce((s, p) => s + (p.total_idr || 0), 0);
  const paidByOthers = Math.max(0, owedByOthers - totalUnpaid);
  const unpaidNames = nonPayer.filter(p => p.paid !== "paid").map(p => p.name);
  // The collect bar only makes sense while money is genuinely outstanding.
  // For settled/waiting states it lied (payer's own fronted share never
  // counts as "masuk", so a fully-settled bill showed a half-empty bar).
  const moneyOutstanding = owedByOthers > 0;
  const payerRow = data.people.find(p => p.identity_id === payerId);
  const pendingPickerNames = data.people
    .filter(p => p.identity_id !== payerId && !p.subtotal_idr && !hasPickedAny(data, p.identity_id))
    .map(p => p.name);
  // The dock follows this same derived state so its copy and the status chip
  // never disagree.
  const allSettled = (data.settled || (data.all_paid && data.uncovered_idr === 0))
    && pendingPickerNames.length === 0;
  // Nobody but the creator is on the bill yet. This is the moment right after
  // "Buat Tagihan", and the whole product depends on the link being sent — so the
  // screen leads with sharing instead of with warnings about a bill that has
  // not started (bug: a 3-second-old bill opened on "Belum lunas", a Rp 0 chip,
  // and a red-ish card listing every item as "tidak dipilih siapa pun".
  const soloSoFar = data.people.length <= 1 && !closed && !data.settled;
  const statusChip = creatorStatusChip(data, closed, totalUnpaid, soloSoFar);
  // !data.settled: a closed bill the owner marked lunas by hand is done —
  // printing "masih ada Rp X yang belum dibayar" under a green "Ditutup ·
  // lunas" chip is the same card arguing with itself
  const closedNotSettled = closed && !data.settled && (totalUnpaid > 0 || data.uncovered_idr > 0);

  // consolidated "perhatian" rows (single card, one row each)
  const warnRows = [];
  if (data.uncovered_slots.length) {
    warnRows.push({
      icon: "slot",
      // per_slot × empty != amount when eff % slot_count has a remainder —
      // show the honest total instead of misleading arithmetic
      text: `Bagian kosong belum terambil: ${data.uncovered_slots.map(u => `${esc(u.name)} (${u.empty} bagian kosong = ${fmt(u.amount_idr)})`).join(", ")}`,
      red: true,
    });
  }
  // "Item tidak dipilih siapa pun -> masuk ke yang nalangin" is true of every
  // item on a brand-new bill. Listing them all before anyone has even joined
  // reads as an error report, so hold it until there is someone to warn about.
  if (data.warnings.length && !soloSoFar) {
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
  if (pendingPickerNames.length) {
    warnRows.push({ icon: "pencil", text: `Belum pilih item: ${pendingPickerNames.map(m => esc(m)).join(", ")}` });
  }
  const warnHtml = warnRows.length ? `
    <div class="warn-card">
      ${warnRows.map(w => `<div class="warn-row${w.red ? " is-red" : ""}"${w.red ? ` style="color:var(--red);"` : ""}>${ic(w.icon)}<span>${w.text}</span></div>`).join("")}
    </div>` : "";

  // v62: a payer resolved by NAME (someone joined matching the placeholder
  // typed at creation) has an identity but no management powers until the
  // creator confirms them. Banner only in the creator view, dismissible
  // permanently per bill so it never nags again (user: "risi spam").
  const payerPendingConfirm = !data.paid_by_confirmed && data.paid_by_id
    && data.paid_by_id !== data.bill.creator_identity_id && !closed
    && !lsGet(`bagiin_payer_dismiss_${data.bill.id}`, false);
  const payerConfirmHtml = payerPendingConfirm ? `
    <div class="warn-card" style="margin-top:10px;">
      <div class="warn-row">${ic("alert")}<span><strong style="color:var(--text);">${esc(payerName)}</strong> sudah bergabung dan ditandai sebagai yang nalangin. Konfirmasi agar dia bisa mengedit bill ini.</span></div>
      <div class="btn-row" style="margin-top:8px;">
        <button class="btn-primary btn-sm" id="confirm-payer-btn">${ic("check")} Konfirmasi</button>
        <button class="btn-outline btn-sm" id="dismiss-payer-btn">Nanti aja</button>
      </div>
    </div>` : "";

  const inviteHtml = soloSoFar ? `
    <div class="card invite-card">
      <div class="invite-head">${ic("share")}<div>
        <div class="invite-title">Bagikan linknya sekarang</div>
        <div class="muted">Temen kamu tinggal buka link, tulis nama, terus centang item yang dia makan. Tidak perlu membuat akun.</div>
      </div></div>
      <div class="btn-row" style="margin-top:14px;">
        <button class="btn-primary" id="invite-share-btn">${ic("share")} Bagikan Link</button>
        <button class="btn-outline btn-auto" id="invite-copy-btn">${ic("copy")} Salin</button>
      </div>
    </div>` : "";

  const main = `
    ${inviteHtml}
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap;">
        <div style="min-width:0;">
          <div class="label-sm">Total bill</div>
          <div class="money hero-total">${fmt(data.bill.total_idr)}</div>
        </div>
        <!-- one status per card: solo, settled, closed, unpaid — all flow
             through creatorStatusChip so the header and the row below can
             never disagree -->
        <span>${statusChip}</span>
      </div>
      ${data.bill.title || data.bill.merchant ? `<div style="margin-top:4px;">${esc((data.bill.title || "").trim() || data.bill.merchant)}</div>` : ""}
      ${data.bill.transacted_at ? `<div class="muted">${esc(shortDate(data.bill.transacted_at))}</div>` : ""}
      ${!closed && allSettled ? `<p class="muted" style="margin-top:8px;color:var(--green);">${ic("check")} Semua sudah menandai lunas, bill otomatis selesai.</p>` : ""}
      ${moneyOutstanding ? `<div class="collect" style="margin-top:12px;">
        <div class="collect-track"><div class="collect-fill" style="width:${owedByOthers > 0 ? Math.min(100, Math.round(paidByOthers * 100 / owedByOthers)) : 0}%;"></div></div>
        <div class="collect-line" style="margin-top:6px;">
          <span class="muted">Sudah masuk <b class="money-sm${paidByOthers > 0 ? " collect-in" : ""}">${fmt(paidByOthers)}</b> dari <b class="money-sm">${fmt(owedByOthers)}</b></span>
          ${totalUnpaid > 0 ? `<span class="muted">Nunggu ${fmt(totalUnpaid)} dari ${unpaidNames.length === 1 ? esc(unpaidNames[0]) : `${unpaidNames.length} orang`}</span>` : `<span class="muted collect-success">Semua transferan udah masuk ✓</span>`}
        </div>
      </div>` : ""}
      ${data.bill.tax_included ? `<div class="muted" style="margin-top:4px;color:var(--green);">${ic("check")} Harga item sudah termasuk pajak — tidak ada PPN tambahan</div>` : ""}
      ${closedNotSettled ? `<p class="muted" style="margin-top:8px;color:var(--red);">${ic("alert")} Bill sudah ditutup, tetapi ${totalUnpaid > 0 ? `masih ada ${fmt(totalUnpaid)} yang belum dibayar` : `masih ada ${fmt(data.uncovered_idr)} bagian yang tidak terambil`}. Buka lagi kalau ingin memperbaikinya.</p>` : ""}
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:12px;">
        <span class="muted">Yang nalangin: <strong style="color:var(--text);">${esc(payerName)}</strong>${payerRow && payerRow.total_idr > 0 ? ` · bagian dia ${fmt(payerRow.total_idr)}` : ""}</span>
        ${!closed ? `<button class="btn-outline btn-sm" id="set-payer-btn" style="flex-shrink:0;">${ic("pencil")} Ubah</button>` : ""}
      </div>
      ${closed ? `<p class="muted" style="margin:8px 0 0;">${esc(payerName)} nalangin; transfer pembayaran ke ${esc(payerName)} sesuai kanal yang ditentukan.</p>` : ""}
      <!-- the card used to stack three identical full-width buttons: settle
           the whole bill, attach a photo, show payment methods — same weight,
           no hierarchy, with the most consequential one on top. Utilities go
           side by side; the one that changes money stands alone below. -->
      ${photoThumbsHtml(data)}
      <div class="btn-row" style="margin-top:10px;">
        <button class="btn-outline btn-sm" id="pay-methods-btn">${ic("wallet")} Metode Bayar</button>
        ${photoAddBtnHtml(data)}
      </div>
    </div>
    ${warnHtml}
    ${payerConfirmHtml}
    <div class="card">
      <div class="card-title">Pembagian <span class="muted">(${data.people.length} orang)</span></div>
      <div id="people-list">
        ${data.people.map(p => {
          const isMe = p.identity_id === me.id;
          const isPayer = p.identity_id === payerId;
          // same v60 rule as the guest view: a manually settled bill counts
          // everyone as done, or the rows contradict the header chip
          const paid = p.paid === "paid" || !!data.settled_manual;
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
                   style="${paid ? "background:var(--green-soft);color:var(--green);border:1px solid color-mix(in srgb, var(--green) 28%, transparent);" : ""}">${paid ? `${ic("check")} Lunas` : "Tandai lunas"}</button>`
              : `<span class="chip ${paid ? "chip-green" : "chip-red"}">${paid ? `${ic("check")} Lunas` : "Belum lunas"}</span>`);
          const canDelete = !!data.can_manage && !closed && !isMe;
          return `
          <div class="person-row swipe-row">
            <div class="swipe-under" aria-hidden="true"><span class="swipe-del">${ic("trash")} Hapus</span></div>
            <div class="swipe-front">
            <div class="avatar${isMe ? " avatar-me" : ""}">${esc(initials(p.name))}</div>
            <div class="person-info">
              <div class="person-name">${esc(p.name)}${isMe ? ' <span class="muted">(kamu)</span>' : ""}</div>
              <div class="person-sub">${sub}</div>
            </div>
            <div class="person-right">
              <div class="money person-total">${fmt(p.total_idr)}</div>
              ${statusHtml}
            </div>
            <span class="person-actions">
              ${canDelete ? `<button class="icon-btn ghost kebab-btn" aria-haspopup="menu" aria-expanded="false" aria-label="Aksi ${esc(p.name)}">${ic("kebab")}</button>
              <span class="row-menu" role="menu">
                <button class="row-menu-item danger remove-person" role="menuitem" data-id="${esc(p.identity_id)}" data-name="${esc(p.name)}">Hapus dari bill</button>
              </span>` : ""}
            </span>
            </div>
          </div>`;
        }).join("")}
      </div>
      ${!closed ? `
      <div class="btn-row" style="margin-top:10px;">
        <button class="btn-outline btn-sm" id="invite-person-btn">${ic("plus")} Undang Orang</button>
      </div>` : ""}
    </div>
    <div class="card">
      <div class="card-title">Item &amp; Siapa yang Pilih</div>
      ${!closed ? `<div class="btn-row" style="margin-bottom:10px;">
        <button class="btn-outline btn-sm" id="pick-mine-btn">${ic("hand")} Pilih Item</button>
        <button class="btn-outline btn-sm" id="edit-bill-btn">${ic("pencil")} Edit Bill</button>
      </div>` : ""}
      ${data.items.map(it => {
        const selList = (data.sel_by_item[it.id] || []);
        const isSlot = it.mode === "slot" && it.slot_count;
        const eff = Math.max(0, it.price_idr - (it.discount_idr || 0));
        const modeLabel = isSlot ? "Bagi per porsi" : "Dibagi rata";
        const priceHtml = it.discount_idr > 0
          ? `<span class="price-was">${fmt(it.price_idr)}</span> <span class="price-now">${fmt(eff)}</span>`
          : fmt(eff);
        let shareText;
        if (isSlot) {
          const perSlot = Math.floor(eff / it.slot_count);
          const perSlotMax = Math.ceil(eff / it.slot_count);
          const shareLabel = perSlot === perSlotMax
            ? `${fmt(perSlot)}/bagian`
            : `${fmt(perSlot)}–${fmt(perSlotMax).replace(/^Rp\s*/, "")}/bagian`;
          const taken = selList.reduce((s, x) => s + (x.qty || 1), 0);
          const empty = Math.max(0, it.slot_count - taken);
          shareText = `${taken}/${it.slot_count} · ${shareLabel}`
            + (selList.length ? ` · ${selList.map(s => `${esc(s.name)}${(s.qty || 1) > 1 ? ` ×${s.qty}` : ""}`).join(", ")}` : "")
            + (empty > 0 ? ` · <span style="color:var(--red);">${empty} kosong</span>` : "");
        } else {
          shareText = selList.length ? selList.map(s => `${esc(s.name)}${(s.qty || 1) > 1 ? ` ×${s.qty}` : ""}`).join(", ") : "belum dipilih";
        }
        return `
        <div class="item-row">
          <div class="item-info">
            <div class="item-name">${esc(it.name)} <span class="slot-badge">${modeLabel}</span></div>
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
      ${soloSoFar ? `
      <!-- "Belum beres Rp 0" says nothing on a bill nobody has joined -->
      <div class="dock-total">
        <span class="label">Nunggu temen kamu gabung</span>
      </div>` : `
      <div class="dock-total">
        <span class="label">${allSettled ? "Semua" : "Sisa pembayaran"}</span>
        <span class="money" id="my-total">${allSettled ? "Lunas" : fmt(totalUnpaid + data.uncovered_idr)}</span>
      </div>`}
      ${soloSoFar ? "" : allSettled ? `
      <div class="dock-split" style="flex-wrap:wrap;">
        <span>Sudah masuk <b class="money-sm">${fmt(totalPaid)}</b></span>
        <span>${data.people.length} orang</span>
      </div>`
      : `<div class="dock-split" style="flex-direction:column;gap:4px;align-items:stretch;">
        ${totalUnpaid > 0 ? `<span style="display:flex;justify-content:space-between;gap:8px;">Belum dibayar <b class="money-sm">${fmt(totalUnpaid)}</b></span>` : ""}
        ${data.uncovered_idr > 0 ? `<span style="display:flex;justify-content:space-between;gap:8px;">Bagian kosong <b class="money-sm">${fmt(data.uncovered_idr)}</b></span>` : ""}
        <span style="display:flex;justify-content:space-between;gap:8px;color:var(--text-3);">Sudah masuk <b class="money-sm">${fmt(totalPaid)}</b></span>
      </div>`}
      ${closed
        ? `<button class="btn-outline" id="reopen-bill-btn" style="color:var(--accent);border-color:var(--accent);">${ic("refresh")} Buka Bill Lagi</button>`
        : soloSoFar
          ? `<button class="btn-primary" id="dock-share-btn">${ic("share")} Bagikan Link</button>`
          : ""}
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
  // the invite card and the dock both lead to the same share sheet
  [$("#invite-share-btn"), $("#dock-share-btn")].forEach(b =>
    b && b.addEventListener("click", () => shareBill(data.bill.id, data.bill.title)));
  const copyBtn = $("#invite-copy-btn");
  if (copyBtn) copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(location.origin + "/#/b/" + data.bill.id);
      toast("Link disalin");
    } catch (e) {
      // clipboard needs a secure context / permission — fall back to the sheet
      shareBill(data.bill.id, data.bill.title);
    }
  });
  const pickBtn = $("#pick-mine-btn");
  if (pickBtn) pickBtn.addEventListener("click", () => {
    // Creator pick is a full-shell pseudo-layer on the same hash.
    if (pickLayer) pickLayer.finishQuiet();
    pickLayer = beginEditorLayer(data.bill.id);
    const layer = pickLayer;
    addEventListener("popstate", () => { if (pickLayer === layer) pickLayer = null; }, { once: true });
    renderCreatorPick(data);
  });
  const setPayerBtn = $("#set-payer-btn");
  if (setPayerBtn) setPayerBtn.addEventListener("click", () => openSetPayerSheet(data));
  // v62: confirm the name-resolved payer — same PUT the sheet uses, one tap.
  // Dismiss sets a per-bill flag so the banner never reappears (anti-spam).
  const confirmPayerBtn = $("#confirm-payer-btn");
  if (confirmPayerBtn) confirmPayerBtn.addEventListener("click", (ev) =>
    withBusy(ev.currentTarget, "Konfirmasi...", async () => {
      try {
        await apiJson(`/api/bills/${data.bill.id}/paid_by`, "PUT", { identity_id: data.paid_by_id });
        lsSet(`bagiin_payer_dismiss_${data.bill.id}`, true);
        toast(`${data.paid_by_name} dikonfirmasi sebagai yang nalangin ✓`);
        loadBillView(data.bill.id);
      } catch (e) { toast(e.message); }
    }));
  const dismissPayerBtn = $("#dismiss-payer-btn");
  if (dismissPayerBtn) dismissPayerBtn.addEventListener("click", () => {
    lsSet(`bagiin_payer_dismiss_${data.bill.id}`, true);
    loadBillView(data.bill.id);
  });
  const methodsBtn = $("#pay-methods-btn");
  if (methodsBtn) methodsBtn.addEventListener("click", () => openAccountsSheet(data));
  const editBtn = $("#edit-bill-btn");
  if (editBtn) editBtn.addEventListener("click", () => renderEditBill(data));
  const reopenBtn = $("#reopen-bill-btn");
  if (reopenBtn) reopenBtn.addEventListener("click", () => openReopenConfirm(data));
  // v60 bill-level settle buttons removed 2026-08-27: status is derived from
  // per-person Tandai Lunas now, no bulk manual flag (derived-only model).
  $$(".slot-mgr").forEach(b => b.addEventListener("click", () => {
    const it = data.items.find(x => x.id === parseInt(b.dataset.item, 10));
    if (it) openSlotManagerSheet(data, it);
  }));
  $$(".person-actions .kebab-btn").forEach(b => b.addEventListener("click", (ev) => {
    ev.stopPropagation();
    const menu = b.parentElement.querySelector(".row-menu");
    const open = menu.classList.contains("is-open");
    $$(".row-menu.is-open").forEach(m => m.classList.remove("is-open"));
    $$(".kebab-btn[aria-expanded=true]").forEach(x => x.setAttribute("aria-expanded", "false"));
    menu.classList.toggle("is-open", !open);
    b.setAttribute("aria-expanded", String(!open));
  }));
  // swipe reveal binds only to rows that can actually delete (menu item exists)
  $$(".person-row.swipe-row").forEach(row => bindSwipeDelete(row));
  $$(".remove-person").forEach(b => b.addEventListener("click", (ev) => {
    ev.stopPropagation();
    openRemovePersonConfirm(data, b.dataset.id, b.dataset.name);
  }));
  const invitePersonBtn = $("#invite-person-btn");
  if (invitePersonBtn) invitePersonBtn.addEventListener("click", () => openInviteSheet(data));
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
      toast(currentlyPaid ? `Lunas ${name} dibatalkan` : `${name} ditandai lunas ✓`);
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
    <p class="sheet-sub">${it.discount_idr > 0 ? `<s style="opacity:.5">${fmt(it.price_idr)}</s> → ${fmt(eff)}` : fmt(eff)} · ${fmt(perSlot)}/bagian · ${taken}/${n} terambil</p>
    <div style="display:flex;align-items:center;justify-content:center;gap:20px;margin-bottom:12px;">
      <button class="btn-outline mgr-dec" style="width:52px;height:52px;min-height:52px;font-size:22px;border-radius:var(--r-full);padding:0;" aria-label="Kurangi bagian">−</button>
      <div style="text-align:center;">
        <div style="font-size:40px;font-weight:800;" class="mgr-n">${n}</div>
        <div class="muted" style="font-size:12px;">Total Bagian</div>
      </div>
      <button class="btn-outline mgr-inc" style="width:52px;height:52px;min-height:52px;font-size:22px;border-radius:var(--r-full);padding:0;" aria-label="Tambah bagian">＋</button>
    </div>
    <p class="muted" style="margin-bottom:6px;">Minimal ${taken} bagian (yang sudah terambil). Harga per bagian sesuai total bagian.</p>
    <button class="btn-primary" id="mgr-save">Simpan</button>
    ${selList.length ? `<div class="label-sm" style="margin:16px 0 4px;">Pemegang Bagian</div>` : ""}
    ${selList.map(p => `
      <div class="account-row">
        <div style="flex:1;min-width:0;">${esc(p.name)} <span class="muted">×${p.qty || 1}</span></div>
        <!-- no identity id = a legacy name-only selection. The DELETE URL ends
             in an empty segment and 404s, so offer nothing rather than a
             button that can only fail (bug: "Lepas" that never released) -->
        ${p.id ? `<button class="btn-outline btn-sm mgr-free" data-id="${esc(p.id)}" data-name="${esc(p.name)}"
                style="color:var(--red);" aria-label="Lepas bagian ${esc(p.name)}">Lepas</button>` : ""}
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

// ---------- Direct invite: kontak terbukti ----------
// v64: owner can add someone who already has an identity WITHOUT them clicking
// the link. Picker shows "kontak terbukti" (people you've shared bills with),
// searchable by name. People already on THIS bill are marked so you don't
// re-invite. Auto-accept targets join instantly; others get a pending card.
function openInviteSheet(data) {
  const me = state.identity;
  const billId = data.bill.id;
  const onBill = new Set((data.people || []).map(p => p.identity_id));
  // the creator is on the bill only while they are still in it — since v58
  // they can walk out, and listing them under "Udah di bill ini" made the
  // person who left un-re-invitable from the sheet (bug: v65 audit)
  if (!data.bill.creator_left) onBill.add(data.bill.creator_identity_id);
  const s = openSheet(`
    <div class="sheet-handle"></div>
    <div class="sheet-title">Undang Orang</div>
    <p class="sheet-sub">Orang yang sudah pernah berbagi bill bersama kamu. Yang auto-accept langsung masuk — yang lain menunggu mereka menerimanya dari beranda.</p>
    <input id="invite-search" placeholder="Cari nama..." maxlength="30" autocomplete="off" style="margin-bottom:10px;">
    <div id="invite-list" style="max-height:46vh;overflow-y:auto;display:flex;flex-direction:column;gap:6px;">${skeletonRows(3)}</div>
    <button class="btn-outline" id="invite-cancel">Batal</button>`, { noAutofocus: true });

  const list = $("#invite-list", s.sheet);
  const search = $("#invite-search", s.sheet);
  search.focus();

  const renderList = (contacts) => {
    const fresh = contacts.filter(c => !onBill.has(c.id));
    const already = contacts.filter(c => onBill.has(c.id));
    list.innerHTML = `
      ${fresh.length ? fresh.map(c => `
        <div class="account-row">
          <div class="avatar" style="flex:0 0 auto;">${esc(initials(c.name))}</div>
          <div style="flex:1;min-width:0;">
            <div class="item-name">${esc(c.name)}</div>
            <div class="muted">${c.last_shared ? "pernah berbagi bill" : "kontak"}</div>
          </div>
          <button class="btn-primary btn-sm inv-send" data-id="${esc(c.id)}" data-name="${esc(c.name)}">${ic("plus")} Undang</button>
        </div>`).join("")
      : `<div class="empty-state" style="padding:14px 8px;">${ic("empty")}<p class="muted">${search.value.trim() ? "Tidak ditemukan. Coba nama lain." : "Belum ada kontak. Undang orang lewat link dulu — setelah dia bergabung sekali, dia akan muncul di sini."}</p></div>`}
      ${already.length ? `<p class="muted" style="margin-top:8px;font-size:12px;">Sudah ada di bill ini: ${already.map(c => esc(c.name)).join(", ")}</p>` : ""}`;
    $$(".inv-send", s.sheet).forEach(b => b.addEventListener("click", () =>
      withBusy(b, "Ngundang...", async () => {
        try {
          const r = await apiJson(`/api/bills/${billId}/invite`, "POST", { identity_id: b.dataset.id });
          toast(r.status === "joined"
            ? `${b.dataset.name} langsung masuk bill ✓`
            : `Undangan ke ${b.dataset.name} dikirim`);
          s.close();
          loadBillView(billId);
        } catch (e) { toast(e.message); }
      })));
  };

  let timer = null;
  let seq = 0;  // request-sequence guard: slow earlier search must not clobber a newer one
  const load = async (q) => {
    const mySeq = ++seq;
    try {
      const contacts = await api(`/api/identities/${me.id}/contacts${q ? "?q=" + encodeURIComponent(q) : ""}`);
      if (mySeq !== seq) return;  // stale response
      renderList(contacts);
    } catch (e) {
      if (mySeq !== seq) return;
      list.innerHTML = `<div class="empty-state">${ic("alert")}<p class="muted">${esc(e.message)}</p></div>`;
    }
  };
  search.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => load(search.value.trim()), 250);
  });
  load("");
  $("#invite-cancel", s.sheet).addEventListener("click", s.close);
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
    <div class="sheet-title">Siapa yang nalangin?</div>
    <p class="sheet-sub">Yang dipilih dianggap sudah lunas otomatis (dia yang mengeluarkan uang lebih dahulu), dan metode bayar yang ditampilkan ke orang lain menggunakan akun dia.</p>
    <div role="radiogroup" aria-label="Pilih orang yang nalangin" style="display:flex;flex-direction:column;gap:8px;">
      <button class="btn-outline payer-opt" role="radio" aria-checked="${data.paid_by_id === data.bill.creator_identity_id}" data-id="${esc(data.bill.creator_identity_id)}" data-name="${esc(data.creator_name)}" style="text-align:left;justify-content:flex-start;">
        ${data.paid_by_id === data.bill.creator_identity_id ? ic("check") : ""}<strong>${esc(data.creator_name)}</strong>
        <span class="muted">(${state.identity && data.bill.creator_identity_id === state.identity.id ? "kamu, pembuat" : "pembuat"})</span>
      </button>
      ${roster.filter(p => p.identity_id !== data.bill.creator_identity_id).map(p => `
        <button class="btn-outline payer-opt" role="radio" aria-checked="${data.paid_by_id === p.identity_id}" data-id="${esc(p.identity_id)}" data-name="${esc(p.name)}" style="text-align:left;justify-content:flex-start;">
          ${data.paid_by_id === p.identity_id ? ic("check") : ""}<strong>${esc(p.name)}</strong>
        </button>`).join("")}
    </div>
    <div style="height:1px;background:var(--border);margin:14px 0;"></div>
    <label for="payer-name-input">Atau ketik nama (buat yang belum join)</label>
    ${/* only prefill a name that ISN'T already one of the checked options
          above — echoing the confirmed payer's name back into the "someone
          who hasn't joined yet" box made the sheet look like it was asking
          the same question twice (v67 visual sweep) */ ""}
    <input id="payer-name-input" placeholder="Nama yang nalangin" value="${esc(data.paid_by_id ? "" : (data.paid_by_name || ""))}" maxlength="30" autocomplete="off">
    <button class="btn-primary" id="payer-name-save">Pakai Nama Ini</button>
    <button class="btn-outline" id="payer-cancel">Batal</button>`, { noAutofocus: true });

  let payerSaving = false;
  const setPayerBusy = (busy) => {
    payerSaving = busy;
    $$(".payer-opt", s.sheet).forEach(b => b.disabled = busy);
    nameInput.disabled = busy;
    saveBtn.disabled = busy;
  };
  const savePayer = (btn, body, name) => withBusy(btn, "Nyimpen...", async () => {
    if (payerSaving) return; // no in-flight guard before: two taps fired two racing PUTs
    setPayerBusy(true);
    try {
      await apiJson(`/api/bills/${data.bill.id}/paid_by`, "PUT", body);
      s.close();
      toast(`${name} ditandai sebagai yang nalangin ✓`);
      loadBillView(data.bill.id);
    } catch (e) {
      setPayerBusy(false);
      toast(e.message);
    }
  });
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
    <p class="sheet-sub">Tidak bisa dibatalkan. Orang lain yang sudah bergabung juga tidak akan bisa melihat bill ini lagi.</p>
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
let pickLayer = null;

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
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap;">
        <div style="min-width:0;">
          <div class="label-sm">Total bill</div>
          <div class="money hero-total">${fmt(data.bill.total_idr)}</div>
        </div>
        <span class="chip chip-accent">Kamu pembuat</span>
      </div>
      ${data.bill.merchant ? `<p class="muted" style="margin-top:6px;">${esc(data.bill.merchant)}</p>` : ""}
      <p class="muted" style="margin-top:8px;">Ketuk item yang kamu tanggung. Item slot bisa diambil lebih dari 1 bagian. Item bebas yang tidak dicentang siapa pun masuk ke kamu; bagian slot yang kosong tetap terlihat untuk diambil.</p>
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

  $("#back-btn").addEventListener("click", () => {
    const layer = pickLayer;
    pickLayer = null;
    if (layer) layer.finish(false);
    else loadBillView(data.bill.id);
  });
  bindItemRows(data, me);
  $("#done-btn").addEventListener("click", () => {
    const layer = pickLayer;
    pickLayer = null;
    if (layer) layer.finishQuiet();
    loadBillView(data.bill.id);
  });
  watchDock();
}

// ---------- Creator edit bill ----------
let editState = { items: [], subtotal: 0, tax: 0, service: 0, total: 0, title: "", transacted_at: "", merchant: "", tax_included: false };

// Full-screen editors are pseudo-layers: they hijack the whole app shell but
// have NO route of their own, so a raw system Back popped the real previous
// entry and dumped the user onto the home list (bug: tap Ubah, swipe back,
// land on list). One history sentinel mirrors the sheet scheme: gesture pops
// it, fires this listener, and the detail summary is restored instead.
// UI exits (back button / save) consume the sentinel first so no ghost
// entries linger behind them.
function beginEditorLayer(billId) {
  try { history.pushState({ bagiinEdit: true }, ""); } catch (e) {}
  let done = false;
  const listen = "popstate";
  const onPop = () => {
    if (done) return;
    done = true;
    removeEventListener(listen, onPop);
    loadBillView(billId).catch(() => {});
  };
  addEventListener(listen, onPop);
  return {
    // gesture-path: popstate already fired; just stop listening and restore
    // ui-path: consume the sentinel with one silent back(), then restore
    finish(viaPopstate) {
      if (done) return;
      done = true;
      removeEventListener(listen, onPop);
      if (!viaPopstate) {
        try { history.back(); } catch (e) {}
        setTimeout(() => { try { loadBillView(billId); } catch (e) {} }, 0);
      }
    },
    finishQuiet() {          // caller will restore the view itself (save flow)
      done = true;
      removeEventListener(listen, onPop);
      try { history.back(); } catch (e) {}
    },
  };
}

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
  editState._hadPayments = data.people.some(p => p.paid === "paid" && p.total_idr > 0);
  editState._originalTotals = {
    subtotal: editState.subtotal,
    tax: editState.tax,
    service: editState.service,
  };
  editState._originalItems = editState.items.map(it => ({
    id: it.id,
    price: it.price,
    discount: it.discount,
  }));
  editState._layer = beginEditorLayer(data.bill.id);
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
      <p class="muted" style="margin:-4px 0 10px;"><strong style="color:var(--text-2);">Bagi rata</strong>
      = siapa pun boleh centang, harganya dibagi rata sesuai porsi yang terambil.
      <strong style="color:var(--text-2);">Bagi per porsi</strong> = dibagi jadi N bagian tetap.</p>
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
          <span class="label-strong">Harga item sudah termasuk pajak</span>
          <span class="muted">Kalau struk menulis "termasuk pajak", harga item sudah menghitung pajaknya</span>
        </span>
        <input type="checkbox" id="tax-included-toggle" ${editState.tax_included ? "checked" : ""}>
      </label>
      <div id="tax-included-badge" class="info-box ${editState.tax_included ? "" : "hidden"}" style="margin-top:8px;color:var(--green);">${ic("check")} Harga item sudah termasuk pajak — PPN &amp; service tidak diisi, total mengikuti item</div>
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

  $("#back-btn").addEventListener("click", () => editState._layer.finish(false));
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
    <div class="item-row edit-item" style="flex-wrap:wrap;">
      <div class="edit-name" style="flex:2;min-width:140px;">
        <input data-role="name" data-idx="${idx}" value="${esc(it.name)}" placeholder="Nama Item" aria-label="Nama item" style="padding:9px 10px;">
      </div>
      <div style="flex:1;min-width:100px;">
        <input data-role="price" data-idx="${idx}" type="text" inputmode="numeric" class="input-money" value="${rupiahFmt(it.price)}" placeholder="0" aria-label="Harga item" style="padding:9px 10px;">
      </div>
      <button data-role="del" data-idx="${idx}" class="icon-btn" aria-label="Hapus item ini" style="color:var(--red);">${ic("trash")}</button>
      <div style="flex-basis:100%;padding:6px 0 0;display:flex;align-items:center;gap:8px;">
        <span class="label-sm" style="flex-shrink:0;">Potongan (diskon):</span>
        <input data-role="discount" data-idx="${idx}" type="text" inputmode="numeric" class="input-money" value="${rupiahFmt(it.discount)}" placeholder="0" aria-label="Potongan atau diskon item" style="padding:7px 9px;max-width:110px;">
        ${it.discount > 0 ? `<span class="disc-bayar" style="color:var(--green);font-weight:700;font-size:13px;">→ bayar ${rupiahFmt(Math.max(0, it.price - it.discount))}</span>` : ""}
      </div>
      <div style="flex-basis:100%;padding:2px 0 8px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap;">
          <span class="label-sm" style="flex-shrink:0;">Cara Bagi:</span>
          <button class="btn-outline btn-sm item-mode-btn ${it.mode !== "slot" ? "chip-active" : ""}" data-idx="${idx}" data-mode="free">Bagi rata</button>
          <button class="btn-outline btn-sm item-mode-btn ${it.mode === "slot" ? "chip-active" : ""}" data-idx="${idx}" data-mode="slot">Bagi per porsi</button>
          ${it.mode === "slot" ? `
          <div style="display:flex;align-items:center;gap:6px;margin-left:auto;">
            <span class="muted">bagi</span>
            <button class="btn-outline btn-sm slot-dec" data-idx="${idx}" aria-label="Kurangi bagian">−</button>
            <span class="slot-count" style="font-weight:700;min-width:18px;text-align:center;">${it.slot_count || 2}</span>
            <button class="btn-outline btn-sm slot-inc" data-idx="${idx}" aria-label="Tambah bagian">＋</button>
            <span class="muted">bagian</span>
          </div>` : ""}
        </div>
        ${/* per-slot price must divide the price AFTER discount, like calc.py
              (bug: this copy still divided the pre-discount price, so a
              discounted slot item showed one figure here and another on the
              bill screen). The "bebas" explainer is the same for every row —
              it lives once above the list instead of under all of them. */ ""}
        ${it.mode === "slot" ? `<div class="muted" style="font-size:12px;line-height:1.45;">
          Dibagi ${it.slot_count || 2} bagian tetap${it.price > 0 ? ` · ${rupiahFmt(Math.floor(Math.max(0, (it.price || 0) - (it.discount || 0)) / (it.slot_count || 2)))}/bagian` : ""}. Tiap orang bisa ambil 1+ bagian, yang kosong keliatan.
        </div>` : ""}
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
        warn.textContent = `Harga item (${fmt(sumItems)}) tampaknya sudah TERMASUK pajak, tetapi kamu mengisi subtotal ${fmt(subtotal)} + PPN. Aktifkan toggle "Harga item sudah termasuk pajak" agar tidak dihitung ganda.`;
      } else {
        warn.textContent = `Total item (${fmt(sumItems)}) beda dari subtotal (${fmt(subtotal)}). Cek kolom diskon tiap item.`;
      }
    } else warn.classList.add("hidden");
  }
}

async function saveEditBill(billId) {
  const btn = $("#save-bill-btn");
  const items = editState.items.filter(i => i.name && String(i.name).trim());
  // price 0 is legal (free item the backend accepts with minv=0) — only
  // blank rows are dropped (bug: saving an edit silently deleted free items)
  if (!items.length) { toast("Minimal 1 item"); return; }
  await withBusy(btn, "Nyimpen...", async () => {
    try {
      const originalTotals = editState._originalTotals;
      const originalItems = editState._originalItems;
      const totalsChanged = editState.subtotal !== originalTotals.subtotal
        || editState.tax !== originalTotals.tax
        || editState.service !== originalTotals.service;
      const originalById = new Map(originalItems.filter(i => i.id != null).map(i => [i.id, i]));
      const currentById = new Map(items.filter(i => i.id != null).map(i => [i.id, i]));
      const itemsChanged = originalItems.length !== items.length
        || originalItems.some(original => {
          const current = original.id == null ? null : currentById.get(original.id);
          return !current || current.price !== original.price || (current.discount || 0) !== (original.discount || 0);
        })
        || items.some(current => current.id == null || !originalById.has(current.id));
      if (editState._hadPayments && (totalsChanged || itemsChanged)) {
        const ok = await confirmSheet({
          title: "Perubahan menyentuh pembayaran",
          body: "Ada orang yang sudah ditandai lunas. Mengubah jumlah akan menggeser pembagian yang sudah dibayar.",
          confirmText: "Tetap Simpan",
          cancelText: "Batal",
        });
        if (!ok) return;
      }
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
      editState._layer.finishQuiet();
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
    <p class="sheet-sub">Siapa pun yang memegang link ini bisa memilih itemnya sendiri — tidak perlu membuat akun.</p>
    <div class="code-display" style="font-size:13px;letter-spacing:0;word-break:break-all;">${esc(url)}</div>
    <button class="btn-primary" id="share-copy">${ic("copy")} Salin Link</button>
    <button class="btn-outline" id="share-wa">${ic("share")} Kirim Lewat WhatsApp</button>
    ${navigator["share"] ? `<button class="btn-outline" id="share-native">${ic("share")} Bagikan Lewat Aplikasi Lain</button>` : ""}
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

