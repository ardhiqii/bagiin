import { test, expect, type Page } from '@playwright/test'

/**
 * Kotak hitam gelombang 10 — isian yang janggal.
 *
 * Yang diuji di sini bukan "happy path"-nya, tapi apa yang terjadi kalau orang
 * mengetik hal aneh: nama kosong, harga nol, qty puluhan, dua belas item,
 * nama 120 karakter, diskon yang menghabiskan total, pajak 100 persen.
 *
 * Aturan main (sama seperti gelombang sebelumnya): tidak ada seeding lewat API,
 * semua precondition dicapai dengan mengetuk layar, tiap kasus mulai sebagai
 * identitas baru, dan yang diuji adalah apa yang tertulis di layar.
 */

async function freshUser(page: Page, name: string) {
  await page.goto('/')
  if (await page.getByRole('button', { name: 'Mulai pakai Bagiin' }).count()) {
    await page.getByLabel('Nama kamu').fill(name)
    await expect(page.getByRole('button', { name: 'Mulai pakai Bagiin' })).toBeEnabled({ timeout: 20000 })
    await page.getByRole('button', { name: 'Mulai pakai Bagiin' }).click()
  }
  await expect(page.getByRole('heading', { level: 1 })).toContainText(name, { timeout: 20000 })
}

async function openCreate(page: Page) {
  await page.goto('/create')
  await expect(page.locator('#bill-title')).toBeVisible({ timeout: 20000 })
}

test.describe('Kotak hitam — isian janggal di layar buat bill', () => {
  test('C1. harga terisi tapi nama item kosong: tombol mati dan alasannya disebut', async ({ page }) => {
    await freshUser(page, 'Rani')
    await openCreate(page)

    await page.locator('#bill-title').fill('Makan siang')
    await page.locator('#item-price-0').fill('25000')

    const submit = page.getByRole('button', { name: 'Buat bill' })
    await expect(submit).toBeDisabled()
    // Alasan tidak boleh hilang: tombol mati tanpa alasan bikin orang menebak.
    await expect(page.locator('.dock-reason')).toContainText('Isi nama item & harga dulu')
  })

  test('C2. harga nol dianggap belum diisi, bukan bill gratis', async ({ page }) => {
    await freshUser(page, 'Bayu')
    await openCreate(page)

    await page.locator('#bill-title').fill('Kopi')
    await page.locator('#item-name-0').fill('Kopi susu')
    await page.locator('#item-price-0').fill('0')

    await expect(page.getByRole('button', { name: 'Buat bill' })).toBeDisabled()
    await expect(page.locator('.dock-reason')).toContainText('Isi nama item & harga dulu')
  })

  test('C3. qty 99 dihitung 99 porsi, bukan 9 atau 1', async ({ page }) => {
    await freshUser(page, 'Sari')
    await openCreate(page)

    await page.locator('#bill-title').fill('Katering')
    await page.locator('#item-name-0').fill('Kotak nasi')
    await page.locator('#item-price-0').fill('1000')
    await page.locator('#item-qty-0').fill('99')

    await page.getByRole('button', { name: 'Buat bill' }).click()
    await expect(page).toHaveURL(/\/b\//, { timeout: 20000 })
    // 1.000 x 99 = 99.000. Angka ini dihitung dari input, bukan dibaca dari UI.
    await expect(page.locator('.ds-balance-value')).toContainText('99.000', { timeout: 20000 })
  })

  test('C4. dua belas item tetap tersimpan dan totalnya jumlah semuanya', async ({ page }) => {
    test.setTimeout(150_000)
    await freshUser(page, 'Dimas')
    await openCreate(page)

    await page.locator('#bill-title').fill('Patungan kantor')
    await page.locator('#item-name-0').fill('Item 1')
    await page.locator('#item-price-0').fill('1000')

    for (let i = 1; i < 12; i++) {
      await page.getByRole('button', { name: '+ Tambah item' }).click()
      await page.locator(`#item-name-${i}`).fill(`Item ${i + 1}`)
      await page.locator(`#item-price-${i}`).fill('1000')
    }

    await page.getByRole('button', { name: 'Buat bill' }).click()
    await expect(page).toHaveURL(/\/b\//, { timeout: 20000 })
    // 12 x 1.000
    await expect(page.locator('.ds-balance-value')).toContainText('12.000', { timeout: 20000 })
    await expect(page.getByText('Item 12')).toBeVisible({ timeout: 20000 })
  })

  test('C5. nama item 120 karakter + emoji tidak merusak layar', async ({ page }) => {
    await freshUser(page, 'Tika')
    await page.setViewportSize({ width: 320, height: 720 })
    await openCreate(page)

    const panjang = 'Nasi goreng spesial telur mata sapi kerupuk acar timun tomat sambal terasi 🍳'.repeat(2)
    await page.locator('#bill-title').fill('Judul bill yang juga panjang sekali supaya tidak muat di satu baris 🍜')
    await page.locator('#item-name-0').fill(panjang.slice(0, 120))
    await page.locator('#item-price-0').fill('15000')

    await page.getByRole('button', { name: 'Buat bill' }).click()
    await expect(page).toHaveURL(/\/b\//, { timeout: 20000 })
    await expect(page.locator('.ds-balance-value')).toContainText('15.000', { timeout: 20000 })

    // Yang penting: tidak ada scroll mendatar di 320 px, walau judul dan nama
    // item jauh lebih panjang dari layar.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow, 'layar bill tidak boleh melebar ke samping di 320 px').toBeLessThanOrEqual(1)
  })

  test('C6. diskon sebesar subtotal: total Rp0, tombol mati, bukan bill gratis', async ({ page }) => {
    await freshUser(page, 'Nadia')
    await openCreate(page)

    await page.locator('#bill-title').fill('Traktiran')
    await page.locator('#item-name-0').fill('Makan malam')
    await page.locator('#item-price-0').fill('20000')
    await page.locator('#bill-discount').fill('20000')

    await expect(page.getByRole('button', { name: 'Buat bill' })).toBeDisabled()
    await expect(page.locator('.dock-reason')).toContainText('Total masih Rp0')
  })

  test('C7. pajak 100% dan service 50% dihitung apa adanya', async ({ page }) => {
    await freshUser(page, 'Oki')
    await openCreate(page)

    await page.locator('#bill-title').fill('Rapat')
    await page.locator('#item-name-0').fill('Paket makan')
    await page.locator('#item-price-0').fill('10000')
    await page.locator('#bill-tax').fill('10000')
    await page.locator('#bill-service').fill('5000')

    await page.getByRole('button', { name: 'Buat bill' }).click()
    await expect(page).toHaveURL(/\/b\//, { timeout: 20000 })
    // 10.000 + 10.000 + 5.000
    await expect(page.locator('.ds-balance-value')).toContainText('25.000', { timeout: 20000 })
  })

  test('C8. tanggal jauh di masa depan diterima dan tidak mengubah total', async ({ page }) => {
    await freshUser(page, 'Putri')
    await openCreate(page)

    await page.locator('#bill-title').fill('Bill tahun depan')
    await page.locator('#bill-date').fill('01/01/2035')
    await page.locator('#item-name-0').fill('Tiket')
    await page.locator('#item-price-0').fill('75000')

    await page.getByRole('button', { name: 'Buat bill' }).click()
    await expect(page).toHaveURL(/\/b\//, { timeout: 20000 })
    await expect(page.locator('.ds-balance-value')).toContainText('75.000', { timeout: 20000 })
  })
})