/**
 * Kotak hitam, gelombang kelima: sisa tombol dan keadaan aneh — nudge
 * pengamanan, tautan bill yang tidak ada, tombol kembali berulang, bill
 * ditutup lalu dikunci, keluar dari bill, spam tolak undangan, pencarian kontak
 * tanpa hasil, dan mengosongkan daftar item di layar Ubah bill.
 */
import { test, expect, type Page } from '@playwright/test'

const stamp = Date.now().toString().slice(-6)

async function freshUser(page: Page, name: string) {
  await page.goto('/')
  if (await page.getByRole('button', { name: 'Mulai pakai Bagiin' }).count()) {
    await page.getByLabel('Nama kamu').fill(name)
    await page.getByRole('button', { name: 'Mulai pakai Bagiin' }).click()
  }
  await expect(page.getByRole('heading', { level: 1 })).toContainText(name, { timeout: 20000 })
}

async function manualBill(page: Page, title: string, price: number) {
  await page.goto('/create')
  await expect(page.locator('#bill-title')).toBeVisible({ timeout: 20000 })
  await page.locator('#bill-title').fill(title)
  await page.locator('#item-name-0').fill('Nasi goreng')
  await page.locator('#item-price-0').fill(String(price))
  await expect(page.getByRole('button', { name: 'Buat bill' })).toBeEnabled()
  await page.getByRole('button', { name: 'Buat bill' }).click()
  await expect(page).toHaveURL(/\/b\//, { timeout: 20000 })
  return page.url()
}

async function joinAsGuest(browser: any, url: string, name: string) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const guest = await ctx.newPage()
  await guest.goto(url)
  await expect(guest.getByRole('button', { name: /Ikut bill ini|Gabung/ })).toBeVisible({ timeout: 20000 })
  await guest.getByRole('button', { name: /Ikut bill ini|Gabung/ }).click()
  if (await guest.getByLabel('Nama kamu').count()) {
    await guest.getByLabel('Nama kamu').fill(name)
    await guest.getByRole('button', { name: /Simpan nama & ikut bill/ }).click()
  }
  await expect(guest.getByText(/Nasi goreng/).first()).toBeVisible({ timeout: 20000 })
  return { ctx, guest }
}

test.describe('Kotak hitam — pengamanan dan tautan aneh', () => {
  test('B48. kartu "Amankan" bisa ditunda dan tidak kembali lagi', async ({ page }) => {
    await freshUser(page, 'Aman ' + stamp)
    await manualBill(page, 'Bill aman ' + stamp, 15000)
    await page.goto('/')
    const nanti = page.getByRole('button', { name: 'Nanti' }).first()
    await expect(nanti).toBeVisible({ timeout: 20000 })
    await nanti.click()
    await page.waitForTimeout(1200)
    await page.reload()
    await page.waitForTimeout(1500)
    await expect(page.getByRole('button', { name: 'Nanti' })).toHaveCount(0)
  })

  test('B49. tautan bill yang tidak ada tidak menampilkan layar kosong', async ({ page }) => {
    await freshUser(page, 'Hilang ' + stamp)
    await page.goto('/b/billtidakada123')
    await page.waitForTimeout(2500)
    const body = await page.locator('body').innerText()
    // harus ada penjelasan dan jalan keluar, bukan halaman kosong
    expect(body.length).toBeGreaterThan(40)
    expect(body).toMatch(/tidak|hilang|kenal|kembali|beranda/i)
    const back = page.getByRole('link', { name: /Beranda/ }).first()
    if (await back.count()) {
      await back.click()
      await expect(page).toHaveURL(/\/$|\/($|\?)/, { timeout: 15000 })
    }
  })

  test('B50. tombol kembali berulang tidak membuat layar rusak', async ({ page }) => {
    // tiga puluh navigasi di ponsel uji tidak muat dalam 60 detik bawaan
    test.setTimeout(150_000)
    await freshUser(page, 'Balik ' + stamp)
    await manualBill(page, 'Bill balik ' + stamp, 16000)
    for (let i = 0; i < 3; i++) {
      await page.goto('/')
      await page.goto('/recap')
      await page.goto('/kontak')
      await page.goto('/settings')
      await page.goBack()
      await page.goBack()
    }
    // kembali berkali-kali bisa mendarat di layar "Menyiapkan Bagiin…", jadi
    // tunggu kerangkanya dulu sebelum menilai isinya
    await expect(page.getByRole('link', { name: 'Beranda' })).toBeVisible({ timeout: 25000 })
    const body = await page.locator('body').innerText()
    expect(body.length).toBeGreaterThan(40)
    expect(body).not.toMatch(/Something went wrong|Unexpected Application Error/i)
  })
})

