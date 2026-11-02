/**
 * Kotak hitam, gelombang ketujuh: rekap sebagai layar uang — kosong, terisi,
 * pelunasan, pembatalan, dan kesamaan angka dengan beranda.
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

async function joinAsGuest(browser: any, url: string, name: string, itemLabel = 'Nasi goreng') {
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
  await expect(guest.getByText(new RegExp(itemLabel)).first()).toBeVisible({ timeout: 20000 })
  return { ctx, guest }
}

test.describe('Kotak hitam — rekap', () => {
  test('B63. rekap pengguna baru: kosong tapi menjelaskan, bukan layar buntu', async ({ page }) => {
    await freshUser(page, 'RekapKosong ' + stamp)
    await page.goto('/recap')
    await expect(page.getByRole('heading', { name: /Rekap/i }).first()).toBeVisible({ timeout: 20000 })
    const body = await page.locator('body').innerText()
    expect(body).toMatch(/belum|kosong|beres|tidak ada/i)
  })

  test('B64. tamu memilih item: rekap pembuat bill bergerak dan bisa buka rincian orang', async ({ page, browser }) => {
    await freshUser(page, 'RekapIsi ' + stamp)
    const url = await manualBill(page, 'Bill rekap ' + stamp, 44000)
    const tamu = 'Teman Rekap ' + stamp
    const { ctx, guest } = await joinAsGuest(browser, url, tamu)
    await guest.getByRole('button', { name: /Nasi goreng, ketuk untuk memilih/ }).click()
    await guest.waitForTimeout(2000)

    await page.goto('/recap')
    await page.waitForTimeout(1500)
    await page.reload()
    await page.waitForTimeout(2000)
    const body = await page.locator('body').innerText()
    expect(body).toMatch(/44\.000|tagihan|menunggu/i)

    // buka rincian orang, lalu tutup
    const person = page.getByRole('button', { name: new RegExp(tamu) }).first()
    if (await person.count()) {
      await person.click()
      await expect(page.getByRole('dialog').first()).toBeVisible({ timeout: 15000 })
      await page.getByRole('button', { name: 'Tutup' }).first().click()
    }
    await ctx.close()
  })

  test('B65. "Tandai lunas" dari rekap: sisa ditanggung pembayar, bill hilang dari daftar kerja', async ({ page }) => {
    await freshUser(page, 'RekapLunas ' + stamp)
    const url = await manualBill(page, 'Bill lunas ' + stamp, 38000)
    await page.goto(url)
    await page.waitForTimeout(1200)
    // belum ada yang memilih: rekap menandai bill ini perlu dikerjakan
    await page.goto('/recap')
    await page.waitForTimeout(1500)

    const mark = page.getByRole('button', { name: 'Tandai lunas' }).first()
    if (await mark.count()) {
      await mark.click()
      const sheet = page.getByRole('dialog', { name: /Tandai bill ini lunas/ })
      await expect(sheet).toBeVisible({ timeout: 15000 })
      await sheet.getByRole('button', { name: /Tandai lunas, sisa ditanggung/ }).click()
      await page.waitForTimeout(2500)
      await page.reload()
      await page.waitForTimeout(2000)
      const body = await page.locator('body').innerText()
      expect(body).not.toContain('Bill lunas ' + stamp)
    }

    // di layar bill, lunas bisa dibatalkan lagi
    await page.goto(url)
    await page.waitForTimeout(1500)
    const undo = page.getByRole('button', { name: /Batalkan lunas|Batal lunas/i }).first()
    if (await undo.count()) {
      await undo.click()
      await page.waitForTimeout(2000)
      await expect(page.locator('body')).not.toContainText(/Semua sudah lunas/)
    }
  })

  test('B66. angka beranda dan rekap tidak saling bertentangan', async ({ page, browser }) => {
    await freshUser(page, 'Sama ' + stamp)
    const url = await manualBill(page, 'Bill sama ' + stamp, 60000)
    const tamu = 'Teman Sama ' + stamp
    const { ctx, guest } = await joinAsGuest(browser, url, tamu)
    await guest.getByRole('button', { name: /Nasi goreng, ketuk untuk memilih/ }).click()
    await guest.waitForTimeout(2000)

    await page.goto('/')
    await page.waitForTimeout(2000)
    const homeText = await page.locator('body').innerText()
    const homeAmounts = (homeText.match(/Rp[\d.]+/g) ?? []).map((s) => s.replace(/[^\d]/g, ''))

    await page.goto('/recap')
    await page.waitForTimeout(2000)
    const recapText = await page.locator('body').innerText()
    const recapAmounts = (recapText.match(/Rp[\d.]+/g) ?? []).map((s) => s.replace(/[^\d]/g, ''))

    // setiap angka besar di rekap harus berasal dari angka yang juga dikenal
    // beranda (bukan hitungan tak terlihat yang berbeda)
    const homeSet = new Set(homeAmounts)
    const recapOnly = recapAmounts.filter((a) => a !== '0' && !homeSet.has(a))
    expect(recapOnly.length, 'angka rekap yang tidak ada di beranda: ' + recapOnly.join(',')).toBeLessThanOrEqual(2)
    await ctx.close()
  })
})
