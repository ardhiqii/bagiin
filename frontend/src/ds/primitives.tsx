import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import loadingReceipt from '../assets/anim/receipt-app.webp'
import loadingCoin from '../assets/anim/coin-app.webp'
import { PROVIDERS, opticalHeight, providerKey } from '../lib/providers'
import { CalendarBlank, CaretRight, Check, CheckCircle, Clock, Info, Wallet, WarningCircle, X } from '@phosphor-icons/react'

/* ---------- money ---------- */

export function idr(value: number): string {
  return 'Rp' + Math.round(value).toLocaleString('id-ID')
}

export function Money({ value, size = 'body' }: { value: number; size?: 'display' | 'heading' | 'body' | 'small' }) {
  return <span className={`ds-money ds-money-${size}`}>
    <span className="ds-money-cur" aria-hidden="true">Rp</span>{Math.round(value).toLocaleString('id-ID')}
  </span>
}

/* ---------- buttons ---------- */

type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger' | 'ink'

export function Button({
  children, variant = 'primary', onClick, disabled = false, loading = false, type = 'button', block = false,
  compact = false,
}: {
  children: ReactNode
  variant?: ButtonVariant
  onClick?: () => void
  disabled?: boolean
  loading?: boolean
  type?: 'button' | 'submit'
  block?: boolean
  /** Untuk tombol di dalam baris daftar: padding dan huruf lebih kecil, tinggi
   *  tetap 44 px supaya target sentuh tidak mengecil. */
  compact?: boolean
}) {
  return <button
    type={type}
    className={`ds-button ds-button-${variant}${block ? ' is-block' : ''}${loading ? ' is-loading' : ''}${compact ? ' is-compact' : ''}`}
    onClick={onClick}
    disabled={disabled || loading}
    aria-busy={loading || undefined}
  >
    {loading ? <span className="ds-spinner" aria-hidden="true" /> : null}
    {children}
  </button>
}

/* ---------- status ---------- */

export type Tone = 'pending' | 'info' | 'success' | 'danger'

const TONE_ICON: Record<Tone, typeof Clock> = {
  pending: Clock,
  info: CheckCircle,
  success: Check,
  danger: WarningCircle,
}

export function StatusBadge({
  tone,
  compact = false,
  children,
}: {
  tone: Tone
  children: ReactNode
  /** Untuk dipakai di dalam baris daftar: padding dan huruf dikecilkan supaya
   *  tinggi baris tidak melompat, tapi bacaannya tetap jelas. */
  compact?: boolean
}) {
  const Icon = TONE_ICON[tone]
  return (
    <span className={`ds-badge ds-tone-${tone}${compact ? ' is-compact' : ''}`}>
      <Icon size={compact ? 11 : 14} weight="bold" aria-hidden="true" />
      {children}
    </span>
  )
}

