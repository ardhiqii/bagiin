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

async function createTwoItemBill(page: Page, title: string) {
  await page.goto('/create')
  await page.getByLabel('Nama bill').fill(title)
  await page.getByLabel('Item 1').fill('Nasi goreng')
  await page.getByLabel('Harga satuan').first().fill('20000')
  await page.getByRole('button', { name: '+ Tambah item' }).click()
  await page.getByLabel('Item 2').fill('Ayam bakar')
  await page.getByLabel('Harga satuan').nth(1).fill('30000')
  await page.getByRole('button', { name: 'Buat bill' }).click()
  await expect(page).toHaveURL(/\/b\//)
  return page.url()
}

test.describe('Bagiin — mengubah bill', () => {
  test('33. judul dan pajak bisa diubah, pilihan orang lain tetap', async ({ page, browser }) => {
    await freshUser(page, 'Aufa')
    const url = await createTwoItemBill(page, 'Ubah ' + stamp)

    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const guest = await ctx.newPage()
    await freshUser(guest, 'Bima')
    await guest.goto(url)
    await guest.getByRole('button', { name: 'Ikut bill ini' }).click()
    await guest.getByRole('button', { name: /Ayam bakar, ketuk/ }).click()
    await expect(guest.getByText(/bagian kamu Rp30\.000/)).toBeVisible()

    await page.reload()
    await page.getByRole('button', { name: 'Ubah bill' }).click()
    await expect(page).toHaveURL(/\/edit$/)

    await page.getByLabel('Nama bill').fill('Ubah judul ' + stamp)
    await page.getByLabel('Pajak').fill('5000')
    await expect(page.getByText('Rp55.000')).toBeVisible()
    await page.getByRole('button', { name: 'Simpan perubahan' }).click()

    await expect(page.getByText('Perubahan bill disimpan')).toBeVisible()
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Ubah judul ' + stamp)
    await expect(page.getByText('Rp55.000').first()).toBeVisible()

    // pilihan Bima masih menempel di item yang sama
    await expect(page.getByText(/Ayam bakar/)).toBeVisible()
    await expect(page.getByText(/Bima/).first()).toBeVisible()

    // pajak dibagi proporsional: 30.000 dari 50.000 → 3.000
    await guest.reload()
    await expect(guest.getByText(/bagian kamu Rp33\.000/)).toBeVisible()
    await ctx.close()
  })

  test('34. tamu tidak bisa mengubah bill', async ({ page, browser }) => {
    await freshUser(page, 'Aufa')
    const url = await createTwoItemBill(page, 'Kunci ' + stamp)

    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const guest = await ctx.newPage()
    await freshUser(guest, 'Bima')
    await guest.goto(url)
    await guest.getByRole('button', { name: 'Ikut bill ini' }).click()
    await expect(guest.getByRole('button', { name: 'Ubah bill' })).toHaveCount(0)

    // buka langsung lewat URL pun ditolak dengan pesan, bukan editor kosong
    await guest.goto(url + '/edit')
    await expect(guest.getByText('Hanya yang menalangi bisa mengubah')).toBeVisible()
    await expect(guest.getByRole('button', { name: 'Simpan perubahan' })).toHaveCount(0)
    await ctx.close()
  })

  test('49. ubah daftar nama: ganti yang belum bergabung, kunci yang sudah', async ({ page, browser }) => {
    await freshUser(page, 'Aufa')
    await page.goto('/create')
    await page.getByLabel('Nama bill').fill('Roster edit ' + stamp)
    await page.getByLabel('Item 1').fill('Sate')
    await page.getByLabel('Harga satuan').first().fill('30000')
    for (const person of ['Citra', 'Bima']) {
      await page.getByLabel('Nama teman').fill(person)
      await page.getByRole('button', { name: 'Tambah', exact: true }).click()
    }
    await page.getByRole('button', { name: 'Buat bill' }).click()
    await expect(page).toHaveURL(/\/b\//)
    const url = page.url()

    // Bima bergabung dan memilih, jadi ada nama yang sudah diklaim
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const guest = await ctx.newPage()
    await freshUser(guest, 'Bima')
    await guest.goto(url)
    await guest.getByRole('button', { name: 'Ikut bill ini' }).click()
    await guest.getByRole('button', { name: /Sate, ketuk/ }).click()
    await expect(guest.getByText(/bagian kamu Rp30\.000/)).toBeVisible()

    await page.reload()
    await page.getByRole('button', { name: 'Ubah bill' }).click()

    // nama yang sudah bergabung tidak punya tombol hapus
    await expect(page.getByText('· bergabung')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Hapus nama Bima' })).toHaveCount(0)

    // Citra belum bergabung: bisa dihapus dan diganti
    await page.getByRole('button', { name: 'Hapus nama Citra' }).click()
    await page.getByLabel('Tambah nama').fill('Dodi')
    await page.getByRole('button', { name: 'Tambah', exact: true }).click()
    await page.getByRole('button', { name: 'Simpan perubahan' }).click()
    await expect(page.getByText('Perubahan bill disimpan')).toBeVisible()

    await expect(page.getByText('Dodi')).toBeVisible()
    await expect(page.getByText('Citra')).toHaveCount(0)
    await expect(page.getByText('Diundang, belum bergabung').first()).toBeVisible()
    // pilihan Bima tidak ikut hilang gara-gara roster diganti
    await expect(page.getByText('Bagian Rp30.000').first()).toBeVisible()
    await ctx.close()
  })

  test('36. hapus bill butuh konfirmasi dan bill hilang dari daftar', async ({ page }) => {
    await freshUser(page, 'Aufa')
    const title = 'Hapus ' + stamp
    await createTwoItemBill(page, title)

    await page.getByRole('button', { name: 'Ubah bill' }).click()
    await page.getByRole('button', { name: 'Hapus bill ini' }).click()
    await expect(page.getByText('Yakin menghapus bill ini?')).toBeVisible()

    // batal dulu: bill tetap ada
    await page.getByRole('button', { name: 'Batal' }).click()
    await expect(page.getByText('Yakin menghapus bill ini?')).toHaveCount(0)

    await page.getByRole('button', { name: 'Hapus bill ini' }).click()
    await page.getByRole('button', { name: 'Ya, hapus permanen' }).click()
    await expect(page.getByText('Bill dihapus')).toBeVisible()

    await expect(page).toHaveURL(/\/$/)
    await page.goto('/bills')
    await expect(page.getByText(title)).toHaveCount(0)
  })

  test('35. tambah dan hapus item saat mengubah bill', async ({ page }) => {
    await freshUser(page, 'Aufa')
    await createTwoItemBill(page, 'Item ubah ' + stamp)

    await page.getByRole('button', { name: 'Ubah bill' }).click()
    await page.getByRole('button', { name: '+ Tambah item' }).click()
    await page.getByLabel('Item 3').fill('Es teh')
    await page.getByLabel('Harga satuan').nth(2).fill('10000')

    // hapus Nasi goreng (baris 1)
    await page.getByRole('button', { name: 'Hapus baris 1' }).click()
    await expect(page.getByText('Rp40.000').first()).toBeVisible()

    await page.getByRole('button', { name: 'Simpan perubahan' }).click()
    await expect(page.getByText('Perubahan bill disimpan')).toBeVisible()

    await expect(page.getByText('Ayam bakar').first()).toBeVisible()
    await expect(page.getByText('Es teh').first()).toBeVisible()
    await expect(page.getByText('Nasi goreng')).toHaveCount(0)
    await expect(page.getByText('Rp40.000').first()).toBeVisible()
  })
})
