import { Link } from '@tanstack/react-router'
import { useBills, useRecap } from '../lib/queries'
import { formatRp } from '../lib/money'
import { AppShell } from '../components/AppShell'
import { Alert, BalanceCard, Button, EmptyState, Field, StatusBadge } from '../ds/primitives'
import emptyArt from '../assets/empty-bill.webp'
import { useState } from 'react'

function NamePrompt({ onRenamed }: { onRenamed: (next: string) => Promise<void> }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    if (!name.trim()) return
    setBusy(true)
    setError('')
    try {
      await onRenamed(name.trim())
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ds-card ds-card-mint ds-pad-md" style={{ display: 'grid', gap: 10 }}>
      <b style={{ fontSize: 14 }}>Kenalan dulu</b>
      <p className="app-note" style={{ margin: 0 }}>Nama ini yang muncul ke teman waktu kamu ikut bill. Tanpa akun, tanpa password.</p>
      <Field id="onboard-name" label="Nama kamu" value={name} onChange={setName} error={error || undefined} />
      <Button loading={busy} disabled={!name.trim()} onClick={save}>Simpan nama</Button>
    </div>
  )
}

export function Home({ identityId, name, onRenamed }: { identityId: string | null; name: string; onRenamed: (next: string) => Promise<void> }) {
  const bills = useBills(identityId)
  const recap = useRecap(identityId)

  const open = (bills.data ?? []).filter((b) => b.status === 'open')
  const unpaid = open.filter((b) => !b.my_paid && b.my_total_idr > 0)
  const net = recap.data?.final.net_idr ?? 0
  const provisional = recap.data?.provisional

  return (
    <AppShell title={'Halo, ' + (name || 'Teman')} subtitle="Semua bill kamu di satu tempat" active="home">
      {name === 'Teman' ? <NamePrompt onRenamed={onRenamed} /> : null}

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
            ? 'Termasuk ' + provisional.bill_count + ' bill yang masih berjalan'
            : 'Belum ada tagihan berjalan'
        }
      />

      {unpaid.length > 0 ? (
        <Alert tone="pending" title={unpaid.length + ' bill belum kamu selesaikan'}>
          Buka bill-nya, cek bagian kamu, lalu tandai lunas.
        </Alert>
      ) : null}

      <section className="app-stack">
        <div className="app-inline">
          <strong style={{ fontSize: 14, fontWeight: 800, letterSpacing: '-.01em' }}>Bill berjalan</strong>
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
            art={<img className="ds-art" src={emptyArt} alt="" width={180} height={180} />}
            action={
              <Link to="/create" style={{ textDecoration: 'none' }}>
                <Button>Buat bill</Button>
              </Link>
            }
          >
            Foto struk atau ketik manual, lalu bagikan link ke teman kamu.
          </EmptyState>
        ) : (
          <div>
            {open.map((bill) => (
              <Link key={bill.id} to="/b/$billId" params={{ billId: bill.id }} style={{ textDecoration: 'none', color: 'inherit' }}>
                <span className="app-row">
                  <span className="grow">
                    <b>{bill.title}</b>
                    <small>{bill.my_total_idr > 0 ? 'Bagian kamu ' + formatRp(bill.my_total_idr) : 'Belum memilih item'}</small>
                  </span>
                  <span className="amt">
                    {formatRp(bill.total_idr)}
                    <small style={{ display: 'block', fontWeight: 600 }}>
                      {bill.settled ? 'Lunas' : bill.my_paid ? 'Kamu lunas' : 'Belum lunas'}
                    </small>
                  </span>
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>

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

      {recap.data && recap.data.provisional.bills.length > 0 ? (
        <section className="app-stack">
          <div className="app-inline">
            <strong style={{ fontSize: 14, fontWeight: 800 }}>Masih berjalan</strong>
            <span className="app-spacer" />
            <StatusBadge tone="info">belum final</StatusBadge>
          </div>
          <div>
            {recap.data.provisional.bills.map((b) => (
              <Link key={b.bill_id} to="/b/$billId" params={{ billId: b.bill_id }} style={{ textDecoration: 'none', color: 'inherit' }}>
                <span className="app-row">
                  <span className="grow">
                    <b>{b.title}</b>
                    <small>{b.reason_codes.join(' · ').replaceAll('_', ' ')}</small>
                  </span>
                  <span className="amt">{formatRp(b.current_user.total_idr)}</span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </AppShell>
  )
}
