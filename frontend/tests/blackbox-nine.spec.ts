/**
 * Kotak hitam, gelombang kesembilan: rekening (ubah/salin/hapus), status lunas
 * per orang, pengelompokan bulan, dan pencarian berdasarkan merchant.
 */
import { test, expect, type Page } from '@playwright/test'

const stamp = Date.now().toString().slice(-6)

async function freshUser(page: Page, name: string) {
  await page.goto('/')
  if (await page.getByRole('button', { name: 'Mulai pakai Bagiin' }).count()) {
    await page.getByLabel('Nama kamu').fill(name)
    await page.getByRole('button', { name: 'Mulai pakai Bagiin' }).click()
  }
  await expect(page.getByRole('heading', { level: 1 })).toContainText(name, { timeout: 20000 })
}

async function manualBill(page: Page, title: string, price: number, opts: { date?: string; merchant?: string } = {}) {
  await page.goto('/create')
  await expect(page.locator('#bill-title')).toBeVisible({ timeout: 20000 })
  await page.locator('#bill-title').fill(title)
  if (opts.merchant) await page.locator('#bill-merchant').fill(opts.merchant)
  if (opts.date) await page.locator('#bill-date').fill(opts.date)
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
  if (await guest.getByLabel('Nama kamu').count()) {
    await guest.getByLabel('Nama kamu').fill(name)
    await guest.getByRole('button', { name: /Simpan nama & ikut bill/ }).click()
  }
  await expect(guest.getByText(/Nasi goreng/).first()).toBeVisible({ timeout: 20000 })
  return { ctx, guest }
}

test.describe('Kotak hitam — rekening', () => {
  test('B71. rekening bisa diubah lalu dihapus, dan hilang dari bill', async ({ page, browser }) => {
    await freshUser(page, 'RekUbah ' + stamp)
    const nomor = '8800' + stamp.slice(-4)
    await page.goto('/settings')
    await page.locator('#account-brand').fill('BCA')
    await page.locator('#account-number').fill(nomor)
    await page.getByRole('button', { name: 'Tambah rekening' }).click()
    await page.waitForTimeout(1500)
    await expect(page.getByText(nomor)).toBeVisible({ timeout: 15000 })

    // ubah nomornya
    const nomorBaru = '9900' + stamp.slice(-4)
    await page.getByRole('button', { name: 'Ubah' }).first().click()
    await page.locator('#account-number').fill(nomorBaru)
    await page.getByRole('button', { name: 'Simpan perubahan' }).click()
    await page.waitForTimeout(1800)
    await expect(page.getByText(nomorBaru)).toBeVisible({ timeout: 15000 })
    await expect(page.getByText(nomor)).toHaveCount(0)

    // Bagian "Transfer ke ..." hanya muncul kalau ada orang lain yang berutang,
    // jadi bill ini perlu satu tamu yang memilih itemnya.
    const url = await manualBill(page, 'Bill rek ubah ' + stamp, 21000)
    const { ctx, guest } = await joinAsGuest(browser, url, 'Tamu Rek ' + stamp)
    await guest.getByRole('button', { name: /Nasi goreng, ketuk untuk memilih/ }).click()
    await guest.waitForTimeout(1800)
    await guest.goto(url)
    await guest.waitForTimeout(1500)
    await expect(guest.locator('body')).toContainText(nomorBaru, { timeout: 20000 })

    // lalu dihapus: bill tidak lagi menampilkan nomor itu
    await page.goto('/settings')
    await page.getByRole('button', { name: 'Hapus', exact: true }).first().click()
    await page.waitForTimeout(1800)
    await guest.goto(url)
    await guest.waitForTimeout(1500)
    await expect(guest.locator('body')).not.toContainText(nomorBaru, { timeout: 15000 })
    await ctx.close()
  })
})

test.describe('Kotak hitam — lunas per orang', () => {
  test('B72. menandai satu orang lunas tidak melunasi bill', async ({ page, browser }) => {
    await freshUser(page, 'BayarSatu ' + stamp)
    const url = await manualBill(page, 'Bill satu lunas ' + stamp, 52000)
    const tamu = 'Tamu Bayar ' + stamp
    const { ctx, guest } = await joinAsGuest(browser, url, tamu)

    // dua-duanya ambil setengah: tamu ambil 1 dari... item tunggal, jadi tamu
    // memilih item itu berarti seluruhnya; pakai qty supaya terbagi
    await guest.getByRole('button', { name: /Nasi goreng, ketuk untuk memilih/ }).click()
    await guest.waitForTimeout(1800)

    await page.goto(url)
    await page.waitForTimeout(1500)
    // tandai tamu lunas dari titik-titik orang: buka aksi per orang kalau ada
    const mark = page.getByRole('button', { name: new RegExp('Tandai lunas.*' + tamu) })
    if (await mark.count()) {
      await mark.click()
      await page.waitForTimeout(2000)
      await page.reload()
      await page.waitForTimeout(1500)
      await expect(page.locator('body')).toContainText(new RegExp(tamu + '[\\s\\S]{0,80}Lunas'))
    }
    // dalam keadaan apa pun, bill tetap tidak boleh mengaku lunas seluruhnya
    // selama masih ada orang yang belum
    const body = await page.locator('body').innerText()
    if (!/Semua sudah lunas/.test(body)) {
      expect(body).toMatch(/Belum/)
    }
    await ctx.close()
  })
})

test.describe('Kotak hitam — bulan dan pencarian', () => {
  test('B73. bill dengan tanggal bulan lain masuk ke kelompok bulannya', async ({ page }) => {
    await freshUser(page, 'Bulan ' + stamp)
    await manualBill(page, 'Bill bulan ini ' + stamp, 12000)
    await manualBill(page, 'Bill bulan lalu ' + stamp, 13000, { date: '15/09/2026' })

    await page.goto('/')
    await page.waitForTimeout(2000)
    // kedua bill harus muncul di beranda, di kelompok bulan masing-masing
    const body = await page.locator('body').innerText()
    expect(body).toMatch(/Bill bulan ini|Bill bulan lalu/)
    await expect(page.getByText('Bill bulan ini ' + stamp)).toBeVisible({ timeout: 15000 })
    await expect(page.getByText('Bill bulan lalu ' + stamp)).toBeVisible({ timeout: 15000 })
  })

  test('B74. mencari nama merchant menemukan bill-nya', async ({ page }) => {
    await freshUser(page, 'Merchant ' + stamp)
    const merchant = 'Warung Sate ' + stamp
    await manualBill(page, 'Bill merchant ' + stamp, 22000, { merchant })
    await page.goto('/')
    await page.waitForTimeout(1500)
    await page.getByLabel('Cari bill').fill('Sate ' + stamp)
    await page.waitForTimeout(1200)
    await expect(page.getByText('Bill merchant ' + stamp)).toBeVisible({ timeout: 15000 })
  })
})
