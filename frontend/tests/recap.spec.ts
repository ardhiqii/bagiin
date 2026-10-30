import { test, expect } from '@playwright/test'

const stamp = Date.now().toString().slice(-6)

async function onboard(page: import('@playwright/test').Page, name: string) {
  await page.goto('/')
  const nameField = page.getByLabel('Nama kamu')
  if (await nameField.isVisible().catch(() => false)) {
    await nameField.fill(name)
    await page.getByRole('button', { name: /Lanjut|Mulai/ }).first().click()
  }
}

async function createBill(page: import('@playwright/test').Page, title: string, price = '15000') {
  await page.goto('/create')
  await page.getByLabel('Nama bill').fill(title)
  await page.getByLabel('Item 1').fill('Sate')
  await page.getByLabel('Harga satuan').fill(price)
  // Tunggu aplikasi menyatakan siap, jangan menebak lewat jeda: tombol ini
    // mati selama identitas belum siap, dan klik ke tombol mati hilang tanpa
    // jejak — di mesin lambat itu terbaca sebagai "aplikasi tidak berpindah".
    await expect(page.getByRole('button', { name: 'Buat bill' })).toBeEnabled()
    await page.getByRole('button', { name: 'Buat bill' }).click()
  await expect(page).toHaveURL(/\/b\//)
  return page.url()
}

/** Tamu: buka link, ikut, pilih item pertama. Opsional menandai lunas. */
async function guestPicks(
  browser: import('@playwright/test').Browser,
  url: string,
  name: string,
  { pay = false } = {},
) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const guest = await ctx.newPage()
  await onboard(guest, name)
  await guest.goto(url)
  await guest.getByRole('button', { name: 'Ikut bill ini' }).click()
  await guest.getByRole('button', { name: /Sate, ketuk/ }).click()
  if (pay) {
    await guest.getByRole('button', { name: /Tandai lunas/ }).click()
    await expect(guest.getByText('Ditandai lunas')).toBeVisible()
  }
  const identity = await guest.evaluate(() => localStorage.getItem('bagiin_identity'))
  return { ctx, guest, identity }
}

/** Konteks baru yang memakai identitas yang sudah ada — bukan orang baru. */
async function contextAs(browser: import('@playwright/test').Browser, identity: string | null) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  await ctx.addInitScript((raw) => {
    if (raw) localStorage.setItem('bagiin_identity', raw)
  }, identity)
  return { ctx, page: await ctx.newPage() }
}

