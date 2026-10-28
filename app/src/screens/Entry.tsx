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
  startIdentity,
} from '../lib/identity'
import { googleConfig, mountGoogleButton, showStubButton } from '../lib/google'
import { markAuthed, takeIntent } from '../lib/session'
import keyArt from '../assets/welcome.webp'

type Tab = 'nama' | 'kode' | 'akun'
type AkunStep = 'masuk' | 'daftar'

/**
 * Satu layar untuk SEMUA cara mulai memakai Bagiin: isi nama (tanpa akun),
 * kode pemulihan, username+password, dan Google.
 *
 * Kenapa digabung, bukan dua halaman terpisah:
 * - Orang yang datang dari link bill harus bisa langsung isi nama, tapi dia juga
 *   berhak tahu ada jalan lain. Dulu layar pertama hanya menampilkan kolom nama,
 *   jadi Google dan kode pemulihan praktis tidak pernah ditemukan.
 * - Orang yang salah ingat cara masuknya bisa pindah tab tanpa kehilangan yang
 *   sudah diketik, tanpa pindah halaman, tanpa tombol "kembali".
 *
 * Hierarki di dalam kartu, dari atas: pilihan cara (tab) → isian cara itu →
 * tombol utama → pemisah "atau" → Google → catatan kaki. Google sengaja di
 * bawah pemisah, bukan di atas: dia alternatif untuk yang sudah punya akun
 * Google, sedangkan mayoritas orang datang untuk ikut bill tanpa akun.
 *
 * Jalur "tanpa akun" adalah TAB, bukan tombol hijau. Tombol berwarna mint di
 * aplikasi ini berarti "berhasil/konfirmasi"; memakainya untuk berpindah cara
 * masuk membuat orang merasa baru saja menyetujui sesuatu.
 */