export function Alert({ tone, title, children }: { tone: Tone; title: string; children: ReactNode }) {
  const Icon = TONE_ICON[tone]
  return <div className={`ds-alert ds-tone-${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
    <Icon size={19} weight="bold" aria-hidden="true" />
    <div><b>{title}</b><p>{children}</p></div>
  </div>
}

/**
 * Notice: satu-dua baris konteks di dalam alur (di atas form, di bawah judul).
 * Bedanya dengan Alert bukan sekadar ukuran — Alert menjawab "ada yang gagal",
 * Notice menjawab "perlu kamu tahu sebelum lanjut". Alert selebar kartu di
 * tengah layar pendaftaran menenggelamkan tugas utamanya.
 */
export function Notice({ tone, children, action }: { tone: Tone; children: ReactNode; action?: ReactNode }) {
  const Icon = TONE_ICON[tone]
  return (
    <div className={`ds-notice ds-tone-${tone}`} role="status">
      <Icon size={15} weight="bold" aria-hidden="true" />
      <p>{children}</p>
      {action ? <span className="ds-notice-action">{action}</span> : null}
    </div>
  )
}

/**
 * Judul bagian dalam satu layar. Dipakai 19 kali di lima layar; sebelumnya tiap
 * tempat menulis sendiri <strong className="ds-section-title"> plus spacer plus
 * catatan kecil di kanan, dan uturannya pelan-pelan melenceng antar layar.
 */
export function SectionHead({ children, meta }: { children: ReactNode; meta?: ReactNode }) {
  return (
    <div className="ds-section-head">
      <strong className="ds-section-title">{children}</strong>
      {meta ? (
        <>
          <span className="app-spacer" />
          <span className="app-note">{meta}</span>
        </>
      ) : null}
    </div>
  )
}

/* ---------- surfaces ---------- */


/**
 * Angka uang yang punya ARAH.
 *
 * Konvensi yang dipakai app keuangan (Splitwise dan sejenisnya): merah untuk
 * uang yang harus keluar, hijau untuk uang yang akan masuk. Tandanya ditulis
 * lebih dulu karena tanda tetap terbaca ketika warnanya tidak — buta warna,
 * layar kotor, mode gelap. Nol tidak diberi tanda: nol bukan arah.
 */
export function Amount({
  value,
  signed = false,
  tone: toneProp,
}: {
  value: number
  signed?: boolean
  /** Warna arah, tanpa menulis tanda. Dipakai di baris yang sudah punya
   *  penanda kata kerja: menulis "Tinggal kamu bayar" DAN "−Rp22.000" untuk hal
   *  yang sama membuat baris terbaca dua kali. */
  tone?: 'neg' | 'pos'
}) {
  const zero = Math.round(value) === 0
  const sign = zero || !signed ? '' : value < 0 ? '−' : '+'
  const tone = toneProp ?? (zero ? 'zero' : !signed ? 'flat' : value < 0 ? 'neg' : 'pos')
  return (
    <span className={`ds-amount ds-amount--${tone}`}>
      {sign ? <span className="ds-amount-sign">{sign}</span> : null}
      {idr(Math.abs(value))}
    </span>
  )
}

/**
 * Penanda bahwa satu baris butuh tindakan dari orang yang sedang melihat.
 * Satu baris hanya boleh punya SATU penanda: kalau sebuah bill belum dibagi,
 * menagih bayarnya belum masuk akal — angkanya masih bisa berubah.
 */
export function ActionFlag({
  kind,
  children,
}: {
  kind: 'pay' | 'split'
  children: ReactNode
}) {
  return (
    <span className={`ds-row-flag ds-row-flag--${kind}`}>
      <WarningCircle size={13} weight="fill" aria-hidden="true" />
      {children}
    </span>
  )
}

export function BalanceCard({
  label,
  value,
  note,
  estimate,
  rows,
  onOpenDetail,
  signed = false,
  tone: toneProp,
}: {
  label: string
  value: number
  note?: string
  /** Tulis tanda − / + di depan angka. Di kartu yang sudah punya label arah
   *  ("Harus kamu bayar") tanda itu jadi mubazir dan terlihat seperti coretan,
   *  jadi bawaannya mati. Warna tetap membawa arah. */
  signed?: boolean
  tone?: 'neg' | 'pos'
  /** Rincian dua arah di bawah angka besar: "Terima +Rp230.000" dan
   *  "Bayar −Rp22.000". Angka besar itu NET, dan net tidak sama dengan salah
   *  satu komponennya — tanpa dua baris ini orang harus menebak dari mana
   *  angkanya datang. Tanda + / − dipakai DI SINI karena baris ini aritmetika,
   *  bukan label; di angka besar tidak dipakai karena labelnya sudah menyebut
   *  arah. */
  rows?: { label: string; value: number; tone: 'pos' | 'neg' }[]
  /** Kalau diisi, angka besar jadi tombol yang membuka rincian (pop-up).
   *  Angka besar adalah hal pertama yang dilihat orang, jadi di situlah
   *  pertanyaan "kok segini?" muncul. */
  onOpenDetail?: () => void
  /** Angka kedua: perkiraan dari bill yang pembagiannya belum selesai.
   *  Selalu ditulis dengan "±" dan tidak pernah dijumlahkan ke angka utama —
   *  menjumlahkan yang pasti dengan yang masih bisa berubah menghasilkan angka
   *  yang tidak pasti tapi terlihat pasti. */
  estimate?: { value: number; label?: string }
}) {
  const zero = Math.round(value) === 0
  const sign = zero || !signed ? '' : value < 0 ? '−' : '+'
  const tone = toneProp ?? (zero ? 'zero' : !signed ? 'flat' : value < 0 ? 'neg' : 'pos')
  /* Angka hero tidak boleh terpotong. Di layar 320 px, "Rp1.234.567.890" pada
     34 px lebih lebar dari kartunya: angkanya meluber keluar kotak dan orang
     membaca nominal yang salah. Ukurannya turun satu tingkat setiap kali
     angkanya bertambah panjang — bukan dipotong elipsis, karena nominal yang
     disingkat di aplikasi uang sama saja dengan nominal yang salah. */
  const teksAngka = Math.round(Math.abs(value)).toLocaleString('id-ID')
  const panjangAngka = teksAngka.length > 12 ? ' is-xl' : teksAngka.length > 8 ? ' is-long' : ''
  const angka = (
    <>
      {sign ? <span className="ds-balance-sign">{sign}</span> : null}
      <span className="ds-balance-cur">Rp</span>
      {teksAngka}
    </>
  )
  return <div className="ds-balance">
    <span className="ds-balance-label">{label}</span>
    {onOpenDetail ? (
      <button
        type="button"
        className={`ds-balance-value ds-balance-tap ds-amount--${tone}${panjangAngka}`}
        onClick={onOpenDetail}
        aria-haspopup="dialog"
      >
        {angka}
        <CaretRight size={18} weight="bold" className="ds-balance-caret" aria-hidden="true" />
      </button>
    ) : (
      <strong className={`ds-balance-value ds-amount--${tone}${panjangAngka}`}>{angka}</strong>
    )}
    {rows && rows.length > 0 ? (
      <>
        <span className="ds-balance-cap">sudah pasti</span>
        <dl className="ds-balance-rows">
        {rows.map((row) => (
          <div className="ds-balance-row" key={row.label}>
            <dt>{row.label}</dt>
            <dd className={`ds-amount--${row.tone}`}>
              <span className="ds-balance-row-sign">{row.value < 0 ? '−' : '+'}</span>
              {idr(Math.abs(row.value))}
            </dd>
          </div>
        ))}
        </dl>
      </>
    ) : null}
    {note ? <small className="ds-balance-note">{note}</small> : null}
    {estimate && Math.round(estimate.value) !== 0 ? (
      <span className="ds-balance-est">
        <span className="ds-balance-est-label">{estimate.label ?? 'Perkiraan tambahan'}</span>
        <span className="ds-balance-est-value">± {idr(Math.abs(estimate.value))}</span>
      </span>
    ) : null}
  </div>
}

export function Avatar({ label, tone = 'navy', filled = true }: { label: string; tone?: 'navy' | 'teal' | 'mint' | 'muted'; filled?: boolean }) {
  return <span className={`ds-avatar ds-avatar-${tone}${filled ? '' : ' is-outline'}`} aria-hidden="true">{label}</span>
}

/* ---------- grouped inset list ---------- */

/**
 * Rows live inside one surface with hairline separators inset from the text,
 * which is how a grouped list reads as a single object instead of a pile of
 * outlined boxes. Depth comes from the surface, not from a 1px border on each
 * row.
 */
export function Group({ children, label }: { children: ReactNode; label?: string }) {
  return <div className="ds-group-wrap">
    {label && <span className="ds-group-label">{label}</span>}
    <div className="ds-group">{children}</div>
  </div>
}

/* ---------- provider logo ----------
   Semua logo menempati kotak yang SAMA (56x24). Yang berbeda hanya cara
   gambarnya mengisi kotak itu: wordmark dipatok tinggi 14 px, lambang persegi
   22 px. Tanpa aturan ini, logo dengan rasio 5:1 dan 1:1 akan menuntut ukuran
   berbeda dan membuat kolom kiri tiap baris bergeser. */

export function ProviderLogo({ brand }: { brand: string }) {
  const key = providerKey(brand)
  if (!key) {
    return (
      <span className="ds-provider" aria-hidden="true">
        <Wallet size={20} weight="duotone" className="ds-provider-fallback" />
      </span>
    )
  }
  const { src, ar } = PROVIDERS[key]
  return (
    <span className="ds-provider" aria-hidden="true">
      <img
        className={ar < 1.6 ? 'is-mark' : 'is-wordmark'}
        src={src}
        alt=""
        loading="lazy"
        style={{ height: opticalHeight(ar) }}
      />
    </span>
  )
}

/* ---------- action list (sheet) ----------
   Daftar aksi di dalam sheet: satu grup = satu permukaan, dipisah hairline.
   Tombol pill bertumpuk (sembilan pill mint) susah dipindai dan boros tinggi;
   baris 56 px dengan ikon kiri bisa dipindai tanpa membaca labelnya. */

export function ActionGroup({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className="ds-action-group">
      {label ? <span className="ds-action-group-label">{label}</span> : null}
      <div className="ds-action-list">{children}</div>
    </div>
  )
}

export function ActionRow({
  icon,
  label,
  note,
  trail,
  danger = false,
  onClick,
}: {
  icon: ReactNode
  label: string
  note?: string
  trail?: ReactNode
  danger?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={'ds-action-row' + (danger ? ' is-danger' : '')}
      onClick={onClick}
    >
      <span className="ds-action-icon" aria-hidden="true">{icon}</span>
      <span className="ds-action-copy">
        {label}
        {note ? <small>{note}</small> : null}
      </span>
      {trail ? <span className="ds-action-trail" aria-hidden="true">{trail}</span> : null}
    </button>
  )
}

/* ---------- item row ---------- */

export type ItemState = 'idle' | 'picked' | 'shared'


/* ---------- inputs ---------- */

export function Field({
  label, value, onChange, hint, error, inputMode, id, disabled,
  type = 'text', autoComplete, maxLength, onBlur,
  autoCapitalize = 'sentences', autoCorrect = 'off',
}: {
  label: string
  value: string
  onChange: (next: string) => void
  /** Dipakai kolom yang harus dirapikan saat ditinggal (mis. qty minimal 1). */
  onBlur?: () => void
  hint?: string
  error?: string
  inputMode?: 'text' | 'numeric' | 'email'
  id: string
  disabled?: boolean
  /** password dipakai di layar masuk; date dipakai pemilih tanggal bill */
  type?: 'text' | 'password' | 'email' | 'date'
  autoComplete?: string
  maxLength?: number
  /* Dua pengaturan ini khas iOS dan tidak punya padanan di desktop.
     `autoCorrect` dimatikan sebagai bawaan: di aplikasi uang, nama orang dan
     nama menu yang "dibetulkan" otomatis lebih sering salah daripada menolong
     (mengetik "Aufa" menjadi "Aura"), dan yang salah tidak pernah diberi tahu.
     `autoCapitalize` tetap 'sentences' supaya kalimat biasa tidak berubah jadi
     huruf kecil semua; kolom nama memakai 'words', kolom teknis 'none'. */
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters'
  autoCorrect?: 'on' | 'off'
}) {
  const describedBy = [hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined
  return <div className={`ds-field${error ? ' has-error' : ''}`}>
    <label htmlFor={id}>{label}</label>
    <input
      id={id}
      value={value}
      type={type}
      inputMode={inputMode}
      autoComplete={autoComplete}
      autoCapitalize={autoCapitalize}
      autoCorrect={autoCorrect}
      spellCheck={autoCorrect === 'off' ? false : undefined}
      maxLength={maxLength}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onBlur}
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy}
    />
    {hint && !error && <small id={`${id}-hint`} className="ds-field-hint">{hint}</small>}
    {error && <small id={`${id}-error`} className="ds-field-error">{error}</small>}
  </div>
}

/* ---------- tanggal ---------- */

/** 'YYYY-MM-DD' -> 'DD/MM/YYYY' untuk ditampilkan. */
export function isoToIdDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '')
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ''
}

/** 'DD/MM/YYYY' (ketikan orang) -> 'YYYY-MM-DD', atau '' kalau belum sah. */
export function idDateToIso(text: string): string {
  const digits = (text ?? '').replace(/[^0-9]/g, '').slice(0, 8)
  if (digits.length !== 8) return ''
  const day = Number(digits.slice(0, 2))
  const month = Number(digits.slice(2, 4))
  const year = Number(digits.slice(4))
  if (year < 1900 || year > 2200) return ''
  if (month < 1 || month > 12) return ''
  if (day < 1 || day > new Date(year, month, 0).getDate()) return ''
  return `${digits.slice(4)}-${digits.slice(2, 4)}-${digits.slice(0, 2)}`
}

/**
 * Pemilih tanggal yang SELALU tampil dd/mm/yyyy.
 *
 * `<input type="date">` mengikuti bahasa browser, bukan bahasa halaman: di
 * Chrome berbahasa Inggris tanggal 1 November tampil "11/01/2026" — terbaca
 * sebelas Januari oleh orang Indonesia. Kolom ini menyimpan nilainya sebagai
 * dd/mm/yyyy, mengubahnya jadi ISO untuk state, dan tetap menyediakan pemilih
 * kalender bawaan lewat tombol di kanan (nilainya tidak ikut ditampilkan).
 */
export function DateField({
  id, label, value, onChange, hint,
}: {
  id: string
  label: string
  /** ISO 'YYYY-MM-DD' atau '' */
  value: string
  onChange: (iso: string) => void
  hint?: string
}) {
  const [text, setText] = useState(() => isoToIdDate(value))
  const pickerRef = useRef<HTMLInputElement | null>(null)
  const digits = text.replace(/[^0-9]/g, '')
  // lengkap tapi tidak ada di kalender (32/13/2026): jangan diam-diam diterima
  const invalid = digits.length === 8 && !idDateToIso(digits)

  // nilai dari luar (mis. bill lama selesai dimuat) menimpa teks lokal
  useEffect(() => {
    setText(isoToIdDate(value))
  }, [value])

  return (
    <div className="ds-field">
      <label htmlFor={id}>{label}</label>
      <div className="ds-date-field">
        <input
          id={id}
          value={text}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder="hh/bb/tttt"
          aria-invalid={invalid ? true : undefined}
          aria-describedby={hint || invalid ? `${id}-hint` : undefined}
          onBlur={() => {
            // tanggal yang tidak ada tidak boleh tertinggal di layar seolah sah
            if (invalid) setText(isoToIdDate(value))
          }}
          onChange={(event) => {
            const digits = event.target.value.replace(/[^0-9]/g, '').slice(0, 8)
            const pretty = [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4)]
              .filter(Boolean)
              .join('/')
            setText(pretty)
            const iso = idDateToIso(digits)
            if (iso) onChange(iso)
            else if (!digits) onChange('')
          }}
        />
        <button
          type="button"
          className="ds-date-open"
          aria-label="Pilih dari kalender"
          onClick={() => {
            const el = pickerRef.current
            if (!el) return
            if (typeof el.showPicker === 'function') el.showPicker()
            else el.click()
          }}
        >
          <CalendarBlank size={18} weight="bold" aria-hidden="true" />
        </button>
        {/* pemilih kalender asli: tidak terlihat, tidak dibaca pembaca layar */}
        <input
          ref={pickerRef}
          type="date"
          tabIndex={-1}
          aria-hidden="true"
          value={value}
          className="ds-date-native"
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
      {invalid ? (
        <small id={`${id}-hint`} className="ds-field-hint is-error">
          Tanggal itu tidak ada di kalender
        </small>
      ) : hint ? (
        <small id={`${id}-hint`} className="ds-field-hint">{hint}</small>
      ) : null}
    </div>
  )
}

/* ---------- navigation ---------- */


/* ---------- empty state ---------- */

export function EmptyState({ title, children, art, action }: { title: string; children: ReactNode; art?: ReactNode; action?: ReactNode }) {
  return <div className={`ds-empty${art ? ' has-art' : ''}`}>
    {art ?? <span className="ds-empty-icon" aria-hidden="true"><Info size={22} weight="duotone" /></span>}
    <b>{title}</b>
    <p>{children}</p>
    {action && <div className="ds-empty-action">{action}</div>}
  </div>
}

/* ---------- sheet ---------- */

export function Sheet({
  open,
  title,
  art,
  children,
  onClose,
}: {
  open: boolean
  title: string
  art?: string
  children: ReactNode
  onClose: () => void
}) {
  /* Selama sheet terbuka, gulirkan hanya sheet-nya. Tanpa ini, geseran jari di
     sheet yang sudah mentok diteruskan ke halaman di belakangnya (iOS), jadi
     orang kehilangan tempatnya di layar setelah menutup sheet. */
  useEffect(() => {
    if (!open) return
    document.body.classList.add('sheet-open')
    return () => { document.body.classList.remove('sheet-open') }
  }, [open])

  if (!open) return null
  /* Portal ke <body>, BUKAN dirender di tempat pemanggilnya.
     Sheet dulu hidup di dalam <main class="app-body">, dan elemen itu memakai
     `-webkit-overflow-scrolling: touch` + `overflow-y: auto`. Di iOS Safari
     wadah gulir seperti itu menjadi containing block untuk `position: fixed`,
     jadi overlay-nya terkurung di kotak isi: sheet terpotong tepat di atas bar
     "Total bill"/navigasi bawah, sisa isinya tidak pernah bisa dicapai jari
     (dilaporkan di iPhone 15: sheet "Siapa yang ikut?" tidak bisa digulir).
     Chromium tidak mereproduksinya karena `fixed` di sana tetap menempel ke
     viewport — maka bug ini lolos dari semua tes yang ada.
     Dengan portal, sheet selalu milik viewport: menutupi bar bawah, dan
     gulirannya milik sheet itu sendiri. */
  return createPortal(
    <div className="ds-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="ds-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <span className="ds-sheet-handle" aria-hidden="true" />
        <button type="button" className="ds-sheet-close" onClick={onClose} aria-label="Tutup"><X size={20} /></button>
        <div className="ds-sheet-head">
          {art ? <img className="ds-sheet-art" src={art} alt="" width={108} height={108} /> : null}
          <h3>{title}</h3>
        </div>
        {children}
      </section>
    </div>,
    document.body,
  )
}

/**
 * Kerangka isi saat data belum datang.
 *
 * Pengganti "Memuat…" yang cuma teks: bentuknya mengikuti isi aslinya, jadi
 * halaman tidak melompat saat data masuk dan orang sudah tahu apa yang akan
 * muncul. Semua bagian dekoratif ditandai aria-hidden; satu kalimat untuk
 * pembaca layar tetap disediakan lewat .ds-skel-sr.
 */
export function Skeleton({
  width = '100%',
  height = 14,
  radius = 8,
}: {
  width?: number | string
  height?: number | string
  radius?: number
}) {
  return <span className="ds-skel" style={{ width, height, borderRadius: radius }} aria-hidden="true" />
}

/** Kerangka kartu saldo: label, angka besar, satu baris keterangan. */
export function SkeletonCard({ label = 'Memuat' }: { label?: string }) {
  return (
    <div className="ds-skel-card" role="status" aria-live="polite">
      <span className="ds-skel-sr">{label}…</span>
      <Skeleton width={104} height={10} />
      <Skeleton width="58%" height={30} radius={12} />
      <Skeleton width={168} height={12} />
    </div>
  )
}

/**
 * Kerangka daftar: avatar (opsional), dua baris teks, satu angka di kanan.
 *
 * Bentuknya mengikuti daftar aslinya, bukan daftar kartu terpisah: baris asli
 * tinggal di dalam satu kartu dengan pemisah 1 px dan tinggi ~94 px. Versi
 * pertama kerangka ini memakai kartu-kartu terpisah berjarak 8 px setinggi
 * 64 px, jadi yang muncul di layar bukan bayangan isi yang akan datang —
 * melainkan daftar lain yang lebih rapat dan lebih pendek, lalu melompat saat
 * data asli masuk.
 */
export function SkeletonList({
  rows = 3,
  label = 'Memuat',
  avatar = true,
}: {
  rows?: number
  label?: string
  /** daftar bill tidak punya avatar; daftar kontak punya */
  avatar?: boolean
}) {
  return (
    <div className="ds-skel-list" role="status" aria-live="polite">
      <span className="ds-skel-sr">{label}…</span>
      {Array.from({ length: rows }).map((_, index) => (
        <div className={'ds-skel-row' + (avatar ? '' : ' is-bill')} key={index} aria-hidden="true">
          {avatar ? <Skeleton width={40} height={40} radius={14} /> : null}
          <span className="ds-skel-lines">
            <Skeleton width={index % 2 === 0 ? '58%' : '44%'} height={13} />
            <Skeleton width={index % 2 === 0 ? '36%' : '52%'} height={11} />
          </span>
          <Skeleton width={58} height={13} />
        </div>
      ))}
    </div>
  )
}

/**
 * Layar menunggu: karakter bergerak + kerangka isi.
 *
 * Karakternya dua lapisan aset terpisah (struk dan koin) supaya bisa bergerak
 * sendiri-sendiri — struk bergoyang pelan 3,4 detik, koin memantul 1,55 detik
 * dengan squash. Semua lewat transform, jadi compositor yang mengerjakan (60
 * fps) dan asetnya cuma ~22 KB. Animasi 2-frame hasil generate dulu terbaca
 * patah-patah karena hanya 5 fps; jumlah frame bukan jawabannya, memisahkan
 * lapisan dan memberi easing yang benar itu jawabannya.
 */
export function LoadingState({
  label = 'Memuat',
  rows = 2,
}: {
  label?: string
  rows?: number
}) {
  return (
    <div className="ds-loading" role="status" aria-live="polite">
      <div className="ds-loading-art" aria-hidden="true">
        <span className="ds-loading-receipt" style={{ backgroundImage: `url(${loadingReceipt})` }} />
        {/* bayangan digambar di sini, bukan di dalam PNG koin: yang di PNG ikut
            terbang saat koin melompat */}
        <span className="ds-loading-coin-shadow" />
        <span className="ds-loading-coin" style={{ backgroundImage: `url(${loadingCoin})` }} />
      </div>
      <div className="ds-loading-copy">
        <b className="ds-loading-title">{label}…</b>
        {Array.from({ length: rows }).map((_, index) => (
          <Skeleton key={index} width={index === 0 ? '86%' : '58%'} height={11} />
        ))}
      </div>
    </div>
  )
}
