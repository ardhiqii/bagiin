import { useEffect, useRef } from 'react'

/**
 * Pemutar sprite frame-per-frame.
 *
 * Kenapa digerakkan `requestAnimationFrame` dan bukan `steps()` di CSS: jumlah
 * frame sekarang 20–24, dan keyframe CSS harus ditulis satu per satu untuk tiap
 * jumlah frame (`steps()` hanya bisa melompati jarak yang sama, bukan memilih sel
 * dari daftar). Pemutar ini menerima jumlah frame apa pun, menghitung sel dari
 * waktu nyata, dan tidak pernah menulis layout — hanya `background-position`.
 *
 * Yang dijaga:
 * - **Sel dihitung dari waktu, bukan dari hitungan frame layar.** Di layar 120 Hz,
 *   animasi berbasis "satu frame per render" akan berjalan dua kali lebih cepat.
 * - **Frame terakhir selalu tercapai**, termasuk saat tab sempat tersendat.
 * - **Gerak dikurangi** = berhenti di frame pertama, dan **berhenti saat
 *   pengaturannya diubah di tengah jalan** — bukan hanya saat pertama dimuat.
 */
export function SpriteFrames({
  src,
  frame,
  durasi,
  loop = false,
  className,
  onSelesai,
}: {
  src: string
  frame: number
  /** Lama satu putaran penuh, milidetik. */
  durasi: number
  loop?: boolean
  className?: string
  onSelesai?: () => void
}) {
  const ref = useRef<HTMLSpanElement | null>(null)
  const selesaiRef = useRef(onSelesai)
  selesaiRef.current = onSelesai

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const tanya = window.matchMedia('(prefers-reduced-motion: reduce)')
    let raf = 0

    const berhenti = () => {
      cancelAnimationFrame(raf)
      el.style.backgroundPosition = '0px 0px'
    }

    const mainkan = () => {
      cancelAnimationFrame(raf)
      if (tanya.matches) {
        el.style.backgroundPosition = '0px 0px'
        return
      }
      const mulai = performance.now()
      const langkah = (sekarang: number) => {
        const lebar = el.clientWidth || 1
        const t = (sekarang - mulai) / durasi
        // t bisa sedikit negatif di frame pertama (jam rAF < performance.now);
        // tanpa penjepit ini sel-nya jadi -1 dan yang tampil satu frame kosong.
        const p = Math.max(0, loop ? t % 1 : Math.min(1, t))
        const sel = Math.min(frame - 1, Math.floor(p * frame))
        el.style.backgroundPosition = `${-sel * lebar}px 0px`
        if (p < 1 || loop) raf = requestAnimationFrame(langkah)
        else selesaiRef.current?.()
      }
      raf = requestAnimationFrame(langkah)
    }

    mainkan()
    tanya.addEventListener('change', mainkan)
    return () => {
      tanya.removeEventListener('change', mainkan)
      berhenti()
    }
  }, [src, frame, durasi, loop])

  return (
    <span
      ref={ref}
      className={className}
      aria-hidden="true"
      style={{
        backgroundImage: `url(${src})`,
        // Lebar gambar = jumlah sel x lebar kotak, jadi tiap sel jatuh tepat di
        // lebar kotak. Dengan persentase, langkahnya jatuh di antara dua sel.
        backgroundSize: `${frame * 100}% 100%`,
        backgroundRepeat: 'no-repeat',
        backgroundPosition: '0px 0px',
      }}
    />
  )
}
