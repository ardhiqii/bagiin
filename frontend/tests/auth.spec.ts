import { test, expect } from '@playwright/test'

/**
 * Sesi dan pagar layar.
 *
 * Yang dijaga di sini bukan "tampilan bagus", tapi janji: layar yang butuh
 * identitas tidak boleh terbuka untuk identitas yang sudah tidak dikenal
 * server. Bug yang memicu file ini: localStorage menyimpan id dari database
 * lama, aplikasi tetap membuka beranda, lalu menampilkan "Identitas tidak
 * ditemukan" di atas fitur yang kelihatan siap dipakai.
 */

const BASI = { id: 'IDBASI-TIDAK-ADA', name: 'Aufa', role: 'person', secret: 'rahasia-palsu' }

/** Suntik identitas sekali saja — reload berikutnya tidak mengulanginya lagi. */
async function contextWithStaleIdentity(browser: import('@playwright/test').Browser, identity = BASI) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  await ctx.addInitScript((raw) => {
    try {
      if (!sessionStorage.getItem('__seeded')) {
        sessionStorage.setItem('__seeded', '1')
        localStorage.setItem('bagiin_identity', raw)
      }
    } catch {}
  }, JSON.stringify(identity))
  return { ctx, page: await ctx.newPage() }
}

async function onboard(page: import('@playwright/test').Page, name: string) {
  await page.goto('/')
  const field = page.getByLabel('Nama kamu')
  if (await field.isVisible().catch(() => false)) {
    await field.fill(name)
    await page.getByRole('button', { name: /Mulai pakai Bagiin/ }).click()
  }
}

test.describe('Bagiin — sesi dan pagar identitas', () => {
  test('68. identitas basi tidak membuka beranda: dilempar ke pendaftaran', async ({ browser }) => {
    const { ctx, page } = await contextWithStaleIdentity(browser)
    await page.goto('/')

    await expect(page.getByRole('heading', { name: 'Mulai atau masuk' })).toBeVisible()
    await expect(page.getByText('Identitas di perangkat ini sudah tidak ada di server.')).toBeVisible()
    // bekas kesalahan: beranda tetap terbuka dengan pesan gagal memuat
    await expect(page.getByText('Tidak bisa memuat bill')).toHaveCount(0)
    // identitas basi dibuang, bukan disimpan terus
    expect(await page.evaluate(() => localStorage.getItem('bagiin_identity'))).toBeNull()
    await ctx.close()
  })

  test('69. alamat dalam (rekap, pengaturan, buat) juga ditutup, bukan cuma beranda', async ({ browser }) => {
    for (const path of ['/recap', '/settings', '/create']) {
      const { ctx, page } = await contextWithStaleIdentity(browser)
      await page.goto(path)
      await expect(page.getByRole('heading', { name: 'Mulai atau masuk' })).toBeVisible()
      await expect(page).toHaveURL(/\/$/)
      await ctx.close()
    }
  })

  test('70. setelah isi nama, orang kembali ke halaman yang tadi dituju', async ({ browser }) => {
    const { ctx, page } = await contextWithStaleIdentity(browser)
    await page.goto('/recap')
    await expect(page.getByRole('heading', { name: 'Mulai atau masuk' })).toBeVisible()

    // layar identitas-basi terbuka di tab "Kode"; tab "Nama" dipilih eksplisit
    await page.getByRole('tab', { name: 'Nama' }).click()
    await page.getByLabel('Nama kamu').fill('Sesi Baru ' + Date.now().toString().slice(-5))
    await page.getByRole('button', { name: /Mulai pakai Bagiin/ }).click()

    await expect(page).toHaveURL(/\/recap$/, { timeout: 15_000 })
    await expect(page.getByRole('heading', { name: /Rekap/ })).toBeVisible()
    await ctx.close()
  })

  test('71. tanpa identitas, layar dalam tertutup tapi link bill tetap bisa dibuka', async ({ browser }) => {
    // pembuat bill
    const ownerCtx = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const owner = await ownerCtx.newPage()
    await onboard(owner, 'Pemilik ' + Date.now().toString().slice(-5))
    await owner.goto('/create')
    await owner.getByLabel('Nama bill').fill('Bill Tamu ' + Date.now().toString().slice(-5))
    await owner.getByLabel('Item 1').fill('Kopi')
    await owner.getByLabel('Harga satuan').fill('12000')
    await owner.getByRole('button', { name: 'Buat bill' }).click()
    await expect(owner).toHaveURL(/\/b\//)
    const billUrl = owner.url()
    await ownerCtx.close()

    // tamu tanpa identitas: layar dalam tertutup, link bill tetap terbuka
    const guestCtx = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const guest = await guestCtx.newPage()
    await guest.goto('/settings')
    await expect(guest.getByRole('heading', { name: 'Mulai atau masuk' })).toBeVisible()

    await guest.goto(billUrl)
    await expect(guest.getByRole('button', { name: 'Ikut bill ini' })).toBeVisible()
    await expect(guest.getByText('Kopi')).toBeVisible()
    await guestCtx.close()
  })

  test('72. sesi diputus server saat layar terbuka: keluar dari akun, bukan pesan mentah', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const page = await ctx.newPage()
    await onboard(page, 'Sesi Putus ' + Date.now().toString().slice(-5))
    await expect(page.getByRole('heading', { name: /Halo,/ })).toBeVisible()

    // server menjawab "sesi tidak valid" untuk permintaan berikutnya
    await page.route('**/api/identities/**', (route) =>
      route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Sesi tidak valid, coba masuk ulang' }),
      }),
    )
    await page.goto('/recap')

    await expect(page.getByRole('heading', { name: 'Mulai atau masuk' })).toBeVisible({ timeout: 15_000 })
    expect(await page.evaluate(() => localStorage.getItem('bagiin_identity'))).toBeNull()
    await ctx.close()
  })
})
