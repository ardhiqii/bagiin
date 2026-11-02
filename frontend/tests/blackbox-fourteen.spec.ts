import { test, expect, type Page, type Browser } from '@playwright/test'

/**
 * Kotak hitam gelombang 14 — pintu masuk bill.
 *
 * Yang diuji: bergabung ke bill yang sudah ditutup, dua orang bernama sama,
 * nama yang sangat panjang, pemilik membuka tautannya sendiri, bergabung lalu
 * bill ditutup sebelum sempat memilih, dan menekan "Ikut bill ini" dua kali.
 */

async function freshUser(page: Page, name: string) {
  await page.goto('/')
  if (await page.getByRole('button', { name: 'Mulai pakai Bagiin' }).count()) {
    await page.getByLabel('Nama kamu').fill(name)
    await page.getByRole('button', { name: 'Mulai pakai Bagiin' }).click()
  }
  await expect(page.getByRole('heading', { level: 1 })).toContainText(name, { timeout: 20000 })
}

async function manualBill(page: Page, title: string, item: string, price: number) {
  await page.goto('/create')
  await expect(page.locator('#bill-title')).toBeVisible({ timeout: 20000 })
  await page.locator('#bill-title').fill(title)
  await page.locator('#item-name-0').fill(item)
  await page.locator('#item-price-0').fill(String(price))
  await page.getByRole('button', { name: 'Buat bill' }).click()
  await expect(page).toHaveURL(/\/b\//, { timeout: 20000 })
  return page.url()
}

async function newGuest(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const guest = await ctx.newPage()
  return { ctx, guest }
}

test.describe('Kotak hitam — pintu masuk bill', () => {
  test('G1. bergabung ke bill yang sudah ditutup: ditolak dengan kalimat', async ({ page, browser }) => {
    await freshUser(page, 'Oscar')
    const url = await manualBill(page, 'Bill sudah ditutup', 'Gado-gado', 28000)
    await page.getByRole('button', { name: 'Aksi lain' }).click()
    await page.getByRole('button', { name: 'Tutup bill' }).click()
    // Status "Ditutup" tampil sebagai lencana di badan layar, bukan judul —
  // judul layar tetap nama bill-nya.
  await expect(page.getByText(/Ditutup/).first()).toBeVisible({ timeout: 20000 })

    const { ctx, guest } = await newGuest(browser)
    try {
      await guest.goto(url)
      const body = await guest.locator('body').innerText()
      // Tidak boleh diam-diam memasukkan orang ke bill yang sudah dikunci.
      expect(body).not.toContain('Something went wrong')
      if (await guest.getByRole('button', { name: /Ikut bill ini|Gabung/ }).count()) {
        await guest.getByRole('button', { name: /Ikut bill ini|Gabung/ }).click()
        if (await guest.getByLabel('Nama kamu').count()) {
          await guest.getByLabel('Nama kamu').fill('Tamu Terlambat')
          await guest.getByRole('button', { name: /Simpan nama & ikut bill/ }).click()
        }
        await expect(guest.getByText(/ditutup|tidak bisa|sudah selesai/i).first()).toBeVisible({ timeout: 20000 })
      } else {
        await expect(guest.getByText(/ditutup|tidak bisa|sudah selesai/i).first()).toBeVisible({ timeout: 20000 })
      }
    } finally {
      await ctx.close()
    }
  })

  test('G2. dua tamu bernama sama tetap dua baris terpisah', async ({ page, browser }) => {
    test.setTimeout(150_000)
    await freshUser(page, 'Pandu')
    const url = await manualBill(page, 'Nama kembar', 'Rawon', 32000)

    const g1 = await newGuest(browser)
    const g2 = await newGuest(browser)
    try {
      for (const g of [g1, g2]) {
        await g.guest.goto(url)
        await g.guest.getByRole('button', { name: /Ikut bill ini|Gabung/ }).click()
        await g.guest.getByLabel('Nama kamu').fill('Sari')
        await g.guest.getByRole('button', { name: /Simpan nama & ikut bill/ }).click()
        await expect(g.guest.getByText(/Rawon/).first()).toBeVisible({ timeout: 20000 })
      }

      await page.reload()
      // Dua orang berbeda dengan nama yang sama: tidak digabung diam-diam.
      await expect(page.locator('.app-row', { hasText: 'Sari' })).toHaveCount(2, { timeout: 20000 })
    } finally {
      await g1.ctx.close()
      await g2.ctx.close()
    }
  })

  test('G3. nama tamu 60 karakter tidak merobohkan baris', async ({ page, browser }) => {
    await freshUser(page, 'Qabil')
    const url = await manualBill(page, 'Nama panjang', 'Sushi', 60000)
    const { ctx, guest } = await newGuest(browser)
    const nama = 'Bambang Setiawan Kusumawardhana Putra Pratama Wijayakusuma Hidayatullah'
    try {
      await guest.setViewportSize({ width: 320, height: 720 })
      await guest.goto(url)
      await guest.getByRole('button', { name: /Ikut bill ini|Gabung/ }).click()
      await guest.getByLabel('Nama kamu').fill(nama)
      await guest.getByRole('button', { name: /Simpan nama & ikut bill/ }).click()
      await expect(guest.getByText(/Sushi/).first()).toBeVisible({ timeout: 20000 })

      const overflow = await guest.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(overflow, 'nama panjang tidak boleh melebarkan layar').toBeLessThanOrEqual(1)
    } finally {
      await ctx.close()
    }
  })

  test('G4. pemilik membuka tautan billnya sendiri: tidak ditawari ikut', async ({ page }) => {
    await freshUser(page, 'Rudi')
    const url = await manualBill(page, 'Bill sendiri', 'Bakwan', 12000)

    const tab = await page.context().newPage()
    try {
      await tab.goto(url)
      await expect(tab.getByText(/Bakwan/).first()).toBeVisible({ timeout: 20000 })
      await expect(tab.getByRole('button', { name: /Ikut bill ini|Gabung/ })).toHaveCount(0)
    } finally {
      await tab.close()
    }
  })

  test('G5. tamu bergabung lalu bill ditutup sebelum ia memilih', async ({ page, browser }) => {
    test.setTimeout(150_000)
    await freshUser(page, 'Sena')
    const url = await manualBill(page, 'Ditutup saat tamu diam', 'Sate padang', 22000)
    const { ctx, guest } = await newGuest(browser)
    try {
      await guest.goto(url)
      await guest.getByRole('button', { name: /Ikut bill ini|Gabung/ }).click()
      await guest.getByLabel('Nama kamu').fill('Tono')
      await guest.getByRole('button', { name: /Simpan nama & ikut bill/ }).click()
      await expect(guest.getByText(/Sate padang/).first()).toBeVisible({ timeout: 20000 })

      await page.bringToFront()
      await page.reload()
      await page.getByRole('button', { name: 'Aksi lain' }).click()
      await page.getByRole('button', { name: 'Tutup bill' }).click()
      // Status "Ditutup" tampil sebagai lencana di badan layar, bukan judul —
  // judul layar tetap nama bill-nya.
  await expect(page.getByText(/Ditutup/).first()).toBeVisible({ timeout: 20000 })

      await guest.bringToFront()
      await guest.reload()
      // Item terkunci; yang belum dipilih tetap tercatat sebagai sisa.
      await expect(guest.getByRole('button', { name: /Sate padang, ketuk untuk memilih/ })).toBeDisabled({ timeout: 20000 })
      await expect(guest.getByText(/belum dipilih|Ada sisa yang belum diambil/i).first()).toBeVisible({ timeout: 20000 })
    } finally {
      await ctx.close()
    }
  })

  test('G6. dua ketukan cepat pada Ikut bill ini tetap satu peserta', async ({ page, browser }) => {
    await freshUser(page, 'Tari')
    const url = await manualBill(page, 'Ikut dua kali cepat', 'Pecel', 26000)
    const { ctx, guest } = await newGuest(browser)
    try {
      await guest.goto(url)
      const ikut = guest.getByRole('button', { name: /Ikut bill ini|Gabung/ })
      await expect(ikut).toBeVisible({ timeout: 20000 })
      await ikut.click()
      // Ketukan kedua saat layar nama muncul; tombolnya bisa saja sudah hilang.
      if (await guest.getByLabel('Nama kamu').count()) {
        await guest.getByLabel('Nama kamu').fill('Ujang')
        const simpan = guest.getByRole('button', { name: /Simpan nama & ikut bill/ })
        await simpan.click()
        if (await simpan.count()) await simpan.click({ timeout: 2000 }).catch(() => {})
      }
      await expect(guest.getByText(/Pecel/).first()).toBeVisible({ timeout: 20000 })

      await page.reload()
      await expect(page.locator('.app-row', { hasText: 'Ujang' })).toHaveCount(1, { timeout: 20000 })
    } finally {
      await ctx.close()
    }
  })
})