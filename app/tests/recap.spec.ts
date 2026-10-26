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
    await guest.getByRole('button', { name: 'Tandai bagianku lunas' }).click()
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

    await page.getByRole('button', { name: 'Tutup bill' }).first().click()
    await expect(page.getByText('Tutup bill ini?')).toBeVisible()
    await page.getByRole('button', { name: /Tutup, sisa ditanggung/ }).click()

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
    await expect(page.locator('.ds-group-label', { hasText: 'Kamu tagih' })).toBeVisible()
    await expect(page.getByText('Bima').first()).toBeVisible()
    await expect(page.getByText('Rp30.000').first()).toBeVisible()
    await expect(page.getByText(/1 bill · belum dia transfer/)).toBeVisible()

    // buka sheet: rinciannya per bill, dan bill-nya bisa dibuka
    await page.locator('.recap-person').first().click()
    const sheet = page.locator('.ds-sheet')
    await expect(sheet.getByText(/1 bill belum lunas/)).toBeVisible()
    await expect(sheet.getByText(/belum dia transfer/).first()).toBeVisible()
    await page.locator('.ds-sheet-close').click()

    await guest.getByRole('button', { name: 'Tandai bagianku lunas' }).click()
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
    await expect(page.locator('.ds-group-label', { hasText: 'Kamu tagih' })).toBeVisible()
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
    await expect(page.getByText(/Tidak ada utang, piutang/)).toBeVisible()
    // tidak ada kartu angka dan tidak ada seksi orang saat semuanya kosong
    await expect(page.locator('.ds-balance')).toHaveCount(0)
    await expect(page.locator('.recap-person')).toHaveCount(0)
  })
})
