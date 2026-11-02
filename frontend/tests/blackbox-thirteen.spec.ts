import { test, expect, type Page, type Browser } from '@playwright/test'

/**
 * Kotak hitam gelombang 13 — uang yang harus cocok.
 *
 * Fokusnya bukan tampilan, tapi angka: satu item dibagi tiga orang, pajak yang
 * sudah termasuk harga plus service dan diskon, diskon yang menghabiskan
 * subtotal padahal masih ada pajak, dua item bernama sama, rekap lintas bill,
 * dan harga yang diubah setelah tamu memilih.
 *
 * Semua angka harapan dihitung dari input di spec ini, tidak dibaca dari UI.
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

async function joinAsGuest(browser: Browser, url: string, name: string) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const guest = await ctx.newPage()
  await guest.goto(url)
  await expect(guest.getByRole('button', { name: /Ikut bill ini|Gabung/ })).toBeVisible({ timeout: 20000 })
  await guest.getByRole('button', { name: /Ikut bill ini|Gabung/ }).click()
  if (await guest.getByLabel('Nama kamu').count()) {
    await guest.getByLabel('Nama kamu').fill(name)
    await guest.getByRole('button', { name: /Simpan nama & ikut bill/ }).click()
  }
  /* Tunggu sampai benar-benar JOINED, bukan sekadar selesai mengetuk: sesudah
     ini ada tes yang menekan baris item, dan baris item mati selama orangnya
     belum tercatat ikut. Di mesin lambat, tanpa penantian ini, ketukan pertama
     jatuh ke tombol mati dan hilang tanpa jejak. */
  await expect(guest.getByRole('button', { name: /Ikut bill ini|Gabung/ })).toHaveCount(0, { timeout: 20000 })
  return { ctx, guest }
}

