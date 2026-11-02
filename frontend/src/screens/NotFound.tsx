import { useNavigate } from '@tanstack/react-router'
import { AppShell } from '../components/AppShell'
import { Button, EmptyState } from '../ds/primitives'
import notFoundArt from '../assets/error.webp'

/**
 * Alamat yang tidak dikenal.
 *
 * Sebelum ini, TanStack menampilkan "Not Found" polos tanpa kerangka aplikasi:
 * tidak ada navigasi, tidak ada jalan pulang, dan hurufnya bukan huruf aplikasi.
 * Orang yang salah ketik link — atau membuka link lama yang bentuknya berubah —
 * berhenti di halaman yang terlihat seperti situs rusak.
 */
export function NotFound() {
  const navigate = useNavigate()
  // Nav tampil tanpa tab tersorot: halaman ini bukan Beranda, bukan Buat, bukan
  // Rekap — menyorot salah satunya cuma bikin orang mengira dia sedang di sana.
  return (
    <AppShell title="Halaman tidak ditemukan" subtitle="Alamat ini tidak mengarah ke layar mana pun" active="none">
      <EmptyState
        title="Alamatnya tidak bisa dibuka"
        art={<img className="ds-empty-art" src={notFoundArt} alt="" width={120} height={120} />}
        action={
          <Button block onClick={() => navigate({ to: '/' })}>
            Kembali ke beranda
          </Button>
        }
      >
        Mungkin salah ketik, atau link lama yang sudah tidak dipakai. Kalau ini tautan bill dari teman, minta
        kirim ulang yang paling baru.
      </EmptyState>
    </AppShell>
  )
}
