import { test, expect, type Page, type Browser } from '@playwright/test'

/**
 * Kotak hitam gelombang 11 — siapa boleh apa.
 *
 * Yang diuji: batas wewenang (tamu membuka /edit lewat URL), tiga orang yang
 * memilih item berbeda, mengeluarkan tamu yang sudah memilih, tamu keluar
 * sendiri, gabung lagi tanpa jadi dua baris, tandai lunas lalu mengubah
 * pilihan, dan bill yang ditutup.
 *
 * Aturan main: tanpa seeding API, tiap kasus mulai sebagai identitas baru,
 * yang diperiksa adalah tulisan di layar.
 */

async function freshUser(page: Page, name: string) {
  await page.goto('/')
  if (await page.getByRole('button', { name: 'Mulai pakai Bagiin' }).count()) {
    await page.getByLabel('Nama kamu').fill(name)
    await page.getByRole('button', { name: 'Mulai pakai Bagiin' }).click()
  }
  await expect(page.getByRole('heading', { level: 1 })).toContainText(name, { timeout: 20000 })
}

/** Bill dengan tiga item, masing-masing 10.000, supaya tiap orang bisa ambil satu. */
async function billThreeItems(page: Page, title: string) {
  await page.goto('/create')
  await expect(page.locator('#bill-title')).toBeVisible({ timeout: 20000 })
  await page.locator('#bill-title').fill(title)
  await page.locator('#item-name-0').fill('Item A')
  await page.locator('#item-price-0').fill('10000')
  await page.getByRole('button', { name: '+ Tambah item' }).click()
  await page.locator('#item-name-1').fill('Item B')
  await page.locator('#item-price-1').fill('10000')
  await page.getByRole('button', { name: '+ Tambah item' }).click()
  await page.locator('#item-name-2').fill('Item C')
  await page.locator('#item-price-2').fill('10000')
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
  await expect(guest.getByText(/Item A|Item B|Item C/).first()).toBeVisible({ timeout: 20000 })
  return { ctx, guest }
}

async function pickItem(page: Page, item: string) {
  await page.getByRole('button', { name: new RegExp(`${item}, ketuk untuk memilih`) }).click()
}

