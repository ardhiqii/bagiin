import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRecap } from '../lib/queries'
import { api } from '../lib/api'
import { formatRp } from '../lib/money'
import { AppShell } from '../components/AppShell'
import { Alert, BalanceCard, Button, Sheet, StatusBadge } from '../ds/primitives'
import type { RecapBill } from '../lib/types'
import recapArt from '../assets/recap.webp'

/**
 * Alasan bill belum final, ditulis sebagai kalimat. Kode alasan dari backend
 * ("uncovered_slots") tidak berguna bagi orang yang membaca rekap; yang dia
 * butuh tahu: item apa yang belum ada pengakunya.
 */
function blockers(bill: RecapBill) {
  const parts: string[] = []
  for (const item of bill.uncovered_items) {
    parts.push(item.name + ' ' + formatRp(item.amount_idr) + ' belum ada yang ngaku')
  }
  // item yang tidak dipilih siapa pun: uangnya sudah masuk bagian pembayar,
  // tapi harus disebut supaya kelihatan
  for (const item of bill.owner_absorbed_items) {
    parts.push(item.name + ' ' + formatRp(item.amount_idr) + ' belum ada yang ngaku')
  }
  const named = new Set([...bill.uncovered_items, ...bill.owner_absorbed_items].map((i) => i.name))
  for (const name of bill.unassigned_items) {
    if (!named.has(name)) parts.push(name + ' belum ada yang pilih')
  }
  if (parts.length === 0) {
    if (bill.reason_codes.includes('pending_selection')) parts.push('ada yang belum pilih item')
    else if (bill.reason_codes.includes('open_bill')) parts.push('belum ada yang pilih item')
    else if (bill.reason_codes.includes('payer_unresolved')) parts.push('pembayar belum pasti')
    else parts.push('belum bisa dihitung pasti')
  }
  return parts.join(' · ')
}

function monthLabel(value: string | null) {
  if (!value) return 'Tanpa tanggal'
  const parsed = new Date(value.replace(' ', 'T'))
  if (Number.isNaN(parsed.getTime())) return 'Tanpa tanggal'
  return parsed.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })
}

type Tab = 'belum' | 'final'

/**
 * Rekap menjawab dua pertanyaan yang tidak boleh dicampur:
 *   1. berapa utang/piutang yang SUDAH PASTI (bill final),
 *   2. bill mana yang angkanya BELUM PASTI, dan kenapa.
 * Angka dari keduanya tidak pernah dijumlahkan; kalau dicampur, orang
 * mentransfer nominal yang salah.
 */
