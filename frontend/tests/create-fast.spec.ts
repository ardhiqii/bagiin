import { test, expect } from '@playwright/test'

/**
 * Sesudah "Buat bill", layar bill harus langsung berisi.
 *
 * `POST /api/bills` sekarang membalas payload bill yang sama seperti
 * `GET /bill`, jadi layar tujuan tidak perlu mengambilnya lagi. Yang diuji:
 * tidak ada `GET /api/bills/{id}` sesudah pembuatan, dan isinya benar.
 */

const stamp = Date.now().toString().slice(-6)

test('46. buat bill: layar tujuan tidak mengambil ulang bill', async ({ page }) => {
  let ambilUlang = 0
  await page.route('**/api/bills/*', async (route) => {
    if (route.request().method() === 'GET') ambilUlang += 1
    await route.continue()
  })

  await page.goto('/')
  await page.getByLabel('Nama kamu').fill('Buat' + stamp)
  await expect(page.getByRole('button', { name: 'Mulai pakai Bagiin' })).toBeEnabled({ timeout: 20000 })
  await page.getByRole('button', { name: 'Mulai pakai Bagiin' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Buat' + stamp)

  await page.goto('/create')
  await page.getByLabel('Nama bill').fill('Warteg ' + stamp)
  await page.getByLabel('Item 1').fill('Nasi uduk')
  await page.getByLabel('Harga satuan').first().fill('25000')
  await expect(page.getByRole('button', { name: 'Buat bill' })).toBeEnabled({ timeout: 20000 })
  await page.getByRole('button', { name: 'Buat bill' }).click()

  await expect(page).toHaveURL(/\/b\//, { timeout: 20000 })
  // Isi bill sudah ada tanpa kerangka pemuatan: nama item dan judulnya terlihat.
  await expect(page.locator('.ds-item').filter({ hasText: 'Nasi uduk' })).toBeVisible({ timeout: 10000 })
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Warteg ' + stamp, { timeout: 10000 })

  expect(ambilUlang, 'layar tujuan tidak boleh GET /bill lagi').toBe(0)
})