test.describe('Bagiin — rekap berisi pekerjaan, bukan arsip', () => {
  test('63. bill yang pembagiannya belum jelas bisa ditutup dari rekap, lalu hilang', async ({ page }) => {
    await onboard(page, 'Aufa')
    const title = 'Belum Dipilih ' + stamp
    await createBill(page, title)

    await page.goto('/recap')
    // bill baru tanpa pilihan: pembagiannya belum jelas, jadi masuk daftar kerja
    await expect(page.getByText(title)).toBeVisible()
    await expect(page.getByText(/belum ada yang pilih|belum ada yang ngaku/).first()).toBeVisible()
    await expect(page.getByText(/sisa ditanggung/).first()).toBeVisible()

    await page.getByRole('button', { name: 'Tandai lunas' }).first().click()
    await expect(page.getByText('Tandai bill ini lunas?')).toBeVisible()
    await page.getByRole('button', { name: /Tandai lunas, sisa ditanggung/ }).click()

    // setelah ditutup tidak ada sisa, jadi rekap bersih
    await expect(page.getByText(title)).toHaveCount(0)
    await expect(page.getByText('Semua bill beres')).toBeVisible()
  })

  test('64. orang yang belum bayar tampil per orang, lalu hilang setelah lunas', async ({ page, browser }) => {
    await onboard(page, 'Aufa')
    const url = await createBill(page, 'Tagihanku ' + stamp, '30000')

    const { ctx, guest } = await guestPicks(browser, url, 'Bima')
    await expect(guest.getByText(/bagian kamu Rp30\.000/)).toBeVisible()

    await page.goto('/recap')
    // per orang: siapa yang berutang dan berapa, bukan daftar bill
    // label seksi, bukan label kecil di baris (dua-duanya berbunyi "Kamu tagih")
    await expect(page.locator('.ds-group-label', { hasText: 'Belum dibayar ke kamu' })).toBeVisible()
    await expect(page.getByText('Bima').first()).toBeVisible()
    await expect(page.getByText('Rp30.000').first()).toBeVisible()
    await expect(page.getByText(/1 bill · belum dia bayar/)).toBeVisible()

    // buka sheet: rinciannya per bill, dan bill-nya bisa dibuka
    await page.locator('.recap-person').first().click()
    const sheet = page.locator('.ds-sheet')
    await expect(sheet.getByText(/1 bill belum lunas/)).toBeVisible()
    await expect(sheet.getByText(/belum dia bayar/).first()).toBeVisible()
    await page.locator('.ds-sheet-close').click()

    await guest.getByRole('button', { name: /Tandai lunas/ }).click()
    await expect(guest.getByText('Ditandai lunas')).toBeVisible()
    await ctx.close()

    await page.reload()
    // lunas = tidak perlu diberitahu lagi
    await expect(page.getByText('Bima')).toHaveCount(0)
    await expect(page.getByText('Semua bill beres')).toBeVisible()
  })

  test('65. orang dengan dua arah: net tampil, bruto tetap disebut', async ({ page, browser }) => {
    await onboard(page, 'Aufa')
    // saya menalangi: Bima berutang Rp30.000 ke saya
    const mine = await createBill(page, 'Saya Nalangin ' + stamp, '30000')
    const first = await guestPicks(browser, mine, 'Bima')
    await first.ctx.close()

    // Bima yang SAMA menalangi: saya berutang Rp20.000 ke dia. Konteks baru
    // harus memakai identitas lama, bukan orang lain bernama sama.
    const { ctx: ctxGuest, page: guest } = await contextAs(browser, first.identity)
    await guest.goto('/')
    const theirs = await createBill(guest, 'Bima Nalangin ' + stamp, '20000')

    await page.goto(theirs)
    await page.getByRole('button', { name: 'Ikut bill ini' }).click()
    await page.getByRole('button', { name: /Sate, ketuk/ }).click()

    await page.goto('/recap')
    // net = dia masih berutang Rp10.000 ke saya, tapi dua brutonya tetap terlihat
    await expect(page.locator('.ds-group-label', { hasText: 'Belum dibayar ke kamu' })).toBeVisible()
    await expect(page.getByText('kamu bayar Rp20.000')).toBeVisible()
    await expect(page.getByText('dia bayar Rp30.000')).toBeVisible()

    await page.locator('.recap-person').first().click()
    await expect(page.getByText('Bersih')).toBeVisible()
    await expect(page.getByText('Rp10.000').first()).toBeVisible()
    await ctxGuest.close()
  })

  test('66. tanpa utang, piutang, dan bill menggantung: satu kalimat, bukan daftar kosong', async ({ page }) => {
    await onboard(page, 'Orang Baru ' + stamp)
    await page.goto('/recap')
    await expect(page.getByText('Semua bill beres')).toBeVisible()
    await expect(page.getByText(/Tidak ada tagihan, tidak ada yang menunggu/)).toBeVisible()
    // tidak ada kartu angka dan tidak ada seksi orang saat semuanya kosong
    await expect(page.locator('.ds-balance')).toHaveCount(0)
    await expect(page.locator('.recap-person')).toHaveCount(0)
  })
})