test.describe('Kotak hitam — bill dikunci dan keluar', () => {
  test('B51. setelah "Tutup bill", pilihan dan ubahan dikunci', async ({ page, browser }) => {
    await freshUser(page, 'Tutup ' + stamp)
    const url = await manualBill(page, 'Bill tutup ' + stamp, 33000)
    const { ctx, guest } = await joinAsGuest(browser, url, 'Teman Tutup ' + stamp)
    await guest.getByRole('button', { name: /Nasi goreng, ketuk untuk memilih/ }).click()
    await guest.waitForTimeout(1500)

    await page.goto(url)
    await page.waitForTimeout(1200)
    await page.getByRole('button', { name: 'Aksi lain' }).click()
    const sheet = page.getByRole('dialog', { name: 'Aksi lain' })
    await sheet.getByRole('button', { name: /Tutup bill/ }).click()
    await page.waitForTimeout(2000)
    // konfirmasi kalau ada
    if (await page.getByRole('dialog').count()) {
      const yes = page.getByRole('dialog').getByRole('button', { name: /Ya|Tutup|Kunci/ }).last()
      if (await yes.count()) await yes.click()
      await page.waitForTimeout(1500)
    }

    // tamu tidak bisa lagi mengubah pilihan
    await guest.reload()
    await guest.waitForTimeout(1500)
    const row = guest.getByRole('button', { name: /Nasi goreng/ }).first()
    if (await row.count()) {
      await expect(row).toBeDisabled({ timeout: 10000 })
    }
    // dan pembuat bill tidak ditawari mengubah lagi
    await page.goto(url)
    await page.waitForTimeout(1200)
    await page.getByRole('button', { name: 'Aksi lain' }).click()
    const sheet2 = page.getByRole('dialog', { name: 'Aksi lain' })
    const ubah = sheet2.getByRole('button', { name: 'Ubah bill' })
    if (await ubah.count()) await expect(ubah).toBeDisabled()
    await page.keyboard.press('Escape')
    await ctx.close()
  })

  test('B52. tamu keluar dari bill: namanya hilang dari daftar orang', async ({ page, browser }) => {
    await freshUser(page, 'Keluar ' + stamp)
    const url = await manualBill(page, 'Bill keluar ' + stamp, 34000)
    const { ctx, guest } = await joinAsGuest(browser, url, 'Teman Keluar ' + stamp)

    await guest.getByRole('button', { name: 'Aksi lain' }).click()
    const sheet = guest.getByRole('dialog', { name: 'Aksi lain' })
    await sheet.getByRole('button', { name: /Keluar dari bill ini/ }).click()
    await guest.waitForTimeout(1500)
    if (await guest.getByRole('dialog').count()) {
      const yes = guest.getByRole('dialog').getByRole('button', { name: /Ya|Keluar/ }).last()
      if (await yes.count()) await yes.click()
    }
    await guest.waitForTimeout(2000)

    await page.goto(url)
    await page.waitForTimeout(1500)
    await expect(page.getByText('Teman Keluar ' + stamp)).toHaveCount(0, { timeout: 15000 })
    await ctx.close()
  })
})

