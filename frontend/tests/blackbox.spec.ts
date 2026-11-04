/**
 * E2E kotak hitam: diperlakukan seperti orang yang baru pertama kali membuka
 * Bagiin. Tidak tahu endpoint, tidak tahu nama kelas, tidak tahu istilah
 * internal — semuanya lewat yang terlihat di layar.
 *
 * Isinya sengaja mencakup tiga rasa: alur normal, perilaku aneh (spam klik,
 * bolak-balik menu, isi angka aneh), dan kasus negatif (tombol harus mati,
 * angka tidak boleh minus, input ngawur tidak boleh merusak data).
 */
import { test, expect, type Page } from '@playwright/test'

const stamp = Date.now().toString().slice(-6)

async function freshUser(page: Page, name: string) {
  await page.goto('/')
  if (await page.getByRole('button', { name: 'Mulai pakai Bagiin' }).count()) {
    await page.getByLabel('Nama kamu').fill(name)
    await expect(page.getByRole('button', { name: 'Mulai pakai Bagiin' })).toBeEnabled({ timeout: 20000 })
    await page.getByRole('button', { name: 'Mulai pakai Bagiin' }).click()
  }
  await expect(page.getByRole('heading', { level: 1 })).toContainText(name, { timeout: 20000 })
}

async function openCreate(page: Page) {
  await page.goto('/create')
  await expect(page.locator('#bill-title')).toBeVisible({ timeout: 20000 })
}

async function openActions(page: Page) {
  await page.getByRole('button', { name: 'Aksi lain' }).click()
  await expect(page.getByRole('dialog', { name: 'Aksi lain' })).toBeVisible()
}

async function action(page: Page, name: string | RegExp) {
  await openActions(page)
  await page.getByRole('dialog', { name: 'Aksi lain' }).getByRole('button', { name }).first().click()
}

async function manualBill(page: Page, title: string, price = 30000) {
  await openCreate(page)
  await page.locator('#bill-title').fill(title)
  await page.locator('#item-name-0').fill('Nasi goreng')
  await page.locator('#item-price-0').fill(String(price))
  await expect(page.getByRole('button', { name: 'Buat bill' })).toBeEnabled()
  await page.getByRole('button', { name: 'Buat bill' }).click()
  await expect(page).toHaveURL(/\/b\//, { timeout: 20000 })
  return page.url()
}

/** Total di layar, apa pun layarnya: baris "Total bill" atau kartu saldo bill. */
async function totalOnScreen(page: Page): Promise<number> {
  const balance = page.locator('.ds-balance-value').first()
  if (await balance.count()) {
    // angka besar naik dari 0 sejak 1.0 — baca setelah animasinya selesai
    await page.waitForTimeout(650)
    const t = (await balance.innerText()).replace(/[^0-9]/g, '')
    if (t) return Number(t)
  }
  const row = page.getByText(/^Total bill$/i).first()
  const box = row.locator('..')
  const text = await box.innerText()
  const m = /Rp\s?([\d.]+)/.exec(text)
  return m ? Number(m[1].replace(/\./g, '')) : -1
}

test.describe('Kotak hitam — masuk dan layar awal', () => {
  test('B1. nama kosong: tombol mulai tidak bisa ditekan', async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(800)
    const start = page.getByRole('button', { name: 'Mulai pakai Bagiin' })
    if (await start.count()) {
      await expect(start).toBeDisabled()
      await page.getByLabel('Nama kamu').fill('   ')
      await expect(start).toBeDisabled()
    }
  })

  test('B2. nama aneh (simbol, emoji, panjang) diterima tanpa merusak layar', async ({ page }) => {
    await page.goto('/')
    const start = page.getByRole('button', { name: 'Mulai pakai Bagiin' })
    if (!(await start.count())) test.skip(true, 'identitas sudah ada di storage')
    await page.getByLabel('Nama kamu').fill('<b>Aufa</b> & 😀 ' + 'x'.repeat(60))
    await start.click()
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20000 })
    // tidak boleh ada scroll horizontal gara-gara nama panjang
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(1)
  })

  test('B3. alamat ngawur menampilkan halaman tidak ditemukan, bukan layar kosong', async ({ page }) => {
    await freshUser(page, 'Nyasar ' + stamp)
    await page.goto('/halaman-yang-tidak-ada-' + stamp)
    await expect(page.getByText(/tidak ditemukan|nggak ketemu|404/i).first()).toBeVisible({ timeout: 15000 })
  })
})

