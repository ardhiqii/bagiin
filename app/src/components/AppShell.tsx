import { Link, useRouter } from '@tanstack/react-router'
import { ArrowLeft } from '@phosphor-icons/react'
import type { ReactNode } from 'react'
import { NavBill, NavCreate, NavHome, NavRecap } from '../ds/icons'

type Tab = 'home' | 'bill' | 'create' | 'recap'

const TABS: { id: Tab; label: string; to: string; Icon: typeof NavHome }[] = [
  { id: 'home', label: 'Beranda', to: '/', Icon: NavHome },
  { id: 'bill', label: 'Bill', to: '/bills', Icon: NavBill },
  { id: 'create', label: 'Buat', to: '/create', Icon: NavCreate },
  { id: 'recap', label: 'Rekap', to: '/recap', Icon: NavRecap },
]

export function AppShell({
  title,
  subtitle,
  back = false,
  active,
  children,
}: {
  title: string
  subtitle?: string
  back?: boolean
  active?: Tab
  children: ReactNode
}) {
  const router = useRouter()
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
          <Link to="/settings" className="app-back" aria-label="Pengaturan">
            <span aria-hidden="true" style={{ fontWeight: 800, fontSize: 13 }}>A</span>
          </Link>
        </header>
        <main className="app-body">{children}</main>
        {active ? (
          <nav className="app-nav" aria-label="Navigasi utama">
            {TABS.map(({ id, label, to, Icon }) => (
              <Link key={id} to={to} className={id === active ? 'is-active' : ''} aria-current={id === active ? 'page' : undefined}>
                <Icon />
                {label}
              </Link>
            ))}
          </nav>
        ) : null}
      </div>
    </div>
  )
}
