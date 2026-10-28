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

/** Bill satu baris. `qty` = jumlah unit yang dibeli di struk. */
async function createLineBill(
  page: Page,
  title: string,
  price = '60000',
  qty = '1',
  itemName = 'Pizza besar',
) {
  await page.goto('/create')
  await page.getByLabel('Nama bill').fill(title)
  await page.getByLabel('Item 1').fill(itemName)
  await page.getByLabel('Harga satuan').fill(price)
  if (qty !== '1') await page.getByLabel('Qty').first().fill(qty)
  // Tunggu aplikasi menyatakan siap, jangan menebak lewat jeda: tombol ini
    // mati selama identitas belum siap, dan klik ke tombol mati hilang tanpa
    // jejak — di mesin lambat itu terbaca sebagai "aplikasi tidak berpindah".
    await expect(page.getByRole('button', { name: 'Buat bill' })).toBeEnabled()
    await page.getByRole('button', { name: 'Buat bill' }).click()
  await expect(page).toHaveURL(/\/b\//)
  return page.url()
}

test.describe('Bagiin — ambil porsi per baris', () => {
  test('26. satu ketukan = satu porsi, sisa porsi tampil sebagai belum diambil', async ({ page }) => {
    await freshUser(page, 'Aufa')
    // 2 tiket @62.000: dulu satu ketukan langsung menagih 124.000
    await createLineBill(page, 'Tiket ' + stamp, '62000', '2', 'tiket')

    await expect(page.getByText('0 dari 2 diambil')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Tambah porsi tiket' })).toBeVisible()

    await page.getByRole('button', { name: 'Tambah porsi tiket' }).click()
    await expect(page.getByText(/bagian kamu Rp62\.000/)).toBeVisible()
    await expect(page.getByText('1 dari 2 diambil')).toBeVisible()
    await expect(page.getByText(/1 porsi belum diambil/)).toBeVisible()

    await page.getByRole('button', { name: 'Tambah porsi tiket' }).click()
    await expect(page.getByText(/bagian kamu Rp124\.000/)).toBeVisible()
    await expect(page.getByText('2 dari 2 diambil')).toBeVisible()
    await expect(page.getByText(/belum ada yang ambil/)).toHaveCount(0)
  })

  test('27. satu baris dibagi bertiga otomatis, tanpa mengatur apa pun', async ({ page, browser }) => {
    await freshUser(page, 'Aufa')
    const url = await createLineBill(page, 'Pizza bareng ' + stamp)
    // 60.000 untuk satu baris (qty 1) yang dimakan dua orang: cukup diketuk
    await page.getByRole('button', { name: /Pizza besar, ketuk untuk/ }).click()
    await expect(page.getByText(/bagian kamu Rp60\.000/)).toBeVisible()

    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const guest = await ctx.newPage()
    await freshUser(guest, 'Bima')
    await guest.goto(url)
    await guest.getByRole('button', { name: 'Ikut bill ini' }).click()
    await guest.getByRole('button', { name: /Pizza besar, ketuk untuk/ }).click()
    await expect(guest.getByText(/bagian kamu Rp30\.000/)).toBeVisible()

    // halaman pemilik tidak polling: muat ulang untuk melihat bagian terbaru
    await page.reload()
    await expect(page.getByText(/bagian kamu Rp30\.000/)).toBeVisible()
    await expect(guest.getByText(/bagian kamu Rp30\.000/)).toBeVisible()
    await ctx.close()
  })

  test('28. empat orang berbagi tiga gelas, harga turun sendiri', async ({ page, browser }) => {
    await freshUser(page, 'Aufa')
    // 3 gelas x 5.000 = baris 15.000
    const url = await createLineBill(page, 'Es teh ' + stamp, '5000', '3', 'Es teh manis')
    const contexts = []
    for (const name of ['Bima', 'Citra', 'Dewi']) {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
      contexts.push(ctx)
      const guest = await ctx.newPage()
      await freshUser(guest, name)
      await guest.goto(url)
      await guest.getByRole('button', { name: 'Ikut bill ini' }).click()
      await guest.getByRole('button', { name: 'Tambah porsi Es teh manis' }).click()
    }
    // tiga orang pertama masing-masing 5.000; orang keempat membuat baris
    // dibagi 4 -> 3.750, dan itu terjadi sendiri tanpa konfirmasi apa pun
    await page.reload()
    await page.getByRole('button', { name: 'Tambah porsi Es teh manis' }).click()
    await expect(page.getByText(/bagian kamu Rp3\.750/)).toBeVisible()
    await expect(page.getByText(/belum ada yang ambil/)).toHaveCount(0)
    for (const ctx of contexts) await ctx.close()
  })

  test('29. baris yang tidak diambil siapa pun jatuh ke yang menalangi', async ({ page }) => {
    await freshUser(page, 'Aufa')
    await createLineBill(page, 'Tiket kosong ' + stamp, '40000', '2', 'tiket konser')

    await expect(page.getByText(/1 item belum dipilih/)).toBeVisible()
    // yang menalangi menanggung seluruh baris selama belum ada yang mengambil
    await expect(page.getByText(/bagian kamu Rp80\.000/)).toBeVisible()
  })
})
