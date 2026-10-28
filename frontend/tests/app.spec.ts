import { test, expect, type Page } from '@playwright/test'

const stamp = Date.now().toString().slice(-6)

async function onboard(page: Page, name: string) {
  await page.goto('/')
  if (await page.getByRole('button', { name: 'Mulai pakai Bagiin' }).count()) {
    await page.getByLabel('Nama kamu').fill(name)
    await page.getByRole('button', { name: 'Mulai pakai Bagiin' }).click()
  }
  await expect(page.getByRole('heading', { level: 1 })).toContainText(name)
}

test.describe('Bagiin — perilaku user', () => {
  test('1. kunjungan pertama minta nama, lalu header memakai nama itu', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Mulai atau masuk' })).toBeVisible()
    // tombol terkunci selama nama belum diisi
    await expect(page.getByRole('button', { name: 'Mulai pakai Bagiin' })).toBeDisabled()
    await page.getByLabel('Nama kamu').fill('Aufa')
    await page.getByRole('button', { name: 'Mulai pakai Bagiin' }).click()
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Halo, Aufa')
    // nama bertahan setelah reload
    await page.reload()
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Halo, Aufa')
  })

  test('2. buat bill: total dihitung benar lalu tersimpan', async ({ page }) => {
    await onboard(page, 'Aufa')
    await page.goto('/create')

    await page.getByLabel('Nama bill').fill('Makan malam ' + stamp)
    await page.getByLabel('Item 1').fill('Nasi goreng')
    await page.getByLabel('Harga satuan').fill('40000')
    await page.getByRole('button', { name: '+ Tambah item' }).click()
    await page.getByLabel('Item 2').fill('Es teh')
    await page.getByLabel('Qty').first().fill('1')

    const prices = page.getByLabel('Harga satuan')
    await prices.nth(1).fill('20000')
    await page.getByLabel('Pajak', { exact: true }).fill('11000')

    await expect(page.getByText('Rp71.000')).toBeVisible()
    // Tunggu aplikasi menyatakan siap, jangan menebak lewat jeda: tombol ini
    // mati selama identitas belum siap, dan klik ke tombol mati hilang tanpa
    // jejak — di mesin lambat itu terbaca sebagai "aplikasi tidak berpindah".
    await expect(page.getByRole('button', { name: 'Buat bill' })).toBeEnabled()
    await page.getByRole('button', { name: 'Buat bill' }).click()

    await expect(page).toHaveURL(/\/b\//)
    await expect(page.getByText('Rp71.000').first()).toBeVisible()
  })

  test('3. bill: pilih item, bagian saya dihitung, tandai lunas', async ({ page }) => {
    await onboard(page, 'Aufa')
    await page.goto('/create')
    await page.getByLabel('Nama bill').fill('Kopi ' + stamp)
    await page.getByLabel('Item 1').fill('Kopi susu')
    await page.getByLabel('Harga satuan').fill('25000')
    // Tunggu aplikasi menyatakan siap, jangan menebak lewat jeda: tombol ini
    // mati selama identitas belum siap, dan klik ke tombol mati hilang tanpa
    // jejak — di mesin lambat itu terbaca sebagai "aplikasi tidak berpindah".
    await expect(page.getByRole('button', { name: 'Buat bill' })).toBeEnabled()
    await page.getByRole('button', { name: 'Buat bill' }).click()
    await expect(page).toHaveURL(/\/b\//)

    const item = page.getByRole('button', { name: /Kopi susu, ketuk/ })
    await item.click()
    await expect(item).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByText(/bagian kamu Rp25\.000/)).toBeVisible()

    // pembuat bill = yang menalangi, jadi statusnya otomatis lunas
    await expect(page.getByText('Lunas').first()).toBeVisible()

    // membatalkan pilihan mengembalikan bagiannya ke nol
    await item.click()
    await expect(item).toHaveAttribute('aria-pressed', 'false')
  })

  test('4. teman buka link, ikut bill, pilih item sendiri', async ({ page, browser }) => {
    await onboard(page, 'Aufa')
    await page.goto('/create')
    await page.getByLabel('Nama bill').fill('Bareng ' + stamp)
    await page.getByLabel('Item 1').fill('Ayam')
    await page.getByLabel('Harga satuan').fill('30000')
    // Tunggu aplikasi menyatakan siap, jangan menebak lewat jeda: tombol ini
    // mati selama identitas belum siap, dan klik ke tombol mati hilang tanpa
    // jejak — di mesin lambat itu terbaca sebagai "aplikasi tidak berpindah".
    await expect(page.getByRole('button', { name: 'Buat bill' })).toBeEnabled()
    await page.getByRole('button', { name: 'Buat bill' }).click()
    await expect(page).toHaveURL(/\/b\//)
    const billUrl = page.url()

    // pengguna kedua: konteks baru = identitas baru
    const guestContext = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const guest = await guestContext.newPage()
    await onboard(guest, 'Bima')
    await guest.goto(billUrl)
    await guest.getByRole('button', { name: 'Ikut bill ini' }).click()

    const item = guest.getByRole('button', { name: /Ayam, ketuk/ })
    await item.click()
    await expect(item).toHaveAttribute('aria-pressed', 'true')
    await expect(guest.getByText(/bagian kamu Rp30\.000/)).toBeVisible()

    // tamu menandai bagiannya lunas
    await guest.getByRole('button', { name: /Tandai lunas/ }).click()
    await expect(guest.getByText('Ditandai lunas')).toBeVisible()

    // pembuat bill melihat tamu itu di daftar orang
    await page.reload()
    await expect(page.getByText('Bima').first()).toBeVisible()
    await guestContext.close()
  })

  test('5. daftar bill dan rekap menampilkan bill yang barusan dibuat', async ({ page }) => {
    await onboard(page, 'Aufa')
    await page.goto('/create')
    const title = 'Rekap ' + stamp
    await page.getByLabel('Nama bill').fill(title)
    await page.getByLabel('Item 1').fill('Sate')
    await page.getByLabel('Harga satuan').fill('15000')
    // Tunggu aplikasi menyatakan siap, jangan menebak lewat jeda: tombol ini
    // mati selama identitas belum siap, dan klik ke tombol mati hilang tanpa
    // jejak — di mesin lambat itu terbaca sebagai "aplikasi tidak berpindah".
    await expect(page.getByRole('button', { name: 'Buat bill' })).toBeEnabled()
    await page.getByRole('button', { name: 'Buat bill' }).click()
    await expect(page).toHaveURL(/\/b\//)

    await page.goto('/bills')
    await expect(page.getByText(title)).toBeVisible()

    await page.goto('/recap')
    // bill baru tanpa pilihan: pembagiannya belum jelas, jadi masuk daftar kerja
    await expect(page.getByText(/Pembagian belum jelas/i)).toBeVisible()
    await expect(page.getByText(title)).toBeVisible()
  })

  test('6. pengaturan: ganti nama langsung terlihat di beranda', async ({ page }) => {
    await onboard(page, 'Aufa')
    await page.goto('/settings')
    await page.getByLabel('Nama kamu').fill('Aufa Fauqi')
    await page.getByRole('button', { name: 'Simpan nama' }).click()
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Aufa Fauqi')
  })

  test('7. tombol bagikan menyalin link bill', async ({ page }) => {
    await onboard(page, 'Aufa')
    await page.goto('/create')
    await page.getByLabel('Nama bill').fill('Share ' + stamp)
    await page.getByLabel('Item 1').fill('Teh')
    await page.getByLabel('Harga satuan').fill('8000')
    // Tunggu aplikasi menyatakan siap, jangan menebak lewat jeda: tombol ini
    // mati selama identitas belum siap, dan klik ke tombol mati hilang tanpa
    // jejak — di mesin lambat itu terbaca sebagai "aplikasi tidak berpindah".
    await expect(page.getByRole('button', { name: 'Buat bill' })).toBeEnabled()
    await page.getByRole('button', { name: 'Buat bill' }).click()
    await expect(page).toHaveURL(/\/b\//)
    // bagikan sekarang di menu "Aksi lain" (ikon ⋮ di header), bukan di bar bawah
    await page.getByRole('button', { name: 'Aksi lain' }).click()
    // baris di sheet: namanya "Bagikan link" + catatan kecil di bawahnya
    await page.getByRole('button', { name: /^Bagikan link/ }).click()
    await expect(page.getByText('Link disalin. Kirim ke teman kamu.')).toBeVisible()
    const clip = await page.evaluate(() => navigator.clipboard.readText())
    expect(clip).toContain('/b/')
  })

  test('8. navigasi bawah pindah layar tanpa error', async ({ page }) => {
    await onboard(page, 'Aufa')
    const nav = page.getByRole('navigation', { name: 'Navigasi utama' })
    // daftar bill sekarang menyatu dengan beranda: tab "Bill" hilang
    await expect(nav.getByRole('link', { name: 'Bill', exact: true })).toHaveCount(0)
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Halo')
    await nav.getByRole('link', { name: 'Rekap', exact: true }).click()
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Rekap')
    await nav.getByRole('link', { name: 'Beranda', exact: true }).click()
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Halo')
  })
})
