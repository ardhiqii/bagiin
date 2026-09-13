import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, CheckCircle, Clock, PencilSimple, Receipt, UsersThree, Wallet } from "@phosphor-icons/react";
import { api, normalizeRecap, onMutation } from "../lib/api";
import { createRequestGate } from "../lib/async-state";
import { getAliases, setAliases } from "../lib/identity-storage";
import { rupiahFmt } from "../lib/money";
import { navigate } from "../lib/routes";
import type { Identity, RecapAction, RecapBill, RecapResponse } from "../lib/types";
import { AppFrame, Topbar } from "../components/AppShell";
import { Alert, Badge, Button, Card, Dialog, Input, Label, Skeleton } from "../components/ui/primitives";

type RecapActionView = RecapAction & {
  kind?: string;
  name?: string;
  inviter_name?: string;
  invited_by_name?: string;
  provisional?: boolean;
};

type RecapBillView = RecapBill & {
  estimated_payable_idr?: number;
  estimated_receivable_idr?: number;
  current_user?: {
    total_idr?: number;
    direction?: string;
  };
};

type CounterpartyBill = {
  bill_id?: string;
  title?: string;
  status?: string;
  amount_idr?: number;
};

type PendingCounts = {
  count?: number;
  current_user?: number;
  waiting_other?: number;
  bill_ids?: string[];
};

type Counterparty = {
  identity_id?: string;
  name?: string;
  direction?: string;
  amount_idr?: number;
  bills?: CounterpartyBill[];
  pending?: PendingCounts;
};

type RecapPayload = Omit<RecapResponse, "final" | "provisional" | "actions"> & {
  final: Omit<RecapResponse["final"], "counterparties"> & { counterparties: Counterparty[] };
  provisional: Omit<RecapResponse["provisional"], "bills"> & { bills: RecapBillView[] };
  actions: { current_user: RecapActionView[]; waiting_other: RecapActionView[] };
};

type RecapWindow = Window & {
  api?: typeof api;
  renderRecap?: () => void;
  invalidateDerivedData?: () => void;
};

type RecapCacheEntry = {
  identityId: string;
  generation: number;
  fetchedAt: number;
  data?: RecapPayload;
  promise?: Promise<RecapPayload>;
};

const RECAP_CACHE_TTL = 30_000;
let recapCache: RecapCacheEntry | null = null;
let recapCacheGeneration = 0;

const RECAP_REASON_LABELS: Record<string, string> = {
  pending_selection: "Belum semua orang memilih item",
  uncovered_slots: "Ada slot yang belum terambil",
  open_bill: "Bill masih terbuka",
  payer_unresolved: "Pembayar belum dikonfirmasi",
  pending_workflow: "Masih ada langkah yang menunggu",
};

