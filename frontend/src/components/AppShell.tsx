import { Link, useRouter } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useIdentity } from '../lib/identity'
import { ambilRecap, keys } from '../lib/queries'
import { ArrowLeft } from '@phosphor-icons/react'
import type { ReactNode } from 'react'
import { NavCreate, NavHome, NavRecap } from '../ds/icons'

/* Tiga tab. "Bill" dulu tab terpisah padahal isinya daftar bill yang sama
   dengan beranda; penggabungan itu menghapus satu tempat menebak. */
type Tab = 'home' | 'create' | 'recap'

const TABS: { id: Tab; label: string; to: string; Icon: typeof NavHome }[] = [
  { id: 'home', label: 'Beranda', to: '/', Icon: NavHome },
  { id: 'create', label: 'Buat', to: '/create', Icon: NavCreate },
  { id: 'recap', label: 'Rekap', to: '/recap', Icon: NavRecap },
]

export function AppShell({
  title,
  subtitle,
  back = false,
  active,
  footer,
  children,
}: {
  title: string
  subtitle?: string
  back?: boolean
  /** 'none' = navigasi tampil tanpa menyorot tab mana pun (mis. halaman 404). */
  active?: Tab | 'none'
  /** Bar ringkasan yang menempel di bawah isi, di atas navigasi. */
  footer?: ReactNode
  children: ReactNode
}) {
  const router = useRouter()
  const me = useIdentity()
  const qc = useQueryClient()
  /**
   * Panaskan Rekap begitu jari menyentuh tabnya.
   *
   * Rekap menghitung ulang seluruh riwayat, jadi ia layar yang paling terasa
   * kalau dibuka tanpa persiapan. Sentuhan hampir selalu mendahului ketukan,
   * jadi yang tadinya menunggu setelah layar dibuka sekarang terjadi selama
   * jari masih di tab. Kalau cuma lewat tanpa mengetuk, yang terbuang satu
   * permintaan yang isinya memang akan dipakai lagi nanti.
   */
  const panaskanRekap = () => {
    if (!me?.id || qc.getQueryData(keys.recap(me.id))) return
    void qc.prefetchQuery({
      queryKey: keys.recap(me.id),
      queryFn: () => ambilRecap(me.id),
      staleTime: 30_000,
    })
  }
  const initial = (me?.name ?? 'T').trim().charAt(0).toUpperCase()
  return (
    <div className="app-shell">
      <div className="app-frame">
        <header className="app-top">
          {back && (
            <button type="button" className="app-back" aria-label="Kembali" onClick={() => router.history.back()}>
              <ArrowLeft size={18} weight="bold" />
            </button>
          )}
          <h1>
            {title}
            {subtitle ? <span className="app-top-sub">{subtitle}</span> : null}
          </h1>
          <Link to="/settings" className="app-back" aria-label="Pengaturan" title={'Pengaturan · ' + (me?.name ?? '')}>
            <span
              aria-hidden="true"
              style={{ fontFamily: 'var(--ds-font-display)', fontWeight: 'var(--ds-weight-strong)', fontSize: 'var(--ds-text-md)', letterSpacing: 0, lineHeight: 1 }}
            >
              {initial}
            </span>
          </Link>
        </header>
        <main className="app-body">{children}</main>
        {footer ? <div className="app-bottom">{footer}</div> : null}
        {active ? (
          <nav className="app-nav" aria-label="Navigasi utama">
            <span className="app-brand" aria-hidden="true">
              Bagiin
            </span>
            {TABS.map(({ id, label, to, Icon }) => (
              <Link
                key={id}
                to={to}
                className={id === active ? 'is-active' : ''}
                aria-current={id === active ? 'page' : undefined}
                onPointerEnter={id === 'recap' ? panaskanRekap : undefined}
                onPointerDown={id === 'recap' ? panaskanRekap : undefined}
              >
                <Icon />
                {label}
              </Link>
            ))}
            {/* hanya muncul di rail kiri; di ponsel pengaturan lewat avatar */}
            <Link to="/settings" className="app-rail-extra">
              <span className="app-rail-avatar" aria-hidden="true">
                {initial}
              </span>
              <span className="app-rail-name">{me?.name ?? 'Pengaturan'}</span>
            </Link>
          </nav>
        ) : null}
      </div>
    </div>
  )
}
