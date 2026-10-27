/* Katalog logo provider pembayaran Indonesia.
   Aset: app/src/assets/providers/*.webp (WebP q92, sisi terpanjang 200 px).

   Sumber aset (semua resmi, bukan stok):
   - GoPay: media kit gopay.co.id · ShopeePay: shopeepay.co.id/logo/spp-logo.svg
   - Bank Jago: logo baru 11 Juni 2026
   - CIMB, OCBC, Nobu, Victoria, Amar, Bank Raya, Bank Saqu, blu, Jenius, TMRW, Bank Jateng:
     berkas logo dari situs resmi masing-masing
   - Sisanya (BCA, Mandiri, BNI, BRI, BTN, Permata, Danamon, Panin, Mega, BSI, Muamalat,
     DKI, Jatim, Sinarmas, BTPN, Maspion, Mayapada, Allo, UOB, Maybank, KB Bukopin, QNB,
     Superbank, Aladin, Flazz, e-Money, QRIS, Grab, OVO, DANA, LinkAja): artwork resmi via
     Wikimedia Commons

   Ukuran TIDAK ditentukan per brand. Semua logo menempati kotak 72x24 px; tinggi gambar
   di dalamnya dihitung dari rasio aslinya lewat opticalHeight(), karena logo 12:1 (BRI) dan
   1:1 (TMRW) tidak bisa dipatok tinggi yang sama tanpa salah satunya terlihat raksasa. */

export type ProviderKey =
  | 'bca'
  | 'mandiri'
  | 'bni'
  | 'bri'
  | 'btn'
  | 'cimb'
  | 'permata'
  | 'danamon'
  | 'panin'
  | 'ocbc'
  | 'maybank'
  | 'mega'
  | 'bsi'
  | 'muamalat'
  | 'dki'
  | 'jateng'
  | 'jatim'
  | 'nobu'
  | 'sinarmas'
  | 'kb_bukopin'
  | 'btpn'
  | 'victoria'
  | 'maspion'
  | 'amar'
  | 'qnb'
  | 'uob'
  | 'mayapada'
  | 'aladin'
  | 'jago'
  | 'seabank'
  | 'neo'
  | 'raya'
  | 'allo'
  | 'saqu'
  | 'superbank'
  | 'blu'
  | 'jenius'
  | 'tmrw'
  | 'gopay'
  | 'ovo'
  | 'dana'
  | 'shopeepay'
  | 'linkaja'
  | 'grab'
  | 'qris'
  | 'flazz'
  | 'emoney'

export type Provider = { src: string; ar: number; label: string }

const ASSETS = import.meta.glob('../assets/providers/*.webp', { eager: true, import: 'default' }) as Record<string, string>

function asset(key: string): string {
  const url = ASSETS[`../assets/providers/${key}.webp`]
  if (!url) throw new Error('Logo provider hilang: ' + key)
  return url
}

const AR: Record<ProviderKey, number> = {
  bca: 3.19,
  mandiri: 3.43,
  bni: 3.45,
  bri: 1.26,
  btn: 4.28,
  cimb: 1.26,
  permata: 4.04,
  danamon: 2.61,
  panin: 1.42,
  ocbc: 3.7,
  maybank: 3.48,
  mega: 1.71,
  bsi: 3.59,
  muamalat: 3.54,
  dki: 6.25,
  jateng: 0.88,
  jatim: 3.41,
  nobu: 4.83,
  sinarmas: 4.19,
  kb_bukopin: 1.72,
  btpn: 1.68,
  victoria: 7.26,
  maspion: 1.26,
  amar: 1.99,
  qnb: 3.43,
  uob: 3.52,
  mayapada: 1.47,
  aladin: 2.35,
  jago: 2.37,
  seabank: 3.15,
  neo: 2.16,
  raya: 1.83,
  allo: 4.67,
  saqu: 2.42,
  superbank: 1.61,
  blu: 1.9,
  jenius: 3.82,
  tmrw: 1.0,
  gopay: 4.63,
  ovo: 3.21,
  dana: 3.4,
  shopeepay: 5.19,
  linkaja: 1.0,
  grab: 2.81,
  qris: 2.63,
  flazz: 2.29,
  emoney: 4.58,
}