test.describe('Bagiin — satu angka untuk uang yang sama', () => {
  test('125. terima Rp230.000 dan bayar Rp22.000: Beranda dan Rekap menyebut angka yang sama', async ({ page, browser }) => {
    test.setTimeout(180_000)
    // Kasus nyata: orang punya piutang Rp230.000 di satu bill, dan utang
    // Rp22.000 di bill lain. Sebelum ini Beranda menulis "terima Rp208.000"
    // sementara Rekap menulis "bayar Rp22.000" untuk uang yang sama.
    await onboard(page, 'Aufa Saldo ' + stamp)
    const linkTerima = await createBill(page, 'Piutang ' + stamp, '230000')

    // tamu mengambil item di bill pertama -> pemilik menerima Rp230.000
    const tamu = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const t = await tamu.newPage()
    await onboard(t, 'Tamu Piutang ' + stamp)
    await t.goto(linkTerima)
    await t.getByRole('button', { name: 'Ikut bill ini' }).click()
    await t.getByRole('button', { name: /Sate, ketuk/ }).click()
    await t.waitForTimeout(1000)

    // bill kedua: tamu jadi pembayar, Aufa mengambil item Rp22.000
    const pemilik2 = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const p2 = await pemilik2.newPage()
    await onboard(p2, 'Pembayar ' + stamp)
    const linkBayar = await createBill(p2, 'Utang ' + stamp, '22000')

    await page.goto(linkBayar)
    await page.getByRole('button', { name: 'Ikut bill ini' }).first().click()
    const namaField = page.getByLabel('Nama kamu')
    if (await namaField.isVisible().catch(() => false)) {
      await namaField.fill('Aufa Saldo ' + stamp)
      await page.getByRole('button', { name: 'Simpan nama & ikut bill' }).click()
    }
    await page.locator('.ds-item').filter({ hasText: 'Sate' }).first().click()
    await page.waitForTimeout(1200)

    // Beranda
    await page.goto('/')
    const kartuBeranda = page.locator('.ds-balance')
    await expect(kartuBeranda).toBeVisible({ timeout: 15_000 })
    const labelBeranda = (await kartuBeranda.locator('.ds-balance-label').innerText()).trim()
    const angkaBeranda = (await kartuBeranda.locator('.ds-balance-value').innerText()).replace(/[^0-9]/g, '')
    const rincianBeranda = (await kartuBeranda.locator('.ds-balance-row').allInnerTexts())
      .join(' | ')
      .replace(/\s+/g, ' ')
      .trim()

    // Rekap
    await page.goto('/recap')
    const kartuRekap = page.locator('.ds-balance')
    await expect(kartuRekap).toBeVisible({ timeout: 15_000 })
    const labelRekap = (await kartuRekap.locator('.ds-balance-label').innerText()).trim()
    const angkaRekap = (await kartuRekap.locator('.ds-balance-value').innerText()).replace(/[^0-9]/g, '')
    const rincianRekap = (await kartuRekap.locator('.ds-balance-row').allInnerTexts())
      .join(' | ')
      .replace(/\s+/g, ' ')
      .trim()

    // angka besar = NET di kedua layar, dan kalimatnya sama
    expect(angkaBeranda, 'Beranda harus menampilkan net Rp208.000').toBe('208000')
    expect(angkaRekap, 'Rekap harus menampilkan angka yang sama dengan Beranda').toBe(angkaBeranda)
    expect(labelBeranda).toBe(labelRekap)
    // dua komponennya tertulis dengan tanda, di kedua layar, sama persis
    expect(rincianBeranda).toBe(rincianRekap)
    expect(rincianBeranda).toContain('Terima +Rp230.000')
    expect(rincianBeranda).toContain('Bayar −Rp22.000')
    // kedua bill di skenario ini sudah terbagi semua, jadi tidak ada baris
    // "belum pasti" — kalau ada, dia harus muncul terpisah (dijaga tes 126)
    await expect(kartuBeranda.getByText('Belum dipastikan')).toHaveCount(0)

    // daftar orangnya tetap memisahkan arah: yang saya utangi dan yang mengutangi
    await expect(page.getByText('Perlu kamu bayar').first()).toBeVisible()
    await expect(page.getByText('Belum dibayar ke kamu').first()).toBeVisible()

    await tamu.close()
    await pemilik2.close()
  })
})

