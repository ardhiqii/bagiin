import { test, expect, type Page } from '@playwright/test'

const stamp = Date.now().toString().slice(-6)
const PHOTO = 'tests/fixtures/receipt.png'

async function freshUser(page: Page, name: string) {
  await page.goto('/')
  if (await page.getByRole('button', { name: 'Mulai pakai Bagiin' }).count()) {
    await page.getByLabel('Nama kamu').fill(name)
    await expect(page.getByRole('button', { name: 'Mulai pakai Bagiin' })).toBeEnabled({ timeout: 20000 })
    await page.getByRole('button', { name: 'Mulai pakai Bagiin' }).click()
  }
  await expect(page.getByRole('heading', { level: 1 })).toContainText(name)
}

/**
 * Satu tombol di kartu membuka daftar sumber (Kamera / Galeri / Tempel), lalu
 * foto berhenti di kartu pemeriksaan yang menanyakan niatnya. Alur tiga langkah
 * itu yang ditiru di sini, supaya tes tidak bisa lolos lewat jalan yang sudah
 * tidak ada.
 */
async function pickPhotoThrough(page: Page, niat: 'ocr' | 'attach', sumber = 'Galeri') {
  await page.getByRole('button', { name: /Tambah foto struk|Tambah foto/ }).first().click()
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: new RegExp(sumber) }).click(),
  ])
  await chooser.setFiles(PHOTO)
  await expect(page.getByText(/siap dipakai/)).toBeVisible({ timeout: 20000 })
  await page.getByRole('button', { name: niat === 'ocr' ? 'Baca pakai AI' : 'Lampirkan saja' }).click()
}

