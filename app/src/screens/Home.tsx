import { useMemo, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { inviteActions, useBills, useInvites, useRecap } from '../lib/queries'
import { invalidateInviteViews } from '../lib/mutations'
import { formatRp } from '../lib/money'
import { api } from '../lib/api'
import { useToast } from '../components/Toast'
import { AppShell } from '../components/AppShell'
import { Alert, BalanceCard, Button, EmptyState, SectionHead } from '../ds/primitives'
import { MagnifyingGlass } from '@phosphor-icons/react'
import homeEmptyArt from '../assets/home-empty.webp'

type Filter = 'semua' | 'berjalan' | 'lunas'

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'semua', label: 'Semua' },
  { key: 'berjalan', label: 'Belum lunas' },
  { key: 'lunas', label: 'Lunas' },
]

function shortDate(value: string) {
  const parsed = new Date(value.replace(' ', 'T'))
  if (Number.isNaN(parsed.getTime())) return ''
  return parsed.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })
}

/**
 * Satu pola baris untuk semua daftar. Angka di kanan selalu BAGIAN SAYA —
 * bukan total bill — supaya tidak ada dua angka berbeda arti yang terlihat sama.
 */
function BillRow({
  id,
  title,
  meta,
  share,
  total,
  pending,
}: {
  id: string
  title: string
  meta: string
  share: number
  total: number
  pending?: number
}) {
  return (
    <Link to="/b/$billId" params={{ billId: id }} style={{ textDecoration: 'none', color: 'inherit' }}>
      <span className="app-row">
        <span className="grow">
          <b>{title}</b>
          <small>
            {meta}
            {pending && pending > 0 ? ' · ' + pending + ' orang belum bayar' : ''}
          </small>
        </span>
        <span className="amt">
          {share > 0 ? (
            formatRp(share)
          ) : (
            <span style={{ fontWeight: 'var(--ds-weight-medium)', color: 'var(--ds-muted)' }}>Belum pilih</span>
          )}
          <small style={{ display: 'block', fontWeight: 'var(--ds-weight-medium)', color: 'var(--ds-muted)' }}>
            {share === total ? 'seluruh bill' : 'dari ' + formatRp(total)}
          </small>
        </span>
      </span>
    </Link>
  )
}

/**
 * Undangan yang masih menunggu: satu ketukan, bukan buka-bill-dulu.
 *
 * Backend biasanya sudah memasukkan orang yang diundang ke bill tanpa bertanya
 * (auto_accept bawaan). Kartu ini muncul untuk dua kasus yang tersisa: orangnya
 * mematikan auto_accept, atau pernah menolak undangan sebelumnya. Di situ dulu
 * jalurnya: buka bill, tekan "Ikut bill ini", baru masuk — padahal satu tombol
 * "Ikut" di beranda sudah cukup. Menolak tetap boleh, dan keluar dari bill juga
 * selalu bisa dari layar bill.
 */
function InviteCard({
  invite,
  onAccept,
  onDecline,
  busy,
}: {
  invite: { id: number; bill_id: string; bill_title: string; bill_total: number; invited_by_name: string }
  onAccept: () => void
  onDecline: () => void
  busy: boolean
}) {
  return (
    <div className="invite-card">
      <div className="invite-copy">
        <b>{invite.bill_title}</b>
        {/* "total" disebut eksplisit: angka ini total bill, bukan bagianmu —
            bagian baru ada setelah kamu memilih item di dalamnya */}
        <small>
          {invite.invited_by_name} mengundangmu · total {formatRp(invite.bill_total)}
        </small>
      </div>
      <div className="invite-actions">
        <Button compact onClick={onAccept} loading={busy}>
          Ikut
        </Button>
        {/* "Nanti" menyesatkan: tombol ini benar-benar menolak undangan, dan
            mengundang ulang setelah menolak harus disetujui dengan sadar.
            Keluar dari bill tetap bisa kapan saja dari layar bill. */}
        <Button compact variant="quiet" onClick={onDecline} disabled={busy}>
          Tolak
        </Button>
      </div>
    </div>
  )
}

/**
 * Satu layar untuk semua bill: ringkasan, pencarian, saringan, lalu daftar.
 * Dulu "Beranda" dan "Bill" dua layar dengan isi nyaris sama, jadi orang harus
 * menebak mana yang memuat bill lama.
 */
