/* Bagiin frontend - Rekap Patungan
   Identity-scoped final balances, provisional workflow, and local aliases.
   The API is the source of truth for all amounts. This screen never rebuilds
   bill splits in the browser. */
"use strict";

const RECAP_REASON_LABELS = {
  pending_selection: "Belum semua orang memilih item",
  uncovered_slots: "Ada slot yang belum terambil",
  open_bill: "Bill masih terbuka",
  payer_unresolved: "Pembayar belum dikonfirmasi",
  pending_workflow: "Masih ada langkah yang menunggu",
};

const RECAP_ACTION_LABELS = {
  accept_invite: "Terima undangan",
  select_items: "Pilih item kamu",
  pay_share: "Bayar bagianmu",
  confirm_payer: "Konfirmasi pembayar",
  wait_selection: "Menunggu pilihan item",
  wait_payment: "Menunggu pembayaran",
  wait_invite: "Menunggu undangan diterima",
};

let recapGeneration = 0;
let recapData = null;

function recapNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function recapMoney(value) {
  return fmt(Math.max(0, recapNumber(value)));
}

function recapName(value, fallback = "Tanpa nama") {
  const name = String(value == null ? "" : value).trim();
  return name || fallback;
}

function recapInitials(value) {
  const words = recapName(value, "?").split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map(word => word.charAt(0)).join("").toUpperCase() || "?";
}

function recapReadAliases() {
  const stored = lsGet(LS_KEYS.recapAliases, null);
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return Object.create(null);
  const aliases = Object.create(null);
  Object.keys(stored).forEach((identityId) => {
    const alias = typeof stored[identityId] === "string" ? stored[identityId].trim().slice(0, 40) : "";
    if (alias) aliases[identityId] = alias;
  });
  return aliases;
}

function recapAliasFor(identityId) {
  const aliases = recapReadAliases();
  return typeof aliases[identityId] === "string" ? aliases[identityId] : "";
}

function recapSaveAlias(identityId, value) {
  const aliases = recapReadAliases();
  const alias = String(value || "").trim().slice(0, 40);
  if (alias) aliases[identityId] = alias;
  else delete aliases[identityId];
  lsSet(LS_KEYS.recapAliases, aliases);
}

function recapBillHref(billId) {
  return "#/b/" + encodeURIComponent(String(billId || ""));
}

function recapStatusLabel(status) {
  if (status === "closed") return "Bill ditutup";
  if (status === "open") return "Bill masih terbuka";
  return "Status bill belum tersedia";
}

function recapReasonLabels(codes) {
  const values = Array.isArray(codes) ? codes : [];
  const labels = values.map(code => RECAP_REASON_LABELS[code] || "Masih perlu dilengkapi");
  return labels.length ? labels : ["Masih ada langkah yang menunggu"];
}

function recapDirectionCopy(direction, name) {
  if (direction === "receive") return `${name} perlu bayar kamu`;
  if (direction === "pay") return `Kamu perlu bayar ke ${name}`;
  return "Arah pembayaran belum tersedia";
}

function recapDirectionVerb(direction) {
  if (direction === "receive") return "Kamu menerima";
  if (direction === "pay") return "Kamu bayar";
  return "Jumlah terkait";
}

function recapLoadingHtml() {
  return `
    <section class="card recap-loading" aria-label="Memuat rekap" aria-busy="true">
      <div class="sk sk-line" style="width:42%;height:13px;"></div>
      <div class="sk" style="width:76%;height:34px;margin-top:12px;"></div>
      <div class="recap-money-grid">
        <div class="sk" style="height:88px;"></div>
        <div class="sk" style="height:88px;"></div>
      </div>
    </section>
    <section class="card"><div class="sk sk-line" style="width:38%;"></div>${skeletonRows(3)}</section>`;
}

