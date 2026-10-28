import { test, expect, type Page } from '@playwright/test'

/**
 * Kasus yang lahir dari matriks versi 2 (`TEST-MATRIX.md`).
 *
 * Fokusnya bukan mengulang tes lama, tapi menutup celah yang muncul justru
 * karena fitur akun/kontak ada: tamu yang naik jadi akun, layar masuk yang
 * menyatu, dan centering di layar lebar.
 */

const stamp = Date.now().toString().slice(-6)

async function identityId(page: Page): Promise<string> {
  return page.evaluate(() => JSON.parse(localStorage.getItem('bagiin_identity') || '{}').id)
}

/** Tamu: isi nama di layar masuk, lalu masuk ke beranda. */
async function startAsGuest(page: Page, name: string) {
  await page.goto('/')
  await page.getByLabel('Nama kamu').fill(name)
  await page.getByRole('button', { name: 'Mulai pakai Bagiin' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText(name)
}

test.describe('Bagiin v2 — akun yang naik dari tamu', () => {
  test('V-01. tamu memasang username+password, lalu masuk dari perangkat lain ke identitas yang sama', async ({ page, browser }) => {
    test.setTimeout(120_000)
    const username = 'naik_' + stamp
    await startAsGuest(page, 'Tamu Naik ' + stamp)
    const guestId = await identityId(page)

    // bill dulu, supaya ada yang harus ikut pindah perangkat
    await page.goto('/create')
    await page.getByLabel('Nama bill').fill('Bill Naik ' + stamp)
    await page.getByLabel('Item 1').fill('Kopi')
    await page.getByLabel('Harga satuan').first().fill('20000')
    // Tunggu aplikasi menyatakan siap, jangan menebak lewat jeda: tombol ini
    // mati selama identitas belum siap, dan klik ke tombol mati hilang tanpa
    // jejak — di mesin lambat itu terbaca sebagai "aplikasi tidak berpindah".
    await expect(page.getByRole('button', { name: 'Buat bill' })).toBeEnabled()
    await page.getByRole('button', { name: 'Buat bill' }).click()
    await expect(page).toHaveURL(/\/b\//)

    // pasang username + password dari Pengaturan
    await page.goto('/settings')
    await page.getByRole('button', { name: /^Username/ }).first().click()
    await page.getByLabel('Username baru').fill(username)
    await page.getByRole('button', { name: 'Simpan username' }).click()
    await expect(page.getByText('Username disimpan')).toBeVisible()

    await page.getByRole('button', { name: /^Password/ }).first().click()
    // belum pernah punya password: tidak boleh diminta "password sekarang"
    await expect(page.getByLabel('Password sekarang')).toHaveCount(0)
    await page.getByLabel('Password baru', { exact: true }).fill('rahasia123')
    await page.getByLabel('Ulangi password baru').fill('rahasia123')
    await page.getByRole('button', { name: 'Simpan password' }).click()
    await expect(page.getByText('Password disimpan')).toBeVisible()

    // perangkat lain: masuk pakai username+password
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const phone = await ctx.newPage()
    await phone.goto('/masuk')
    await phone.getByRole('tab', { name: 'Akun' }).click()
    await phone.getByLabel('Username').fill(username)
    await phone.getByLabel('Password').fill('rahasia123')
    await phone.getByRole('button', { name: 'Masuk', exact: true }).click()

    await expect(phone.getByRole('heading', { level: 1 })).toContainText('Tamu Naik ' + stamp)
    expect(await identityId(phone), 'identitas sama, bukan akun baru').toBe(guestId)
    // bill yang dibuat sebagai tamu ikut ke perangkat ini
    await expect(phone.getByText('Bill Naik ' + stamp)).toBeVisible()
    await ctx.close()
  })

  test('V-02. tamu menautkan Google, lalu login dengan Google yang sama mendarat di identitas itu', async ({ page }) => {
    test.setTimeout(120_000)
    const config = await (await page.request.get('/api/auth/config')).json()
    test.skip(!config.google_stub, 'Server tidak menjalankan mode uji Google')

    await startAsGuest(page, 'Tamu Google ' + stamp)
    const guestId = await identityId(page)
    const secret = await page.evaluate(
      () => JSON.parse(localStorage.getItem('bagiin_identity') || '{}').secret,
    )
    const headers = { 'X-Identity-Id': guestId, 'X-Identity-Secret': secret }

    // Tombol GIS tidak bisa dipakai di tes tanpa akun Google sungguhan, jadi
    // penautan dilakukan lewat jalur yang sama dengan yang dipanggil tombol itu.
    // `sub` dipatok supaya bisa diuji: stub di layar membuat sub acak tiap klik,
    // dan itu memang tidak bisa menguji "login berikutnya mendarat di sini".
    const sub = 'taut-tetap-' + stamp
    const linked = await page.request.post('/api/auth/google', {
      headers,
      data: { id_token: `stub:${sub}:${sub}@example.com:Tamu Google`, mode: 'link' },
    })
    expect(linked.ok()).toBeTruthy()

    // layar Pengaturan harus menampilkan keadaan barunya, bukan "Belum tertaut"
    await page.goto('/settings')
    await expect(page.getByRole('button', { name: /^Google/ }).first()).toContainText('Tertaut')

    // login berikutnya dengan kredensial Google yang sama: identitas yang sama
    const login = await page.request.post('/api/auth/google', {
      data: { id_token: `stub:${sub}:${sub}@example.com:Tamu Google`, mode: 'login' },
    })
    expect(login.ok()).toBeTruthy()
    const body = await login.json()
    expect(body.identity.id, 'Google mengarah ke identitas tamu tadi').toBe(guestId)
  })
})

test.describe('Bagiin v2 — satu layar masuk', () => {
  test('V-03. semua cara masuk terlihat tanpa menggulir di 390x844', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('tab')).toHaveCount(3)
    for (const tab of ['Nama', 'Kode', 'Akun']) {
      await expect(page.getByRole('tab', { name: tab })).toBeVisible()
    }
    await expect(page.getByTestId('google-slot')).toBeVisible()

    // tidak ada yang butuh skrol: kartu masuk lebih pendek dari layar
    const box = await page.locator('.welcome-card').boundingBox()
    expect(box).not.toBeNull()
    expect(Math.round((box?.height ?? 0) + (box?.y ?? 0))).toBeLessThanOrEqual(844)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth)
    expect(overflow, 'tidak ada geser horizontal').toBeLessThanOrEqual(390 + 1)
  })

  test('V-04. /masuk membuka tab Kode, beranda membuka tab Nama', async ({ page }) => {
    await page.goto('/masuk')
    await expect(page.getByRole('tab', { name: 'Kode' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByLabel('Kode pemulihan')).toBeVisible()

    await page.goto('/')
    await expect(page.getByRole('tab', { name: 'Nama' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByLabel('Nama kamu')).toBeVisible()
  })

  test('V-05. identitas basi membuka tab Kode, bukan Nama', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        'bagiin_identity',
        JSON.stringify({ id: 'basi-' + Date.now(), name: 'Basi', role: 'creator', secret: 'mati' }),
      )
    })
    await page.goto('/')
    await expect(page.getByText(/sudah tidak ada di server/)).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Kode' })).toHaveAttribute('aria-selected', 'true')
    // kolom nama tidak ditawarkan lebih dulu: mengisi nama baru = profil kosong
    await expect(page.getByLabel('Nama kamu')).toHaveCount(0)
    await expect(page.getByLabel('Kode pemulihan')).toBeVisible()
  })
})

