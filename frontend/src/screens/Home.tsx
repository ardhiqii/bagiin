import { useMemo, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { inviteActions, useBills, useInvites, useRecap } from '../lib/queries'
import { invalidateInviteViews } from '../lib/mutations'
import { formatRp } from '../lib/money'
import { api } from '../lib/api'
import { useToast } from '../components/Toast'
import { AppShell } from '../components/AppShell'
import { SecureNudge } from '../components/SecureNudge'
import { Alert, Amount, Button, EmptyState, LoadingState, Notice, SectionHead, Sheet, SkeletonList, StatusBadge } from '../ds/primitives'
import { SaldoCard } from '../components/SaldoCard'
import { CheckCircle, Clock, FunnelSimple, MagnifyingGlass, WarningCircle } from '@phosphor-icons/react'
import homeEmptyArt from '../assets/home-empty.webp'

type Filter = 'semua' | 'perlu' | 'berjalan' | 'lunas'

/** Potongan daftar per halaman. 20 baris = ~2 layar ponsel. */
const PAGE_ROWS = 20

/**
 * Baris ketiga setiap bill: keadaannya sekarang, dalam satu kalimat pendek.
 *
 * Ada untuk SEMUA bill, bukan cuma yang butuh tindakan. Kalau hanya sebagian
 * baris yang punya baris ketiga, daftar jadi bergerigi dan mata kehilangan
 * irama saat menyapu ke bawah. Bill yang tidak menuntut apa-apa pun tetap
 * menjawab pertanyaan yang sama: "ini sudah sampai mana?".
 */
type RowStatus = {
  tone: 'success' | 'pending' | 'danger' | 'quiet'
  text: string
  Icon: typeof CheckCircle
}

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

/** Versi pendek untuk pilihan di sheet: `Okt 2026`. */
function shortMonthLabel(key: string) {
  const [year, month] = key.split('-')
  const index = Number(month) - 1
  if (!Number.isInteger(index) || index < 0 || index > 11) return 'Tanpa tanggal'
  return MONTH_NAMES[index].slice(0, 3) + ' ' + year
}

/**
 * Bulan efektif satu bill, dihitung dari tanggal yang DITAMPILKAN di barisnya.
 *
 * Tanggal transaksi dipakai lebih dulu karena itu tanggal yang dilihat orang;
 * kalau pemisah daftar memakai created_at sementara barisnya menulis
 * transacted_at, sebuah bill bisa muncul di bawah judul bulan yang tidak cocok
 * dengan tanggal di barisnya sendiri.
 */
/** Label periode: '2026-10' → 'Okt 2026', '2026' → '2026'. */
function periodLabel(value: string) {
  return value.length === 4 ? value : shortMonthLabel(value)
}

/** Nama bulan pendek untuk grid pilihan: '2026-10' → 'Okt'. */
function monthShort(key: string) {
  const index = Number(key.split('-')[1]) - 1
  return Number.isInteger(index) && index >= 0 && index < 12 ? MONTH_NAMES[index].slice(0, 3) : '—'
}

function monthKeyOf(bill: { transacted_at: string | null; created_at: string }) {
  const parsed = new Date((bill.transacted_at ?? bill.created_at).replace(' ', 'T'))
  if (Number.isNaN(parsed.getTime())) return ''
  return parsed.getFullYear() + '-' + String(parsed.getMonth() + 1).padStart(2, '0')
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
  status,
}: {
  id: string
  title: string
  meta: string
  share: number
  total: number
  flag?: { kind: 'pay' | 'split'; text: string }
  settled?: boolean
  /** Selalu ada. Tinggi baris harus sama di seluruh daftar: daftar yang
   *  separuh tiga baris dan separuh dua baris terbaca sebagai daftar rusak. */
  status: RowStatus
}) {
  return (
    <Link to="/b/$billId" params={{ billId: id }} style={{ textDecoration: 'none', color: 'inherit' }}>
      <span className="app-row">
        <span className="grow">
          <b>{title}</b>
          {/* Pemisah ' · ' tidak lagi ditulis sebagai teks di antara potongan.
              Kalau penandanya membungkus ke baris berikutnya, titik itu
              tertinggal sendirian di ujung baris pertama — persis yang terlihat
              di "28 Okt · Ayam Kremesan ·". Sekarang tiap potongan jadi anak
              flex sendiri, dan jaraknya diatur gap: membungkus jadi rapi. */}
          <small className="row-meta">{meta}</small>
          {/* Baris ketiga, selalu ada — termasuk untuk bill yang sudah lunas dan
              untuk bill yang tidak menuntut apa-apa. Dua alasan:
              (1) tinggi baris jadi seragam; daftar yang separuh tiga baris dan
                  separuh dua baris terbaca sebagai daftar yang berantakan;
              (2) status tidak lagi berebut ruang dengan tanggal dan nama
                  merchant, jadi tidak ada yang terpotong atau terasa mepet. */}
          <span className={`row-status row-status--${status.tone}`}>
            {status.tone === 'success' ? (
              <StatusBadge tone="success" compact>
                {status.text}
              </StatusBadge>
            ) : (
              <>
                <status.Icon size={13} weight="bold" aria-hidden="true" />
                {status.text}
              </>
            )}
          </span>
        </span>
        <span className={'amt' + (settled ? ' is-settled' : '')}>
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
   * Beranda menampilkan SEMUA bulan sekaligus, dipisah judul bulan.
   *
   * Versi sebelumnya memilih satu bulan lewat baris chip. Itu salah bentuk:
   * chip adalah daftar pilihan, sedangkan yang dicari orang di beranda adalah
   * "bill apa saja yang saya punya" — bukan "bulan mana yang mau saya pilih".
   * Sekarang daftarnya mengalir seperti riwayat (judul bulan sebagai pemisah),
   * dan penyaringan bulan/status ada di satu tombol "Atur" yang membuka sheet.
   * Ini pola yang sudah dipakai UI 0.9, jadi orang yang pernah memakainya tidak
   * perlu belajar kontrol baru.
   *
   * Yang tetap mahal dijaga: halaman tidak merender ratusan baris sekaligus.
   * Daftar dipotong per 20 baris dengan tombol "Muat lagi".
   */
  /**
   * Satu permintaan untuk seluruh riwayat, satu sumber untuk semua angka.
   *
   * Bulan TIDAK diminta ulang ke server saat disaring (`?month=`) dan bulan
   * juga tidak diambil dari endpoint ringkasan terpisah. Kalau daftar datang
   * dari satu query sementara pemisah bulan, jumlah per bulan, dan angka di
   * blok kuning datang dari query lain, keempatnya bisa bercerita beda pada
   * saat yang sama — dan itu bukan hipotesis: blok kuning pernah menghitung
   * hanya bill "belum selesai" sehingga bill yang tinggal dibayar tidak ikut
   * dihitung (server bilang 2, blok kuning bilang 1).
   *
   * Riwayat 60-70 bill bukan beban: satu query, dan yang dirender hanya 20
   * baris pertama. Pola ini sama dengan 0.9 — daftar penuh, saringan di klien.
   */
  const [query, setQuery] = useState('')
  /**
   * Periode saringan: `null` (semua), `'2026'` (satu tahun), atau `'2026-10'`
   * (satu bulan).
   *
   * Tahun ikut dipilih, bukan cuma bulan: dengan riwayat tiga tahun, daftar
   * bulan saja berarti 36 baris pilihan di dalam sheet dan orang tetap harus
   * menggulir untuk menemukan tahun yang dia mau. Tahun dulu, baru bulan.
   */
  const [period, setPeriod] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('semua')
  const [sheetOpen, setSheetOpen] = useState(false)
  const [visible, setVisible] = useState(PAGE_ROWS)
  const searching = query.trim().length > 0
  const bills = useBills(identityId, null, true)
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
  /**
   * Angka di blok kuning dihitung dari baris yang SAMA dengan daftar di
   * bawahnya: `bill.action` dari server. Satu sumber, jadi angka besar dan
   * jumlah penanda di baris tidak mungkin berbeda.
   *
   * Dua sumber yang pernah dicoba dan gagal: `provisional.bills` (hanya bill
   * yang pembagiannya belum selesai — bill "tinggal kamu bayar" yang sudah
   * final tidak ikut), dan `recap.actions.current_user` (tidak memuat
   * kebutuhan pemilik memilih itemnya sendiri, jadi angkanya kurang satu).
   */
  const actionRows = rows.filter((bill) => Boolean(bill.action))
  const splitCount = actionRows.filter((bill) => bill.action === 'split').length
  const payCount = actionRows.filter((bill) => bill.action === 'pay').length
  const actionTotal = actionRows.length
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
      // Pencarian mengabaikan saringan bulan: orang yang mengetik nama bill
      // tidak sedang memilih bulan, dan hasil yang hilang tanpa penjelasan lebih
      // buruk daripada daftar yang lebih panjang.
      const matchesPeriod = searching || !period || monthKeyOf(bill).startsWith(period)
      return matchesText && matchesFilter && matchesPeriod
    })
  }, [rows, query, filter, period, reasons])

  /**
   * Urutan baris mengikuti server (tanggal terbaru dulu), bukan "yang perlu
   * dikerjakan dulu": penanda kerjaan sudah menempel di barisnya, dan kalau
   * urutan berubah sendiri orang tidak bisa menebak di mana bill yang tadi
   * dilihat. Yang perlu dikerjakan punya chip + blok kuning sendiri.
   */
  /**
   * Opsi bulan dihitung dari baris yang sudah dimuat. Endpoint ringkasan bulan
   * terpisah (`/bills/months`) jadi tidak perlu: kalau daftarnya sudah penuh di
   * klien, menghitung ulang di server hanya menambah satu angka yang bisa
   * berbeda dari daftar.
   */
  const years = useMemo(() => {
    const tree = new Map<string, { count: number; months: Map<string, number> }>()
    for (const bill of rows) {
      const key = monthKeyOf(bill)
      if (!key) continue
      const [year, month] = key.split('-')
      const entry = tree.get(year) ?? { count: 0, months: new Map<string, number>() }
      entry.count += 1
      entry.months.set(month, (entry.months.get(month) ?? 0) + 1)
      tree.set(year, entry)
    }
    return [...tree.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([year, entry]) => ({
        year,
        bill_count: entry.count,
        months: [...entry.months.entries()]
          .sort((a, b) => (a[0] < b[0] ? -1 : 1))
          .map(([month, count]) => ({ month, bill_count: count })),
      }))
  }, [rows])

  /**
   * Tahun yang grid bulannya sedang terbuka = tahun yang sedang dipilih.
   *
   * Tidak ada "tahun default": grid yang menampilkan tahun terbaru sementara
   * saringannya "Semua tahun" membuat Oktober 2026 terlihat seolah berlaku
   * untuk seluruh riwayat. Grid hanya ada kalau memang ada tahun yang dipilih.
   */
  const sheetYear = period ? period.slice(0, 4) : null
  const sheetMonths = years.find((entry) => entry.year === sheetYear)?.months ?? []

  /**
   * Baris ketiga. Urutannya mengikuti aturan server (`_action_kind`): kalau
   * pembagian belum lengkap, menagih bayar belum masuk akal.
   *
   * "Belum dipilih" / "Tinggal dibayar" tetap KATA, bukan lencana — itu
   * perintah. "Lunas" lencana — itu keadaan. Dua bentuk berbeda untuk dua jenis
   * pesan, dan sekarang tidak lagi berebut ruang karena punya barisnya sendiri.
   */
  const statusFor = (bill: (typeof rows)[number]): RowStatus => {
    if (bill.settled) return { tone: 'success', text: 'Lunas', Icon: CheckCircle }
    const kind = reasons.get(bill.id)
    if (kind === 'split') {
      const left = uncoveredByBill.get(bill.id) ?? 0
      return {
        tone: 'pending',
        text: !bill.has_picks ? 'Belum dipilih' : left > 1 ? 'Pilih ' + left + ' lagi' : 'Pilih 1 lagi',
        Icon: WarningCircle,
      }
    }
    if (kind === 'pay') return { tone: 'danger', text: 'Tinggal dibayar', Icon: WarningCircle }
    // Tidak ada tindakan dan belum lunas: bagian orang ini sudah beres, sisanya
    // urusan orang lain. Dulu keadaan ini tidak punya kalimat sama sekali.
    if (bill.my_paid) return { tone: 'quiet', text: 'Sudah kamu bayar', Icon: CheckCircle }
    if (!bill.my_total_idr) return { tone: 'quiet', text: 'Belum ada bagianmu', Icon: Clock }
    return { tone: 'quiet', text: 'Menunggu yang lain', Icon: Clock }
  }

  const flagFor = (bill: (typeof rows)[number]) => {
    const kind = reasons.get(bill.id)
    if (kind === 'split') {
      const left = uncoveredByBill.get(bill.id) ?? 0
      return {
        kind: 'split' as const,
        /* Label sengaja pendek. Di 390 px satu baris meta harus memuat tanggal +
           merchant + status; label 22 karakter memakan separuh lebar kolom teks
           dan memaksa nama merchant dipotong jadi "Aya...". Kata "kamu" dibuang
           karena seluruh layar ini memang bill milik penontonnya. */
        text: !bill.has_picks
          ? 'Belum dipilih'
          : left > 1
            ? 'Pilih ' + left + ' lagi'
            : 'Pilih 1 lagi',
      }
    }
    if (kind === 'pay') return { kind: 'pay' as const, text: 'Tinggal dibayar' }
    return undefined
  }

  // Saringan aktif dihitung dari yang benar-benar mengubah isi daftar.
  const activeFilterCount = (period ? 1 : 0) + (filter === 'semua' ? 0 : 1)

  /**
   * Daftar dipotong dulu, baru dikelompokkan. Kalau dikelompokkan dulu lalu
   * dipotong, "Muat lagi" bisa berhenti di tengah bulan dan judul bulannya
   * muncul dua kali.
   */
  const groups = useMemo(() => {
    const out: { label: string; items: typeof rows }[] = []
    for (const bill of shown.slice(0, visible)) {
      const key = monthKeyOf(bill)
      const label = key ? monthLabel(key) : 'Tanpa tanggal'
      const last = out[out.length - 1]
      if (last && last.label === label) last.items.push(bill)
      else out.push({ label, items: [bill] })
    }
    return out
  }, [shown, visible, rows])

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
          onClick={() => {
            // Mengetuk blok kuning = "tunjukkan yang perlu dikerjakan". Kalau
            // bulan masih tersaring, sebagian dari angka itu tidak akan muncul
            // dan angkanya terlihat bohong — jadi bulannya dilepas.
            const next = filter === 'perlu' ? 'semua' : 'perlu'
            setFilter(next)
            if (next === 'perlu') setPeriod(null)
            setVisible(PAGE_ROWS)
          }}
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

          {/* Satu kontrol, bukan baris pilihan. Bulan dan status ada di sheet
              yang sama, dan angka di tombolnya memberi tahu berapa saringan yang
              sedang aktif — tanpa itu orang bingung kenapa daftarnya pendek.
              Bentuk ini sengaja sama dengan 0.9 ("⇅ Atur"), bukan chip. */}
          <div className="list-toolbar">
            <span className="list-toolbar-title">
              Bill kamu
              <span className="list-toolbar-count">
                {shown.length === rows.length ? shown.length + ' bill' : shown.length + ' dari ' + rows.length}
              </span>
            </span>
            <button
              type="button"
              className={'list-toolbar-btn' + (activeFilterCount > 0 ? ' is-active' : '')}
              aria-haspopup="dialog"
              onClick={() => setSheetOpen(true)}
            >
              <FunnelSimple size={16} weight="bold" aria-hidden="true" />
              Atur{activeFilterCount > 0 ? ' · ' + activeFilterCount : ''}
            </button>
          </div>

          {/* Saringan aktif harus kelihatan di badan layar, bukan cuma sebagai
              angka di tombol "Atur": setelah tombol ditutup, tidak ada lagi yang
              memberi tahu kenapa daftarnya pendek — dan orang menyimpulkan
              bill-nya hilang. Satu baris ini sekaligus jalan keluarnya. */}
          {activeFilterCount > 0 ? (
            <div className="filter-active">
              <span>
                {filter !== 'semua'
                  ? (FILTERS.find((option) => option.key === filter)?.label ?? '')
                  : ''}
                {filter !== 'semua' && period ? ' · ' : ''}
                {period ? periodLabel(period) : ''}
              </span>
              <button
                type="button"
                onClick={() => {
                  setFilter('semua')
                  setPeriod(null)
                  setVisible(PAGE_ROWS)
                }}
              >
                Tampilkan semua
              </button>
            </div>
          ) : null}

          {searching ? (
            <div className="app-note">Mencari di semua bulan.</div>
          ) : null}
        </>
      ) : null}

      {rows.length > 0 && shown.length === 0 ? (
        <div className="app-note">Tidak ada bill yang cocok dengan pencarian itu.</div>
      ) : null}

      {/* Riwayat: satu daftar mengalir dengan judul bulan sebagai pemisah,
          seperti 0.9. Tidak ada chip bulan yang harus diketuk dulu — justru itu
          yang membuat orang mengira bill lamanya hilang. */}
      {groups.map((group) => (
        <section className="app-stack" key={group.label}>
          <SectionHead meta={<>{group.items.length} bill</>}>{group.label}</SectionHead>
          <div className="app-list">
            {group.items.map((bill) => (
              <BillRow
                key={bill.id}
                id={bill.id}
                title={bill.title}
                // merchant yang sama dengan judul tidak diulang: "SSB BENHIL ·
                // SSB BENHIL" cuma memanjangkan baris tanpa menambah arti
                meta={
                  shortDate(bill.transacted_at ?? bill.created_at) +
                  (bill.merchant && bill.merchant !== bill.title ? ' · ' + bill.merchant : '')
                }
                share={bill.my_total_idr}
                total={bill.total_idr}
                flag={flagFor(bill)}
                settled={bill.settled}
                status={statusFor(bill)}
              />
            ))}
          </div>
        </section>
      ))}

      {shown.length > visible ? (
        <Button variant="secondary" onClick={() => setVisible(visible + PAGE_ROWS)}>
          Muat {Math.min(shown.length - visible, PAGE_ROWS)} lagi ({shown.length - visible} tersisa)
        </Button>
      ) : null}

      {/* Satu sheet untuk bulan + status, pola 0.9. Isinya berlaku langsung
          (daftar di belakang ikut berubah), "Terapkan" hanya menutup. */}
      {/* "Saring bill", bukan "Filter & urutkan": sheet ini tidak punya kontrol
          urutan sama sekali, dan judul yang menjanjikan sesuatu yang tidak ada
          lebih buruk daripada judul yang pendek. */}
      <Sheet open={sheetOpen} title="Saring bill" onClose={() => setSheetOpen(false)}>
        {/* Dua bidang, satu pola: label kecil di atas, kontrol di bawahnya,
            jarak antarbidang 24 px. Sebelumnya chip status mengambang tanpa
            label dan jaraknya ke blok periode cuma 16 px — dua kelompok berbeda
            terbaca sebagai satu tumpukan. */}
        <div className="ds-field">
          <div className="ds-field-head">
            <span className="ds-field-label">Status</span>
          </div>
          <div className="ds-chip-grid" role="group" aria-label="Saring bill">
          {FILTERS.filter((option) => option.key !== 'perlu' || actionTotal > 0).map((option) => (
            <button
              key={option.key}
              type="button"
              className={'chip-filter' + (filter === option.key ? ' is-active' : '')}
              aria-pressed={filter === option.key}
              onClick={() => {
                setFilter(option.key)
                setVisible(PAGE_ROWS)
              }}
            >
              {option.label}
            </button>
          ))}
          </div>
        </div>

        {/* Periode: tahun dulu, baru bulan.
            Dengan riwayat tiga tahun, satu daftar bulan berarti 36 pilihan di
            dalam sheet — orang tetap menggulir untuk mencari tahun, cuma kali
            ini di dalam sheet. Dua tingkat ini menjaga jumlah pilihan yang
            terlihat tetap dua belas, berapa pun panjang riwayatnya. */}
        <div className="ds-field">
          <div className="ds-field-head">
            <span className="ds-field-label">Periode</span>
            {period ? <span className="ds-field-value">{periodLabel(period)}</span> : null}
          </div>

          <div className="ds-chip-row period-years" role="group" aria-label="Tahun">
            <button
              type="button"
              className={'chip-filter' + (period === null ? ' is-active' : '')}
              aria-pressed={period === null}
              aria-label={'Semua tahun, ' + rows.length + ' bill'}
              onClick={() => {
                setPeriod(null)
                setVisible(PAGE_ROWS)
              }}
            >
              {/* Label pendek "Semua" tapi nama aksesibel "Semua tahun, N bill":
                  di layar ia duduk di bawah judul PERIODE, jadi tidak mungkin
                  tertukar dengan chip status "Semua"; untuk pembaca layar dan
                  tes, namanya tetap lengkap. */}
              Semua <span className="chip-count">{rows.length}</span>
            </button>
            {years.map((entry) => {
              const active = period !== null && period.slice(0, 4) === entry.year
              return (
                <button
                  key={entry.year}
                  type="button"
                  className={'chip-filter' + (active ? ' is-active' : '')}
                  aria-pressed={active}
                  aria-label={'Tahun ' + entry.year + ', ' + entry.bill_count + ' bill'}
                  onClick={() => {
                    // Mengetuk tahun yang sedang aktif melebarkan lagi ke
                    // seluruh riwayat, jadi tidak ada keadaan yang terkunci.
                    setPeriod(active ? null : entry.year)
                    setVisible(PAGE_ROWS)
                  }}
                >
                  {entry.year}
                  <span className="chip-count">{entry.bill_count}</span>
                </button>
              )
            })}
          </div>

          {sheetYear && period ? (
            <div className="period-subgroup">
              {/* Grid bulan hanya muncul setelah tahunnya dipilih.
                  Sempat dibuat sebaliknya: saat saringan "Semua tahun" aktif,
                  grid tetap tampil untuk tahun terbaru — dan itu bohong secara
                  diam-diam, karena Oktober 2026 terlihat seolah berlaku untuk
                  seluruh riwayat. Sekarang tidak ada tahun dipilih, tidak ada
                  grid; ada satu baris yang menjelaskan kenapa. */}
              <span className="ds-field-label">Bulan · {sheetYear}</span>
              <div className="period-months" role="group" aria-label={'Bulan ' + sheetYear}>
              {Array.from({ length: 12 }, (_, index) => {
                const key = String(index + 1).padStart(2, '0')
                const entry = sheetMonths.find((month) => month.month === key)
                const value = sheetYear + '-' + key
                const active = period === value
                return (
                  <button
                    key={key}
                    type="button"
                    className={'period-month' + (active ? ' is-active' : '') + (entry ? '' : ' is-empty')}
                    aria-pressed={active}
                    // Nama aksesibel menyebut tahun dan jumlahnya: pembaca layar
                    // hanya mendengar "Okt" kalau tidak, dan tes tidak bisa
                    // membedakan Oktober 2026 dari Oktober 2025.
                    aria-label={monthShort(value) + ' ' + sheetYear + (entry ? ', ' + entry.bill_count + ' bill' : ', kosong')}
                    // bulan tanpa bill tidak bisa dipilih: mengetuknya hanya
                    // menghasilkan daftar kosong tanpa penjelasan
                    disabled={!entry}
                    onClick={() => {
                      setPeriod(active ? sheetYear : value)
                      setVisible(PAGE_ROWS)
                    }}
                  >
                    <b>{monthShort(value)}</b>
                    <span>{entry ? entry.bill_count : '—'}</span>
                  </button>
                )
              })}
              </div>
            </div>
          ) : (
            <p className="ds-field-hint">Pilih tahun untuk menyaring bulannya.</p>
          )}
        </div>

        <div className="sheet-actions">
          <Button block onClick={() => setSheetOpen(false)}>Terapkan</Button>
          {activeFilterCount > 0 ? (
            <Button
              variant="secondary"
              block
              onClick={() => {
                setPeriod(null)
                setFilter('semua')
                setVisible(PAGE_ROWS)
              }}
            >
              Reset filter
            </Button>
          ) : null}
        </div>
      </Sheet>
    </AppShell>
  )
}