function recapErrorHtml(error) {
  const isStaleIdentity = error && error.status === 404;
  return `
    <section class="card recap-state" role="alert">
      <div class="empty-state">
        ${ic("alert")}
        <p><strong>${isStaleIdentity ? "Sesi kamu sudah tidak dikenal server." : "Rekap belum bisa dimuat."}</strong></p>
        <p class="muted">${esc(error && error.message ? error.message : "Terjadi kendala saat mengambil rekap.")}</p>
        <p class="muted">${isStaleIdentity
          ? "Coba lagi atau mulai ulang sesi ini kalau data device kamu sudah berubah."
          : "Cek koneksi kamu, lalu coba lagi. Angka tidak ditampilkan sebelum datanya berhasil dimuat."}</p>
      </div>
      <div class="btn-row recap-state-actions">
        <button type="button" class="btn-primary" id="recap-retry">${ic("refresh")} Coba Lagi</button>
        ${isStaleIdentity ? `<button type="button" class="btn-outline" id="recap-reset">Mulai Ulang</button>` : ""}
      </div>
    </section>`;
}

function recapSummaryHtml(data) {
  const final = data.final || {};
  const payable = recapNumber(final.payable_idr);
  const receivable = recapNumber(final.receivable_idr);
  const net = recapNumber(final.net_idr);
  const netClass = net > 0 ? "recap-net-receive" : net < 0 ? "recap-net-pay" : "recap-net-zero";
  const netText = net > 0
    ? "Kamu akan menerima bersih"
    : net < 0
      ? "Kamu perlu bayar bersih"
      : "Tidak ada selisih bersih";
  const finalBills = recapNumber(final.bill_count);
  const hasAnyData = finalBills > 0
    || (Array.isArray(final.counterparties) && final.counterparties.length > 0)
    || recapNumber((data.provisional || {}).bill_count) > 0
    || (Array.isArray((data.provisional || {}).bills) && data.provisional.bills.length > 0)
    || (Array.isArray((data.actions || {}).current_user) && data.actions.current_user.length > 0)
    || (Array.isArray((data.actions || {}).waiting_other) && data.actions.waiting_other.length > 0);
  return `
    <section class="card recap-summary" aria-labelledby="recap-title">
      <div class="recap-heading">
        <div>
          <h1 id="recap-title">Rekap Patungan</h1>
          <p class="muted">Angka final dipisahkan dari bill yang masih menunggu tindakan.</p>
        </div>
        ${finalBills ? `<span class="chip chip-grey">${finalBills} bill final</span>` : ""}
      </div>
      <div class="recap-money-grid" aria-label="Ringkasan bill final">
        <div class="recap-money-cell recap-money-pay">
          <span class="recap-money-label">Perlu dibayar</span>
          <strong class="money recap-money-value">${recapMoney(payable)}</strong>
          <span class="recap-money-note">Tagihan final untuk kamu</span>
        </div>
        <div class="recap-money-cell recap-money-receive">
          <span class="recap-money-label">Akan diterima</span>
          <strong class="money recap-money-value">${recapMoney(receivable)}</strong>
          <span class="recap-money-note">Bagian orang lain ke kamu</span>
        </div>
      </div>
      <div class="recap-net-line ${netClass}">
        <span><b>Saldo bersih</b><small>${netText}</small></span>
        <strong class="money">${recapMoney(Math.abs(net))}</strong>
      </div>
      <p class="muted recap-summary-note">Hanya bill dengan pembagian yang sudah selesai yang masuk ke angka final.</p>
      ${hasAnyData ? "" : `<div class="info-box recap-account-empty">${ic("receipt")}<span>Rekap akan terisi setelah kamu membuat atau bergabung ke bill.</span></div>`}
    </section>`;
}

function recapCounterpartyBillHtml(bill, direction) {
  const billId = String(bill && bill.bill_id || "");
  if (!billId) return "";
  const title = recapName(bill.title, "Bill tanpa judul");
  const amount = recapMoney(bill.amount_idr);
  return `
    <div class="recap-bill-row">
      <div class="recap-bill-copy">
        <strong>${esc(title)}</strong>
        <span class="muted">${esc(recapStatusLabel(bill.status))} · ${esc(recapDirectionVerb(direction))} ${amount}</span>
      </div>
      <a class="btn-outline btn-sm recap-bill-link" href="${esc(recapBillHref(billId))}">Lihat bill</a>
    </div>`;
}