const RECAP_ACTION_LABELS: Record<string, string> = {
  accept_invite: "Terima undangan",
  select_items: "Pilih item kamu",
  pay_share: "Bayar bagianmu",
  confirm_payer: "Konfirmasi pembayar",
  wait_selection: "Menunggu pilihan item",
  wait_payment: "Menunggu pembayaran",
  wait_invite: "Menunggu undangan diterima",
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function recapResponseLooksValid(value: unknown): value is RecapPayload {
  const data = record(value);
  const final = data && record(data.final);
  const provisional = data && record(data.provisional);
  const actions = data && record(data.actions);
  return Boolean(
    data
      && final
      && finiteNumber(final.payable_idr)
      && finiteNumber(final.receivable_idr)
      && finiteNumber(final.net_idr)
      && finiteNumber(final.bill_count)
      && Array.isArray(final.counterparties)
      && provisional
      && finiteNumber(provisional.payable_idr)
      && finiteNumber(provisional.receivable_idr)
      && finiteNumber(provisional.bill_count)
      && Array.isArray(provisional.bills)
      && actions
      && Array.isArray(actions.current_user)
      && Array.isArray(actions.waiting_other),
  );
}

function normalizeRecapForRoute(value: unknown): RecapPayload {
  const data = record(value);
  const actions = data && record(data.actions);
  if (!data || !actions || !Array.isArray(actions.current_user)) {
    throw new Error("Respons rekap tidak lengkap. Coba lagi ya.");
  }
  const counts = data && record(data.counts);
  const normalized = normalizeRecap({
    ...data,
    counts: {
      ...(counts || {}),
      current_user: counts?.current_user === undefined ? actions.current_user.length : counts.current_user,
    },
  });
  if (!recapResponseLooksValid(normalized)) throw new Error("Respons rekap tidak lengkap. Coba lagi ya.");
  return normalized as unknown as RecapPayload;
}

function invalidateRecapCache(): void {
  recapCacheGeneration += 1;
  recapCache = null;
}

function fetchRecap(identityId: string): Promise<RecapPayload> {
  const now = Date.now();
  if (recapCache?.identityId === identityId && recapCache.data
    && now - recapCache.fetchedAt < RECAP_CACHE_TTL) {
    return Promise.resolve(recapCache.data);
  }
  if (recapCache?.identityId === identityId && recapCache.promise) return recapCache.promise;

  const entry: RecapCacheEntry = {
    identityId,
    generation: recapCacheGeneration,
    fetchedAt: 0,
  };
  entry.promise = api<unknown>(`/api/identities/${encodeURIComponent(identityId)}/recap`).then(value => {
    const data = normalizeRecapForRoute(value);
    if (recapCache === entry && recapCacheGeneration === entry.generation) {
      entry.data = data;
      entry.fetchedAt = Date.now();
      entry.promise = undefined;
    }
    return data;
  }).catch(error => {
    if (recapCache === entry) entry.promise = undefined;
    throw error;
  });
  recapCache = entry;
  return entry.promise;
}

function recapNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : 0;
}

function recapMoney(value: unknown): string {
  return rupiahFmt(Math.max(0, recapNumber(value)));
}

function recapName(value: unknown, fallback = "Tanpa nama"): string {
  const name = String(value ?? "").trim();
  return name || fallback;
}

function recapInitials(value: unknown): string {
  const words = recapName(value, "?").split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map(word => word.charAt(0)).join("").toUpperCase() || "?";
}

function recapBillHref(billId: unknown): string {
  return `#/b/${encodeURIComponent(String(billId || ""))}`;
}

function recapStatusLabel(status: unknown): string {
  if (status === "closed") return "Bill ditutup";
  if (status === "open") return "Bill masih terbuka";
  return "Status bill belum tersedia";
}

function recapReasonLabels(codes: unknown): string[] {
  const values = Array.isArray(codes) ? codes : [];
  const labels = values.map(code => RECAP_REASON_LABELS[String(code)] || "Masih perlu dilengkapi");
  return labels.length ? labels : ["Masih ada langkah yang menunggu"];
}

function recapAliasFor(identityId: string): string {
  return getAliases()[identityId] || "";
}

function recapDirectionCopy(direction: string, name: string): string {
  if (direction === "receive") return `${name} perlu bayar kamu`;
  if (direction === "pay") return `Kamu perlu bayar ke ${name}`;
  return "Arah pembayaran belum tersedia";
}

function recapDirectionVerb(direction: string): string {
  if (direction === "receive") return "Kamu menerima";
  if (direction === "pay") return "Kamu bayar";
  return "Jumlah terkait";
}

function recapLoading() {
  return <div className="stack">
    <section className="card recap-loading" aria-label="Memuat rekap" aria-busy="true">
      <Skeleton style={{ width: "42%", height: 13 }} />
      <Skeleton style={{ width: "76%", height: 34, marginTop: 12 }} />
      <div className="recap-money-grid" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10, marginTop: 14 }}>
        <Skeleton style={{ height: 88 }} />
        <Skeleton style={{ height: 88 }} />
      </div>
    </section>
    <section className="card"><Skeleton style={{ width: "38%" }} /><div className="stack-sm" style={{ marginTop: 10 }}><Skeleton style={{ height: 48 }} /><Skeleton style={{ height: 48 }} /><Skeleton style={{ height: 48 }} /></div></section>
  </div>;
}

