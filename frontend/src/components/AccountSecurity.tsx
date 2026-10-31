import { useEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useToast } from './Toast'
import { Alert, Button, Field, SectionHead, Sheet } from '../ds/primitives'
import { endpoints } from '../lib/api'
import { googleAllowed, googleConfig, mountGoogleButton, showStubButton } from '../lib/google'
import { logoutDevice } from '../lib/identity'
import { signOut } from '../lib/session'
import type { Identity } from '../lib/types'

type SheetKind = 'username' | 'password' | 'google' | null

/**
 * Bagian akun di Pengaturan: username, password, Google, dan perangkat.
 *
 * Dipisah dari Settings.tsx karena file itu sudah mengurus nama, rekening, kode
 * pemulihan, dan undangan; menambah empat alur lagi di dalamnya membuat satu file
 * menanggung dua pekerjaan yang tidak berhubungan.
 *
 * Aturan tampilan yang dipegang: setiap baris menjawab "keadaannya sekarang apa"
 * lebih dulu (mis. "Belum ada"), baru menawarkan aksi. Baris yang keadaannya
 * sudah benar tidak menampilkan tombol yang tidak ada gunanya.
 */
export function AccountSecurity({ identity }: { identity: Identity | null }) {
  const toast = useToast()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [sheet, setSheet] = useState<SheetKind>(null)
  const [username, setUsername] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [repeatPassword, setRepeatPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [googleConfigState, setGoogleConfigState] = useState<{ client_id: string | null; stub: boolean } | null>(null)
  const googleSlot = useRef<HTMLDivElement | null>(null)

  const state = useQuery({
    queryKey: ['auth-state', identity?.id ?? ''],
    queryFn: () => endpoints.authState(),
    enabled: Boolean(identity?.id),
  })

  const data = state.data

  useEffect(() => {
    googleConfig()
      .then((config) => setGoogleConfigState(config))
      .catch(() => setGoogleConfigState({ client_id: null, stub: false }))
  }, [])

  /* Tautkan Google: tombol resmi dipasang hanya saat sheet-nya terbuka, supaya
     tidak ada iframe Google yang menunggu di DOM sepanjang sesi. */
  useEffect(() => {
    if (sheet !== 'google' || !googleSlot.current) return
    let cleanup = () => {}
    let alive = true
    googleConfig()
      .then(async (config) => {
        // origin yang belum terdaftar di OAuth client akan ditolak Google
        const clientId = config.client_id
        if (!alive || !clientId || !googleAllowed(config) || !googleSlot.current) return
        cleanup = await mountGoogleButton(
          googleSlot.current,
          clientId,
          async (token) => {
            setBusy(true)
            setError('')
            try {
              await endpoints.googleLink(token)
              await state.refetch()
              toast('Akun Google tertaut')
              setSheet(null)
            } catch (err) {
              setError((err as Error).message)
            } finally {
              setBusy(false)
            }
          },
          (message) => setError(message),
        )
      })
      .catch(() => setError('Google gagal dimuat di perangkat ini'))
    return () => {
      alive = false
      cleanup()
    }
  }, [sheet])

  async function saveUsername() {
    setBusy(true)
    setError('')
    try {
      await endpoints.setUsername(username.trim())
      await state.refetch()
      toast('Username disimpan')
      setSheet(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function savePassword() {
    if (newPassword !== repeatPassword) {
      setError('Ulangi password-nya belum sama')
      return
    }
    setBusy(true)
    setError('')
    try {
      await endpoints.setPassword(
        data?.has_password
          ? { current_password: currentPassword, new_password: newPassword }
          : { new_password: newPassword },
      )
      await state.refetch()
      toast('Password disimpan')
      setSheet(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function unlinkGoogle() {
    setBusy(true)
    try {
      await endpoints.googleUnlink()
      await state.refetch()
      toast('Google dilepas')
    } catch (err) {
      toast((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function revoke(deviceId: string) {
    try {
      await endpoints.revokeDevice(deviceId)
      await state.refetch()
      toast('Perangkat dikeluarkan')
    } catch (err) {
      toast((err as Error).message)
    }
  }

  async function keluar() {
    await logoutDevice()
    signOut()
    await queryClient.clear()
    toast('Kamu sudah keluar')
    await navigate({ to: '/' })
  }

  const usernameLabel = data?.username ? '@' + data.username : 'Belum ada'
  const googleLabel = data?.google.linked
    ? 'Tertaut' + (data.google.email ? ' · ' + data.google.email : '')
    : 'Belum tertaut'

  return (
    <>
      <section className="app-stack">
        <SectionHead>Akun</SectionHead>
        <p className="app-note">
          Akun dipakai untuk masuk dari perangkat lain. Tanpa akun pun kamu tetap
          bisa bikin dan ikut bill — kode pemulihan sudah cukup untuk pindah HP.
        </p>

        <div className="ds-card ds-card-surface ds-pad-sm">
          <button type="button" className="app-row is-tappable" onClick={() => { setUsername(data?.username ?? ''); setError(''); setSheet('username') }}>
            <span className="grow">
              <b>Username</b>
              <small>{usernameLabel}</small>
            </span>
            <span className="row-chevron" aria-hidden="true">›</span>
          </button>
          <button type="button" className="app-row is-tappable" onClick={() => { setCurrentPassword(''); setNewPassword(''); setRepeatPassword(''); setError(''); setSheet('password') }}>
            <span className="grow">
              <b>Password</b>
              <small>{data?.has_password ? 'Sudah dibuat' : 'Belum ada'}</small>
            </span>
            <span className="row-chevron" aria-hidden="true">›</span>
          </button>
          <button
            type="button"
            className="app-row is-tappable"
            onClick={() => {
              setError('')
              setSheet('google')
            }}
            disabled={googleConfigState !== null && !googleConfigState.client_id && !googleConfigState.stub}
          >
            <span className="grow">
              <b>Google</b>
              <small>
                {googleConfigState !== null && !googleConfigState.client_id && !googleConfigState.stub
                  ? 'Belum dikonfigurasi di server'
                  : googleLabel}
              </small>
            </span>
            <span className="row-chevron" aria-hidden="true">›</span>
          </button>
        </div>
      </section>

      {/* Kontak dipisah dari Akun: ini bukan kredensial masuk, dan baris
          berisi instruksi panjang di tengah daftar status membuat daftar itu
          berhenti bisa dipindai. */}
      <section className="app-stack">
        <SectionHead>Kontak</SectionHead>
        <div className="ds-card ds-card-surface ds-pad-sm">
          <button type="button" className="app-row is-tappable" onClick={() => navigate({ to: '/kontak' })}>
            <span className="grow">
              <b>Nama untuk kontak</b>
              <small>Beri nama pembeda supaya tidak salah orang</small>
            </span>
            <span className="row-chevron" aria-hidden="true">›</span>
          </button>
        </div>
      </section>

      {data && data.devices.length > 0 ? (
        <section className="app-stack">
          <SectionHead meta={<>{data.devices.length}</>}>Perangkat yang masuk</SectionHead>
          <div className="ds-card ds-card-surface ds-pad-sm">
            {data.devices.map((device) => (
              <div className="app-row" key={device.id}>
                <span className="grow">
                  <b>{device.label}</b>
                  <small>
                    {device.current ? 'Ini perangkat ini' : 'Terakhir aktif ' + (device.last_seen_at ?? '—')}
                  </small>
                </span>
                {device.current ? (
                  <span className="ds-badge ds-badge--success">Aktif</span>
                ) : (
                  <button type="button" className="link-action is-danger" onClick={() => void revoke(device.id)}>
                    Keluarkan
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="app-stack">
        <Button variant="secondary" block onClick={() => void keluar()}>
          Keluar dari akun ini
        </Button>
        <span className="app-note">
          Keluar hanya memutus perangkat ini. Bill dan bagianmu tetap aman, dan bisa
          masuk lagi pakai kode pemulihan, username, atau Google.
        </span>
      </section>

      {/* ---------- sheet username ---------- */}
      <Sheet open={sheet === 'username'} title="Username" onClose={() => setSheet(null)}>
        <Field
          id="set-username"
          label="Username baru"
          value={username}
          onChange={(v) => {
            setUsername(v.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase())
            setError('')
          }}
          hint="3–20 huruf kecil, angka, atau _. Ini yang kamu sebut saat minta diundang."
          error={error || undefined}
          maxLength={20}
          autoComplete="username"
        />
        <Button
          block
          loading={busy}
          disabled={!username.trim() || username.trim() === (data?.username ?? '')}
          onClick={() => void saveUsername()}
        >
          Simpan username
        </Button>
      </Sheet>

      {/* ---------- sheet password ---------- */}
      <Sheet open={sheet === 'password'} title={data?.has_password ? 'Ganti password' : 'Buat password'} onClose={() => setSheet(null)}>
        {data?.has_password ? (
          <Field
            id="current-password"
            label="Password sekarang"
            type="password"
            value={currentPassword}
            onChange={(v) => {
              setCurrentPassword(v)
              setError('')
            }}
            autoComplete="current-password"
          />
        ) : (
          <Alert tone="info" title="Kenapa perlu password?">
            Dengan password kamu bisa masuk dari perangkat lain tanpa kode pemulihan.
            Kode pemulihan tetap berlaku sebagai cadangan.
          </Alert>
        )}
        <Field
          id="new-password"
          label="Password baru"
          type="password"
          value={newPassword}
          onChange={(v) => {
            setNewPassword(v)
            setError('')
          }}
          hint="Minimal 8 karakter"
          error={error || undefined}
          autoComplete="new-password"
        />
        <Field
          id="repeat-password"
          label="Ulangi password baru"
          type="password"
          value={repeatPassword}
          onChange={(v) => {
            setRepeatPassword(v)
            setError('')
          }}
          autoComplete="new-password"
        />
        <Button
          block
          loading={busy}
          disabled={!newPassword || !repeatPassword}
          onClick={() => void savePassword()}
        >
          Simpan password
        </Button>
        <span className="app-note">
          Setelah password disimpan, semua perangkat lain otomatis dikeluarkan.
        </span>
      </Sheet>

      {/* ---------- sheet google ---------- */}
      <Sheet open={sheet === 'google'} title="Akun Google" onClose={() => setSheet(null)}>
        {data?.google.linked ? (
          <>
            <Alert tone="success" title="Sudah tertaut">
              {data.google.email ?? 'Akun Google tertaut ke identitas ini.'} Kamu bisa
              masuk lewat tombol Google di layar masuk.
            </Alert>
            <Button variant="secondary" block loading={busy} onClick={() => void unlinkGoogle()}>
              Lepas akun Google
            </Button>
            <span className="app-note">
              Melepas Google tidak menghapus bill. Kamu tetap bisa masuk pakai kode
              pemulihan atau password.
            </span>
          </>
        ) : (
          <>
            <span className="app-note" style={{ margin: 0 }}>
              Setelah tertaut, kamu bisa masuk satu ketukan dari perangkat mana pun.
            </span>
            {error ? <Alert tone="danger" title="Google gagal">{error}</Alert> : null}
            <div className="google-slot" ref={googleSlot} data-testid="google-link-slot" />
            {googleConfigState && showStubButton(googleConfigState) ? (
              <Button
                variant="secondary"
                block
                loading={busy}
                onClick={async () => {
                  setBusy(true)
                  setError('')
                  try {
                    const stamp = Date.now().toString(36)
                    await endpoints.googleLink(`stub:taut-${stamp}:taut-${stamp}@example.com:Taut Google`)
                    await state.refetch()
                    toast('Akun Google tertaut (mode uji)')
                    setSheet(null)
                  } catch (err) {
                    setError((err as Error).message)
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                Tautkan Google (mode uji)
              </Button>
            ) : null}
            <span className="app-note">
              Kalau akun Google ini sudah pernah dipakai masuk Bagiin, ia tertaut ke
              identitas yang berbeda dan tidak bisa digabung otomatis di sini.
            </span>
          </>
        )}
      </Sheet>
    </>
  )
}