export function Home({ identityId, name }: { identityId: string | null; name: string }) {
  const bills = useBills(identityId)
  const recap = useRecap(identityId)
  const invites = useInvites(identityId)
  const qc = useQueryClient()
  const navigate = useNavigate()
  const toast = useToast()
  const [inviteBusy, setInviteBusy] = useState<number | null>(null)

  async function answerInvite(invite: { id: number; bill_id: string }, accept: boolean) {
    setInviteBusy(invite.id)
    try {
      const action = accept
        ? inviteActions.accept(invite.bill_id, invite.id)
        : inviteActions.decline(invite.bill_id, invite.id)
      await api(action.path, { method: 'POST', body: {} })
      invalidateInviteViews(qc, identityId)
      if (accept) navigate({ to: '/b/$billId', params: { billId: invite.bill_id } })
    } catch (err) {
      toast((err as Error).message)
    } finally {
      setInviteBusy(null)
    }
  }

  const rows = bills.data ?? []
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('semua')

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return rows.filter((bill) => {
      const matchesText =
        !needle ||
        bill.title.toLowerCase().includes(needle) ||
        (bill.merchant ?? '').toLowerCase().includes(needle)
      const matchesFilter = filter === 'semua' || (filter === 'lunas' ? bill.settled : !bill.settled)
      return matchesText && matchesFilter
    })
  }, [rows, query, filter])

  const open = shown.filter((bill) => !bill.settled)
  const settled = shown.filter((bill) => bill.settled)
  const allOpen = rows.filter((bill) => !bill.settled)
  const unpaid = allOpen.filter((bill) => !bill.my_paid && bill.my_total_idr > 0)

  const net = recap.data?.final.net_idr ?? 0
  const provisional = recap.data?.provisional

  return (
    <AppShell
      title={'Halo, ' + (name || 'Teman')}
      subtitle={
        rows.length > 0
          ? rows.length + ' bill · ' + allOpen.length + ' belum lunas'
          : 'Semua bill kamu di satu tempat'
      }
      active="home"
    >
      {bills.isError ? (
        <Alert tone="danger" title="Tidak bisa memuat bill">
          {(bills.error as Error).message}
        </Alert>
      ) : null}

      {(invites.data ?? []).length > 0 ? (
        <section className="app-stack">
          <SectionHead meta={<>{(invites.data ?? []).length} menunggu</>}>Undangan</SectionHead>
          {(invites.data ?? []).map((invite) => (
            <InviteCard
              key={invite.id}
              invite={invite}
              busy={inviteBusy === invite.id}
              onAccept={() => void answerInvite(invite, true)}
              onDecline={() => void answerInvite(invite, false)}
            />
          ))}
        </section>
      ) : null}

      <BalanceCard
        label={net >= 0 ? 'Harus kamu terima' : 'Harus kamu bayar'}
        value={Math.abs(net)}
        note={
          provisional && provisional.bill_count > 0
            ? 'Belum termasuk ' + provisional.bill_count + ' bill yang pembagiannya belum jelas'
            : 'Semua bill sudah selesai'
        }
      />

      {unpaid.length > 0 ? (
        <button type="button" className="app-banner is-pending" onClick={() => setFilter('berjalan')}>
          <span className="app-banner-text">
            <b>{unpaid.length} bill belum kamu selesaikan</b>
            <small>Ketuk untuk melihat yang belum beres</small>
          </span>
          <span aria-hidden="true">→</span>
        </button>
      ) : null}

      {bills.isPending && rows.length === 0 ? <div className="app-note">Memuat…</div> : null}

      {!bills.isPending && rows.length === 0 ? (
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
      ) : null}

      {rows.length > 0 ? (
        <>
          <div className="search-field">
            <MagnifyingGlass size={18} weight="bold" aria-hidden="true" />
            <input
              id="bill-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Cari bill atau merchant"
              aria-label="Cari bill"
            />
            {query ? (
              <button type="button" className="search-clear" onClick={() => setQuery('')} aria-label="Hapus pencarian">
                ×
              </button>
            ) : null}
          </div>

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

      {rows.length > 0 && shown.length === 0 ? (
        <div className="app-note">Tidak ada bill yang cocok dengan pencarian itu.</div>
      ) : null}

      {open.length > 0 ? (
        <section className="app-stack">
          {filter === 'semua' ? (
          <SectionHead meta={<>{open.length} bill</>}>Berjalan</SectionHead>
          ) : null}
          <div className="app-list">
            {open.map((bill) => (
              <BillRow
                key={bill.id}
                id={bill.id}
                title={bill.title}
                meta={
                  shortDate(bill.created_at) +
                  (bill.merchant ? ' · ' + bill.merchant : '') +
                  (bill.my_total_idr === 0
                    ? ' · belum pilih item'
                    : bill.my_paid
                      ? ' · bagianmu lunas'
                      : ' · belum lunas')
                }
                share={bill.my_total_idr}
                total={bill.total_idr}
                pending={bill.pending_names.length}
              />
            ))}
          </div>
        </section>
      ) : null}

      {settled.length > 0 ? (
        <section className="app-stack">
          {filter === 'semua' ? (
          <SectionHead meta={<>{settled.length} bill</>}>Lunas</SectionHead>
          ) : null}
          <div className="app-list">
            {settled.map((bill) => (
              <BillRow
                key={bill.id}
                id={bill.id}
                title={bill.title}
                meta={shortDate(bill.created_at) + (bill.merchant ? ' · ' + bill.merchant : '')}
                share={bill.my_total_idr}
                total={bill.total_idr}
              />
            ))}
          </div>
        </section>
      ) : null}
    </AppShell>
  )
}
