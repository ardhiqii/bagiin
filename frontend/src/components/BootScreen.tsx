import { Skeleton, SkeletonList } from '../ds/primitives'

/**
 * Layar tunggu saat sesi masih divalidasi ke server.
 *
 * Dulu layarnya cuma satu kalimat di tengah layar kosong ("Menyiapkan Bagiin…"),
 * lalu berganti ke kerangka isi begitu data datang: dua bentuk berbeda untuk satu
 * keadaan yang sama, dan yang kedua terasa seperti memuat dua kali. Sekarang
 * layar ini langsung memakai kerangka yang sama dengan beranda, jadi tidak ada
 * teks yang muncul lalu hilang.
 */
export function BootScreen() {
  return (
    <div className="app-shell">
      <div className="app-frame">
        <main className="app-body">
          <span className="ds-skel-sr" role="status" aria-live="polite">
            Menyiapkan Bagiin…
          </span>
          <div className="ds-skel-card" aria-hidden="true">
            <Skeleton width={104} height={10} />
            <Skeleton width="58%" height={30} radius={12} />
            <Skeleton width={168} height={12} />
          </div>
          <SkeletonList rows={4} avatar={false} label="Menyiapkan Bagiin" />
        </main>
      </div>
    </div>
  )
}
