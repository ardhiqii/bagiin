import { useEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useToast } from '../components/Toast'
import { Button, Field, Notice } from '../ds/primitives'
import {
  loginWithGoogle,
  loginWithPassword,
  registerAccount,
  restoreFromCode,
} from '../lib/identity'
import { googleConfig, mountGoogleButton } from '../lib/google'
import { markAuthed, takeIntent } from '../lib/session'
import keyArt from '../assets/welcome.webp'

type Mode = 'kode' | 'akun'
type AkunStep = 'masuk' | 'daftar'

/**
 * Satu layar, tiga cara masuk: kode pemulihan, username+password, Google.
 *
 * Kenapa digabung di satu layar: orang yang salah ingat cara masuknya harus bisa
 * pindah cara tanpa kehilangan apa yang sudah diketik. Dua tab (Kode / Akun)
 * untuk cara yang butuh isian, lalu satu tombol Google di bawahnya — Google
 * bukan "tab isi formulir", dia tombol; menaruhnya di segmented control membuat
 * orang mengira ada formulir yang harus diisi.
 *
 * Kode pemulihan tetap yang pertama dan paling sederhana: satu-satunya cara yang
 * tidak bergantung pada akun Google, email, atau hafalan password.
 */
export function Restore() {
  const [mode, setMode] = useState<Mode>('kode')
  const [step, setStep] = useState<AkunStep>('masuk')
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [revealed, setRevealed] = useState('')
  const [google, setGoogle] = useState<{ client_id: string | null; stub: boolean } | null>(null)
  const [googleError, setGoogleError] = useState('')
  const googleSlot = useRef<HTMLDivElement | null>(null)
  const toast = useToast()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  useEffect(() => {
    document.getElementById('restore-code')?.focus()
  }, [])

  useEffect(() => {
    let alive = true
    googleConfig()
      .then((config) => {
        if (alive) setGoogle(config)
      })
      .catch(() => {
        if (alive) setGoogle({ client_id: null, stub: false })
      })
    return () => {
      alive = false
    }
  }, [])

  /* Tombol resmi Google dipasang setelah konfigurasi datang. Kalau tidak ada
     client ID (server belum diisi), tombol tidak dipasang sama sekali dan yang
     tampil kalimat penjelas — bukan tombol mati tanpa alasan. */
  useEffect(() => {
    if (!google?.client_id || !googleSlot.current) return
    let cleanup = () => {}
    let alive = true
    mountGoogleButton(
      googleSlot.current,
      google.client_id,
      (token) => void withGoogle(token),
      (message) => setGoogleError(message),
    )
      .then((dispose) => {
        if (alive) cleanup = dispose
      })
      .catch(() => setGoogleError('Google gagal dimuat di perangkat ini'))
    return () => {
      alive = false
      cleanup()
    }
    // `withGoogle` hanya memakai setter yang stabil
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [google?.client_id])

  async function afterLogin(who: string) {
    markAuthed()
    await queryClient.invalidateQueries()
    toast('Masuk sebagai ' + who)
    const intent = takeIntent()
    if (intent) {
      window.location.replace(intent)
      return
    }
    await navigate({ to: '/' })
  }

  async function submitCode() {
    if (!code.trim()) {
      setError('Kode belum diisi')
      return
    }
    setBusy(true)
    setError('')
    try {
      const me = await restoreFromCode(code)
      await afterLogin(me.name)
    } catch (err) {
      const msg = (err as Error).message
      setError(
        /tidak dikenal/i.test(msg)
          ? 'Kode tidak dikenal. Periksa huruf dan angkanya, lalu coba lagi.'
          : msg,
      )
    } finally {
      setBusy(false)
    }
  }

  async function submitAkun() {
    setError('')
    setBusy(true)
    try {
      if (step === 'masuk') {
        const me = await loginWithPassword(username, password)
        await afterLogin(me.name)
      } else {
        const result = await registerAccount({ username, password, name })
        if (result.code) setRevealed(result.code)
        else await afterLogin(result.stored.name)
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function withGoogle(token: string) {
    setBusy(true)
    setGoogleError('')
    try {
      const result = await loginWithGoogle(token)
      // Akun Google yang baru pertama kali masuk dapat kode pemulihan. Kode itu
      // wajib kelihatan sekarang: kalau akses Google-nya hilang, ini satu-satunya
      // jalan kembali ke bill-bill yang sudah ada.
      if (result.code) setRevealed(result.code)
      else await afterLogin(result.stored.name)
    } catch (err) {
      setGoogleError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function withGoogleStub() {
    const stamp = Date.now().toString(36)
    await withGoogle(`stub:uji-${stamp}:uji-${stamp}@example.com:Uji Google`)
  }

  if (revealed) {
    return (
      <div className="app-shell">
        <div className="app-frame">
          <main className="app-body welcome-body">
            <section className="welcome-card">
              <h1>Simpan kode ini</h1>
              <p className="app-note" style={{ margin: 0, textAlign: 'center' }}>
                Ini kunci cadangan akunmu. Kalau suatu saat tidak bisa masuk lewat
                password atau Google, kode ini yang menyelamatkan bill-billmu.
              </p>
              <div className="recovery-code" aria-live="polite">
                <code>{revealed}</code>
                <button
                  type="button"
                  className="link-quiet"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(revealed)
                      toast('Kode disalin')
                    } catch {
                      toast('Salin manual: ' + revealed)
                    }
                  }}
                >
                  Salin
                </button>
              </div>
              <Notice tone="pending">
                Kode ini hanya muncul sekali. Catat sekarang — di Pengaturan bisa
                dibuat kode baru kapan saja.
              </Notice>
              <Button
                block
                onClick={async () => {
                  const me = await restoreFromCode(revealed)
                  await afterLogin(me.name)
                }}
              >
                Sudah kusimpan, lanjut
              </Button>
            </section>
          </main>
        </div>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <div className="app-frame">
        <main className="app-body welcome-body">
          <section className="welcome-card">
            {/* 96 px, bukan 160: di layar masuk, ruang vertikal di atas formulir
                adalah ruang yang harus digulir orang saat keyboard terbuka. */}
            <img className="welcome-art welcome-art--login" src={keyArt} alt="" width={96} height={96} />
            <h1>Masuk ke akunmu</h1>

            <div className="auth-modes" role="tablist" aria-label="Cara masuk">
              {(
                [
                  { id: 'kode' as const, label: 'Kode' },
                  { id: 'akun' as const, label: 'Akun' },
                ] satisfies { id: Mode; label: string }[]
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={mode === tab.id}
                  className={'auth-mode' + (mode === tab.id ? ' is-active' : '')}
                  onClick={() => {
                    setMode(tab.id)
                    setError('')
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {mode === 'kode' ? (
              <>
                <p className="app-note" style={{ margin: 0, textAlign: 'center' }}>
                  Ketik kode yang kamu simpan dari perangkat lama. Semua bill dan
                  bagianmu langsung ikut ke sini.
                </p>
                <div style={{ width: '100%', marginTop: 6 }}>
                  <Field
                    id="restore-code"
                    label="Kode pemulihan"
                    value={code}
                    onChange={(next) => {
                      setCode(next.toUpperCase())
                      setError('')
                    }}
                    hint="Contoh: KOPI-7X2M-QW"
                    error={error || undefined}
                    autoComplete="one-time-code"
                  />
                </div>
                <Button block loading={busy} disabled={!code.trim()} onClick={submitCode}>
                  Masuk
                </Button>
              </>
            ) : (
              <>
                <p className="app-note" style={{ margin: 0, textAlign: 'center' }}>
                  {step === 'masuk'
                    ? 'Masukkan username dan password akunmu.'
                    : 'Pilih username dan password. Kode pemulihan diberikan sekali di akhir.'}
                </p>
                {step === 'daftar' ? (
                  <div style={{ width: '100%' }}>
                    <Field
                      id="auth-name"
                      label="Nama kamu"
                      value={name}
                      onChange={(v) => {
                        setName(v)
                        setError('')
                      }}
                      hint="Nama ini yang muncul ke teman di bill"
                      autoComplete="name"
                    />
                  </div>
                ) : null}
                <div style={{ width: '100%' }}>
                  <Field
                    id="auth-username"
                    label="Username"
                    value={username}
                    onChange={(v) => {
                      setUsername(v.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase())
                      setError('')
                    }}
                    hint={step === 'daftar' ? '3–20 huruf kecil, angka, atau _' : undefined}
                    autoComplete="username"
                    maxLength={20}
                  />
                </div>
                <div style={{ width: '100%' }}>
                  <Field
                    id="auth-password"
                    label="Password"
                    type="password"
                    value={password}
                    onChange={(v) => {
                      setPassword(v)
                      setError('')
                    }}
                    hint={step === 'daftar' ? 'Minimal 8 karakter' : undefined}
                    error={error || undefined}
                    autoComplete={step === 'masuk' ? 'current-password' : 'new-password'}
                  />
                </div>
                <Button
                  block
                  loading={busy}
                  disabled={!username.trim() || !password || (step === 'daftar' && !name.trim())}
                  onClick={submitAkun}
                >
                  {step === 'masuk' ? 'Masuk' : 'Buat akun'}
                </Button>
                <button
                  type="button"
                  className="link-quiet"
                  onClick={() => {
                    setStep(step === 'masuk' ? 'daftar' : 'masuk')
                    setError('')
                  }}
                >
                  {step === 'masuk' ? 'Belum punya akun? Buat sekarang' : 'Sudah punya akun? Masuk'}
                </button>
                {step === 'masuk' ? (
                  <button type="button" className="link-quiet" onClick={() => setMode('kode')}>
                    Lupa password? Masuk pakai kode pemulihan
                  </button>
                ) : null}
              </>
            )}

            <div className="auth-divider" aria-hidden="true">
              <span>atau</span>
            </div>

            {googleError ? <Notice tone="danger">{googleError}</Notice> : null}
            {google === null ? (
              <div className="google-slot" aria-busy="true">
                <span className="app-note">Menyiapkan Google…</span>
              </div>
            ) : null}
            {google && !google.client_id && !google.stub ? (
              <Notice tone="pending">
                Login Google belum diaktifkan di server. Pakai kode pemulihan atau
                username — keduanya tetap jalan.
              </Notice>
            ) : null}
            <div
              className="google-slot"
              ref={googleSlot}
              hidden={!google?.client_id}
              data-testid="google-slot"
            />
            {google?.stub ? (
              <Button variant="secondary" block loading={busy} onClick={withGoogleStub}>
                Lanjut dengan Google (mode uji)
              </Button>
            ) : null}

            {/* Jalur tamu dipisah sebagai tombol, bukan tautan kecil di bawah
                tombol Google: ini jalan yang berbeda, bukan bagian dari Google. */}
            <Button variant="secondary" block onClick={() => navigate({ to: '/' })}>
              Ikut bill tanpa akun
            </Button>
            <span className="app-note" style={{ fontSize: 11.5 }}>
              Akun cuma dibutuhkan untuk masuk dari perangkat lain. Untuk ikut satu
              bill, isi nama saja sudah cukup.
            </span>
          </section>
        </main>
      </div>
    </div>
  )
}
