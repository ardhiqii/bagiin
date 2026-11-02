/**
 * Kotak hitam, dua orang: pemilik bill dan tamu yang membuka link.
 * Semua lewat layar; tidak ada satu pun pemanggilan API langsung.
 */
import { test, expect, type Page } from '@playwright/test'

const stamp = Date.now().toString().slice(-6)

async function freshUser(page: Page, name: string) {
  await page.goto('/')
  if (await page.getByRole('button', { name: 'Mulai pakai Bagiin' }).count()) {
    await page.getByLabel('Nama kamu').fill(name)
    await expect(page.getByRole('button', { name: 'Mulai pakai Bagiin' })).toBeEnabled({ timeout: 20000 })
    await page.getByRole('button', { name: 'Mulai pakai Bagiin' }).click()
  }
  await expect(page.getByRole('heading', { level: 1 })).toContainText(name, { timeout: 20000 })
}

async function manualBill(page: Page, title: string, price: number) {
  await page.goto('/create')
  await expect(page.locator('#bill-title')).toBeVisible({ timeout: 20000 })
  await page.locator('#bill-title').fill(title)
  await page.locator('#item-name-0').fill('Nasi goreng')
  await page.locator('#item-price-0').fill(String(price))
  await expect(page.getByRole('button', { name: 'Buat bill' })).toBeEnabled()
  await page.getByRole('button', { name: 'Buat bill' }).click()
  await expect(page).toHaveURL(/\/b\//, { timeout: 20000 })
  return page.url()
}

async function joinAsGuest(browser: any, url: string, name: string) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const guest = await ctx.newPage()
  await guest.goto(url)
  await expect(guest.getByRole('button', { name: /Ikut bill ini|Gabung/ })).toBeVisible({ timeout: 20000 })
  await guest.getByRole('button', { name: /Ikut bill ini|Gabung/ }).click()
  // tamu diminta isi nama dulu
  if (await guest.getByLabel('Nama kamu').count()) {
    await guest.getByLabel('Nama kamu').fill(name)
    await guest.getByRole('button', { name: /Simpan nama & ikut bill/ }).click()
  }
  /* Tunggu sampai benar-benar JOINED, bukan sekadar selesai mengetuk: sesudah
     ini ada tes yang menekan baris item, dan baris item mati selama orangnya
     belum tercatat ikut. Di mesin lambat, tanpa penantian ini, ketukan pertama
     jatuh ke tombol mati dan hilang tanpa jejak. */
  await expect(guest.getByRole('button', { name: /Ikut bill ini|Gabung/ })).toHaveCount(0, { timeout: 20000 })
  await expect(guest.getByText(/Nasi goreng/).first()).toBeVisible({ timeout: 20000 })
  return { ctx, guest }
}

test.describe('Kotak hitam — tamu lewat link', () => {
  test('B20. tamu bergabung lalu memilih item, bagiannya sama dengan harga item', async ({ page, browser }) => {
    await freshUser(page, 'Own ' + stamp)
    const url = await manualBill(page, 'Tamu ' + stamp, 45000)
    const { ctx, guest } = await joinAsGuest(browser, url, 'Tamu ' + stamp)

    await guest.getByRole('button', { name: /Nasi goreng, ketuk untuk memilih/ }).click()
    await expect(guest.getByText(/bagian kamu Rp45\.000/i).first()).toBeVisible({ timeout: 20000 })
    await ctx.close()
  })

  test('B21. dua tamu memilih item yang sama: dibagi rata, total tidak berubah', async ({ page, browser }) => {
    await freshUser(page, 'Own2 ' + stamp)
    const url = await manualBill(page, 'Bagi dua ' + stamp, 50000)

    const a = await joinAsGuest(browser, url, 'TamuA ' + stamp)
    const b = await joinAsGuest(browser, url, 'TamuB ' + stamp)
    await a.guest.getByRole('button', { name: /Nasi goreng, ketuk untuk memilih/ }).click()
    await b.guest.getByRole('button', { name: /Nasi goreng, ketuk untuk memilih/ }).click()
    await a.guest.waitForTimeout(1500)

    for (const g of [a.guest, b.guest]) {
      await g.reload()
      await g.waitForTimeout(1200)
      const text = await g.locator('body').innerText()
      expect(text).toMatch(/Rp25\.000|Rp24\.999|Rp25\.001/)
      expect(text).not.toMatch(/Rp\s?-/)
    }
    await a.ctx.close()
    await b.ctx.close()
  })

  test('B22. tamu yang belum ikut melihat tombol gabung, bukan tombol pembagian', async ({ page, browser }) => {
    await freshUser(page, 'Own3 ' + stamp)
    const url = await manualBill(page, 'Belum gabung ' + stamp, 30000)
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const guest = await ctx.newPage()
    await guest.goto(url)
    await expect(guest.getByRole('button', { name: /Ikut bill ini|Gabung/ })).toBeVisible({ timeout: 20000 })
    await expect(guest.getByText(/Kamu belum masuk bill ini/i)).toBeVisible()
    await ctx.close()
  })

  test('B23. pemilik menandai lunas, tamu melihat status lunas', async ({ page, browser }) => {
    await freshUser(page, 'Own4 ' + stamp)
    const url = await manualBill(page, 'Lunas tamu ' + stamp, 28000)
    const { ctx, guest } = await joinAsGuest(browser, url, 'TamuL ' + stamp)
    await guest.getByRole('button', { name: /Nasi goreng, ketuk untuk memilih/ }).click()
    await guest.waitForTimeout(1200)

    await page.goto(url)
    await page.waitForTimeout(1000)
    await page.getByRole('button', { name: 'Aksi lain' }).click()
    await page.getByRole('dialog').getByRole('button', { name: /Tandai semua lunas/ }).click()
    await page.waitForTimeout(1500)

    await guest.reload()
    await guest.waitForTimeout(1500)
    await expect(guest.getByText(/Lunas/i).first()).toBeVisible({ timeout: 20000 })
    await ctx.close()
  })
})