function recapError(message: string, retry: () => void) {
  return <Card className="recap-state" role="alert">
    <div className="empty-state"><Receipt aria-hidden="true" /><strong>Rekap belum bisa dimuat.</strong><p className="muted">{message || "Cek koneksi kamu, lalu coba lagi."}</p></div>
    <div className="row wrap"><Button id="recap-retry" type="button" onClick={retry}><ArrowUpRight /> Coba Lagi</Button></div>
  </Card>;
}

function RecapSummary({ data }: { data: RecapPayload }) {
  const final = data.final;
  const net = recapNumber(final.net_idr);
  const finalBills = recapNumber(final.bill_count);
  const hasAnyData = finalBills > 0
    || final.counterparties.length > 0
    || recapNumber(data.provisional.bill_count) > 0
    || data.provisional.bills.length > 0
    || data.actions.current_user.length > 0
    || data.actions.waiting_other.length > 0;
  const netClass = net > 0 ? "recap-net-receive" : net < 0 ? "recap-net-pay" : "recap-net-zero";
  const netText = net > 0 ? "Kamu akan menerima bersih" : net < 0 ? "Kamu perlu bayar bersih" : "Tidak ada selisih bersih";
  return <section className="card recap-summary" aria-labelledby="recap-title">
    <div className="recap-heading" style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
      <div><h1 id="recap-title">Rekap Patungan</h1><p className="muted">Angka final dipisahkan dari bill yang masih menunggu tindakan.</p></div>
      {finalBills > 0 && <Badge tone="neutral">{finalBills} bill final</Badge>}
    </div>
    <div className="recap-money-grid" aria-label="Ringkasan bill final" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10, marginTop: 16 }}>
      <div className="recap-money-cell recap-money-pay"><span className="recap-money-label">Perlu dibayar</span><strong className="money recap-money-value">{recapMoney(final.payable_idr)}</strong><span className="recap-money-note">Tagihan final untuk kamu</span></div>
      <div className="recap-money-cell recap-money-receive"><span className="recap-money-label">Akan diterima</span><strong className="money recap-money-value">{recapMoney(final.receivable_idr)}</strong><span className="recap-money-note">Bagian orang lain ke kamu</span></div>
    </div>
    <div className={`recap-net-line ${netClass}`} style={{ display: "flex", justifyContent: "space-between", gap: 12, marginTop: 14 }}><span><b>Saldo bersih</b><small style={{ display: "block" }}>{netText}</small></span><strong className="money">{recapMoney(Math.abs(net))}</strong></div>
    <p className="muted recap-summary-note">Hanya bill dengan pembagian yang sudah selesai yang masuk ke angka final.</p>
    {!hasAnyData && <Alert className="recap-account-empty" tone="info"><Receipt aria-hidden="true" /><span>Rekap akan terisi setelah kamu membuat atau bergabung ke bill.</span></Alert>}
  </section>;
}

function CounterpartyBillRow({ bill, direction }: { bill: CounterpartyBill; direction: string }) {
  const billId = String(bill.bill_id || "");
  if (!billId) return null;
  return <div className="recap-bill-row" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", padding: "10px 0", borderTop: "1px solid var(--border)" }}>
    <div className="recap-bill-copy" style={{ minWidth: 0, flex: "1 1 180px" }}><strong>{recapName(bill.title, "Bill tanpa judul")}</strong><span className="muted" style={{ display: "block" }}>{recapStatusLabel(bill.status)} · {recapDirectionVerb(direction)} {recapMoney(bill.amount_idr)}</span></div>
    <a className="btn btn-outline btn-sm recap-bill-link" href={recapBillHref(billId)}>Lihat bill</a>
  </div>;
}

function counterpartyActions(data: RecapPayload, section: "current_user" | "waiting_other", identityId: string): RecapActionView[] {
  return data.actions[section].filter(action => String(action.counterparty_id || "") === identityId);
}

