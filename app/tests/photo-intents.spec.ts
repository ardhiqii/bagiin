import { test, expect, type Page } from '@playwright/test'

const stamp = Date.now().toString().slice(-6)
const PHOTO = 'tests/fixtures/receipt.png'

async function freshUser(page: Page, name: string) {
  await page.goto('/')
  if (await page.getByRole('button', { name: 'Mulai pakai Bagiin' }).count()) {
    await page.getByLabel('Nama kamu').fill(name)
    await page.getByRole('button', { name: 'Mulai pakai Bagiin' }).click()
  }
  await expect(page.getByRole('heading', { level: 1 })).toContainText(name)
}

async function pickPhotoThrough(page: Page, button: string) {
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: button }).click(),
  ])
  await chooser.setFiles(PHOTO)
}

test.describe('Bill baru — foto boleh dibaca AI, boleh cuma dilampirkan', () => {
  test('38. lampirkan foto sebagai bukti tanpa memanggil AI', async ({ page }) => {
    await freshUser(page, 'Aufa')
    let ocrCalls = 0
    await page.route('**/api/ocr', async (route) => {
      ocrCalls += 1
      await route.abort()
    })

    await page.goto('/create')
    await pickPhotoThrough(page, 'Lampirkan foto sebagai bukti')

    await expect(page.getByText('Foto dilampirkan', { exact: true })).toBeVisible()
    await expect(page.getByText(/bukti saja\. Angkanya kamu isi sendiri/)).toBeVisible()
    // tidak ada satu pun panggilan ke layanan AI
    expect(ocrCalls).toBe(0)

    // form tetap kosong: angkanya diketik sendiri
    await expect(page.getByLabel('Item 1')).toHaveValue('')
    await page.getByLabel('Nama bill').fill('Bukti manual ' + stamp)
    await page.getByLabel('Item 1').fill('Nasi uduk')
    await page.getByLabel('Harga satuan').fill('25.000')
    await page.getByRole('button', { name: 'Buat bill' }).click()
    await expect(page).toHaveURL(/\/b\//)
    await expect(page.getByText('Rp25.000').first()).toBeVisible()
    await expect(page.getByAltText('Foto struk bill').first()).toBeVisible()
  })

  test('39. AI gagal: pesannya jelas, dan foto tetap bisa dipakai sebagai bukti', async ({ page }) => {
    await freshUser(page, 'Aufa')
    await page.route('**/api/ocr', (route) =>
      route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: JSON.stringify({
          detail: 'Layanan AI gratis sedang penuh atau mengalami gangguan. Coba lagi beberapa menit kemudian atau isi secara manual.',
        }),
      }),
    )

    await page.goto('/create')
    await pickPhotoThrough(page, 'Scan struk, isi otomatis')

    await expect(page.getByText('Struk gagal dibaca')).toBeVisible()
    await expect(page.getByText(/Layanan AI gratis sedang penuh/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Coba baca lagi' })).toBeVisible()

    // jalan keluar: foto yang sama dilampirkan sebagai bukti, lalu isi manual
    await page.getByRole('button', { name: 'Pakai foto struk tadi sebagai bukti' }).click()
    await expect(page.getByText('Foto dilampirkan', { exact: true })).toBeVisible()
    await expect(page.getByText('Struk gagal dibaca')).toHaveCount(0)

    await page.getByLabel('Item 1').fill('Sate ayam')
    await page.getByLabel('Harga satuan').fill('30.000')
    await page.getByRole('button', { name: 'Buat bill' }).click()
    await expect(page).toHaveURL(/\/b\//)
    await expect(page.getByText('Rp30.000').first()).toBeVisible()
  })

  test('40. selama AI membaca, ada status berjalan dan tombol batal', async ({ page }) => {
    await freshUser(page, 'Aufa')
    await page.route('**/api/ocr', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 6000))
      await route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'terlalu lama' }),
      })
    })

    await page.goto('/create')
    await pickPhotoThrough(page, 'Scan struk, isi otomatis')

    await expect(page.getByText(/Membaca struk…/)).toBeVisible()
    await expect(page.getByText(/Bisa 10–60 detik/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Batal baca' })).toBeVisible()

    await page.getByRole('button', { name: 'Batal baca' }).click()
    await expect(page.getByText('Isi otomatis dari foto struk?')).toBeVisible()
    await expect(page.getByText(/Membaca struk…/)).toHaveCount(0)
  })

  test('41. struk yang pajaknya sudah termasuk: kolom pajak dikunci, bill ditandai', async ({ page }) => {
    await freshUser(page, 'Aufa')
    await page.route('**/api/ocr', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          merchant: 'WARTEG BAHARI',
          items: [{ name: 'Nasi goreng', price: 45000, quantity: 1 }],
          subtotal: 45000,
          order_discount: 0,
          // model kadang tetap mengirim angka pajak walau sudah termasuk
          tax: 4950,
          service: 0,
          total: 45000,
          tax_included: true,
        }),
      }),
    )

    let sent: Record<string, unknown> = {}
    await page.route('**/api/bills', async (route) => {
      if (route.request().method() === 'POST') sent = route.request().postDataJSON()
      await route.continue()
    })

    await page.goto('/create')
    await pickPhotoThrough(page, 'Scan struk, isi otomatis')

    // pajak tidak boleh ikut ditambahkan lagi
    await expect(page.getByLabel('Pajak (di dalam harga)')).toBeDisabled()
    await expect(page.getByLabel('Pajak (di dalam harga)')).toHaveValue('')
    await expect(page.getByText(/Pajak sudah nempel di harga item/)).toBeVisible()

    await page.getByLabel('Nama bill').fill('Pajak termasuk ' + stamp)
    await page.getByRole('button', { name: 'Buat bill' }).click()
    await expect(page).toHaveURL(/\/b\//)

    expect(sent.tax_included).toBe(1)
    expect(sent.tax).toBe(0)
    await expect(page.getByText('Pajak (sudah termasuk)')).toBeVisible()
  })
})
