import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowsDownUp, Funnel, Gear, Plus, Receipt, Trash, UsersThree } from "@phosphor-icons/react";
import { apiClient } from "../lib/api";
import { createRequestGate } from "../lib/async-state";
import { getListSort, setListSort } from "../lib/identity-storage";
import { localYearMonth, monthLabel, rupiahFmt, shortDate } from "../lib/money";
import { navigate } from "../lib/routes";
import type { BillListRow, Identity } from "../lib/types";
import { AppFrame, ErrorState, Topbar } from "../components/AppShell";
import { Alert, Badge, Button, Card, Dialog, Select, Skeleton } from "../components/ui/primitives";

type Filter = "all" | "due" | "ok" | "idle";
type Sort = "date_desc" | "date_asc" | "amount_desc" | "amount_asc" | "due_first";
const months = [["01", "Januari"], ["02", "Februari"], ["03", "Maret"], ["04", "April"], ["05", "Mei"], ["06", "Juni"], ["07", "Juli"], ["08", "Agustus"], ["09", "September"], ["10", "Oktober"], ["11", "November"], ["12", "Desember"]] as const;

function billDate(row: BillListRow): string { return row.transacted_at || row.created_at || ""; }
type SettledListRow = BillListRow & { settled_manual?: boolean };
function isSettled(row: BillListRow): boolean { return Boolean(row.settled || (row as SettledListRow).settled_manual); }
function timestamp(row: BillListRow): number {
  const value = billDate(row);
  if (!value) return 0;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(`${value.replace(" ", "T")}Z`);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}
function status(row: BillListRow): { tone: "success" | "danger" | "neutral"; label: string } {
  if (isSettled(row)) return { tone: "success", label: "Lunas" };
  if (row.pending_names?.length) return { tone: "neutral", label: "Menunggu memilih" };
  if ((row.total_unpaid || 0) > 0 || (row.uncovered_idr || 0) > 0) return { tone: "danger", label: "Belum lunas" };
  return { tone: "neutral", label: "Belum dipilih" };
}
function sortRows(rows: BillListRow[], mode: Sort): BillListRow[] {
  const rank = (row: BillListRow) => status(row).tone === "danger" ? 0 : status(row).tone === "neutral" ? 1 : 2;
  return [...rows].sort((a, b) => {
    if (mode === "amount_desc") return b.total_idr - a.total_idr || timestamp(b) - timestamp(a);
    if (mode === "amount_asc") return a.total_idr - b.total_idr || timestamp(b) - timestamp(a);
    if (mode === "date_asc") return timestamp(a) - timestamp(b);
    if (mode === "due_first") return rank(a) - rank(b) || timestamp(b) - timestamp(a);
    return timestamp(b) - timestamp(a);
  });
}

function BillRow({ row, onDelete }: { row: BillListRow; onDelete: (row: BillListRow) => void }) {
  const state = status(row);
  return <div className="history-row bill-row" role="button" tabIndex={0} data-id={row.id} aria-label={`Buka bill ${row.title}, ${state.label}`} onClick={() => navigate({ kind: "bill", billId: row.id })} onKeyDown={event => { if (event.target !== event.currentTarget) return; if (event.key === "Enter" || event.key === " ") { event.preventDefault(); navigate({ kind: "bill", billId: row.id }); } }}>
    <div className={`avatar status-mark status-${state.tone}`} aria-hidden="true"><Receipt /></div>
    <div className="bill-row-main"><div className="bill-row-title wrap"><strong className="grow">{row.title}</strong><span className="caption bill-row-date">{shortDate(billDate(row))}</span></div><div className="bill-row-meta wrap"><Badge className="chip" tone={state.tone}>{state.label}</Badge><span className="money bill-row-amount">{rupiahFmt(row.total_idr)}</span></div>{!isSettled(row) && row.i_am_payer && <div className="item-share">Kamu yang nalangin</div>}{!isSettled(row) && !row.i_am_payer && row.has_picks && !row.my_paid && <div className="item-share">Kamu belum bayar</div>}</div>
    {row.can_manage && <Button type="button" variant="ghost" size="icon" className="delete-bill" aria-label={`Hapus bill ${row.title}`} onClick={event => { event.stopPropagation(); onDelete(row); }}><Trash /></Button>}
  </div>;
}

