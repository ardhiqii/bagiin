import { test, expect, type Page } from '@playwright/test'

/**
 * Beranda memuat satu bulan, bukan seluruh riwayat.
 *
 * Yang dijaga di sini bukan tampilan, tapi **permintaan jaringan**: beranda
 * tidak boleh menembak daftar bill tanpa parameter bulan. Kalau suatu hari ada
 * yang menghapus parameter itu, layarnya masih terlihat benar sementara biayanya
 * kembali ke "muat semuanya" — persis yang mau dihindari.
 */

const stamp = Date.now().toString().slice(-6)

async function freshUser(page: Page, name: string) {
  await page.goto('/')
  if (await page.getByRole('button', { name: 'Mulai pakai Bagiin' }).count()) {
    await page.getByLabel('Nama kamu').fill(name)
    await page.getByRole('button', { name: 'Mulai pakai Bagiin' }).click()
  }
  await expect(page.getByRole('heading', { level: 1 })).toContainText(name)
}

/** Bikin bill lewat API langsung, dengan tanggal transaksi yang bisa diatur. */
async function createBillViaApi(page: Page, title: string, transactedAt: string) {
  const identity = await page.evaluate(() => JSON.parse(localStorage.getItem('bagiin_identity') || '{}'))
  const result = await page.evaluate(
    async ({ identity, title, transactedAt }) => {
      const response = await fetch('/api/bills', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'X-Identity-Id': identity.id,
          'X-Identity-Secret': identity.secret,
        },
        body: JSON.stringify({
          title,
          merchant: null,
          transacted_at: transactedAt,
          tax_mode: 'proportional',
          subtotal: 20000,
          order_discount: 0,
          cashback: 0,
          tax: 0,
          service: 0,
          total: 20000,
          tax_included: 1,
          items: [{ name: 'Kopi', price: 20000, discount: 0, quantity: 1, mode: 'free', slot_count: null }],
          participants: [],
        }),
      })
      return { status: response.status, body: await response.text() }
    },
    { identity, title, transactedAt },
  )
  expect(result.status, result.body).toBe(200)
}

test.describe('Bagiin — beranda per bulan', () => {
  test('128. beranda memuat satu bulan, bulan lain diminta saat dipilih', async ({ page }) => {
    await freshUser(page, 'Aufa')

    const now = new Date()
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-15T12:00:00`
    const last = new Date(now.getFullYear(), now.getMonth() - 1, 15, 12, 0, 0)
    const lastMonth = `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-15T12:00:00`

    await createBillViaApi(page, 'Bulan ini ' + stamp, thisMonth)
    await createBillViaApi(page, 'Bulan lalu ' + stamp, lastMonth)

    // rekam setiap permintaan daftar bill
    const calls: string[] = []
    page.on('request', (request) => {
      const url = request.url()
      if (url.includes('/bills') && !url.includes('/bills/months')) calls.push(url)
    })

    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Aufa')

    // dua bulan tampil sebagai chip, dengan jumlah bill masing-masing
    const months = page.locator('.chip-row-months .chip-filter')
    await expect(months).toHaveCount(2)
    await expect(page.getByText('Bulan ini ' + stamp)).toBeVisible()
    // bill bulan lalu belum dimuat
    await expect(page.getByText('Bulan lalu ' + stamp)).toHaveCount(0)

    // permintaan pertama menyebut bulannya, bukan seluruh riwayat
    expect(calls.length).toBeGreaterThan(0)
    expect(calls.every((url) => url.includes('month='))).toBe(true)

    // pilih bulan lalu: baru sekarang isinya diminta dan ditampilkan
    calls.length = 0
    await months.nth(1).click()
    await expect(page.getByText('Bulan lalu ' + stamp)).toBeVisible()
    expect(calls.some((url) => url.includes('month='))).toBe(true)

    // dan bulan ini hilang dari daftar karena yang tampil hanya bulan terpilih
    await expect(page.getByText('Bulan ini ' + stamp)).toHaveCount(0)
  })

  test('129. pencarian menembus semua bulan, bukan cuma bulan yang terbuka', async ({ page }) => {
    await freshUser(page, 'Aufa')

    const last = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 15, 12, 0, 0)
    const lastMonth = `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-15T12:00:00`
    await createBillViaApi(page, 'Cari Lintas Bulan ' + stamp, lastMonth)

    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Aufa')

    await page.getByLabel('Cari bill').fill('Cari Lintas Bulan ' + stamp)
    // bill bulan lalu muncul tanpa harus memilih bulannya dulu
    await expect(page.getByText('Cari Lintas Bulan ' + stamp)).toBeVisible()
    await expect(page.getByText(/Mencari di semua bulan/)).toBeVisible()
  })

  test('130. angka "perlu dikerjakan" menghitung semua bulan, bukan bulan yang terbuka', async ({ page }) => {
    await freshUser(page, 'Aufa')

    const now = new Date()
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-10T12:00:00`
    const last = new Date(now.getFullYear(), now.getMonth() - 1, 10, 12, 0, 0)
    const lastMonth = `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-10T12:00:00`

    // dua bill yang sama-sama belum dipilih, di dua bulan berbeda
    await createBillViaApi(page, 'Perlu Okt ' + stamp, thisMonth)
    await createBillViaApi(page, 'Perlu Sep ' + stamp, lastMonth)

    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Aufa')

    // blok kuning menyebut 2 — seluruh riwayat
    const banner = page.locator('#perlu-tindakan')
    await expect(banner).toContainText('2')
    // sementara daftar di bawahnya cuma memuat bulan berjalan
    await expect(page.getByText('Perlu Okt ' + stamp)).toBeVisible()
    await expect(page.getByText('Perlu Sep ' + stamp)).toHaveCount(0)

    // mengetuk blok kuning memuat semua bulan, jadi angka dan barisnya cocok
    await banner.click()
    await expect(page.getByText('Perlu Sep ' + stamp)).toBeVisible()
    await expect(page.getByText('Perlu Okt ' + stamp)).toBeVisible()
  })
})
