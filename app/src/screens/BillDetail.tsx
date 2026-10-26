import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import type { BillResponse } from '../lib/types'
import { billActions, keys, useBill, useBillAction, useContacts } from '../lib/queries'
import { api } from '../lib/api'
import { startIdentity } from '../lib/identity'
import { formatRp } from '../lib/money'
import { AppShell } from '../components/AppShell'
import { useToast } from '../components/Toast'
import { Alert, Avatar, Button, Field, Money, Sheet, StatusBadge } from '../ds/primitives'
import inviteArt from '../assets/invite.webp'
import personArt from '../assets/person.webp'
import errorArt from '../assets/error.webp'
import paidArt from '../assets/paid.webp'
import shareArt from '../assets/share.webp'
import transferArt from '../assets/transfer.webp'
import itemArt from '../assets/item.webp'
import { Check, UsersThree } from '@phosphor-icons/react'

/**
 * Backend mengirim kalimat siap-tampil per kasus ("7 bagian belum terisi (total
 * Rp 140,000)") dengan angka bergaya Inggris. UI menghitung sendiri dari state
 * yang sudah terstruktur supaya angkanya konsisten dengan sisa layar.
 */
function summarizeUncovered(data: BillResponse) {
  const freeNames = data.unassigned_items.map((item) => item.name)
  const slotNames = data.uncovered_slots.map((slot) => slot.name)
  const slotCount = data.uncovered_slots.reduce((sum, slot) => sum + slot.empty, 0)
  const parts: string[] = []
  if (freeNames.length > 0) parts.push(freeNames.length + ' item belum dipilih')
  if (slotCount > 0) parts.push(slotCount + ' slot belum terisi')
  return {
    has: parts.length > 0,
    title: parts.join(' · '),
    names: [...freeNames, ...slotNames].slice(0, 3).join(', '),
    money: data.uncovered_idr,
  }
}

function initials(name: string) {
  const clean = name.trim()
  if (!clean) return '?'
  const parts = clean.split(/\s+/)
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase()
}