export function Entry({
  initialTab = 'nama',
  context,
  expired = false,
  onDone,
}: {
  initialTab?: Tab
  /** kalimat pengganti di bawah judul, mis. saat datang dari link bill */
  context?: string
  /** true kalau identitas di perangkat sudah tidak dikenal server */
  expired?: boolean
  onDone?: () => void | Promise<void>
}) {
  /* Kalau identitas di perangkat sudah basi, tab awalnya "Kode" — bukan "Nama".
     Mengetik nama baru di situ membuat profil kosong baru, dan bill lama orang
     itu tidak ikut. Kode pemulihan adalah satu-satunya jalan yang mengembalikan
     identitas lamanya, jadi itu yang dibuka lebih dulu. */
  const [tab, setTab] = useState<Tab>(expired ? 'kode' : initialTab)
  const [step, setStep] = useState<AkunStep>('masuk')
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
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

  /* Tidak ada autofokus di layar ini. Di ponsel, fokus otomatis berarti keyboard
     langsung naik dan menutupi tab "Kode"/"Akun" serta tombol Google — orang
     dipaksa masuk ke satu jalur sebelum sempat melihat ada jalur lain. Fokus
     hanya dipindahkan kalau orang sendiri yang membuka tab. */
  useEffect(() => {
    if (tab === 'kode') document.getElementById('entry-code')?.focus()
  }, [tab])

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

  /* Tombol resmi Google baru dipasang setelah konfigurasi datang. Kalau server
     belum punya client ID, tombol tidak dipasang sama sekali dan yang tampil
     kalimat penjelas — bukan tombol mati tanpa alasan. */
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
    await onDone?.()
    const intent = takeIntent()
    if (intent) {
      window.location.replace(intent)
      return
    }
    await navigate({ to: '/' })
  }

  async function submitName() {
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
      const intent = takeIntent()
      if (intent) window.location.replace(intent)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
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
        <div className="app-frame app-frame--plain">
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

  const tabs: { id: Tab; label: string }[] = [
    { id: 'nama', label: 'Nama' },
    { id: 'kode', label: 'Kode' },
    { id: 'akun', label: 'Akun' },
  ]

  return (
    <div className="app-shell">
      <div className="app-frame app-frame--plain">
        <main className="app-body welcome-body">
          <section className="welcome-card">
            <img className="welcome-art welcome-art--entry" src={keyArt} alt="" width={80} height={80} />
            <h1>Mulai atau masuk</h1>

            {expired ? (
              /* Tanpa tautan aksi: tab "Kode" di bawahnya sudah terbuka dan
                 tautan "pakai kode" tepat di atas tab "Kode" cuma membuat orang
                 bertanya mana yang harus diklik. */
              <Notice tone="pending">
                Identitas di perangkat ini sudah tidak ada di server. Masukkan kode
                pemulihanmu untuk kembali ke bill lama — isi nama baru akan membuat
                profil kosong.
              </Notice>
            ) : (
              <p className="app-note" style={{ margin: 0, textAlign: 'center' }}>
                {context ??
                  'Ikut bill, pilih porsi, catat siapa bayar siapa. Tanpa akun pun bisa.'}
              </p>
            )}

            <div className="auth-modes" role="tablist" aria-label="Cara mulai">
              {tabs.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === item.id}
                  className={'auth-mode' + (tab === item.id ? ' is-active' : '')}
                  onClick={() => {
                    setTab(item.id)
                    setError('')
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>

            {tab === 'nama' ? (
              <>
                <div style={{ width: '100%' }}>
                  <Field
                    id="entry-name"
                    label="Nama kamu"
                    value={name}
                    onChange={(next) => {
                      setName(next)
                      setError('')
                    }}
                    hint="Contoh: Aufa — nama ini yang muncul ke teman di bill"
                    error={error || undefined}
                    autoComplete="name"
                  />
                </div>
                <Button block loading={busy} disabled={!name.trim()} onClick={submitName}>
                  Mulai pakai Bagiin
                </Button>
                <span className="app-note" style={{ fontSize: 11.5 }}>
                  Tersimpan di perangkat ini saja, bisa diganti di Pengaturan.
                </span>
              </>
            ) : null}

            {tab === 'kode' ? (
              <>
                <p className="app-note" style={{ margin: 0, textAlign: 'center' }}>
                  Ketik kode yang kamu simpan dari perangkat lama. Semua bill dan
                  bagianmu langsung ikut ke sini.
                </p>
                <div style={{ width: '100%' }}>
                  <Field
                    id="entry-code"
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
            ) : null}

            {tab === 'akun' ? (
              <>
                <p className="app-note" style={{ margin: 0, textAlign: 'center' }}>
                  {step === 'masuk'
                    ? 'Masukkan username dan password akunmu.'
                    : 'Pilih username dan password. Kode pemulihan diberikan sekali di akhir.'}
                </p>
                {step === 'daftar' ? (
                  <div style={{ width: '100%' }}>
                    <Field
                      id="entry-akun-name"
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
                    id="entry-username"
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
                    id="entry-password"
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
                  <button type="button" className="link-quiet" onClick={() => setTab('kode')}>
                    Lupa password? Pakai kode pemulihan
                  </button>
                ) : null}
              </>
            ) : null}

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
                Login Google belum diaktifkan di server. Pakai nama, kode pemulihan,
                atau username — semuanya tetap jalan.
              </Notice>
            ) : null}
            <div
              className="google-slot"
              ref={googleSlot}
              hidden={!google?.client_id}
              data-testid="google-slot"
            />
            {/* Hanya di localhost. Sengaja tautan kecil, bukan tombol: tombol
                penuh di sini pernah jadi aksi paling menonjol di layar dan
                menenggelamkan tombol Google yang asli. */}
            {google && showStubButton(google) ? (
              <button type="button" className="link-quiet" onClick={withGoogleStub}>
                Google mode uji (tanpa akun Google)
              </button>
            ) : null}

          </section>
        </main>
      </div>
    </div>
  )
}
