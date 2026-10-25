import { Link } from '@tanstack/react-router'
import { useBills } from '../lib/queries'
import { formatRp } from '../lib/money'
import { AppShell } from '../components/AppShell'
import { Alert, EmptyState } from '../ds/primitives'
import emptyArt from '../assets/empty-bill.webp'

export function Bills({ identityId }: { identityId: string | null }) {
  const bills = useBills(identityId)
  const rows = bills.data ?? []
  const open = rows.filter((b) => b.status === 'open')
  const closed = rows.filter((b) => b.status !== 'open')

  const list = (items: typeof rows, empty: string) =>
    items.length === 0 ? (
      <div className="app-note">{empty}</div>
    ) : (
      <div>
        {items.map((b) => (
          <Link key={b.id} to="/b/$billId" params={{ billId: b.id }} style={{ textDecoration: 'none', color: 'inherit' }}>
            <span className="app-row">
              <span className="grow">
                <b>{b.title}</b>
                <small>
                  {b.merchant ? b.merchant + ' · ' : ''}
                  {b.status === 'open' ? 'berjalan' : 'ditutup'}
                  {b.can_manage ? ' · kamu yang atur' : ''}
                </small>
              </span>
              <span className="amt">
                {formatRp(b.total_idr)}
                <small style={{ display: 'block', fontWeight: 600 }}>{b.settled ? 'Lunas' : b.my_paid ? 'Kamu lunas' : 'Belum'}</small>
              </span>
            </span>
          </Link>
        ))}
      </div>
    )

  return (
    <AppShell title="Semua bill" subtitle={rows.length + ' bill tercatat'} active="bill">
      {bills.isError ? <Alert tone="danger" title="Gagal memuat">{(bills.error as Error).message}</Alert> : null}
      {bills.isPending ? <div className="app-note">Memuat…</div> : null}

      {!bills.isPending && rows.length === 0 ? (
        <EmptyState title="Belum ada bill" art={<img className="ds-art" src={emptyArt} alt="" width={180} height={180} />}>
          Bill yang kamu buat atau ikuti akan muncul di sini.
        </EmptyState>
      ) : null}

      {open.length > 0 ? (
        <section className="app-stack">
          <strong style={{ fontSize: 14, fontWeight: 800 }}>Berjalan</strong>
          {list(open, '')}
        </section>
      ) : null}

      {closed.length > 0 ? (
        <section className="app-stack">
          <strong style={{ fontSize: 14, fontWeight: 800 }}>Selesai</strong>
          {list(closed, '')}
        </section>
      ) : null}
    </AppShell>
  )
}
