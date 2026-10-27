import { useEffect, type ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useIdentity, type Stored } from '../lib/identity'
import { useSession, rememberIntent } from '../lib/session'
import { BootScreen } from './BootScreen'
import { Welcome } from '../screens/Welcome'

/**
 * Pagar untuk layar yang butuh identitas.
 *
 * Kenapa di komponen, bukan cuma di router: status sesi bisa berubah saat layar
 * sedang terbuka (server menghapus identitas, atau secret di perangkat basi).
 * Router `beforeLoad` hanya jalan sekali per navigasi, jadi perubahan itu tidak
 * akan menendang siapa pun. Komponen ini mendengarkan store dan bereaksi.
 *
 * `children` sengaja berupa fungsi, bukan elemen: kalau berupa elemen,
 * `<Recap identityId={me!.id} />` sudah dievaluasi sebelum pagar sempat menolak,
 * dan null.id meledak justru di layar yang seharusnya tidak pernah dirender.
 *
 * Layar bill sengaja TIDAK memakai pagar ini: link bill harus bisa dibuka orang
 * yang belum punya identitas, mereka memakai tombol "Ikut bill ini".
 */
export function RequireIdentity({ children }: { children: (identity: Stored) => ReactNode }) {
  const session = useSession()
  const identity = useIdentity()
  const navigate = useNavigate()
  const allowed = session.status === 'authed' && Boolean(identity)

  useEffect(() => {
    if (session.status === 'checking' || session.status === 'authed') return
    // ingat halaman yang dituju supaya setelah mengisi nama orang tidak
    // dilempar ke beranda tanpa alasan
    rememberIntent(window.location.pathname + window.location.search)
    void navigate({ to: '/', replace: true })
  }, [session.status, navigate])

  if (session.status === 'checking') return <BootScreen />
  if (!allowed) return <Welcome expired={session.status === 'expired'} />
  return <>{children(identity as Stored)}</>
}
