import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { endpoints } from '../lib/api'
import { Button } from '../ds/primitives'

const DISMISS_KEY = 'bagiin_secure_nudge_dismissed'

/**
 * Pengingat untuk identitas "tamu" — yang belum punya username, password, maupun
 * Google — bahwa bill-nya cuma hidup di perangkat ini.
 *
 * Kenapa ada: identitas tamu cuma diikat ke satu token di localStorage. Ponsel
 * hilang, browser dibersihkan, atau orang pindah HP, dan seluruh riwayat bill-nya
 * ikut hilang tanpa satu pun peringatan. Pemulihan lewat kode masih mungkin, tapi
 * kode itu juga tersimpan di perangkat yang sama.
 *
 * Aturan supaya tidak jadi iklan yang mengganggu:
 * - hanya muncul kalau memang TIDAK ada satu pun cara masuk lain (bukan sekadar
 *   "belum lengkap");
 * - sekali ditutup, tidak muncul lagi di perangkat ini (`DISMISS_KEY`);
 * - satu kalimat alasan + satu tombol, tanpa ilustrasi, tanpa blok besar.
 */
export function SecureNudge({
  identityId,
  hasBills,
}: {
  identityId: string
  /** Pengingat hanya berarti kalau sudah ada bill yang bisa hilang. */
  hasBills: boolean
}) {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === '1'
    } catch {
      return false
    }
  })
  const navigate = useNavigate()

  const state = useQuery({
    queryKey: ['auth-state', identityId],
    queryFn: () => endpoints.authState(),
    enabled: !dismissed,
  })

  if (dismissed || !hasBills) return null
  const data = state.data
  if (!data) return null

  // Ada satu saja cara masuk lain? Tidak perlu mengingatkan apa pun.
  if (data.username || data.has_password || data.google?.linked) return null

  return (
    <section className="nudge-card" aria-label="Amankan akun">
      <div className="nudge-copy">
        <b>Bill ini cuma ada di perangkat ini</b>
        <small>
          Kalau HP hilang atau browser dibersihkan, bill-nya ikut hilang. Pasang
          username atau Google supaya bisa dibuka dari HP lain.
        </small>
      </div>
      <div className="nudge-actions">
        {/* Sekunder, bukan primer: di layar ini aksi utama tetap "Buat bill".
            Dua tombol hijau sebesar itu berdampingan bikin orang ragu mana yang
            harus ditekan lebih dulu. */}
        <Button compact variant="secondary" onClick={() => navigate({ to: '/settings' })}>
          Amankan
        </Button>
        <button
          type="button"
          className="link-quiet"
          onClick={() => {
            try {
              localStorage.setItem(DISMISS_KEY, '1')
            } catch {
              /* mode privat: cukup sembunyikan untuk sesi ini */
            }
            setDismissed(true)
          }}
        >
          Nanti
        </button>
      </div>
    </section>
  )
}