function recapActionsForCounterparty(data, section, identityId) {
  const id = String(identityId || "");
  if (!id) return [];
  const actions = data && data.actions && Array.isArray(data.actions[section])
    ? data.actions[section] : [];
  return actions.filter(action => String(action && action.counterparty_id || "") === id);
}

function recapCounterpartyPending(person, data) {
  const identityId = String(person && person.identity_id || "");
  if (!identityId) return null;
  const pending = person && person.pending && typeof person.pending === "object"
    && !Array.isArray(person.pending) ? person.pending : {};
  const currentActions = recapActionsForCounterparty(data, "current_user", identityId);
  const waitingActions = recapActionsForCounterparty(data, "waiting_other", identityId);
  const currentCount = Math.max(recapNumber(pending.current_user), currentActions.length);
  const waitingCount = Math.max(recapNumber(pending.waiting_other), waitingActions.length);
  const count = Math.max(recapNumber(pending.count), currentCount + waitingCount);
  if (!count) return null;
  const actionBillIds = [...currentActions, ...waitingActions]
    .map(action => String(action && action.bill_id || ""))
    .filter(Boolean);
  const billIds = Array.isArray(pending.bill_ids)
    ? pending.bill_ids.map(billId => String(billId || "")).filter(Boolean)
    : [];
  const billCount = Math.max(new Set([...billIds, ...actionBillIds]).size, billIds.length);
  return { count, currentCount, waitingCount, billCount };
}

function recapCounterpartyPendingHtml(person, data, display) {
  const pending = recapCounterpartyPending(person, data);
  if (!pending) return "";
  const billText = pending.billCount ? ` · ${pending.billCount} bill` : "";
  const summary = `${pending.count} hal perlu tindakan${billText}`;
  const breakdown = `${pending.currentCount} dari kamu · ${pending.waitingCount} menunggu orang lain`;
  const ariaText = `${display}: ${summary}. ${breakdown}`;
  return `
    <div class="info-box recap-person-pending" role="status" aria-label="${esc(ariaText)}">
      <div class="recap-person-pending-heading">
        <strong class="recap-person-pending-count">${esc(summary)}</strong>
      </div>
      <div class="recap-person-pending-breakdown">
        <span class="chip chip-accent recap-pending-current">${esc(`${pending.currentCount} dari kamu`)}</span>
        <span class="chip chip-grey recap-pending-waiting">${esc(`${pending.waitingCount} menunggu orang lain`)}</span>
      </div>
    </div>`;
}

function recapCounterpartyHtml(person, data) {
  const identityId = String(person && person.identity_id || "");
  const canonical = recapName(person && person.name, "Orang lain");
  const alias = identityId ? recapAliasFor(identityId) : "";
  const display = alias || canonical;
  const direction = person && (person.direction === "receive" || person.direction === "pay")
    ? person.direction : "unknown";
  const amount = recapMoney(person && person.amount_idr);
  const bills = Array.isArray(person && person.bills) ? person.bills : [];
  const drilldown = bills.map(bill => recapCounterpartyBillHtml(bill, direction)).join("");
  return `
    <article class="recap-person-card" data-counterparty-id="${esc(identityId)}">
      <div class="recap-person-head">
        <div class="avatar ${direction === "receive" ? "avatar-me" : ""}" aria-hidden="true">${esc(recapInitials(display))}</div>
        <div class="recap-person-copy">
          <div class="recap-person-name">${esc(display)}</div>
          ${alias && alias !== canonical ? `<div class="recap-person-canonical">Nama bersama: ${esc(canonical)}</div>` : ""}
        </div>
        <div class="recap-person-amount">
          <span class="recap-money-label">${direction === "receive" ? "Menerima" : direction === "pay" ? "Membayar" : "Jumlah"}</span>
          <strong class="money">${amount}</strong>
        </div>
      </div>
      <p class="recap-person-direction ${direction === "receive" ? "is-receive" : direction === "pay" ? "is-pay" : "is-unknown"}">${esc(recapDirectionCopy(direction, display))}</p>
      ${recapCounterpartyPendingHtml(person, data, display)}
      ${identityId ? `<button type="button" class="btn-ghost btn-sm recap-alias-btn" data-identity="${esc(identityId)}" data-canonical="${esc(canonical)}" aria-label="Ubah nama lokal untuk ${esc(canonical)}">${ic("pencil")} Nama lokal</button>` : ""}
      ${drilldown ? `<div class="recap-bill-list" aria-label="Rincian bill dengan ${esc(display)}">${drilldown}</div>` : ""}
    </article>`;
}

