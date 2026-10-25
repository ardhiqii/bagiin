import { test, expect, type Page } from '@playwright/test'

const stamp = Date.now().toString().slice(-6)

async function freshUser(page: Page, name: string) {
  await page.goto('/')
  if (await page.getByText('Kenalan dulu').count()) {
    await page.getByLabel('Nama kamu').fill(name)
    await page.getByRole('button', { name: 'Simpan nama' }).click()
    await expect(page.getByRole('heading', { level: 1 })).toContainText(name)
  }
}

async function addAccount(page: Page, brand: string, number: string, holder: string) {
  await page.goto('/settings')
  await page.getByLabel('Bank atau e-wallet').fill(brand)
  await page.getByLabel('Nomor', { exact: true }).fill(number)
  await page.getByLabel('Nama pemilik (opsional)').fill(holder)
  await page.getByRole('button', { name: 'Tambah rekening' }).click()
  await expect(page.getByText('Rekening ditambahkan')).toBeVisible()
}

test.describe('Bagiin — rekening dan undangan', () => {
  test('30. rekening bisa ditambah, diubah, dan dihapus', async ({ page }) => {
    await freshUser(page, 'Aufa')
    await addAccount(page, 'BCA', '1234567890', 'Aufa Fauqi')

    await expect(page.getByText('BCA', { exact: true })).toBeVisible()
    await expect(page.getByText('1234567890')).toBeVisible()

    // ubah nomor
    await page.getByRole('button', { name: 'Ubah' }).click()
    await expect(page.getByRole('button', { name: 'Simpan perubahan' })).toBeVisible()
    await page.getByLabel('Nomor', { exact: true }).fill('9876543210')
    await page.getByRole('button', { name: 'Simpan perubahan' }).click()
    await expect(page.getByText('Rekening diperbarui')).toBeVisible()
    await expect(page.getByText('9876543210')).toBeVisible()

    // hapus
    await page.getByRole('button', { name: 'Hapus', exact: true }).click()
    await expect(page.getByText('Rekening dihapus')).toBeVisible()
    await expect(page.getByText('9876543210')).toHaveCount(0)
  })

  test('31. rekening pembayar terlihat oleh orang lain di layar bill', async ({ page, browser }) => {
    await freshUser(page, 'Aufa')
    await addAccount(page, 'GoPay', '081234567890', 'Aufa Fauqi')

    await page.goto('/create')
    await page.getByLabel('Nama bill').fill('Transfer ' + stamp)
    await page.getByLabel('Item 1').fill('Bakso')
    await page.getByLabel('Harga satuan').fill('25000')
    await page.getByRole('button', { name: 'Buat bill' }).click()
    await expect(page).toHaveURL(/\/b\//)
    const url = page.url()

    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const guest = await ctx.newPage()
    await freshUser(guest, 'Bima')
    await guest.goto(url)
    await guest.getByRole('button', { name: 'Ikut bill ini' }).click()

    await expect(guest.getByText('Transfer ke Aufa')).toBeVisible()
    await expect(guest.getByText('GoPay')).toBeVisible()
    await expect(guest.getByText('081234567890')).toBeVisible()
    await ctx.close()
  })

  test('32. mematikan terima-otomatis membuat undangan menunggu', async ({ page, browser }) => {
    await freshUser(page, 'Aufa')
    // bikin kontak dulu: satu bill bareng
    await page.goto('/create')
    await page.getByLabel('Nama bill').fill('Kenalan ' + stamp)
    await page.getByLabel('Item 1').fill('Kopi')
    await page.getByLabel('Harga satuan').fill('15000')
    await page.getByRole('button', { name: 'Buat bill' }).click()
    await expect(page).toHaveURL(/\/b\//)
    const firstUrl = page.url()

    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const guest = await ctx.newPage()
    await freshUser(guest, 'Bima')
    await guest.goto(firstUrl)
    await guest.getByRole('button', { name: 'Ikut bill ini' }).click()

    // matikan auto accept dari pengaturan
    await guest.goto('/settings')
    const toggle = guest.getByRole('switch', { name: 'Terima undangan otomatis' })
    await expect(toggle).toBeChecked()
    await toggle.uncheck()
    await expect(guest.getByText('Undangan harus kamu setujui dulu')).toBeVisible()

    // undang Bima ke bill baru
    await page.goto('/create')
    await page.getByLabel('Nama bill').fill('Undang kedua ' + stamp)
    await page.getByLabel('Item 1').fill('Sate')
    await page.getByLabel('Harga satuan').fill('20000')
    await page.getByRole('button', { name: 'Buat bill' }).click()
    await expect(page).toHaveURL(/\/b\//)

    await page.getByRole('button', { name: 'Undang teman' }).click()
    await page.getByRole('button', { name: 'Undang', exact: true }).first().click()
    await expect(page.getByText(/Undangan dikirim ke Bima/)).toBeVisible()

    await page.reload()
    await expect(page.getByText('Undangan menunggu')).toBeVisible()
    await ctx.close()
  })
})
