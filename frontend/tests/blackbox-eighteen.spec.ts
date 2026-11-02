import { test, expect, type Page } from '@playwright/test'

/**
 * Kotak hitam gelombang 18 — orang yang benar-benar belum tahu apa-apa.
 *
 * Aturannya: setiap kasus dimulai tanpa penjelasan apa pun tentang aplikasi.
 * Yang diperiksa bukan "fitur bekerja", tapi "apakah orang baru tahu harus
 * berbuat apa" — dan apakah saat ada yang salah, ia diberi kalimat yang bisa
 * ditindaklanjuti, bukan layar kosong atau pesan mesin.
 */

async function freshUser(page: Page, name: string) {
  await page.goto('/')
  if (await page.getByRole('button', { name: 'Mulai pakai Bagiin' }).count()) {
    await page.getByLabel('Nama kamu').fill(name)
    await page.getByRole('button', { name: 'Mulai pakai Bagiin' }).click()
  }
  await expect(page.getByRole('heading', { level: 1 })).toContainText(name, { timeout: 20000 })
}

test.describe('Kotak hitam — orang baru, tanpa penjelasan', () => {
  test('U1. tautan bill dibuka orang yang belum pernah memakai aplikasi: jelas harus apa', async ({ page, browser }) => {
    await freshUser(page, 'Zaki')
    await page.goto('/create')
    await expect(page.locator('#bill-title')).toBeVisible({ timeout: 20000 })
    await page.locator('#bill-title').fill('Makan siang kantor')
    await page.locator('#item-name-0').fill('Ayam geprek')
    await page.locator('#item-price-0').fill('27000')
    await page.getByRole('button', { name: 'Buat bill' }).click()
    await expect(page).toHaveURL(/\/b\//, { timeout: 20000 })
    const url = page.url()

    const ctx = await browser.newContext({ viewport: { width: 393, height: 852 } })
    const tamu = await ctx.newPage()
    try {
      await tamu.goto(url)
      const teks = await tamu.locator('body').innerText()
      // Nama bill dan nominalnya harus terbaca sebelum orang diminta apa pun.
      expect(teks).toContain('Makan siang kantor')
      expect(teks).toMatch(/27\.000/)
      // Harus ada satu ajakan yang jelas, bukan dua tombol bersaing.
      const ajakan = tamu.getByRole('button', { name: /Ikut bill ini|Gabung/ })
      await expect(ajakan).toHaveCount(1, { timeout: 20000 })
      // Dan satu kalimat yang menjelaskan kenapa ia melihat ini.
      expect(teks.length, 'layar pertama tidak boleh kosong').toBeGreaterThan(40)
    } finally {
      await ctx.close()
    }
  })

  test('U2. setelah memilih item, orang baru tahu langkah berikutnya', async ({ page, browser }) => {
    await freshUser(page, 'Adit')
    await page.goto('/create')
    await expect(page.locator('#bill-title')).toBeVisible({ timeout: 20000 })
    await page.locator('#bill-title').fill('Kopi sore')
    await page.locator('#item-name-0').fill('Latte')
    await page.locator('#item-price-0').fill('30000')
    await page.getByRole('button', { name: 'Buat bill' }).click()
    await expect(page).toHaveURL(/\/b\//, { timeout: 20000 })
    const url = page.url()

    const ctx = await browser.newContext({ viewport: { width: 393, height: 852 } })
    const tamu = await ctx.newPage()
    try {
      await tamu.goto(url)
      await tamu.getByRole('button', { name: /Ikut bill ini|Gabung/ }).click()
      await tamu.getByLabel('Nama kamu').fill('Bayu')
      await tamu.getByRole('button', { name: /Simpan nama & ikut bill/ }).click()

      await tamu.getByRole('button', { name: /Latte, ketuk untuk memilih/ }).click()
      await expect(tamu.getByText(/Bagian Rp30\.000/).first()).toBeVisible({ timeout: 20000 })

      // Langkah berikutnya harus berupa tindakan yang terbaca, bukan teka-teki.
      const teks = await tamu.locator('body').innerText()
      expect(teks).toMatch(/[Tt]andai lunas|[Bb]ayar|[Ll]unas/)
    } finally {
      await ctx.close()
    }
  })

  test('U3. tautan bill yang salah tidak berakhir di layar kosong', async ({ page }) => {
    await freshUser(page, 'Cakra')
    await page.goto('/b/inikodeyangtidakada123')
    const teks = await page.locator('body').innerText()
    // Pesan manusiawi + jalan pulang.
    expect(teks).not.toContain('Something went wrong')
    expect(teks).not.toMatch(/^404$/)
    expect(teks.length, 'tidak boleh layar kosong').toBeGreaterThan(30)
    expect(teks).toMatch(/tidak ditemukan|tidak ada|sudah dihapus|[Bb]eranda/i)
  })

  test('U4. jaringan mati saat aplikasi dibuka: ada penjelasan, bukan layar putih', async ({ page }) => {
    await freshUser(page, 'Dinda')
    // Semua permintaan ke backend gagal, seperti sinyal hilang di lift.
    await page.route('**/api/**', (route) => route.abort('failed'))
    await page.goto('/')
    await page.waitForTimeout(4000)

    const teks = await page.locator('body').innerText()
    expect(teks.trim().length, 'layar tidak boleh kosong saat jaringan mati').toBeGreaterThan(20)
    // Kerangka muat boleh, tapi tidak boleh berputar selamanya tanpa penjelasan.
    expect(teks).toMatch(/[Gg]agal|[Kk]oneksi|[Jj]aringan|[Cc]oba lagi|[Mm]uat/)
  })

  test('U5. angka miliaran tetap terbaca di layar 320 px', async ({ page }) => {
    await freshUser(page, 'Ela')
    await page.setViewportSize({ width: 320, height: 640 })
    await page.goto('/create')
    await expect(page.locator('#bill-title')).toBeVisible({ timeout: 20000 })
    await page.locator('#bill-title').fill('Angka besar')
    await page.locator('#item-name-0').fill('Rumah')
    await page.locator('#item-price-0').fill('1234567890')
    await page.getByRole('button', { name: 'Buat bill' }).click()
    await expect(page).toHaveURL(/\/b\//, { timeout: 20000 })

    const hasil = await page.evaluate(() => {
      const geser = document.documentElement.scrollWidth - document.documentElement.clientWidth
      const nilai = document.querySelector('.ds-balance-value') as HTMLElement | null
      return {
        geser,
        angka: (nilai?.textContent || '').trim(),
        meluber: nilai ? nilai.scrollWidth > nilai.clientWidth + 1 : null,
      }
    })
    expect(hasil.geser, 'angka besar tidak boleh melebarkan layar').toBeLessThanOrEqual(1)
    expect(hasil.angka, 'nominal harus tampil utuh').toContain('1.234.567.890')
    expect(hasil.meluber, 'nominal tidak boleh terpotong').toBe(false)
  })

  test('U6. daftar aksi memakai bahasa manusia, bukan istilah mesin', async ({ page }) => {
    await freshUser(page, 'Fajar')
    await page.goto('/create')
    await expect(page.locator('#bill-title')).toBeVisible({ timeout: 20000 })
    await page.locator('#bill-title').fill('Aksi')
    await page.locator('#item-name-0').fill('Teh')
    await page.locator('#item-price-0').fill('5000')
    await page.getByRole('button', { name: 'Buat bill' }).click()
    await expect(page).toHaveURL(/\/b\//, { timeout: 20000 })

    await page.getByRole('button', { name: 'Aksi lain' }).click()
    const sheet = page.getByRole('dialog')
    await expect(sheet).toBeVisible({ timeout: 20000 })
    const teks = await sheet.innerText()

    for (const jargon of ['undefined', 'null', 'NaN', '{}', 'API', 'payload', 'error 4', 'error 5']) {
      expect(teks.toLowerCase(), 'tidak boleh ada istilah mesin: ' + jargon).not.toContain(jargon.toLowerCase())
    }
    // Setiap baris aksi harus punya label yang bisa dibaca, bukan tombol kosong.
    const kosong = await sheet.locator('button').evaluateAll((semua) =>
      semua.filter((b) => (b.textContent || '').trim().length === 0 && !b.getAttribute('aria-label')).length)
    expect(kosong, 'tidak boleh ada tombol tanpa label').toBe(0)
  })
})