function recapCounterpartiesHtml(data) {
  const people = Array.isArray(data.final && data.final.counterparties)
    ? data.final.counterparties : [];
  return `
    <section class="recap-section" aria-labelledby="recap-people-title">
      <div class="recap-section-heading">
        <h2 id="recap-people-title">Rincian per orang</h2>
        <p class="muted">Setiap kartu memakai nama bersama dari bill. Nama lokal hanya terlihat di device ini.</p>
      </div>
      ${people.length
        ? `<div class="recap-person-grid">${people.map(person => recapCounterpartyHtml(person, data)).join("")}</div>`
        : `<div class="card recap-empty">${ic("people")}<p><strong>Belum ada saldo final lintas orang.</strong></p><p class="muted">Bill yang pembagiannya sudah selesai akan muncul di sini kalau masih ada pembayaran terbuka.</p></div>`}
    </section>`;
}

function recapProvisionalBillHtml(bill) {
  const billId = String(bill && bill.bill_id || "");
  if (!billId) return "";
  const title = recapName(bill.title, "Bill tanpa judul");
  const reasons = recapReasonLabels(bill.reason_codes);
  const current = bill.current_user || {};
  const currentTotal = recapNumber(current.total_idr);
  const currentDirection = current.direction === "receive" ? "Akan menerima" : current.direction === "pay" ? "Perlu dibayar" : "Jumlah kamu";
  return `
    <div class="recap-provisional-row">
      <div class="recap-provisional-copy">
        <strong>${esc(title)}</strong>
        <span class="muted">${esc(recapStatusLabel(bill.status))}</span>
        <div class="recap-reason-list">${reasons.map(reason => `<span class="chip chip-grey">${esc(reason)}</span>`).join("")}</div>
      </div>
      <div class="recap-provisional-amounts">
        <span>${esc(currentDirection)} ${recapMoney(currentTotal)}</span>
        ${recapNumber(bill.estimated_payable_idr) ? `<span>Perlu dibayar ${recapMoney(bill.estimated_payable_idr)}</span>` : ""}
        ${recapNumber(bill.estimated_receivable_idr) ? `<span>Akan diterima ${recapMoney(bill.estimated_receivable_idr)}</span>` : ""}
      </div>
      <a class="btn-outline btn-sm recap-bill-link" href="${esc(recapBillHref(billId))}">Lihat bill</a>
    </div>`;
}

function recapProvisionalHtml(data) {
  const provisional = data.provisional || {};
  const bills = Array.isArray(provisional.bills) ? provisional.bills : [];
  const count = recapNumber(provisional.bill_count) || bills.length;
  if (!count) return "";
  return `
    <section class="card recap-provisional" aria-labelledby="recap-provisional-title">
      <div class="recap-section-heading">
        <div>
          <h2 id="recap-provisional-title">Perkiraan, belum final</h2>
          <p class="muted">Bill ini belum masuk saldo bersih karena masih ada pembagian atau langkah yang belum selesai.</p>
        </div>
        ${count ? `<span class="chip chip-accent">${count} bill</span>` : ""}
      </div>
      ${count ? `
        <div class="recap-estimate-grid" aria-label="Perkiraan dari bill yang belum final">
          <div><span>Perkiraan perlu dibayar</span><strong class="money">${recapMoney(provisional.payable_idr)}</strong></div>
          <div><span>Perkiraan akan diterima</span><strong class="money">${recapMoney(provisional.receivable_idr)}</strong></div>
        </div>` : ""}
      ${bills.length
        ? `<div class="recap-provisional-list">${bills.map(recapProvisionalBillHtml).join("")}</div>`
        : `<div class="recap-empty-inline">${ic("check")}<span>Tidak ada bill yang masih berupa perkiraan.</span></div>`}
    </section>`;
}

