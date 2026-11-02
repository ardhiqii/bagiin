/**
 * Kotak hitam, gelombang kedelapan: uang — pajak, service, diskon, dan
 * mengeluarkan orang yang sudah bergabung.
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

/** Isi form Buat bill dan kembalikan teks total yang terlihat di layar. */
async function fillBill(page: Page, opts: {
  title: string
  price: number
  tax?: string
  service?: string
  discount?: string
  taxIncluded?: boolean
}) {
  await page.goto('/create')
  await expect(page.locator('#bill-title')).toBeVisible({ timeout: 20000 })
  await page.locator('#bill-title').fill(opts.title)
  await page.locator('#item-name-0').fill('Nasi goreng')
  await page.locator('#item-price-0').fill(String(opts.price))
  if (opts.tax !== undefined) await page.locator('#bill-tax').fill(opts.tax)
  if (opts.service !== undefined) await page.locator('#bill-service').fill(opts.service)
  if (opts.discount !== undefined) await page.locator('#bill-discount').fill(opts.discount)
  if (opts.taxIncluded) {
    const toggle = page.getByRole('checkbox', { name: /termasuk pajak/i })
    if (await toggle.count()) await toggle.check()
  }
  await page.waitForTimeout(600)
  return (await page.locator('body').innerText()).replace(/\n/g, ' ')
}

async function submit(page: Page) {
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

test.describe('Kotak hitam — pajak, service, diskon', () => {
  test('B67. pajak dan service ditambahkan, diskon dikurangkan', async ({ page }) => {
    await freshUser(page, 'Pajak ' + stamp)
    const text = await fillBill(page, {
      title: 'Uang ' + stamp, price: 100000, tax: '10000', service: '5000', discount: '3000',
    })
    // 100.000 + 10.000 + 5.000 - 3.000 = 112.000
    expect(text).toMatch(/112\.000/)
    await submit(page)
    await expect(page.locator('body')).toContainText(/112\.000/)
  })

  test('B68. "termasuk pajak": total tidak bertambah lagi', async ({ page }) => {
    await freshUser(page, 'Termasuk2 ' + stamp)
    const text = await fillBill(page, {
      title: 'Termasuk ' + stamp, price: 100000, tax: '11000', taxIncluded: true,
    })
    expect(text).toMatch(/100\.000/)
    expect(text).not.toMatch(/111\.000/)
  })

  test('B69. diskon lebih besar dari tagihan tidak membuat angka minus', async ({ page }) => {
    await freshUser(page, 'Diskon2 ' + stamp)
    const text = await fillBill(page, {
      title: 'Diskon ' + stamp, price: 20000, discount: '90000',
    })
    // tidak ada total minus, dan alasannya disebut
    expect(text).not.toMatch(/Rp-/)
    expect(text).toMatch(/melebihi subtotal/i)
    // tombol simpan mati selama angkanya mustahil, dengan alasan yang sama
    await expect(page.getByRole('button', { name: 'Buat bill' })).toBeDisabled()
    const reason = page.getByText(/Diskonnya lebih besar dari total bill|melebihi subtotal/i).first()
    await expect(reason).toBeVisible({ timeout: 10000 })

    // diperbaiki sedikit saja: bisa disimpan, dan totalnya masuk akal
    await page.locator('#bill-discount').fill('5000')
    await page.waitForTimeout(500)
    await expect(page.getByRole('button', { name: 'Buat bill' })).toBeEnabled()
    await page.getByRole('button', { name: 'Buat bill' }).click()
    await expect(page).toHaveURL(/\/b\//, { timeout: 20000 })
    await expect(page.locator('body')).toContainText(/15\.000/)
  })
})

test.describe('Kotak hitam — mengeluarkan orang', () => {
  test('B70. pemilik mengeluarkan tamu yang sudah bergabung', async ({ page, browser }) => {
    await freshUser(page, 'Keluarkan ' + stamp)
    await page.goto('/create')
    await expect(page.locator('#bill-title')).toBeVisible({ timeout: 20000 })
    await page.locator('#bill-title').fill('Bill keluarkan ' + stamp)
    await page.locator('#item-name-0').fill('Nasi goreng')
    await page.locator('#item-price-0').fill('48000')
    const url = await submit(page)

    const tamu = 'Tamu Keluar ' + stamp
    const { ctx, guest } = await joinAsGuest(browser, url, tamu)
    await guest.getByRole('button', { name: /Nasi goreng, ketuk untuk memilih/ }).click()
    await guest.waitForTimeout(1500)

    await page.goto(url)
    await page.waitForTimeout(1500)
    const buang = page.getByRole('button', { name: 'Keluarkan ' + tamu })
    await expect(buang).toBeVisible({ timeout: 20000 })
    await buang.click()
    await page.waitForTimeout(2500)
    await page.reload()
    await page.waitForTimeout(1500)
    await expect(page.getByText(tamu)).toHaveCount(0, { timeout: 15000 })
    // kembali belum dibagi: ada bagian yang belum diambil
    await expect(page.locator('body')).toContainText(/48\.000/)

    // tamu yang dikeluarkan membuka tautan lagi: harusnya ikut ulang sebagai peserta baru
    await guest.reload()
    await guest.waitForTimeout(2000)
    const body = await guest.locator('body').innerText()
    expect(body).not.toMatch(/Something went wrong|Unexpected/i)
    await ctx.close()
  })
})
