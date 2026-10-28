import { Alert } from '../ds/primitives'
import { Entry } from './Entry'

/**
 * Gerbang pertama untuk orang yang belum punya identitas di perangkat ini.
 *
 * Isinya sekarang satu layar yang sama dengan /masuk: isi nama (tanpa akun),
 * kode pemulihan, username+password, dan Google. Dulu layar ini hanya kolom
 * nama, sehingga orang tidak pernah tahu ada cara masuk lain — dan "tanpa akun"
 * terasa dipaksakan.
 */
export function Welcome({
  context,
  onDone,
  expired = false,
}: {
  context?: string
  onDone?: () => void | Promise<void>
  /** true kalau identitas lama sudah tidak dikenal server — bukan pengguna baru */
  expired?: boolean
}) {
  return <Entry initialTab="nama" context={context} expired={expired} onDone={onDone} />
}

export function WelcomeError({ message }: { message: string }) {
  return (
    <div className="app-shell">
      <div className="app-frame app-frame--plain">
        <main className="app-body">
          <Alert tone="danger" title="Gagal menyiapkan identitas">
            {message}
          </Alert>
        </main>
      </div>
    </div>
  )
}