test.describe('Kotak hitam — angka yang harus cocok', () => {
  test('F1. satu item 10.000 dibagi tiga orang: tiap orang 3.333', async ({ page, browser }) => {
    test.setTimeout(150_000)
    await freshUser(page, 'Damar')
    await openCreate(page)
    await page.locator('#bill-title').fill('Dibagi tiga')
    await page.locator('#item-name-0').fill('Pizza')
    await page.locator('#item-price-0').fill('10000')
    await page.getByRole('button', { name: 'Buat bill' }).click()
    await expect(page).toHaveURL(/\/b\//, { timeout: 20000 })
    const url = page.url()

    const { ctx: c1, guest: g1 } = await joinAsGuest(browser, url, 'Eka')
    const { ctx: c2, guest: g2 } = await joinAsGuest(browser, url, 'Fajar')
    try {
      await page.bringToFront()
      await page.reload()
      await page.getByRole('button', { name: /Pizza, ketuk untuk memilih/ }).click()
      await g1.bringToFront()
      await g1.reload()
      await g1.getByRole('button', { name: /Pizza, ketuk untuk memilih/ }).click()
      await g2.bringToFront()
      await g2.reload()
      await g2.getByRole('button', { name: /Pizza, ketuk untuk memilih/ }).click()

      // Layar orang lain tidak menyegarkan diri sendiri; yang benar adalah
      // memuat ulang, bukan mengharapkan angka baru muncul tanpa aksi.
      await g1.reload()
      await g2.reload()
      await page.reload()

      // 10.000 / 3 = 3.333,33 → tiap orang 3.333, sisa 1 rupiah ditanggung penalangi.
      await expect(g1.getByText(/Bagian Rp3\.333/).first()).toBeVisible({ timeout: 20000 })
      await expect(g2.getByText(/Bagian Rp3\.333/).first()).toBeVisible({ timeout: 20000 })
      // Total bill tidak boleh berubah gara-gara pembulatan.
      await expect(page.locator('.ds-balance-value')).toContainText('10.000', { timeout: 20000 })
      await expect(page.locator('.app-row', { hasText: 'Damar' })).toContainText('3.334', { timeout: 20000 })
    } finally {
      await c1.close()
      await c2.close()
    }
  })

  test('F2. harga sudah termasuk pajak: service dan diskon tetap dihitung', async ({ page }) => {
    await freshUser(page, 'Gita')
    await openCreate(page)
    await page.locator('#bill-title').fill('Harga sudah termasuk pajak')
    await page.locator('#item-name-0').fill('Paket lengkap')
    await page.locator('#item-price-0').fill('100000')
    await page.getByLabel(/termasuk pajak/i).check()
    await page.locator('#bill-service').fill('10000')
    await page.locator('#bill-discount').fill('5000')

    await page.getByRole('button', { name: 'Buat bill' }).click()
    await expect(page).toHaveURL(/\/b\//, { timeout: 20000 })
    // 100.000 + 10.000 service − 5.000 diskon. Pajak tidak ditambah lagi.
    await expect(page.locator('.ds-balance-value')).toContainText('105.000', { timeout: 20000 })
  })

  test('F3. diskon sebesar subtotal tetapi ada pajak: total tersisa pajaknya saja', async ({ page }) => {
    await freshUser(page, 'Hesti')
    await openCreate(page)
    await page.locator('#bill-title').fill('Diskon penuh plus pajak')
    await page.locator('#item-name-0').fill('Menu')
    await page.locator('#item-price-0').fill('20000')
    await page.locator('#bill-tax').fill('2000')
    await page.locator('#bill-discount').fill('20000')

    const submit = page.getByRole('button', { name: 'Buat bill' })
    await expect(submit).toBeEnabled()
    await submit.click()
    await expect(page).toHaveURL(/\/b\//, { timeout: 20000 })
    await expect(page.locator('.ds-balance-value')).toContainText('2.000', { timeout: 20000 })
  })

  test('F4. dua item bernama sama: yang dipilih hanya baris yang diketuk', async ({ page, browser }) => {
    test.setTimeout(150_000)
    await freshUser(page, 'Iwan')
    await openCreate(page)
    await page.locator('#bill-title').fill('Dua kopi beda harga')
    await page.locator('#item-name-0').fill('Kopi')
    await page.locator('#item-price-0').fill('10000')
    await page.getByRole('button', { name: '+ Tambah item' }).click()
    await page.locator('#item-name-1').fill('Kopi')
    await page.locator('#item-price-1').fill('15000')
    await page.getByRole('button', { name: 'Buat bill' }).click()
    await expect(page).toHaveURL(/\/b\//, { timeout: 20000 })
    const url = page.url()

    const { ctx, guest } = await joinAsGuest(browser, url, 'Jaka')
    try {
      await guest.getByRole('button', { name: /Kopi, ketuk untuk memilih/ }).nth(1).click()
      // Yang terpilih adalah kopi 15.000, bukan yang 10.000.
      await expect(guest.getByText(/Bagian Rp15\.000/).first()).toBeVisible({ timeout: 20000 })
    } finally {
      await ctx.close()
    }
  })

  test('F5. rekap menjumlahkan dua bill yang berbeda', async ({ page, browser }) => {
    test.setTimeout(200_000)
    await freshUser(page, 'Kartika')

    await openCreate(page)
    await page.locator('#bill-title').fill('Bill pertama')
    await page.locator('#item-name-0').fill('Nasi padang')
    await page.locator('#item-price-0').fill('30000')
    await page.getByRole('button', { name: 'Buat bill' }).click()
    await expect(page).toHaveURL(/\/b\//, { timeout: 20000 })
    const url1 = page.url()

    await openCreate(page)
    await page.locator('#bill-title').fill('Bill kedua')
    await page.locator('#item-name-0').fill('Es teh')
    await page.locator('#item-price-0').fill('20000')
    await page.getByRole('button', { name: 'Buat bill' }).click()
    await expect(page).toHaveURL(/\/b\//, { timeout: 20000 })
    const url2 = page.url()

    const { ctx, guest } = await joinAsGuest(browser, url1, 'Lukman')
    try {
      await guest.getByRole('button', { name: /Nasi padang, ketuk untuk memilih/ }).click()

      // Bill kedua adalah bill lain: orang yang sama tetap harus ikut dulu.
      await guest.goto(url2)
      await expect(guest.getByRole('button', { name: /Ikut bill ini|Gabung/ })).toBeVisible({ timeout: 20000 })
      await guest.getByRole('button', { name: /Ikut bill ini|Gabung/ }).click()
      await expect(guest.getByRole('button', { name: /Es teh, ketuk untuk memilih/ })).toBeEnabled({ timeout: 20000 })
      await guest.getByRole('button', { name: /Es teh, ketuk untuk memilih/ }).click()

      await guest.goto('/recap')
      // 30.000 + 20.000
      await expect(guest.getByText(/50\.000/).first()).toBeVisible({ timeout: 20000 })
    } finally {
      await ctx.close()
    }
  })

  test('F6. harga diubah setelah tamu memilih: kedua sisi memakai angka baru', async ({ page, browser }) => {
    test.setTimeout(150_000)
    await freshUser(page, 'Mira')
    await openCreate(page)
    await page.locator('#bill-title').fill('Harga berubah')
    await page.locator('#item-name-0').fill('Ayam bakar')
    await page.locator('#item-price-0').fill('30000')
    await page.getByRole('button', { name: 'Buat bill' }).click()
    await expect(page).toHaveURL(/\/b\//, { timeout: 20000 })
    const url = page.url()

    const { ctx, guest } = await joinAsGuest(browser, url, 'Nanda')
    try {
      await guest.getByRole('button', { name: /Ayam bakar, ketuk untuk memilih/ }).click()
      await expect(guest.getByText(/Bagian Rp30\.000/).first()).toBeVisible({ timeout: 20000 })

      await page.bringToFront()
      await page.goto(url + '/edit')
      await expect(page.locator('#edit-item-price-0')).toBeVisible({ timeout: 20000 })
      await page.locator('#edit-item-price-0').fill('45000')
      await page.getByRole('button', { name: /Simpan/ }).click()
      await expect(page.locator('.ds-balance-value')).toContainText('45.000', { timeout: 20000 })

      await guest.bringToFront()
      await guest.reload()
      await expect(guest.getByText(/Bagian Rp45\.000/).first()).toBeVisible({ timeout: 20000 })
    } finally {
      await ctx.close()
    }
  })
})
