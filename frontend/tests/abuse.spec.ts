import { test, expect, type Page, type BrowserContext } from '@playwright/test'

/**
 * Abuse & ketahanan — bukan "apakah fiturnya ada", tapi "apa yang terjadi kalau
 * orangnya tidak sabar, jaringan jelek, atau dua orang menekan hal yang sama
 * pada saat yang sama".
 *
 * Semua kasus di sini menuntut satu hal: aplikasi tidak boleh berbohong. Kalau
 * aksi gagal, harus kelihatan gagal; kalau berhasil, angkanya harus utuh —
 * tidak boleh ada bagian dobel, bill dobel, atau angka yang berubah diam-diam.
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

async function createBill(page: Page, title: string, items: [string, string, string?][]) {
  await page.goto('/create')
  await page.getByLabel('Nama bill').fill(title)
  for (const [index, [name, price, qty]] of items.entries()) {
    if (index > 0) await page.getByRole('button', { name: '+ Tambah item' }).click()
    await page.getByLabel('Item ' + (index + 1)).fill(name)
    await page.getByLabel('Harga satuan').nth(index).fill(price)
    if (qty) await page.getByLabel('Qty').nth(index).fill(qty)
  }
  // Tunggu aplikasi menyatakan siap, jangan menebak lewat jeda: tombol ini
    // mati selama identitas belum siap, dan klik ke tombol mati hilang tanpa
    // jejak — di mesin lambat itu terbaca sebagai "aplikasi tidak berpindah".
    await expect(page.getByRole('button', { name: 'Buat bill' })).toBeEnabled()
    await page.getByRole('button', { name: 'Buat bill' }).click()
  await expect(page).toHaveURL(/\/b\//)
  return page.url().split('/b/')[1]
}

function identity(page: Page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('bagiin_identity') || '{}'))
}

async function apiBill(page: Page, billId: string, who: { id: string; secret: string }) {
  const res = await page.request.get('/api/bills/' + billId, {
    headers: { 'X-Identity-Id': who.id, 'X-Identity-Secret': who.secret },
  })
  expect(res.ok()).toBeTruthy()
  return res.json()
}

test.describe('Bagiin — orang tidak sabar (spam dan dobel tekan)', () => {
  test('A-01. ketuk item 6x cepat: porsi bertambah tepat 6, tidak ada pilihan dobel', async ({ page }) => {
    await freshUser(page, 'Spam ' + stamp)
    const billId = await createBill(page, 'Spam item ' + stamp, [['Kopi', '10000', '6']])
    const me = await identity(page)

    // aria-label baris berubah ("ketuk untuk memilih" -> "ketuk untuk
    // membatalkan"), jadi locator-nya pakai barisnya, bukan label tombolnya
    const row = page.locator('.ds-item').filter({ hasText: 'Kopi' }).first()
    // enam ketukan tanpa jeda: kalau UI memakai state lokal yang belum tersinkron,
    // angka bisa melompat atau pilihan terkirim dua kali
    for (let i = 0; i < 6; i++) await row.click({ delay: 0 })
    await expect(page.getByText('6/6')).toBeVisible({ timeout: 15_000 })

    const bill = await apiBill(page, billId, me)
    const selections = bill.sel_by_item[String(bill.items[0].id)] ?? []
    expect(selections.length, 'satu baris pilihan untuk satu orang').toBe(1)
    expect(selections[0].qty).toBe(6)
    expect(bill.people.find((p: any) => p.identity_id === me.id).total_idr).toBe(60000)
  })

  test('A-02. spam tombol Buat bill: hanya satu bill yang lahir', async ({ page }) => {
    await freshUser(page, 'Dobel ' + stamp)
    const me = await identity(page)
    const before = (await (await page.request.get('/api/identities/' + me.id + '/bills', {
      headers: { 'X-Identity-Id': me.id, 'X-Identity-Secret': me.secret },
    })).json()).length

    await page.goto('/create')
    await page.getByLabel('Nama bill').fill('Dobel ' + stamp)
    await page.getByLabel('Item 1').fill('Teh')
    await page.getByLabel('Harga satuan').first().fill('5000')

    const submit = page.getByRole('button', { name: 'Buat bill' })
    // tiga ketukan beruntun; tombol boleh mengunci diri (itu jawaban yang benar),
    // jadi ketukan yang ditolak bukan kegagalan tes
    await submit.click()
    await submit.click({ force: true, timeout: 2000 }).catch(() => {})
    await submit.click({ force: true, timeout: 2000 }).catch(() => {})
    await expect(page).toHaveURL(/\/b\//, { timeout: 15_000 })

    const after = await (await page.request.get('/api/identities/' + me.id + '/bills', {
      headers: { 'X-Identity-Id': me.id, 'X-Identity-Secret': me.secret },
    })).json()
    const created = after.filter((b: any) => b.title === 'Dobel ' + stamp)
    expect(created.length, 'judul sama, bill harus tunggal').toBe(1)
    expect(after.length - before).toBe(1)
  })

  test('A-03. spam Tandai lunas: satu pembayaran, tanpa error menumpuk', async ({ page }) => {
    await freshUser(page, 'Lunas ' + stamp)
    const billId = await createBill(page, 'Lunas ' + stamp, [['Roti', '15000']])
    const me = await identity(page)

    const mark = page.getByRole('button', { name: /Tandai lunas/ })
    if (await mark.count()) {
      await Promise.all([mark.click(), mark.click({ force: true }), mark.click({ force: true })])
    }
    await page.waitForTimeout(1500)

    const bill = await apiBill(page, billId, me)
    const mine = bill.people.find((p: any) => p.identity_id === me.id)
    expect(mine.paid, 'status akhir harus lunas').toBe('paid')

    const payments = await (await page.request.get('/api/bills/' + billId, {
      headers: { 'X-Identity-Id': me.id, 'X-Identity-Secret': me.secret },
    })).json()
    // total tetap sama walau tombol ditekan berkali-kali
    expect(payments.bill.total_idr).toBe(15000)
  })

  test('A-04. spam tombol tambah porsi berhenti di batas, tidak melewati qty', async ({ page }) => {
    await freshUser(page, 'Batas ' + stamp)
    const billId = await createBill(page, 'Batas ' + stamp, [['Sate', '8000', '2']])
    const me = await identity(page)

    const plus = page.getByRole('button', { name: /Tambah porsi Sate/ })
    for (let i = 0; i < 7; i++) await plus.click({ force: true }).catch(() => {})
    await page.waitForTimeout(1200)
    await expect(page.getByText('2/2')).toBeVisible({ timeout: 10_000 })

    const bill = await apiBill(page, billId, me)
    const sel = bill.sel_by_item[String(bill.items[0].id)] ?? []
    const taken = sel.reduce((sum: number, s: any) => sum + s.qty, 0)
    expect(taken, 'tidak boleh melebihi qty item').toBeLessThanOrEqual(2)
    expect(bill.people.find((p: any) => p.identity_id === me.id).total_idr).toBe(16000)
  })

  test('A-05. satu tamu menekan Ikut bill berkali-kali: tetap satu peserta', async ({ page, context }) => {
    await freshUser(page, 'Host ' + stamp)
    const billId = await createBill(page, 'Ikut ' + stamp, [['Nasi', '12000']])
    const link = '/b/' + billId

    // satu perangkat, tiga ketukan cepat. Nama sama di perangkat BERBEDA bukan
    // kasus ini: itu dua orang berbeda yang kebetulan senama, dan aplikasi
    // memang tidak boleh menyatukan mereka.
    const ctx = await context.browser()!.newContext({ viewport: { width: 390, height: 844 } })
    const guest = await ctx.newPage()
    await guest.goto(link)
    await guest.getByRole('button', { name: 'Ikut bill ini' }).first().click()
    await guest.getByLabel('Nama kamu').fill('Tamu ' + stamp)
    const save = guest.getByRole('button', { name: 'Simpan nama & ikut bill' })
    await save.click()
    await save.click({ force: true, timeout: 2000 }).catch(() => {})
    await save.click({ force: true, timeout: 2000 }).catch(() => {})
    await page.waitForTimeout(2000)

    const me = await identity(page)
    const bill = await apiBill(page, billId, me)
    const guests = bill.people.filter((p: any) => p.name === 'Tamu ' + stamp)
    expect(guests.length, 'satu perangkat = satu peserta').toBe(1)
    await ctx.close()
  })
})

  test('A-06. 2 minuman dibagi 4 orang: tiap orang bayar seperempat, layar tidak menulis "4 dari 2"', async ({ page, browser }) => {
    await freshUser(page, 'Pemilik ' + stamp)
    const billId = await createBill(page, 'Dua minum ' + stamp, [['Es teh', '20000', '2']])
    const me = await identity(page)
    const link = '/b/' + billId

    // empat tamu, masing-masing mengambil satu porsi dari dua minuman
    const contexts = []
    for (let i = 0; i < 4; i++) {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
      const p2 = await ctx.newPage()
      await p2.goto(link)
      await p2.getByRole('button', { name: 'Ikut bill ini' }).first().click()
      await p2.getByLabel('Nama kamu').fill('Numpang ' + i + ' ' + stamp)
      await p2.getByRole('button', { name: 'Simpan nama & ikut bill' }).click()
      await p2.waitForTimeout(900)
      await p2.locator('.ds-item').filter({ hasText: 'Es teh' }).first().click()
      await p2.waitForTimeout(700)
      contexts.push(ctx)
    }

    const bill = await apiBill(page, billId, me)
    const drinkers = bill.people.filter((p: any) => p.name.startsWith('Numpang '))
    expect(drinkers.length).toBe(4)
    for (const d of drinkers) {
      expect(d.total_idr, d.name + ' bayar seperempat').toBe(10000)
    }
    const sum = bill.people.reduce((acc: number, p: any) => acc + p.total_idr, 0)
    expect(sum + bill.uncovered_idr).toBe(40000)

    // dan layarnya harus jujur: bukan "4 dari 2 diambil"
    await page.reload()
    const row = page.locator('.ds-item').filter({ hasText: 'Es teh' }).first()
    await expect(row).toContainText('dibagi 4 orang', { timeout: 10_000 })
    await expect(row).not.toContainText('4 dari 2')
    for (const ctx of contexts) await ctx.close()
  })

test.describe('Bagiin — dua orang, satu bagian terakhir', () => {
  test('B-01. dua tamu menekan porsi terakhir bersamaan: uang tetap utuh, tidak ada yang hilang', async ({ page, browser }) => {
    await freshUser(page, 'Pemilik ' + stamp)
    const billId = await createBill(page, 'Slot ' + stamp, [['Tiket', '50000', '1']])
    const link = '/b/' + billId

    const ctxA = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const ctxB = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const a = await ctxA.newPage()
    const b = await ctxB.newPage()
    for (const [p2, name] of [[a, 'Ana ' + stamp], [b, 'Budi ' + stamp]] as const) {
      await p2.goto(link)
      await p2.getByRole('button', { name: 'Ikut bill ini' }).first().click()
      await p2.getByLabel('Nama kamu').fill(name)
      await p2.getByRole('button', { name: 'Simpan nama & ikut bill' }).click()
      await p2.waitForTimeout(1200)
    }

    // keduanya menekan item yang sama hampir bersamaan
    await Promise.all([
      a.locator('.ds-item').filter({ hasText: 'Tiket' }).first().click({ force: true }).catch(() => {}),
      b.locator('.ds-item').filter({ hasText: 'Tiket' }).first().click({ force: true }).catch(() => {}),
    ])
    await a.waitForTimeout(2500)

    const me = await identity(page)
    const bill = await apiBill(page, billId, me)
    // Invarian yang tidak boleh dilanggar apa pun hasil balapannya: uang yang
    // dibagi tidak boleh lebih atau kurang dari total bill.
    const sum = bill.people.reduce((acc: number, p: any) => acc + p.total_idr, 0)
    expect(sum + bill.uncovered_idr, 'uang harus utuh').toBe(bill.bill.total_idr)
    for (const p of bill.people) {
      expect(p.total_idr, 'tidak ada bagian negatif').toBeGreaterThanOrEqual(0)
      expect(Number.isInteger(p.total_idr), 'rupiah harus bulat').toBeTruthy()
    }
    await ctxA.close()
    await ctxB.close()
  })
})

test.describe('Bagiin — jaringan tidak bersahabat', () => {
  test('C-01. pilih item gagal di jaringan: pesan jelas, angka tidak berubah diam-diam', async ({ page }) => {
    await freshUser(page, 'Jaringan ' + stamp)
    const billId = await createBill(page, 'Jaringan ' + stamp, [['Sup', '20000']])
    const me = await identity(page)
    const before = await apiBill(page, billId, me)

    // endpoint sebenarnya: POST /api/bills/{id}/selections
    await page.route('**/api/bills/*/selections', (route) =>
      ['PUT', 'POST'].includes(route.request().method()) ? route.abort('failed') : route.continue(),
    )
    await page.getByRole('button', { name: /Sup, ketuk untuk memilih/ }).click({ force: true })
    await page.waitForTimeout(1200)

    const after = await apiBill(page, billId, me)
    expect(after.people.find((p: any) => p.identity_id === me.id).total_idr, 'server tidak berubah').toBe(
      before.people.find((p: any) => p.identity_id === me.id).total_idr,
    )
    const text = await page.locator('body').innerText()
    expect(text, 'harus ada pesan gagal, bukan diam').toMatch(/koneksi bermasalah|periksa internet/i)
  })

  test('C-02. daftar bill lambat: tidak ada angka 0 yang menipu selama memuat', async ({ page }) => {
    await freshUser(page, 'Lambat ' + stamp)
    await createBill(page, 'Lambat ' + stamp, [['Bakso', '18000']])

    await page.route('**/api/identities/*/bills', async (route) => {
      await new Promise((r) => setTimeout(r, 2500))
      await route.continue()
    })
    await page.goto('/')
    // selama memuat: kerangka/placeholder boleh, tapi jangan "Rp0" atau "tidak ada utang"
    const early = await page.locator('body').innerText()
    expect(early, 'jangan mengklaim nol sebelum data datang').not.toMatch(/Tidak ada utang tersisa/i)
    await expect(page.locator('a').filter({ hasText: 'Lambat ' + stamp }).first()).toBeVisible({
      timeout: 15_000,
    })
  })

  test('C-03. server menolak simpan nama: pesan muncul, nama lama tetap dipakai', async ({ page }) => {
    await freshUser(page, 'Namaku ' + stamp)
    // endpoint sebenarnya: POST /api/identities/{id}/name
    await page.route('**/api/identities/*/name', (route) =>
      route.fulfill({ status: 500, body: '{"detail":"server sedang sibuk"}' }),
    )
    await page.goto('/settings')
    const field = page.getByLabel(/Nama/).first()
    await field.fill('Nama Baru ' + stamp)
    await page.getByRole('button', { name: 'Simpan nama' }).click()
    await page.waitForTimeout(1200)
    const text = await page.locator('body').innerText()
    expect(text).toMatch(/gagal|sibuk|tidak bisa/i)
    await page.unrouteAll({ behavior: 'ignoreErrors' })
    await page.reload()
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('bagiin_identity') || '{}'))
    expect(stored.name, 'nama di perangkat tidak boleh berubah saat server menolak').toBe('Namaku ' + stamp)
  })
})

test.describe('Bagiin — isian nakal', () => {
  test('D-01. harga diisi huruf, minus, dan angka raksasa: ditolak rapi, tidak ada RpNaN', async ({ page }) => {
    await freshUser(page, 'Nakal ' + stamp)
    await page.goto('/create')
    await page.getByLabel('Nama bill').fill('Nakal ' + stamp)
    await page.getByLabel('Item 1').fill('Aneh')

    const price = page.getByLabel('Harga satuan').first()
    for (const bad of ['abc', '-5000', '12.345.678.901']) {
      await price.fill(bad)
      await page.waitForTimeout(200)
      const text = await page.locator('body').innerText()
      expect(text, 'input ' + bad).not.toMatch(/NaN|Infinity|undefined/)
    }
    await price.fill('25000')
    // Tunggu aplikasi menyatakan siap, jangan menebak lewat jeda: tombol ini
    // mati selama identitas belum siap, dan klik ke tombol mati hilang tanpa
    // jejak — di mesin lambat itu terbaca sebagai "aplikasi tidak berpindah".
    await expect(page.getByRole('button', { name: 'Buat bill' })).toBeEnabled()
    await page.getByRole('button', { name: 'Buat bill' }).click()
    await expect(page).toHaveURL(/\/b\//)
    const text = await page.locator('body').innerText()
    expect(text).not.toMatch(/NaN|Infinity/)
  })

  test('D-02. judul 400 karakter + emoji + newline tidak merusak layar', async ({ page }) => {
    await freshUser(page, 'Panjang ' + stamp)
    const long = ('Bill panjang 🍜 ' + 'x'.repeat(380)).slice(0, 400)
    await page.goto('/create')
    const titleField = page.getByLabel('Nama bill')
    await titleField.fill(long)
    // backend menolak > 120 karakter; klien harus menahannya lebih dulu
    const typed = (await titleField.inputValue()).length
    expect(typed, 'tidak boleh menampung 400 karakter lalu menunggu server menolak').toBeLessThanOrEqual(120)
    await page.getByLabel('Item 1').fill('Satu')
    await page.getByLabel('Harga satuan').first().fill('10000')
    // Tunggu aplikasi menyatakan siap, jangan menebak lewat jeda: tombol ini
    // mati selama identitas belum siap, dan klik ke tombol mati hilang tanpa
    // jejak — di mesin lambat itu terbaca sebagai "aplikasi tidak berpindah".
    await expect(page.getByRole('button', { name: 'Buat bill' })).toBeEnabled()
    await page.getByRole('button', { name: 'Buat bill' }).click()
    await expect(page).toHaveURL(/\/b\//, { timeout: 15_000 })

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
    expect(overflow, 'judul panjang tidak boleh melebarkan layar').toBeTruthy()
    await page.goto('/')
    const again = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
    expect(again).toBeTruthy()
  })

  test('D-03. item tanpa nama tidak bisa disimpan, dan pesannya menunjuk barisnya', async ({ page }) => {
    await freshUser(page, 'Kosong ' + stamp)
    await page.goto('/create')
    await page.getByLabel('Nama bill').fill('Kosong ' + stamp)
    // hanya isi harga, nama dibiarkan kosong
    await page.getByLabel('Harga satuan').first().fill('9000')
    const submit = page.getByRole('button', { name: 'Buat bill' })
    await expect(submit, 'tombol mati, bukan gagal diam-diam').toBeDisabled()
    // dan alasannya harus tertulis di layar, bukan cuma tombol yang tidak bisa diklik
    await expect(page.getByText(/minimal satu item|nama item/i).first()).toBeVisible()
    expect(page.url(), 'tidak boleh lanjut ke bill').not.toMatch(/\/b\//)
  })
})

test.describe('Bagiin — pindah layar tanpa kehilangan jejak', () => {
  test('E-01. kembali lalu maju: angka bill tetap sama', async ({ page }) => {
    await freshUser(page, 'Mundur ' + stamp)
    const billId = await createBill(page, 'Mundur ' + stamp, [['Soto', '23000', '2']])
    const me = await identity(page)
    await page.locator('.ds-item').filter({ hasText: 'Soto' }).first().click()
    await expect(page.getByText('1/2')).toBeVisible()

    await page.goBack()
    await expect(page).toHaveURL(/\/$|\/create/)
    await page.goForward()
    await expect(page).toHaveURL(new RegExp(billId))
    const bill = await apiBill(page, billId, me)
    expect(bill.people.find((p: any) => p.identity_id === me.id).total_idr).toBe(23000)
  })

  test('E-02. muat ulang di tengah jalan: pilihan tidak hilang', async ({ page }) => {
    await freshUser(page, 'Ulang ' + stamp)
    await createBill(page, 'Ulang ' + stamp, [['Mie', '17000', '2']])
    await page.getByRole('button', { name: /Mie, ketuk untuk memilih/ }).click()
    await page.waitForTimeout(900)
    await page.reload()
    await expect(page.getByText('1/2')).toBeVisible({ timeout: 10_000 })
  })

  test('E-03. dua tab identitas sama: aksi di tab satu terlihat di tab dua setelah muat ulang', async ({ page }) => {
    await freshUser(page, 'DuaTab ' + stamp)
    const billId = await createBill(page, 'DuaTab ' + stamp, [['Jus', '14000', '2']])
    const me = await identity(page)

    const ctx2 = await page.context().browser()!.newContext({ viewport: { width: 390, height: 844 } })
    const tab2 = await ctx2.newPage()
    await tab2.addInitScript((ident) => {
      localStorage.setItem('bagiin_identity', JSON.stringify(ident))
    }, me)
    await tab2.goto('/b/' + billId)
    await tab2.waitForTimeout(1200)

    await page.locator('.ds-item').filter({ hasText: 'Jus' }).first().click()
    await page.waitForTimeout(900)
    await tab2.reload()
    await expect(tab2.getByText('1/2')).toBeVisible({ timeout: 10_000 })
    await ctx2.close()
  })
})
