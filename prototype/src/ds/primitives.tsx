import type { ReactNode } from 'react'
import { Check, CheckCircle, Clock, Info, WarningCircle, X } from '@phosphor-icons/react'

/* ---------- money ---------- */

export function idr(value: number): string {
  return 'Rp' + Math.round(value).toLocaleString('id-ID')
}

export function Money({ value, size = 'body' }: { value: number; size?: 'display' | 'heading' | 'body' | 'small' }) {
  return <span className={`ds-money ds-money-${size}`}>{idr(value)}</span>
}

/* ---------- buttons ---------- */

type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger'

export function Button({
  children, variant = 'primary', onClick, disabled = false, loading = false, type = 'button', block = false,
}: {
  children: ReactNode
  variant?: ButtonVariant
  onClick?: () => void
  disabled?: boolean
  loading?: boolean
  type?: 'button' | 'submit'
  block?: boolean
}) {
  return <button
    type={type}
    className={`ds-button ds-button-${variant}${block ? ' is-block' : ''}${loading ? ' is-loading' : ''}`}
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

/* ---------- surfaces ---------- */

export function Card({ children, tone = 'surface', pad = 'md' }: { children: ReactNode; tone?: 'surface' | 'navy' | 'mint'; pad?: 'sm' | 'md' | 'lg' }) {
  return <div className={`ds-card ds-card-${tone} ds-pad-${pad}`}>{children}</div>
}

export function BalanceCard({ label, value, note }: { label: string; value: number; note: string }) {
  return <div className="ds-balance">
    <span className="ds-balance-label">{label}</span>
    <strong className="ds-balance-value">{idr(value)}</strong>
    <small className="ds-balance-note">{note}</small>
  </div>
}

export function Avatar({ label, tone = 'navy', filled = true }: { label: string; tone?: 'navy' | 'teal' | 'mint' | 'muted'; filled?: boolean }) {
  return <span className={`ds-avatar ds-avatar-${tone}${filled ? '' : ' is-outline'}`} aria-hidden="true">{label}</span>
}

/* ---------- item row ---------- */

export type ItemState = 'idle' | 'picked' | 'shared'

export function ItemRow({
  name, note, price, discount = 0, state = 'idle', onToggle,
}: {
  name: string
  note: string
  price: number
  discount?: number
  state?: ItemState
  onToggle?: () => void
}) {
  const picked = state === 'picked' || state === 'shared'
  const label = state === 'shared' ? `${name}, dibagi beberapa orang, ketuk untuk mengubah` : `${name}, ketuk untuk ${picked ? 'membatalkan' : 'memilih'}`
  return <button type="button" className={`ds-item is-${state}`} onClick={onToggle} aria-pressed={picked} aria-label={label}>
    <span className="ds-item-check" aria-hidden="true">{picked ? <Check size={15} weight="bold" /> : null}</span>
    <span className="ds-item-copy">
      <b>{name}</b>
      <small>{note}</small>
      {state === 'shared' && <span className="ds-item-shared">Dibagi 3 orang · 1 bagian menunggu</span>}
    </span>
    <span className="ds-item-price">
      <Money value={price - discount} size="small" />
      {discount > 0 && <small className="ds-item-discount">−{idr(discount)}</small>}
    </span>
  </button>
}

/* ---------- inputs ---------- */

export function Field({
  label, value, onChange, hint, error, inputMode, id,
}: {
  label: string
  value: string
  onChange: (next: string) => void
  hint?: string
  error?: string
  inputMode?: 'text' | 'numeric'
  id: string
}) {
  const describedBy = [hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined
  return <div className={`ds-field${error ? ' has-error' : ''}`}>
    <label htmlFor={id}>{label}</label>
    <input
      id={id}
      value={value}
      inputMode={inputMode}
      onChange={(event) => onChange(event.target.value)}
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy}
    />
    {hint && !error && <small id={`${id}-hint`} className="ds-field-hint">{hint}</small>}
    {error && <small id={`${id}-error`} className="ds-field-error">{error}</small>}
  </div>
}

/* ---------- navigation ---------- */

export function BottomNav({ active = 'bill' }: { active?: 'home' | 'bill' | 'create' | 'recap' }) {
  const entries: Array<{ id: 'home' | 'bill' | 'create' | 'recap'; label: string }> = [
    { id: 'home', label: 'Beranda' },
    { id: 'bill', label: 'Bill' },
    { id: 'create', label: 'Buat' },
    { id: 'recap', label: 'Rekap' },
  ]
  return <nav className="ds-nav" aria-label="Contoh navigasi bawah">
    {entries.map((entry) => <span key={entry.id} className={entry.id === active ? 'is-active' : ''} aria-current={entry.id === active ? 'page' : undefined}>
      <span className="ds-nav-dot" aria-hidden="true" />{entry.label}
    </span>)}
  </nav>
}

/* ---------- empty state ---------- */

export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return <div className="ds-empty">
    <span className="ds-empty-icon" aria-hidden="true"><Info size={22} weight="duotone" /></span>
    <b>{title}</b>
    <p>{children}</p>
  </div>
}

/* ---------- sheet ---------- */

export function Sheet({ open, title, children, onClose }: { open: boolean; title: string; children: ReactNode; onClose: () => void }) {
  if (!open) return null
  return <div className="ds-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="ds-sheet" role="dialog" aria-modal="true" aria-label={title}>
      <span className="ds-sheet-handle" aria-hidden="true" />
      <button type="button" className="ds-sheet-close" onClick={onClose} aria-label="Tutup"><X size={20} /></button>
      <h3>{title}</h3>
      {children}
    </section>
  </div>
}
