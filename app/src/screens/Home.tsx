import { Link } from '@tanstack/react-router'
import { useBills, useRecap } from '../lib/queries'
import { formatRp } from '../lib/money'
import { AppShell } from '../components/AppShell'
import { Alert, BalanceCard, Button, EmptyState } from '../ds/primitives'
import homeEmptyArt from '../assets/home-empty.webp'

function shortDate(value: string) {
  const parsed = new Date(value.replace(' ', 'T'))
  if (Number.isNaN(parsed.getTime())) return ''
  return parsed.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })
}

/**
 * Satu pola baris untuk semua daftar. Angka di kanan selalu BAGIAN SAYA —
 * bukan total bill — supaya tidak ada dua angka berbeda arti yang terlihat sama.
 */
function BillRow({ id, title, meta, share, label }: { id: string; title: string; meta: string; share: number; label: string }) {
  return (
    <Link to="/b/$billId" params={{ billId: id }} style={{ textDecoration: 'none', color: 'inherit' }}>
      <span className="app-row">
        <span className="grow">
          <b>{title}</b>
          <small>{meta}</small>
        </span>
        <span className="amt">
          {share > 0 ? formatRp(share) : '—'}
          <small style={{ display: 'block', fontWeight: 600, color: 'var(--ds-muted)' }}>{label}</small>
        </span>
      </span>
    </Link>
  )
}

export function Home({ identityId, name }: { identityId: string | null; name: string }) {
  const bills = useBills(identityId)
  const recap = useRecap(identityId)

  const rows = bills.data ?? []
  const open = rows.filter((b) => b.status === 'open' && !b.settled)
  const settled = rows.filter((b) => b.settled)
  const unpaid = open.filter((b) => !b.my_paid && b.my_total_idr > 0)
  const net = recap.data?.final.net_idr ?? 0
  const provisional = recap.data?.provisional

  return (
    <AppShell title={'Halo, ' + (name || 'Teman')} subtitle="Semua bill kamu di satu tempat" active="home">


      {bills.isError ? (
        <Alert tone="danger" title="Tidak bisa memuat bill">
          {(bills.error as Error).message}
        </Alert>
      ) : null}

      <BalanceCard
        label={net >= 0 ? 'Harus kamu terima' : 'Harus kamu bayar'}
        value={Math.abs(net)}
        note={
          provisional && provisional.bill_count > 0
            ? 'Belum termasuk ' + provisional.bill_count + ' bill yang masih berjalan'
            : 'Semua bill sudah selesai'
        }
      />

      {unpaid.length > 0 ? (
        <Alert tone="pending" title={unpaid.length + ' bill belum kamu selesaikan'}>
          Buka bill-nya, cek bagian kamu, lalu tandai lunas.
        </Alert>
      ) : null}

      <section className="app-stack">
        <div className="app-inline">
          <strong style={{ fontSize: 14, fontWeight: 800 }}>Bill berjalan</strong>
          <span className="app-spacer" />
          <Link to="/bills" style={{ fontSize: 12, color: 'var(--ds-teal)', fontWeight: 700, textDecoration: 'none' }}>
            Lihat semua
          </Link>
        </div>

        {bills.isPending ? (
          <div className="app-note">Memuat…</div>
        ) : open.length === 0 ? (
          <EmptyState
            title="Belum ada bill"
            art={<img className="ds-art" src={homeEmptyArt} alt="" width={216} height={216} />}
            action={
              <Link to="/create" style={{ textDecoration: 'none' }}>
                <Button>Buat bill</Button>
              </Link>
            }
          >
            Foto struk atau ketik manual, lalu bagikan link ke teman kamu.
          </EmptyState>
        ) : (
          <div className="app-list">
            {open.map((bill) => (
              <BillRow
                key={bill.id}
                id={bill.id}
                title={bill.title}
                meta={
                  shortDate(bill.created_at) +
                  ' · ' +
                  (bill.my_total_idr === 0 ? 'belum pilih item' : bill.my_paid ? 'bagianmu lunas' : 'belum lunas') +
                  (bill.pending_names.length > 0 ? ' · ' + bill.pending_names.length + ' orang belum bayar' : '')
                }
                share={bill.my_total_idr}
                label={bill.my_total_idr === bill.total_idr ? 'seluruh bill' : 'dari ' + formatRp(bill.total_idr)}
              />
            ))}
          </div>
        )}
      </section>

      {settled.length > 0 ? (
        <section className="app-stack">
          <strong style={{ fontSize: 14, fontWeight: 800 }}>Sudah lunas</strong>
          <div className="app-list">
            {settled.slice(0, 5).map((bill) => (
              <BillRow
                key={bill.id}
                id={bill.id}
                title={bill.title}
                meta={shortDate(bill.created_at) + ' · lunas'}
                share={bill.my_total_idr}
                label={bill.my_total_idr === bill.total_idr ? 'seluruh bill' : 'dari ' + formatRp(bill.total_idr)}
              />
            ))}
          </div>
        </section>
      ) : null}

      {recap.data && recap.data.final.counterparties.length > 0 ? (
        <section className="app-stack">
          <strong style={{ fontSize: 14, fontWeight: 800 }}>Siapa ke siapa</strong>
          <div>
            {recap.data.final.counterparties.map((c) => (
              <div className="app-row" key={c.identity_id}>
                <span className="grow">
                  <b>{c.name}</b>
                  <small>{c.net_idr >= 0 ? 'Dia harus bayar ke kamu' : 'Kamu harus bayar ke dia'}</small>
                </span>
                <span className="amt">{formatRp(Math.abs(c.net_idr))}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </AppShell>
  )
}
