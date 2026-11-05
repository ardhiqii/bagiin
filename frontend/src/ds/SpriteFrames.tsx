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
  tunda = 0,
  jadwal,
  className,
  onSelesai,
}: {
  src: string
  frame: number
  /** Lama satu putaran penuh, milidetik. */
  durasi: number
  loop?: boolean
  /** Tunggu sekian ms sebelum mulai. Dipakai untuk tinta: cetakannya baru muncul
   *  setelah capnya mendarat, bukan bersamaan dengan capnya turun. */
  tunda?: number
  /** Jadwal sel manual: `[mulaiMs, sel]`, urut naik. Dipakai kalau tiap babak
   *  animasi butuh lama berbeda — membagi rata 6 sel di 900 ms menaruh frame
   *  mampat di waktu yang salah, dan justru itu yang menghapus rasa hentakan. */
  jadwal?: [number, number][]
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
        let sel: number
        if (jadwal && jadwal.length) {
          const ms = Math.max(0, sekarang - mulai)
          sel = jadwal[0][1]
          for (const [mulaiSel, s] of jadwal) if (ms >= mulaiSel) sel = s
          sel = Math.min(frame - 1, sel)
        } else {
          sel = Math.min(frame - 1, Math.floor(p * frame))
        }
        el.style.backgroundPosition = `${-sel * lebar}px 0px`
        if (p < 1 || loop) raf = requestAnimationFrame(langkah)
        else selesaiRef.current?.()
      }
      raf = requestAnimationFrame(langkah)
    }

    const tunggu = tunda > 0 ? window.setTimeout(mainkan, tunda) : 0
    if (tunda <= 0) mainkan()
    tanya.addEventListener('change', mainkan)
    return () => {
      window.clearTimeout(tunggu)
      tanya.removeEventListener('change', mainkan)
      berhenti()
    }
  }, [src, frame, durasi, loop, tunda, jadwal])

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
