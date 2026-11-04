import { useEffect, useRef } from 'react'
import stampFrames from '../assets/anim/stamp-paid.webp'
import { buzz } from '../lib/haptics'
import { SpriteFrames } from './SpriteFrames'

/**
 * Momen besar dalam satu bill: lunas dan ditutup.
 *
 * Frame-framenya hasil generate, bukan satu gambar yang digeser. Yang harus
 * benar supaya terbaca mulus:
 *
 * 1. Jarak langkah `background-position` tepat `lebar kotak x jumlah frame`.
 *    Memakai persentase membuat tiap langkah jatuh di antara dua sel dan yang
 *    tampil potongan frame sebelah.
 * 2. Untuk stempel, turunnya diatur `translateY` ber-steps, bukan digambar di
 *    frame — kalau posisi ikut digambar, tiap frame mendarat di titik berbeda
 *    dan capnya terlihat melayang. Untuk struk yang dilipat, `turun` = 0
 *    karena bendanya memang diam di tempat.
 *
 * Keyframe dipisah per jumlah frame (`.is-8`), bukan lewat variabel CSS di
 * dalam keyframe: substitusi `var()` di keyframe masih bermasalah di WebKit,
 * dan pengguna kita ada yang memakai Safari.
 */
const WARNA_KONFETI = ['#087665', '#C98A2E', '#142F3A', '#E2F5EF']

export function Moment({
  open,
  onDone,
  sprite = stampFrames,
  frame = 6,
  durasi = 640,
  turun = 0,
  tinggi = 130,
  latar = false,
  judul,
  keterangan,
  konfeti = false,
  cincin = false,
}: {
  open: boolean
  onDone: () => void
  sprite?: string
  /** Jumlah sel di sprite. Menentukan `background-size` dan keyframe mana yang dipakai. */
  frame?: number
  /** Lama satu putaran frame, milidetik. */
  durasi?: number
  /** Jarak jatuh dalam px sebelum mendarat; 0 kalau bendanya diam di tempat
   *  (struk terlipat tidak jatuh, cuma berubah bentuk). */
  turun?: number
  /** Tinggi kotak art, px. Sprite perlu dirinya sendiri kalau rasionya lain. */
  tinggi?: number
  /** Beri alas mint di kotak art. Kertas krem di atas kartu putih nyaris tak
   *  bertepi; tanpa alas, bentuknya terbaca sebagai bayangan, bukan benda. */
  latar?: boolean
  judul: string
  keterangan?: string
  konfeti?: boolean
  cincin?: boolean
}) {
  const kanvasRef = useRef<HTMLCanvasElement | null>(null)
  const selesaiRef = useRef(onDone)
  selesaiRef.current = onDone

  useEffect(() => {
    if (!open) return
    const kurangiGerak = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (kurangiGerak) {
      const t = window.setTimeout(() => selesaiRef.current(), 1100)
      return () => window.clearTimeout(t)
    }

    buzz(18)
    const kanvas = kanvasRef.current
    const ctx = kanvas?.getContext('2d') ?? null
    let raf = 0
    let mulai = 0
    let bubar = 0
    const partikel = Array.from({ length: 84 }, () => {
      const sudut = -Math.PI * 0.85 + Math.random() * Math.PI * 0.7
      const laju = 240 + Math.random() * 320
      return {
        vx: Math.cos(sudut) * laju,
        vy: Math.sin(sudut) * laju,
        putar: Math.random() * Math.PI,
        putaran: (Math.random() - 0.5) * 12,
        lebar: 3 + Math.random() * 4,
        tinggi: 6 + Math.random() * 7,
        warna: WARNA_KONFETI[Math.floor(Math.random() * WARNA_KONFETI.length)],
      }
    })

    /** Konfeti mulai saat bendanya mendarat, bukan saat kartu muncul. */
    const mulaiKonfeti = () => {
      if (!kanvas || !ctx) return
      const dpr = Math.min(3, window.devicePixelRatio || 1)
      const lebar = kanvas.clientWidth
      const tinggi = kanvas.clientHeight
      kanvas.width = Math.round(lebar * dpr)
      kanvas.height = Math.round(tinggi * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      mulai = performance.now()
      const titikX = lebar / 2
      const titikY = tinggi / 2 + 40

      const gambar = (sekarang: number) => {
        if (!mulai) mulai = sekarang
        const t = (sekarang - mulai) / 1000
        ctx.clearRect(0, 0, lebar, tinggi)
        for (const p of partikel) {
          const x = titikX + p.vx * t
          const y = titikY + p.vy * t + 450 * t * t
          const alfa = Math.max(0, 1 - t / 1.15)
          if (alfa <= 0) continue
          ctx.save()
          ctx.translate(x, y)
          ctx.rotate(p.putar + p.putaran * t)
          ctx.globalAlpha = alfa
          ctx.fillStyle = p.warna
          ctx.fillRect(-p.lebar / 2, -p.tinggi / 2, p.lebar, p.tinggi)
          ctx.restore()
        }
        if (t < 1.2) raf = requestAnimationFrame(gambar)
        else ctx.clearRect(0, 0, lebar, tinggi)
      }
      raf = requestAnimationFrame(gambar)
    }

    if (konfeti) bubar = window.setTimeout(mulaiKonfeti, 360)
    const tutup = window.setTimeout(() => selesaiRef.current(), durasi + 1150)
    return () => {
      window.clearTimeout(bubar)
      window.clearTimeout(tutup)
      cancelAnimationFrame(raf)
    }
  }, [open, durasi, konfeti])

  if (!open) return null

  return (
    <div className="ds-celebrate" role="status" aria-live="polite">
      <div className="ds-celebrate-scrim" aria-hidden="true" />
      {konfeti ? <canvas ref={kanvasRef} className="ds-celebrate-confetti" aria-hidden="true" /> : null}
      <div className="ds-celebrate-card">
        <div
          className={'ds-celebrate-art' + (latar ? ' is-latar' : '')}
          style={{ height: tinggi }}
          aria-hidden="true"
        >
          <div
            className={'ds-celebrate-stamp' + (turun > 0 ? ' is-jatuh' : '')}
            style={{ animationDuration: `${durasi}ms` }}
          >
            <SpriteFrames src={sprite} frame={frame} durasi={durasi} className="ds-celebrate-sel" />
          </div>
          {cincin ? <span className="ds-celebrate-ring" /> : null}
        </div>
        <b className="ds-celebrate-title">{judul}</b>
        {keterangan ? <span className="ds-celebrate-note">{keterangan}</span> : null}
      </div>
    </div>
  )
}

/** Perayaan lunas: stempel turun, cincin tinta, konfeti. */
export function PaidCelebration({
  open,
  onDone,
  keterangan,
}: {
  open: boolean
  onDone: () => void
  keterangan?: string
}) {
  return (
    <Moment
      open={open}
      onDone={onDone}
      judul="Lunas!"
      keterangan={keterangan}
      sprite={stampFrames}
      frame={20}
      durasi={640}
      turun={58}
      konfeti
      cincin
    />
  )
}
