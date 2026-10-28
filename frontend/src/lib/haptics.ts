/**
 * Getaran pendek: konfirmasi fisik bahwa ketukan benar-benar mengubah uang.
 *
 * Dipakai hemat, hanya pada aksi yang nilainya berubah (pilih/batalkan item,
 * tandai lunas, tautan terkirim). iOS Safari tidak punya `navigator.vibrate`;
 * di sana fungsi ini jadi tidak melakukan apa-apa — bukan error.
 */
export function buzz(ms = 10) {
  if (typeof navigator === 'undefined') return
  const vibrate = (navigator as Navigator & { vibrate?: (pattern: number) => boolean }).vibrate
  if (typeof vibrate !== 'function') return
  try {
    vibrate.call(navigator, ms)
  } catch {
    /* mode hemat baterai / izin ditolak: abaikan */
  }
}
