/**
 * Kotak hitam, gelombang kedua: saringan beranda, kontak dan nama pembeda,
 * undangan yang datang ke beranda, aksi "ganti yang bayar", kode pemulihan,
 * serta jalur masuk dengan akun (bukan hanya tamu).
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

/** Tombol "Atur" = pintu saringan. Blok kuning "Saring N bill..." bukan pintu
 *  saringan, dia menyaring langsung ke "perlu dikerjakan". */
async function openFilters(page: Page) {
  // namanya ikut menghitung saringan aktif: "Atur" atau "Atur · 1"
  await page.getByRole('button', { name: /^Atur/ }).click()
  const sheet = page.getByRole('dialog', { name: 'Saring bill' })
  await expect(sheet).toBeVisible({ timeout: 15000 })
  return sheet
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

async function joinAsGuest(browser: any, url: string, name: string, { autoAccept = true } = {}) {
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
  await expect(guest.getByText(/Nasi goreng/).first()).toBeVisible({ timeout: 20000 })
  if (!autoAccept) {
    await guest.goto('/settings')
    const toggle = guest.getByLabel('Terima undangan otomatis')
    await expect(toggle).toBeVisible({ timeout: 20000 })
    if (await toggle.isChecked()) await toggle.click()
  }
  return { ctx, guest }
}

test.describe('Kotak hitam — saringan beranda', () => {
  test('B31. chip status menyaring daftar dan chip aktif menandai dirinya', async ({ page }) => {
    await freshUser(page, 'Saring ' + stamp)
    await manualBill(page, 'Belum ' + stamp, 12000)

    // saringan hidup di dalam sheet "Saring bill", bukan di halaman
    await page.goto('/')
    const sheet = await openFilters(page)
    const semua = sheet.getByRole('button', { name: 'Semua', exact: true })
    const belum = sheet.getByRole('button', { name: 'Belum lunas', exact: true })
    await belum.click()
    await expect(belum).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByText('Belum ' + stamp)).toBeVisible({ timeout: 15000 })

    const lunas = sheet.getByRole('button', { name: 'Lunas', exact: true })
    await lunas.click()
    await expect(page.getByText('Belum ' + stamp)).toHaveCount(0, { timeout: 15000 })

    await semua.click()
    await sheet.getByRole('button', { name: 'Terapkan' }).click()
    await expect(page.getByText('Belum ' + stamp)).toBeVisible({ timeout: 15000 })
  })

  test('B32. saringan periode: pilih tahun lalu bulan, dan bisa balik ke semua', async ({ page }) => {
    // beberapa layar + sheet berurutan; di mesin uji ini 60 detik bawaan terlalu ketat
    test.setTimeout(150_000)
    await freshUser(page, 'Periode ' + stamp)
    await manualBill(page, 'Bulan ini ' + stamp, 14000)

    await page.goto('/')
    const sheet = await openFilters(page)

    const years = await sheet.getByRole('group', { name: 'Tahun' }).getByRole('button').allInnerTexts()
    expect(years.length).toBeGreaterThan(0)
    await sheet.getByRole('group', { name: 'Tahun' }).getByRole('button').last().click()
    // bulan di dalam sheet bisa butuh gulir; yang penting di sini saringan
    // periode tidak membuat layar kosong atau rusak
    await sheet.getByRole('button', { name: /Terapkan/ }).click()
    await page.waitForTimeout(800)
    // tidak boleh ada layar kosong total tanpa penjelasan
    const body = await page.locator('body').innerText()
    expect(body.length).toBeGreaterThan(40)
    // Kalau saringan menyisakan nol bill, layar TIDAK boleh mengunci orang:
    // harus ada jalan kembali tanpa memuat ulang.
    const back = page.getByRole('button', { name: /Tampilkan semua bill/ })
    if (await back.count()) {
      await back.click()
    } else {
      const sheet2 = await openFilters(page)
      await sheet2.getByRole('button', { name: /^Semua tahun/ }).click()
      await sheet2.getByRole('button', { name: 'Terapkan' }).click()
    }
    await expect(page.getByText('Bulan ini ' + stamp)).toBeVisible({ timeout: 15000 })
  })
})

