import { test, expect, type Page } from '@playwright/test'

/**
 * Kotak hitam gelombang 19 — isian uang seperti orang mengetik dan menempel.
 *
 * Orang menempel harga dari WhatsApp ("Rp 25.000"), mengetik "25rb", mengosongkan
 * jumlah, dan menempel nama menu yang terbawa beberapa baris. Tidak ada yang
 * membaca dokumentasi; yang diperiksa di sini adalah apakah aplikasi tetap
 * menghasilkan angka yang masuk akal, dan kalau tidak, apakah ia menjelaskan.
 */

async function freshUser(page: Page, name: string) {
  await page.goto('/')
  if (await page.getByRole('button', { name: 'Mulai pakai Bagiin' }).count()) {
    await page.getByLabel('Nama kamu').fill(name)
    await page.getByRole('button', { name: 'Mulai pakai Bagiin' }).click()
  }
  await expect(page.getByRole('heading', { level: 1 })).toContainText(name, { timeout: 20000 })
  await page.goto('/create')
  await expect(page.locator('#bill-title')).toBeVisible({ timeout: 20000 })
}

async function totalTeks(page: Page) {
  return (await page.locator('.create-dock .tot b').innerText()).trim()
}

test.describe('Kotak hitam — isian uang', () => {
  test('X1. harga ditempel apa adanya dari WhatsApp ("Rp 25.000")', async ({ page }) => {
    await freshUser(page, 'Galuh')
    await page.locator('#item-name-0').fill('Nasi goreng')
    await page.locator('#item-price-0').fill('')
    await page.locator('#item-price-0').pressSequentially('Rp 25.000')
    await page.waitForTimeout(300)

    const total = await totalTeks(page)
    // Satu angka, bukan dua puluh lima ribu juta dan bukan nol.
    expect(total, 'total setelah menempel "Rp 25.000"').toMatch(/25\.000/)
  })

  test('X2. harga diketik dengan satuan ("25rb") tidak menghasilkan angka aneh', async ({ page }) => {
    await freshUser(page, 'Hana')
    await page.locator('#item-name-0').fill('Kopi')
    await page.locator('#item-price-0').pressSequentially('25rb')
    await page.waitForTimeout(300)

    const total = await totalTeks(page)
    expect(total, 'total tidak boleh berisi NaN atau kosong').not.toMatch(/NaN|undefined/)

    const simpan = page.getByRole('button', { name: 'Buat bill' })
    if (await simpan.isEnabled()) {
      // Kalau diizinkan, angkanya harus masuk akal (25 atau 25.000), bukan 2.500.000.
      expect(total).toMatch(/^Rp(25|25\.000)$/)
    } else {
      // Kalau ditolak, harus ada kalimat yang menjelaskan, bukan tombol mati bisu.
      const alasan = await page.locator('.dock-reason').innerText()
      expect(alasan.trim().length, 'tombol mati harus punya alasan').toBeGreaterThan(3)
    }
  })

  test('X3. jumlah dikosongkan lalu diisi 0: tidak menghasilkan bagian nol', async ({ page }) => {
    await freshUser(page, 'Indra')
    await page.locator('#item-name-0').fill('Teh')
    await page.locator('#item-price-0').fill('5000')
    await page.locator('#item-qty-0').fill('0')
    await page.locator('#item-qty-0').blur()
    await page.waitForTimeout(300)

    const qty = await page.locator('#item-qty-0').inputValue()
    expect(Number(qty), 'jumlah minimal 1 setelah ditinggal').toBeGreaterThanOrEqual(1)
    await expect(page.getByRole('button', { name: 'Buat bill' })).toBeEnabled()
  })

  test('X4. jumlah 999: total sama dengan harga dikali jumlah', async ({ page }) => {
    await freshUser(page, 'Joko')
    await page.locator('#item-name-0').fill('Kacang')
    await page.locator('#item-price-0').fill('1000')
    await page.locator('#item-qty-0').fill('999')
    await page.locator('#item-qty-0').blur()
    await page.waitForTimeout(300)

    const total = await totalTeks(page)
    expect(total, '999 x 1.000 = 999.000').toMatch(/999\.000/)
    const geser = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(geser, 'jumlah besar tidak boleh melebarkan layar').toBeLessThanOrEqual(1)
  })

  test('X5. nama item hanya spasi: ditolak dengan alasan yang menunjuk baris', async ({ page }) => {
    await freshUser(page, 'Kiki')
    await page.locator('#item-name-0').fill('   ')
    await page.locator('#item-price-0').fill('15000')
    await page.waitForTimeout(300)

    const simpan = page.getByRole('button', { name: 'Buat bill' })
    if (await simpan.isEnabled()) {
      await simpan.click()
      // Kalau lolos, harus muncul pesan yang menunjuk barisnya, bukan diam saja.
      await expect(page.getByText(/nama|item|baris/i).first()).toBeVisible({ timeout: 10000 })
      await expect(page).toHaveURL(/\/create$/)
    } else {
      const alasan = await page.locator('.dock-reason').innerText()
      expect(alasan.trim().length).toBeGreaterThan(3)
    }
  })

  test('X6. menempel nama menu beberapa baris tidak merusak layar', async ({ page }) => {
    await freshUser(page, 'Lestari')
    await page.locator('#bill-title').fill('Tempel menu')
    await page.locator('#item-name-0').fill('Nasi goreng spesial\nExtra telur\nTanpa pedas')
    await page.locator('#item-price-0').fill('28000')
    await page.waitForTimeout(300)

    const geser = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(geser, 'tempelan multi-baris tidak boleh melebarkan layar').toBeLessThanOrEqual(1)

    await page.getByRole('button', { name: 'Buat bill' }).click()
    await expect(page).toHaveURL(/\/b\//, { timeout: 20000 })
    // Nominalnya utuh meski namanya panjang dan berbaris.
    await expect(page.locator('.ds-balance-value')).toContainText('28.000', { timeout: 20000 })
  })
})