const LABEL: Record<ProviderKey, string> = {
  bca: 'BCA',
  mandiri: 'Mandiri',
  bni: 'BNI',
  bri: 'BRI',
  btn: 'BTN',
  cimb: 'CIMB Niaga',
  permata: 'Permata',
  danamon: 'Danamon',
  panin: 'Panin',
  ocbc: 'OCBC',
  maybank: 'Maybank',
  mega: 'Bank Mega',
  bsi: 'BSI',
  muamalat: 'Muamalat',
  dki: 'Bank DKI',
  jateng: 'Bank Jateng',
  jatim: 'Bank Jatim',
  nobu: 'Nobu',
  sinarmas: 'Sinarmas',
  kb_bukopin: 'KB Bukopin',
  btpn: 'BTPN',
  victoria: 'Victoria',
  maspion: 'Maspion',
  amar: 'Amar',
  qnb: 'QNB',
  uob: 'UOB',
  mayapada: 'Mayapada',
  aladin: 'Aladin',
  jago: 'Jago',
  seabank: 'SeaBank',
  neo: 'Neo Commerce',
  raya: 'Bank Raya',
  allo: 'Allo Bank',
  saqu: 'Bank Saqu',
  superbank: 'Superbank',
  blu: 'blu',
  jenius: 'Jenius',
  tmrw: 'TMRW',
  gopay: 'GoPay',
  ovo: 'OVO',
  dana: 'DANA',
  shopeepay: 'ShopeePay',
  linkaja: 'LinkAja',
  grab: 'Grab',
  qris: 'QRIS',
  flazz: 'Flazz BCA',
  emoney: 'e-Money Mandiri',
}

export const PROVIDERS = Object.keys(AR).reduce((acc, key) => {
  const k = key as ProviderKey
  acc[k] = { src: asset(k), ar: AR[k], label: LABEL[k] }
  return acc
}, {} as Record<ProviderKey, Provider>)

/** Tinggi optik di dalam kotak 72x24. Dihitung dari rasio, bukan didata manual:
    mark persegi 22 px, wordmark lebar turun bertahap supaya bobot matanya seimbang. */
export function opticalHeight(ar: number): number {
  if (ar < 1.6) return 22
  if (ar < 2.6) return 16
  if (ar < 3.6) return 15
  if (ar < 4.8) return 13.5
  return 12.5
}

/* Nama brand di database adalah teks bebas: "Bank BCA", "bca mobile", "BCA".
   Pencocokan dilakukan pada bentuk normal (huruf kecil, tanpa spasi/tanda baca). */