function CounterpartyPending({ person, data, display }: { person: Counterparty; data: RecapPayload; display: string }) {
  const identityId = String(person.identity_id || "");
  if (!identityId) return null;
  const pending = person.pending || {};
  const current = counterpartyActions(data, "current_user", identityId);
  const waiting = counterpartyActions(data, "waiting_other", identityId);
  const currentCount = Math.max(recapNumber(pending.current_user), current.length);
  const waitingCount = Math.max(recapNumber(pending.waiting_other), waiting.length);
  const count = Math.max(recapNumber(pending.count), currentCount + waitingCount);
  if (!count) return null;
  const actionBillIds = [...current, ...waiting].map(action => String(action.bill_id || "")).filter(Boolean);
  const billIds = Array.isArray(pending.bill_ids) ? pending.bill_ids.map(String).filter(Boolean) : [];
  const billCount = Math.max(new Set([...billIds, ...actionBillIds]).size, billIds.length);
  const summary = `${count} hal perlu tindakan${billCount ? ` · ${billCount} bill` : ""}`;
  const breakdown = `${currentCount} dari kamu · ${waitingCount} menunggu orang lain`;
  return <div className="info-box recap-person-pending" role="status" aria-label={`${display}: ${summary}. ${breakdown}`}>
    <strong className="recap-person-pending-count">{summary}</strong>
    <div className="recap-person-pending-breakdown" style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}><span className="badge badge-accent recap-pending-current">{currentCount} dari kamu</span><span className="badge badge-neutral recap-pending-waiting">{waitingCount} menunggu orang lain</span></div>
  </div>;
}

function CounterpartyCard({ person, data, onAlias }: { person: Counterparty; data: RecapPayload; onAlias: (identityId: string, canonical: string) => void }) {
  const identityId = String(person.identity_id || "");
  const canonical = recapName(person.name, "Orang lain");
  const alias = identityId ? recapAliasFor(identityId) : "";
  const display = alias || canonical;
  const direction = person.direction === "receive" || person.direction === "pay" ? person.direction : "unknown";
  const bills = Array.isArray(person.bills) ? person.bills : [];
  return <article className="card recap-person-card" data-counterparty-id={identityId}>
    <div className="recap-person-head" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <div className={`avatar ${direction === "receive" ? "avatar-me" : ""}`} aria-hidden="true">{recapInitials(display)}</div>
      <div className="recap-person-copy" style={{ minWidth: 0, flex: "1 1 130px" }}><div className="recap-person-name">{display}</div>{alias && alias !== canonical && <div className="recap-person-canonical">Nama bersama: {canonical}</div>}</div>
      <div className="recap-person-amount" style={{ textAlign: "right" }}><span className="recap-money-label" style={{ display: "block" }}>{direction === "receive" ? "Menerima" : direction === "pay" ? "Membayar" : "Jumlah"}</span><strong className="money">{recapMoney(person.amount_idr)}</strong></div>
    </div>
    <p className={`recap-person-direction ${direction === "receive" ? "is-receive" : direction === "pay" ? "is-pay" : "is-unknown"}`}>{recapDirectionCopy(direction, display)}</p>
    <CounterpartyPending person={person} data={data} display={display} />
    {identityId && <Button type="button" variant="ghost" size="sm" className="recap-alias-btn" data-identity={identityId} data-canonical={canonical} aria-label={`Ubah nama lokal untuk ${canonical}`} onClick={() => onAlias(identityId, canonical)}><PencilSimple /> Nama lokal</Button>}
    {bills.length > 0 && <div className="recap-bill-list" aria-label={`Rincian bill dengan ${display}`} style={{ marginTop: 8 }}>{bills.map((bill, index) => <CounterpartyBillRow key={`${bill.bill_id || "bill"}-${index}`} bill={bill} direction={direction} />)}</div>}
  </article>;
}

