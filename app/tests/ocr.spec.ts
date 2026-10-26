import { test, expect, type Page } from '@playwright/test'

const stamp = Date.now().toString().slice(-6)

async function freshUser(page: Page, name: string) {
  await page.goto('/')
  if (await page.getByRole('button', { name: 'Mulai pakai Bagiin' }).count()) {
    await page.getByLabel('Nama kamu').fill(name)
    await page.getByRole('button', { name: 'Mulai pakai Bagiin' }).click()
  }
  await expect(page.getByRole('heading', { level: 1 })).toContainText(name)
}

// Layanan OCR gratis bisa butuh 30 detik sampai 3 menit (pernah 219 detik),
// jadi timeout bawaan 45 detik selalu gagal di jam sibuk.
test.describe.configure({ timeout: 300_000 })

test.describe('Bagiin — baca struk dari foto', () => {
  test('36. foto struk terbaca, angkanya masuk ke form, foto ikut tersimpan', async ({ page, browser }) => {
    await freshUser(page, 'Aufa')
    await page.goto('/create')

    // OCR bergantung layanan luar dan kuotanya bisa habis (Gemini 429).
    // Kalau penyedianya yang mati, tes ini di-skip dengan alasan jelas —
    // aplikasinya sendiri benar: dia menampilkan gangguan dan menyuruh isi manual.
    const done = page.getByText('Struk terbaca. Cek lagi angkanya ya.')
    const down = page.getByText(/Layanan AI (gratis )?sedang (mengalami gangguan|penuh)/)
    const input = page.locator('input[type="file"]')
    let read = false
    for (let attempt = 0; attempt < 3 && !read; attempt += 1) {
      await input.setInputFiles('tests/fixtures/receipt.png')
      const result = await Promise.race([
        done.waitFor({ timeout: 150_000 }).then(() => 'ok').catch(() => 'timeout'),
        down.waitFor({ timeout: 150_000 }).then(() => 'down').catch(() => 'timeout'),
      ])
      if (result === 'ok') { read = true; break }
      if (result === 'down') {
        test.skip(true, 'Penyedia OCR sedang 429 — bukan kegagalan aplikasi')
        return
      }
      await page.waitForTimeout(20_000)
    }
    if (!read) {
      test.skip(true, 'Penyedia OCR tidak menjawab dalam tiga percobaan')
      return
    }
    await expect(page.getByLabel('Merchant (opsional)')).toHaveValue('WARTEG BAHARI')
    await expect(page.getByLabel('Item 1')).toHaveValue('Nasi goreng')
    await expect(page.getByLabel('Item 2')).toHaveValue('Es teh manis')
    await expect(page.getByLabel('Item 3')).toHaveValue('Ayam bakar')
    await expect(page.getByLabel('Harga satuan').first()).toHaveValue('45.000')
    await expect(page.getByLabel('Pajak')).toHaveValue('8.800')
    await expect(page.getByText('Rp96.800').first()).toBeVisible()

    // foto sudah diunggah dan akan menempel di bill
    await expect(page.getByAltText('Foto struk yang dibaca')).toBeVisible()

    await page.getByLabel('Nama bill').fill('Struk ' + stamp)
    await page.getByRole('button', { name: 'Buat bill' }).click()
    await expect(page).toHaveURL(/\/b\//)
    await expect(page.getByText('Rp96.800').first()).toBeVisible()

    // foto benar-benar bisa dibuka dari layar bill
    await expect(page.getByText('Foto struk')).toBeVisible()
    const photo = page.getByAltText('Foto struk bill').first()
    await expect(photo).toBeVisible()
    const src = await photo.getAttribute('src')
    expect(src).toContain('/uploads/')
    const response = await page.request.get(src as string)
    expect(response.status()).toBe(200)

    // tamu mengambil satu baris saja: dua baris lain tetap belum diambil
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const guest = await ctx.newPage()
    await freshUser(guest, 'Bima')
    await guest.goto(page.url())
    await guest.getByRole('button', { name: 'Ikut bill ini' }).click()
    await guest.getByRole('button', { name: /Nasi goreng, ketuk untuk/ }).click()
    // nasi 45.000 + pajak proporsionalnya 4.500
    await expect(guest.getByText(/bagian kamu Rp49\.500/)).toBeVisible()
    await page.reload()
    await expect(page.getByText(/2 item belum dipilih/)).toBeVisible()
    await ctx.close()
  })

})
