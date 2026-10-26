import { Link } from '@tanstack/react-router'
import { useRecap } from '../lib/queries'
import { formatRp } from '../lib/money'
import { AppShell } from '../components/AppShell'
import { Alert, BalanceCard, StatusBadge } from '../ds/primitives'
import recapArt from '../assets/recap.webp'

/** Kode alasan dari backend diterjemahkan ke kalimat yang bisa dibaca. */
const REASON: Record<string, string> = {
  open_bill: 'masih berjalan',
  unpaid: 'ada yang belum bayar',
  uncovered: 'ada item belum dipilih',
  pending_invite: 'undangan belum diterima',
  no_selection: 'belum ada yang memilih',
  payer_unresolved: 'pembayar belum pasti',
}

function readableReasons(codes: string[]) {
  const onlyOpen = codes.every((code) => code === 'open_bill')
  if (onlyOpen) return 'menunggu semua orang lunas'
  return codes
    .filter((code) => code !== 'open_bill')
    .map((code) => REASON[code] ?? code.replaceAll('_', ' '))
    .join(' · ')
}

function shortDate(value: string) {
  const parsed = new Date(value.replace(' ', 'T'))
  if (Number.isNaN(parsed.getTime())) return ''
  return parsed.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })
}

function monthLabel(value: string) {
  const parsed = new Date(value.replace(' ', 'T'))
  if (Number.isNaN(parsed.getTime())) return 'Tanpa tanggal'
  return parsed.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })
}

export function Recap({ identityId }: { identityId: string | null }) {
  const recap = useRecap(identityId)
  const data = recap.data
  // daftar final diambil dari respons rekap, bukan dari flag `settled` per bill:
  // angkanya dihitung dari aturan "pembagian sudah final", yang tidak sama
  // dengan "semua orang sudah lunas"
  const settledBills = data?.final.bills ?? []

  // dikelompokkan per bulan: 50+ bill final dalam satu daftar panjang tidak bisa
  // menjawab pertanyaan yang sebenarnya orang cari, "bulan ini aku keluar berapa"
  const groups = new Map<string, typeof settledBills>()
  for (const bill of settledBills) {
    const key = monthLabel(bill.created_at ?? '')
    const bucket = groups.get(key)
    if (bucket) bucket.push(bill)
    else groups.set(key, [bill])
  }

  return (
    <AppShell title="Rekap" subtitle="Yang sudah final dan yang masih berjalan" active="recap">
      {recap.isError ? <Alert tone="danger" title="Gagal memuat rekap">{(recap.error as Error).message}</Alert> : null}
      {recap.isPending ? <div className="app-note">Memuat…</div> : null}

      {data ? (
        <>
          <BalanceCard
            label={data.final.net_idr >= 0 ? 'Total bersih diterima' : 'Total bersih dibayar'}
            value={Math.abs(data.final.net_idr)}
            note={data.final.bill_count + ' bill final'}
          />

          {data.final.counterparties.length > 0 ? (
            <section className="app-stack">
              <strong style={{ fontSize: 14, fontWeight: 800 }}>Siapa ke siapa</strong>
              <div className="app-list">
                {data.final.counterparties.map((c) => (
                  <div className="app-row" key={c.identity_id}>
                    <span className="grow">
                      <b>{c.name}</b>
                      <small>{c.net_idr >= 0 ? 'Dia bayar ke kamu' : 'Kamu bayar ke dia'}</small>
                    </span>
                    <span className="amt">{formatRp(Math.abs(c.net_idr))}</span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <section className="app-stack">
            <div className="app-inline">
              <strong style={{ fontSize: 14, fontWeight: 800 }}>Sudah final</strong>
              <span className="app-spacer" />
              <span className="app-note" style={{ margin: 0 }}>
                {settledBills.length} bill
              </span>
            </div>

            {settledBills.length === 0 ? (
              <div className="ds-empty-soft">
                <img src={recapArt} alt="" width={104} height={104} />
                <span className="app-note">Belum ada bill final. Tandai bill lunas supaya masuk ke sini.</span>
              </div>
            ) : (
              [...groups.entries()].map(([month, list]) => {
                const subtotal = list.reduce((sum, bill) => sum + bill.my_total_idr, 0)
                return (
                  <div className="recap-month" key={month}>
                    <div className="recap-month-head">
                      <span>{month}</span>
                      <span>{formatRp(subtotal)}</span>
                    </div>
                    <div className="app-list">
                      {list.map((bill) => (
                        <Link
                          key={bill.bill_id}
                          to="/b/$billId"
                          params={{ billId: bill.bill_id }}
                          style={{ textDecoration: 'none', color: 'inherit' }}
                        >
                          <span className="app-row">
                            <span className="grow">
                              <b>{bill.title}</b>
                              <small>
                                {shortDate(bill.created_at ?? '')}
                                {bill.merchant ? ' · ' + bill.merchant : ''}
                                {bill.my_total_idr === 0 ? ' · tanpa bagian' : ''}
                              </small>
                            </span>
                            <span className="amt">
                              {bill.my_total_idr > 0 ? formatRp(bill.my_total_idr) : '—'}
                              <small style={{ display: 'block', fontWeight: 600, color: 'var(--ds-muted)' }}>
                                {bill.my_total_idr === bill.total_idr
                                  ? 'seluruh bill'
                                  : 'dari ' + formatRp(bill.total_idr)}
                              </small>
                            </span>
                          </span>
                        </Link>
                      ))}
                    </div>
                  </div>
                )
              })
            )}
          </section>

          <section className="app-stack">
            <div className="app-inline">
              <strong style={{ fontSize: 14, fontWeight: 800 }}>Masih berjalan</strong>
              <span className="app-spacer" />
              <StatusBadge tone="pending">{data.provisional.bill_count} bill</StatusBadge>
            </div>
            {data.provisional.bills.length === 0 ? (
              <div className="app-note">Tidak ada bill berjalan.</div>
            ) : (
              <div className="app-list">
                {data.provisional.bills.map((b) => (
                  <Link
                    key={b.bill_id}
                    to="/b/$billId"
                    params={{ billId: b.bill_id }}
                    style={{ textDecoration: 'none', color: 'inherit' }}
                  >
                    <span className="app-row">
                      <span className="grow">
                        <b>{b.title}</b>
                        <small>{readableReasons(b.reason_codes)}</small>
                      </span>
                      <span className="amt">
                        {formatRp(b.current_user.total_idr)}
                        <small style={{ display: 'block', fontWeight: 600, color: 'var(--ds-muted)' }}>
                          bagian kamu
                        </small>
                      </span>
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </>
      ) : null}
    </AppShell>
  )
}