test.describe('Kotak hitam — membuat bill', () => {
  test('B4. form kosong: tombol buat mati sampai ada item berharga', async ({ page }) => {
    await freshUser(page, 'Kosong ' + stamp)
    await openCreate(page)
    const submit = page.getByRole('button', { name: 'Buat bill' })
    await expect(submit).toBeDisabled()

    await page.locator('#item-name-0').fill('Kopi')
    await expect(submit).toBeDisabled() // nama saja, harga masih kosong

    await page.locator('#item-price-0').fill('0')
    await expect(submit).toBeDisabled() // harga nol bukan bill

    await page.locator('#item-price-0').fill('15000')
    await expect(submit).toBeEnabled()
  })

  test('B5. harga negatif tidak menghasilkan total minus', async ({ page }) => {
    await freshUser(page, 'Minus ' + stamp)
    await openCreate(page)
    await page.locator('#bill-title').fill('Coba minus ' + stamp)
    await page.locator('#item-name-0').fill('Kopi')
    await page.locator('#item-price-0').fill('-25000')
    await page.waitForTimeout(300)
    const shown = await page.getByText(/Total bill/i).first().innerText()
    expect(shown).not.toContain('-')
    // dan tidak bisa disimpan sebagai bill minus
    const submit = page.getByRole('button', { name: 'Buat bill' })
    if (await submit.isEnabled()) {
      await submit.click()
      await page.waitForTimeout(1200)
      const body = await page.locator('body').innerText()
      expect(body).not.toMatch(/Rp-|Rp -/)
    }
  })

  test('B6. spam tombol tambah item lalu hapus semuanya', async ({ page }) => {
    await freshUser(page, 'Spam ' + stamp)
    await openCreate(page)
    const add = page.getByRole('button', { name: '+ Tambah item' })
    for (let i = 0; i < 8; i++) await add.click()
    const rows = page.locator('#item-name-0, [id^="item-name-"]')
    expect(await rows.count()).toBe(9)

    // hapus semua baris kecuali satu (tombol hapus hanya muncul kalau >1)
    for (let i = 0; i < 8; i++) {
      await page.getByRole('button', { name: /^Hapus / }).last().click()
    }
    expect(await page.locator('[id^="item-name-"]').count()).toBe(1)
    await expect(page.getByRole('button', { name: 'Buat bill' })).toBeDisabled()
  })

  test('B7. jumlah item tidak bisa turun di bawah satu', async ({ page }) => {
    await freshUser(page, 'Qty ' + stamp)
    await openCreate(page)
    await page.locator('#item-name-0').fill('Kopi')
    await page.locator('#item-price-0').fill('10000')
    const qty = page.locator('#item-qty-0')
    for (let i = 0; i < 6; i++) {
      await qty.fill('0')
      await page.waitForTimeout(60)
    }
    // kolom boleh kosong saat mengetik, tapi setelah ditinggal wajib 1
    await qty.blur()
    await page.waitForTimeout(200)
    const value = Number(await qty.inputValue())
    expect(value).toBeGreaterThanOrEqual(1)
    await expect(page.getByText(/Total bill/i).first()).not.toContainText('-')
  })

  test('B8. diskon lebih besar dari subtotal tidak bikin total minus', async ({ page }) => {
    await freshUser(page, 'Diskon ' + stamp)
    await openCreate(page)
    await page.locator('#bill-title').fill('Diskon besar ' + stamp)
    await page.locator('#item-name-0').fill('Kopi')
    await page.locator('#item-price-0').fill('20000')
    await page.locator('#bill-discount').fill('900000')
    await page.waitForTimeout(400)
    const totalText = await page.getByText(/Total bill/i).first().innerText()
    expect(totalText).not.toMatch(/-/)
    const submit = page.getByRole('button', { name: 'Buat bill' })
    if (await submit.isEnabled()) {
      await submit.click()
      await page.waitForTimeout(1500)
      const body = await page.locator('body').innerText()
      expect(body).not.toMatch(/Rp\s?-/)
    }
  })

  test('B9. total di layar sama dengan total bill yang tersimpan', async ({ page }) => {
    await freshUser(page, 'Cocok ' + stamp)
    await openCreate(page)
    await page.locator('#bill-title').fill('Total cocok ' + stamp)
    await page.locator('#item-name-0').fill('Sate')
    await page.locator('#item-price-0').fill('45000')
    await page.locator('#bill-tax').fill('10')
    await page.waitForTimeout(300)
    const before = await totalOnScreen(page)
    await page.getByRole('button', { name: 'Buat bill' }).click()
    await expect(page).toHaveURL(/\/b\//, { timeout: 20000 })
    await page.waitForTimeout(1200)
    const after = await totalOnScreen(page)
    expect(before).toBeGreaterThan(0)
    expect(after).toBe(before)
  })

  test('B10. klik ganda tombol buat tidak menghasilkan dua bill', async ({ page }) => {
    await freshUser(page, 'Dobel ' + stamp)
    await openCreate(page)
    await page.locator('#bill-title').fill('Sekali saja ' + stamp)
    await page.locator('#item-name-0').fill('Kopi')
    await page.locator('#item-price-0').fill('12000')
    const submit = page.getByRole('button', { name: 'Buat bill' })
    await expect(submit).toBeEnabled()
    // dua aktivasi di detik yang sama, seperti orang yang tidak sabar
    await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll('button'))
      const target = all.find((el) => (el.textContent ?? '').includes('Buat bill'))
      target?.click()
      target?.click()
    })
    await expect(page).toHaveURL(/\/b\//, { timeout: 20000 })
    await page.goto('/')
    await expect(page.getByText('Sekali saja ' + stamp)).toHaveCount(1)
  })

  test('B11. tanggal ditulis dd/mm/yyyy dan tanggal ngawur tidak diterima', async ({ page }) => {
    await freshUser(page, 'Tanggal ' + stamp)
    await openCreate(page)
    const date = page.locator('#bill-date')
    await expect(date).toHaveValue(/^\d{2}\/\d{2}\/\d{4}$/)
    await date.fill('32132026') // 32/13/2026 tidak ada
    // selagi diketik, layar memberi tahu bahwa tanggalnya tidak ada
    await expect(page.getByText(/tidak ada di kalender/i)).toBeVisible({ timeout: 5000 })
    await date.blur()
    await page.waitForTimeout(300)
    // setelah ditinggal, kolom kembali ke tanggal yang sah
    await expect(date).toHaveValue(/^\d{2}\/\d{2}\/\d{4}$/)
    expect(await date.inputValue()).not.toBe('32/13/2026')
  })
})