export function HomeRoute({ identity }: { identity: Identity }) {
  const [rows, setRows] = useState<BillListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [year, setYear] = useState("all");
  const [month, setMonth] = useState("all");
  const [sort, setSort] = useState<Sort>(() => getListSort<Sort>("date_desc"));
  const [showControls, setShowControls] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<BillListRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const requestGate = useRef(createRequestGate());
  const load = async () => {
    const token = requestGate.current.begin();
    setLoading(true); setError("");
    try {
      const next = await apiClient.identities.bills(identity.id);
      if (requestGate.current.isCurrent(token)) setRows(next);
    } catch (err) {
      if (requestGate.current.isCurrent(token)) setError(err instanceof Error ? err.message : "Gagal memuat bill");
    } finally {
      if (requestGate.current.isCurrent(token)) setLoading(false);
    }
  };
  useEffect(() => {
    void load();
    return () => requestGate.current.invalidate();
  }, [identity.id]);
  const years = useMemo(() => [...new Set(rows.map(row => localYearMonth(billDate(row))?.y).filter((value): value is string => Boolean(value)))].sort().reverse(), [rows]);
  const filtered = useMemo(() => rows.filter(row => {
    const ym = localYearMonth(billDate(row));
    if (year !== "all" && ym?.y !== year) return false;
    if (month !== "all" && ym?.m !== month) return false;
    if (filter === "all") return true;
    return status(row).tone === (filter === "ok" ? "success" : filter === "due" ? "danger" : "neutral");
  }), [filter, month, rows, year]);
  const ordered = useMemo(() => sortRows(filtered, sort), [filtered, sort]);
  const updateSort = (value: Sort) => { setSort(value); setListSort(value); };
  const requestDelete = (row: BillListRow) => {
    if (!row.can_manage || deleteBusy) return;
    setDeleteError("");
    setDeleteTarget(row);
  };
  const closeDelete = () => {
    if (deleteBusy) return;
    setDeleteError("");
    setDeleteTarget(null);
  };
  const confirmDelete = async () => {
    if (!deleteTarget || deleteBusy) return;
    const target = deleteTarget;
    setDeleteBusy(true);
    setDeleteError("");
    try {
      await apiClient.bills.remove(target.id);
      setRows(current => current.filter(row => row.id !== target.id));
      setDeleteTarget(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Bill belum dapat dihapus");
    } finally {
      setDeleteBusy(false);
    }
  };
  const controls = <div className="list-controls"><div className="filter-chips">{([["all", "Semua"], ["due", "Belum lunas"], ["ok", "Lunas"], ["idle", "Belum dipilih"]] as const).map(([value, label]) => <button key={value} type="button" className="filter-chip" aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}</div><div className="filter-selects"><Select aria-label="Filter tahun" value={year} onChange={event => setYear(event.target.value)}><option value="all">Semua tahun</option>{years.map(value => <option key={value} value={value}>{value}</option>)}</Select><Select aria-label="Filter bulan" value={month} onChange={event => setMonth(event.target.value)}><option value="all">Semua bulan</option>{months.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select><Select aria-label="Urutan" value={sort} onChange={event => updateSort(event.target.value as Sort)}><option value="date_desc">Terbaru</option><option value="date_asc">Terlama</option><option value="amount_desc">Paling besar</option><option value="amount_asc">Paling kecil</option><option value="due_first">Belum beres dulu</option></Select></div></div>;
  const groups = ordered.reduce<Array<{ label: string; rows: BillListRow[] }>>((all, row) => { const label = monthLabel(billDate(row)) || "Tanpa tanggal"; const group = all.find(item => item.label === label); if (group) group.rows.push(row); else all.push({ label, rows: [row] }); return all; }, []);
  const dateSort = sort === "date_desc" || sort === "date_asc";
  return <><AppFrame activeNav="bill"><Topbar actions={<div className="nav-desktop-actions"><Button id="recap-btn" type="button" variant="ghost" size="icon" aria-label="Rekap Patungan" onClick={() => navigate({ kind: "recap" })}><UsersThree /></Button><Button id="settings-btn" type="button" variant="ghost" size="icon" aria-label="Akun kamu" onClick={() => navigate({ kind: "settings" })}><Gear /></Button></div>} /><div className="shell"><div className="page-intro"><p className="muted">Halo, {identity.name.split(" ")[0]}</p><h1>Mau bagi bill apa hari ini?</h1></div><div className="stack home-content"><Button id="create-btn" className="btn-block" onClick={() => navigate({ kind: "create" })}><Plus /> Buat bill baru</Button><Card className="stack"><div className="card-title"><span>Bill kamu <span className="list-summary" id="list-summary">{rows.length ? `${ordered.length === rows.length ? rows.length : `${ordered.length} dari ${rows.length}`} bill` : ""}</span></span>{(loading || rows.length > 0) && <Button id="list-ctl-btn" className="list-ctl-btn" type="button" variant="ghost" size="sm" disabled={loading} aria-busy={loading ? "true" : undefined} aria-haspopup="dialog" onClick={() => setShowControls(value => !value)}><Funnel /> Atur</Button>}</div><div className="desktop-controls list-controls-inline">{controls}</div>{!loading && <Dialog open={showControls} title="Filter & Urutkan" onClose={() => setShowControls(false)}>{controls}</Dialog>}{loading ? <div className="stack-sm" id="home-history">{Array.from({ length: 4 }, (_, index) => <div className="skeleton-row" key={index}><Skeleton className="status-mark" /><div className="skeleton-copy"><Skeleton style={{ width: "55%", height: 14 }} /><Skeleton style={{ width: "35%", height: 10 }} /></div></div>)}</div> : error ? <div id="home-history"><ErrorState message={error} retry={() => void load()} home={false} /></div> : rows.length === 0 ? <div id="home-history" className="empty-state"><Receipt /><strong>Belum ada bill</strong><p className="muted">Bill yang kamu buat atau ikuti akan muncul di sini.</p></div> : ordered.length === 0 ? <div id="home-history" className="empty-state"><Funnel /><strong>Tidak ada bill yang cocok</strong><p className="muted">Coba ganti filter yang dipilih.</p><Button size="sm" variant="outline" onClick={() => { setFilter("all"); setYear("all"); setMonth("all"); }}>Reset filter</Button></div> : <div id="home-history" className="bill-list">{(dateSort ? groups : [{ label: "", rows: ordered }]).map(group => <div key={group.label}>{group.label && <div className="history-month">{group.label}</div>}{group.rows.map(row => <BillRow row={row} key={row.id} onDelete={requestDelete} />)}</div>)}</div>}</Card></div></div></AppFrame><Dialog open={Boolean(deleteTarget)} title="Hapus bill ini?" description={deleteTarget ? `${deleteTarget.title}. Semua item, pembagian, dan catatan bayar di bill ini bakal kehapus permanen.` : undefined} onClose={closeDelete}><p className="sheet-sub">Tidak bisa dibatalkan. Orang lain yang sudah bergabung juga tidak akan bisa melihat bill ini lagi.</p>{deleteError && <Alert tone="danger">{deleteError}</Alert>}<div className="row wrap sheet-actions"><Button type="button" variant="outline" disabled={deleteBusy} onClick={closeDelete}>Batal</Button><Button id="confirm-delete-bill" type="button" variant="danger" disabled={deleteBusy} aria-busy={deleteBusy ? "true" : undefined} onClick={() => { void confirmDelete(); }}>{deleteBusy ? "Menghapus..." : "Hapus Selamanya"}</Button></div></Dialog></>;
}
