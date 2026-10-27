import gopay from '../assets/providers/gopay.webp'
import shopeepay from '../assets/providers/shopeepay.webp'
import bca from '../assets/providers/bca.webp'
import mandiri from '../assets/providers/mandiri.webp'
import jago from '../assets/providers/jago.webp'
import ovo from '../assets/providers/ovo.webp'
import dana from '../assets/providers/dana.webp'
import linkaja from '../assets/providers/linkaja.webp'
import seabank from '../assets/providers/seabank.webp'

/* Logo provider: nama brand di database adalah teks bebas, jadi pencocokan
   dilakukan pada bentuk yang dinormalkan (huruf kecil, tanpa spasi/tanda).
   Asetnya diambil dari sumber resmi:
   - GoPay: media kit resmi gopay.co.id (kit "New-Update-GoPay-Logo")
   - ShopeePay: shopeepay.co.id/logo/spp-logo.svg
   - BCA, Mandiri, OVO, LinkAja: Wikimedia Commons (artwork resmi)
   - Bank Jago: logo baru 11 Juni 2026
   - DANA, SeaBank: artwork resmi dari Commons
   Semua di-trim, dinormalkan ke sisi terpanjang 200 px, lalu WebP (total ~51 KB). */

export type ProviderKey = 'gopay' | 'shopeepay' | 'bca' | 'mandiri' | 'jago' | 'ovo' | 'dana' | 'linkaja' | 'seabank'

type Provider = { src: string; ar: number; h: number }

/* `h` = tinggi optik dalam px. Kotak tampilnya sama untuk semua (64x24);
   yang disesuaikan cuma tinggi gambarnya, karena rasio antar logo berbeda
   jauh: ShopeePay 5,2:1 (tipis dan lebar) versus LinkAja 1:1 (lambang padat).
   Tanpa penyesuaian ini, ShopeePay terbaca paling kecil dan GoPay paling
   berat meski kotaknya identik. */
export const PROVIDERS: Record<ProviderKey, Provider> = {
  gopay: { src: gopay, ar: 4.64, h: 13 },
  shopeepay: { src: shopeepay, ar: 5.19, h: 13.5 },
  bca: { src: bca, ar: 3.19, h: 15.5 },
  mandiri: { src: mandiri, ar: 3.42, h: 15 },
  jago: { src: jago, ar: 2.37, h: 15.5 },
  ovo: { src: ovo, ar: 3.2, h: 14.5 },
  dana: { src: dana, ar: 3.4, h: 15 },
  linkaja: { src: linkaja, ar: 1.0, h: 22 },
  seabank: { src: seabank, ar: 3.15, h: 14.5 },
}

const ALIASES: Record<string, ProviderKey> = {
  gopay: 'gopay', gojek: 'gopay', goto: 'gopay',
  shopeepay: 'shopeepay', shopee: 'shopeepay', spay: 'shopeepay',
  bca: 'bca', bankbca: 'bca', bankcentralasia: 'bca',
  mandiri: 'mandiri', bankmandiri: 'mandiri',
  jago: 'jago', bankjago: 'jago',
  ovo: 'ovo',
  dana: 'dana',
  linkaja: 'linkaja', aja: 'linkaja',
  seabank: 'seabank', bankseabank: 'seabank',
}

/** Nama brand -> kunci logo. `null` berarti belum ada logo (pakai ikon netral). */
export function providerKey(brand: string): ProviderKey | null {
  const norm = brand.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (ALIASES[norm]) return ALIASES[norm]
  // "Bank BCA", "bca mobile", "GoPay Indonesia": cari yang diawali/diakhiri kunci
  for (const [alias, key] of Object.entries(ALIASES)) {
    if (alias.length >= 3 && (norm.startsWith(alias) || norm.endsWith(alias))) return key
  }
  return null
}