function Counterparties({ data, onAlias }: { data: RecapPayload; onAlias: (identityId: string, canonical: string) => void }) {
  const people = data.final.counterparties;
  return <section className="recap-section" aria-labelledby="recap-people-title">
    <div className="recap-section-heading" style={{ marginBottom: 10 }}><div><h2 id="recap-people-title">Rincian per orang</h2><p className="muted">Setiap kartu memakai nama bersama dari bill. Nama lokal hanya terlihat di device ini.</p></div></div>
    {people.length > 0 ? <div className="recap-person-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))", gap: 12 }}>{people.map((person, index) => <CounterpartyCard key={person.identity_id || `${person.name || "person"}-${index}`} person={person} data={data} onAlias={onAlias} />)}</div> : <Card className="recap-empty"><div className="empty-state"><UsersThree aria-hidden="true" /><p><strong>Belum ada saldo final lintas orang.</strong></p><p className="muted">Bill yang pembagiannya sudah selesai akan muncul di sini kalau masih ada pembayaran terbuka.</p></div></Card>}
  </section>;
}

function ProvisionalBillRow({ bill }: { bill: RecapBillView }) {
  const current = bill.current_user || {};
  const currentTotal = recapNumber(current.total_idr);
  const direction = current.direction === "receive" ? "Akan menerima" : current.direction === "pay" ? "Perlu dibayar" : "Jumlah kamu";
  return <div className="recap-provisional-row" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "12px 0", borderTop: "1px solid var(--border)" }}>
    <div className="recap-provisional-copy" style={{ minWidth: 0, flex: "1 1 180px" }}><strong>{recapName(bill.title, "Bill tanpa judul")}</strong><span className="muted" style={{ display: "block" }}>{recapStatusLabel(bill.status)}</span><div className="recap-reason-list" style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 6 }}>{recapReasonLabels(bill.reason_codes).map(reason => <span className="badge badge-neutral" key={reason}>{reason}</span>)}</div></div>
    <div className="recap-provisional-amounts" style={{ display: "grid", gap: 2, flex: "1 1 145px", fontSize: 13 }}><span>{direction} {recapMoney(currentTotal)}</span>{recapNumber(bill.estimated_payable_idr) > 0 && <span>Perlu dibayar {recapMoney(bill.estimated_payable_idr)}</span>}{recapNumber(bill.estimated_receivable_idr) > 0 && <span>Akan diterima {recapMoney(bill.estimated_receivable_idr)}</span>}</div>
    <a className="btn btn-outline btn-sm recap-bill-link" href={recapBillHref(bill.bill_id)}>Lihat bill</a>
  </div>;
}

function Provisional({ data }: { data: RecapPayload }) {
  const bills = data.provisional.bills;
  const count = recapNumber(data.provisional.bill_count) || bills.length;
  if (!count) return null;
  return <section className="card recap-provisional" aria-labelledby="recap-provisional-title">
    <div className="recap-section-heading" style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}><div><h2 id="recap-provisional-title">Perkiraan, belum final</h2><p className="muted">Bill ini belum masuk saldo bersih karena masih ada pembagian atau langkah yang belum selesai.</p></div><Badge tone="accent">{count} bill</Badge></div>
    <div className="recap-estimate-grid" aria-label="Perkiraan dari bill yang belum final" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10, marginTop: 14 }}><div><span>Perkiraan perlu dibayar</span><strong className="money" style={{ display: "block" }}>{recapMoney(data.provisional.payable_idr)}</strong></div><div><span>Perkiraan akan diterima</span><strong className="money" style={{ display: "block" }}>{recapMoney(data.provisional.receivable_idr)}</strong></div></div>
    {bills.length > 0 ? <div className="recap-provisional-list" style={{ marginTop: 8 }}>{bills.map((bill, index) => <ProvisionalBillRow key={bill.bill_id || index} bill={bill} />)}</div> : <div className="info-box recap-empty-inline" style={{ marginTop: 10 }}>Tidak ada bill yang masih berupa perkiraan.</div>}
  </section>;
}

function actionLabel(action: RecapActionView): string {
  return RECAP_ACTION_LABELS[action.kind || ""] || "Periksa bill";
}

function actionTarget(action: RecapActionView, waiting: boolean): string {
  const inviter = action.inviter_name || action.invited_by_name;
  if (action.kind === "accept_invite" && inviter) return recapName(inviter);
  if (action.name) return recapName(action.name);
  return waiting ? "orang lain" : "kamu";
}

