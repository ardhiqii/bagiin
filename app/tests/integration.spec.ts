import { test, expect, type Page, type Browser } from '@playwright/test'

/**
 * Storyboard integrasi tiga layar (lihat STORYBOARD.md).
 *
 * Kenapa file ini ada: tiap layar bisa "lulus" sendiri-sendiri sambil
 * menampilkan angka yang berbeda. Yang diuji di sini janji antar-layar: setelah
 * satu perubahan, Beranda, Bill, dan Rekap menceritakan angka yang sama — tanpa
 * reload. Karena itu perpindahan layar memakai klik navigasi, bukan page.goto():
 * goto memuat ulang aplikasi dan selalu menyembunyikan cache yang basi.
 *
 * Uang berpindah antara dua orang, jadi kasus yang menyentuh piutang memakai
 * dua konteks browser: pemilik bill dan tamu yang ikut lewat link.
 */

const stamp = Date.now().toString().slice(-6)

type Identity = { id: string; secret: string }

async function identity(page: Page): Promise<Identity> {
  const raw = await page.evaluate(() => localStorage.getItem('bagiin_identity'))
  if (!raw) throw new Error('belum punya identitas')
  return JSON.parse(raw)
}

async function apiGet<T = any>(page: Page, path: string): Promise<T> {
  const me = await identity(page)
  const res = await page.request.get(path, {
    headers: { 'X-Identity-Id': me.id, 'X-Identity-Secret': me.secret },
  })
  if (!res.ok()) throw new Error('GET ' + path + ' -> ' + res.status())
  return res.json()
}

/** "Rp22.000" -> 22000 */
function num(text: string | null | undefined): number {
  const digits = (text ?? '').replace(/[^\d]/g, '')
  return digits ? Number(digits) : 0
}

/**
 * Angka di kolom kanan baris bill. Sel ini berisi dua baris: bagian saya dan
 * "dari Rp…" (total bill). textContent menggabungkan keduanya, jadi tanpa
 * pemisah ini 6.000 + 30.000 terbaca 6.00030.000.
 */
async function rowAmount(row: import('@playwright/test').Locator) {
  const text = (await row.locator('.amt').innerText()).split('dari')[0]
  return num(text)
}

async function freshUser(page: Page, name: string) {
  await page.goto('/')
  if (await page.getByRole('button', { name: 'Mulai pakai Bagiin' }).count()) {
    await page.getByLabel('Nama kamu').fill(name)
    await page.getByRole('button', { name: 'Mulai pakai Bagiin' }).click()
  }
  await expect(page.getByRole('heading', { level: 1 })).toContainText(name)
}

async function nav(page: Page, name: 'Beranda' | 'Buat' | 'Rekap') {
  await page.locator('nav[aria-label="Navigasi utama"]').getByRole('link', { name }).click()
  await page.waitForTimeout(400)
}

async function goHome(page: Page) {
  await nav(page, 'Beranda')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Halo')
  await page.waitForTimeout(300)
}

async function goRecap(page: Page) {
  await nav(page, 'Rekap')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Rekap')
  await page.waitForTimeout(600)
}

/**
 * Aksi sekunder bill (tutup, tandai lunas, ganti pembayar, keluar) ada di sheet
 * "Aksi lain" — bukan tombol di layar. Tanpa membuka sheet dulu, locator-nya
 * tidak akan pernah muncul dan tes menunggu sampai timeout.
 */
async function openActions(page: Page) {
  await page.getByRole('button', { name: 'Aksi lain' }).click()
  await page.waitForTimeout(300)
}

/** Item bill adalah tombol: "Kopi, ketuk untuk memilih". */
async function pickItem(page: Page, name: string) {
  await page.getByRole('button', { name: new RegExp(name + ', ketuk') }).first().click()
  await page.waitForTimeout(800)
}

async function createBill(page: Page, opts: { title: string; items: { name: string; price: string }[] }) {
  await nav(page, 'Buat')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Bill baru')
  await page.getByLabel('Nama bill').fill(opts.title)
  // baris item dimulai dari satu; sisanya ditambah lewat tombol "Tambah item"
  for (let i = 1; i < opts.items.length; i++) {
    await page.getByRole('button', { name: /Tambah item/ }).click()
    await page.waitForTimeout(150)
  }
  for (let i = 0; i < opts.items.length; i++) {
    await page.getByLabel('Item ' + (i + 1)).fill(opts.items[i].name)
    await page.getByLabel('Harga satuan').nth(i).fill(opts.items[i].price)
  }
  await page.getByRole('button', { name: 'Buat bill' }).click()
  await expect(page).toHaveURL(/\/b\//)
  await page.waitForTimeout(600)
  return page.url().split('/b/')[1]
}

/** Tamu membuka link, mengisi nama, ikut, lalu memilih itemnya. */
async function guestJoins(browser: Browser, billUrl: string, name: string, item?: string) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  await page.goto(billUrl)
  await page.getByRole('button', { name: 'Ikut bill ini' }).click()
  await page.getByLabel('Nama kamu').fill(name)
  await page.getByRole('button', { name: 'Simpan nama & ikut bill' }).click()
  await expect(page.getByText('Kamu masuk ke bill ini')).toBeVisible()
  if (item) await pickItem(page, item)
  return { ctx, page }
}


async function apiSend(page: Page, path: string, body: unknown = {}) {
  const me = await identity(page)
  const res = await page.request.post(path, {
    headers: { 'X-Identity-Id': me.id, 'X-Identity-Secret': me.secret },
    data: body,
  })
  if (!res.ok()) throw new Error('POST ' + path + ' -> ' + res.status() + ' ' + (await res.text()).slice(0, 120))
  return res.json().catch(() => ({}))
}


async function sendWithMethod(page: Page, method: 'POST' | 'DELETE' | 'PUT', path: string, body?: unknown) {
  const me = await identity(page)
  const res = await page.request.fetch(path, {
    method,
    headers: { 'X-Identity-Id': me.id, 'X-Identity-Secret': me.secret },
    data: body ?? {},
  })
  if (!res.ok()) throw new Error(method + ' ' + path + ' -> ' + res.status())
  return res.json().catch(() => ({}))
}

async function cardValue(page: Page) {
  return num(await page.locator('.ds-balance-value').first().textContent())
}

async function recapCardOrZero(page: Page) {
  const card = page.locator('.ds-balance-value')
  if (!(await card.count())) return 0
  return num(await card.first().textContent())
}

