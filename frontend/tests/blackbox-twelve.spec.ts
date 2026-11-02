import { test, expect, type Page, type Browser } from '@playwright/test'

/**
 * Kotak hitam gelombang 12 — keadaan yang tidak rapi.
 *
 * Orang nyata: menutup tab, membuka dua tab, menghapus data situs, menempel
 * tautan salah, menekan Back berkali-kali, dan memegang HP 320 px. Yang diuji
 * adalah apakah aplikasi tetap bisa dipakai setelah itu — bukan apakah datanya
 * cantik.
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
  return { ctx, guest }
}

test.describe('Kotak hitam — keadaan yang tidak rapi', () => {
  test('E1. data identitas di perangkat rusak: aplikasi tetap terbuka', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('bagiin_identity', '{"id":"bukan-identitas-asli","secret":')
    })
    await page.goto('/')
    // Bukan layar putih, bukan crash: layar masuk tetap muncul dan bisa dipakai.
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 25000 })
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Mulai|Halo/)
    const body = await page.locator('body').innerText()
    expect(body.length, 'layar tidak boleh kosong').toBeGreaterThan(20)
  })

  test('E2. data situs dihapus lalu membuka tautan bill: bisa masuk sebagai tamu', async ({ page, browser }) => {
    await freshUser(page, 'Vino')
    const url = await manualBill(page, 'Bill setelah data dihapus', 'Sate', 30000)

    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const tamu = await ctx.newPage()
    try {
      await tamu.goto(url)
      await expect(tamu.getByRole('button', { name: /Ikut bill ini|Gabung/ })).toBeVisible({ timeout: 20000 })
      await tamu.getByRole('button', { name: /Ikut bill ini|Gabung/ }).click()
      await tamu.getByLabel('Nama kamu').fill('Wulan')
      await tamu.getByRole('button', { name: /Simpan nama & ikut bill/ }).click()
      await expect(tamu.getByText(/Sate/).first()).toBeVisible({ timeout: 20000 })
    } finally {
      await ctx.close()
    }
  })

  test('E3. menyegarkan halaman di tengah memilih: pilihan tidak hilang', async ({ page }) => {
    await freshUser(page, 'Yoga')
    const url = await manualBill(page, 'Segarkan saat memilih', 'Bakso', 24000)
    await page.getByRole('button', { name: /Bakso, ketuk untuk memilih/ }).click()
    await expect(page.getByText(/Bagian Rp24\.000/).first()).toBeVisible({ timeout: 20000 })

    await page.reload()
    // Pilihan disimpan di server, jadi setelah segarkan angkanya tetap sama.
    await expect(page.getByText(/Bagian Rp24\.000/).first()).toBeVisible({ timeout: 20000 })
  })

  test('E4. dua tab identitas yang sama: perubahan tab satu terlihat setelah tab dua disegarkan', async ({ page, browser }) => {
    await freshUser(page, 'Zaki')
    const url = await manualBill(page, 'Dua tab', 'Mie ayam', 18000)

    // Context yang sama = localStorage yang sama = orang yang sama.
    const ctx = page.context()
    const tab2 = await ctx.newPage()
    try {
      await tab2.goto(url)
      await expect(tab2.getByText(/Mie ayam/).first()).toBeVisible({ timeout: 20000 })

      await page.bringToFront()
      await page.getByRole('button', { name: /Mie ayam, ketuk untuk memilih/ }).click()
      await expect(page.getByText(/Bagian Rp18\.000/).first()).toBeVisible({ timeout: 20000 })

      await tab2.bringToFront()
      await tab2.reload()
      await expect(tab2.getByText(/Bagian Rp18\.000/).first()).toBeVisible({ timeout: 20000 })
    } finally {
      await tab2.close()
    }
  })

  test('E5. judul bill 120 karakter di HP 320 px: tidak ada scroll mendatar', async ({ page }) => {
    await freshUser(page, 'Adit')
    await page.setViewportSize({ width: 320, height: 720 })
    const judul = 'Makan malam keluarga besar di restoran padang dekat kantor yang namanya panjang sekali '.repeat(2)
    const url = await manualBill(page, judul.slice(0, 120), 'Rendang', 45000)

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow, 'judul panjang tidak boleh melebarkan layar').toBeLessThanOrEqual(1)
    await expect(page.locator('.ds-balance-value')).toContainText('45.000', { timeout: 20000 })
  })

  test('E6. tautan bill yang salah: dijelaskan, bukan layar kosong', async ({ page }) => {
    await freshUser(page, 'Bella')
    await page.goto('/b/taut-an-salah-123')
    const body = await page.locator('body').innerText()
    expect(body).not.toContain('Something went wrong')
    expect(body.length).toBeGreaterThan(20)
    // Harus ada kalimat yang memberi tahu bill-nya tidak ketemu.
    expect(body.toLowerCase()).toMatch(/tidak (ditemukan|ketemu|ada)|tidak bisa dibuka|bill.*tidak/)
  })

  test('E7. Back berkali-kali dari layar buat bill: kembali ke beranda tanpa rusak', async ({ page }) => {
    await freshUser(page, 'Candra')
    // Beranda → buat bill → layar bill. Semua lewat navigasi aplikasi, supaya
    // riwayat yang ditekan Back memang riwayat di dalam aplikasi (menekan Back
    // melebihi riwayat akan keluar dari aplikasi — itu urusan browser).
    await page.getByRole('link', { name: 'Buat', exact: true }).click()
    await expect(page.locator('#bill-title')).toBeVisible({ timeout: 20000 })
    await page.locator('#bill-title').fill('Bolak balik')
    await page.locator('#item-name-0').fill('Soto')
    await page.locator('#item-price-0').fill('25000')
    await page.getByRole('button', { name: 'Buat bill' }).click()
    await expect(page).toHaveURL(/\/b\//, { timeout: 20000 })

    // Bolak-balik: Back dari layar bill, lalu Forward, lalu Back lagi.
    for (const langkah of ['back', 'forward', 'back', 'back'] as const) {
      if (langkah === 'back') await page.goBack().catch(() => {})
      else await page.goForward().catch(() => {})
      await page.waitForTimeout(350)
    }
    await expect(page).toHaveURL(/\/$/, { timeout: 25000 })
    await expect(page.locator('h1')).toBeVisible({ timeout: 25000 })
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(1)
  })
})
