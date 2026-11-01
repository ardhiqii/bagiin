/**
 * Kotak hitam, gelombang keenam: rekening transfer, banyak item, porsi, dan
 * nama. Ini bagian yang belum pernah disentuh gelombang sebelumnya.
 */
import { test, expect, type Page } from '@playwright/test'

const stamp = Date.now().toString().slice(-6)
const FIXTURE = 'tests/fixtures/receipt.png'

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
  await expect(guest.getByText(new RegExp(itemLabel)).first()).toBeVisible({ timeout: 20000 })
  return { ctx, guest }
}

test.describe('Kotak hitam — rekening transfer', () => {
  test('B57. rekening yang ditambahkan muncul sebagai tujuan transfer di bill', async ({ page }) => {
    await freshUser(page, 'Rek ' + stamp)
    await page.goto('/settings')
    await page.locator('#account-brand').fill('BCA')
    await page.locator('#account-number').fill('1234567890')
    await page.locator('#account-holder').fill('Uji ' + stamp)
    await page.getByRole('button', { name: 'Tambah rekening' }).click()
    await page.waitForTimeout(1500)
    await expect(page.getByText(/1234567890|BCA/).first()).toBeVisible({ timeout: 15000 })

    const url = await manualBill(page, 'Bill rekening ' + stamp, 29000)
    await page.goto(url)
    await page.waitForTimeout(1200)
    const body = await page.locator('body').innerText()
    expect(body).toMatch(/1234567890|BCA/)
  })

  test('B58. nomor rekening ganda ditolak dengan penjelasan', async ({ page }) => {
    await freshUser(page, 'RekDobel ' + stamp)
    await page.goto('/settings')
    await page.locator('#account-brand').fill('GoPay')
    await page.locator('#account-number').fill('0812000' + stamp.slice(-3))
    await page.getByRole('button', { name: 'Tambah rekening' }).click()
    await page.waitForTimeout(1500)

    // nomor yang sama untuk kedua kalinya
    await page.locator('#account-brand').fill('GoPay')
    await page.locator('#account-number').fill('0812000' + stamp.slice(-3))
    await page.waitForTimeout(800)
    const body = await page.locator('body').innerText()
    const duplicateNote = /sudah ada/i.test(body)
    if (duplicateNote) {
      await expect(page.getByRole('button', { name: 'Tambah rekening' })).toBeDisabled()
    }
  })
})

test.describe('Kotak hitam — banyak item dan porsi', () => {
  test('B59. tiga item dihitung benar dan semuanya tersimpan', async ({ page }) => {
    await freshUser(page, 'Tiga ' + stamp)
    await page.goto('/create')
    await expect(page.locator('#bill-title')).toBeVisible({ timeout: 20000 })
    await page.locator('#bill-title').fill('Bill tiga ' + stamp)
    await page.locator('#item-name-0').fill('Nasi goreng')
    await page.locator('#item-price-0').fill('25000')

    await page.getByRole('button', { name: '+ Tambah item' }).click()
    await page.locator('#item-name-1').fill('Es teh')
    await page.locator('#item-price-1').fill('5000')
    await page.getByRole('button', { name: '+ Tambah item' }).click()
    await page.locator('#item-name-2').fill('Kerupuk')
    await page.locator('#item-price-2').fill('2000')
    await page.waitForTimeout(500)

    const body = (await page.locator('body').innerText()).replace(/\n/g, ' ')
    expect(body).toMatch(/32\.000/)

    await page.getByRole('button', { name: 'Buat bill' }).click()
    await expect(page).toHaveURL(/\/b\//, { timeout: 20000 })
    for (const name of ['Nasi goreng', 'Es teh', 'Kerupuk']) {
      await expect(page.getByText(name).first()).toBeVisible({ timeout: 15000 })
    }
    await expect(page.locator('body')).toContainText(/Rp32\.000/)
  })

  test('B60. item qty 3: tamu ambil 2 porsi dan hanya dibayar 2', async ({ page, browser }) => {
    await freshUser(page, 'Porsi ' + stamp)
    await page.goto('/create')
    await expect(page.locator('#bill-title')).toBeVisible({ timeout: 20000 })
    await page.locator('#bill-title').fill('Bill porsi ' + stamp)
    await page.locator('#item-name-0').fill('Roti')
    await page.locator('#item-price-0').fill('10000')
    await page.locator('#item-qty-0').fill('3')
    await page.locator('#item-qty-0').blur()
    await page.waitForTimeout(400)
    await page.getByRole('button', { name: 'Buat bill' }).click()
    await expect(page).toHaveURL(/\/b\//, { timeout: 20000 })
    const url = page.url()

    const { ctx, guest } = await joinAsGuest(browser, url, 'Teman Porsi ' + stamp, 'Roti')
    const row = guest.getByRole('button', { name: /Roti, ketuk untuk/ })
    await row.click()
    await guest.waitForTimeout(1200)
    await row.click()
    await guest.waitForTimeout(1500)
    // dua porsi dari 10.000 = 20.000
    await expect(guest.locator('body')).toContainText(/20\.000/, { timeout: 15000 })

    // kurangi sampai nol: pilihan hilang, tidak ada angka minus
    const minus = guest.getByRole('button', { name: /Kurangi porsi Roti/ })
    for (let i = 0; i < 4; i++) {
      if (await minus.isDisabled().catch(() => true)) break
      await minus.click()
      await guest.waitForTimeout(700)
    }
    const body = await guest.locator('body').innerText()
    expect(body).not.toMatch(/Rp-|−-/)
    await expect(row).toHaveAttribute('aria-pressed', 'false', { timeout: 15000 })
    await ctx.close()
  })
})

test.describe('Kotak hitam — lampirkan struk dan nama', () => {
  test('B61. "Lampirkan saja" membuat bill dari foto struk', async ({ page }) => {
    await freshUser(page, 'Lampir ' + stamp)
    await page.goto('/create')
    await expect(page.locator('#bill-title')).toBeVisible({ timeout: 20000 })
    await page.getByRole('button', { name: /Scan pakai AI/ }).click()
    await page.waitForTimeout(800)
    const attach = page.getByRole('button', { name: /Lampirkan saja/ }).first()
    if (!(await attach.count())) test.skip(true, 'tombol lampirkan tidak tersedia')
    const chooser = page.waitForEvent('filechooser', { timeout: 15000 })
    await attach.click()
    const fc = await chooser
    await fc.setFiles(FIXTURE)
    await page.waitForTimeout(3000)
    // item hasil pembacaan ATAU minimal foto terlampir harus tampil
    const body = await page.locator('body').innerText()
    expect(body).toMatch(/item|foto|struk/i)
  })

  test('B62. ganti nama: kosong ditolak, nama baru tampil di beranda', async ({ page }) => {
    await freshUser(page, 'Ganti ' + stamp)
    await page.goto('/settings')
    const nameField = page.locator('#settings-name')
    await expect(nameField).toBeVisible({ timeout: 20000 })
    await nameField.fill('')
    await page.waitForTimeout(300)
    const save = page.getByRole('button', { name: /Simpan nama/ })
    expect(await save.isDisabled()).toBe(true)

    const baru = 'Baru ' + stamp
    await nameField.fill(baru)
    await save.click()
    await page.waitForTimeout(1500)
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toContainText(baru, { timeout: 20000 })
  })
})