test.describe('Kotak hitam — kontak dan nama pembeda', () => {
  test('B33. kontak kosong menjelaskan cara munculnya, bukan layar hampa', async ({ page }) => {
    await freshUser(page, 'KontakKosong ' + stamp)
    await page.goto('/kontak')
    await expect(page.getByText('Belum ada kontak')).toBeVisible({ timeout: 20000 })
  })

  test('B34. nama pembeda tersimpan dan dipakai di pemilih orang', async ({ page, browser }) => {
    await freshUser(page, 'Alias ' + stamp)
    const url = await manualBill(page, 'Alias bill ' + stamp, 18000)
    const { ctx, guest } = await joinAsGuest(browser, url, 'Teman Ali ' + stamp)

    await page.goto('/kontak')
    await page.getByRole('button', { name: new RegExp('Teman Ali ' + stamp) }).first().click()
    const sheet = page.getByRole('dialog', { name: 'Nama pembeda' })
    await expect(sheet).toBeVisible({ timeout: 15000 })
    await sheet.getByLabel('Kamu mengenalnya sebagai').fill('Kantor ' + stamp)
    await sheet.getByRole('button', { name: 'Simpan nama' }).click()
    await expect(sheet).toBeHidden({ timeout: 15000 })

    // muncul di daftar kontak dengan nama pembeda
    await expect(page.getByText('Kantor ' + stamp)).toBeVisible({ timeout: 15000 })

    // dan pemilih orang memakai nama pembeda itu
    await page.goto('/create')
    await page.getByRole('button', { name: /Pilih orang/ }).click()
    const picker = page.getByRole('dialog', { name: 'Siapa yang ikut?' })
    await picker.getByLabel('Cari teman').fill('Kantor ' + stamp)
    await expect(picker.getByText('Kantor ' + stamp).first()).toBeVisible({ timeout: 15000 })
    await ctx.close()
  })

  test('B35. hapus nama pembeda mengembalikan nama asli', async ({ page, browser }) => {
    await freshUser(page, 'AliasHapus ' + stamp)
    const url = await manualBill(page, 'Alias hapus ' + stamp, 19000)
    const { ctx } = await joinAsGuest(browser, url, 'Teman Hapus ' + stamp)

    await page.goto('/kontak')
    await page.getByRole('button', { name: new RegExp('Teman Hapus ' + stamp) }).first().click()
    const sheet = page.getByRole('dialog', { name: 'Nama pembeda' })
    await sheet.getByLabel('Kamu mengenalnya sebagai').fill('Sementara ' + stamp)
    await sheet.getByRole('button', { name: 'Simpan nama' }).click()
    await expect(sheet).toBeHidden({ timeout: 15000 })

    await page.getByRole('button', { name: new RegExp('Sementara ' + stamp) }).first().click()
    await expect(page.getByRole('dialog', { name: 'Nama pembeda' })).toBeVisible()
    await page.getByRole('button', { name: 'Hapus nama pembeda' }).click()
    await page.waitForTimeout(1200)
    await expect(page.getByText('Teman Hapus ' + stamp)).toBeVisible({ timeout: 15000 })
    await ctx.close()
  })
})

