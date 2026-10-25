// Uang selalu integer rupiah. Tidak ada float, tidak ada parse sendiri.
export type Rupiah = number & { readonly __brand: 'Rupiah' }

export const rp = (n: number): Rupiah => Math.round(n) as Rupiah

const nf = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 })

/** Rp96.000 — dipakai di semua tempat, tanpa kecuali. */
export function formatRp(value: number): string {
  return 'Rp' + nf.format(Math.round(value))
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
