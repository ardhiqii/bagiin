import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import type { BillResponse } from '../lib/types'
import { billActions, useBill, useBillAction, useContacts, type Contact } from '../lib/queries'
import { invalidateMoneyViews } from '../lib/mutations'
import { api, endpoints, isSessionError } from '../lib/api'
import { startIdentity } from '../lib/identity'
import { formatRp } from '../lib/money'
import { buzz } from '../lib/haptics'
import { shareLink } from '../lib/share'
import { AppShell } from '../components/AppShell'
import { useToast } from '../components/Toast'
import { ActionGroup, ActionRow, Alert, Avatar, Button, Field, Money, ProviderLogo, Sheet, StatusBadge } from '../ds/primitives'
import inviteArt from '../assets/invite.webp'
import personArt from '../assets/person.webp'
import errorArt from '../assets/error.webp'
import paidArt from '../assets/paid.webp'
import shareArt from '../assets/share.webp'
import transferArt from '../assets/transfer.webp'
import itemArt from '../assets/item.webp'
import {
  ArrowCounterClockwise,
  ArrowsLeftRight,
  Check,
  CheckCircle,
  DotsThree,
  LockSimple,
  LockSimpleOpen,
  PencilSimple,
  ShareNetwork,
  SignOut,
  SlidersHorizontal,
  UsersThree,
} from '@phosphor-icons/react'

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
  // istilah "slot" sudah tidak dipakai: yang tersisa adalah porsi yang belum
  // diambil siapa pun, dan itu ditanggung yang menalangi.
  if (slotCount > 0) parts.push(slotCount + ' porsi belum diambil')
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
  const [actionsOpen, setActionsOpen] = useState(false)
  /** indeks foto yang sedang dilihat penuh; null = viewer tertutup */
  const [viewer, setViewer] = useState<number | null>(null)
  /** kontak yang nama pembedanya sedang diubah (dari sheet undangan) */
  const [aliasTarget, setAliasTarget] = useState<Contact | null>(null)
  const [aliasDraft, setAliasDraft] = useState('')
  const [aliasError, setAliasError] = useState('')
  const [aliasBusy, setAliasBusy] = useState(false)
  const contacts = useContacts(identityId, inviteOpen)

  /* Nama yang dipakai lebih dari satu orang dan belum diberi nama pembeda:
     inilah momen ketika "Undang" bisa jatuh ke orang yang salah. Dihitung dari
     daftar yang sama dengan yang dirender, jadi tidak mungkin berbeda. */
  const twinNames = useMemo(() => {
    const counts = new Map<string, number>()
    for (const contact of contacts.data ?? []) {
      const key = contact.name.trim().toLowerCase()
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return new Set(
      (contacts.data ?? [])
        .filter((c) => !c.alias && (counts.get(c.name.trim().toLowerCase()) ?? 0) > 1)
        .map((c) => c.name),
    )
  }, [contacts.data])

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
  /** Aksi pribadi yang belum selesai — satu-satunya isi bar bawah. */
  const primaryAction = (() => {
    if (!data) return null
    if (!joined) {
      return identityId
        ? { label: 'Ikut bill ini', onClick: () => void join() }
        : { label: 'Ikut bill ini', onClick: () => setNameOpen(true) }
    }
    // pembayar tidak punya bagian untuk ditandai: bagiannya otomatis lunas
    const owes = me && me.paid !== 'paid' && me.total_idr > 0 && me.identity_id !== data.paid_by_id
    if (owes && !data.settled) {
      return {
        label: 'Tandai lunas · ' + formatRp(me!.total_idr),
        onClick: () => {
          buzz(20)
          void run(billActions.markPaid(billId, me!.identity_id), 'Ditandai lunas')
        },
      }
    }
    return null
  })()
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
      // thumbnail/daftar di beranda ikut berubah, bukan cuma layar bill ini
      invalidateMoneyViews(queryClient, { billId, identityId })
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
    const taken = (data?.sel_by_item[String(itemId)] ?? [])
      .filter((s) => s.id !== identityId)
      .reduce((sum, s) => sum + s.qty, 0)
    // Satu ketukan = satu porsi. Baris qty 3 bisa diambil 1, 2, atau 3 kali;
    // ketukan saat sudah penuh mengosongkan pilihan. Slot lama tetap dibatasi
    // jumlah slotnya.
    const room = item.mode === 'slot' ? (item.slot_count ?? 1) - taken : item.quantity
    if (mine >= room) next.delete(itemId)
    else next.set(itemId, mine + 1)
    // 8 ms saat melepas, 10 ms saat mengambil: beda getaran jadi konfirmasi
    // tanpa perlu melihat layar.
    buzz(mine >= room ? 8 : 10)
    await savePicks(next, itemId)
  }

  async function stepPortion(itemId: number, delta: number) {
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
      const joined = await startIdentity(joinName.trim())
      await api('/api/bills/' + billId + '/join', { method: 'POST', body: {} })
      // identitas bisa berganti di sini (belum punya nama -> dibuat baru)
      invalidateMoneyViews(queryClient, { billId, identityId: joined?.id ?? identityId })
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

  /* Share sheet sistem dulu (WhatsApp ada di sana), clipboard sebagai cadangan.
     Menutup sheet = batal, bukan gagal — jadi tidak ada toast menyusul. */
  async function share() {
    const url = window.location.origin + '/b/' + billId
    const title = data?.bill.title ?? 'bill'
    const text = `Yuk isi bagian kamu di ${title}: ${url}`
    const result = await shareLink(text, url)
    if (result === 'shared') buzz(12)
    else if (result === 'copied') toast('Link disalin. Kirim ke teman kamu.')
    else if (result === 'failed') toast('Tidak bisa membagikan. Salin manual: ' + url)
  }

  return (
    <AppShell
      title={data?.bill.title ?? 'Bill'}
      subtitle={data?.bill.merchant ?? undefined}
      back
      active="home"
      footer={
        /* Toolbar di bawah, di zona jempol: aksi yang sering dipakai jadi ikon
           (bagikan, aksi lain) dan aksi pribadi jadi satu-satunya pill. Ikon
           sekunder di kiri, aksi utama di kanan. Kalau tidak ada aksi pribadi,
           sisi kanan diisi keterangan keadaan — bar tidak pernah kosong dan
           menu tidak perlu disembunyikan di pojok atas yang sulit dijangkau. */
        data ? (
          <div className="bill-action-bar">
            <button
              type="button"
              className="bill-bar-icon"
              aria-label="Bagikan ke teman"
              onClick={share}
            >
              <ShareNetwork size={20} weight="bold" aria-hidden="true" />
            </button>
            <button
              type="button"
              className="bill-bar-icon"
              aria-label="Aksi lain"
              onClick={() => setActionsOpen(true)}
            >
              <DotsThree size={22} weight="bold" aria-hidden="true" />
            </button>
            {primaryAction ? (
              <Button block onClick={primaryAction.onClick}>
                {primaryAction.label}
              </Button>
            ) : (
              <span className="bill-bar-state">
                {data.settled
                  ? 'Semua lunas'
                  : summarizeUncovered(data).has
                    ? 'Ada sisa yang belum diambil'
                    : 'Bagian kamu sudah lunas'}
              </span>
            )}
          </div>
        ) : undefined
      }
    >
      {bill.isError ? (
        <div className="art-empty">
          <img src={errorArt} alt="" width={160} height={160} />
          {isSessionError(bill.error) ? (
            /* Sesi basi bukan "bill-nya rusak": orangnya cuma perlu isi nama lagi.
               Layar ini tidak ber-guard (link bill harus tetap bisa dibuka tamu),
               jadi keadaannya dijelaskan di sini lengkap dengan jalan keluarnya. */
            <>
              <Alert tone="pending" title="Sesi kamu sudah tidak berlaku">
                Identitas yang tersimpan di perangkat ini sudah tidak ada di server. Isi nama
                lagi untuk melanjutkan.
              </Alert>
              <Button onClick={() => navigate({ to: '/' })}>Isi nama lagi</Button>
            </>
          ) : (
            <Alert tone="danger" title="Bill tidak bisa dibuka">
              {(bill.error as Error).message}
            </Alert>
          )}
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
              {me && data.uncovered_idr > 0 ? (
                <span className="nowrap">{' + ' + formatRp(data.uncovered_idr) + ' belum diambil'}</span>
              ) : null}
            </small>
            {/* Status menempel di kartu total: pertanyaan pertama orang adalah
                "tagihanku berapa, dan sudah beres belum". */}
            <div className="bill-hero-chips">
              {data.settled ? (
                <StatusBadge tone="success">Semua lunas</StatusBadge>
              ) : (
                <StatusBadge tone="pending">Belum lunas</StatusBadge>
              )}
              {data.bill.status !== 'open' ? <StatusBadge tone="info">Ditutup</StatusBadge> : null}
              {data.bill.paid_by_confirmed ? (
                <StatusBadge tone="info">Dibayar {data.paid_by_name}</StatusBadge>
              ) : null}
            </div>
          </div>

          {data.photos.length > 0 || (canManage && data.bill.status === 'open') ? (
            <section className="app-stack">
              <div className="app-inline">
                <strong className="ds-section-title">Foto struk</strong>
                <span className="app-spacer" />
                {data.photos.length > 0 ? (
                  <button
                    type="button"
                    className="link-quiet"
                    onClick={() => setViewer(0)}
                  >
                    Lihat struk{data.photos.length > 1 ? ' (' + data.photos.length + ')' : ''}
                  </button>
                ) : null}
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
                  {data.photos.map((photo, index) => (
                    <div className="receipt-item" key={photo.id}>
                      <button
                        type="button"
                        className="receipt-open"
                        aria-label={'Lihat foto struk ' + (index + 1)}
                        onClick={() => setViewer(index)}
                      >
                        <img src={'/uploads/' + photo.path.split('/').pop()} alt="Foto struk bill" />
                      </button>
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

          {data.settled ? (
            <div className="ds-card ds-card-mint ds-pad-md art-card">
              <img src={paidArt} alt="" width={150} height={150} />
              <div>
                <b style={{ fontSize: 14 }}>Semua sudah lunas</b>
                <p className="app-note" style={{ margin: '4px 0 0' }}>
                  {formatRp(data.bill.total_idr)} sudah dibayar penuh. Bill ini tidak muncul lagi di rekap.
                </p>
              </div>
            </div>
          ) : null}


          {!joined && data.bill.status === 'open' ? (
            /* tanpa tombol: tombolnya sudah ada di bar bawah sebagai aksi utama.
               Dua tombol "Ikut bill ini" di satu layar bikin orang menebak mana
               yang berbeda (dan dulu memang tidak berbeda). */
            <div className="ds-card ds-card-mint ds-pad-md">
              <b style={{ fontSize: 14 }}>Kamu belum masuk bill ini</b>
              <p className="app-note" style={{ margin: '4px 0 0' }}>
                Masuk dulu supaya bisa memilih item yang kamu makan.
              </p>
            </div>
          ) : null}

          {canManage && summarizeUncovered(data).has && !data.settled ? (
            <Alert tone="pending" title={summarizeUncovered(data).title}>
              Untuk: {summarizeUncovered(data).names} — sementara ditanggung yang menalangi
              {summarizeUncovered(data).money > 0 ? ' (' + formatRp(summarizeUncovered(data).money) + ')' : ''}.
            </Alert>
          ) : null}

          {canManage && data.bill.status === 'open' && data.people.length <= 1 && !data.settled ? (
            <div className="ds-card ds-pad-md art-card">
              <img src={shareArt} alt="" width={120} height={120} />
              <div>
                <b style={{ fontSize: 14 }}>Bagikan bill ini</b>
                <p className="app-note" style={{ margin: '4px 0 8px' }}>
                  Baru kamu yang di sini. Kirim linknya supaya teman bisa memilih bagiannya sendiri.
                </p>
                <Button variant="primary" onClick={share}>
                  Kirim link ke teman
                </Button>
              </div>
            </div>
          ) : null}

          <section className="app-stack">
            <div className="app-inline">
              <strong className="ds-section-title">Item</strong>
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
              // harga satuan = yang dibayar satu ketukan; lineTotal = seluruh baris
              const unit = Math.max(0, item.price_idr - item.discount_idr)
              const lineTotal = unit * item.quantity
              const perSlot = isSlot && slotTotal > 0 ? Math.floor(lineTotal / slotTotal) : 0
              const stepTotal = isSlot ? slotTotal : item.quantity
              /* Lebih banyak pengambil daripada porsi itu sah: 2 minuman dibagi
                 4 orang, masing-masing bayar seperempat. Yang tidak boleh adalah
                 layar berbohong soal itu — "4 dari 2 diambil" tidak berarti apa
                 pun, dan harga satu porsi bukan yang dibayar orangnya. */
              const sharedBeyondPortions = !isSlot && taken > item.quantity
              // Bill yang sudah lunas itu money-final: server menolak pilihan
              // baru (409). Tombolnya dulu tetap menyala, jadi orang mengetuk
              // dan cuma dapat pesan galat — kontrol yang menyala tapi tidak
              // bisa dipakai lebih buruk daripada kontrol yang mati.
              const editable = joined && data.bill.status === 'open' && !data.settled
              return (
                <div className="item-line" key={item.id}>
                  <button
                    type="button"
                    className={'ds-item is-' + state}
                    onClick={() => (editable ? toggleItem(item.id) : undefined)}
                    disabled={!editable || busyItem === item.id}
                    aria-pressed={mine > 0}
                    aria-label={
                      item.name + ', ketuk untuk ' + (mine >= (item.mode === 'slot' ? (item.slot_count ?? 1) : item.quantity) ? 'membatalkan' : mine > 0 ? 'menambah porsi' : 'memilih')
                    }
                  >
                    <span className="ds-item-check" aria-hidden="true">
                      {mine > 0 ? <span>{mine > 1 ? mine : <Check size={13} weight="bold" />}</span> : null}
                    </span>
                    <span className="ds-item-copy">
                      <b>{item.name}</b>
                      <small>
                        {/* harga sudah tampil di kanan; di sini cukup statusnya,
                            dan tanpa "1/2" yang bisa dibaca "setengah tiket" */}
                        {isSlot
                          ? formatRp(perSlot) + '/bagian · sisa ' + (slotTotal - taken)
                          : sharedBeyondPortions
                            ? 'dibagi ' + selectors.length + ' orang'
                            : item.quantity > 1
                              ? taken + ' dari ' + item.quantity + ' diambil'
                              : null}
                        {isSlot || item.quantity > 1 ? ' · ' : ''}
                        {label || 'belum ada yang ambil'}
                      </small>
                    </span>
                    <span className="ds-item-price">
                      {/* angka di kanan = harga yang muncul saat baris ini diketuk */}
                      {/* Saat dibagi lebih banyak orang daripada porsinya, harga
                          satu porsi bukan angka yang dibayar siapa pun. Yang benar
                          untuk seluruh baris = harga baris; bagian per orang
                          tampil di daftar orang di bawah. */}
                      <Money
                        value={isSlot ? lineTotal : sharedBeyondPortions ? lineTotal : item.quantity > 1 ? unit : lineTotal}
                        size="small"
                      />
                    </span>
                  </button>

                  {(isSlot || item.quantity > 1) && editable ? (
                    <div className="slot-ctl">
                      <button type="button" onClick={() => stepPortion(item.id, -1)} disabled={mine === 0 || busyItem === item.id} aria-label={'Kurangi porsi ' + item.name}>
                        −
                      </button>
                      <span aria-live="polite">{mine}/{stepTotal}</span>
                      <button
                        type="button"
                        onClick={() => stepPortion(item.id, 1)}
                        disabled={
                          busyItem === item.id ||
                          (isSlot ? mine >= slotTotal - (taken - mine) : mine >= item.quantity)
                        }
                        aria-label={'Tambah porsi ' + item.name}
                      >
                        +
                      </button>
                    </div>
                  ) : null}
                </div>
              )
            })}
          </section>

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
            ) : data.bill.tax_included ? (
              // Pajak nempel di harga item: kolomnya nol, tapi orang tetap perlu
              // tahu kenapa tidak ada baris pajak di sini.
              <div className="bill-line">
                <span>Pajak (sudah termasuk)</span>
                <b>di harga item</b>
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


          <section className="app-stack">
            <div className="app-inline">
              <strong className="ds-section-title">Orang</strong>
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
                    <Avatar label={initials(person.display_name ?? person.name)} tone={isMe ? 'teal' : 'navy'} />
                    <span className="grow">
                      {/* display_name = alias milik penampil. Nama asli tetap
                          dipakai untuk aria-label aksi supaya yang dikeluarkan
                          tidak pernah ambigu. */}
                      <b>{(isMe ? person.name : person.display_name ?? person.name)}{isMe ? ' (kamu)' : ''}</b>
                      {/* Pembayar yang belum memilih item bukan "belum memilih" —
                          dia sudah menalangi dan menanggung sisa yang tidak diambil
                          siapa pun. Menulis "belum memilih" di sebelah lencana
                          "Lunas" membuat orang mengira masih ada yang harus dia
                          kerjakan. */}
                      <small>
                        {person.total_idr > 0
                          ? 'Bagian ' + formatRp(person.total_idr)
                          : person.identity_id === data.bill.paid_by_identity_id
                            ? 'Menalangi bill ini'
                            : 'Belum memilih'}
                      </small>
                    </span>
                    <span className="amt">
                      {person.paid === 'paid' ? <StatusBadge tone="success">Lunas</StatusBadge> : <StatusBadge tone="pending">Belum</StatusBadge>}
                    </span>
                    {removable ? (
                      <button
                        type="button"
                        className="link-action is-danger"
                        aria-label={'Keluarkan ' + person.name}
                        onClick={() => run(billActions.removePerson(billId, person.identity_id), (person.display_name ?? person.name) + ' dikeluarkan')}
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
              <strong className="ds-section-title">Undangan menunggu</strong>
              <div>
                {data.pending_invites.map((invite) => (
                  <div className="app-row" key={invite.id}>
                    <Avatar label={initials(invite.display_name ?? invite.name)} tone="muted" />
                    <span className="grow">
                      <b>{invite.display_name ?? invite.name}</b>
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

          {transferAccounts.length > 0 ? (
            <section className="app-stack">
              <strong className="ds-section-title">Transfer ke {data.paid_by_name}</strong>
              <p className="app-note" style={{ margin: '2px 0 0' }}>Salin nomornya, lalu bayar sesuai bagianmu.</p>
              <div>
                {transferAccounts.map((account) => (
                  <div className="app-row" key={account.id}>
                    <ProviderLogo brand={account.brand} />
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

        </>
      ) : null}

      {/* Tanpa ilustrasi: piring-garpu-pisau itu arti 'item', bukan 'aksi'.
          Untuk daftar aksi, judul + label sudah cukup; ilustrasi di sini cuma
          dekorasi yang menyesatkan. */}
      {/* Aksi lain: daftar tergrup, bukan sembilan pill bertumpuk. Grup membuat
          aksi destruktif (keluar) terpisah dan tiap baris 56 px supaya nyaman
          dijangkau ibu jari di bagian bawah layar. */}
      <Sheet open={actionsOpen} title="Aksi lain" onClose={() => setActionsOpen(false)}>
        {data && me && me.identity_id === data.paid_by_id && !data.settled ? (
          <p className="ds-sheet-copy">
            Bagian kamu otomatis lunas. Yang perlu ditandai lunas adalah orang lain.
          </p>
        ) : null}

        <ActionGroup label="Bagikan">
          <ActionRow
            icon={<ShareNetwork size={20} weight="bold" />}
            label="Bagikan link"
            note="Kirim ke teman supaya mereka memilih bagiannya"
            onClick={() => { setActionsOpen(false); void share() }}
          />
        </ActionGroup>

        {/* Bill yang sudah lunas: yang tersisa hanya "batalkan lunas" dan
            bagikan. Ubah item dan ganti pembayar sama-sama mengubah angka yang
            sudah diumumkan, dan server menolaknya — jadi jangan ditawarkan. */}
        {canManage && data?.bill.status === 'open' && !data?.settled ? (
          <ActionGroup label="Kelola bill">
            <ActionRow
              icon={<UsersThree size={20} weight="bold" />}
              label="Undang teman"
              onClick={() => { setActionsOpen(false); setInviteOpen(true) }}
            />
            <ActionRow
              icon={<PencilSimple size={20} weight="bold" />}
              label="Ubah bill"
              onClick={() => { setActionsOpen(false); navigate({ to: '/b/$billId/edit', params: { billId } }) }}
            />
            {data.items.some((item) => item.mode === 'slot') ? (
              <ActionRow
                icon={<SlidersHorizontal size={20} weight="bold" />}
                label="Atur jumlah bagian"
                onClick={() => { setActionsOpen(false); setSlotOpen(true) }}
              />
            ) : null}
            <ActionRow
              icon={<ArrowsLeftRight size={20} weight="bold" />}
              label="Ganti yang bayar duluan"
              onClick={() => { setActionsOpen(false); setPayerOpen(true) }}
            />
          </ActionGroup>
        ) : null}

        {canManage || (me && me.paid === 'paid' && me.total_idr > 0) ? (
          <ActionGroup label="Status">
            {canManage ? (
              data?.bill.status === 'open' ? (
                <ActionRow
                  icon={<LockSimple size={20} weight="bold" />}
                  label="Tutup bill"
                  note="Kunci bill: tidak bisa dipilih atau diubah lagi. Yang belum bayar tetap tercatat"
                  onClick={() => { setActionsOpen(false); void run(billActions.close(billId), 'Bill ditutup') }}
                />
              ) : (
                <ActionRow
                  icon={<LockSimpleOpen size={20} weight="bold" />}
                  label="Buka lagi"
                  onClick={() => { setActionsOpen(false); void run(billActions.reopen(billId), 'Bill dibuka lagi') }}
                />
              )
            ) : null}
            {canManage ? (
              data?.settled_manual ? (
                <ActionRow
                  icon={<ArrowCounterClockwise size={20} weight="bold" />}
                  label="Batalkan lunas seluruh bill"
                  onClick={() => { setActionsOpen(false); void run(billActions.unsettle(billId), 'Tanda lunas dibatalkan') }}
                />
              ) : (
                <ActionRow
                  icon={<CheckCircle size={20} weight="bold" />}
                  label="Tandai semua lunas"
                  onClick={() => { setActionsOpen(false); void run(billActions.settle(billId), 'Bill ditandai lunas') }}
                />
              )
            ) : null}
            {me && me.paid === 'paid' && me.total_idr > 0 && !canManage ? (
              <ActionRow
                icon={<ArrowCounterClockwise size={20} weight="bold" />}
                label="Batalkan status lunas"
                onClick={() => {
                  setActionsOpen(false)
                  void run(billActions.markUnpaid(billId, me.identity_id), 'Status lunas dibatalkan')
                }}
              />
            ) : null}
          </ActionGroup>
        ) : null}

        {me && !canManage ? (
          <ActionGroup label="Keluar dari bill">
            <ActionRow
              danger
              icon={<SignOut size={20} weight="bold" />}
              label="Keluar dari bill ini"
              note="Pilihanmu ikut hilang, bagianmu dibebaskan"
              onClick={() => {
                setActionsOpen(false)
                void run(billActions.leave(billId), 'Kamu keluar dari bill ini').then(() => navigate({ to: '/' }))
              }}
            />
          </ActionGroup>
        ) : null}

        <div className="ds-sheet-foot-actions">
          <Button variant="quiet" block onClick={() => { setActionsOpen(false); navigate({ to: '/' }) }}>
            Kembali ke beranda
          </Button>
        </div>
      </Sheet>

      <Sheet
        open={viewer !== null}
        title="Foto struk"
        onClose={() => setViewer(null)}
      >
        {data && viewer !== null && data.photos[viewer] ? (
          <div className="photo-viewer">
            <img
              src={'/uploads/' + data.photos[viewer].path.split('/').pop()}
              alt={'Foto struk ' + (viewer + 1)}
            />
            <div className="photo-viewer-nav">
              <Button
                variant="secondary"
                disabled={viewer === 0}
                onClick={() => setViewer((v) => Math.max(0, (v ?? 0) - 1))}
              >
                Sebelumnya
              </Button>
              <span className="app-note">
                {viewer + 1} dari {data.photos.length}
              </span>
              <Button
                variant="secondary"
                disabled={viewer >= data.photos.length - 1}
                onClick={() => setViewer((v) => Math.min(data.photos.length - 1, (v ?? 0) + 1))}
              >
                Berikutnya
              </Button>
            </div>
          </div>
        ) : null}
      </Sheet>

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
              <Avatar label={initials(person.display_name ?? person.name)} tone={person.identity_id === data.paid_by_id ? 'teal' : 'navy'} />
              <span className="grow">
                <b>{person.display_name ?? person.name}</b>
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

      <Sheet open={slotOpen} title="Atur jumlah bagian" art={itemArt} onClose={() => setSlotOpen(false)}>
        <p className="app-note">
          Ini hanya untuk bill lama yang dibuat sebelum aturan baru. Jumlah bagian menentukan berapa orang yang bisa ambil
          item ini; menguranginya tidak bisa di bawah yang sudah diambil.
        </p>
        <div>
          {data?.items.filter((item) => item.mode === 'slot').map((item) => {
            const taken = (data.sel_by_item[String(item.id)] ?? []).reduce((sum, s) => sum + s.qty, 0)
            const count = item.slot_count ?? 1
            return (
              <div className="app-row" key={item.id}>
                <span className="grow">
                  <b>{item.name}</b>
                  <small>{count} bagian · {taken} sudah diambil</small>
                </span>
                <div className="slot-ctl">
                  <button
                    type="button"
                    aria-label={'Kurangi jumlah bagian ' + item.name}
                    disabled={count <= Math.max(1, taken)}
                    onClick={() => run(billActions.setSlots(billId, item.id, count - 1), 'Bagian ' + item.name + ' jadi ' + (count - 1))}
                  >
                    −
                  </button>
                  <span>{count}</span>
                  <button
                    type="button"
                    aria-label={'Tambah jumlah bagian ' + item.name}
                    disabled={count >= 24}
                    onClick={() => run(billActions.setSlots(billId, item.id, count + 1), 'Bagian ' + item.name + ' jadi ' + (count + 1))}
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
        {twinNames.size > 0 ? (
          <Alert tone="pending" title="Ada nama yang sama">
            {twinNames.size === 1 ? 'Ada dua orang' : 'Ada beberapa orang'} bernama{' '}
            {[...twinNames].join(', ')}. Bedakan lewat nama pembeda atau @username
            sebelum mengundang.
          </Alert>
        ) : null}
        {contacts.data && contacts.data.length === 0 ? (
          <div className="app-note">Belum ada kontak. Buat bill bareng dulu, nanti mereka muncul di sini.</div>
        ) : null}
        <div>
          {contacts.data?.map((contact) => (
            <div className="app-row" key={contact.id}>
              <Avatar label={initials(contact.display_name)} tone={contact.alias ? 'mint' : 'navy'} />
              <span className="grow">
                <b className="row-name">{contact.display_name}</b>
                <small className="row-meta">
                  {/* Nama asli selalu ikut kalau ada nama pembeda: tanpa itu,
                      orang bisa mengundang orang yang salah dan tidak sadar. */}
                  {contact.alias ? contact.name + ' · ' : ''}
                  {contact.username ? '@' + contact.username : '#' + contact.handle}
                  {contact.last_bill_title ? ' · ' + contact.last_bill_title : ''}
                </small>
              </span>
              <button
                type="button"
                className="ds-icon-button"
                aria-label={'Ganti nama pembeda ' + contact.display_name}
                onClick={() => {
                  setAliasTarget(contact)
                  setAliasDraft(contact.alias ?? '')
                  setAliasError('')
                }}
              >
                <PencilSimple size={17} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="ds-button ds-button-quiet"
                onClick={async () => {
                  try {
                    const result = await action.mutateAsync(billActions.invite(billId, contact.id))
                    const status = (result as { status?: string })?.status
                    toast(status === 'joined' ? contact.display_name + ' langsung masuk' : 'Undangan dikirim ke ' + contact.display_name)
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

      {/* Sheet nama pembeda dipakai dari daftar undangan: mengubah nama tidak
          boleh memaksa keluar dari alur mengundang lalu mencari lagi. */}
      <Sheet open={Boolean(aliasTarget)} title="Nama pembeda" onClose={() => setAliasTarget(null)}>
        {aliasTarget ? (
          <>
            <div className="alias-target">
              <Avatar label={initials(aliasTarget.name)} tone="navy" />
              <span>
                <b>{aliasTarget.name}</b>
                <small>{aliasTarget.username ? '@' + aliasTarget.username : '#' + aliasTarget.handle}</small>
              </span>
            </div>
            <Field
              id="invite-alias"
              label="Kamu mengenalnya sebagai"
              value={aliasDraft}
              onChange={(next) => {
                setAliasDraft(next)
                setAliasError('')
              }}
              hint="Hanya kamu yang melihat nama ini"
              error={aliasError || undefined}
              maxLength={40}
            />
            <Button
              block
              loading={aliasBusy}
              disabled={!aliasDraft.trim() || aliasDraft.trim() === (aliasTarget.alias ?? '')}
              onClick={async () => {
                if (!identityId) return
                setAliasBusy(true)
                try {
                  await endpoints.setAlias(identityId, aliasTarget.id, aliasDraft.trim())
                  await queryClient.invalidateQueries({ queryKey: ['contacts', identityId] })
                  await queryClient.invalidateQueries({ queryKey: ['bill', billId] })
                  toast('Nama pembeda disimpan')
                  setAliasTarget(null)
                } catch (err) {
                  setAliasError((err as Error).message)
                } finally {
                  setAliasBusy(false)
                }
              }}
            >
              Simpan nama
            </Button>
            {aliasTarget.alias ? (
              <Button
                variant="quiet"
                block
                disabled={aliasBusy}
                onClick={async () => {
                  if (!identityId) return
                  setAliasBusy(true)
                  try {
                    await endpoints.clearAlias(identityId, aliasTarget.id)
                    await queryClient.invalidateQueries({ queryKey: ['contacts', identityId] })
                    await queryClient.invalidateQueries({ queryKey: ['bill', billId] })
                    toast('Nama pembeda dihapus')
                    setAliasTarget(null)
                  } catch (err) {
                    setAliasError((err as Error).message)
                  } finally {
                    setAliasBusy(false)
                  }
                }}
              >
                Hapus nama pembeda
              </Button>
            ) : null}
          </>
        ) : null}
      </Sheet>
    </AppShell>
  )
}
