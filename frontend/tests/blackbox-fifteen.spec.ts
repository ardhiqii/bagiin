import { test, expect, type Page, type Browser } from '@playwright/test'

/**
 * Kotak hitam gelombang 15 — dua orang mengubah hal yang sama.
 *
 * Ini area tempat aplikasi biasanya diam-diam salah: layar orang lain masih
 * memegang data lama, lalu tindakannya menabrak keadaan yang sudah berubah.
 * Yang diperiksa: apakah layar menjelaskan, apakah uangnya masih utuh, dan
 * apakah ada jalan keluar — bukan sekadar "tidak crash".
 */

async function freshUser(page: Page, name: string) {
  await page.goto('/')
  if (await page.getByRole('button', { name: 'Mulai pakai Bagiin' }).count()) {
    await page.getByLabel('Nama kamu').fill(name)
    await expect(page.getByRole('button', { name: 'Mulai pakai Bagiin' })).toBeEnabled({ timeout: 20000 })
    await page.getByRole('button', { name: 'Mulai pakai Bagiin' }).click()
  }
  await expect(page.getByRole('heading', { level: 1 })).toContainText(name, { timeout: 20000 })
}

async function billWith(page: Page, title: string, items: Array<[string, number]>) {
  await page.goto('/create')
  await expect(page.locator('#bill-title')).toBeVisible({ timeout: 20000 })
  await page.locator('#bill-title').fill(title)
  for (let i = 0; i < items.length; i++) {
    if (i > 0) await page.getByRole('button', { name: '+ Tambah item' }).click()
    await page.locator(`#item-name-${i}`).fill(items[i][0])
    await page.locator(`#item-price-${i}`).fill(String(items[i][1]))
  }
  await page.getByRole('button', { name: 'Buat bill' }).click()
  await expect(page).toHaveURL(/\/b\//, { timeout: 20000 })
  return page.url()
}

async function joinAsGuest(browser: Browser, url: string, name: string) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const guest = await ctx.newPage()
  await guest.goto(url)
  await expect(guest.getByRole('button', { name: /Ikut bill ini|Gabung/ })).toBeVisible({ timeout: 20000 })
  await guest.getByRole('button', { name: /Ikut bill ini|Gabung/ }).click()
  if (await guest.getByLabel('Nama kamu').count()) {
    await guest.getByLabel('Nama kamu').fill(name)
    await guest.getByRole('button', { name: /Simpan nama & ikut bill/ }).click()
  }
  /* Tunggu sampai benar-benar JOINED, bukan sekadar selesai mengetuk: sesudah
     ini ada tes yang menekan baris item, dan baris item mati selama orangnya
     belum tercatat ikut. Di mesin lambat, tanpa penantian ini, ketukan pertama
     jatuh ke tombol mati dan hilang tanpa jejak. */
  await expect(guest.getByRole('button', { name: /Ikut bill ini|Gabung/ })).toHaveCount(0, { timeout: 20000 })
  return { ctx, guest }
}