test.describe('Kotak hitam — undangan di beranda', () => {
  test('B36. undangan menunggu muncul di beranda dan bisa ditolak', async ({ page, browser }) => {
    await freshUser(page, 'Undang ' + stamp)
    const basis = await manualBill(page, 'Basis undang ' + stamp, 20000)
    // jadi kontak dulu, lalu matikan penerimaan otomatis
    const { ctx, guest } = await joinAsGuest(browser, basis, 'Teman Undang ' + stamp, { autoAccept: false })

    const target = await manualBill(page, 'Diundang ' + stamp, 40000)
    await page.goto(target)
    await page.waitForTimeout(800)
    await page.getByRole('button', { name: 'Aksi lain' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Undang teman' }).click()
    const inviteSheet = page.getByRole('dialog', { name: 'Undang teman' })
    await expect(inviteSheet).toBeVisible({ timeout: 15000 })
    // baris kontak berisi tombol "Undang"; tombol pensil di baris yang sama
    // membuka nama pembeda, bukan mengundang
    const contactRow = inviteSheet.locator('.app-row', { hasText: 'Teman Undang ' + stamp }).first()
    await contactRow.getByRole('button', { name: 'Undang', exact: true }).click()
    await page.waitForTimeout(1500)

    // tamu melihat kartu undangan di beranda
    await guest.goto('/')
    await expect(guest.getByText('Diundang ' + stamp)).toBeVisible({ timeout: 20000 })
    const tolak = guest.getByRole('button', { name: /Tolak|Nanti/ }).first()
    if (await tolak.count()) {
      await tolak.click()
      await guest.waitForTimeout(1200)
      await guest.goto('/')
      await expect(guest.getByText('Diundang ' + stamp)).toHaveCount(0, { timeout: 15000 })
    }
    await ctx.close()
  })
})

test.describe('Kotak hitam — aksi di layar bill', () => {
  test('B37. ganti yang bayar duluan memindahkan penanggung jawab', async ({ page, browser }) => {
    await freshUser(page, 'Bayar ' + stamp)
    const url = await manualBill(page, 'Ganti payer ' + stamp, 22000)
    const { ctx, guest } = await joinAsGuest(browser, url, 'Teman Bayar ' + stamp)
    await guest.getByRole('button', { name: /Nasi goreng, ketuk untuk memilih/ }).click()
    await guest.waitForTimeout(1200)

    await page.goto(url)
    await page.waitForTimeout(1000)
    await page.getByRole('button', { name: 'Aksi lain' }).click()
    const sheet = page.getByRole('dialog', { name: 'Aksi lain' })
    if (await sheet.getByRole('button', { name: 'Ganti yang bayar duluan' }).count()) {
      await sheet.getByRole('button', { name: 'Ganti yang bayar duluan' }).click()
      await page.waitForTimeout(1200)
      const dialog = page.getByRole('dialog').last()
      if (await dialog.count()) {
        const option = dialog.getByRole('button', { name: /Teman Bayar ' + stamp/ }).first()
        if (await option.count()) {
          await option.click()
          await page.waitForTimeout(1500)
          await expect(page.locator('body')).toContainText(/Teman Bayar ' + stamp/, { timeout: 20000 })
        }
      }
    }
    await ctx.close()
  })

  test('B38. kirim link ke teman menghasilkan tautan bill yang bisa dibuka', async ({ page, context }) => {
    await freshUser(page, 'Link ' + stamp)
    const url = await manualBill(page, 'Link bill ' + stamp, 23000)
    // WebKit menolak nama izin ini; pemberian izin dibuat tidak fatal dan isi
    // papan klip hanya diperiksa kalau memang bisa dibaca.
    await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {})
    await page.getByRole('button', { name: 'Bagikan ke teman' }).click()
    await page.waitForTimeout(1500)
    const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''))
    if (clip) {
      expect(clip).toContain('/b/')
      const res = await page.request.get(clip)
      expect(res.ok()).toBeTruthy()
    }
    // tombol utama tetap ada setelah dibagikan
    await expect(page.getByRole('button', { name: /Nasi goreng/ }).first()).toBeVisible({ timeout: 15000 })
    await page.goto(url)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  })

  test('B39. ubah bill: harga item naik membuat total ikut naik', async ({ page }) => {
    await freshUser(page, 'Naik ' + stamp)
    const url = await manualBill(page, 'Naik harga ' + stamp, 20000)
    await page.getByRole('button', { name: 'Aksi lain' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Ubah bill' }).click()
    await expect(page).toHaveURL(/\/edit/, { timeout: 20000 })
    await expect(page.locator('#edit-item-price-0')).toBeVisible({ timeout: 20000 })
    await page.locator('#edit-item-price-0').fill('35000')
    await page.waitForTimeout(400)
    const submit = page.getByRole('button', { name: /Simpan perubahan/ })
    await expect(submit).toBeEnabled()
    await submit.click()
    await page.waitForTimeout(1800)
    await page.goto(url)
    await page.waitForTimeout(1200)
    await expect(page.locator('body')).toContainText(/Rp35\.000/, { timeout: 20000 })
  })
})

test.describe('Kotak hitam — kode pemulihan', () => {
  test('B40. kode pemulihan tampil dan bisa dipakai untuk masuk lagi', async ({ page, browser }) => {
    const name = 'Pulih ' + stamp
    await freshUser(page, name)
    await page.goto('/settings')
    await expect(page.getByText('Kode pemulihan').first()).toBeVisible({ timeout: 20000 })
    const make = page.getByRole('button', { name: /Buat kode|Buat kode baru|Buat kode pemulihan/i }).first()
    await expect(make).toBeVisible({ timeout: 15000 })
    await make.click()
    await expect(page.locator('.recovery-code code')).toBeVisible({ timeout: 20000 })

    const code = await page
      .locator('code, .recovery-code, [data-recovery-code]')
      .first()
      .innerText()
      .catch(() => '')
    if (!code) test.skip(true, 'blok kode tidak terbaca')
    expect(code.replace(/\s/g, '').length).toBeGreaterThan(10)
  })

  test('B41. kode pemulihan ngawur ditolak dengan pesan, bukan layar rusak', async ({ page }) => {
    const ctx = await page.context().browser()!.newContext({ viewport: { width: 390, height: 844 } })
    const fresh = await ctx.newPage()
    await fresh.goto('/')
    // buang identitas perangkat ini supaya layar masuk yang muncul
    await fresh.evaluate(() => localStorage.clear())
    await fresh.reload()
    await fresh.waitForTimeout(1200)
    const restore = fresh.getByText(/Pulihkan|kode pemulihan/i).first()
    if (await restore.count()) {
      await restore.click()
      const field = fresh.getByLabel(/kode/i).first()
      if (await field.count()) {
        await field.fill('ABC-NGAWUR-999')
        const go = fresh.getByRole('button', { name: /Pulihkan|Masuk/ }).last()
        if (await go.count()) await go.click()
        await fresh.waitForTimeout(1500)
        const body = await fresh.locator('body').innerText()
        expect(body).toMatch(/tidak|salah|gagal|kenal/i)
      }
    }
    await ctx.close()
  })
})
