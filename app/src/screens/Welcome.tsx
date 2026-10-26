import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useToast } from '../components/Toast'
import { Alert, Button, Field } from '../ds/primitives'
import { startIdentity } from '../lib/identity'
import personArt from '../assets/person.webp'

/**
 * Gerbang pertama: tanpa nama, tidak ada yang bisa dikerjakan. Sebelum ini app
 * diam-diam membuat identitas bernama "Teman" saat boot, jadi orang bisa bikin
 * bill tanpa pernah mengisi nama.
 */
export function Welcome({
  context,
  onDone,
}: {
  context?: string
  onDone?: () => void | Promise<void>
}) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const toast = useToast()
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
      await queryClient.invalidateQueries()
      toast('Halo, ' + name.trim())
      await onDone?.()
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
            <img src={personArt} alt="" width={128} height={128} />
            <h1>Kenalan dulu</h1>
            <p className="app-note" style={{ margin: 0, textAlign: 'center' }}>
              {context ??
                'Isi nama kamu dulu. Nama ini yang muncul ke teman waktu kamu bikin atau ikut bill. Tanpa akun, tanpa password.'}
            </p>
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
            <span className="app-note" style={{ fontSize: 11.5 }}>
              Namamu tersimpan di perangkat ini saja. Bisa diganti kapan saja di Pengaturan.
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
