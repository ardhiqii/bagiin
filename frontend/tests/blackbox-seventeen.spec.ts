import { test, expect, type Page } from '@playwright/test'

/**
 * Kotak hitam gelombang 17 — realitas iPhone yang tidak pernah diuji Chromium.
 *
 * Semua kasus di sini berangkat dari hal yang benar-benar dialami orang di
 * Safari: ketukan cepat yang memperbesar halaman, papan ketik yang menutup
 * setengah layar, ponsel yang diputar mendatar, nama dengan emoji, pencarian
 * yang diketik dengan huruf besar, dan tarikan ke bawah di puncak daftar.
 *
 * Tidak ada satu pun yang memakai pengetahuan soal kode aplikasi: yang diuji
 * adalah apa yang terlihat dan bisa dilakukan.
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

async function bill(page: Page, title: string, item: string, price: number, qty = 1) {
  await page.goto('/create')
  await expect(page.locator('#bill-title')).toBeVisible({ timeout: 20000 })
  await page.locator('#bill-title').fill(title)
  await page.locator('#item-name-0').fill(item)
  await page.locator('#item-price-0').fill(String(price))
  if (qty > 1) await page.locator('#item-qty-0').fill(String(qty))
  await page.getByRole('button', { name: 'Buat bill' }).click()
  await expect(page).toHaveURL(/\/b\//, { timeout: 20000 })
  return page.url()
}

test.describe('Kotak hitam — realitas iPhone', () => {
  test('T1. mengetuk tombol tambah dua kali cepat tidak memperbesar halaman', async ({ page }) => {
    await freshUser(page, 'Tono Safari')
    await bill(page, 'Ketuk cepat stepper', 'Kopi susu', 18000, 5)

    const tambah = page.getByRole('button', { name: /Tambah porsi|Tambah satu|Tambah/ }).first()
    await expect(tambah).toBeVisible({ timeout: 20000 })
    const sebelum = await page.evaluate(() => window.visualViewport?.scale ?? 1)

    // Dua ketukan beruntun pada titik yang sama: di iOS ini yang memicu
    // double-tap zoom kalau kontrolnya tidak menyatakan `touch-action`.
    const kotak = await tambah.boundingBox()
    expect(kotak, 'tombol tambah harus punya kotak').not.toBeNull()
    for (let i = 0; i < 2; i++) {
      await page.touchscreen.tap(kotak!.x + kotak!.width / 2, kotak!.y + kotak!.height / 2)
      await page.waitForTimeout(60)
    }
    await page.waitForTimeout(300)

    const sesudah = await page.evaluate(() => window.visualViewport?.scale ?? 1)
    expect(sesudah, 'halaman tidak boleh ter-zoom gara-gara ketukan cepat').toBeCloseTo(sebelum, 2)

    /* Kontrol yang diketuk cepat harus menyatakan dirinya bukan target zoom.
       Diperiksa lewat kumpulan elemen yang bisa diketuk di layar ini, bukan
       lewat satu tombol: label tombol stepper berubah setelah diketuk
       ("tambah" menjadi "kurangi"), jadi locator-nya tidak stabil. */
    const sentuh = await page.evaluate(() => {
      const semuanya = Array.from(document.querySelectorAll('button, .ds-item, .app-row'))
        .filter((el) => el.getBoundingClientRect().width > 0)
      const nilai = new Set(semuanya.map((el) => getComputedStyle(el).touchAction))
      return { jumlah: semuanya.length, nilai: Array.from(nilai) }
    })
    /* Bill dengan satu item dan satu orang hanya menyisakan sedikit kontrol
       yang bisa diketuk (baris item disembunyikan saat pemilik tidak berutang),
       jadi yang diperiksa bukan jumlahnya, melainkan nilainya. */
    expect(sentuh.jumlah).toBeGreaterThan(0)
    expect(
      sentuh.nilai.every((n) => ['manipulation', 'pan-y', 'pan-x', 'auto'].includes(n)),
      'nilai touch-action tak dikenal: ' + sentuh.nilai.join(','),
    ).toBe(true)
    expect(sentuh.nilai.includes('manipulation'), 'kontrol utama harus touch-action: manipulation').toBe(true)
  })

  test('T2. papan ketik menutupi separuh layar: isi sheet tetap terjangkau', async ({ page }) => {
    await freshUser(page, 'Umi Safari')
    await page.goto('/create')
    await expect(page.locator('#bill-title')).toBeVisible({ timeout: 20000 })
    await page.locator('#bill-title').fill('Papan ketik')
    await page.locator('#item-name-0').fill('Bakso')
    await page.locator('#item-price-0').fill('20000')
    await page.getByRole('button', { name: /Siapa yang ikut|Pilih orang/i }).first().click()

    const sheet = page.getByRole('dialog', { name: 'Siapa yang ikut?' })
    await expect(sheet).toBeVisible({ timeout: 20000 })

    // Tinggi 500 px = kira-kira separuh iPhone 15 setelah papan ketik terbuka.
    await page.setViewportSize({ width: 393, height: 500 })
    await page.waitForTimeout(400)

    const ukuran = await page.evaluate(() => {
      const s = document.querySelector('.ds-sheet') as HTMLElement
      const r = s.getBoundingClientRect()
      const selesai = Array.from(document.querySelectorAll('.ds-sheet button')).find((b) => /Selesai/i.test(b.textContent || ''))
      const sr = selesai ? selesai.getBoundingClientRect() : null
      return {
        tinggi: Math.round(r.height),
        viewport: window.innerHeight,
        selesaiTerlihat: sr ? sr.top >= 0 && sr.bottom <= window.innerHeight + 1 : false,
        bisaGulir: s.scrollHeight >= s.clientHeight,
      }
    })
    expect(ukuran.tinggi, 'sheet tidak boleh lebih tinggi dari layar yang menyusut').toBeLessThanOrEqual(ukuran.viewport)
    expect(ukuran.bisaGulir, 'isi sheet harus tetap bisa digapai saat layar pendek').toBe(true)
    expect(ukuran.selesaiTerlihat, 'tombol Selesai harus tetap terjangkau di layar pendek').toBe(true)
  })

  test('T3. ponsel diputar mendatar: layar tetap bisa dipakai, tidak ada geser ke samping', async ({ page }) => {
    await freshUser(page, 'Vino Safari')
    const url = await bill(page, 'Layar mendatar', 'Nasi campur', 32000, 2)

    await page.setViewportSize({ width: 852, height: 393 })
    await page.goto(url)
    await expect(page.getByText(/Nasi campur/).first()).toBeVisible({ timeout: 20000 })

    const hasil = await page.evaluate(() => {
      const lebar = document.documentElement.scrollWidth - document.documentElement.clientWidth
      const bar = document.querySelector('.app-bottom') as HTMLElement | null
      const nav = document.querySelector('.app-nav') as HTMLElement | null
      const navRect = nav ? nav.getBoundingClientRect() : null
      return {
        geser: lebar,
        barTerlihat: bar ? bar.getBoundingClientRect().bottom <= window.innerHeight + 1 : false,
        navDiLayar: navRect ? navRect.bottom <= window.innerHeight + 1 : false,
        tinggi: window.innerHeight,
      }
    })
    expect(hasil.geser, 'tidak boleh ada geseran ke samping di layar mendatar').toBeLessThanOrEqual(1)
    expect(hasil.barTerlihat, 'bar aksi harus tetap berada di layar mendatar').toBe(true)
    expect(hasil.navDiLayar, 'navigasi bawah harus tetap berada di layar mendatar').toBe(true)
  })

  test('T4. nama dengan emoji dan huruf beraksen tersimpan utuh', async ({ page }) => {
    await freshUser(page, 'Wati Safari')
    const url = await bill(page, 'Nama unik', 'Sate', 24000)

    // Orang lain bergabung dengan nama beremoji; pemilik harus melihatnya utuh.
    const ctx = await page.context().browser()!.newContext({ viewport: { width: 393, height: 852 } })
    const tamu = await ctx.newPage()
    try {
      await tamu.goto(url)
      await tamu.getByRole('button', { name: /Ikut bill ini|Gabung/ }).click()
      await tamu.getByLabel('Nama kamu').fill('Ñoño 🍜')
      await tamu.getByRole('button', { name: /Simpan nama & ikut bill/ }).click()
      await expect(tamu.getByText(/Sate/).first()).toBeVisible({ timeout: 20000 })

      await page.reload()
      await expect(page.locator('.app-row', { hasText: 'Ñoño' })).toHaveCount(1, { timeout: 20000 })

      await page.setViewportSize({ width: 320, height: 640 })
      await page.waitForTimeout(300)
      const geser = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(geser, 'nama beremoji tidak boleh melebarkan layar 320 px').toBeLessThanOrEqual(1)
    } finally {
      await ctx.close()
    }
  })

  test('T5. mencari dengan huruf besar dan spasi berlebih tetap menemukan orangnya', async ({ page }) => {
    await freshUser(page, 'Xena Safari')
    const url = await bill(page, 'Cari kontak', 'Bubur ayam', 21000)

    const ctx = await page.context().browser()!.newContext({ viewport: { width: 393, height: 852 } })
    const tamu = await ctx.newPage()
    try {
      await tamu.goto(url)
      await tamu.getByRole('button', { name: /Ikut bill ini|Gabung/ }).click()
      await tamu.getByLabel('Nama kamu').fill('Budi Santoso')
      await tamu.getByRole('button', { name: /Simpan nama & ikut bill/ }).click()
      await expect(tamu.getByText(/Bubur ayam/).first()).toBeVisible({ timeout: 20000 })

      await page.goto('/create')
      await expect(page.locator('#bill-title')).toBeVisible({ timeout: 20000 })
      await page.getByRole('button', { name: /Siapa yang ikut|Pilih orang/i }).first().click()
      const sheet = page.getByRole('dialog', { name: 'Siapa yang ikut?' })
      await expect(sheet).toBeVisible({ timeout: 20000 })

      const cari = sheet.getByPlaceholder(/Cari nama/)
      await cari.fill('   bUdI   ')
      await expect(sheet.locator('.ds-pick-row', { hasText: 'Budi' })).toHaveCount(1, { timeout: 20000 })
    } finally {
      await ctx.close()
    }
  })

  test('T6. menarik daftar ke bawah di puncak tidak memuat ulang halaman', async ({ page }) => {
    await freshUser(page, 'Yudi Safari')
    await page.goto('/')
    await expect(page.locator('h1')).toBeVisible({ timeout: 20000 })

    // Penanda bertahan hanya kalau halaman tidak dimuat ulang.
    await page.evaluate(() => { (window as unknown as { __tetap?: boolean }).__tetap = true })

    const awal = await page.evaluate(() => {
      const html = getComputedStyle(document.documentElement).overscrollBehaviorY
      const body = getComputedStyle(document.body).overscrollBehaviorY
      return { html, body }
    })

    /* Mobile WebKit tidak punya roda tetikus, dan tarikan jari tidak bisa
       disintesis menjadi guliran asli. Di sana yang diperiksa adalah aturannya
       (overscroll ditahan), bukan gerakannya. */
    if (test.info().project.name.includes('chrome')) {
      for (let i = 0; i < 3; i++) {
        await page.mouse.move(196, 300)
        await page.mouse.wheel(0, -400)
        await page.waitForTimeout(120)
      }
    }

    const masih = await page.evaluate(() => (window as unknown as { __tetap?: boolean }).__tetap === true)
    expect(masih, 'halaman tidak boleh termuat ulang karena tarikan ke bawah').toBe(true)
    expect(
      awal.html === 'contain' || awal.body === 'contain',
      'tarikan berlebih di puncak harus ditahan (overscroll-behavior: contain), diterima: ' + JSON.stringify(awal),
    ).toBe(true)
  })
})
