import { expect, type Page } from '@playwright/test'

/**
 * Saringan status daftar bill.
 *
 * Sejak beranda memakai pola 0.9, chip status TIDAK lagi ada di badan layar —
 * semuanya di dalam sheet "Atur". Tes yang mengklik `button[name="Lunas"]`
 * langsung akan menunggu tombol yang tidak pernah dirender dan mati karena
 * timeout, bukan karena aplikasinya salah. Karena itu satu tempat ini dipakai
 * semua spec, supaya perubahan bentuk kontrol tidak perlu ditambal di banyak
 * file dengan cara yang berbeda-beda.
 */
export async function setStatus(page: Page, label: 'Semua' | 'Lunas' | 'Belum lunas' | 'Perlu dikerjakan') {
  await page.getByRole('button', { name: /Atur/ }).click()
  const sheet = page.getByRole('dialog')
  await expect(sheet).toBeVisible()
  await sheet.getByRole('button', { name: label, exact: true }).click()
  await sheet.getByRole('button', { name: 'Terapkan' }).click()
  await expect(sheet).toHaveCount(0)
}

/** Membuka sheet "Atur" tanpa mengubah saringan apa pun. */
export async function openFilters(page: Page) {
  await page.getByRole('button', { name: /Atur/ }).click()
  const sheet = page.getByRole('dialog')
  await expect(sheet).toBeVisible()
  return sheet
}