function actionDetail(action: RecapActionView, waiting: boolean): string {
  if (action.kind === "accept_invite") {
    const inviter = action.inviter_name || action.invited_by_name;
    return inviter ? `Undangan dari ${recapName(inviter)}` : "Ada undangan yang menunggu jawabanmu";
  }
  if (action.kind === "select_items") return "Pilih item yang kamu ambil di bill ini.";
  if (action.kind === "pay_share") return "Jumlahnya mengikuti hitungan terbaru dari bill.";
  if (action.kind === "wait_payment") {
    const amount = recapNumber(action.amount_idr);
    return amount > 0 ? `Menunggu ${actionTarget(action, true)} membayar ${recapMoney(amount)}.` : `Menunggu ${actionTarget(action, true)} membayar bagian bill.`;
  }
  if (action.kind === "confirm_payer") return "Pastikan siapa yang benar-benar membayar bill ini.";
  if (action.kind === "wait_selection") return `Menunggu ${actionTarget(action, true)} memilih item.`;
  if (action.kind === "wait_invite") return `Menunggu ${actionTarget(action, true)} menerima undangan.`;
  return waiting ? "Belum ada tindakan dari orang lain." : "Buka bill untuk melihat langkah berikutnya.";
}

function ActionRow({ action, waiting }: { action: RecapActionView; waiting: boolean }) {
  const billId = String(action.bill_id || "");
  if (!billId) return null;
  const amount = recapNumber(action.amount_idr);
  return <div className="recap-action-row" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "12px 0", borderTop: "1px solid var(--border)" }}>
    <div className="recap-action-icon" aria-hidden="true"><UsersThree /></div>
    <div className="recap-action-copy" style={{ minWidth: 0, flex: "1 1 180px" }}><strong style={{ display: "block" }}>{actionLabel(action)}</strong><span className="recap-action-title" style={{ display: "block" }}>{recapName(action.title, "Bill tanpa judul")}</span><span className="muted" style={{ display: "block" }}>{actionDetail(action, waiting)}</span><span className="recap-action-target" style={{ display: "block" }}>{waiting ? "Menunggu" : "Untuk"} {actionTarget(action, waiting)}</span></div>
    <div className="recap-action-aside" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginLeft: "auto" }}>{amount > 0 && <span className="money recap-action-amount">{recapMoney(amount)}</span>}{action.provisional && <Badge tone="accent">Perkiraan</Badge>}<a className="btn btn-outline btn-sm recap-bill-link recap-action-link" href={recapBillHref(billId)}>Lihat bill</a></div>
  </div>;
}

function ActionSection({ waiting, actions }: { waiting: boolean; actions: RecapActionView[] }) {
  const id = waiting ? "recap-waiting-actions-title" : "recap-current-actions-title";
  return <section className={`card recap-action-card ${waiting ? "recap-waiting-card" : "recap-current-card"}`} aria-labelledby={id}>
    <div className="recap-section-heading" style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}><div><h2 id={id}>{waiting ? "Menunggu orang lain" : "Perlu kamu lakukan"}</h2><p className="muted">{waiting ? "Bill ini masih menunggu pilihan atau pembayaran orang lain." : "Langkah yang bisa kamu kerjakan sekarang."}</p></div><Badge tone={waiting ? "neutral" : "accent"}>{actions.length}</Badge></div>
    {actions.length > 0 ? <div className="recap-action-list">{actions.map((action, index) => <ActionRow key={`${action.bill_id}-${action.kind || "action"}-${index}`} action={action} waiting={waiting} />)}</div> : <div className="info-box recap-empty-inline" style={{ marginTop: 10 }}>Tidak ada {waiting ? "tindakan orang lain yang sedang ditunggu" : "yang perlu kamu lakukan sekarang"}.</div>}
  </section>;
}

function Actions({ data }: { data: RecapPayload }) {
  return <div className="recap-actions-grid" style={{ display: "grid", gap: 12 }}><ActionSection waiting={false} actions={data.actions.current_user} /><ActionSection waiting actions={data.actions.waiting_other} /></div>;
}