function recapActionLabel(action) {
  return RECAP_ACTION_LABELS[action && action.kind] || "Periksa bill";
}

function recapActionTarget(action, isWaiting) {
  const inviterName = action && (action.inviter_name || action.invited_by_name);
  if (action && action.kind === "accept_invite" && inviterName) return recapName(inviterName);
  if (action && action.name) return recapName(action.name);
  return isWaiting ? "orang lain" : "kamu";
}

function recapActionDetail(action, isWaiting) {
  if (action && action.kind === "accept_invite") {
    const inviterName = action.inviter_name || action.invited_by_name;
    return inviterName ? `Undangan dari ${recapName(inviterName)}` : "Ada undangan yang menunggu jawabanmu";
  }
  if (action && action.kind === "select_items") return "Pilih item yang kamu ambil di bill ini.";
  if (action && action.kind === "pay_share") return "Jumlahnya mengikuti hitungan terbaru dari bill.";
  if (action && action.kind === "wait_payment") {
    const debtor = recapActionTarget(action, true);
    const amount = recapNumber(action.amount_idr);
    return amount > 0
      ? `Menunggu ${debtor} membayar ${recapMoney(amount)}.`
      : `Menunggu ${debtor} membayar bagian bill.`;
  }
  if (action && action.kind === "confirm_payer") return "Pastikan siapa yang benar-benar membayar bill ini.";
  if (action && action.kind === "wait_selection") return `Menunggu ${recapActionTarget(action, true)} memilih item.`;
  if (action && action.kind === "wait_invite") return `Menunggu ${recapActionTarget(action, true)} menerima undangan.`;
  return isWaiting ? "Belum ada tindakan dari orang lain." : "Buka bill untuk melihat langkah berikutnya.";
}

function recapActionHtml(action, isWaiting) {
  const billId = String(action && action.bill_id || "");
  if (!billId) return "";
  const title = recapName(action && action.title, "Bill tanpa judul");
  const target = recapActionTarget(action, isWaiting);
  const amount = recapNumber(action && action.amount_idr);
  const provisional = action && action.provisional;
  return `
    <div class="recap-action-row">
      <div class="recap-action-icon" aria-hidden="true">${ic(isWaiting ? "people" : action.kind === "pay_share" ? "wallet" : "hand")}</div>
      <div class="recap-action-copy">
        <strong>${esc(recapActionLabel(action))}</strong>
        <span class="recap-action-title">${esc(title)}</span>
        <span class="muted">${esc(recapActionDetail(action, isWaiting))}</span>
        <span class="recap-action-target">${isWaiting ? "Menunggu" : "Untuk"} ${esc(target)}</span>
      </div>
      <div class="recap-action-aside">
        ${amount > 0 ? `<span class="money recap-action-amount">${recapMoney(amount)}</span>` : ""}
        ${provisional ? `<span class="chip chip-accent">Perkiraan</span>` : ""}
        <a class="btn-outline btn-sm recap-bill-link recap-action-link" href="${esc(recapBillHref(billId))}">Lihat bill</a>
      </div>
    </div>`;
}