export function Recap({ identityId }: { identityId: string | null }) {
  const recap = useRecap(identityId)
  const qc = useQueryClient()
  const data = recap.data

  // tab dibuka di "Belum final": rekap dipakai untuk mencari yang belum beres,
  // bukan untuk membaca arsip
  const [tab, setTab] = useState<Tab>('belum')
  const [closing, setClosing] = useState<RecapBill | null>(null)

  const settle = useMutation({
    mutationFn: (billId: string) =>
      api<unknown>('/api/bills/' + billId + '/settle', { method: 'POST', body: {} }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recap'] })
      qc.invalidateQueries({ queryKey: ['bills'] })
      setClosing(null)
    },
  })

  const finalBills = useMemo(
    () =>
      [...(data?.final.bills ?? [])].sort((a, b) =>
        (b.created_at ?? '').localeCompare(a.created_at ?? ''),
      ),
    [data],
  )

  // arsip per bulan, terbaru di atas: 50+ bill dalam satu daftar tidak
  // menjawab "bulan ini aku keluar berapa"
  const groups = new Map<string, typeof finalBills>()
  for (const bill of finalBills) {
    const key = monthLabel(bill.created_at)
    const bucket = groups.get(key)
    if (bucket) bucket.push(bill)
    else groups.set(key, [bill])
  }

  const unpaid = data?.final.counterparties.filter((c) => c.payable_idr > 0) ?? []
  const owed = data?.final.counterparties.filter((c) => c.receivable_idr > 0) ?? []
  const provisional = data?.provisional.bills ?? []
  const kasaranPay = data?.provisional.payable_idr ?? 0
  const kasaranRecv = data?.provisional.receivable_idr ?? 0
  const belumCount = data?.provisional.bill_count ?? 0
  const finalCount = data?.final.bill_count ?? 0
  const emptyTab = tab === 'belum' ? provisional.length === 0 : finalBills.length === 0

  return (
    <AppShell
      title="Rekap"
      subtitle={belumCount > 0 ? belumCount + ' bill belum final' : 'Semua bill sudah final'}
      active="recap"
    >
      {recap.isError ? (
        <Alert tone="danger" title="Gagal memuat rekap">
          {(recap.error as Error).message}
        </Alert>
      ) : null}
      {recap.isPending ? <div className="app-note">Memuat…</div> : null}

      {data ? (
        <>
          {/* Angka pasti: hanya dari bill final. Yang belum final sengaja tidak
              dijumlahkan ke sini. */}
          <BalanceCard
            label={data.final.net_idr >= 0 ? 'Pasti: harus kamu terima' : 'Pasti: harus kamu bayar'}
            value={Math.abs(data.final.net_idr)}
            note={'dari ' + finalCount + ' bill final, angkanya sudah tidak berubah'}
          />

          {belumCount > 0 ? (
            <section className="app-stack">
              <div className="app-inline">
                <strong style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.04em', color: 'var(--ds-muted)' }}>
                  BELUM PASTI
                </strong>
                <span className="app-spacer" />
                <StatusBadge tone="pending">{belumCount} bill</StatusBadge>
              </div>
              <div className="app-list">
                {kasaranPay > 0 ? (
                  <div className="app-row">
                    <span className="grow">
                      <b>Mungkin kamu bayar</b>
                      <small>Bisa naik-turun selama bill di bawah belum final</small>
                    </span>
                    <span className="amt">
                      {formatRp(kasaranPay)}
                      <small style={{ display: 'block', fontWeight: 600, color: 'var(--ds-muted)' }}>
                        perkiraan
                      </small>
                    </span>
                  </div>
                ) : null}
                {kasaranRecv > 0 ? (
                  <div className="app-row">
                    <span className="grow">
                      <b>Mungkin kamu terima</b>
                      <small>Baru pasti setelah semua orang memilih</small>
                    </span>
                    <span className="amt">
                      {formatRp(kasaranRecv)}
                      <small style={{ display: 'block', fontWeight: 600, color: 'var(--ds-muted)' }}>
                        perkiraan
                      </small>
                    </span>
                  </div>
                ) : null}
                {kasaranPay === 0 && kasaranRecv === 0 ? (
                  <div className="app-row">
                    <span className="grow">
                      <b>Tidak ada kasaran untuk kamu</b>
                      <small>Bagianmu di bill yang belum final sudah kamu bayar semua</small>
                    </span>
                  </div>
                ) : null}
              </div>
            </section>
          ) : null}

          <div className="seg" role="tablist" aria-label="Saring rekap">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'belum'}
              className={'seg-btn' + (tab === 'belum' ? ' is-active' : '')}
              onClick={() => setTab('belum')}
            >
              Belum final <span className="seg-count">{belumCount}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'final'}
              className={'seg-btn' + (tab === 'final' ? ' is-active' : '')}
              onClick={() => setTab('final')}
            >
              Sudah final <span className="seg-count">{finalCount}</span>
            </button>
          </div>

          {emptyTab ? (
            <div className="ds-empty-soft">
              <img src={recapArt} alt="" width={104} height={104} />
              <span className="app-note">
                {tab === 'belum'
                  ? 'Tidak ada bill yang menunggu. Semua sudah final.'
                  : 'Belum ada bill final. Tandai bill lunas supaya masuk ke sini.'}
              </span>
            </div>
          ) : null}

          {tab === 'belum'
            ? provisional.map((bill) => (
                <div className="recap-pending" key={bill.bill_id}>
                  <Link
                    to="/b/$billId"
                    params={{ billId: bill.bill_id }}
                    style={{ textDecoration: 'none', color: 'inherit' }}
                  >
                    <span className="app-row">
                      <span className="grow">
                        <b>{bill.title}</b>
                        <small>{blockers(bill)}</small>
                        <span className="recap-payer">
                          {bill.paid_by_name
                            ? 'sisa ditanggung ' + bill.paid_by_name
                            : 'pembayar belum pasti'}
                        </span>
                      </span>
                      <span className="amt">
                        {formatRp(bill.current_user.total_idr)}
                        <small style={{ display: 'block', fontWeight: 600, color: 'var(--ds-muted)' }}>
                          {bill.current_user.paid ? 'bagianmu, sudah lunas' : 'bagianmu, belum lunas'}
                        </small>
                      </span>
                    </span>
                  </Link>
                  {bill.can_manage ? (
                    <div className="recap-pending-action">
                      <Button variant="secondary" onClick={() => setClosing(bill)}>
                        Tutup bill
                      </Button>
                    </div>
                  ) : null}
                </div>
              ))
            : null}

          {tab === 'final' ? (
            <>
              {unpaid.length > 0 ? (
                <section className="app-stack">
                  <strong style={{ fontSize: 14, fontWeight: 800 }}>Belum kamu transfer</strong>
                  <div className="app-list">
                    {unpaid.map((c) => (
                      <div className="app-row" key={c.identity_id}>
                        <span className="grow">
                          <b>{c.name}</b>
                          <small>
                            {c.receivable_idr > 0
                              ? 'dia juga bayar ' + formatRp(c.receivable_idr) + ' ke kamu'
                              : 'sudah final, tinggal transfer'}
                          </small>
                        </span>
                        <span className="amt">{formatRp(c.payable_idr)}</span>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              {owed.length > 0 ? (
                <section className="app-stack">
                  <strong style={{ fontSize: 14, fontWeight: 800 }}>Belum kamu tagih</strong>
                  <div className="app-list">
                    {owed.map((c) => (
                      <div className="app-row" key={c.identity_id}>
                        <span className="grow">
                          <b>{c.name}</b>
                          <small>
                            {c.payable_idr > 0
                              ? 'kamu juga bayar ' + formatRp(c.payable_idr) + ' ke dia'
                              : 'sudah final, tinggal ditagih'}
                          </small>
                        </span>
                        <span className="amt">{formatRp(c.receivable_idr)}</span>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              {finalBills.length > 0 ? (
                <div className="app-inline">
                  <strong style={{ fontSize: 14, fontWeight: 800 }}>Keluar per bulan</strong>
                  <span className="app-spacer" />
                  <span className="app-note" style={{ margin: 0 }}>
                    dari bill final
                  </span>
                </div>
              ) : null}

              {/* Daftar bill per bulan TIDAK diulang di sini: itu tugas Beranda.
                  Yang rekap butuhkan hanya angkanya — berapa yang keluar tiap
                  bulan — supaya satu layar tetap terbaca. */}
              <div className="app-list">
                {[...groups.entries()].map(([month, list]) => {
                  const subtotal = list.reduce((sum, bill) => sum + bill.my_total_idr, 0)
                  return (
                    <div className="app-row" key={month}>
                      <span className="grow">
                        <b>{month}</b>
                        <small>{list.length} bill final</small>
                      </span>
                      <span className="amt">
                        {formatRp(subtotal)}
                        <small style={{ display: 'block', fontWeight: 600, color: 'var(--ds-muted)' }}>
                          bagianmu
                        </small>
                      </span>
                    </div>
                  )
                })}
                <div className="app-row">
                  <span className="grow">
                    <b>Semua bill final</b>
                    <small>{finalBills.length} bill · termasuk yang belum kamu transfer</small>
                  </span>
                  <span className="amt">{formatRp(finalBills.reduce((sum, bill) => sum + bill.my_total_idr, 0))}</span>
                </div>
              </div>
            </>
          ) : null}

          <Sheet open={closing !== null} title="Tutup bill ini?" onClose={() => setClosing(null)}>
            {closing ? (
              <div className="app-stack">
                <div className="app-note" style={{ margin: 0 }}>
                  {closing.title} masih punya {blockers(closing)}. Kalau ditutup, sisa itu
                  ditanggung {closing.paid_by_name ?? 'pembayar'} dan angkanya tidak bisa diubah lagi.
                </div>
                <Button onClick={() => settle.mutate(closing.bill_id)} disabled={settle.isPending}>
                  {settle.isPending
                    ? 'Menutup…'
                    : 'Tutup, sisa ditanggung ' + (closing.paid_by_name ?? 'pembayar')}
                </Button>
                <Button variant="quiet" onClick={() => setClosing(null)}>
                  Tunggu dulu
                </Button>
              </div>
            ) : null}
          </Sheet>
        </>
      ) : null}
    </AppShell>
  )
}
