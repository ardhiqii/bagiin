import { test, expect, type Page } from '@playwright/test'

/** Aksi sekunder sekarang ada di sheet 'Aksi lain' supaya layar bill tidak penuh tombol. */
async function openActions(screen: any) {
  await screen.getByRole('button', { name: 'Aksi lain' }).click()
  await screen.waitForTimeout(150)
}

const stamp = Date.now().toString().slice(-6)

async function freshUser(page: Page, name: string) {
  await page.goto('/')
  if (await page.getByRole('button', { name: 'Mulai pakai Bagiin' }).count()) {
    await page.getByLabel('Nama kamu').fill(name)
    await page.getByRole('button', { name: 'Mulai pakai Bagiin' }).click()
  }
  await expect(page.getByRole('heading', { level: 1 })).toContainText(name)
}

async function createBill(page: Page, title: string, item: string) {
  await page.goto('/create')
  await page.getByLabel('Nama bill').fill(title)
  await page.getByLabel('Item 1').fill(item)
  await page.getByLabel('Harga satuan').first().fill('20000')
  await page.getByRole('button', { name: 'Buat bill' }).click()
  await expect(page).toHaveURL(/\/b\//)
}

test.describe('Bagiin — mencari dan menyaring bill', () => {
  test('41. cari bill dan saring yang sudah lunas', async ({ page }) => {
    await freshUser(page, 'Aufa')
    await createBill(page, 'Sate ' + stamp, 'Sate ayam')
    await createBill(page, 'Bakso ' + stamp, 'Bakso')
    await createBill(page, 'Nasi ' + stamp, 'Nasi goreng')

    await page.goto('/bills')
    await expect(page.getByText('Sate ' + stamp)).toBeVisible()
    await expect(page.getByText('Bakso ' + stamp)).toBeVisible()

    // cari: menyempit ke satu bill
    await page.getByLabel('Cari bill').fill('bakso')
    await expect(page.getByText('Bakso ' + stamp)).toBeVisible()
    await expect(page.getByText('Sate ' + stamp)).toHaveCount(0)

    // pencarian yang tidak ketemu: ada pesan, bukan layar kosong
    await page.getByLabel('Cari bill').fill('tidak ada')
    await expect(page.getByText('Tidak ada bill yang cocok dengan pencarian itu.')).toBeVisible()

    // bersihkan pencarian, lalu saring lunas
    await page.getByLabel('Cari bill').fill('')
    await page.getByRole('button', { name: 'Lunas', exact: true }).click()
    await expect(page.getByText('Sate ' + stamp)).toHaveCount(0)

    await page.getByRole('button', { name: 'Belum selesai', exact: true }).click()
    await expect(page.getByText('Sate ' + stamp)).toBeVisible()
  })

  test('42. bill yang ditandai lunas pindah ke saringan Lunas', async ({ page }) => {
    await freshUser(page, 'Aufa')
    await createBill(page, 'Lunas filter ' + stamp, 'Mie')

    await openActions(page)

    await page.getByRole('button', { name: 'Tandai semua lunas' }).first().click()
    await openActions(page)
    await expect(page.getByRole('button', { name: 'Batalkan lunas seluruh bill' })).toBeVisible()

    await page.goto('/bills')
    await page.getByRole('button', { name: 'Lunas', exact: true }).click()
    await expect(page.getByText('Lunas filter ' + stamp)).toBeVisible()

    await page.getByRole('button', { name: 'Belum selesai', exact: true }).click()
    await expect(page.getByText('Lunas filter ' + stamp)).toHaveCount(0)
  })
})