test.describe('Bill baru — foto boleh dibaca AI, boleh cuma dilampirkan', () => {
  test('38. lampirkan foto sebagai bukti tanpa memanggil AI', async ({ page }) => {
    await freshUser(page, 'Budi')
    let ocrCalls = 0
    await page.route('**/api/ocr', async (route) => {
      ocrCalls += 1
      await route.abort()
    })

    await page.goto('/create')
    await pickPhotoThrough(page, 'attach')

    await expect(page.locator('.photo-tile')).toHaveCount(1)
    await expect(page.getByText('bukti', { exact: true })).toBeVisible()
    await expect(page.getByText(/1 dari 10/)).toBeVisible()
    // tidak ada satu pun panggilan ke layanan AI
    expect(ocrCalls).toBe(0)

    // form tetap kosong: angkanya diketik sendiri
    await expect(page.getByLabel('Item 1')).toHaveValue('')
    await page.getByLabel('Nama bill').fill('Bukti manual ' + stamp)
    await page.getByLabel('Item 1').fill('Nasi uduk')
    await page.getByLabel('Harga satuan').fill('25.000')
    // Tunggu aplikasi menyatakan siap, jangan menebak lewat jeda: tombol ini
    // mati selama identitas belum siap, dan klik ke tombol mati hilang tanpa
    // jejak — di mesin lambat itu terbaca sebagai "aplikasi tidak berpindah".
    await expect(page.getByRole('button', { name: 'Buat bill' })).toBeEnabled()
    await page.getByRole('button', { name: 'Buat bill' }).click()
    await expect(page).toHaveURL(/\/b\//)
    await expect(page.getByText('Rp25.000').first()).toBeVisible()
    await expect(page.getByAltText('Foto struk bill').first()).toBeVisible()
  })

  test('39. AI gagal: pesannya jelas, dan foto tetap bisa dipakai sebagai bukti', async ({ page }) => {
    await freshUser(page, 'Budi')
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
    await pickPhotoThrough(page, 'ocr')

    await expect(page.getByText('Struk gagal dibaca')).toBeVisible()
    await expect(page.getByText(/Layanan AI gratis sedang penuh/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Coba baca lagi' })).toBeVisible()

    // jalan keluar: foto yang sama dilampirkan sebagai bukti, lalu isi manual
    await page.getByRole('button', { name: 'Pakai foto struk tadi sebagai bukti' }).click()
    await expect(page.locator('.photo-tile')).toHaveCount(1)
    await expect(page.getByText('bukti', { exact: true })).toBeVisible()
    await expect(page.getByText('Struk gagal dibaca')).toHaveCount(0)

    await page.getByLabel('Item 1').fill('Sate ayam')
    await page.getByLabel('Harga satuan').fill('30.000')
    // Tunggu aplikasi menyatakan siap, jangan menebak lewat jeda: tombol ini
    // mati selama identitas belum siap, dan klik ke tombol mati hilang tanpa
    // jejak — di mesin lambat itu terbaca sebagai "aplikasi tidak berpindah".
    await expect(page.getByRole('button', { name: 'Buat bill' })).toBeEnabled()
    await page.getByRole('button', { name: 'Buat bill' }).click()
    await expect(page).toHaveURL(/\/b\//)
    await expect(page.getByText('Rp30.000').first()).toBeVisible()
  })

  test('40. selama AI membaca, ada status berjalan dan tombol batal', async ({ page }) => {
    await freshUser(page, 'Budi')
    await page.route('**/api/ocr', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 6000))
      await route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'terlalu lama' }),
      })
    })

    await page.goto('/create')
    await pickPhotoThrough(page, 'ocr')

    await expect(page.getByText(/Membaca struk…/)).toBeVisible()
    await expect(page.getByText(/Bisa 10-60 detik/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Batal baca' })).toBeVisible()

    await page.getByRole('button', { name: 'Batal baca' }).click()
    await expect(page.getByText('Foto struk (opsional)')).toBeVisible()
    await expect(page.getByText(/Membaca struk…/)).toHaveCount(0)
  })

  test('40b. yang bergerak saat memindai hanya garis hijaunya, bukan ilustrasinya', async ({ page }) => {
    await freshUser(page, 'Candra')
    // Tahan keadaan memindai cukup lama untuk diukur.
    await page.route('**/api/ocr', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 15000))
      await route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'terlalu lama' }),
      })
    })

    await page.goto('/create')
    await pickPhotoThrough(page, 'ocr')
    await expect(page.locator('.ds-scan-frames')).toBeVisible({ timeout: 20000 })

    /* Ilustrasinya harus diam: dulu seluruh gambar diangguk 3 px, dan mata
       membacanya sebagai gambar goyang, bukan alat yang sedang memindai. */
    const latar = await page.evaluate(
      () => getComputedStyle(document.querySelector('.ds-scan-art > img') as Element).transform,
    )
    expect(latar, 'ilustrasi tidak boleh ikut bergerak').toBe('none')

    /* Pita pindainya 8 frame hasil generate: yang berubah adalah pilihan sel
       (background-position), bukan transform satu gambar. Diukur bukan dari
       animasinya tapi dari nilai yang benar-benar dipakai — kalau jarak
       langkahnya salah, posisinya jatuh di antara dua sel dan yang tampil
       potongan struk sebelah. */
    const baca = () =>
      page.evaluate(() => {
        const pita = document.querySelector('.ds-scan-frames') as HTMLElement
        const art = document.querySelector('.ds-scan-art') as HTMLElement
        const gaya = getComputedStyle(pita)
        return {
          posisi: gaya.backgroundPosition,
          ukuran: gaya.backgroundSize,
          animasi: gaya.animationName,
          pita: pita.getBoundingClientRect().toJSON(),
          art: art.getBoundingClientRect().toJSON(),
        }
      })

    const awal = await baca()
    expect(awal.animasi).toContain('ds-scan-frames')
    expect(awal.ukuran).toBe('800% 100%')
    await page.waitForTimeout(700)
    const tengah = await baca()
    expect(tengah.posisi, 'pitanya harus pindah frame').not.toBe(awal.posisi)

    // Selama bergerak, pitanya tetap di dalam kotak ilustrasi.
    for (const f of [awal, tengah]) {
      expect(f.pita.top, 'pita keluar dari atas kotak').toBeGreaterThanOrEqual(f.art.top - 0.5)
      expect(f.pita.bottom, 'pita keluar dari bawah kotak').toBeLessThanOrEqual(f.art.bottom + 0.5)
    }

    // Yang meminta gerak dikurangi: pitanya diam di frame pertama, bukan melambat.
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const diam = await page.evaluate(() => {
      const pita = document.querySelector('.ds-scan-frames') as HTMLElement
      return { animasi: getComputedStyle(pita).animationName, posisi: getComputedStyle(pita).backgroundPosition }
    })
    expect(diam.animasi, 'gerak dikurangi berarti animasinya mati').toBe('none')
    expect(diam.posisi, 'tanpa animasi, pitanya menetap di frame pertama').toBe('0px 0px')
  })

  test('40c. screenshot di papan klip bisa ditempel, teks biasa tidak mengganggu', async ({ page }) => {
    await freshUser(page, 'Sinta')
    let dibaca = 0
    await page.route('**/api/ocr', async (route) => {
      dibaca += 1
      await new Promise((resolve) => setTimeout(resolve, 1200))
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ title: 'Gojek', items: [{ name: 'Nasi padang', price: 35000 }] }),
      })
    })

    await page.goto('/create')
    await page.locator('#bill-title').waitFor()

    // Teks biasa: biarkan menempel di kolomnya, jangan dianggap foto.
    await page.evaluate(() => {
      const dt = new DataTransfer()
      dt.setData('text/plain', 'halo, ini cuma teks')
      document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }))
    })
    await page.waitForTimeout(400)
    expect(dibaca, 'teks tidak boleh memicu pembacaan struk').toBe(0)

    /* Ctrl+V dengan gambar: event paste membawa datanya sendiri, jadi jalur ini
       juga berlaku di komputer yang tidak memberi izin baca papan klip. */
    await page.evaluate(async () => {
      const png =
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='
      const blob = await (await fetch(png)).blob()
      const dt = new DataTransfer()
      dt.items.add(new File([blob], 'screenshot.png', { type: 'image/png' }))
      document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }))
    })

    /* Yang tertempel belum dibaca: niatnya ditanyakan dulu, dan thumbnail-nya
       tampil supaya orang bisa memastikan itu struk yang benar. */
    await expect(page.getByText('Screenshot siap dipakai')).toBeVisible({ timeout: 10000 })
    await expect(page.locator('.photo-review-frame img')).toBeVisible()
    expect(dibaca, 'tempelan tidak boleh langsung dibaca tanpa ditanya').toBe(0)

    await page.getByRole('button', { name: 'Baca pakai AI' }).click()
    await expect(page.locator('.ds-create-hero.is-scanning')).toBeVisible({ timeout: 20000 })
    await expect(page.locator('.ds-scan-frames')).toBeVisible()
    await expect(page.locator('#bill-title')).toHaveValue(/Gojek/i, { timeout: 20000 })
    expect(dibaca, 'setelah dipilih, tempelan dibaca AI').toBe(1)
  })

  test('40e. tempel berkali-kali: bertambah, bisa dibuang, dan tidak saling menimpa', async ({ page }) => {
    await freshUser(page, 'Eko')
    await page.route('**/api/ocr', async (route) => {
      await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
    })

    await page.goto('/create')
    await page.locator('#bill-title').waitFor()

    const tempel = (warna: string) =>
      page.evaluate(async (isi) => {
        const png = `data:image/png;base64,${isi}`
        const blob = await (await fetch(png)).blob()
        const dt = new DataTransfer()
        dt.items.add(new File([blob], 's.png', { type: 'image/png' }))
        document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }))
      }, warna)

    const satu = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='
    await tempel(satu)
    await expect(page.getByText('Screenshot siap dipakai')).toBeVisible({ timeout: 10000 })

    // Tempelan kedua dan ketiga menambah, bukan menimpa.
    await page.evaluate(async (isi) => {
      const blob = await (await fetch(`data:image/png;base64,${isi}`)).blob()
      for (let i = 0; i < 2; i++) {
        const dt = new DataTransfer()
        dt.items.add(new File([blob], `s${i}.png`, { type: 'image/png' }))
        document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }))
        await new Promise((r) => setTimeout(r, 120))
      }
    }, satu)

    await expect(page.getByText('3 foto siap dipakai')).toBeVisible({ timeout: 10000 })
    // Strip memuat semua foto, termasuk yang sedang besar — hitungan di judul
    // dan jumlah kotak di strip harus sama.
    await expect(page.locator('.photo-review-item')).toHaveCount(3)
    await expect(page.getByText('3 dari 10')).toBeVisible()

    await page.getByRole('button', { name: 'Buang foto ke-2' }).click()
    await expect(page.getByText('2 foto siap dipakai')).toBeVisible()
    await expect(page.locator('.photo-review-item')).toHaveCount(2)

    await page.getByRole('button', { name: 'Lampirkan saja' }).click()
    await expect(page.getByText(/2 foto dilampirkan sebagai bukti/i)).toBeVisible({ timeout: 20000 })
  })

  test('40d. tempelan juga bisa cuma dilampirkan sebagai bukti, tanpa AI', async ({ page }) => {
    await freshUser(page, 'Zaki')
    let dibaca = 0
    await page.route('**/api/ocr', async (route) => {
      dibaca += 1
      await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
    })

    await page.goto('/create')
    await page.locator('#bill-title').waitFor()
    await page.evaluate(async () => {
      const png =
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='
      const blob = await (await fetch(png)).blob()
      const dt = new DataTransfer()
      dt.items.add(new File([blob], 'screenshot.png', { type: 'image/png' }))
      document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }))
    })

    await expect(page.getByText('Screenshot siap dipakai')).toBeVisible({ timeout: 10000 })
    await page.getByRole('button', { name: 'Lampirkan saja' }).click()

    await expect(page.getByText(/dilampirkan sebagai bukti/i)).toBeVisible({ timeout: 20000 })
    await expect(page.locator('.photo-review')).toHaveCount(0)
    expect(dibaca, 'lampirkan saja tidak boleh memanggil AI').toBe(0)
  })

  test('41. struk yang pajaknya sudah termasuk: kolom pajak dikunci, bill ditandai', async ({ page }) => {
    await freshUser(page, 'Budi')
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
    await page.route('**/api/bills*', async (route) => {
      if (route.request().method() === 'POST') sent = route.request().postDataJSON()
      await route.continue()
    })

    await page.goto('/create')
    await pickPhotoThrough(page, 'ocr')

    // pajak tidak boleh ikut ditambahkan lagi
    await expect(page.getByLabel('Pajak (di dalam harga)')).toBeDisabled()
    await expect(page.getByLabel('Pajak (di dalam harga)')).toHaveValue('')
    await expect(page.getByText(/Pajak sudah nempel di harga item/)).toBeVisible()

    await page.getByLabel('Nama bill').fill('Pajak termasuk ' + stamp)
    // Tunggu aplikasi menyatakan siap, jangan menebak lewat jeda: tombol ini
    // mati selama identitas belum siap, dan klik ke tombol mati hilang tanpa
    // jejak — di mesin lambat itu terbaca sebagai "aplikasi tidak berpindah".
    await expect(page.getByRole('button', { name: 'Buat bill' })).toBeEnabled()
    await page.getByRole('button', { name: 'Buat bill' }).click()
    await expect(page).toHaveURL(/\/b\//)

    expect(sent.tax_included).toBe(1)
    expect(sent.tax).toBe(0)
    await expect(page.getByText('Pajak (sudah termasuk)')).toBeVisible()
  })

  test('42. beberapa foto sekaligus: struk panjang atau screenshot pesanan', async ({ page }) => {
    await freshUser(page, 'Budi')
    await page.goto('/create')

    await page.getByRole('button', { name: 'Tambah foto', exact: true }).click()
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByRole('button', { name: 'Galeri' }).click(),
    ])
    await chooser.setFiles([PHOTO, PHOTO, PHOTO])

    await expect(page.getByText('3 foto siap dipakai')).toBeVisible({ timeout: 20000 })
    await page.getByRole('button', { name: 'Lampirkan saja' }).click()

    await expect(page.locator('.photo-tile')).toHaveCount(3)
    await expect(page.getByText(/3 dari 10/)).toBeVisible()

    // satu foto bisa dilepas lagi tanpa mengganggu yang lain
    await page.locator('.photo-tile .photo-kill').first().click()
    await expect(page.locator('.photo-tile')).toHaveCount(2)

    await page.getByLabel('Nama bill').fill('Pesanan panjang ' + stamp)
    await page.getByLabel('Item 1').fill('Paket hemat')
    await page.getByLabel('Harga satuan').fill('55.000')
    // Tunggu aplikasi menyatakan siap, jangan menebak lewat jeda: tombol ini
    // mati selama identitas belum siap, dan klik ke tombol mati hilang tanpa
    // jejak — di mesin lambat itu terbaca sebagai "aplikasi tidak berpindah".
    await expect(page.getByRole('button', { name: 'Buat bill' })).toBeEnabled()
    await page.getByRole('button', { name: 'Buat bill' }).click()
    await expect(page).toHaveURL(/\/b\//)
    await expect(page.getByAltText('Foto struk bill')).toHaveCount(2)
  })

  /**
   * Hasil bacaan AI harus bisa diperiksa sebelum bill disimpan. Dulu foto di
   * layar buat bill hanya gambar mati: satu-satunya cara melihat penuh adalah
   * menyimpan bill dulu, lalu membukanya dari beranda.
   */
  test('43. foto struk bisa diketuk untuk diperiksa penuh sebelum disimpan', async ({ page }) => {
    await freshUser(page, 'Budi')
    await page.goto('/create')

    await page.getByRole('button', { name: 'Tambah foto', exact: true }).click()
    const chooserPromise = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: 'Galeri' }).click()
    const chooser = await chooserPromise
    const niatLampir = page.getByRole('button', { name: 'Lampirkan saja' })
    // struk kecil apa saja: yang diuji di sini membuka penampil, bukan isi fotonya
    await chooser.setFiles({
      name: 'struk.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
        'base64',
      ),
    })

    await expect(page.getByText('Screenshot siap dipakai')).toBeVisible({ timeout: 20000 })
    await niatLampir.click()

    await expect(page.locator('.photo-tile')).toHaveCount(1)
    await page.locator('.photo-open').first().click()

    const sheet = page.getByRole('dialog')
    await expect(sheet).toBeVisible()
    await expect(sheet.getByRole('img', { name: /Foto struk bukti 1/ })).toBeVisible()
    await expect(sheet).toContainText('Cocokkan angkanya')
  })

  /**
   * Hasil bacaan AI harus bisa dicek juga saat bill diubah, bukan hanya saat
   * dibuat. Dulu layar Ubah bill tidak menampilkan foto sama sekali, jadi
   * untuk membandingkan angka dengan struk harus keluar ke layar bill.
   */
  test('44. foto struk ikut tampil di layar Ubah bill dan bisa dilihat penuh', async ({ page }) => {
    await freshUser(page, 'Budi')
    await page.goto('/create')
    await pickPhotoThrough(page, 'attach')
    await page.getByLabel('Nama bill').fill('Ubah Foto ' + stamp)
    await page.getByLabel('Item 1').fill('Nasi goreng')
    await page.getByLabel('Harga satuan').first().fill('30000')
    await page.getByRole('button', { name: 'Buat bill' }).click()
    await expect(page).toHaveURL(/\/b\//)

    await page.getByRole('button', { name: 'Aksi lain' }).click()
    await page.waitForTimeout(150)
    await page.getByRole('button', { name: 'Ubah bill' }).click()
    await expect(page).toHaveURL(/\/edit$/)
    await expect(page.locator('.photo-tile')).toHaveCount(1)

    await page.locator('.photo-open').first().click()
    const sheet = page.getByRole('dialog')
    await expect(sheet).toBeVisible()
    await expect(sheet.getByRole('img', { name: /Foto struk 1/ })).toBeVisible()
  })
})
