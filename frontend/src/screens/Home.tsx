import { useMemo, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { inviteActions, useBillMonths, useBills, useInvites, useRecap } from '../lib/queries'
import { invalidateInviteViews } from '../lib/mutations'
import { formatRp } from '../lib/money'
import { api } from '../lib/api'
import { useToast } from '../components/Toast'
import { AppShell } from '../components/AppShell'
import { SecureNudge } from '../components/SecureNudge'
import { ActionFlag, Alert, Amount, Button, EmptyState, LoadingState, Notice, SectionHead, SkeletonList } from '../ds/primitives'
import { SaldoCard } from '../components/SaldoCard'
import { MagnifyingGlass } from '@phosphor-icons/react'
import homeEmptyArt from '../assets/home-empty.webp'

type Filter = 'semua' | 'perlu' | 'berjalan' | 'lunas'

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'semua', label: 'Semua' },
  // Saringan ini hanya muncul kalau memang ada yang perlu dikerjakan: chip
  // yang selalu ada tapi selalu kosong cuma menambah pilihan tanpa arti.
  { key: 'perlu', label: 'Perlu dikerjakan' },
  { key: 'berjalan', label: 'Belum lunas' },
  { key: 'lunas', label: 'Lunas' },
]

function shortDate(value: string) {
  const parsed = new Date(value.replace(' ', 'T'))
  if (Number.isNaN(parsed.getTime())) return ''
  return parsed.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })
}

const MONTH_NAMES = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
]

function monthLabel(key: string) {
  const [year, month] = key.split('-')
  const index = Number(month) - 1
  if (!Number.isInteger(index) || index < 0 || index > 11) return 'Tanpa tanggal'
  return MONTH_NAMES[index] + ' ' + year
}

/** Versi pendek untuk chip: `Okt 2026`. Tinggi baris chip tidak boleh melompat
 *  gara-gara nama bulan panjang. */
