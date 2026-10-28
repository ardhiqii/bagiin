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

test.describe('Bagiin — foto struk setelah bill jadi', () => {
  test('43. tambah dan hapus foto struk di bill yang sudah ada', async ({ page }) => {
    await freshUser(page, 'Aufa')
    await page.goto('/create')
    await page.getByLabel('Nama bill').fill('Foto ' + stamp)
    await page.getByLabel('Item 1').fill('Nasi uduk')
    await page.getByLabel('Harga satuan').first().fill('18000')
    // Tunggu aplikasi menyatakan siap, jangan menebak lewat jeda: tombol ini
    // mati selama identitas belum siap, dan klik ke tombol mati hilang tanpa
    // jejak — di mesin lambat itu terbaca sebagai "aplikasi tidak berpindah".
    await expect(page.getByRole('button', { name: 'Buat bill' })).toBeEnabled()
    await page.getByRole('button', { name: 'Buat bill' }).click()
    await expect(page).toHaveURL(/\/b\//)

    await expect(page.getByText('Belum ada foto. Struk bisa kamu simpan di sini supaya bisa dicek lagi nanti.')).toBeVisible()

    await page.locator('input[type="file"]').setInputFiles('tests/fixtures/receipt.png')
    await expect(page.getByText('Foto ditambahkan')).toBeVisible({ timeout: 20_000 })

    const photo = page.getByAltText('Foto struk bill').first()
    await expect(photo).toBeVisible()
    const src = await photo.getAttribute('src')
    expect((await page.request.get(src as string)).status()).toBe(200)

    // hapus: kembali ke keadaan kosong
    await page.getByRole('button', { name: /Hapus foto/ }).first().click()
    await expect(page.getByText('Foto dihapus')).toBeVisible()
    await expect(page.getByText('Belum ada foto. Struk bisa kamu simpan di sini supaya bisa dicek lagi nanti.')).toBeVisible()

    // setelah reload bill benar-benar tidak lagi menampilkan foto itu
    await page.reload()
    await expect(page.getByAltText('Foto struk bill')).toHaveCount(0)
  })
})
