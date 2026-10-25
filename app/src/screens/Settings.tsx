import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { AppShell } from '../components/AppShell'
import { useToast } from '../components/Toast'
import { Alert, Button, Field } from '../ds/primitives'
import { renameIdentity, resetIdentity } from '../lib/identity'
import type { Identity } from '../lib/types'

export function Settings({ identity, onIdentity }: { identity: Identity | null; onIdentity: (next: Identity | null) => void }) {
  const toast = useToast()
  const navigate = useNavigate()
  const [name, setName] = useState(identity?.name ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    if (!identity) return
    setBusy(true)
    setError('')
    try {
      const updated = await renameIdentity(identity as never, name.trim())
      onIdentity(updated)
      toast('Nama kamu sudah diperbarui')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function copyId() {
    if (!identity) return
    try {
      await navigator.clipboard.writeText(identity.id)
      toast('ID identitas disalin')
    } catch {
      toast('Gagal menyalin, salin manual dari layar ini')
    }
  }

  return (
    <AppShell title="Pengaturan" subtitle="Identitas dan preferensi" back active="home">
      {error ? <Alert tone="danger" title="Gagal menyimpan">{error}</Alert> : null}

      <Field id="settings-name" label="Nama kamu" value={name} onChange={setName} hint="Nama ini yang muncul ke teman di bill" />
      <Button block loading={busy} disabled={!identity || !name.trim()} onClick={save}>
        Simpan nama
      </Button>

      <section className="app-stack">
        <strong style={{ fontSize: 14, fontWeight: 800 }}>Identitas</strong>
        <div className="app-row">
          <span className="grow">
            <b>{identity?.id ?? '—'}</b>
            <small>Tanpa akun. ID ini yang menyimpan siapa kamu di semua bill.</small>
          </span>
          <button type="button" className="ds-button ds-button-quiet" onClick={copyId}>
            Salin
          </button>
        </div>
      </section>

      <section className="app-stack">
        <strong style={{ fontSize: 14, fontWeight: 800 }}>Mulai dari nol</strong>
        <p className="app-note">Menghapus identitas di perangkat ini. Bill yang sudah kamu buat tetap ada di server, tapi kamu tidak akan bisa membukanya lagi sebagai dirimu.</p>
        <Button
          variant="danger"
          block
          onClick={() => {
            resetIdentity()
            onIdentity(null)
            navigate({ to: '/' })
          }}
        >
          Hapus identitas di perangkat ini
        </Button>
      </section>
    </AppShell>
  )
}