function RecapLoaded({ data, onAlias }: { data: RecapPayload; onAlias: (identityId: string, canonical: string) => void }) {
  return <div className="stack"><RecapSummary data={data} /><Counterparties data={data} onAlias={onAlias} /><Provisional data={data} /><Actions data={data} /></div>;
}

function AliasDialog({ target, onClose }: { target: { id: string; canonical: string } | null; onClose: () => void }) {
  if (!target) return null;
  const save = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const input = event.currentTarget.elements.namedItem("alias");
    const value = input instanceof HTMLInputElement ? input.value.trim().slice(0, 40) : "";
    const aliases = getAliases();
    if (value) aliases[target.id] = value;
    else delete aliases[target.id];
    setAliases(aliases);
    onClose();
  };
  return <Dialog open title="Nama lokal" description="Nama ini hanya tersimpan di device kamu. Nama bersama di bill tidak berubah." onClose={onClose}>
    <form id="recap-alias-form" onSubmit={save} noValidate className="stack-sm"><div className="field"><Label htmlFor="recap-alias-input">Nama untuk {target.canonical}</Label><Input id="recap-alias-input" name="alias" type="text" defaultValue={recapAliasFor(target.id)} maxLength={40} autoComplete="off" /><p className="muted">Kosongkan kalau mau kembali ke nama bersama.</p></div><div className="row wrap"><Button type="submit">Simpan</Button><Button type="button" variant="outline" onClick={onClose}>Batal</Button></div></form>
  </Dialog>;
}

export function RecapRoute({ identity }: { identity: Identity }) {
  const [data, setData] = useState<RecapPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [aliasTarget, setAliasTarget] = useState<{ id: string; canonical: string } | null>(null);
  const requestGate = useRef(createRequestGate());

  useEffect(() => {
    const token = requestGate.current.begin();
    setData(null);
    setLoading(true);
    setError("");
    void fetchRecap(identity.id).then(value => {
      if (requestGate.current.isCurrent(token)) setData(value);
    }).catch(err => {
      if (requestGate.current.isCurrent(token)) setError(err instanceof Error ? err.message : "Terjadi kendala saat mengambil rekap.");
    }).finally(() => {
      if (requestGate.current.isCurrent(token)) setLoading(false);
    });
    return () => requestGate.current.invalidate();
  }, [identity.id, refreshKey]);

  useEffect(() => onMutation(invalidateRecapCache), []);

  useEffect(() => {
    const globalWindow = window as RecapWindow;
    const rerender = () => {
      setData(null);
      setError("");
      setLoading(true);
      setRefreshKey(value => value + 1);
    };
    const renderRecap = () => {
      if (location.hash !== "#/recap") navigate({ kind: "recap" });
      else rerender();
    };
    globalWindow.api = api;
    globalWindow.renderRecap = renderRecap;
    globalWindow.invalidateDerivedData = invalidateRecapCache;
    window.addEventListener("bagiin:render-recap", rerender);
    return () => {
      window.removeEventListener("bagiin:render-recap", rerender);
      if (globalWindow.api === api) delete globalWindow.api;
      if (globalWindow.renderRecap === renderRecap) delete globalWindow.renderRecap;
      if (globalWindow.invalidateDerivedData === invalidateRecapCache) delete globalWindow.invalidateDerivedData;
    };
  }, []);

  const retry = () => {
    invalidateRecapCache();
    setData(null);
    setError("");
    setLoading(true);
    setRefreshKey(value => value + 1);
  };

  const currentUserActionCount = !loading && !error && data ? data.actions.current_user.length : undefined;
  return <AppFrame activeNav="recap" currentUserActionCount={currentUserActionCount}><Topbar title="Rekap patungan" backId="recap-back" back={() => navigate({ kind: "home" })} /><div className="shell"><div className="stack" aria-live="polite">{loading ? recapLoading() : error ? recapError(error, retry) : data ? <RecapLoaded data={data} onAlias={(id, canonical) => setAliasTarget({ id, canonical })} /> : null}</div></div><AliasDialog target={aliasTarget} onClose={() => setAliasTarget(null)} /></AppFrame>;
}