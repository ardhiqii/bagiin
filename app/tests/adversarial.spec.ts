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

async function createBill(page: Page, title: string, items: [string, string][]) {
  await page.goto('/create')
  await page.getByLabel('Nama bill').fill(title)
  for (const [index, [name, price]] of items.entries()) {
    if (index > 0) await page.getByRole('button', { name: '+ Tambah item' }).click()
    await page.getByLabel('Item ' + (index + 1)).fill(name)
    await page.getByLabel('Harga satuan').nth(index).fill(price)
  }
  await page.getByRole('button', { name: 'Buat bill' }).click()
  await expect(page).toHaveURL(/\/b\//)
  return page.url()
}

test.describe('Bagiin — keadaan yang berubah di belakang layar', () => {
  test('44. tamu menekan item setelah bill ditutup: pesan jelas, bukan diam', async ({ page, browser }) => {
    await freshUser(page, 'Aufa')
    const url = await createBill(page, 'Tutup ' + stamp, [['Kwetiau', '27000']])

    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const guest = await ctx.newPage()
    await freshUser(guest, 'Bima')
    await guest.goto(url)
    await guest.getByRole('button', { name: 'Ikut bill ini' }).click()

    // pemilik menutup bill, tamu belum tahu
    await page.reload()
    await page.getByRole('button', { name: 'Tutup bill' }).click()
    await expect(page.getByText('Bill ditutup')).toBeVisible()

    await guest.getByRole('button', { name: /Kwetiau, ketuk/ }).click()
    await expect(guest.getByText('Bill sudah ditutup')).toBeVisible({ timeout: 15_000 })

    // state tamu tidak berubah jadi "dipilih"
    await expect(guest.getByRole('button', { name: /Kwetiau, ketuk/ })).toHaveAttribute('aria-pressed', 'false')
    await ctx.close()
  })

  test('45. tamu menekan item setelah bill ditandai lunas', async ({ page, browser }) => {
    await freshUser(page, 'Aufa')
    const url = await createBill(page, 'Lunas2 ' + stamp, [['Bakmi', '31000']])

    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const guest = await ctx.newPage()
    await freshUser(guest, 'Bima')
    await guest.goto(url)
    await guest.getByRole('button', { name: 'Ikut bill ini' }).click()

    await page.reload()
    await page.getByRole('button', { name: 'Tandai semua lunas' }).first().click()
    await expect(page.getByRole('button', { name: 'Batalkan tanda lunas' })).toBeVisible()

    await guest.getByRole('button', { name: /Bakmi, ketuk/ }).click()
    await expect(guest.getByText(/lunas semua|sudah lunas/i).first()).toBeVisible({ timeout: 15_000 })
    await ctx.close()
  })

  test('46. item dihapus pemilik saat sudah dipilih orang lain', async ({ page, browser }) => {
    await freshUser(page, 'Aufa')
    const url = await createBill(page, 'Hapus item ' + stamp, [
      ['Soto', '25000'],
      ['Es teh', '8000'],
    ])

    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const guest = await ctx.newPage()
    await freshUser(guest, 'Bima')
    await guest.goto(url)
    await guest.getByRole('button', { name: 'Ikut bill ini' }).click()
    await guest.getByRole('button', { name: /Soto, ketuk/ }).click()
    await expect(guest.getByText(/bagian kamu Rp25\.000/)).toBeVisible()

    // pemilik menghapus Soto
    await page.reload()
    await page.getByRole('button', { name: 'Ubah bill' }).click()
    await page.getByRole('button', { name: 'Hapus baris 1' }).click()
    await page.getByRole('button', { name: 'Simpan perubahan' }).click()
    await expect(page.getByText('Perubahan bill disimpan')).toBeVisible()

    // tamu reload: tidak ada crash, bagiannya ikut hilang
    await guest.reload()
    await expect(guest.getByText('Soto').first()).toHaveCount(0)
    await expect(guest.getByText(/bagian kamu Rp0/)).toBeVisible()
    await ctx.close()
  })

  test('47. tamu keluar padahal sudah memilih: total pemilik ikut berubah', async ({ page, browser }) => {
    await freshUser(page, 'Aufa')
    const url = await createBill(page, 'Keluar ' + stamp, [['Pecel', '21000']])

    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const guest = await ctx.newPage()
    await freshUser(guest, 'Bima')
    await guest.goto(url)
    await guest.getByRole('button', { name: 'Ikut bill ini' }).click()
    await guest.getByRole('button', { name: /Pecel, ketuk/ }).click()
    await expect(guest.getByText(/bagian kamu Rp21\.000/)).toBeVisible()

    await guest.getByRole('button', { name: 'Keluar dari bill ini' }).click()
    await expect(guest).toHaveURL(/\/$/)

    await page.reload()
    await expect(page.getByText('Bima')).toHaveCount(0)
    await expect(page.getByText(/bagian kamu Rp21\.000/)).toBeVisible()
    await ctx.close()
  })

  test('48. tautan bill yang tidak ada: pesan jelas dan bisa kembali', async ({ page }) => {
    await freshUser(page, 'Aufa')
    await page.goto('/b/tidak-ada-bill-seperti-ini')
    await expect(page.getByText('Bill tidak bisa dibuka')).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: 'Kembali' }).first().click()
    await expect(page).toHaveURL(/\/$/)
  })
})