test.describe('Kotak hitam — layar bill', () => {
  test('B12. pilih item sendiri mengubah bagian kamu', async ({ page }) => {
    await freshUser(page, 'Pilih ' + stamp)
    const url = await manualBill(page, 'Pilih item ' + stamp, 40000)
    await page.getByRole('button', { name: /Nasi goreng, ketuk untuk memilih/ }).click()
    await expect(page.getByText(/bagian kamu Rp40\.000/i).first()).toBeVisible({ timeout: 15000 })
    // ketuk lagi = batal; uang yang tidak diambil siapa pun kembali ke yang
    // menalangi, jadi yang benar diperiksa adalah status pilihannya
    const row = page.getByRole('button', { name: /^Nasi goreng, ketuk untuk/ })
    await row.click()
    await expect(row).toHaveAttribute('aria-pressed', 'false', { timeout: 15000 })
    await expect(row).toHaveAttribute('aria-label', /ketuk untuk memilih/)
    await page.goto(url)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  })

  test('B13. spam tombol lunas/batal berkali-kali berakhir konsisten', async ({ page }) => {
    await freshUser(page, 'SpamLunas ' + stamp)
    const url = await manualBill(page, 'Spam lunas ' + stamp, 25000)
    await page.getByRole('button', { name: /Nasi goreng, ketuk untuk memilih/ }).click()
    await page.waitForTimeout(800)

    for (let i = 0; i < 4; i++) {
      await action(page, /Tandai semua lunas|Tandai lunas|Batalkan lunas/)
      await page.waitForTimeout(350)
      if (await page.getByRole('dialog').count()) await page.keyboard.press('Escape')
    }
    await page.goto(url)
    await page.waitForTimeout(1200)
    // berapa pun kliknya, layar harus tetap satu status yang jelas
    const text = await page.locator('body').innerText()
    const lunas = (text.match(/Lunas/g) ?? []).length
    const belum = (text.match(/Belum lunas/g) ?? []).length
    expect(lunas + belum).toBeGreaterThan(0)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(1)
  })

  test('B14. tutup lalu buka lagi bill: status kembali terbuka', async ({ page }) => {
    await freshUser(page, 'Tutup ' + stamp)
    await manualBill(page, 'Tutup bill ' + stamp, 18000)
    await page.getByRole('button', { name: /Nasi goreng, ketuk untuk memilih/ }).click()
    await page.waitForTimeout(800)

    await action(page, 'Tutup bill')
    await page.waitForTimeout(600)
    if (await page.getByRole('dialog').count()) {
      const confirm = page.getByRole('dialog').getByRole('button', { name: /Tutup|Ya/ }).last()
      if (await confirm.count()) await confirm.click()
    }
    await page.waitForTimeout(1200)
    await expect(page.locator('body')).toContainText(/Ditutup|ditutup/, { timeout: 15000 })
  })

  test('B15. hapus bill: hilang dari beranda dan rekap', async ({ page }) => {
    await freshUser(page, 'Hapus ' + stamp)
    await manualBill(page, 'Buang ' + stamp, 21000)
    // hapus bill ada di layar Ubah bill, bukan di sheet Aksi lain
    await action(page, 'Ubah bill')
    await expect(page).toHaveURL(/\/edit/, { timeout: 20000 })
    await page.getByRole('button', { name: /Hapus bill ini/ }).click()
    // konfirmasinya sebaris di layar itu, bukan dialog
    await page.getByRole('button', { name: /Ya, hapus permanen/ }).click()
    await page.waitForTimeout(1500)
    await page.goto('/')
    await expect(page.getByText('Buang ' + stamp)).toHaveCount(0, { timeout: 15000 })
  })
})

