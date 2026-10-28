import { useMemo, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { inviteActions, useBills, useInvites, useRecap } from '../lib/queries'
import { invalidateInviteViews } from '../lib/mutations'
import { formatRp } from '../lib/money'
import { api } from '../lib/api'
import { useToast } from '../components/Toast'
import { AppShell } from '../components/AppShell'
import { ActionFlag, Alert, Amount, BalanceCard, Button, EmptyState, Notice, SectionHead } from '../ds/primitives'
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
}: {
  id: string
  title: string
  meta: string
  share: number
  total: number
  flag?: { kind: 'pay' | 'split'; text: string }
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

  const net = recap.data?.final.net_idr ?? 0
  const provisional = recap.data?.provisional
  // Perkiraan = jumlah yang masih bisa berubah, dari bill yang pembagiannya
  // belum selesai. Arahnya boleh berlawanan dengan angka pasti; karena itu dia
  // tidak pernah dijumlahkan ke angka pasti, hanya ditaruh di baris sendiri.
  const estimate = provisional
    ? (provisional.receivable_idr ?? 0) - (provisional.payable_idr ?? 0)
    : 0

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
    if (bill.settled) return null
    // Bill bernilai nol tidak menuntut apa pun: tidak ada bagian untuk dipilih
    // dan tidak ada yang bisa dibayar. Dulu bill seperti ini menulis "Kamu belum
    // pilih item" selamanya — satu tugas yang mustahil diselesaikan.
    if (bill.total_idr === 0) return null
    // Belum memilih item = pekerjaan saya, titik.
    if (!bill.has_picks) return 'split'
    // Sudah memilih dan masih ada bagian saya yang belum dibayar: angka saya
    // sudah pasti (bagian orang lain tidak mengubahnya), jadi ini tinggal bayar.
    if (!bill.my_paid && bill.my_total_idr > 0) return 'pay'
    // Sisa yang tidak diambil siapa pun jatuh ke pembayar. Kalau saya pembayar
    // dan masih ada sisa, bill ini belum selesai menurut saya.
    if (bill.i_am_payer && bill.uncovered_idr > 0) return 'split'
    // Selain itu bukan urusan saya: porsi orang lain yang belum diambil akan
    // ditanggung pembayar, dan bagian saya tidak ikut berubah. Menandainya
    // sebagai tugas saya cuma bikin daftar terlihat penuh.
    return null
  }
  const reasons = new Map(rows.map((bill) => [bill.id, reasonOf(bill)]))
  const splitCount = [...reasons.values()].filter((kind) => kind === 'split').length
  const payCount = [...reasons.values()].filter((kind) => kind === 'pay').length
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
   * Bill yang menunggu tindakan saya naik ke atas. Tanpa ini, angka "5 bill
   * perlu dibereskan" di atas tidak kelihatan cocok dengan layar: baris yang
   * ditandai bisa saja berada di bawah lipatan.
   */
  const byAction = (bill: (typeof rows)[number]) => (reasons.get(bill.id) ? 0 : 1)
  const open = shown.filter((bill) => !bill.settled).sort((a, b) => byAction(a) - byAction(b))
  const settled = shown.filter((bill) => bill.settled)

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
      {net === 0 && rows.length === 0 ? null : net === 0 ? (
        <Notice
          tone={estimate !== 0 ? 'pending' : 'success'}
          action={
            estimate !== 0 ? (
              <Link to="/recap" className="link-quiet">
                Bagi sekarang
              </Link>
            ) : undefined
          }
        >
          {/* Tanpa angka pasti, perkiraannya yang disebut — tetap dengan "±" dan
              tetap tanpa dijumlahkan ke apa pun. */}
          {estimate !== 0
            ? 'Belum ada angka pasti. Perkiraan ' +
              (estimate > 0 ? '+' : '−') +
              formatRp(Math.abs(estimate)) +
              ' dari bill yang pembagiannya belum selesai.'
            : 'Tidak ada utang tersisa di antara kamu dan teman-temanmu.'}
        </Notice>
      ) : (
        <BalanceCard
          label={net > 0 ? 'Harus kamu terima' : 'Harus kamu bayar'}
          value={net}
          // Tanpa tanda minus: labelnya sudah menyebut arahnya ("Harus kamu
          // bayar"), dan "harus bayar −Rp22.000" terbaca seperti uang kembali.
          // Minus dipakai di baris daftar, di sana tidak ada label yang
          // menjelaskan arah. Aturannya satu: tanda hanya kalau tidak ada label.
          tone={net > 0 ? 'pos' : 'neg'}
          // Catatan ini menjawab "angka ini angka apa", bukan menambah hitungan.
          // Angkanya NET: satu baris bill bisa lebih besar dari total karena ada
          // bill lain yang justru menagih ke kita.
          // "Angka ini angka apa": angka NET, sudah dikurangi arah sebaliknya.
          note={
            estimate !== 0
              ? net > 0
                ? 'Sudah dikurangi yang harus kamu bayar'
                : 'Sudah dikurangi yang harus kamu terima'
              : 'Semua bill sudah selesai'
          }
          estimate={estimate !== 0 ? { value: estimate } : undefined}
        />
      )}

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
            <small>{breakdown}</small>
          </span>
          {/* Bukan panah: panah di blok ini dulu menjanjikan pindah layar padahal
              cuma menyaring daftar di bawahnya. Sekarang bloknya sendiri yang
              menyaring, dan yang menandakan itu adalah chip "Perlu dikerjakan"
              yang ikut aktif — bukan janji yang tidak ditepati. */}
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
                // merchant yang sama dengan judul tidak diulang: "SSB BENHIL ·
                // SSB BENHIL" cuma memanjangkan baris tanpa menambah arti
                meta={
                  shortDate(bill.created_at) +
                  (bill.merchant && bill.merchant !== bill.title ? ' · ' + bill.merchant : '')
                }
                share={bill.my_total_idr}
                total={bill.total_idr}
                flag={flagFor(bill)}
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
                // merchant yang sama dengan judul tidak diulang: "SSB BENHIL ·
                // SSB BENHIL" cuma memanjangkan baris tanpa menambah arti
                meta={
                  shortDate(bill.created_at) +
                  (bill.merchant && bill.merchant !== bill.title ? ' · ' + bill.merchant : '')
                }
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
