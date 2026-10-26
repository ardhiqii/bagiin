import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useToast } from '../components/Toast'
import { Button, Field } from '../ds/primitives'
import { restoreFromCode } from '../lib/identity'
import keyArt from '../assets/welcome.webp'

/**
 * Masuk di perangkat lain pakai kode pemulihan. Tanpa akun dan tanpa password:
 * kode itu satu-satunya bukti "ini orang yang sama", karena tagihan yang
 * menempel di identitas ini tidak boleh pindah tangan.
 */
export function Restore() {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const toast = useToast()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  useEffect(() => {
    document.getElementById('restore-code')?.focus()
  }, [])

  async function submit() {
    if (!code.trim()) {
      setError('Kode belum diisi')
      return
    }
    setBusy(true)
    setError('')
    try {
      const me = await restoreFromCode(code)
      await queryClient.invalidateQueries()
      toast('Masuk sebagai ' + me.name)
      await navigate({ to: '/' })
    } catch (err) {
      const msg = (err as Error).message
      // backend mengirim "Code tidak dikenal" — istilahnya diterjemahkan supaya
      // pesan yang dibaca orang konsisten dengan label di layar
      setError(
        /tidak dikenal/i.test(msg)
          ? 'Kode tidak dikenal. Periksa huruf dan angkanya, lalu coba lagi.'
          : msg,
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="app-shell">
      <div className="app-frame">
        <main className="app-body welcome-body">
          <section className="welcome-card">
            <img className="welcome-art" src={keyArt} alt="" width={160} height={160} />
            <h1>Masuk ke akunmu</h1>
            <p className="app-note" style={{ margin: 0, textAlign: 'center' }}>
              Ketik kode pemulihan yang kamu simpan dari perangkat lama. Semua bill
              dan bagianmu langsung ikut ke sini.
            </p>
            <div style={{ width: '100%', marginTop: 6 }}>
              <Field
                id="restore-code"
                label="Kode pemulihan"
                value={code}
                onChange={(next) => {
                  setCode(next)
                  setError('')
                }}
                hint="Contoh: KOPI-7X2M-QW"
                error={error || undefined}
              />
            </div>
            <Button block loading={busy} disabled={!code.trim()} onClick={submit}>
              Masuk
            </Button>
            <button
              type="button"
              className="link-quiet"
              onClick={() => navigate({ to: '/' })}
            >
              Belum punya kode — mulai sebagai orang baru
            </button>
            <span className="app-note" style={{ fontSize: 11.5 }}>
              Kode ini tidak bisa ditebak dan tidak bisa dipakai dua orang. Kalau
              hilang, minta kode baru dari perangkat yang masih login.
            </span>
          </section>
        </main>
      </div>
    </div>
  )
}