test.describe('Bagiin v2 — batas tampilan', () => {
  test('V-06. nama 60 karakter + emoji tampil utuh tanpa merusak layout', async ({ page }) => {
    const name = 'Aufa ' + '🦖'.repeat(3) + ' ' + 'x'.repeat(48)
    await startAsGuest(page, name)
    const heading = page.getByRole('heading', { level: 1 })
    await expect(heading).toContainText('🦖')
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth)
    expect(overflow).toBeLessThanOrEqual(390 + 1)
  })

  test('V-07. layar masuk di 1280 px benar-benar center', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const page = await ctx.newPage()
    await page.goto('/')
    const box = await page.locator('.welcome-card').boundingBox()
    expect(box).not.toBeNull()
    const cardCenter = Math.round((box?.x ?? 0) + (box?.width ?? 0) / 2)
    expect(Math.abs(cardCenter - 640), 'kartu tidak boleh geser dari pusat layar').toBeLessThanOrEqual(2)

    // tidak ada sisa kolom rail (garis tepi frame) di layar tanpa navigasi
    const borderLeft = await page.evaluate(() => {
      const frame = document.querySelector('.app-frame')
      return frame ? getComputedStyle(frame).borderLeftWidth : '0px'
    })
    expect(borderLeft).toBe('0px')
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth)
    expect(overflow).toBeLessThanOrEqual(1280 + 1)
    await ctx.close()
  })
})

