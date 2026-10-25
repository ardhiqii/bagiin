import { useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import type { BillResponse } from '../lib/types'
import { billActions, useBill, useBillAction } from '../lib/queries'
import { formatRp } from '../lib/money'
import { AppShell } from '../components/AppShell'
import { useToast } from '../components/Toast'
import { Alert, Avatar, Button, Money, StatusBadge } from '../ds/primitives'
import { Check, UsersThree } from '@phosphor-icons/react'

function initials(name: string) {
  const clean = name.trim()
  if (!clean) return '?'
  const parts = clean.split(/\s+/)
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase()
}

export function BillDetail({ billId, identityId }: { billId: string; identityId: string | null }) {
  const bill = useBill(billId)
  const action = useBillAction(billId, identityId)
  const toast = useToast()
  const navigate = useNavigate()
  const [busyItem, setBusyItem] = useState<number | null>(null)

  const data: BillResponse | undefined = bill.data
  const me = useMemo(() => data?.people.find((p) => p.identity_id === identityId), [data, identityId])
  const myPicks = useMemo(() => {
    if (!data || !identityId) return new Set<number>()
    const picked = new Set<number>()
    for (const item of data.items) {
      const selectors = data.sel_by_item[String(item.id)] ?? []
      if (selectors.some((s) => s.id === identityId)) picked.add(item.id)
    }
    return picked
  }, [data, identityId])

  const joined = Boolean(me)
  const canManage = data?.can_manage ?? false

  async function run(todo: { path: string; method?: 'POST' | 'PUT' | 'DELETE'; body?: unknown }, message: string) {
    try {
      await action.mutateAsync(todo)
      toast(message)
    } catch (err) {
      toast((err as Error).message)
    }
  }

  async function toggleItem(itemId: number) {
    if (!identityId) return
    setBusyItem(itemId)
    const next = new Set(myPicks)
    if (next.has(itemId)) next.delete(itemId)
    else next.add(itemId)
    try {
      await action.mutateAsync(billActions.setPicks(billId, [...next]))
    } catch (err) {
      toast((err as Error).message)
    } finally {
      setBusyItem(null)
    }
  }

  async function join() {
    if (!identityId) return
    await run(billActions.join(billId), 'Kamu sudah masuk ke bill ini')
  }

  async function share() {
    const url = window.location.origin + '/b/' + billId
    try {
      await navigator.clipboard.writeText(url)
      toast('Link disalin. Kirim ke teman kamu.')
    } catch {
      toast(url)
    }
  }

  return (
    <AppShell
      title={data?.bill.title ?? 'Bill'}
      subtitle={data?.bill.merchant ?? undefined}
      back
      active="bill"
    >
      {bill.isError ? (
        <Alert tone="danger" title="Bill tidak bisa dibuka">
          {(bill.error as Error).message}
        </Alert>
      ) : null}

      {bill.isPending ? <div className="app-note">Memuat bill…</div> : null}

      {data ? (
        <>
          <div className="ds-balance">
            <span className="ds-balance-label">Total bill</span>
            <strong className="ds-balance-value">
              <span className="ds-balance-cur">Rp</span>
              {data.bill.total_idr.toLocaleString('id-ID')}
            </strong>
            <small className="ds-balance-note">
              {data.people.length} orang · {data.items.length} item
              {me ? ' · bagian kamu ' + formatRp(me.total_idr) : ''}
            </small>
          </div>

          <div className="app-inline">
            {data.settled ? <StatusBadge tone="success">Lunas</StatusBadge> : <StatusBadge tone="pending">Belum selesai</StatusBadge>}
            {data.bill.status !== 'open' ? <StatusBadge tone="info">Ditutup</StatusBadge> : null}
            {data.bill.paid_by_confirmed ? <StatusBadge tone="info">Dibayar {data.paid_by_name}</StatusBadge> : null}
          </div>

          {!joined && data.bill.status === 'open' ? (
            <div className="ds-card ds-card-mint ds-pad-md">
              <b style={{ fontSize: 14 }}>Kamu belum masuk bill ini</b>
              <p className="app-note">Masuk dulu supaya bisa memilih item yang kamu makan.</p>
              <Button onClick={join} loading={action.isPending}>
                Ikut bill ini
              </Button>
            </div>
          ) : null}

          {data.warnings.length > 0 && canManage ? (
            <Alert tone="pending" title="Ada item yang belum dipilih">
              {data.warnings.slice(0, 2).join(' · ')}
            </Alert>
          ) : null}

          <section className="app-stack">
            <div className="app-inline">
              <strong style={{ fontSize: 14, fontWeight: 800 }}>Item</strong>
              <span className="app-spacer" />
              <span className="app-note">{joined ? 'Ketuk item yang kamu ambil' : 'Masuk untuk memilih'}</span>
            </div>

            {data.items.map((item) => {
              const selectors = data.sel_by_item[String(item.id)] ?? []
              const mine = myPicks.has(item.id)
              const state = mine ? (selectors.length > 1 ? 'shared' : 'picked') : 'idle'
              const label = selectors.map((s) => s.name).join(', ')
              return (
                <button
                  key={item.id}
                  type="button"
                  className={'ds-item is-' + state}
                  onClick={() => (joined ? toggleItem(item.id) : undefined)}
                  disabled={!joined || busyItem === item.id || data.bill.status !== 'open'}
                  aria-pressed={mine}
                  aria-label={item.name + ', ketuk untuk ' + (mine ? 'membatalkan' : 'memilih')}
                >
                  <span className="ds-item-check" aria-hidden="true">{mine ? <Check size={13} weight="bold" /> : null}</span>
                  <span className="ds-item-copy">
                    <b>{item.name}</b>
                    <small>
                      {item.quantity > 1 ? item.quantity + '× ' + formatRp(item.price_idr) : formatRp(item.price_idr)}
                      {label ? ' · ' + label : ' · belum ada yang ambil'}
                    </small>
                  </span>
                  <span className="ds-item-price">
                    <Money value={item.price_idr * item.quantity - item.discount_idr} size="small" />
                  </span>
                </button>
              )
            })}
          </section>

          <section className="app-stack">
            <div className="app-inline">
              <strong style={{ fontSize: 14, fontWeight: 800 }}>Orang</strong>
              <span className="app-spacer" />
              <span className="app-note"><UsersThree size={13} /> {data.people.length}</span>
            </div>
            <div>
              {data.people.map((person) => {
                const isMe = person.identity_id === identityId
                return (
                  <div className="app-row" key={person.identity_id}>
                    <Avatar label={initials(person.name)} tone={isMe ? 'teal' : 'navy'} />
                    <span className="grow">
                      <b>{person.name}{isMe ? ' (kamu)' : ''}</b>
                      <small>{person.total_idr > 0 ? 'Bagian ' + formatRp(person.total_idr) : 'Belum memilih'}</small>
                    </span>
                    <span className="amt">
                      {person.paid === 'paid' ? <StatusBadge tone="success">Lunas</StatusBadge> : <StatusBadge tone="pending">Belum</StatusBadge>}
                    </span>
                  </div>
                )
              })}
            </div>
          </section>

          <section className="app-stack">
            <strong style={{ fontSize: 14, fontWeight: 800 }}>Aksi</strong>
            <Button variant="secondary" block onClick={share}>
              Bagikan link bill
            </Button>

            {me && me.total_idr > 0 ? (
              me.paid === 'paid' ? (
                <Button variant="quiet" block onClick={() => run(billActions.markUnpaid(billId, me.identity_id), 'Status lunas dibatalkan')}>
                  Batalkan status lunas
                </Button>
              ) : (
                <Button block onClick={() => run(billActions.markPaid(billId, me.identity_id), 'Ditandai lunas')}>
                  Tandai bagianku lunas
                </Button>
              )
            ) : null}

            {canManage ? (
              data.bill.status === 'open' ? (
                <Button variant="quiet" block onClick={() => run(billActions.close(billId), 'Bill ditutup')}>
                  Tutup bill
                </Button>
              ) : (
                <Button variant="quiet" block onClick={() => run(billActions.reopen(billId), 'Bill dibuka lagi')}>
                  Buka lagi
                </Button>
              )
            ) : null}

            <Button variant="quiet" block onClick={() => navigate({ to: '/' })}>
              Kembali ke beranda
            </Button>
          </section>
        </>
      ) : null}
    </AppShell>
  )
}
