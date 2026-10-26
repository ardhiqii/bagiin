import { test, expect, type Page } from '@playwright/test'

const stamp = Date.now().toString().slice(-6)

async function freshUser(page: Page, name: string) {
  await page.goto('/')
  if (await page.getByRole('button', { name: 'Mulai pakai Bagiin' }).count()) {
    await page.getByLabel('Nama kamu').fill(name)
    await page.getByRole('button', { name: 'Mulai pakai Bagiin' }).click()
  }
  await expect(page.getByRole('heading', { level: 1 })).toContainText(name)
}

test.describe('Bagiin — baca struk dari foto', () => {
  test('36. foto struk terbaca, angkanya masuk ke form, foto ikut tersimpan', async ({ page }) => {
    await freshUser(page, 'Aufa')
    await page.goto('/create')

    // OCR bergantung layanan luar: beri waktu, dan coba sekali lagi kalau
    // percobaan pertama kena batas laju dari server
    const note = page.getByText('Struk terbaca. Cek lagi angkanya ya.')
    const input = page.locator('input[type="file"]')
    await input.setInputFiles('tests/fixtures/receipt.png')
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await expect(note).toBeVisible({ timeout: 45_000 })
        break
      } catch (err) {
        if (attempt === 1) throw err
        await page.waitForTimeout(15_000)
        await input.setInputFiles('tests/fixtures/receipt.png')
      }
    }
    await expect(page.getByLabel('Merchant (opsional)')).toHaveValue('WARTEG BAHARI')
    await expect(page.getByLabel('Item 1')).toHaveValue('Nasi goreng')
    await expect(page.getByLabel('Item 2')).toHaveValue('Es teh manis')
    await expect(page.getByLabel('Item 3')).toHaveValue('Ayam bakar')
    await expect(page.getByLabel('Harga satuan').first()).toHaveValue('45.000')
    await expect(page.getByLabel('Pajak')).toHaveValue('8.800')
    await expect(page.getByText('Rp96.800').first()).toBeVisible()

    // foto sudah diunggah dan akan menempel di bill
    await expect(page.getByAltText('Foto struk yang dibaca')).toBeVisible()

    await page.getByLabel('Nama bill').fill('Struk ' + stamp)
    await page.getByRole('button', { name: 'Buat bill' }).click()
    await expect(page).toHaveURL(/\/b\//)
    await expect(page.getByText('Rp96.800').first()).toBeVisible()

    // foto benar-benar bisa dibuka dari layar bill
    await expect(page.getByText('Foto struk')).toBeVisible()
    const photo = page.getByAltText('Foto struk bill').first()
    await expect(photo).toBeVisible()
    const src = await photo.getAttribute('src')
    expect(src).toContain('/uploads/')
    const response = await page.request.get(src as string)
    expect(response.status()).toBe(200)
  })
})