function shortMonthLabel(key: string) {
  const [year, month] = key.split('-')
  const index = Number(month) - 1
  if (!Number.isInteger(index) || index < 0 || index > 11) return 'Tanpa tanggal'
  return MONTH_NAMES[index].slice(0, 3) + ' ' + year
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
  flag,
  settled,
}: {
  id: string
  title: string
  meta: string
  share: number
  total: number
  flag?: { kind: 'pay' | 'split'; text: string }
  settled?: boolean
}) {
  return (
    <Link to="/b/$billId" params={{ billId: id }} style={{ textDecoration: 'none', color: 'inherit' }}>
      <span className="app-row">
        <span className="grow">
          <b>{title}</b>
          <small>
            {meta}
            {/* Penanda aksi memakai KATA KERJA dan ikut baris meta, bukan baris
                sendiri: baris ketiga membuat tinggi tiap baris berbeda-beda dan
                daftar jadi bergerigi. */}
            {flag ? (
              <>
                {' · '}
                <ActionFlag kind={flag.kind}>{flag.text}</ActionFlag>
              </>
            ) : null}
            {/* Status tidak lagi punya section sendiri, jadi tiap baris yang
                lunas harus mengatakannya sendiri. Tanpa ini orang kehilangan
                satu-satunya cara membedakan "sudah" dan "belum". */}
            {settled && !flag ? ' · lunas' : null}
          </small>
        </span>
        <span className="amt">
          {share > 0 ? (
            // Warna yang membawa arah; kata kerja di atasnya sudah menjelaskan.
            // Baris tanpa penanda tetap netral: tidak ada yang perlu dikerjakan.
            <Amount value={share} tone={flag?.kind === 'pay' ? 'neg' : undefined} />
          ) : (
            // Kolom kanan isinya angka; kalau belum ada bagian, tanda pisah lebih
            // jujur daripada kata yang menduplikasi penanda di kiri.
            <span style={{ fontWeight: 'var(--ds-weight-medium)', color: 'var(--ds-muted-soft)' }}>—</span>
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
  /**
   * Beranda memuat SATU bulan, bukan seluruh riwayat.
   *
   * Dulu satu permintaan mengambil semua bill sekaligus. Itu terasa gratis
   * selama bill masih belasan, tapi biayanya tumbuh terus sementara yang dibuka
   * hampir selalu bulan berjalan. Sekarang: ringkasan bulan (satu query
   * GROUP BY, tanpa isi bill) untuk daftar bulannya, lalu isi bulan yang dipilih
   * saja. Bulan lama baru dimuat saat diketuk.
   *
   * Pencarian sengaja menembak SEMUA bulan: orang yang mencari tidak sedang
   * memilih bulan, dia mencari nama bill.
   */
  const monthList = useBillMonths(identityId)
  const [query, setQuery] = useState('')
  const [month, setMonth] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('semua')
  const searching = query.trim().length > 0
  const newestMonth = monthList.data?.months[0]?.month ?? null
  // "Perlu dikerjakan" memuat semua bulan: angka di blok kuning dihitung dari
  // seluruh riwayat, jadi daftarnya tidak boleh cuma bulan yang kebetulan
  // terbuka — angka 5 dengan 2 baris di bawahnya adalah bug, bukan filter.
  const needsAction = filter === 'perlu'
  const activeMonth = searching || needsAction ? null : month ?? newestMonth
  // ditahan sampai daftar bulan tahu bulan terbaru: tanpa itu layar sempat
  // meminta seluruh bill dulu — persis biaya yang mau dihindari
  const bills = useBills(
    identityId,
    activeMonth,
    searching || needsAction || Boolean(monthList.data),
  )
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

  // Angka beranda = angka kartu = angka rekap: bagian yang belum dibayar di
  // SEMUA bill, termasuk yang pembagiannya belum selesai. Dulu bagian dari bill
  // yang belum selesai diparkir di "± perkiraan" dan tidak pernah dijumlahkan,
  // padahal itu tagihan yang jelas (lihat catatan di SaldoCard).
  const provisional = recap.data?.provisional
  const net =
    (recap.data?.final.net_idr ?? 0) +
    (provisional ? (provisional.receivable_idr ?? 0) - (provisional.payable_idr ?? 0) : 0)

  /**
   * Satu pertanyaan yang harus dijawab beranda: "apa yang harus SAYA kerjakan?"
   *
   * Dulu layar ini punya tiga penghitung berbeda (header "2 belum lunas",
   * banner "2 belum kamu selesaikan", kartu "6 belum jelas") untuk himpunan yang
   * tumpang tindih, jadi angkanya terasa gonta-ganti dan tidak ada satu pun yang
   * bisa dipercaya. Sekarang tiap bill dapat TEPAT SATU alasan, dengan urutan
   * yang tegas: kalau pembagiannya belum lengkap, itu alasannya — menagih
   * pembayaran untuk angka yang masih bisa berubah tidak masuk akal.
   * Konsekuensinya jumlah rincian selalu sama dengan angka besarnya.
   */
  const reasonOf = (bill: (typeof rows)[number]): 'split' | 'pay' | null => {
    // Server yang memutuskan (lihat `_action_kind` di backend) supaya angka di
    // blok kuning dan penanda di baris tidak mungkin bercerita beda.
    return bill.action ?? null
  }

  // Baris di daftar (bulan yang dimuat) butuh alasan per bill untuk penanda.
  const reasons = new Map(rows.map((bill) => [bill.id, reasonOf(bill)]))
  // Angka di blok kuning dihitung dari SELURUH bulan: rekap sudah memuat semua
  // bill beserta alasannya, jadi angkanya global tanpa memuat daftar bulan lain.
  const allActions = (recap.data?.provisional.bills ?? []).map((bill) => bill.action)
  const splitCount = allActions.filter((kind) => kind === 'split').length
  const payCount = allActions.filter((kind) => kind === 'pay').length
  const actionTotal = splitCount + payCount
  // Kata kerja, bukan kata benda: blok kuning isinya yang harus DIKERJAKAN.
  const breakdown = [
    splitCount > 0 ? splitCount + ' tinggal dipilih' : null,
    payCount > 0 ? payCount + ' tinggal dibayar' : null,
  ]
    .filter(Boolean)
    .join(' · ')

  // Berapa item/pori yang belum ada pengakunya, per bill. Tanpa angka ini enam
  // baris menulis kalimat yang sama persis ("Pilih item yang belum diambil") dan
  // mata berhenti membedakannya. Angkanya datang dari rekap yang sama.
  const uncoveredByBill = new Map(
    (provisional?.bills ?? []).map((bill) => [bill.bill_id, bill.uncovered_items?.length ?? 0]),
  )

  // Pencarian + saringan. "perlu" memakai alasan yang sama dengan blok kuning,
  // jadi chip dan angka di atasnya tidak mungkin berbeda cerita.
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return rows.filter((bill) => {
      const matchesText =
        !needle ||
        bill.title.toLowerCase().includes(needle) ||
        (bill.merchant ?? '').toLowerCase().includes(needle)
      const matchesFilter =
        filter === 'semua'
          ? true
          : filter === 'perlu'
            ? Boolean(reasons.get(bill.id))
            : filter === 'lunas'
              ? bill.settled
              : !bill.settled
      return matchesText && matchesFilter
    })
  }, [rows, query, filter, reasons])

  /**
   * Urutan baris mengikuti server (tanggal terbaru dulu), bukan "yang perlu
   * dikerjakan dulu": penanda kerjaan sudah menempel di barisnya, dan kalau
   * urutan berubah sendiri orang tidak bisa menebak di mana bill yang tadi
   * dilihat. Yang perlu dikerjakan punya chip + blok kuning sendiri.
   */
  const monthOptions = monthList.data?.months ?? []

  const flagFor = (bill: (typeof rows)[number]) => {
    const kind = reasons.get(bill.id)
    if (kind === 'split') {
      const left = uncoveredByBill.get(bill.id) ?? 0
      return {
        kind: 'split' as const,
        text: !bill.has_picks
          ? 'Kamu belum pilih item'
          : left > 1
            ? 'Pilih ' + left + ' item lagi'
            : 'Pilih 1 item',
      }
    }
    if (kind === 'pay') return { kind: 'pay' as const, text: 'Tinggal kamu bayar' }
    return undefined
  }

  return (
    <AppShell
      title={'Halo, ' + (name || 'Teman')}
      subtitle={
        // "belum lunas" harus berarti bagian SAYA belum dibayar, bukan bill-nya
        // masih terbuka. Dua hal berbeda: bill terbuka dengan bagian saya lunas
        // dulu muncul sebagai "1 belum lunas" padahal tidak ada utang saya.
        // Kepala layar tidak lagi menghitung apa pun: angka yang berubah-ubah di
        // atas bikin orang menebak mana yang harus dipercaya. Kalau ada yang
        // perlu dikerjakan, tempatnya di blok kuning di bawah.
        rows.length > 0 ? '' : 'Semua bill kamu di satu tempat'
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

      {/* Nol bukan prestasi yang perlu dipajang sebesar angka sungguhan. Kalau
          memang belum ada uang yang pasti, kartu besar itu cuma mengaburkan hal
          yang benar-benar perlu dibaca: undangan dan bill yang belum dipilih.
          Angkanya tetap jujur — hanya tidak diteriakkan. */}
      {/* Selama rekap belum datang, jangan menyimpulkan apa pun: dulu layar ini
          menulis "Tidak ada utang tersisa" (sekarang "Tagihanmu nol") karena
          `net` masih 0 bawaan, lalu berubah begitu data masuk. Kerangka lebih
          jujur: dia tidak mengklaim angka apa pun. */}
      {recap.isPending ? (
        <LoadingState label="Menghitung tagihan" rows={2} />
      ) : net === 0 && rows.length === 0 ? null : net === 0 ? (
        <Notice
          tone={actionTotal > 0 ? 'pending' : 'success'}
          action={
            actionTotal > 0 ? (
              <Link to="/recap" className="link-quiet">
                Lihat rekap
              </Link>
            ) : undefined
          }
        >
          {/* Tanpa angka pasti, perkiraannya yang disebut — tetap dengan "±" dan
              tetap tanpa dijumlahkan ke apa pun. */}
          {actionTotal > 0
            ? // Net nol BUKAN berarti selesai: di data nyata ada orang yang
              // tagihannya nol tapi satu bill-nya masih menunggu pilihan atau
              // konfirmasi. Kalimat "tidak ada tagihan" di samping banner "1
              // bill perlu kamu bereskan" terbaca seperti aplikasi salah hitung.
              'Tagihanmu nol. Masih ada ' + actionTotal + ' bill yang perlu kamu kerjakan.'
            : 'Tidak ada tagihan di antara kamu dan teman-temanmu.'}
        </Notice>
      ) : (
        <SaldoCard
          recap={{ final: recap.data!.final, provisional: recap.data!.provisional }}
          onOpenUnclear={() => navigate({ to: '/recap', hash: 'rekap-belum-jelas' })}
        />
      )}

      {/* Pengingat "amankan akun" hanya untuk tamu murni (tanpa username,
          password, dan Google). Komponennya sendiri yang memutuskan; di sini
          cuma tempatnya — tepat di bawah saldo, sebelum daftar bill. */}
      {identityId ? (
        <SecureNudge identityId={identityId} hasBills={(bills.data ?? []).length > 0} />
      ) : null}

      {/* Blok ini isinya HANYA pekerjaan: berapa bill dan apa yang harus
          dilakukan. Tanpa panah: panah menjanjikan pindah layar, dan dulu
          tombolnya cuma menyaring daftar yang tepat di bawahnya. */}
      {actionTotal > 0 ? (
        <button
          id="perlu-tindakan"
          type="button"
          className="app-banner is-pending"
          aria-label={'Saring ' + actionTotal + ' bill yang perlu kamu kerjakan'}
          onClick={() => setFilter(filter === 'perlu' ? 'semua' : 'perlu')}
        >
          <span className="banner-count" aria-hidden="true">
            {actionTotal}
          </span>
          <span className="app-banner-text">
            <b>bill perlu kamu bereskan</b>
            {/* Angka ini milik SELURUH bulan, bukan bulan yang sedang dibuka —
                karena itu mengetuknya memuat semua bulan sekaligus. */}
            <small>{breakdown}</small>
          </span>
          {/* Bukan panah: panah di blok ini dulu menjanjikan pindah layar padahal
              cuma menyaring daftar di bawahnya. Sekarang bloknya sendiri yang
              menyaring, dan yang menandakan itu adalah chip "Perlu dikerjakan"
              yang ikut aktif — bukan janji yang tidak ditepati. */}
        </button>
      ) : null}

      {bills.isPending && rows.length === 0 ? <SkeletonList rows={4} label="Memuat bill" /> : null}

      {!monthList.isPending && monthOptions.length === 0 ? (
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

          {/* Bulan dipilih di sini. Inilah saringan tanggalnya: satu bulan
              dimuat saat dibuka, bulan lain belum disentuh sama sekali. */}
          {monthOptions.length > 1 ? (
            <div className="chip-row chip-row-months" role="group" aria-label="Pilih bulan">
              <span className="chip-row-label" aria-hidden="true">Bulan</span>
              {monthOptions.map((option) => (
                <button
                  key={option.month}
                  type="button"
                  className={'chip-filter' + (!searching && activeMonth === option.month ? ' is-active' : '')}
                  aria-pressed={!searching && activeMonth === option.month}
                  disabled={searching}
                  onClick={() => setMonth(option.month)}
                >
                  {shortMonthLabel(option.month)} · {option.bill_count}
                </button>
              ))}
            </div>
          ) : null}

          {searching ? (
            <div className="app-note">
              Mencari di semua bulan. Pilih bulan di atas kalau mau kembali melihat satu bulan.
            </div>
          ) : null}

          <div className="chip-row" role="group" aria-label="Saring bill">
            <span className="chip-row-label" aria-hidden="true">Status</span>
            {FILTERS.filter((option) => option.key !== 'perlu' || actionTotal > 0).map((option) => (
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

      {shown.length > 0 ? (
        <section className="app-stack">
          <SectionHead meta={<>{shown.length} bill</>}>
            {searching ? 'Hasil di semua bulan' : monthLabel(activeMonth ?? '')}
          </SectionHead>
          <div className="app-list">
            {shown.map((bill) => (
              <BillRow
                key={bill.id}
                id={bill.id}
                title={bill.title}
                // merchant yang sama dengan judul tidak diulang: "SSB BENHIL ·
                // SSB BENHIL" cuma memanjangkan baris tanpa menambah arti
                meta={
                  shortDate(bill.created_at) +
                  (bill.merchant && bill.merchant !== bill.title ? ' · ' + bill.merchant : '') +
                  (searching ? ' · ' + shortDate(bill.created_at) : '')
                }
                share={bill.my_total_idr}
                total={bill.total_idr}
                flag={flagFor(bill)}
                settled={bill.settled}
              />
            ))}
          </div>
        </section>
      ) : null}
    </AppShell>
  )
}