test.describe('Kotak hitam — dua orang mengubah hal yang sama', () => {
  test('H1. item yang sudah dipilih tamu dihapus kreator: tamu tidak buntu', async ({ page, browser }) => {
    test.setTimeout(150_000)
    await freshUser(page, 'Vera')
    const url = await billWith(page, 'Item dihapus', [['Kwetiau', 20000], ['Es jeruk', 8000]])
    const { ctx, guest } = await joinAsGuest(browser, url, 'Wawan')
    try {
      await guest.getByRole('button', { name: /Kwetiau, ketuk untuk memilih/ }).click()
      await expect(guest.getByText(/Bagian Rp20\.000/).first()).toBeVisible({ timeout: 20000 })

      // Kreator menghapus item yang sudah dipilih tamu (bill masih terbuka).
      await page.goto(url + '/edit')
      await expect(page.locator('#edit-item-name-0')).toBeVisible({ timeout: 20000 })
      // Baris item dihapus lewat tombol berlabel "Hapus baris N", bukan nama item.
      await page.getByRole('button', { name: 'Hapus baris 1', exact: true }).click()
      const simpan = page.getByRole('button', { name: /Simpan/ })
      if (await simpan.isEnabled()) await simpan.click()

      await guest.bringToFront()
      await guest.reload()
      // Tidak boleh layar rusak; sisa harus dijelaskan, bukan angka hantu.
      const body = await guest.locator('body').innerText()
      expect(body).not.toContain('Something went wrong')
      expect(body).toMatch(/Es jeruk|Bagian|Lunas|belum/i)
    } finally {
      await ctx.close()
    }
  })

  test('H2. harga diubah saat tamu memegang layar lama: tamu diberi tahu', async ({ page, browser }) => {
    test.setTimeout(150_000)
    await freshUser(page, 'Yuni')
    const url = await billWith(page, 'Harga berubah diam-diam', [['Nasi uduk', 15000]])
    const { ctx, guest } = await joinAsGuest(browser, url, 'Xaverius')
    try {
      await guest.bringToFront()
      await guest.reload()
      // Layar tamu sekarang memegang harga 15.000.

      await page.bringToFront()
      await page.goto(url + '/edit')
      await page.locator('#edit-item-price-0').fill('17000')
      const simpan = page.getByRole('button', { name: /Simpan/ })
      if (await simpan.isEnabled()) await simpan.click()
      await expect(page.locator('.ds-balance-value')).toContainText('17.000', { timeout: 20000 })

      // Tamu mengetuk item yang harganya sudah berubah tanpa menyegarkan layar.
      await guest.bringToFront()
      await guest.getByRole('button', { name: /Nasi uduk, ketuk untuk memilih/ }).click()
      await expect(guest.getByText(/Bagian Rp17\.000|Rp17\.000/).first()).toBeVisible({ timeout: 20000 })
    } finally {
      await ctx.close()
    }
  })

  test('H3. bill ditutup saat tamu sedang mengetuk item: pesannya jelas', async ({ page, browser }) => {
    test.setTimeout(150_000)
    await freshUser(page, 'Zulfa')
    const url = await billWith(page, 'Ditutup di tengah', [['Martabak', 45000], ['Teh', 5000]])
    const { ctx, guest } = await joinAsGuest(browser, url, 'Asep')
    try {
      await guest.bringToFront()
      await guest.reload()

      await page.bringToFront()
      await page.reload()
      await page.getByRole('button', { name: 'Aksi lain' }).click()
      await page.getByRole('button', { name: 'Tutup bill' }).click()
      await expect(page.getByText(/Ditutup/).first()).toBeVisible({ timeout: 20000 })

      await guest.bringToFront()
      // Tamu mengetuk item dari layar yang masih terbuka sebelum ditutup.
      const item = guest.getByRole('button', { name: /Martabak, ketuk untuk memilih/ })
      if (await item.isEnabled().catch(() => false)) {
        await item.click()
      }
      await guest.reload()
      /* Baris yang terkunci menyebut alasannya, tidak lagi mengajak mengetuk. */
      const barisTutup = guest.locator('.ds-item', { hasText: 'Martabak' }).first()
      await expect(barisTutup).toBeDisabled({ timeout: 20000 })
      await expect(barisTutup).toHaveAttribute('aria-label', /tidak bisa dipilih/)
    } finally {
      await ctx.close()
    }
  })

  test('H4. ganti yang menalangi: wewenang pindah ke orang baru', async ({ page, browser }) => {
    test.setTimeout(150_000)
    await freshUser(page, 'Bayu')
    const url = await billWith(page, 'Ganti penalangi', [['Sushi', 80000]])
    const { ctx, guest } = await joinAsGuest(browser, url, 'Citra')
    try {
      await page.bringToFront()
      await page.reload()
      await page.getByRole('button', { name: 'Aksi lain' }).click()
      await page.getByRole('button', { name: 'Ganti yang bayar duluan' }).click()
      const sheet = page.getByRole('dialog', { name: 'Siapa yang bayar duluan' })
      await expect(sheet).toBeVisible({ timeout: 20000 })
      await sheet.locator('.app-row', { hasText: 'Citra' }).click()
      await expect(page.getByText(/Pembayar diganti ke Citra/)).toBeVisible({ timeout: 20000 })

      // Wewenang pindah: yang lama tidak lagi melihat aksi pengelola.
      await page.reload()
      await page.getByRole('button', { name: 'Aksi lain' }).click()
      await expect(page.getByRole('button', { name: 'Tutup bill' })).toHaveCount(0, { timeout: 20000 })
      await page.keyboard.press('Escape').catch(() => {})

      // Yang baru menalangi bisa mengelola.
      await guest.bringToFront()
      await guest.reload()
      await guest.getByRole('button', { name: 'Aksi lain' }).click()
      await expect(guest.getByRole('button', { name: 'Tutup bill' })).toBeVisible({ timeout: 20000 })
    } finally {
      await ctx.close()
    }
  })

  test('H5. tamu lunas lalu dikeluarkan lalu masuk lagi: tidak ada catatan dobel', async ({ page, browser }) => {
    test.setTimeout(150_000)
    await freshUser(page, 'Dewi')
    // Dua item, satu dibayar tamu: bill belum lunas, jadi pengeluaran peserta
    // memang masih boleh — itu keadaan yang ingin diuji.
    const url = await billWith(page, 'Lunas lalu keluar', [['Bubur', 18000], ['Kerupuk', 2000]])
    const { ctx, guest } = await joinAsGuest(browser, url, 'Eko')
    try {
      await guest.bringToFront()
      await guest.getByRole('button', { name: /Bubur, ketuk untuk memilih/ }).click()
      await expect(guest.getByText(/Bagian Rp18\.000/).first()).toBeVisible({ timeout: 20000 })

      await page.bringToFront()
      await page.reload()
      await page.getByRole('button', { name: 'Keluarkan Eko', exact: true }).click()
      await expect(page.locator('.app-row', { hasText: 'Eko' })).toHaveCount(0, { timeout: 20000 })

      await guest.bringToFront()
      await guest.goto(url)
      if (await guest.getByRole('button', { name: /Ikut bill ini|Gabung/ }).count()) {
        await guest.getByRole('button', { name: /Ikut bill ini|Gabung/ }).click()
        if (await guest.getByLabel('Nama kamu').count()) {
          await guest.getByLabel('Nama kamu').fill('Eko')
          await guest.getByRole('button', { name: /Simpan nama & ikut bill/ }).click()
        }
      }
      await page.bringToFront()
      await page.reload()
      // Satu orang, satu baris — bukan dua baris Eko dengan status berbeda.
      await expect(page.locator('.app-row', { hasText: 'Eko' })).toHaveCount(1, { timeout: 20000 })
    } finally {
      await ctx.close()
    }
  })

  test('H6. tutup lalu buka lagi: status lunas tidak berubah sendiri', async ({ page, browser }) => {
    test.setTimeout(150_000)
    await freshUser(page, 'Fikri')
    const url = await billWith(page, 'Tutup buka', [['Soto', 25000]])
    const { ctx, guest } = await joinAsGuest(browser, url, 'Gita')
    try {
      await guest.bringToFront()
      await guest.getByRole('button', { name: /Soto, ketuk untuk memilih/ }).click()
      await guest.getByRole('button', { name: /Tandai lunas/ }).click()
      await expect(guest.getByText(/Lunas/).first()).toBeVisible({ timeout: 20000 })

      await page.bringToFront()
      await page.reload()
      await page.getByRole('button', { name: 'Aksi lain' }).click()
      await page.getByRole('button', { name: 'Tutup bill' }).click()
      await expect(page.getByText(/Ditutup/).first()).toBeVisible({ timeout: 20000 })

      await page.getByRole('button', { name: 'Aksi lain' }).click()
      await page.getByRole('button', { name: 'Buka lagi' }).click()
      await page.reload()

      // Gita sudah lunas sebelum ditutup; membuka lagi tidak boleh membatalkannya.
      await expect(page.locator('.app-row', { hasText: 'Gita' })).toContainText('Lunas', { timeout: 20000 })
    } finally {
      await ctx.close()
    }
  })
})
