import type { ReactNode } from 'react'
import loadingReceipt from '../assets/anim/receipt-app.webp'
import loadingCoin from '../assets/anim/coin-app.webp'
import { PROVIDERS, opticalHeight, providerKey } from '../lib/providers'
import { CaretRight, Check, CheckCircle, Clock, Info, Wallet, WarningCircle, X } from '@phosphor-icons/react'

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

export function StatusBadge({ tone, children }: { tone: Tone; children: ReactNode }) {
  const Icon = TONE_ICON[tone]
  return <span className={`ds-badge ds-tone-${tone}`}><Icon size={14} weight="bold" aria-hidden="true" />{children}</span>
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
  const angka = (
    <>
      {sign ? <span className="ds-balance-sign">{sign}</span> : null}
      <span className="ds-balance-cur">Rp</span>
      {Math.round(Math.abs(value)).toLocaleString('id-ID')}
    </>
  )
  return <div className="ds-balance">
    <span className="ds-balance-label">{label}</span>
    {onOpenDetail ? (
      <button
        type="button"
        className={`ds-balance-value ds-balance-tap ds-amount--${tone}`}
        onClick={onOpenDetail}
        aria-haspopup="dialog"
      >
        {angka}
        <CaretRight size={18} weight="bold" className="ds-balance-caret" aria-hidden="true" />
      </button>
    ) : (
      <strong className={`ds-balance-value ds-amount--${tone}`}>{angka}</strong>
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
  type = 'text', autoComplete, maxLength,
}: {
  label: string
  value: string
  onChange: (next: string) => void
  hint?: string
  error?: string
  inputMode?: 'text' | 'numeric' | 'email'
  id: string
  disabled?: boolean
  /** password dipakai di layar masuk; default teks biasa */
  type?: 'text' | 'password' | 'email'
  autoComplete?: string
  maxLength?: number
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
      maxLength={maxLength}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy}
    />
    {hint && !error && <small id={`${id}-hint`} className="ds-field-hint">{hint}</small>}
    {error && <small id={`${id}-error`} className="ds-field-error">{error}</small>}
  </div>
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
  if (!open) return null
  return <div className="ds-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="ds-sheet" role="dialog" aria-modal="true" aria-label={title}>
      <span className="ds-sheet-handle" aria-hidden="true" />
      <button type="button" className="ds-sheet-close" onClick={onClose} aria-label="Tutup"><X size={20} /></button>
      <div className="ds-sheet-head">
        {art ? <img className="ds-sheet-art" src={art} alt="" width={108} height={108} /> : null}
        <h3>{title}</h3>
      </div>
      {children}
    </section>
  </div>
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

/** Kerangka daftar: avatar, dua baris teks, satu angka di kanan. */
export function SkeletonList({ rows = 3, label = 'Memuat' }: { rows?: number; label?: string }) {
  return (
    <div className="ds-skel-list" role="status" aria-live="polite">
      <span className="ds-skel-sr">{label}…</span>
      {Array.from({ length: rows }).map((_, index) => (
        <div className="ds-skel-row" key={index} aria-hidden="true">
          <Skeleton width={40} height={40} radius={14} />
          <span style={{ flex: 1, display: 'grid', gap: 7 }}>
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
        <b style={{ fontSize: 15 }}>{label}…</b>
        {Array.from({ length: rows }).map((_, index) => (
          <Skeleton key={index} width={index === 0 ? '86%' : '58%'} height={11} />
        ))}
        <span className="ds-loading-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      </div>
    </div>
  )
}