test.describe('Bagiin v2 — penolakan', () => {
  test('V-08. kode pemulihan salah: pesan jelas, tidak ada identitas yang dibuat', async ({ page, browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const clean = await ctx.newPage()
    await clean.goto('/masuk')
    await clean.getByLabel('Kode pemulihan').fill('SALAH-KODE-99')
    await clean.getByRole('button', { name: 'Masuk', exact: true }).click()
    await expect(clean.getByText(/Kode tidak dikenal/)).toBeVisible()
    expect(await clean.evaluate(() => localStorage.getItem('bagiin_identity'))).toBeNull()
    await ctx.close()
  })

  test('V-09. token perangkat satu identitas ditolak untuk identitas lain', async ({ page }) => {
    const a = await page.request.post('/api/identities', { data: { name: 'Token A ' + stamp } })
    const identA = await a.json()
    const b = await page.request.post('/api/identities', { data: { name: 'Token B ' + stamp } })
    const identB = await b.json()

    // token A dipakai mengaku sebagai B
    const crossed = await page.request.get(`/api/identities/${identB.id}/me`, {
      headers: { 'X-Identity-Id': identB.id, 'X-Identity-Secret': identA.secret },
    })
    expect(crossed.status(), 'token tidak boleh lintas identitas').toBe(403)
  })
})

test.describe('Bagiin v2 — pengingat amankan akun', () => {
  test('V-10. pengingat hanya muncul untuk tamu yang sudah punya bill, dan menetap setelah ditutup', async ({ page }) => {
    test.setTimeout(120_000)
    await startAsGuest(page, 'Tamu Nudge ' + stamp)
    // belum ada bill: tidak ada yang bisa hilang, jadi tidak mengingatkan
    await expect(page.locator('.nudge-card')).toHaveCount(0)

    await page.goto('/create')
    await page.getByLabel('Nama bill').fill('Nudge ' + stamp)
    await page.getByLabel('Item 1').fill('Kopi')
    await page.getByLabel('Harga satuan').first().fill('20000')
    // Tunggu aplikasi menyatakan siap, jangan menebak lewat jeda: tombol ini
    // mati selama identitas belum siap, dan klik ke tombol mati hilang tanpa
    // jejak — di mesin lambat itu terbaca sebagai "aplikasi tidak berpindah".
    await expect(page.getByRole('button', { name: 'Buat bill' })).toBeEnabled()
    await page.getByRole('button', { name: 'Buat bill' }).click()
    await expect(page).toHaveURL(/\/b\//)

    await page.goto('/')
    await expect(page.locator('.nudge-card')).toHaveCount(1)
    await page.getByRole('button', { name: 'Nanti' }).click()
    await expect(page.locator('.nudge-card')).toHaveCount(0)

    await page.reload()
    await expect(page.locator('.nudge-card')).toHaveCount(0)
  })
})