export function BillDetail({ billId, identityId }: { billId: string; identityId: string | null }) {
  const bill = useBill(billId)
  const action = useBillAction(billId, identityId)
  const queryClient = useQueryClient()
  const toast = useToast()
  const navigate = useNavigate()
  const [busyItem, setBusyItem] = useState<number | null>(null)
  const [payerOpen, setPayerOpen] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [slotOpen, setSlotOpen] = useState(false)
  const contacts = useContacts(identityId, inviteOpen)

  const data: BillResponse | undefined = bill.data
  const me = useMemo(() => data?.people.find((p) => p.identity_id === identityId), [data, identityId])
  /** item_id -> berapa slot/porsi yang saya ambil. */
  const myPicks = useMemo(() => {
    const picked = new Map<number, number>()
    if (!data || !identityId) return picked
    for (const item of data.items) {
      const selectors = data.sel_by_item[String(item.id)] ?? []
      const mine = selectors.find((s) => s.id === identityId)
      if (mine && mine.qty > 0) picked.set(item.id, mine.qty)
    }
    return picked
  }, [data, identityId])

  const joined = Boolean(me)
  const canManage = data?.can_manage ?? false
  // rekening milik penerima uang; kalau pembayar belum jelas, pakai milik pembuat
  const transferAccounts = data
    ? data.paid_by_id
      ? data.paid_by_accounts
      : data.creator_accounts
    : []

  const [photoBusy, setPhotoBusy] = useState(false)
  const [nameOpen, setNameOpen] = useState(false)
  const [joinName, setJoinName] = useState('')
  const [joinBusy, setJoinBusy] = useState(false)
  const [joinError, setJoinError] = useState('')

  async function addPhoto(file: File) {
    if (!billId) return
    setPhotoBusy(true)
    try {
      const form = new FormData()
      form.append('file', file)
      await api('/api/bills/' + billId + '/photo', { method: 'POST', body: form })
      await queryClient.invalidateQueries({ queryKey: keys.bill(billId) })
      toast('Foto ditambahkan')
    } catch (err) {
      toast((err as Error).message)
    } finally {
      setPhotoBusy(false)
    }
  }

  async function run(todo: { path: string; method?: 'POST' | 'PUT' | 'DELETE'; body?: unknown }, message: string) {
    try {
      await action.mutateAsync(todo)
      toast(message)
    } catch (err) {
      toast((err as Error).message)
    }
  }

  /**
   * Backend menyimpan satu set pilihan utuh, jadi setiap ketukan mengirim ulang
   * seluruh pilihan saya dengan qty terbaru — bukan tambah/kurang satu per satu.
   */
  async function savePicks(next: Map<number, number>, clicked: number) {
    if (!identityId || !data) return
    const picks = data.items
      .map((item) => ({ item_id: item.id, qty: next.get(item.id) ?? 0 }))
      .filter((pick) => pick.qty > 0)
    setBusyItem(clicked)
    try {
      await action.mutateAsync(billActions.setPicks(billId, picks))
    } catch (err) {
      toast((err as Error).message)
    } finally {
      setBusyItem(null)
    }
  }

  async function toggleItem(itemId: number) {
    const item = data?.items.find((it) => it.id === itemId)
    if (!item) return
    const mine = myPicks.get(itemId) ?? 0
    const next = new Map(myPicks)

    if (item.mode === 'slot') {
      const taken = (data?.sel_by_item[String(itemId)] ?? [])
        .filter((s) => s.id !== identityId)
        .reduce((sum, s) => sum + s.qty, 0)
      const room = (item.slot_count ?? 1) - taken
      // ketuk menambah satu slot; kalau sudah penuh dari sisi saya, ketuk lagi mengosongkan
      if (mine >= room) next.delete(itemId)
      else next.set(itemId, mine + 1)
    } else {
      if (mine > 0) next.delete(itemId)
      else next.set(itemId, 1)
    }
    await savePicks(next, itemId)
  }

  async function stepSlots(itemId: number, delta: number) {
    const mine = myPicks.get(itemId) ?? 0
    const nextQty = mine + delta
    const next = new Map(myPicks)
    if (nextQty <= 0) next.delete(itemId)
    else next.set(itemId, nextQty)
    await savePicks(next, itemId)
  }

  /** Belum ada nama: minta nama dulu, baru masuk ke bill. */
  async function joinWithName() {
    if (!joinName.trim() || !billId) {
      setJoinError('Nama tidak boleh kosong')
      return
    }
    setJoinBusy(true)
    setJoinError('')
    try {
      await startIdentity(joinName.trim())
      await api('/api/bills/' + billId + '/join', { method: 'POST', body: {} })
      await queryClient.invalidateQueries({ queryKey: keys.bill(billId) })
      setNameOpen(false)
      toast('Kamu masuk ke bill ini')
    } catch (err) {
      setJoinError((err as Error).message)
    } finally {
      setJoinBusy(false)
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
        <div className="art-empty">
          <img src={errorArt} alt="" width={160} height={160} />
          <Alert tone="danger" title="Bill tidak bisa dibuka">
            {(bill.error as Error).message}
          </Alert>
        </div>
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
              {me && data.uncovered_idr > 0 ? ' + ' + formatRp(data.uncovered_idr) + ' yang belum ada pemiliknya' : ''}
            </small>
          </div>

          {/* Rincian struk: tanpa ini, diskon atau pajak yang ikut di total
              tidak punya penjelasan di layar. Baris nol tidak ditampilkan. */}
          <div className="ds-card ds-pad-md bill-breakdown">
            <div className="bill-line">
              <span>Subtotal</span>
              <b>{formatRp(data.bill.subtotal_idr)}</b>
            </div>
            {data.bill.order_discount_idr > 0 ? (
              <div className="bill-line is-credit">
                <span>Diskon pesanan</span>
                <b>-{formatRp(data.bill.order_discount_idr)}</b>
              </div>
            ) : null}
            {data.bill.tax_idr > 0 ? (
              <div className="bill-line">
                <span>{data.bill.tax_included ? 'Pajak (sudah termasuk)' : 'Pajak'}</span>
                <b>{formatRp(data.bill.tax_idr)}</b>
              </div>
            ) : null}
            {data.bill.service_idr > 0 ? (
              <div className="bill-line">
                <span>Service</span>
                <b>{formatRp(data.bill.service_idr)}</b>
              </div>
            ) : null}
            {data.bill.cashback_idr > 0 ? (
              <div className="bill-line is-credit">
                <span>Cashback</span>
                <b>-{formatRp(data.bill.cashback_idr)}</b>
              </div>
            ) : null}
          </div>

          {data.settled ? (
            <div className="ds-card ds-card-mint ds-pad-md art-card">
              <img src={paidArt} alt="" width={150} height={150} />
              <div>
                <b style={{ fontSize: 14 }}>Semua sudah lunas</b>
                <p className="app-note" style={{ margin: '4px 0 0' }}>
                  {formatRp(data.bill.total_idr)} sudah dibayar penuh. Bill ini tersimpan di rekap.
                </p>
              </div>
            </div>
          ) : null}

          <div className="app-inline">
            {data.settled ? null : <StatusBadge tone="pending">Belum selesai</StatusBadge>}
            {data.bill.status !== 'open' ? <StatusBadge tone="info">Ditutup</StatusBadge> : null}
            {data.bill.paid_by_confirmed ? <StatusBadge tone="info">Dibayar {data.paid_by_name}</StatusBadge> : null}
          </div>

          {!joined && data.bill.status === 'open' ? (
            <div className="ds-card ds-card-mint ds-pad-md">
              <b style={{ fontSize: 14 }}>Kamu belum masuk bill ini</b>
              <p className="app-note">Masuk dulu supaya bisa memilih item yang kamu makan.</p>
              <Button onClick={() => (identityId ? join() : setNameOpen(true))} loading={action.isPending}>
                Ikut bill ini
              </Button>
            </div>
          ) : null}

          {canManage && summarizeUncovered(data).has && !data.settled ? (
            <Alert tone="pending" title={summarizeUncovered(data).title}>
              {summarizeUncovered(data).names} — sementara ditanggung yang menalangi
              {summarizeUncovered(data).money > 0 ? ' (' + formatRp(summarizeUncovered(data).money) + ')' : ''}.
            </Alert>
          ) : null}

          {canManage && data.bill.status === 'open' && data.people.length <= 1 && !data.settled ? (
            <div className="ds-card ds-pad-md art-card">
              <img src={shareArt} alt="" width={120} height={120} />
              <div>
                <b style={{ fontSize: 14 }}>Bagikan bill ini</b>
                <p className="app-note" style={{ margin: '4px 0 8px' }}>
                  Belum ada yang masuk. Kirim linknya supaya teman bisa memilih bagiannya sendiri.
                </p>
                <Button variant="primary" onClick={share}>
                  Kirim link ke teman
                </Button>
              </div>
            </div>
          ) : null}

          <section className="app-stack">
            <div className="app-inline">
              <strong style={{ fontSize: 14, fontWeight: 800 }}>Item</strong>
              <span className="app-spacer" />
              <span className="app-note">{joined ? 'Ketuk item yang kamu ambil' : 'Masuk untuk memilih'}</span>
            </div>

            {data.items.map((item) => {
              const selectors = data.sel_by_item[String(item.id)] ?? []
              const mine = myPicks.get(item.id) ?? 0
              const state = mine > 0 ? (selectors.length > 1 ? 'shared' : 'picked') : 'idle'
              const label = selectors.map((s) => s.name).join(', ')
              const slotTotal = item.slot_count ?? 0
              const taken = selectors.reduce((sum, s) => sum + s.qty, 0)
              const isSlot = item.mode === 'slot'
              const lineTotal = item.price_idr * item.quantity - item.discount_idr
              const perSlot = isSlot && slotTotal > 0 ? Math.floor(lineTotal / slotTotal) : 0
              const editable = joined && data.bill.status === 'open'
              return (
                <div className="item-line" key={item.id}>
                  <button
                    type="button"
                    className={'ds-item is-' + state}
                    onClick={() => (editable ? toggleItem(item.id) : undefined)}
                    disabled={!editable || busyItem === item.id}
                    aria-pressed={mine > 0}
                    aria-label={item.name + ', ketuk untuk ' + (mine > 0 ? 'membatalkan' : 'memilih')}
                  >
                    <span className="ds-item-check" aria-hidden="true">
                      {mine > 0 ? <span>{mine > 1 ? mine : <Check size={13} weight="bold" />}</span> : null}
                    </span>
                    <span className="ds-item-copy">
                      <b>{item.name}</b>
                      <small>
                        {isSlot
                          ? slotTotal + ' slot · ' + formatRp(perSlot) + '/slot · sisa ' + (slotTotal - taken)
                          : item.quantity > 1
                            ? item.quantity + '× ' + formatRp(item.price_idr)
                            : formatRp(item.price_idr)}
                        {label ? ' · ' + label : ' · belum ada yang ambil'}
                      </small>
                    </span>
                    <span className="ds-item-price">
                      <Money value={lineTotal} size="small" />
                    </span>
                  </button>

                  {isSlot && editable ? (
                    <div className="slot-ctl">
                      <button type="button" onClick={() => stepSlots(item.id, -1)} disabled={mine === 0 || busyItem === item.id} aria-label={'Kurangi slot ' + item.name}>
                        −
                      </button>
                      <span aria-live="polite">{mine}/{slotTotal}</span>
                      <button
                        type="button"
                        onClick={() => stepSlots(item.id, 1)}
                        disabled={mine >= slotTotal - (taken - mine) || busyItem === item.id}
                        aria-label={'Tambah slot ' + item.name}
                      >
                        +
                      </button>
                    </div>
                  ) : null}
                </div>
              )
            })}
          </section>

          <section className="app-stack">
            <div className="app-inline">
              <strong style={{ fontSize: 14, fontWeight: 800 }}>Orang</strong>
              <span className="app-spacer" />
              <span className="app-note">
                <UsersThree size={13} /> {data.people.length} bergabung
                {data.participants.some((participant) => !participant.identity_id)
                  ? ' · ' + data.participants.filter((participant) => !participant.identity_id).length + ' diundang'
                  : ''}
              </span>
            </div>
            <div>
              {/* nama yang diketik pembuat tapi orangnya belum join */}
              {data.participants
                .filter((participant) => !participant.identity_id)
                .map((participant) => (
                  <div className="app-row" key={'placeholder-' + participant.name}>
                    <Avatar label={initials(participant.name)} tone="muted" />
                    <span className="grow">
                      <b>{participant.name}</b>
                      <small>Diundang, belum bergabung</small>
                    </span>
                    <span className="amt">
                      <StatusBadge tone="pending">Menunggu</StatusBadge>
                    </span>
                  </div>
                ))}
              {data.people.map((person) => {
                const isMe = person.identity_id === identityId
                const removable = canManage && data.bill.status === 'open' && !isMe
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
                    {removable ? (
                      <button
                        type="button"
                        className="link-action is-danger"
                        aria-label={'Keluarkan ' + person.name}
                        onClick={() => run(billActions.removePerson(billId, person.identity_id), person.name + ' dikeluarkan')}
                      >
                        Keluarkan
                      </button>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </section>

          {canManage && data.pending_invites.length > 0 ? (
            <section className="app-stack">
              <strong style={{ fontSize: 14, fontWeight: 800 }}>Undangan menunggu</strong>
              <div>
                {data.pending_invites.map((invite) => (
                  <div className="app-row" key={invite.id}>
                    <Avatar label={initials(invite.name)} tone="muted" />
                    <span className="grow">
                      <b>{invite.name}</b>
                      <small>Belum menerima undangan</small>
                    </span>
                    <button
                      type="button"
                      className="ds-button ds-button-quiet"
                      onClick={() => run(billActions.cancelInvite(billId, invite.id), 'Undangan dibatalkan')}
                    >
                      Batalkan
                    </button>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {data.photos.length > 0 || (canManage && data.bill.status === 'open') ? (
            <section className="app-stack">
              <div className="app-inline">
                <strong style={{ fontSize: 14, fontWeight: 800 }}>Foto struk</strong>
                <span className="app-spacer" />
                {canManage && data.bill.status === 'open' ? (
                  <label className="link-action" style={{ cursor: 'pointer' }}>
                    {photoBusy ? 'Mengunggah…' : '+ Tambah foto'}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      style={{ display: 'none' }}
                      disabled={photoBusy}
                      onChange={(event) => {
                        const file = event.target.files?.[0]
                        if (file) void addPhoto(file)
                        event.target.value = ''
                      }}
                    />
                  </label>
                ) : null}
              </div>
              {data.photos.length === 0 ? (
                <div className="app-note">Belum ada foto. Struk bisa kamu simpan di sini supaya bisa dicek lagi nanti.</div>
              ) : (
                <div className="receipt-strip">
                  {data.photos.map((photo) => (
                    <div className="receipt-item" key={photo.id}>
                      <a href={'/uploads/' + photo.path.split('/').pop()} target="_blank" rel="noreferrer">
                        <img src={'/uploads/' + photo.path.split('/').pop()} alt="Foto struk bill" />
                      </a>
                      {canManage && data.bill.status === 'open' ? (
                        <button
                          type="button"
                          className="receipt-kill"
                          aria-label={'Hapus foto ' + photo.id}
                          onClick={() => run(billActions.removePhoto(billId, photo.id), 'Foto dihapus')}
                        >
                          ×
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </section>
          ) : null}

          {transferAccounts.length > 0 ? (
            <section className="app-stack">
              <strong style={{ fontSize: 14, fontWeight: 800 }}>Transfer ke {data.paid_by_name}</strong>
              <p className="app-note" style={{ margin: '2px 0 0' }}>Salin nomornya, lalu bayar sesuai bagianmu.</p>
              <div>
                {transferAccounts.map((account) => (
                  <div className="app-row" key={account.id}>
                    <span className="grow">
                      <b>{account.brand}</b>
                      <small>
                        {account.account_no}
                        {account.holder_name ? ' · ' + account.holder_name : ''}
                      </small>
                    </span>
                    <button
                      type="button"
                      className="ds-button ds-button-quiet"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(account.account_no)
                          toast('Nomor rekening disalin')
                        } catch {
                          toast(account.account_no)
                        }
                      }}
                    >
                      Salin
                    </button>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <section className="app-stack">
            <strong style={{ fontSize: 14, fontWeight: 800 }}>Aksi</strong>
            <Button variant="secondary" block onClick={share}>
              Bagikan link bill
            </Button>

            {me && me.identity_id === data.paid_by_id && !data.settled ? (
              <div className="ds-card ds-card-mint ds-pad-sm">
                <b style={{ fontSize: 13 }}>Kamu yang menalangi bill ini</b>
                <p className="app-note" style={{ margin: '4px 0 0' }}>
                  Bagian kamu otomatis lunas. Yang perlu ditandai lunas adalah orang lain.
                </p>
              </div>
            ) : me && me.total_idr > 0 ? (
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

            {canManage && data.bill.status === 'open' ? (
              <Button variant="secondary" block onClick={() => navigate({ to: '/b/$billId/edit', params: { billId } })}>
                Ubah bill
              </Button>
            ) : null}

            {canManage && data.bill.status === 'open' ? (
              <Button variant="secondary" block onClick={() => setInviteOpen(true)}>
                Undang teman
              </Button>
            ) : null}

            {canManage && data.bill.status === 'open' && data.items.some((item) => item.mode === 'slot') ? (
              <Button variant="quiet" block onClick={() => setSlotOpen(true)}>
                Atur jumlah slot
              </Button>
            ) : null}

            {canManage && data.bill.status === 'open' ? (
              <Button variant="quiet" block onClick={() => setPayerOpen(true)}>
                Ganti yang bayar duluan
              </Button>
            ) : null}

            {canManage ? (
              data.settled_manual ? (
                <Button
                  variant="quiet"
                  block
                  onClick={() => run(billActions.unsettle(billId), 'Tanda lunas dibatalkan')}
                >
                  Batalkan lunas seluruh bill
                </Button>
              ) : (
                <Button
                  variant="quiet"
                  block
                  onClick={() => run(billActions.settle(billId), 'Bill ditandai lunas')}
                >
                  Tandai semua lunas
                </Button>
              )
            ) : null}

            {me && !canManage ? (
              <Button
                variant="danger"
                block
                onClick={() => {
                  void run(billActions.leave(billId), 'Kamu keluar dari bill ini').then(() => navigate({ to: '/' }))
                }}
              >
                Keluar dari bill ini
              </Button>
            ) : null}

            <Button variant="quiet" block onClick={() => navigate({ to: '/' })}>
              Kembali ke beranda
            </Button>
          </section>
        </>
      ) : null}

      <Sheet open={payerOpen} title="Siapa yang bayar duluan" art={transferArt} onClose={() => setPayerOpen(false)}>
        <p className="app-note">Orang ini yang menalangi bill. Setelah dipilih, dia yang jadi pemilik bill dan bisa menutup atau mengubahnya.</p>
        <div>
          {data?.people.map((person) => (
            <button
              key={person.identity_id}
              type="button"
              className="app-row"
              onClick={() => {
                void run(billActions.setPayer(billId, person.identity_id), 'Pembayar diganti ke ' + person.name)
                setPayerOpen(false)
              }}
            >
              <Avatar label={initials(person.name)} tone={person.identity_id === data.paid_by_id ? 'teal' : 'navy'} />
              <span className="grow">
                <b>{person.name}</b>
                <small>{person.identity_id === data.paid_by_id ? 'Sedang tercatat sebagai pembayar' : 'Jadikan pembayar'}</small>
              </span>
            </button>
          ))}
        </div>
      </Sheet>

      <Sheet open={nameOpen} title="Isi nama dulu" art={personArt} onClose={() => setNameOpen(false)}>
        <p className="app-note" style={{ marginTop: 0 }}>
          Nama ini yang muncul ke teman di bill ini. Tanpa akun, tanpa password.
        </p>
        <Field
          id="join-name"
          label="Nama kamu"
          value={joinName}
          onChange={(next) => {
            setJoinName(next)
            setJoinError('')
          }}
          error={joinError || undefined}
        />
        <Button block loading={joinBusy} disabled={!joinName.trim()} onClick={joinWithName}>
          Simpan nama & ikut bill
        </Button>
      </Sheet>

      <Sheet open={slotOpen} title="Atur jumlah slot" art={itemArt} onClose={() => setSlotOpen(false)}>
        <p className="app-note">
          Slot menentukan berapa orang yang bisa ambil bagian item ini. Menambah slot membuat porsi tiap orang lebih kecil;
          menguranginya tidak bisa di bawah jumlah yang sudah diambil.
        </p>
        <div>
          {data?.items.filter((item) => item.mode === 'slot').map((item) => {
            const taken = (data.sel_by_item[String(item.id)] ?? []).reduce((sum, s) => sum + s.qty, 0)
            const count = item.slot_count ?? 1
            return (
              <div className="app-row" key={item.id}>
                <span className="grow">
                  <b>{item.name}</b>
                  <small>{count} slot · {taken} sudah diambil</small>
                </span>
                <div className="slot-ctl">
                  <button
                    type="button"
                    aria-label={'Kurangi jumlah slot ' + item.name}
                    disabled={count <= Math.max(1, taken)}
                    onClick={() => run(billActions.setSlots(billId, item.id, count - 1), 'Slot ' + item.name + ' jadi ' + (count - 1))}
                  >
                    −
                  </button>
                  <span>{count}</span>
                  <button
                    type="button"
                    aria-label={'Tambah jumlah slot ' + item.name}
                    disabled={count >= 24}
                    onClick={() => run(billActions.setSlots(billId, item.id, count + 1), 'Slot ' + item.name + ' jadi ' + (count + 1))}
                  >
                    +
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </Sheet>

      <Sheet open={inviteOpen} title="Undang teman" art={inviteArt} onClose={() => setInviteOpen(false)}>
        <p className="app-note">Yang bisa diundang cuma orang yang pernah berbagi bill dengan kamu.</p>
        {contacts.isPending ? <div className="app-note">Memuat kontak…</div> : null}
        {contacts.isError ? <Alert tone="danger" title="Kontak gagal dimuat">{(contacts.error as Error).message}</Alert> : null}
        {contacts.data && contacts.data.length === 0 ? (
          <div className="app-note">Belum ada kontak. Buat bill bareng dulu, nanti mereka muncul di sini.</div>
        ) : null}
        <div>
          {contacts.data?.map((contact) => (
            <div className="app-row" key={contact.id}>
              <Avatar label={initials(contact.name)} tone="navy" />
              <span className="grow">
                <b>{contact.name}</b>
                <small>Terakhir bareng {contact.last_shared.slice(0, 10)}</small>
              </span>
              <button
                type="button"
                className="ds-button ds-button-quiet"
                onClick={async () => {
                  try {
                    const result = await action.mutateAsync(billActions.invite(billId, contact.id))
                    const status = (result as { status?: string })?.status
                    toast(status === 'joined' ? contact.name + ' langsung masuk' : 'Undangan dikirim ke ' + contact.name)
                  } catch (err) {
                    toast((err as Error).message)
                  }
                }}
              >
                Undang
              </button>
            </div>
          ))}
        </div>
      </Sheet>
    </AppShell>
  )
}