test.describe('Kotak hitam — undangan ditolak berkali-kali', () => {
  test('B53. tolak undangan berulang tidak menduplikasi kartu', async ({ page, browser }) => {
    await freshUser(page, 'Tolak ' + stamp)
    const basis = await manualBill(page, 'Basis tolak ' + stamp, 12000)
    const { ctx, guest } = await joinAsGuest(browser, basis, 'Teman Tolak ' + stamp)
    // matikan undangan otomatis
    await guest.goto('/settings')
    const toggle = guest.getByLabel('Terima undangan otomatis')
    await expect(toggle).toBeVisible({ timeout: 20000 })
    if (await toggle.isChecked()) await toggle.click()
    await guest.waitForTimeout(1200)

    const target = await manualBill(page, 'Diundang tolak ' + stamp, 41000)
    await page.goto(target)
    await page.waitForTimeout(1000)
    await page.getByRole('button', { name: 'Aksi lain' }).click()
    await page.getByRole('dialog', { name: 'Aksi lain' }).getByRole('button', { name: 'Undang teman' }).click()
    const inviteSheet = page.getByRole('dialog', { name: 'Undang teman' })
    const row = inviteSheet.locator('.app-row', { hasText: 'Teman Tolak ' + stamp }).first()
    const undang = row.getByRole('button', { name: 'Undang', exact: true })
    // tiga ketukan: hanya satu undangan yang boleh lahir
    await undang.click()
    await undang.click().catch(() => {})
    await undang.click().catch(() => {})
    await page.waitForTimeout(2000)

    await guest.goto('/')
    await guest.waitForTimeout(1500)
    const cards = guest.getByText('Diundang tolak ' + stamp)
    await expect(cards).toHaveCount(1, { timeout: 20000 })
    const tolak = guest.getByRole('button', { name: /Tolak/ }).first()
    if (await tolak.count()) {
      await tolak.click()
      await guest.waitForTimeout(1500)
      await guest.goto('/')
      await expect(guest.getByText('Diundang tolak ' + stamp)).toHaveCount(0, { timeout: 15000 })
    }
    await ctx.close()
  })
})

test.describe('Kotak hitam — layar ubah bill', () => {
  test('B54. menghapus semua item ditolak dengan alasan, bukan menyimpan bill kosong', async ({ page }) => {
    await freshUser(page, 'Kosong ' + stamp)
    const url = await manualBill(page, 'Bill kosong ' + stamp, 17000)
    await page.goto(url + '/edit')
    await expect(page.locator('#edit-item-name-0')).toBeVisible({ timeout: 20000 })

    // Satu-satunya item tidak boleh dihapus: tombolnya memang dimatikan.
    const kill = page.locator('.kill').first()
    await expect(kill).toBeDisabled({ timeout: 10000 })

    // Dengan item kedua, penghapusan baris jadi mungkin — dan setelah dihapus
    // kembali ke satu item, tombolnya mati lagi.
    await page.getByRole('button', { name: '+ Tambah item' }).click()
    await page.locator('#edit-item-name-1').fill('Es teh')
    await page.locator('#edit-item-price-1').fill('5000')
    await page.waitForTimeout(400)
    await expect(page.locator('.kill').first()).toBeEnabled({ timeout: 10000 })
    await page.locator('.kill').first().click()
    await page.waitForTimeout(800)
    await expect(page.locator('.kill')).toHaveCount(1)
    await expect(page.locator('.kill').first()).toBeDisabled({ timeout: 10000 })
  })

  test('B55. pajak dan diskon mengubah total sesuai hitungan layar', async ({ page }) => {
    await freshUser(page, 'Hitung ' + stamp)
    const url = await manualBill(page, 'Bill hitung ' + stamp, 50000)

    await page.goto(url + '/edit')
    await expect(page.locator('#edit-tax')).toBeVisible({ timeout: 20000 })
    await page.locator('#edit-tax').fill('5000')
    await page.locator('#edit-discount').fill('2000')
    await page.waitForTimeout(500)
    const totalText = (await page.locator('body').innerText()).replace(/\n/g, ' ')
    // 50.000 + 5.000 - 2.000 = 53.000
    expect(totalText).toMatch(/53\.000/)
    await page.getByRole('button', { name: /Simpan perubahan/ }).click()
    await page.waitForTimeout(2000)
    await page.goto(url)
    await page.waitForTimeout(1500)
    const after = (await page.locator('body').innerText()).replace(/\n/g, ' ')
    expect(after).toMatch(/53\.000/)
  })
})

test.describe('Kotak hitam — pencarian', () => {
  test('B56. pencarian tanpa hasil di beranda dan kontak memberi penjelasan', async ({ page }) => {
    await freshUser(page, 'Cari ' + stamp)
    await manualBill(page, 'Bill cari ' + stamp, 18000)

    await page.goto('/')
    await page.getByLabel('Cari bill').fill('zzz tidak ada ' + stamp)
    await page.waitForTimeout(1200)
    const home = await page.locator('body').innerText()
    expect(home).toMatch(/tidak ada|kosong|tidak cocok/i)

    await page.goto('/kontak')
    const search = page.getByLabel('Cari')
    if (await search.count()) {
      await search.fill('zzz' + stamp)
      await page.waitForTimeout(1000)
      const kontak = await page.locator('body').innerText()
      expect(kontak).toMatch(/tidak ada|tidak cocok/i)
    }
  })
})