/** Invariant lintas endpoint — bukan asumsi UI. */
async function assertRecapShape(page: Page) {
  const recap = await apiGet(page, '/api/identities/' + (await identity(page)).id + '/recap')
  const finalIds = new Set<string>()
  let sum = 0
  for (const person of recap.final.counterparties) {
    for (const edge of person.bills) finalIds.add(edge.bill_id)
    sum += person.amount_idr
  }
  const unclearIds = new Set<string>(recap.provisional.bills.map((b: any) => b.bill_id))
  for (const id of finalIds) {
    expect(unclearIds.has(id), 'bill ' + id + ' muncul di final sekaligus belum jelas').toBe(false)
  }
  expect(sum, 'jumlah nominal final != payable + receivable').toBe(
    recap.final.payable_idr + recap.final.receivable_idr,
  )
  return { recap, finalIds, unclearIds }
}

test.describe('Bagiin — integrasi Beranda, Bill, Rekap', () => {
  test('73. bill baru: beranda & rekap sama-sama tahu, tapi uang belum pasti tidak masuk hitungan final', async ({ page }) => {
    await freshUser(page, 'Integrasi A ' + stamp)
    const title = 'Kopi Integrasi ' + stamp
    const billId = await createBill(page, { title, items: [{ name: 'Kopi', price: '20000' }] })
    const me = await identity(page)

    const bill = await apiGet(page, '/api/bills/' + billId)
    expect(await cardValue(page)).toBe(bill.bill.total_idr)

    await goHome(page)
    const rows = await apiGet(page, '/api/identities/' + me.id + '/bills')
    const rowApi = rows.find((r: any) => r.id === billId)
    const row = page.locator('.app-row', { hasText: title })
    await expect(row).toBeVisible()
    expect(await rowAmount(row)).toBe(rowApi.my_total_idr)

    // "belum lunas" di kepala layar harus soal bagian saya, bukan bill terbuka:
    // di sini pemilik sudah menalangi, jadi tidak ada bagian saya yang belum lunas
    await expect(page.getByText(/semua bagianmu lunas/)).toBeVisible()

    // dua layar, satu angka: catatan di kartu saldo harus sama dengan jumlah
    // bill yang benar-benar tidak bisa dihitung pasti di rekap
    const recapNow = await apiGet(page, '/api/identities/' + me.id + '/recap')
    if (recapNow.provisional.bill_count > 0) {
      // angka yang sama boleh muncul di dua tempat berbeda, tergantung ada
      // tidaknya uang yang sudah pasti: kartu saldo kalau ada, notice kalau nol
      const holder = recapNow.final.net_idr === 0 ? '.ds-notice' : '.ds-balance-note'
      await expect(page.locator(holder)).toContainText(String(recapNow.provisional.bill_count))
    }

    await goRecap(page)
    const { recap, finalIds, unclearIds } = await assertRecapShape(page)
    expect(unclearIds.has(billId), 'bill tanpa pilihan harus tampil sebagai belum jelas').toBe(true)
    expect(finalIds.has(billId)).toBe(false)

    // dan layarnya harus benar-benar menampilkannya — bukan cuma API yang tahu.
    // Cek lewat UI inilah yang menangkap cache rekap yang tidak disegarkan.
    await expect(page.locator('#rekap-belum-jelas')).toContainText(title)
    await expect(page.locator('#rekap-belum-jelas').locator('.recap-open')).toHaveCount(
      recap.provisional.bills.length,
    )
    expect(await recapCardOrZero(page)).toBe(
      recap.final.payable_idr > 0 ? recap.final.payable_idr : recap.final.receivable_idr,
    )
  })

  test('74. dua orang: nominal pindah dari belum jelas ke final dan sama di tiga layar', async ({ page, browser }) => {
    await freshUser(page, 'Integrasi B ' + stamp)
    const title = 'Bakso Integrasi ' + stamp
    const billId = await createBill(page, {
      title,
      items: [
        { name: 'Bakso', price: '24000' },
        { name: 'Es teh', price: '6000' },
      ],
    })
    const billUrl = page.url()
    const me = await identity(page)

    const guest = await guestJoins(browser, billUrl, 'Tamu B ' + stamp, 'Bakso')
    await guest.ctx.close()

    await pickItem(page, 'Es teh')
    const bill = await apiGet(page, '/api/bills/' + billId)
    expect(bill.bill.total_idr).toBe(30000)
    expect(bill.uncovered_idr).toBe(0)

    await goHome(page)
    const rows = await apiGet(page, '/api/identities/' + me.id + '/bills')
    const rowApi = rows.find((r: any) => r.id === billId)
    expect(rowApi.my_total_idr).toBe(6000)
    const row = page.locator('.app-row', { hasText: title })
    expect(await rowAmount(row)).toBe(6000)
    const homeCard = await cardValue(page)

    await goRecap(page)
    const { recap, finalIds, unclearIds } = await assertRecapShape(page)
    expect(finalIds.has(billId), 'bill yang sudah lengkap harus masuk final').toBe(true)
    expect(unclearIds.has(billId)).toBe(false)
    expect(Math.abs(recap.final.net_idr)).toBe(homeCard)
    expect(await cardValue(page)).toBe(
      recap.final.payable_idr > 0 ? recap.final.payable_idr : recap.final.receivable_idr,
    )
    await expect(page.getByText('Tamu B ' + stamp).first()).toBeVisible()
  })

  test('75. tamu menandai lunas: piutang pemilik hilang dari rekap dan status di bill ikut', async ({ page, browser }) => {
    await freshUser(page, 'Integrasi C ' + stamp)
    const title = 'Sate Integrasi ' + stamp
    const billId = await createBill(page, {
      title,
      items: [
        { name: 'Sate', price: '30000' },
        { name: 'Lontong', price: '5000' },
      ],
    })

    const guest = await guestJoins(browser, page.url(), 'Tamu C ' + stamp, 'Lontong')
    await pickItem(page, 'Sate')

    // pemilik otomatis tercatat lunas (dia yang menalangi), jadi yang punya
    // tombol "Tandai lunas" adalah tamu yang berutang
    const ownerBill = await apiGet(page, '/api/bills/' + billId)
    const ownerId = (await identity(page)).id
    expect(ownerBill.people.find((p: any) => p.identity_id === ownerId).paid).toBe('paid')

    await guest.page.getByRole('button', { name: /Tandai lunas/ }).first().click()
    await guest.page.waitForTimeout(1200)
    await guest.ctx.close()

    const after = await apiGet(page, '/api/bills/' + billId)
    expect(after.people.every((p: any) => p.paid === 'paid'), 'semua bagian harus lunas').toBe(true)

    // data dari perangkat lain tidak bisa di-invalidate lewat cache: muat ulang,
    // lalu pastikan rekap benar-benar sudah tidak menagih siapa pun
    await page.reload()
    await page.waitForTimeout(1500)
    await goRecap(page)
    await expect(page.getByText('Tamu C ' + stamp)).toHaveCount(0)
    const { recap } = await assertRecapShape(page)
    expect(recap.final.counterparties.length).toBe(0)

    await goHome(page)
    const row = page.locator('.app-row', { hasText: title })
    await expect(row).toBeVisible()
    await expect(row).not.toContainText('orang belum bayar')
  })

  test('76. ubah harga: total baru sampai ke bill, beranda, dan rekap', async ({ page, browser }) => {
    await freshUser(page, 'Integrasi D ' + stamp)
    const title = 'Mie Integrasi ' + stamp
    const billId = await createBill(page, {
      title,
      items: [
        { name: 'Mie', price: '20000' },
        { name: 'Teh', price: '5000' },
      ],
    })
    const guest = await guestJoins(browser, page.url(), 'Tamu D ' + stamp, 'Teh')
    await guest.ctx.close()
    await pickItem(page, 'Mie')
    const me = await identity(page)

    await page.getByRole('button', { name: 'Aksi lain' }).click()
    await page.waitForTimeout(250)
    await page.getByRole('button', { name: /Ubah bill/ }).click()
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Ubah bill')
    await page.getByLabel('Harga satuan').first().fill('30000')
    await page.getByRole('button', { name: /Simpan/ }).first().click()
    await expect(page).toHaveURL(/\/b\//)
    await page.waitForTimeout(900)

    const bill = await apiGet(page, '/api/bills/' + billId)
    expect(bill.bill.total_idr).toBe(35000)
    expect(await cardValue(page)).toBe(35000)

    await goHome(page)
    const rows = await apiGet(page, '/api/identities/' + me.id + '/bills')
    const rowApi = rows.find((r: any) => r.id === billId)
    expect(rowApi.total_idr).toBe(35000)
    expect(rowApi.my_total_idr).toBe(30000)
    const row = page.locator('.app-row', { hasText: title })
    expect(await rowAmount(row)).toBe(30000)
    await expect(row).toContainText('35.000')

    await goRecap(page)
    const { recap } = await assertRecapShape(page)
    expect(await recapCardOrZero(page)).toBe(
      recap.final.payable_idr > 0 ? recap.final.payable_idr : recap.final.receivable_idr,
    )
  })

  test('77. tutup bill dari rekap: hilang dari belum jelas, pindah ke Lunas di beranda', async ({ page }) => {
    await freshUser(page, 'Integrasi E ' + stamp)
    const title = 'Nasi Integrasi ' + stamp
    const billId = await createBill(page, { title, items: [{ name: 'Nasi', price: '18000' }] })

    await goRecap(page)
    const closeButton = page.getByRole('button', { name: /Tandai lunas/ }).first()
    if (await closeButton.count()) {
      await closeButton.click()
      await page.waitForTimeout(300)
      await page.getByRole('button', { name: /Tandai lunas, sisa ditanggung/ }).click()
      await page.waitForTimeout(1200)
    }

    const bill = await apiGet(page, '/api/bills/' + billId)
    expect(bill.settled).toBe(true)

    await goHome(page)
    await page.getByRole('button', { name: 'Lunas', exact: true }).click()
    await expect(page.locator('.app-row', { hasText: title })).toBeVisible()

    await goRecap(page)
    await expect(page.locator('body')).not.toContainText(title)
  })

  test('78. tambah foto: foto ikut terbaca setelah bolak-balik layar tanpa reload', async ({ page }) => {
    await freshUser(page, 'Integrasi F ' + stamp)
    const title = 'Foto Integrasi ' + stamp
    const billId = await createBill(page, { title, items: [{ name: 'Ayam', price: '25000' }] })

    await page.locator('input[type="file"]').first().setInputFiles('tests/fixtures/receipt.png')
    await page.waitForTimeout(2000)
    const after = await apiGet(page, '/api/bills/' + billId)
    expect(after.photos.length).toBeGreaterThan(0)

    await goHome(page)
    await page.locator('.app-row', { hasText: title }).click()
    await expect(page).toHaveURL(new RegExp(billId))
    await page.waitForTimeout(900)
    await expect(page.locator('img').first()).toBeVisible()
    expect((await apiGet(page, '/api/bills/' + billId)).photos.length).toBeGreaterThan(0)
  })

  test('79. ganti rekening: tujuan transfer di layar bill ikut berubah', async ({ page }) => {
    await freshUser(page, 'Integrasi G ' + stamp)
    const title = 'Transfer Integrasi ' + stamp
    const billId = await createBill(page, { title, items: [{ name: 'Roti', price: '15000' }] })

    await page.getByRole('link', { name: /Pengaturan/ }).first().click()
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Pengaturan')
    await page.getByLabel('Bank atau e-wallet').fill('BCA')
    await page.getByLabel('Nomor', { exact: true }).fill('1234509876')
    await page.getByRole('button', { name: 'Tambah rekening' }).click()
    await page.waitForTimeout(1200)

    // ganti nama juga: nama ini tersalin ke payload bill ("dibayar X")
    await page.getByLabel('Nama kamu').fill('Transfer Ganti ' + stamp)
    await page.getByRole('button', { name: 'Simpan nama' }).click()
    await page.waitForTimeout(1200)

    await page.getByRole('button', { name: 'Kembali' }).click()
    await page.waitForTimeout(1200)
    await expect(page).toHaveURL(new RegExp(billId))
    await expect(page.locator('body')).toContainText('1234509876')
    await expect(page.locator('body')).toContainText('Transfer Ganti ' + stamp)
  })

  test('80. hapus bill: hilang dari beranda dan rekap, link mati', async ({ page }) => {
    await freshUser(page, 'Integrasi H ' + stamp)
    const title = 'Hapus Integrasi ' + stamp
    const billId = await createBill(page, { title, items: [{ name: 'Teh', price: '8000' }] })

    await page.getByRole('button', { name: 'Aksi lain' }).click()
    await page.waitForTimeout(250)
    await page.getByRole('button', { name: /Ubah bill/ }).click()
    await page.getByRole('button', { name: /Hapus bill ini/ }).click()
    await page.waitForTimeout(300)
    await page.getByRole('button', { name: 'Ya, hapus permanen' }).click()
    await page.waitForTimeout(1500)

    await goHome(page)
    await expect(page.locator('.app-row', { hasText: title })).toHaveCount(0)
    await goRecap(page)
    await expect(page.locator('body')).not.toContainText(title)

    const res = await page.request.get('/api/bills/' + billId)
    expect(res.status()).toBe(404)
  })

  test('81. undangan menunggu: satu ketukan di beranda, tanpa buka bill dulu', async ({ page, browser }) => {
    await freshUser(page, 'Undang A ' + stamp)
    const title1 = 'Kontak Awal ' + stamp
    const paidFirst = await createBill(page, { title: title1, items: [{ name: 'Kopi', price: '10000' }] })

    // tamu ikut bill pertama: sekarang dia jadi kontak yang sah untuk diundang
    const guest = await guestJoins(browser, page.url(), 'Tamu Undang ' + stamp)
    const guestId = await identity(guest.page)
    // matikan auto_accept supaya undangan benar-benar menunggu jawaban
    await apiSend(guest.page, '/api/identities/' + guestId.id + '/auto_accept', { auto_accept: 0 })

    // pemilik membuat bill kedua lalu mengundang tamu dari daftar kontak
    const title2 = 'Undangan Kedua ' + stamp
    const invitedId = await createBill(page, { title: title2, items: [{ name: 'Teh', price: '8000' }] })
    await apiSend(page, '/api/bills/' + invitedId + '/invite', { identity_id: guestId.id })

    // tamu membuka beranda: kartu undangan muncul, satu tombol "Ikut"
    await guest.page.goto('/')
    await guest.page.waitForTimeout(1500)
    const card = guest.page.locator('.invite-card', { hasText: title2 })
    await expect(card).toBeVisible()
    await expect(card).toContainText('mengundangmu')
    await expect(card).toContainText('total')

    await card.getByRole('button', { name: 'Ikut' }).click()
    await expect(guest.page).toHaveURL(new RegExp(invitedId), { timeout: 15_000 })
    await guest.page.waitForTimeout(1200)

    // sudah jadi anggota: tidak ada lagi tawaran "Ikut bill ini"
    await expect(guest.page.getByRole('button', { name: 'Ikut bill ini' })).toHaveCount(0)
    const guestView = await apiGet(guest.page, '/api/bills/' + invitedId)
    expect(guestView.people.some((person: any) => person.identity_id === guestId.id)).toBe(true)

    // dan kartunya hilang dari beranda
    await nav(guest.page, 'Beranda')
    await guest.page.waitForTimeout(800)
    await expect(guest.page.locator('.invite-card')).toHaveCount(0)

    // tombol "Nanti" juga harus benar-benar menolak, bukan cuma menyembunyikan
    const title3 = 'Undangan Ketiga ' + stamp
    const thirdId = await createBill(page, { title: title3, items: [{ name: 'Roti', price: '7000' }] })
    await apiSend(page, '/api/bills/' + thirdId + '/invite', { identity_id: guestId.id })
    // undangan datang dari perangkat lain: tidak ada invalidasi lokal, jadi
    // muat ulang seperti orang yang membuka aplikasi lagi
    await guest.page.reload()
    await guest.page.waitForTimeout(2000)
    const third = guest.page.locator('.invite-card', { hasText: title3 })
    await expect(third).toBeVisible()
    await third.getByRole('button', { name: 'Tolak' }).click()
    await expect(guest.page.locator('.invite-card', { hasText: title3 })).toHaveCount(0, { timeout: 10_000 })

    const afterDecline = await apiGet(guest.page, '/api/bills/' + thirdId)
    expect(afterDecline.people.some((person: any) => person.identity_id === guestId.id)).toBe(false)
    await guest.ctx.close()
  })

  test('82. ganti pembayar: arah utang di beranda dan rekap ikut berbalik', async ({ page, browser }) => {
    await freshUser(page, 'Payer A ' + stamp)
    const title = 'Payer Integrasi ' + stamp
    const billId = await createBill(page, {
      title,
      items: [
        { name: 'Sate', price: '30000' },
        { name: 'Es', price: '10000' },
      ],
    })
    const guest = await guestJoins(browser, page.url(), 'Tamu Payer ' + stamp, 'Sate')
    await pickItem(page, 'Es')
    const me = await identity(page)

    // sebelum: pemilik menalangi, dia menagih
    const before = await apiGet(page, '/api/bills/' + billId)
    expect(before.paid_by_id).toBe(me.id)
    // sebelum: pemilik menalangi, jadi yang muncul piutang sebesar bagian tamu
    const guestShare = before.people.find((p: any) => p.identity_id !== me.id).total_idr
    const myShare = before.people.find((p: any) => p.identity_id === me.id).total_idr
    expect(guestShare).toBe(30000)

    // ganti pembayar ke tamu (masih di layar bill)
    await page.getByRole('button', { name: 'Aksi lain' }).click()
    await page.waitForTimeout(250)
    await page.getByRole('button', { name: 'Ganti yang bayar duluan' }).click()
    await page.getByRole('button', { name: new RegExp('Tamu Payer ' + stamp + ' Jadikan pembayar') }).click()
    await page.waitForTimeout(1200)

    const after = await apiGet(page, '/api/bills/' + billId)
    expect(after.paid_by_id).not.toBe(me.id)

    // beranda: kartu == net server, dan arahnya sekarang "harus kamu bayar"
    await goHome(page)
    const rows = await apiGet(page, '/api/identities/' + me.id + '/bills')
    const rowApi = rows.find((r: any) => r.id === billId)
    const row = page.locator('.app-row', { hasText: title })
    expect(await rowAmount(row)).toBe(rowApi.my_total_idr)
    // arah berbalik: dulu "harus kamu terima", sekarang "harus kamu bayar"
    await expect(page.locator('.ds-balance-label').first()).toContainText('Harus kamu bayar')
    expect(await cardValue(page)).toBe(myShare)

    await goRecap(page)
    const { recap, finalIds } = await assertRecapShape(page)
    expect(finalIds.has(billId)).toBe(true)
    expect(recap.final.receivable_idr).toBe(0)
    expect(recap.final.payable_idr).toBe(myShare)
    expect(await recapCardOrZero(page)).toBe(myShare)
    await expect(page.getByText('Tamu Payer ' + stamp).first()).toBeVisible()
  })

  test('83. tamu keluar: sisa bagiannya jadi belum jelas, bukan hilang diam-diam', async ({ page, browser }) => {
    await freshUser(page, 'Keluar A ' + stamp)
    const title = 'Keluar Integrasi ' + stamp
    const billId = await createBill(page, {
      title,
      items: [
        { name: 'Nasi', price: '20000' },
        { name: 'Air', price: '5000' },
      ],
    })
    const guest = await guestJoins(browser, page.url(), 'Tamu Keluar ' + stamp, 'Nasi')
    await pickItem(page, 'Air')

    // tamu keluar dari bill
    await guest.page.reload()
    await guest.page.getByRole('button', { name: 'Aksi lain' }).click()
    await guest.page.waitForTimeout(250)
    await guest.page.getByRole('button', { name: 'Keluar dari bill ini' }).click()
    await expect(guest.page.getByText('Kamu keluar dari bill ini')).toBeVisible()
    await guest.ctx.close()

    const bill = await apiGet(page, '/api/bills/' + billId)
    expect(bill.people.length, 'tamu harus benar-benar keluar').toBe(1)
    // yang ditinggal tidak hilang: item tamu pindah ke tanggungan pembayar,
    // jadi total bill tetap utuh dan bagian pembayar naik
    expect(bill.owner_absorbed_idr).toBe(20000)
    // uangnya tidak boleh menguap: jumlah bagian semua orang == total bill
    const parts = bill.people.reduce((sum: number, p: any) => sum + p.total_idr, 0)
    expect(parts + bill.uncovered_idr, 'ada uang yang hilang setelah tamu keluar').toBe(bill.bill.total_idr)

    await page.reload()
    await page.waitForTimeout(1200)
    await goRecap(page)
    const { finalIds, unclearIds } = await assertRecapShape(page)
    expect(unclearIds.has(billId), 'bill dengan bagian tak bertuan harus jadi belum jelas').toBe(true)
    expect(finalIds.has(billId)).toBe(false)

    await goHome(page)
    const row = page.locator('.app-row', { hasText: title })
    await expect(row).toBeVisible()
  })

  test('84. pajak dan diskon: total tiga layar sama dengan hitungan server', async ({ page, browser }) => {
    await freshUser(page, 'Pajak A ' + stamp)
    const title = 'Pajak Integrasi ' + stamp
    await nav(page, 'Buat')
    await page.getByLabel('Nama bill').fill(title)
    await page.getByLabel('Item 1').fill('Ayam')
    await page.getByLabel('Harga satuan').nth(0).fill('40000')
    await page.getByRole('button', { name: /Tambah item/ }).click()
    await page.waitForTimeout(150)
    await page.getByLabel('Item 2').fill('Nasi')
    await page.getByLabel('Harga satuan').nth(1).fill('10000')
    await page.getByLabel('Pajak', { exact: true }).fill('5.500')
    await page.getByLabel('Diskon pesanan').fill('1.500')
    await page.getByRole('button', { name: 'Buat bill' }).click()
    await expect(page).toHaveURL(/\/b\//)
    await page.waitForTimeout(700)
    const billId = page.url().split('/b/')[1]

    const guest = await guestJoins(browser, page.url(), 'Tamu Pajak ' + stamp, 'Nasi')
    await guest.ctx.close()
    await pickItem(page, 'Ayam')
    const me = await identity(page)

    const bill = await apiGet(page, '/api/bills/' + billId)
    // 50.000 + 5.500 - 1.500
    expect(bill.bill.total_idr).toBe(54000)
    expect(bill.uncovered_idr).toBe(0)
    expect(await cardValue(page)).toBe(54000)

    await goHome(page)
    const rows = await apiGet(page, '/api/identities/' + me.id + '/bills')
    const rowApi = rows.find((r: any) => r.id === billId)
    const row = page.locator('.app-row', { hasText: title })
    expect(await rowAmount(row)).toBe(rowApi.my_total_idr)
    await expect(row).toContainText('54.000')

    const parts = bill.people.reduce((sum: number, p: any) => sum + p.total_idr, 0)
    expect(parts, 'pajak/diskon tidak terbagi habis ke semua orang').toBe(54000)

    await goRecap(page)
    const { recap } = await assertRecapShape(page)
    expect(await recapCardOrZero(page)).toBe(
      recap.final.payable_idr > 0 ? recap.final.payable_idr : recap.final.receivable_idr,
    )
  })

  test('85. batalkan undangan: kartu di beranda tamu hilang', async ({ page, browser }) => {
    await freshUser(page, 'Batal A ' + stamp)
    const firstId = await createBill(page, { title: 'Kontak Batal ' + stamp, items: [{ name: 'Kopi', price: '9000' }] })
    const guest = await guestJoins(browser, page.url(), 'Tamu Batal ' + stamp)
    const guestId = await identity(guest.page)
    await apiSend(guest.page, '/api/identities/' + guestId.id + '/auto_accept', { auto_accept: 0 })

    const title = 'Dibatalkan ' + stamp
    const billId = await createBill(page, { title, items: [{ name: 'Roti', price: '12000' }] })
    await apiSend(page, '/api/bills/' + billId + '/invite', { identity_id: guestId.id })

    await guest.page.goto('/')
    await guest.page.waitForTimeout(1500)
    await expect(guest.page.locator('.invite-card', { hasText: title })).toBeVisible()

    // pemilik menarik undangannya
    const me = await identity(page)
    const invites = await apiGet(page, '/api/bills/' + billId).catch(() => null)
    const inviteId = invites?.pending_invites?.[0]?.id
    expect(inviteId, 'undangan harus tercatat di bill').toBeTruthy()
    await sendWithMethod(page, 'DELETE', '/api/bills/' + billId + '/invites/' + inviteId)
    expect(me.id).toBeTruthy()

    await guest.page.reload()
    await guest.page.waitForTimeout(1500)
    await expect(guest.page.locator('.invite-card', { hasText: title })).toHaveCount(0)
    await guest.ctx.close()
    expect(firstId).toBeTruthy()
  })

  test('86. satu item tiga unit: yang belum diambil tetap terlihat, bukan dibulatkan', async ({ page, browser }) => {
    await freshUser(page, 'Unit A ' + stamp)
    const title = 'Kopi Unit ' + stamp
    await nav(page, 'Buat')
    await page.getByLabel('Nama bill').fill(title)
    await page.getByLabel('Item 1').fill('Kopi')
    await page.getByLabel('Qty').first().fill('3')
    await page.getByLabel('Harga satuan').nth(0).fill('10000')
    await page.getByRole('button', { name: 'Buat bill' }).click()
    await expect(page).toHaveURL(/\/b\//)
    await page.waitForTimeout(700)
    const billId = page.url().split('/b/')[1]

    const guest = await guestJoins(browser, page.url(), 'Tamu Unit ' + stamp)
    await pickItem(guest.page, 'Kopi')
    await guest.ctx.close()
    await pickItem(page, 'Kopi')

    const bill = await apiGet(page, '/api/bills/' + billId)
    expect(bill.bill.total_idr).toBe(30000)
    // dua unit diambil, satu belum: 10.000 harus tetap kelihatan sebagai sisa
    expect(bill.uncovered_idr).toBe(10000)
    const sums = bill.people.reduce((acc: number, p: any) => acc + p.total_idr, 0)
    expect(sums + bill.uncovered_idr).toBe(30000)
    expect(await cardValue(page)).toBe(30000)

    await goRecap(page)
    const { finalIds, unclearIds } = await assertRecapShape(page)
    expect(unclearIds.has(billId)).toBe(true)
    expect(finalIds.has(billId)).toBe(false)
    await expect(page.locator('#rekap-belum-jelas')).toContainText(title)

    // ambil unit terakhir: baru sekarang bill boleh dianggap pasti
    await goHome(page)
    await page.locator('.app-row', { hasText: title }).click()
    await page.waitForTimeout(900)
    await pickItem(page, 'Kopi')
    const done = await apiGet(page, '/api/bills/' + billId)
    expect(done.uncovered_idr).toBe(0)
    await goRecap(page)
    const after = await assertRecapShape(page)
    expect(after.finalIds.has(billId)).toBe(true)
    expect(after.unclearIds.has(billId)).toBe(false)
  })

  test('87. buka di perangkat lain: kode pemulihan mengembalikan identitas dan angkanya', async ({ page, browser }) => {
    // tiga konteks + pembuatan kode: lebih lambat dari tes lain
    test.setTimeout(120_000)
    await freshUser(page, 'Pulih A ' + stamp)
    const title = 'Pulih Integrasi ' + stamp
    const billId = await createBill(page, {
      title,
      items: [
        { name: 'Bakso', price: '26000' },
        { name: 'Teh', price: '4000' },
      ],
    })
    const guest = await guestJoins(browser, page.url(), 'Tamu Pulih ' + stamp, 'Teh')
    await guest.ctx.close()
    await pickItem(page, 'Bakso')
    const me = await identity(page)

    // ambil kode pemulihan dari pengaturan
    await page.getByRole('link', { name: /Pengaturan/ }).first().click()
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Pengaturan')
    await page.getByRole('button', { name: /Buat kode/ }).first().click()
    await expect(page.locator('.recovery-code code')).toBeVisible({ timeout: 10_000 })
    const code = (await page.locator('.recovery-code code').textContent())?.trim() ?? ''
    expect(code.length).toBeGreaterThan(4)

    // perangkat lain: belum punya identitas, masuk lewat kode
    const other = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const second = await other.newPage()
    await second.goto('/masuk')
    await second.getByLabel('Kode pemulihan').fill(code)
    await second.getByRole('button', { name: 'Masuk', exact: true }).click()
    await expect(second.getByRole('heading', { level: 1 })).toContainText('Pulih A ' + stamp, {
      timeout: 15_000,
    })
    await second.waitForTimeout(1500)

    // identitas yang sama, bukan akun baru
    const restored = await second.evaluate(() => JSON.parse(localStorage.getItem('bagiin_identity') ?? '{}'))
    expect(restored.id).toBe(me.id)

    // dan angka di perangkat baru sama dengan yang dilihat server
    const secondBill = await apiGet(second, '/api/bills/' + billId)
    expect(secondBill.bill.total_idr).toBe(30000)
    const secondRows = await apiGet(second, '/api/identities/' + me.id + '/bills')
    const row = secondRows.find((r: any) => r.id === billId)
    expect(row.my_total_idr).toBe(26000)
    const rowUi = second.locator('.app-row', { hasText: title })
    await expect(rowUi).toBeVisible()
    expect(await rowAmount(rowUi)).toBe(26000)

    await nav(second, 'Rekap')
    await second.waitForTimeout(1200)
    const recap = await apiGet(second, '/api/identities/' + me.id + '/recap')
    const cardText = await second.locator('.ds-balance-value').first().textContent()
    expect(num(cardText)).toBe(
      recap.final.payable_idr > 0 ? recap.final.payable_idr : recap.final.receivable_idr,
    )
    await other.close()
  })

  test('88. tandai semua lunas lalu batalkan: status uang bolak-balik tanpa sisa', async ({ page, browser }) => {
    await freshUser(page, 'Semua A ' + stamp)
    const title = 'Semua Lunas ' + stamp
    const billId = await createBill(page, {
      title,
      items: [
        { name: 'Soto', price: '22000' },
        { name: 'Jeruk', price: '8000' },
      ],
    })
    const guest = await guestJoins(browser, page.url(), 'Tamu Semua ' + stamp, 'Jeruk')
    await guest.ctx.close()
    await pickItem(page, 'Soto')

    // aksi sekunder ada di sheet "Aksi lain", bukan tombol di layar
    await openActions(page)
    await page.getByRole('button', { name: /Tandai semua lunas/ }).click()
    await page.waitForTimeout(1500)
    // "Tandai semua lunas" adalah keputusan tingkat bill (settled_manual), bukan
    // menandai satu per satu orang: yang berubah all_paid + settled, bukan people.paid
    const allPaid = await apiGet(page, '/api/bills/' + billId)
    expect(allPaid.settled_manual, 'bill harus ditandai lunas manual').toBe(true)
    expect(allPaid.all_paid).toBe(true)
    expect(allPaid.settled).toBe(true)

    await goHome(page)
    const row = page.locator('.app-row', { hasText: title })
    await expect(row).toBeVisible()
    await expect(row).not.toContainText('orang belum bayar')

    await goRecap(page)
    const paidRecap = await assertRecapShape(page)
    expect(paidRecap.recap.final.counterparties.length, 'tidak boleh ada tagihan tersisa').toBe(0)

    // lalu dibatalkan lagi: utangnya harus muncul utuh, bukan setengah
    await goHome(page)
    await page.locator('.app-row', { hasText: title }).click()
    await page.waitForTimeout(900)
    await openActions(page)
    await page.getByRole('button', { name: /Batalkan lunas seluruh bill/ }).click()
    await page.waitForTimeout(1500)
    const undone = await apiGet(page, '/api/bills/' + billId)
    expect(undone.settled_manual).toBe(false)
    expect(undone.settled).toBe(false)

    await page.reload()
    await page.waitForTimeout(1200)
    await goRecap(page)
    const backRecap = await assertRecapShape(page)
    expect(backRecap.recap.final.counterparties.length, 'tagihan harus kembali setelah dibatalkan').toBe(1)
    expect(backRecap.recap.final.receivable_idr).toBe(
      undone.people.find((p: any) => p.identity_id !== (undone.paid_by_id ?? '')).total_idr,
    )
  })

  test('89. tutup lalu buka lagi: bill kembali berjalan dengan angka yang sama', async ({ page }) => {
    await freshUser(page, 'Buka A ' + stamp)
    const title = 'Buka Lagi ' + stamp
    const billId = await createBill(page, {
      title,
      items: [
        { name: 'Bakmi', price: '27000' },
        { name: 'Teh', price: '5000' },
      ],
    })
    await pickItem(page, 'Bakmi')
    const before = await apiGet(page, '/api/bills/' + billId)
    expect(before.bill.total_idr).toBe(32000)

    await openActions(page)
    await page.getByRole('button', { name: /Tutup bill/ }).click()
    await page.waitForTimeout(1500)
    const closed = await apiGet(page, '/api/bills/' + billId)
    // menutup itu mengunci, bukan membebaskan: status berubah, utang tidak
    expect(closed.bill.status).toBe('closed')
    expect(closed.settled_manual).toBe(false)

    // bill yang ditutup tapi masih ada yang belum bayar TIDAK boleh pindah ke
    // "Lunas": menutup itu mengunci, bukan membebaskan utang
    await goHome(page)
    await page.getByRole('button', { name: 'Lunas', exact: true }).click()
    await expect(page.locator('.app-row', { hasText: title })).toHaveCount(0)
    await page.getByRole('button', { name: 'Semua', exact: true }).click()
    await expect(page.locator('.app-row', { hasText: title })).toBeVisible()

    await page.locator('.app-row', { hasText: title }).click()
    await page.waitForTimeout(900)
    await openActions(page)
    await page.getByRole('button', { name: /Buka lagi/ }).click()
    await page.waitForTimeout(1500)
    const reopened = await apiGet(page, '/api/bills/' + billId)
    expect(reopened.bill.status).toBe('open')
    expect(reopened.bill.total_idr, 'total tidak boleh berubah gara-gara tutup-buka').toBe(32000)

    await goHome(page)
    await expect(page.locator('.app-row', { hasText: title })).toBeVisible()
    const rows = await apiGet(page, '/api/identities/' + (await identity(page)).id + '/bills')
    const rowApi = rows.find((r: any) => r.id === billId)
    expect(rowApi.settled).toBe(false)
    expect(await rowAmount(page.locator('.app-row', { hasText: title }))).toBe(rowApi.my_total_idr)

    await goRecap(page)
    const { finalIds, unclearIds } = await assertRecapShape(page)
    expect(finalIds.has(billId) || unclearIds.has(billId), 'bill terbuka harus muncul di rekap').toBe(true)
  })

  test('90. rincian per orang di rekap: jumlah barisnya sama dengan angka di kartunya', async ({ page, browser }) => {
    test.setTimeout(120_000)
    await freshUser(page, 'Rinci A ' + stamp)
    const guestName = 'Tamu Rinci ' + stamp

    // dua bill dengan orang yang sama: angka per orang harus gabungan, bukan salah satu.
    // Undangan saja tidak menciptakan utang — orangnya harus benar-benar memilih,
    // jadi tamu masuk ke dua bill dan memilih di keduanya.
    const billA = await createBill(page, { title: 'Rinci Satu ' + stamp, items: [{ name: 'Mie', price: '18000' }] })
    const urlA = page.url() // createBill mengembalikan id, bukan URL
    const billB = await createBill(page, { title: 'Rinci Dua ' + stamp, items: [{ name: 'Kwetiau', price: '12000' }] })
    const urlB = page.url()
    const guest = await guestJoins(browser, urlA, guestName, 'Mie')
    const guestId = await identity(guest.page)
    await guest.page.goto(urlB)
    await guest.page.getByRole('button', { name: 'Ikut bill ini' }).click()
    await guest.page.waitForTimeout(900)
    await pickItem(guest.page, 'Kwetiau')
    await guest.ctx.close()

    const recap = await apiGet(page, '/api/identities/' + (await identity(page)).id + '/recap')
    const row = recap.final.counterparties.find((c: any) => c.identity_id === guestId.id)
    expect(row, 'tamu harus muncul sebagai pihak di rekap').toBeTruthy()
    expect(row.bills.length).toBe(2)
    expect(row.amount_idr).toBe(30000)

    await goRecap(page)
    await page.getByText(guestName).first().click()
    await page.waitForTimeout(600)
    const sheet = page.getByRole('dialog')
    await expect(sheet).toBeVisible()
    await expect(sheet).toContainText('2 bill belum lunas')

    // jumlah bill yang bisa diklik = jumlah yang disebut kartu
    const billRows = sheet.locator('.recap-bill-row')
    await expect(billRows).toHaveCount(row.bills.length)

    // dan tiap baris membawa nominal dari server, bukan hasil hitung di layar
    for (const edge of row.bills) {
      const line = sheet.locator('.recap-bill-row', { hasText: edge.title })
      await expect(line).toContainText(Number(edge.amount_idr).toLocaleString('id-ID'))
    }

    // membuka satu baris membawa ke bill yang benar, dan angkanya cocok
    await billRows.first().click()
    await expect(page).toHaveURL(new RegExp('\\/b\\/'))
    const openedId = page.url().split('/b/')[1]
    expect([billA, billB]).toContain(openedId)
    expect(await cardValue(page)).toBe(await (async () => {
      const b = await apiGet(page, '/api/bills/' + openedId)
      return b.bill.total_idr
    })())
  })

  test('91. cari dan saring di beranda: yang tampil hanya yang cocok, angka tetap dari server', async ({ page }) => {
    await freshUser(page, 'Cari A ' + stamp)
    const openTitle = 'Cari Terbuka ' + stamp
    const paidTitle = 'Cari Lunas ' + stamp
    const openId = await createBill(page, { title: openTitle, items: [{ name: 'Sate', price: '15000' }] })
    const paidId = await createBill(page, { title: paidTitle, items: [{ name: 'Bakso', price: '21000' }] })
    await pickItem(page, 'Bakso')
    await openActions(page)
    await page.getByRole('button', { name: /Tandai semua lunas/ }).click()
    await page.waitForTimeout(1500)

    await goHome(page)
    const search = page.getByPlaceholder(/Cari bill/)
    await search.fill(openTitle)
    await page.waitForTimeout(500)
    await expect(page.locator('.app-row', { hasText: openTitle })).toBeVisible()
    await expect(page.locator('.app-row', { hasText: paidTitle })).toHaveCount(0)

    await search.fill('')
    await page.waitForTimeout(300)
    await page.getByRole('button', { name: 'Lunas', exact: true }).click()
    await page.waitForTimeout(400)
    await expect(page.locator('.app-row', { hasText: paidTitle })).toBeVisible()
    await expect(page.locator('.app-row', { hasText: openTitle })).toHaveCount(0)

    // nominal di baris tetap bagian saya versi server, apa pun filternya
    const rows = await apiGet(page, '/api/identities/' + (await identity(page)).id + '/bills')
    const paidRow = rows.find((r: any) => r.id === paidId)
    expect(await rowAmount(page.locator('.app-row', { hasText: paidTitle }))).toBe(paidRow.my_total_idr)

    // pencarian yang tidak ada hasilnya tidak boleh menampilkan bill apa pun
    await search.fill('zzz-tidak-ada-' + stamp)
    await page.waitForTimeout(500)
    await expect(page.locator('.app-row')).toHaveCount(0)
    expect(openId).toBeTruthy()
  })

  test('92. salin pesan pengingat: nominalnya sama dengan yang tampil di rekap', async ({ page, browser }) => {
    test.setTimeout(120_000)
    await freshUser(page, 'Tagih A ' + stamp)
    const title = 'Tagih Integrasi ' + stamp
    const billId = await createBill(page, {
      title,
      items: [
        { name: 'Nasi Goreng', price: '25000' },
        { name: 'Es Jeruk', price: '7000' },
      ],
    })
    const guestName = 'Tamu Tagih ' + stamp
    const guest = await guestJoins(browser, page.url(), guestName, 'Es Jeruk')
    const guestId = await identity(guest.page)
    await guest.ctx.close()
    await pickItem(page, 'Nasi Goreng')

    // rekening saya dipakai di pesan supaya orangnya tidak perlu tanya nomor
    await page.getByRole('link', { name: /Pengaturan/ }).first().click()
    await page.getByLabel('Bank atau e-wallet').fill('BCA')
    await page.getByLabel('Nomor', { exact: true }).fill('9876543210')
    await page.getByRole('button', { name: 'Tambah rekening' }).click()
    await page.waitForTimeout(1200)

    await goRecap(page)
    await page.getByText(guestName).first().click()
    await page.waitForTimeout(600)
    const sheet = page.getByRole('dialog')
    await expect(sheet).toBeVisible()
    await sheet.getByRole('button', { name: 'Salin pesan pengingat' }).click()
    await page.waitForTimeout(600)

    const text = await page.evaluate(() => navigator.clipboard.readText())
    const recap = await apiGet(page, '/api/identities/' + (await identity(page)).id + '/recap')
    const row = recap.final.counterparties.find((c: any) => c.identity_id === guestId.id)

    expect(text).toContain(guestName)
    expect(text).toContain(title)
    expect(text).toContain('9876543210')
    // nominal di pesan harus persis angka rekap, bukan hitungan ulang di layar
    expect(text).toContain(Number(row.amount_idr).toLocaleString('id-ID'))
    for (const edge of row.bills) {
      expect(text).toContain(Number(edge.amount_idr).toLocaleString('id-ID'))
    }

    // sisi sebaliknya: kalau SAYA yang berutang, tidak ada tombol menagih
    await sheet.getByRole('button', { name: /Tutup|Kembali/ }).first().click().catch(() => {})
    await page.keyboard.press('Escape').catch(() => {})
    await page.waitForTimeout(400)
    await goHome(page)
    await page.locator('.app-row', { hasText: title }).click()
    await page.waitForTimeout(900)
    await openActions(page)
    await page.getByRole('button', { name: 'Ganti yang bayar duluan' }).click()
    await page.getByRole('button', { name: new RegExp(guestName + ' Jadikan pembayar') }).click()
    await page.waitForTimeout(1500)

    await goRecap(page)
    await page.getByText(guestName).first().click()
    await page.waitForTimeout(600)
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Salin pesan pengingat' })).toHaveCount(0)
  })

  test('93. beranda: satu angka tindakan, dan arah uang terbaca tanpa menebak', async ({ page, browser }) => {
    test.setTimeout(120_000)
    await freshUser(page, 'Tindakan A ' + stamp)

    // (1) bill milik sendiri yang belum saya pilih -> pekerjaan: memilih
    await createBill(page, { title: 'Belum Dipilih ' + stamp, items: [{ name: 'Roti', price: '14000' }] })

    // (2) bill orang lain, saya sudah memilih dan belum bayar -> pekerjaan: membayar
    const host = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const hostPage = await host.newPage()
    await freshUser(hostPage, 'Tuan Rumah ' + stamp)
    const hostTitle = 'Ditagih ' + stamp
    const hostBill = await createBill(hostPage, { title: hostTitle, items: [{ name: 'Pizza', price: '30000' }] })
    const hostUrl = hostPage.url()
    const hostId = (await identity(hostPage)).id

    await page.goto(hostUrl)
    await page.getByRole('button', { name: 'Ikut bill ini' }).click()
    await page.waitForTimeout(900)
    await pickItem(page, 'Pizza')

    const me = await identity(page)
    const rows = await apiGet(page, '/api/identities/' + me.id + '/bills')

    // harapan dihitung dari respons server, bukan dari angka yang ditulis di tes
    let split = 0
    let pay = 0
    for (const row of rows) {
      if (row.settled) continue
      if (!row.has_picks) split += 1
      else if (!row.my_paid && row.my_total_idr > 0) pay += 1
      else if (row.i_am_payer && row.uncovered_idr > 0) split += 1
    }
    expect(split, 'satu bill belum dipilih').toBe(1)
    expect(pay, 'satu bill tinggal dibayar').toBe(1)

    await page.locator('nav[aria-label="Navigasi utama"]').getByRole('link', { name: 'Beranda' }).click()
    await page.waitForTimeout(1500)

    // SATU angka, dan rinciannya berjumlah sama
    const banner = page.locator('#perlu-tindakan')
    await expect(banner).toBeVisible()
    await expect(banner.locator('.banner-count')).toHaveText(String(split + pay))
    await expect(banner).toContainText(split + ' pembagiannya belum lengkap')
    await expect(banner).toContainText(pay + ' tinggal kamu bayar')

    // tidak ada angka tindakan kedua di layar
    await expect(page.locator('#perlu-tindakan')).toHaveCount(1)
    await expect(page.locator('.banner-count')).toHaveCount(1)

    // kartu besar: merah untuk uang keluar, TANPA minus (labelnya sudah bilang)
    const hero = page.locator('.ds-balance-value')
    await expect(hero).toHaveClass(/ds-amount--neg/)
    await expect(hero).not.toContainText('−')

    // baris daftar: arah ditulis sebagai minus karena tidak ada label
    const payRow = page.locator('.app-row', { hasText: hostTitle })
    await expect(payRow.locator('.ds-row-flag--pay')).toContainText('Tinggal kamu bayar')
    // arah di baris ini dibawa warna + kata kerja, bukan tanda minus: menulis
    // keduanya untuk hal yang sama membuat baris terbaca dua kali
    await expect(payRow.locator('.ds-amount--neg')).toBeVisible()
    await expect(payRow.locator('.ds-amount--neg')).not.toContainText('−')

    // baris yang bukan tugas saya tidak diberi penanda apa pun
    const flagged = await page.locator('.ds-row-flag').count()
    expect(flagged, 'jumlah baris bertanda == jumlah angka tindakan').toBe(split + pay)

    // saya bayar satu bill: angkanya turun tepat satu, bukan berubah jadi angka lain
    await apiSend(page, '/api/bills/' + hostBill + '/payments/' + me.id + '/paid')
    await page.reload()
    await page.waitForTimeout(1800)
    await expect(page.locator('.banner-count')).toHaveText(String(split + pay - 1))
    await expect(page.locator('.app-row', { hasText: hostTitle }).locator('.ds-row-flag')).toHaveCount(0)
    expect(hostId).toBeTruthy()
    await host.close()
  })
})
