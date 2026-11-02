/**
 * Kotak hitam, gelombang keempat: akun dan kode pemulihan (pindah perangkat),
 * foto struk di layar bill, alur scan AI yang dibatalkan, dan tombol berbahaya
 * "Mulai dari nol" yang harus bisa dibatalkan.
 */
import { test, expect, type Page } from '@playwright/test'

const stamp = Date.now().toString().slice(-6)
const FIXTURE = 'tests/fixtures/receipt.png'

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

test.describe('Kotak hitam — akun dan pindah perangkat', () => {
  test('B42. masuk dengan akun yang salah memberi pesan, bukan layar rusak', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const page = await ctx.newPage()
    await page.goto('/masuk')
    await page.waitForTimeout(1200)
    await page.getByRole('tab', { name: 'Akun' }).click()
    await page.getByLabel('Username').fill('tidakada_' + stamp)
    await page.getByLabel('Password').fill('salahsekali123')
    await page.getByRole('button', { name: 'Masuk', exact: true }).click()
    await page.waitForTimeout(2000)
    const body = await page.locator('body').innerText()
    expect(body).toMatch(/salah|tidak|gagal|kenal/i)
    await ctx.close()
  })

  test('B43. akun dibuat di Pengaturan bisa dipakai masuk dari perangkat lain', async ({ page, browser }) => {
    const name = 'Akun ' + stamp
    await freshUser(page, name)
    const url = await manualBill(page, 'Bill akun ' + stamp, 27000)

    await page.goto('/settings')
    await page.getByRole('button', { name: /Username/ }).first().click()
    const userSheet = page.getByRole('dialog', { name: 'Username' })
    await expect(userSheet).toBeVisible({ timeout: 15000 })
    await userSheet.getByLabel(/Username baru/).fill('uji' + stamp)
    await userSheet.getByRole('button', { name: /Simpan/ }).click()
    await page.waitForTimeout(1500)

    await page.getByRole('button', { name: /Password/ }).first().click()
    const passSheet = page.getByRole('dialog', { name: /password/i })
    await expect(passSheet).toBeVisible({ timeout: 15000 })
    const fields = passSheet.locator('input[type="password"]')
    await fields.nth(0).fill('rahasia12345')
    if ((await fields.count()) > 1) await fields.nth(1).fill('rahasia12345')
    await passSheet.getByRole('button', { name: /Simpan/ }).click()
    await page.waitForTimeout(1500)

    // perangkat lain: masuk pakai akun itu
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const other = await ctx.newPage()
    await other.goto('/masuk')
    await other.waitForTimeout(1200)
    await other.getByRole('tab', { name: 'Akun' }).click()
    await other.getByLabel('Username').fill('uji' + stamp)
    await other.getByLabel('Password').fill('rahasia12345')
    await other.getByRole('button', { name: 'Masuk', exact: true }).click()
    await expect(other.getByRole('heading', { level: 1 })).toContainText(name, { timeout: 25000 })
    await other.goto('/')
    await expect(other.getByText('Bill akun ' + stamp)).toBeVisible({ timeout: 20000 })
    await ctx.close()
    await expect(page.goto(url)).resolves.toBeTruthy()
  })

  test('B44. kode pemulihan memindahkan akun ke perangkat lain', async ({ page, browser }) => {
    const name = 'Pindah ' + stamp
    await freshUser(page, name)
    const url = await manualBill(page, 'Bill pindah ' + stamp, 31000)

    await page.goto('/settings')
    await page.getByRole('button', { name: /Buat kode pemulihan/ }).click()
    const codeEl = page.locator('.recovery-code code').first()
    await expect(codeEl).toBeVisible({ timeout: 20000 })
    const code = (await codeEl.innerText()).trim()
    expect(code.length).toBeGreaterThan(6)

    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const other = await ctx.newPage()
    await other.goto('/masuk')
    await other.waitForTimeout(1200)
    await other.getByRole('tab', { name: 'Kode' }).click()
    await other.getByLabel('Kode pemulihan').fill(code)
    await other.getByRole('button', { name: /Pulihkan|Masuk|Lanjut/ }).last().click()
    await expect(other.getByRole('heading', { level: 1 })).toContainText(name, { timeout: 25000 })
    await other.goto(url)
    await expect(other.getByText(/Nasi goreng/).first()).toBeVisible({ timeout: 20000 })
    await ctx.close()
  })
})

test.describe('Kotak hitam — foto dan scan', () => {
  test('B45. foto struk bisa ditambahkan, dilihat, lalu dihapus', async ({ page }) => {
    await freshUser(page, 'Foto ' + stamp)
    const url = await manualBill(page, 'Bill foto ' + stamp, 26000)

    await page.setInputFiles('input[type="file"]', FIXTURE)
    const thumb = page.getByAltText('Foto struk bill').first()
    await expect(thumb).toBeVisible({ timeout: 25000 })

    // foto bisa dibuka di penampil
    await page.getByRole('button', { name: /Lihat foto struk 1/ }).click()
    const viewer = page.getByRole('dialog', { name: 'Foto struk' })
    await expect(viewer).toBeVisible({ timeout: 15000 })
    await viewer.getByRole('button', { name: 'Tutup' }).click()
    await expect(viewer).toBeHidden({ timeout: 10000 })

    // lalu dihapus, dan bill kembali ke keadaan tanpa foto
    await page.getByRole('button', { name: /Hapus foto/ }).first().click()
    await page.waitForTimeout(2000)
    await page.goto(url)
    await expect(page.getByText(/Belum ada foto/)).toBeVisible({ timeout: 20000 })
  })

  test('B46. alur scan AI yang dibatalkan tidak mengubah bill', async ({ page }) => {
    await freshUser(page, 'Scan ' + stamp)
    await page.goto('/create')
    await expect(page.locator('#bill-title')).toBeVisible({ timeout: 20000 })
    const before = await page.locator('#bill-title').inputValue()

    await page.getByRole('button', { name: /Scan pakai AI/ }).click()
    await page.waitForTimeout(1200)
    // tutup tanpa memilih apa pun
    const close = page.getByRole('button', { name: 'Tutup' }).first()
    if (await close.count()) await close.click()
    await page.waitForTimeout(800)

    await expect(page.locator('#bill-title')).toHaveValue(before)
    const body = await page.locator('body').innerText()
    expect(body).not.toMatch(/gagal dibaca|error/i)
  })
})

test.describe('Kotak hitam — tombol berbahaya', () => {
  test('B47. "Mulai dari nol" minta konfirmasi dan bisa dibatalkan', async ({ page }) => {
    const name = 'Nol ' + stamp
    await freshUser(page, name)
    await page.goto('/settings')
    const reset = page.getByRole('button', { name: /Mulai dari nol|Hapus identitas/ }).first()
    await expect(reset).toBeVisible({ timeout: 20000 })
    await reset.click()
    await page.waitForTimeout(800)
    // setelah diklik harus ada peringatan + tombol batal
    const cancel = page.getByRole('button', { name: /Batal/ }).first()
    await expect(cancel).toBeVisible({ timeout: 10000 })
    await cancel.click()
    await page.waitForTimeout(800)
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toContainText(name, { timeout: 20000 })
  })
})