function recapActionSectionHtml({ id, title, description, actions, empty, waiting }) {
  const list = Array.isArray(actions) ? actions : [];
  return `
    <section class="card recap-action-card ${waiting ? "recap-waiting-card" : "recap-current-card"}" aria-labelledby="${id}">
      <div class="recap-section-heading">
        <div><h2 id="${id}">${esc(title)}</h2><p class="muted">${esc(description)}</p></div>
        <span class="chip ${waiting ? "chip-grey" : "chip-accent"}">${list.length}</span>
      </div>
      ${list.length
        ? `<div class="recap-action-list">${list.map(action => recapActionHtml(action, waiting)).join("")}</div>`
        : `<div class="recap-empty-inline">${ic(waiting ? "check" : "check")}<span>${esc(empty)}</span></div>`}
    </section>`;
}

function recapActionsHtml(data) {
  const actions = data.actions || {};
  return `
    <div class="recap-actions-grid">
      ${recapActionSectionHtml({
        id: "recap-current-actions-title",
        title: "Perlu kamu lakukan",
        description: "Langkah yang bisa kamu kerjakan sekarang.",
        actions: actions.current_user,
        empty: "Tidak ada yang perlu kamu lakukan sekarang.",
        waiting: false,
      })}
      ${recapActionSectionHtml({
        id: "recap-waiting-actions-title",
        title: "Menunggu orang lain",
        description: "Bill ini masih menunggu pilihan atau pembayaran orang lain.",
        actions: actions.waiting_other,
        empty: "Tidak ada tindakan orang lain yang sedang ditunggu.",
        waiting: true,
      })}
    </div>`;
}

function recapLoadedHtml(data) {
  return [
    recapSummaryHtml(data),
    recapCounterpartiesHtml(data),
    recapProvisionalHtml(data),
    recapActionsHtml(data),
  ].join("");
}

function renderRecapLoaded(data, content) {
  if (!content || !content.isConnected) return;
  // The payload has already passed recapResponseLooksValid() before this
  // renderer is called. Update the shared mobile nav from that same snapshot,
  // never from a second request or a provisional client-side guess.
  updateAppNavBadge(data);
  content.innerHTML = recapLoadedHtml(data);
  $$(".recap-alias-btn", content).forEach(button => {
    button.addEventListener("click", () => openRecapAliasSheet(
      button.dataset.identity,
      button.dataset.canonical || "Orang lain",
      content,
    ));
  });
}

function openRecapAliasSheet(identityId, canonicalName, content) {
  const id = String(identityId || "");
  if (!id) return;
  const current = recapAliasFor(id);
  const sheet = openSheet(`
    <div class="sheet-handle"></div>
    <div class="sheet-title">Nama lokal</div>
    <p class="sheet-sub">Nama ini hanya tersimpan di device kamu. Nama bersama di bill tidak berubah.</p>
    <form id="recap-alias-form" novalidate>
      <div class="field">
        <label for="recap-alias-input">Nama untuk ${esc(canonicalName)}</label>
        <input id="recap-alias-input" name="alias" type="text" value="${esc(current)}" maxlength="40" autocomplete="off">
        <p class="muted">Kosongkan kalau mau kembali ke nama bersama.</p>
      </div>
      <div class="btn-row">
        <button type="submit" class="btn-primary">Simpan</button>
        <button type="button" class="btn-outline" id="recap-alias-cancel">Batal</button>
      </div>
    </form>`);
  const form = $("#recap-alias-form", sheet.sheet);
  const input = $("#recap-alias-input", sheet.sheet);
  $("#recap-alias-cancel", sheet.sheet).addEventListener("click", () => sheet.close());
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = input.value.trim();
    if (value.length > 40) {
      toast("Nama lokal maksimal 40 karakter");
      return;
    }
    recapSaveAlias(id, value);
    sheet.close();
    if (recapData && location.hash === "#/recap" && content && content.isConnected) {
      renderRecapLoaded(recapData, content);
    }
  });
}

