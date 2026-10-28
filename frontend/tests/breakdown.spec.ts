import { test, expect, type Page } from '@playwright/test'

const stamp = Date.now().toString().slice(-6)

async function onboard(page: Page, name: string) {
  await page.goto('/')
  if (await page.getByRole('button', { name: 'Mulai pakai Bagiin' }).count()) {
    await page.getByLabel('Nama kamu').fill(name)
    await page.getByRole('button', { name: 'Mulai pakai Bagiin' }).click()
  }
  await expect(page.getByRole('heading', { level: 1 })).toContainText(name)
}

test.describe('Bagiin — rincian struk di layar bill', () => {
  test('54. subtotal, pajak, service, dan diskon kelihatan sebagai baris', async ({ page }) => {
    await onboard(page, 'Aufa')
    await page.goto('/create')

    await page.getByLabel('Nama bill').fill('Rincian ' + stamp)
    await page.getByLabel('Item 1').fill('Nasi goreng')
    await page.getByLabel('Harga satuan').first().fill('100000')
    await page.getByLabel('Pajak', { exact: true }).fill('10000')
    await page.getByLabel('Service').fill('5000')
    await page.getByLabel('Diskon pesanan').fill('15000')
    // Tunggu aplikasi menyatakan siap, jangan menebak lewat jeda: tombol ini
    // mati selama identitas belum siap, dan klik ke tombol mati hilang tanpa
    // jejak — di mesin lambat itu terbaca sebagai "aplikasi tidak berpindah".
    await expect(page.getByRole('button', { name: 'Buat bill' })).toBeEnabled()
    await page.getByRole('button', { name: 'Buat bill' }).click()
    await page.waitForURL(/\/b\//)

    const breakdown = page.locator('.bill-breakdown')
    await expect(breakdown).toBeVisible()
    await expect(breakdown).toContainText('Subtotal')
    await expect(breakdown).toContainText('Rp100.000')
    await expect(breakdown).toContainText('Diskon pesanan')
    await expect(breakdown).toContainText('-Rp15.000')
    await expect(breakdown).toContainText('Pajak')
    await expect(breakdown).toContainText('Rp10.000')
    await expect(breakdown).toContainText('Service')
    await expect(breakdown).toContainText('Rp5.000')
    // totalnya sendiri sudah jadi angka besar di kartu atas layar
    await expect(page.getByText('Total bill')).toBeVisible()
    await expect(page.getByText('Rp100.000').first()).toBeVisible()
  })

  test('55. bill tanpa pajak/diskon hanya menampilkan subtotal dan total', async ({ page }) => {
    await onboard(page, 'Aufa')
    await page.goto('/create')

    await page.getByLabel('Nama bill').fill('Polos ' + stamp)
    await page.getByLabel('Item 1').fill('Kopi')
    await page.getByLabel('Harga satuan').first().fill('18000')
    // Tunggu aplikasi menyatakan siap, jangan menebak lewat jeda: tombol ini
    // mati selama identitas belum siap, dan klik ke tombol mati hilang tanpa
    // jejak — di mesin lambat itu terbaca sebagai "aplikasi tidak berpindah".
    await expect(page.getByRole('button', { name: 'Buat bill' })).toBeEnabled()
    await page.getByRole('button', { name: 'Buat bill' }).click()
    await page.waitForURL(/\/b\//)

    const breakdown = page.locator('.bill-breakdown')
    await expect(breakdown).toBeVisible()
    await expect(breakdown.locator('.bill-line')).toHaveCount(1)
    await expect(breakdown).not.toContainText('Diskon pesanan')
    await expect(breakdown).not.toContainText('Service')
  })
})
