import { useEffect, useRef, useState } from 'react'

/**
 * Angka besar yang naik dari nilai lama ke nilai baru.
 *
 * Kenapa bukan animasi CSS: yang berubah di sini teks, bukan posisi. `@property`
 * dan animasi angka hanya jalan di peramban baru, dan angka uang yang berhenti
 * di tengah animasi karena tab ditutup adalah angka yang salah.
 *
 * Titik awal diambil dari **nilai yang sedang tampil** (`tampilRef`), bukan dari
 * nilai render sebelumnya. Di React StrictMode efek dijalankan dua kali: dengan
 * cara "render sebelumnya", jalan pertama sudah mencatat nilai akhir, lalu jalan
 * kedua menyimpulkan "tidak ada yang berubah" dan angkanya melompat — animasinya
 * hilang tanpa pesan. Dengan membaca yang benar-benar tampil, jalan kedua
 * melanjutkan dari tempat jalan pertama berhenti.
 *
 * Tiga penjaga:
 *
 * - **Angka panjang tidak dinaikkan.** Setiap langkah mengubah lebar teks, dan
 *   di nominal 10 digit itu memicu perubahan ukuran font (is-long / is-xl) di
 *   tengah jalan — angka besar melompat ukuran sambil berdetak.
 * - **Tidak diulang kalau nilainya sama.** Layar bill menyegarkan diri tiap 12
 *   detik; tanpa ini angkanya berdetak dari 0 setiap putaran.
 * - **Gerak dikurangi berarti langsung nilai akhir.**
 */
export function useAngkaNaik(nilai: number, aktif = true) {
  const [tampil, setTampil] = useState(0)
  const tampilRef = useRef(0)

  const pasang = (baru: number) => {
    tampilRef.current = baru
    setTampil(baru)
  }

  useEffect(() => {
    const asal = tampilRef.current
    if (!aktif || asal === nilai) {
      pasang(nilai)
      return
    }
    const kurangiGerak = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const panjang = Math.abs(nilai).toLocaleString('id-ID').length
    if (kurangiGerak || panjang > 8) {
      pasang(nilai)
      return
    }

    let raf = 0
    const mulai = performance.now()
    const durasi = asal === 0 ? 460 : 320
    const langkah = (sekarang: number) => {
      const p = Math.min(1, (sekarang - mulai) / durasi)
      const halus = 1 - Math.pow(1 - p, 3)
      pasang(Math.round(asal + (nilai - asal) * halus))
      if (p < 1) raf = requestAnimationFrame(langkah)
    }
    raf = requestAnimationFrame(langkah)
    return () => cancelAnimationFrame(raf)
  }, [nilai, aktif])

  return tampil
}
