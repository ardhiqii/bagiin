// Uang selalu integer rupiah. Tidak ada float, tidak ada parse sendiri.
export type Rupiah = number & { readonly __brand: 'Rupiah' }

export const rp = (n: number): Rupiah => Math.round(n) as Rupiah

const nf = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 })

/** Rp96.000 — dipakai di semua tempat, tanpa kecuali. */
export function formatRp(value: number): string {
  return 'Rp' + nf.format(Math.round(value))
}

/**
 * Kalimat di bawah angka saldo: dari mana angka itu datang.
 *
 * Beranda dan Rekap dulu menyusunnya sendiri-sendiri, dan hasilnya berbeda:
 * Beranda menampilkan NET (Rp208.000) sementara Rekap menampilkan satu arah
 * saja (Rp22.000) dengan catatan "kamu juga terima Rp230.000". Dua layar, dua
 * angka untuk uang yang sama — orangnya wajar bingung apakah dia menerima
 * Rp208.000 atau membayar Rp22.000. Sekarang keduanya memakai fungsi ini.
 *
 * "terima Rp230.000 − bayar Rp22.000" dipilih karena orang bisa memeriksa
 * pengurangannya sendiri; kata "masuk/keluar" tidak sejelas tanda minus di sini.
 */
export function saldoNote(receivable: number, payable: number): string {
  const terima = Math.round(receivable)
  const bayar = Math.round(payable)
  // Dua arah sekaligus = satu-satunya keadaan yang perlu dijelaskan, karena
  // angka besarnya NET dan tidak sama dengan salah satu komponennya.
  if (terima > 0 && bayar > 0) return 'terima ' + formatRp(terima) + ' − bayar ' + formatRp(bayar)
  return ''
}

/** 96.000 — untuk input yang sudah punya prefix Rp. */
export function formatDigits(value: number): string {
  return nf.format(Math.round(value))
}

/** Baca ketikan user: "96.000", "96000", "Rp 96.000" -> 96000. Tidak pernah float. */
export function parseRupiah(input: string): number {
  const digits = input.replace(/[^0-9]/g, '')
  if (!digits) return 0
  return Number.parseInt(digits, 10)
}

export function splitEven(total: number, parts: number): number[] {
  if (parts <= 0) return []
  const base = Math.floor(total / parts)
  const rest = total - base * parts
  return Array.from({ length: parts }, (_, i) => base + (i < rest ? 1 : 0))
}