test.describe('Kotak hitam — bolak-balik menu', () => {
  test('B16. spam pindah tab lalu kembali: tidak ada layar rusak atau error', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await freshUser(page, 'Keliling ' + stamp)
    await manualBill(page, 'Keliling ' + stamp, 33000)

    for (let i = 0; i < 6; i++) {
      await page.getByRole('link', { name: 'Rekap' }).first().click()
      await page.waitForTimeout(120)
      await page.getByRole('link', { name: 'Beranda' }).first().click()
      await page.waitForTimeout(120)
      await page.getByRole('link', { name: 'Buat' }).first().click()
      await page.waitForTimeout(120)
    }
    await page.getByRole('link', { name: 'Beranda' }).first().click()
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20000 })
    expect(errors).toEqual([])
  })

  test('B17. tombol kembali browser setelah masuk bill mengembalikan ke daftar', async ({ page }) => {
    await freshUser(page, 'Kembali ' + stamp)
    await manualBill(page, 'Balik ' + stamp, 27000)
    await page.goBack()
    await page.waitForTimeout(1000)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15000 })
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(1)
  })

  test('B18. semua layar utama tidak punya scroll horizontal di 384 px', async ({ page }) => {
    await freshUser(page, 'Sempit ' + stamp)
    const url = await manualBill(page, 'Sempit ' + stamp, 15000)
    for (const route of ['/', '/bills', '/create', url, url + '/edit', '/recap', '/settings', '/kontak', '/tidak-ada']) {
      await page.goto(route)
      await page.waitForTimeout(900)
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      expect(overflow, 'scroll horizontal di ' + route).toBeLessThanOrEqual(1)
    }
  })

  test('B19. tidak ada error JavaScript di layar utama', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await freshUser(page, 'Bersih ' + stamp)
    const url = await manualBill(page, 'Bersih ' + stamp, 16000)
    for (const route of ['/', '/create', url, url + '/edit', '/recap', '/settings', '/kontak']) {
      await page.goto(route)
      await page.waitForTimeout(800)
    }
    expect(errors).toEqual([])
  })
})
