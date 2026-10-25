import { Link } from '@tanstack/react-router'
import { useBills, useRecap } from '../lib/queries'
import { formatRp } from '../lib/money'
import { AppShell } from '../components/AppShell'
import { Alert, BalanceCard, StatusBadge } from '../ds/primitives'

export function Recap({ identityId }: { identityId: string | null }) {
  const recap = useRecap(identityId)
  const bills = useBills(identityId)
  const data = recap.data
  const settledBills = (bills.data ?? []).filter((b) => b.settled)

  return (
    <AppShell title="Rekap" subtitle="Yang sudah final, dan yang masih jalan" active="recap">
      {recap.isError ? <Alert tone="danger" title="Gagal memuat rekap">{(recap.error as Error).message}</Alert> : null}
      {recap.isPending ? <div className="app-note">Memuat…</div> : null}

      {data ? (
        <>
          <BalanceCard
            label={data.final.net_idr >= 0 ? 'Bersih harus diterima' : 'Bersih harus dibayar'}
            value={Math.abs(data.final.net_idr)}
            note={data.final.bill_count + ' bill sudah final'}
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
              <div className="app-note">Belum ada bill final. Tandai bill lunas dulu supaya masuk ke sini.</div>
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
                      <small>{b.current_user.paid ? 'Kamu sudah lunas' : 'Kamu belum lunas'}</small>
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