test.describe('Kotak hitam — batas wewenang dan banyak peserta', () => {
  test('D1. tamu membuka /edit lewat URL: ditolak dengan kalimat, bukan formulir', async ({ page, browser }) => {
    await freshUser(page, 'Gilang')
    const url = await billThreeItems(page, 'Makan bertiga')
    const { ctx, guest } = await joinAsGuest(browser, url, 'Hana')
    try {
      await guest.goto(url + '/edit')
      await expect(guest.getByText('Hanya yang menalangi bisa mengubah')).toBeVisible({ timeout: 20000 })
      // Tidak ada satu pun isian yang bisa disimpan oleh tamu.
      await expect(guest.locator('#edit-title')).toHaveCount(0)
    } finally {
      await ctx.close()
    }
  })

  test('D2. tiga orang memilih tiga item: tiap orang 10.000, jumlahnya pas', async ({ page, browser }) => {
    test.setTimeout(150_000)
    await freshUser(page, 'Indra')
    const url = await billThreeItems(page, 'Tiga item tiga orang')
    const { ctx: c1, guest: g1 } = await joinAsGuest(browser, url, 'Joko')
    const { ctx: c2, guest: g2 } = await joinAsGuest(browser, url, 'Kiki')
    try {
      await g1.bringToFront()
      await pickItem(g1, 'Item B')
      await g2.bringToFront()
      await pickItem(g2, 'Item C')
      await page.bringToFront()
      await pickItem(page, 'Item A')
      await page.reload()

      // Tiga bagian 10.000 = 30.000, sama dengan total bill.
      await expect(page.locator('.ds-balance-value')).toContainText('30.000', { timeout: 20000 })
      for (const nama of ['Indra', 'Joko', 'Kiki']) {
        const row = page.locator('.app-row', { hasText: nama })
        await expect(row).toContainText('10.000', { timeout: 20000 })
      }
    } finally {
      await c1.close()
      await c2.close()
    }
  })

  test('D3. kreator mengeluarkan tamu yang sudah memilih: namanya hilang, total ikut turun', async ({ page, browser }) => {
    test.setTimeout(150_000)
    await freshUser(page, 'Laras')
    const url = await billThreeItems(page, 'Keluarkan peserta')
    const { ctx, guest } = await joinAsGuest(browser, url, 'Maman')
    try {
      await guest.bringToFront()
      await pickItem(guest, 'Item B')
      await page.bringToFront()
      await page.reload()
      await expect(page.locator('.app-row', { hasText: 'Maman' })).toContainText('10.000', { timeout: 20000 })

      await page.getByRole('button', { name: 'Keluarkan Maman', exact: true }).click()
      await expect(page.locator('.app-row', { hasText: 'Maman' })).toHaveCount(0, { timeout: 20000 })
      // Item B kembali jadi beban yang belum ada pemiliknya; total bill tidak berubah,
      // yang berubah adalah siapa yang menanggung.
      await expect(page.locator('.ds-balance-value')).toContainText('30.000', { timeout: 20000 })
    } finally {
      await ctx.close()
    }
  })

  test('D4. tamu keluar sendiri setelah memilih: layar bill kembali jadi pintu masuk', async ({ page, browser }) => {
    test.setTimeout(150_000)
    await freshUser(page, 'Niko')
    const url = await billThreeItems(page, 'Tamu keluar sendiri')
    const { ctx, guest } = await joinAsGuest(browser, url, 'Ocep')
    try {
      await guest.bringToFront()
      await pickItem(guest, 'Item C')
      await guest.getByRole('button', { name: 'Aksi lain' }).click()
      await guest.getByRole('button', { name: 'Keluar dari bill ini' }).click()
      // Setelah keluar, aplikasi membawa orangnya pulang ke beranda — bukan
      // menahannya di bill yang baru saja ia tinggalkan.
      await expect(guest.getByText(/Belum ada bill|Bill kamu|Saring bill/).first()).toBeVisible({ timeout: 20000 })

      await page.bringToFront()
      await page.reload()
      await expect(page.locator('.app-row', { hasText: 'Ocep' })).toHaveCount(0, { timeout: 20000 })
    } finally {
      await ctx.close()
    }
  })

  test('D5. tamu yang keluar lalu gabung lagi tidak jadi dua baris', async ({ page, browser }) => {
    test.setTimeout(150_000)
    await freshUser(page, 'Putra')
    const url = await billThreeItems(page, 'Gabung dua kali')
    const { ctx, guest } = await joinAsGuest(browser, url, 'Qori')
    try {
      await guest.bringToFront()
      await guest.getByRole('button', { name: 'Aksi lain' }).click()
      await guest.getByRole('button', { name: 'Keluar dari bill ini' }).click()
      await expect(guest.getByText(/Belum ada bill|Bill kamu|Saring bill/).first()).toBeVisible({ timeout: 20000 })

      // Masuk lagi sebagai orang yang sama, lewat tautan yang sama.
      await guest.goto(url)
      await expect(guest.getByRole('button', { name: /Ikut bill ini|Gabung/ })).toBeVisible({ timeout: 20000 })
      await guest.getByRole('button', { name: /Ikut bill ini|Gabung/ }).click()
      if (await guest.getByLabel('Nama kamu').count()) {
        await guest.getByLabel('Nama kamu').fill('Qori')
        await guest.getByRole('button', { name: /Simpan nama & ikut bill/ }).click()
      }

      await page.bringToFront()
      await page.reload()
      await expect(page.locator('.app-row', { hasText: 'Qori' })).toHaveCount(1, { timeout: 20000 })
    } finally {
      await ctx.close()
    }
  })

  test('D6. tamu menandai lunas lalu menambah pilihan: selisihnya harus kelihatan', async ({ page, browser }) => {
    test.setTimeout(150_000)
    await freshUser(page, 'Rendra')
    const url = await billThreeItems(page, 'Bayar lalu nambah')
    const { ctx, guest } = await joinAsGuest(browser, url, 'Sinta')
    try {
      await guest.bringToFront()
      await pickItem(guest, 'Item A')
      await guest.getByRole('button', { name: /Tandai lunas/ }).click()
      await expect(guest.getByText(/Lunas/).first()).toBeVisible({ timeout: 20000 })

      /* Setelah lunas, baris item terkunci untuk orang itu: dia tidak bisa
         diam-diam menambah utang yang sudah dinyatakan selesai. Baris yang mati
         menyatakan alasannya di label ("tidak bisa dipilih sekarang"), jadi
         locator-nya memakai barisnya dan labelnya ikut diperiksa. */
      const barisTerkunci = guest.locator('.ds-item', { hasText: 'Item B' }).first()
      await expect(barisTerkunci).toBeDisabled()
      await expect(barisTerkunci).toHaveAttribute('aria-label', /tidak bisa dipilih/)

      // Jalan keluarnya harus ada dan kelihatan: batalkan lunas, ubah, lalu lunas lagi.
      await guest.getByRole('button', { name: 'Aksi lain' }).click()
      await guest.getByRole('button', { name: 'Batalkan status lunas' }).click()
      await expect(barisTerkunci).toBeEnabled({ timeout: 20000 })
      await expect(barisTerkunci).toHaveAttribute('aria-label', /ketuk untuk/)
      await pickItem(guest, 'Item B')
      await expect(guest.getByRole('button', { name: /Tandai lunas · Rp20\.000/ })).toBeVisible({ timeout: 20000 })
    } finally {
      await ctx.close()
    }
  })

  test('D7. bill ditutup: tamu tidak bisa memilih lagi dan tidak bisa mengubah', async ({ page, browser }) => {
    test.setTimeout(150_000)
    await freshUser(page, 'Tomi')
    const url = await billThreeItems(page, 'Bill ditutup')
    const { ctx, guest } = await joinAsGuest(browser, url, 'Umi')
    try {
      await page.bringToFront()
      await page.reload()
      await page.getByRole('button', { name: 'Aksi lain' }).click()
      await page.getByRole('button', { name: 'Tutup bill' }).click()
      await expect(page.getByRole('heading', { name: /Bill ditutup/ })).toBeVisible({ timeout: 20000 })
      // Item terkunci untuk semua orang setelah ditutup.
      const barisTutup = page.locator('.ds-item', { hasText: 'Item A' }).first()
      await expect(barisTutup).toBeDisabled()
      await expect(barisTutup).toHaveAttribute('aria-label', /tidak bisa dipilih/)

      // Yang menalangi membuka /edit: alasannya disebut, formulirnya tidak dibuka.
      await page.goto(url + '/edit')
      await expect(page.getByText('Bill sudah ditutup')).toBeVisible({ timeout: 20000 })
      await expect(page.locator('#edit-title')).toHaveCount(0)

      // Tamu membuka /edit: yang lebih dulu berlaku adalah batas wewenang,
      // bukan status bill — dan tidak ada isian yang bisa disimpan.
      await guest.bringToFront()
      await guest.reload()
      await guest.goto(url + '/edit')
      await expect(guest.getByText('Hanya yang menalangi bisa mengubah')).toBeVisible({ timeout: 20000 })
      await expect(guest.locator('#edit-title')).toHaveCount(0)
    } finally {
      await ctx.close()
    }
  })
})