test.describe('Bagiin — angka besar bisa ditanya', () => {
  test('126. mengetuk angka besar membuka rincian: terima − bayar = selisih, dan yang belum pasti terpisah', async ({ page, browser }) => {
    test.setTimeout(180_000)
    await onboard(page, 'Aufa Tanya ' + stamp)
    const linkTerima = await createBill(page, 'Piutang Tanya ' + stamp, '230000')

    const tamu = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const t = await tamu.newPage()
    await onboard(t, 'Tamu Tanya ' + stamp)
    await t.goto(linkTerima)
    await t.getByRole('button', { name: 'Ikut bill ini' }).click()
    await t.getByRole('button', { name: /Sate, ketuk/ }).click()
    await t.waitForTimeout(1000)

    const pemilik2 = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const p2 = await pemilik2.newPage()
    await onboard(p2, 'Pembayar Tanya ' + stamp)
    const linkBayar = await createBill(p2, 'Utang Tanya ' + stamp, '22000')

    await page.goto(linkBayar)
    await page.getByRole('button', { name: 'Ikut bill ini' }).first().click()
    const namaField = page.getByLabel('Nama kamu')
    if (await namaField.isVisible().catch(() => false)) {
      await namaField.fill('Aufa Tanya ' + stamp)
      await page.getByRole('button', { name: 'Simpan nama & ikut bill' }).click()
    }
    await page.locator('.ds-item').filter({ hasText: 'Sate' }).first().click()
    await page.waitForTimeout(1200)

    // bill ketiga sengaja dibiarkan belum dibagi: ada item yang tidak diaku
    // siapa pun, jadi angkanya masih bisa berubah dan harus muncul terpisah
    await createBill(page, 'Belum Dibagi Tanya ' + stamp, '45000')

    await page.goto('/recap')
    const kartu = page.locator('.ds-balance').first()
    await expect(kartu).toBeVisible({ timeout: 15_000 })

    // angka besar adalah tombol, dan punya nama untuk pembaca layar
    const tombol = kartu.locator('.ds-balance-tap')
    await expect(tombol).toBeVisible()
    await expect(tombol).toHaveAttribute('aria-haspopup', 'dialog')
    await tombol.click()

    const sheet = page.getByRole('dialog', { name: 'Rincian saldo' })
    await expect(sheet).toBeVisible()
    // aritmetika yang bisa diperiksa sendiri
    await expect(sheet.getByText('Kamu terima', { exact: true })).toBeVisible()
    await expect(sheet.getByText('+Rp230.000')).toBeVisible()
    // "Utang kamu" — kata yang orang pakai sendiri, bukan "ringkasan selisih"
    await expect(sheet.getByText('Tagihan kamu', { exact: true })).toBeVisible()
    await expect(sheet.getByText('−Rp22.000')).toBeVisible()
    // dua arah: baris selisih muncul, dan menyebut arahnya dengan kata
    await expect(sheet.getByText('Kamu terima lebih', { exact: true })).toBeVisible()
    await expect(sheet.getByText('Rp208.000')).toBeVisible()
    // yang belum pasti dipisah dan dinyatakan tidak ikut dijumlah
    await expect(sheet.getByText('BILL BELUM SELESAI')).toBeVisible()
    await expect(sheet.getByText(/ditanggung yang nalangin/)).toBeVisible()

    // tombol di dalam rincian membawa ke daftar bill yang belum pasti
    await sheet.getByRole('button', { name: /Lihat .* bill itu/ }).click()
    await expect(sheet).toBeHidden()
    await expect(page.locator('#rekap-belum-jelas')).toBeVisible()

    await tamu.close()
    await pemilik2.close()
  })

  test('127. satu arah: rincian menyebut utang dan angkanya cuma muncul sekali', async ({ page, browser }) => {
    test.setTimeout(120_000)
    await onboard(page, 'Aufa Satu Arah ' + stamp)
    // bill milik orang lain yang itemnya saya ambil -> saya cuma punya utang
    const pemilik = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const p = await pemilik.newPage()
    await onboard(p, 'Pemilik Satu Arah ' + stamp)
    const link = await createBill(p, 'Utang Satu Arah ' + stamp, '22000')

    await page.goto(link)
    await page.getByRole('button', { name: 'Ikut bill ini' }).first().click()
    const namaField = page.getByLabel('Nama kamu')
    if (await namaField.isVisible().catch(() => false)) {
      await namaField.fill('Aufa Satu Arah ' + stamp)
      await page.getByRole('button', { name: 'Simpan nama & ikut bill' }).click()
    }
    await page.locator('.ds-item').filter({ hasText: 'Sate' }).first().click()
    await page.waitForTimeout(1200)

    await page.goto('/recap')
    const kartu = page.locator('.ds-balance').first()
    await expect(kartu).toBeVisible({ timeout: 15_000 })
    await kartu.locator('.ds-balance-tap').click()

    const sheet = page.getByRole('dialog', { name: 'Rincian saldo' })
    await expect(sheet).toBeVisible()
    await expect(sheet.getByText('Tagihan kamu', { exact: true })).toBeVisible()
    // hanya satu arah: tidak ada baris ringkasan, karena isinya akan sama persis
    // dengan baris utang di atasnya dan terbaca seperti salah hitung
    await expect(sheet.getByText(/terima lebih|bayar lebih/)).toHaveCount(0)
    // angkanya muncul sekali saja di blok SUDAH PASTI
    const isi = (await sheet.innerText()).split('BILL BELUM SELESAI')[0]
    expect(isi.split('Rp22.000').length - 1, 'Rp22.000 tidak boleh tampil dua kali').toBe(1)

    await pemilik.close()
  })
})
