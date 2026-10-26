import { test, expect } from '@playwright/test'

const stamp = Date.now().toString().slice(-6)

async function onboard(page: import('@playwright/test').Page, name: string) {
  await page.goto('/')
  const nameField = page.getByLabel('Nama kamu')
  if (await nameField.isVisible().catch(() => false)) {
    await nameField.fill(name)
    await page.getByRole('button', { name: /Lanjut|Mulai/ }).first().click()
  }
}

test.describe('Bagiin — rekap memisahkan yang pasti dan belum pasti', () => {
  test('63. bill yang itemnya belum dipilih ada di "Belum final", lalu pindah setelah ditutup', async ({ page }) => {
    await onboard(page, 'Aufa')
    await page.goto('/create')
    const title = 'Belum Dipilih ' + stamp
    await page.getByLabel('Nama bill').fill(title)
    await page.getByLabel('Item 1').fill('Sate')
    await page.getByLabel('Harga satuan').fill('15000')
    await page.getByRole('button', { name: 'Buat bill' }).click()
    await expect(page).toHaveURL(/\/b\//)

    await page.goto('/recap')
    // tab default: yang belum beres, bukan arsip
    await expect(page.getByRole('tab', { name: /Belum final/ })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByText(title)).toBeVisible()
    // alasannya terbaca, bukan kode
    await expect(page.getByText(/belum ada yang pilih|belum ada yang ngaku/).first()).toBeVisible()

    // pembuat bill menutup bill: sisa ditanggung dia
    await page.getByRole('button', { name: 'Tutup bill' }).first().click()
    await expect(page.getByText('Tutup bill ini?')).toBeVisible()
    await page.getByRole('button', { name: /Tutup, sisa ditanggung/ }).click()

    await expect(page.getByText(title)).toHaveCount(0)

    // rekap tidak lagi mendaftar bill per bill (itu tugas Beranda); buktinya
    // bill pindah ke daftar final dan masuk ke total bulanan
    await expect(page.getByRole('tab', { name: /Belum final/ })).toContainText('0')
    await page.getByRole('tab', { name: /Sudah final/ }).click()
    await expect(page.getByRole('tab', { name: /Sudah final/ })).toContainText('1')
    await expect(page.getByText('Semua bill final')).toBeVisible()
  })
})
