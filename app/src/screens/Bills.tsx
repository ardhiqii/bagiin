import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useBills } from '../lib/queries'
import { formatRp } from '../lib/money'
import { AppShell } from '../components/AppShell'
import { Alert, EmptyState, Field } from '../ds/primitives'
import emptyArt from '../assets/empty-bill.webp'

type Filter = 'semua' | 'berjalan' | 'lunas'

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'semua', label: 'Semua' },
  { key: 'berjalan', label: 'Berjalan' },
  { key: 'lunas', label: 'Lunas' },
]

function shortDate(value: string) {
  const parsed = new Date(value.replace(' ', 'T'))
  if (Number.isNaN(parsed.getTime())) return ''
  return parsed.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: '2-digit' })
}

export function Bills({ identityId }: { identityId: string | null }) {
  const bills = useBills(identityId)
  const rows = bills.data ?? []
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('semua')

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return rows.filter((bill) => {
      const matchesText =
        !needle || bill.title.toLowerCase().includes(needle) || (bill.merchant ?? '').toLowerCase().includes(needle)
      const matchesFilter =
        filter === 'semua' || (filter === 'lunas' ? bill.settled : !bill.settled)
      return matchesText && matchesFilter
    })
  }, [rows, query, filter])

  const open = shown.filter((bill) => !bill.settled)
  const done = shown.filter((bill) => bill.settled)

  const list = (items: typeof rows) => (
    <div className="app-list">
      {items.map((bill) => (
        <Link key={bill.id} to="/b/$billId" params={{ billId: bill.id }} style={{ textDecoration: 'none', color: 'inherit' }}>
          <span className="app-row">
            <span className="grow">
              <b>{bill.title}</b>
              <small>
                {shortDate(bill.created_at)}
                {bill.merchant ? ' · ' + bill.merchant : ''}
                {bill.settled ? ' · lunas' : bill.my_paid ? ' · bagianmu lunas' : ' · belum lunas'}
              </small>
            </span>
            <span className="amt">
              {bill.my_total_idr > 0 ? (
                formatRp(bill.my_total_idr)
              ) : (
                // strip kosong lebih jujur daripada em dash: orang belum memilih
                // item, jadi bagiannya memang belum ada
                <span style={{ fontWeight: 600, color: 'var(--ds-muted)' }}>Belum pilih</span>
              )}
              <small style={{ display: 'block', fontWeight: 600, color: 'var(--ds-muted)' }}>
                {bill.my_total_idr === bill.total_idr ? 'seluruh bill' : 'dari ' + formatRp(bill.total_idr)}
              </small>
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

      {rows.length > 0 ? (
        <>
          <Field id="bill-search" label="Cari bill" value={query} onChange={setQuery} hint="Nama bill atau merchant" />

          <div className="chip-row" role="group" aria-label="Saring bill">
            {FILTERS.map((option) => (
              <button
                key={option.key}
                type="button"
                className={'chip-filter' + (filter === option.key ? ' is-active' : '')}
                aria-pressed={filter === option.key}
                onClick={() => setFilter(option.key)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </>
      ) : null}

      {shown.length === 0 && rows.length > 0 ? (
        <div className="app-note">Tidak ada bill yang cocok dengan pencarian itu.</div>
      ) : null}

      {open.length > 0 ? (
        <section className="app-stack">
          <strong style={{ fontSize: 14, fontWeight: 800 }}>Berjalan</strong>
          {list(open)}
        </section>
      ) : null}

      {done.length > 0 ? (
        <section className="app-stack">
          <strong style={{ fontSize: 14, fontWeight: 800 }}>Lunas</strong>
          {list(done)}
        </section>
      ) : null}
    </AppShell>
  )
}