const ALIASES: Record<string, ProviderKey> = {
  bca: 'bca',
  bankbca: 'bca',
  bankcentralasia: 'bca',
  mandiri: 'mandiri',
  bankmandiri: 'mandiri',
  livin: 'mandiri',
  bni: 'bni',
  bankbni: 'bni',
  banknegaraindonesia: 'bni',
  wondr: 'bni',
  bri: 'bri',
  bankbri: 'bri',
  bankrakyatindonesia: 'bri',
  brimo: 'bri',
  btn: 'btn',
  bankbtn: 'btn',
  banktabungannegara: 'btn',
  bale: 'btn',
  cimb: 'cimb',
  cimbniaga: 'cimb',
  niaga: 'cimb',
  octo: 'cimb',
  permata: 'permata',
  permatabank: 'permata',
  bankpermata: 'permata',
  danamon: 'danamon',
  bankdanamon: 'danamon',
  panin: 'panin',
  paninbank: 'panin',
  ocbc: 'ocbc',
  ocbcindonesia: 'ocbc',
  bankocbc: 'ocbc',
  maybank: 'maybank',
  maybankindonesia: 'maybank',
  mega: 'mega',
  bankmega: 'mega',
  megasyariah: 'mega',
  bsi: 'bsi',
  banksyariahindonesia: 'bsi',
  banksyariah: 'bsi',
  bsisyariah: 'bsi',
  muamalat: 'muamalat',
  bankmuamalat: 'muamalat',
  dki: 'dki',
  bankdki: 'dki',
  jakone: 'dki',
  jateng: 'jateng',
  bankjateng: 'jateng',
  jatim: 'jatim',
  bankjatim: 'jatim',
  nobu: 'nobu',
  banknobu: 'nobu',
  nationalnobu: 'nobu',
  sinarmas: 'sinarmas',
  banksinarmas: 'sinarmas',
  kb: 'kb_bukopin',
  kbbukopin: 'kb_bukopin',
  bukopin: 'kb_bukopin',
  kbbanksyariah: 'kb_bukopin',
  btpn: 'btpn',
  bankbtpn: 'btpn',
  victoria: 'victoria',
  victoriabank: 'victoria',
  maspion: 'maspion',
  bankmaspion: 'maspion',
  amar: 'amar',
  amarbank: 'amar',
  bankamar: 'amar',
  qnb: 'qnb',
  qnbindonesia: 'qnb',
  uob: 'uob',
  uobindonesia: 'uob',
  bankuob: 'uob',
  mayapada: 'mayapada',
  bankmayapada: 'mayapada',
  aladin: 'aladin',
  aladinbank: 'aladin',
  banksyariahaladin: 'aladin',
  jago: 'jago',
  bankjago: 'jago',
  jagobot: 'jago',
  seabank: 'seabank',
  bankseabank: 'seabank',
  neo: 'neo',
  bankneo: 'neo',
  bankneocommerce: 'neo',
  bnc: 'neo',
  raya: 'raya',
  bankraya: 'raya',
  allo: 'allo',
  allobank: 'allo',
  allobankdigital: 'allo',
  saqu: 'saqu',
  banksaqu: 'saqu',
  saqubymaybank: 'saqu',
  superbank: 'superbank',
  banksuperbank: 'superbank',
  blu: 'blu',
  blubybcadigital: 'blu',
  bcadigital: 'blu',
  jenius: 'jenius',
  bankjenius: 'jenius',
  btpns: 'jenius',
  tmrw: 'tmrw',
  tmrwbyuob: 'tmrw',
  brizzi: 'bri',
  tapcash: 'bni',
  isaku: 'bca',
  sakuku: 'bca',
  bsb: 'bsi',
  gopay: 'gopay',
  gojek: 'gopay',
  goto: 'gopay',
  gopaylater: 'gopay',
  ovo: 'ovo',
  ovopay: 'ovo',
  dana: 'dana',
  danaid: 'dana',
  dompetdana: 'dana',
  shopeepay: 'shopeepay',
  shopee: 'shopeepay',
  spay: 'shopeepay',
  linkaja: 'linkaja',
  aja: 'linkaja',
  linkajasyariah: 'linkaja',
  grab: 'grab',
  grabpay: 'grab',
  grabfood: 'grab',
  qris: 'qris',
  qrisnob: 'qris',
  flazz: 'flazz',
  flazzbca: 'flazz',
  emoney: 'emoney',
  emoneymandiri: 'emoney',
  mandiriemoney: 'emoney',
  emoneycard: 'emoney',
}

export function providerKey(brand: string): ProviderKey | null {
  const norm = brand.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (!norm) return null
  if (ALIASES[norm]) return ALIASES[norm]
  for (const [alias, key] of Object.entries(ALIASES)) {
    if (alias.length < 3) continue
    if (norm.startsWith(alias) || norm.endsWith(alias) || norm.includes(alias)) return key
  }
  return null
}
