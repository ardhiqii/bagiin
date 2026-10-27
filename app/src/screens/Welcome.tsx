import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useToast } from '../components/Toast'
import { Alert, Button, Field, Notice } from '../ds/primitives'
import { startIdentity } from '../lib/identity'
import { markAuthed, takeIntent } from '../lib/session'
import welcomeArt from '../assets/welcome.webp'

/**
 * Gerbang pertama: tanpa nama, tidak ada yang bisa dikerjakan. Sebelum ini app
 * diam-diam membuat identitas bernama "Teman" saat boot, jadi orang bisa bikin
 * bill tanpa pernah mengisi nama.
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
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const toast = useToast()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  useEffect(() => {
    document.getElementById('welcome-name')?.focus()
  }, [])

  async function submit() {
    if (!name.trim()) {
      setError('Nama tidak boleh kosong')
      return
    }
    setBusy(true)
    setError('')
    try {
      await startIdentity(name.trim())
      markAuthed()
      await queryClient.invalidateQueries()
      toast('Halo, ' + name.trim())
      await onDone?.()
      // halaman yang tadi dituju sebelum ditendang ke sini, kalau ada
      const intent = takeIntent()
      if (intent) window.location.replace(intent)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="app-shell">
      <div className="app-frame">
        <main className="app-body welcome-body">
          <section className="welcome-card">
            <img className="welcome-art" src={welcomeArt} alt="" width={200} height={200} />
            <h1>{expired ? 'Isi nama lagi' : 'Kenalan dulu'}</h1>
            {expired ? (
              /* Satu baris saja: judul sudah bilang "isi nama lagi", jadi notice
                 ini cuma menjelaskan kenapa + satu jalan keluar lain. */
              <Notice
                tone="pending"
                action={
                  <button type="button" className="link-quiet" onClick={() => navigate({ to: '/masuk' })}>
                    Masuk pakai kode
                  </button>
                }
              >
                Identitas di perangkat ini sudah tidak ada di server.
              </Notice>
            ) : (
              <p className="app-note" style={{ margin: 0, textAlign: 'center' }}>
                {context ??
                  'Isi nama kamu dulu. Nama ini yang muncul ke teman waktu kamu bikin atau ikut bill. Tanpa akun, tanpa password.'}
              </p>
            )}
            <div style={{ width: '100%', marginTop: 6 }}>
              <Field
                id="welcome-name"
                label="Nama kamu"
                value={name}
                onChange={(next) => {
                  setName(next)
                  setError('')
                }}
                hint="Contoh: Aufa"
                error={error || undefined}
              />
            </div>
            <Button block loading={busy} disabled={!name.trim()} onClick={submit}>
              Mulai pakai Bagiin
            </Button>
            {expired ? null : (
              <button type="button" className="link-quiet" onClick={() => navigate({ to: '/masuk' })}>
                Sudah punya akun? Masuk pakai kode
              </button>
            )}
            <span className="app-note" style={{ fontSize: 11.5 }}>
              {expired
                ? 'Bill lama tetap aman selama kamu punya kode pemulihan dari perangkat sebelumnya.'
                : 'Namamu tersimpan di perangkat ini saja. Bisa diganti kapan saja di Pengaturan.'}
            </span>
          </section>
        </main>
      </div>
    </div>
  )
}

export function WelcomeError({ message }: { message: string }) {
  return (
    <div className="app-shell">
      <div className="app-frame">
        <main className="app-body">
          <Alert tone="danger" title="Gagal menyiapkan identitas">
            {message}
          </Alert>
        </main>
      </div>
    </div>
  )
}
