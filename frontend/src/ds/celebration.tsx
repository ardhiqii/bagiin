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
  const kertasDepanRef = useRef<HTMLCanvasElement | null>(null)
  const kertasBelakangRef = useRef<HTMLCanvasElement | null>(null)
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

    /* Dua lapis kertas, bukan satu: satu di belakang kartu dan satu di depan.
       Satu lapis saja selalu salah di satu sisi — di belakang kartu, kertasnya
       "tenggelam" di balik modal dan perayaannya terasa jauh; di depan semua, ia
       menutupi tulisan. Dua lapis memberi kedalaman sekaligus tidak menutupi
       apa pun: yang depan lebih besar dan lebih sedikit jumlahnya. */
    type Lapisan = {
      ctx: CanvasRenderingContext2D
      lebar: number
      tinggi: number
      alfa: number
      partikel: {
        vx: number
        vy: number
        putar: number
        putaran: number
        lebar: number
        tinggi: number
        fase: number
        goyang: number
        tunda: number
        umur: number
        warna: string
      }[]
    }

    const siapkan = (el: HTMLCanvasElement | null, jumlah: number, skala: number, alfa: number): Lapisan | null => {
      const ctx = el?.getContext('2d')
      if (!el || !ctx) return null
      const dpr = Math.min(3, window.devicePixelRatio || 1)
      const lebar = el.clientWidth
      const tinggi = el.clientHeight
      el.width = Math.round(lebar * dpr)
      el.height = Math.round(tinggi * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const partikel = Array.from({ length: jumlah }, () => {
        const sudut = -Math.PI * 0.9 + Math.random() * Math.PI * 0.8
        const laju = 210 + Math.random() * 380
        // Sebagian besar keluar sekaligus; sisanya menyusul sampai ~0,7 detik
        // kemudian, jadi perayaannya bergelombang alih-alih satu ledakan yang
        // langsung habis.
        const tunda = Math.random() < 0.62 ? Math.random() * 0.08 : 0.12 + Math.random() * 0.58
        const panjang = Math.random() < 0.22
        return {
          vx: Math.cos(sudut) * laju,
          vy: Math.sin(sudut) * laju,
          putar: Math.random() * Math.PI * 2,
          putaran: (Math.random() - 0.5) * 10,
          lebar: (4 + Math.random() * 5) * skala,
          // Sesekali potongan panjang seperti pita, bukan serpihan kecil.
          tinggi: (panjang ? 16 + Math.random() * 12 : 7 + Math.random() * 9) * skala,
          fase: Math.random() * Math.PI * 2,
          goyang: 12 + Math.random() * 24,
          tunda,
          umur: 2.1 + Math.random() * 0.5,
          warna: WARNA_KONFETI[Math.floor(Math.random() * WARNA_KONFETI.length)],
        }
      })
      return { ctx, lebar, tinggi, alfa, partikel }
    }

    const lapisan = [
      siapkan(kertasBelakangRef.current, 42, 0.75, 0.6),
      siapkan(kertasDepanRef.current, 58, 1.05, 1),
    ].filter((l): l is Lapisan => l !== null)

    let raf = 0
    let mulai = 0
    let bubar = 0

    const gambar = (sekarang: number) => {
      if (!mulai) mulai = sekarang
      const t = (sekarang - mulai) / 1000
      for (const l of lapisan) {
        l.ctx.clearRect(0, 0, l.lebar, l.tinggi)
        const tengahX = l.lebar / 2
        const tengahY = l.tinggi / 2 + 40
        for (const p of l.partikel) {
          const tp = t - p.tunda
          if (tp < 0) continue
          // Goyang sinus + gravitasi: kertas ringan melayang, bukan menembak
          // lurus seperti percikan.
          const x = tengahX + p.vx * tp + Math.sin(tp * 6.5 + p.fase) * p.goyang
          const y = tengahY + p.vy * tp + 470 * tp * tp
          // Memudar pelan lalu hilang: 2,1-2,6 detik, bukan 1,9 detik yang
          // membuat perayaan terasa berhenti di tengah.
          const alfa = Math.max(0, 1 - tp / p.umur)
          if (alfa <= 0) continue
          // Lebar menyusut-membesar seperti kertas yang berputar di udara.
          const lipat = 0.28 + 0.72 * Math.abs(Math.cos(p.putaran * 1.6 * tp + p.fase))
          l.ctx.save()
          l.ctx.translate(x, y)
          l.ctx.rotate(p.putar + p.putaran * tp)
          l.ctx.globalAlpha = alfa * l.alfa
          l.ctx.fillStyle = p.warna
          l.ctx.fillRect(-(p.lebar * lipat) / 2, -p.tinggi / 2, p.lebar * lipat, p.tinggi)
          l.ctx.restore()
        }
      }
      if (t < 2.9) raf = requestAnimationFrame(gambar)
      else for (const l of lapisan) l.ctx.clearRect(0, 0, l.lebar, l.tinggi)
    }

    /* Kertas mulai sedikit sebelum bendanya mendarat, bukan sesudah: kalau
       menunggu stempel, ledakannya terasa seperti efek susulan. */
    if (konfeti) bubar = window.setTimeout(() => { raf = requestAnimationFrame(gambar) }, 240)
    const tutup = window.setTimeout(() => selesaiRef.current(), durasi + 2900)
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
      {konfeti ? (
        <>
          <canvas ref={kertasBelakangRef} className="ds-celebrate-kertas is-belakang" aria-hidden="true" />
          <canvas ref={kertasDepanRef} className="ds-celebrate-kertas is-depan" aria-hidden="true" />
        </>
      ) : null}
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
