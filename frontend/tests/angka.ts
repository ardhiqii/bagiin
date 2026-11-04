import type { Locator } from '@playwright/test'

/**
 * Baca angka besar setelah animasinya selesai.
 *
 * Sejak angka besar naik dari 0 (460 ms), membacanya begitu kartu terlihat
 * menghasilkan angka antara — "Rp119.573" — dan uji yang membandingkan dua layar
 * jadi gagal tanpa ada yang salah di aplikasinya. Yang diuji di sini angka
 * akhirnya, jadi tunggu sebentar, lalu baca sekali.
 */
export async function angkaStabil(locator: Locator, tungguMs = 650): Promise<string> {
  await locator.page().waitForTimeout(tungguMs)
  return (await locator.innerText()).trim()
}