test.describe('Kotak hitam — beranda dan rekap', () => {
  test('B24. pencarian bill menyaring daftar dan bisa dibersihkan', async ({ page }) => {
    await freshUser(page, 'Cari ' + stamp)
    await manualBill(page, 'Alpha ' + stamp, 11000)
    await manualBill(page, 'Beta ' + stamp, 22000)

    await page.goto('/')
    const search = page.getByLabel('Cari bill')
    await search.fill('Alpha')
    await expect(page.getByText('Alpha ' + stamp)).toBeVisible({ timeout: 15000 })
    await expect(page.getByText('Beta ' + stamp)).toHaveCount(0)
    await page.getByLabel('Hapus pencarian').click()
    await expect(page.getByText('Beta ' + stamp)).toBeVisible({ timeout: 15000 })
  })

  test('B25. rekap awal menjelaskan tidak ada yang perlu diurus', async ({ page }) => {
    await freshUser(page, 'Rekap ' + stamp)
    await page.goto('/recap')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20000 })
    await expect(page.locator('body')).toContainText(/tidak ada yang perlu|belum ada|Bersih/i)
  })

  test('B26. setelah tamu memilih, rekap pemilik memuat kewajiban itu', async ({ page, browser }) => {
    await freshUser(page, 'Own5 ' + stamp)
    const url = await manualBill(page, 'Rekap jalan ' + stamp, 60000)
    const { ctx, guest } = await joinAsGuest(browser, url, 'TamuR ' + stamp)
    await guest.getByRole('button', { name: /Nasi goreng, ketuk untuk memilih/ }).click()
    await guest.waitForTimeout(1500)

    await page.goto('/recap')
    await page.waitForTimeout(1500)
    const text = await page.locator('body').innerText()
    expect(text).toMatch(/Rp60\.000|Rp 60\.000|60\.000/)
    await ctx.close()
  })
})

test.describe('Kotak hitam — pengaturan', () => {
  test('B27. ganti nama memperbarui sapaan di beranda', async ({ page }) => {
    const oldName = 'Lama ' + stamp
    await freshUser(page, oldName)
    await page.goto('/settings')
    const nameField = page.locator('#settings-name')
    await expect(nameField).toBeVisible({ timeout: 20000 })
    await nameField.fill('Baru ' + stamp)
    await page.getByRole('button', { name: /Simpan/ }).first().click()
    await page.waitForTimeout(1500)
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Baru ' + stamp, { timeout: 20000 })
  })

  test('B28. nama kosong tidak menghapus identitas', async ({ page }) => {
    await freshUser(page, 'Tetap ' + stamp)
    await page.goto('/settings')
    const nameField = page.locator('#settings-name')
    await expect(nameField).toBeVisible({ timeout: 20000 })
    await nameField.fill('')
    const save = page.getByRole('button', { name: /Simpan/ }).first()
    if (await save.isEnabled()) await save.click()
    await page.waitForTimeout(1200)
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Tetap ' + stamp, { timeout: 20000 })
  })

  test('B29. menambah rekening lalu muncul sebagai tujuan transfer di bill', async ({ page }) => {
    await freshUser(page, 'Rek ' + stamp)
    const url = await manualBill(page, 'Rekening ' + stamp, 35000)
    await page.goto('/settings')
    await expect(page.getByText('Rekening untuk ditransfer')).toBeVisible({ timeout: 20000 })
    await page.getByLabel('Bank atau e-wallet').fill('BCA')
    await page.getByLabel('Nomor').fill('1234567890')
    await page.getByLabel('Nama pemilik (opsional)').fill('Aufa ' + stamp)
    await page.getByRole('button', { name: /Tambah|Simpan/ }).last().click()
    await page.waitForTimeout(1500)
    await page.goto(url)
    await page.waitForTimeout(1200)
    await expect(page.locator('body')).toContainText(/1234567890|BCA/, { timeout: 20000 })
  })

  test('B30. toggle terima undangan otomatis tersimpan setelah reload', async ({ page }) => {
    await freshUser(page, 'Toggle ' + stamp)
    await page.goto('/settings')
    const toggle = page.getByLabel('Terima undangan otomatis')
    await expect(toggle).toBeVisible({ timeout: 20000 })
    const before = await toggle.isChecked()
    await toggle.click()
    await page.waitForTimeout(1200)
    await page.reload()
    await page.waitForTimeout(1500)
    const after = await page.getByLabel('Terima undangan otomatis').isChecked()
    expect(after).toBe(!before)
  })
})
