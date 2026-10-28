import { test, expect, type Page } from '@playwright/test'

/** Aksi sekunder sekarang ada di sheet 'Aksi lain' supaya layar bill tidak penuh tombol. */
async function openActions(screen: any) {
  await screen.getByRole('button', { name: 'Aksi lain' }).click()
  await screen.waitForTimeout(150)
}

const stamp = Date.now().toString().slice(-6)

async function freshUser(page: Page, name: string) {
  await page.goto('/')
  if (await page.getByRole('button', { name: 'Mulai pakai Bagiin' }).count()) {
    await page.getByLabel('Nama kamu').fill(name)
    await page.getByRole('button', { name: 'Mulai pakai Bagiin' }).click()
  }
  await expect(page.getByRole('heading', { level: 1 })).toContainText(name)
}

async function createBill(page: Page, title: string, opts: { roster?: string[] } = {}) {
  await page.goto('/create')
  await page.getByLabel('Nama bill').fill(title)
  await page.getByLabel('Item 1').fill('Sate ayam')
  await page.getByLabel('Harga satuan').first().fill('30000')
  for (const person of opts.roster ?? []) {
    await page.getByLabel('Nama teman').fill(person)
    await page.getByRole('button', { name: 'Tambah', exact: true }).click()
  }
  // Tunggu aplikasi menyatakan siap, jangan menebak lewat jeda: tombol ini
    // mati selama identitas belum siap, dan klik ke tombol mati hilang tanpa
    // jejak — di mesin lambat itu terbaca sebagai "aplikasi tidak berpindah".
    await expect(page.getByRole('button', { name: 'Buat bill' })).toBeEnabled()
    await page.getByRole('button', { name: 'Buat bill' }).click()
  await expect(page).toHaveURL(/\/b\//)
  return page.url()
}

test.describe('Bagiin — lunas manual dan daftar nama', () => {
  test('38. pemilik bisa menandai seluruh bill lunas lalu membatalkannya', async ({ page, browser }) => {
    await freshUser(page, 'Aufa')
    const url = await createBill(page, 'Lunas ' + stamp)

    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const guest = await ctx.newPage()
    await freshUser(guest, 'Bima')
    await guest.goto(url)
    await guest.getByRole('button', { name: 'Ikut bill ini' }).click()
    await guest.getByRole('button', { name: /Sate ayam, ketuk/ }).click()
    await expect(guest.getByText(/bagian kamu Rp30\.000/)).toBeVisible()

    await page.reload()
    await openActions(page)
    await page.getByRole('button', { name: 'Tandai semua lunas' }).first().click()
    await expect(page.getByText(/ditandai lunas|Bill ditandai lunas/).first()).toBeVisible()
    // muat ulang: label aksi bergantung pada status bill yang baru berubah
    await page.reload()
    await openActions(page)
    await expect(page.getByRole('button', { name: 'Batalkan lunas seluruh bill' })).toBeVisible()
    await page.getByRole('button', { name: 'Batalkan lunas seluruh bill' }).click()
    await expect(page.getByText(/Tanda lunas dibatalkan/).first()).toBeVisible()
    await openActions(page)
    await expect(page.getByRole('button', { name: 'Tandai semua lunas' }).first()).toBeVisible()
    await ctx.close()
  })

  test('39. nama yang diketik saat membuat bill menyambung ke orang yang join', async ({ page, browser }) => {
    await freshUser(page, 'Aufa')
    const url = await createBill(page, 'Roster ' + stamp, { roster: ['Bima'] })

    // placeholder diketik pembuat tetap muncul walau orangnya belum masuk
    await page.reload()
    await expect(page.getByText('Diundang, belum bergabung')).toBeVisible()

    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const guest = await ctx.newPage()
    await freshUser(guest, 'Bima')
    await guest.goto(url)
    await guest.getByRole('button', { name: 'Ikut bill ini' }).click()
    await guest.getByRole('button', { name: /Sate ayam, ketuk/ }).click()
    await expect(guest.getByText(/bagian kamu Rp30\.000/)).toBeVisible()

    // klaim berhasil: placeholder hilang, Bima jadi baris orang biasa
    await page.reload()
    await expect(page.getByText('Diundang, belum bergabung')).toHaveCount(0)
    await expect(page.getByText(/Bagian Rp30\.000/)).toBeVisible()
    await expect(page.getByText(/Bima/).first()).toBeVisible()
    await ctx.close()
  })

  test('40. pemilik mengeluarkan orang dari bill', async ({ page, browser }) => {
    await freshUser(page, 'Aufa')
    const url = await createBill(page, 'Keluarkan ' + stamp)

    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const guest = await ctx.newPage()
    await freshUser(guest, 'Bima')
    await guest.goto(url)
    await guest.getByRole('button', { name: 'Ikut bill ini' }).click()
    await guest.getByRole('button', { name: /Sate ayam, ketuk/ }).click()

    await page.reload()
    await expect(page.getByRole('button', { name: 'Keluarkan Bima' })).toBeVisible()
    await page.getByRole('button', { name: 'Keluarkan Bima' }).click()
    await expect(page.getByText('Bima dikeluarkan')).toBeVisible()

    await page.reload()
    await expect(page.getByText('Bima')).toHaveCount(0)
    await expect(page.getByText(/bagian kamu Rp30\.000/)).toBeVisible()
    await ctx.close()
  })
})
