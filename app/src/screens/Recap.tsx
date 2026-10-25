import { Link } from '@tanstack/react-router'
import { useBills, useRecap } from '../lib/queries'
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

export function Recap({ identityId }: { identityId: string | null }) {
  const recap = useRecap(identityId)
  const bills = useBills(identityId)
  const data = recap.data
  const settledBills = (bills.data ?? []).filter((b) => b.settled)

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

          <section className="app-stack">
            <strong style={{ fontSize: 14, fontWeight: 800 }}>Sudah final</strong>
            {settledBills.length > 0 ? (
              <div>
                {settledBills.map((b) => (
                  <Link key={b.id} to="/b/$billId" params={{ billId: b.id }} style={{ textDecoration: 'none', color: 'inherit' }}>
                    <span className="app-row">
                      <span className="grow">
                        <b>{b.title}</b>
                        <small>Lunas · {b.my_total_idr > 0 ? 'bagian kamu ' + formatRp(b.my_total_idr) : 'tanpa bagian'}</small>
                      </span>
                      <span className="amt">{formatRp(b.total_idr)}</span>
                    </span>
                  </Link>
                ))}
              </div>
            ) : null}
            {data.final.counterparties.length === 0 ? (
              <div className="ds-empty-soft">
                <img src={recapArt} alt="" width={104} height={104} />
                <span className="app-note">Belum ada bill final. Tandai bill lunas supaya masuk ke sini.</span>
              </div>
            ) : (
              data.final.counterparties.map((c) => (
                <div className="app-row" key={c.identity_id}>
                  <span className="grow">
                    <b>{c.name}</b>
                    <small>{c.net_idr >= 0 ? 'Dia bayar ke kamu' : 'Kamu bayar ke dia'}</small>
                  </span>
                  <span className="amt">{formatRp(Math.abs(c.net_idr))}</span>
                </div>
              ))
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
              data.provisional.bills.map((b) => (
                <Link key={b.bill_id} to="/b/$billId" params={{ billId: b.bill_id }} style={{ textDecoration: 'none', color: 'inherit' }}>
                  <span className="app-row">
                    <span className="grow">
                      <b>{b.title}</b>
                      <small>{readableReasons(b.reason_codes)}</small>
                    </span>
                    <span className="amt">{formatRp(b.current_user.total_idr)}</span>
                  </span>
                </Link>
              ))
            )}
          </section>
        </>
      ) : null}
    </AppShell>
  )
}