function recapResponseLooksValid(data) {
  if (!data || typeof data !== "object") return false;
  const final = data.final;
  const provisional = data.provisional;
  const actions = data.actions;
  const numberFields = (value, fields) => value && typeof value === "object"
    && fields.every(field => typeof value[field] === "number" && Number.isFinite(value[field]));
  return !!(numberFields(final, ["payable_idr", "receivable_idr", "net_idr", "bill_count"])
    && numberFields(provisional, ["payable_idr", "receivable_idr", "bill_count"])
    && Array.isArray(provisional.bills)
    && actions && typeof actions === "object"
    && Array.isArray(actions.current_user)
    && Array.isArray(actions.waiting_other)
    && Array.isArray(final.counterparties));
}

async function loadRecapPage(root, content, identityId, generation) {
  const id = String(identityId || "");
  const cacheGeneration = derivedDataCache.generation;
  const cacheEntry = derivedDataCache.recap;
  const isCurrent = () => generation === recapGeneration
    && derivedDataCache.generation === cacheGeneration
    && derivedDataCache.identityId === id
    && identityKey(state.identity) === id
    && root && root.isConnected
    && content && content.isConnected
    && $("#app").firstElementChild === root
    && location.hash === "#/recap";
  if (!isCurrent()) return;
  // Loading and retry states are intentionally badge-free. A previous count
  // must not look current while this identity's recap is being replaced.
  clearAppNavBadge();
  if (derivedCacheIsFresh(cacheEntry, id) && recapResponseLooksValid(cacheEntry.data)) {
    recapData = cacheEntry.data;
    renderRecapLoaded(cacheEntry.data, content);
    return;
  }
  content.innerHTML = recapLoadingHtml();
  try {
    let request = cacheEntry.promise;
    const requestMatches = request
      && cacheEntry.promiseGeneration === cacheGeneration
      && cacheEntry.promiseIdentity === id;
    if (!requestMatches) {
      request = api(`/api/identities/${encodeURIComponent(id)}/recap`);
      cacheEntry.promise = request;
      cacheEntry.promiseGeneration = cacheGeneration;
      cacheEntry.promiseIdentity = id;
    }
    let data;
    try {
      data = await request;
    } finally {
      if (cacheEntry.promise === request) {
        cacheEntry.promise = null;
        cacheEntry.promiseGeneration = -1;
        cacheEntry.promiseIdentity = null;
      }
    }
    if (!recapResponseLooksValid(data)) throw new Error("Respons rekap tidak lengkap. Coba lagi ya.");
    if (derivedDataCache.generation === cacheGeneration
      && derivedDataCache.identityId === id
      && identityKey(state.identity) === id) {
      cacheEntry.data = data;
      cacheEntry.fetchedAt = Date.now();
    }
    if (!isCurrent()) return;
    recapData = data;
    renderRecapLoaded(data, content);
  } catch (error) {
    if (!isCurrent()) return;
    recapData = null;
    clearAppNavBadge();
    content.innerHTML = recapErrorHtml(error);
    const retry = $("#recap-retry", content);
    if (retry) retry.addEventListener("click", () => loadRecapPage(root, content, identityId, generation));
    const reset = $("#recap-reset", content);
    if (reset) reset.addEventListener("click", () => logout());
  }
}

function renderRecap() {
  const app = $("#app");
  const me = state.identity;
  if (!me) return;
  const generation = ++recapGeneration;
  recapData = null;
  clearAppNavBadge();
  app.innerHTML = shell(`
    <div class="recap-page">
      <div class="topbar">
        <button class="icon-btn" id="recap-back" aria-label="Kembali ke beranda">${ic("back")}</button>
        <div class="topbar-title">Rekap Patungan</div>
        <div class="right"><span class="recap-topbar-mark" aria-hidden="true">${ic("people")}</span></div>
      </div>
      <div id="recap-content" aria-live="polite">${recapLoadingHtml()}</div>
    </div>`);
  const root = app.firstElementChild;
  const content = $("#recap-content", root);
  $("#recap-back", root).addEventListener("click", () => { location.hash = "#/"; });
  loadRecapPage(root, content, me.id, generation);
}
