import { test, expect, type Page } from '@playwright/test'

/**
 * Beranda menampilkan SEMUA bulan sekaligus, dan penyaringan bulan hidup di
 * sheet "Atur" — bukan di baris chip.
 *
 * Yang dijaga di sini bukan tampilan, tapi **bentuk kontrol dan permintaan
 * jaringan**: daftar default tidak boleh memaksa orang memilih bulan lebih
 * dulu, dan bulan tertentu hanya diminta kalau memang dipilih. Versi chip
 * sebelumnya menyembunyikan seluruh riwayat di balik satu pilihan, sehingga
 * bill lama terasa hilang.
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

/** Tandai satu bill lunas lewat API (bukan lewat UI, supaya tes ini fokus). */
async function settleBillViaApi(page: Page, billId: string) {
  const identity = await page.evaluate(() => JSON.parse(localStorage.getItem('bagiin_identity') || '{}'))
  const status = await page.evaluate(
    async ({ identity, billId }) => {
      const response = await fetch('/api/bills/' + billId + '/settle', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'X-Identity-Id': identity.id,
          'X-Identity-Secret': identity.secret,
        },
        body: '{}',
      })
      return response.status
    },
    { identity, billId },
  )
  expect(status).toBe(200)
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']

function shortMonth(date: Date) {
  return MONTH_SHORT[date.getMonth()]
}

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

test.describe('Bagiin — riwayat per bulan', () => {
  test('128. beranda memuat semua bulan, bulan dipilih lewat tombol Atur', async ({ page }) => {
    await freshUser(page, 'Budi')

    const now = new Date()
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 15, 12)
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15, 12)

    await createBillViaApi(page, 'Bulan ini ' + stamp, `${monthKey(thisMonth)}-15T12:00:00`)
    await createBillViaApi(page, 'Bulan lalu ' + stamp, `${monthKey(lastMonth)}-15T12:00:00`)

    const calls: string[] = []
    page.on('request', (request) => {
      const url = request.url()
      if (url.includes('/bills') && !url.includes('/bills/months')) calls.push(url)
    })

    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Budi')

    // default: seluruh riwayat, dipisah judul bulan — bukan satu bulan terpilih
    await expect(page.getByText('Bulan ini ' + stamp)).toBeVisible()
    await expect(page.getByText('Bulan lalu ' + stamp)).toBeVisible()
    await expect(page.getByText('Bill kamu')).toBeVisible()

    // daftar pertama tidak dibatasi bulan: tidak ada chip yang harus diketuk
    expect(calls.length).toBeGreaterThan(0)
    expect(calls.some((url) => url.includes('month='))).toBe(false)

    // filter bulan ada di sheet "Atur"
    await page.getByRole('button', { name: /Atur/ }).click()
    const sheet = page.getByRole('dialog')
    await expect(sheet).toBeVisible()
    // dua tingkat: tahun dulu, baru bulan (riwayat tiga tahun = 36 bulan kalau
    // semuanya dijejer di satu daftar)
    await sheet.getByRole('button', { name: new RegExp('^Tahun ' + lastMonth.getFullYear()) }).click()
    await sheet
      .getByRole('button', { name: new RegExp('^' + shortMonth(lastMonth) + ' ' + lastMonth.getFullYear() + ',') })
      .click()
    await sheet.getByRole('button', { name: 'Terapkan' }).click()

    // penyaringan bulan terjadi di klien: daftar sudah dimuat utuh, jadi tidak
    // ada permintaan baru — dan tidak ada angka yang bisa datang dari query lain
    await expect(page.getByText('Bulan lalu ' + stamp)).toBeVisible()
    await expect(page.getByText('Bulan ini ' + stamp)).toHaveCount(0)
    const before = calls.length
    await page.waitForTimeout(500)
    expect(calls.length, 'menyaring bulan tidak boleh meminta data lagi').toBe(before)

    // saringan aktif ditandai di tombolnya, supaya orang tahu kenapa daftarnya
    // pendek — chip dulu memberi tanda ini lewat sorotan, tombol harus eksplisit
    await expect(page.getByRole('button', { name: /Atur · 1/ })).toBeVisible()
  })

  test('129. pencarian menembus semua bulan, bukan cuma yang tersaring', async ({ page }) => {
    await freshUser(page, 'Budi')

    const now = new Date()
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 15, 12)
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15, 12)
    // dua bulan harus ada, karena pilihan bulan di sheet hanya berisi bulan yang
    // benar-benar punya bill
    await createBillViaApi(page, 'Bulan Berjalan ' + stamp, `${monthKey(thisMonth)}-15T12:00:00`)
    await createBillViaApi(page, 'Cari Lintas Bulan ' + stamp, `${monthKey(lastMonth)}-15T12:00:00`)

    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Budi')

    // saring dulu ke bulan berjalan, lalu cari bill bulan lalu
    await page.getByRole('button', { name: /Atur/ }).click()
    const sheet = page.getByRole('dialog')
    await sheet.getByRole('button', { name: new RegExp('^Tahun ' + thisMonth.getFullYear()) }).click()
    await sheet
      .getByRole('button', { name: new RegExp('^' + shortMonth(thisMonth) + ' ' + thisMonth.getFullYear() + ',') })
      .click()
    await sheet.getByRole('button', { name: 'Terapkan' }).click()

    await page.getByLabel('Cari bill').fill('Cari Lintas Bulan ' + stamp)
    // bill bulan lalu muncul tanpa harus mengganti bulan dulu
    await expect(page.getByText('Cari Lintas Bulan ' + stamp)).toBeVisible()
  })

  test('131. bill lunas punya lencana hijau dan angkanya meredup', async ({ page }) => {
    await freshUser(page, 'Budi')

    const today = new Date()
    const title = 'Lunas Lencana ' + stamp
    const openTitle = 'Masih Berjalan ' + stamp
    const born = await page.evaluate(async (t) => {
      const identity = JSON.parse(localStorage.getItem('bagiin_identity') || '{}')
      const res = await fetch('/api/bills', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'X-Identity-Id': identity.id,
          'X-Identity-Secret': identity.secret,
        },
        body: JSON.stringify({
          title: t, merchant: null, transacted_at: null,
          tax_mode: 'proportional', subtotal: 30000, order_discount: 0, cashback: 0,
          tax: 0, service: 0, total: 30000, tax_included: 1,
          items: [{ name: 'Kopi', price: 30000, discount: 0, quantity: 1, mode: 'free', slot_count: null }],
          participants: [],
        }),
      })
      return { status: res.status, body: await res.text() }
    }, title)
    expect(born.status, born.body).toBe(200)
    const billId = JSON.parse(born.body).id as string
    await createBillViaApi(page, openTitle, `${monthKey(today)}-12T12:00:00`)
    await settleBillViaApi(page, billId)

    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Budi')

    const paidRow = page.locator('.app-row', { hasText: title })
    const openRow = page.locator('.app-row', { hasText: openTitle })

    // lencana hijau hanya di baris yang lunas
    await expect(paidRow.locator('.ds-badge.ds-tone-success')).toHaveText(/Lunas/)
    await expect(openRow.locator('.ds-badge')).toHaveCount(0)

    // dan angkanya turun nada, supaya yang belum selesai menonjol saat disapu mata
    await expect(paidRow.locator('.amt')).toHaveClass(/is-settled/)
    await expect(openRow.locator('.amt')).not.toHaveClass(/is-settled/)

    // tidak ada titik pemisah menggantung saat penanda turun baris
    const metaText = await openRow.locator('.row-meta').first().innerText()
    expect(metaText.trim().endsWith('·')).toBe(false)
  })

  test('132. riwayat tiga tahun: tahun dipilih dulu, baru bulan', async ({ page }) => {
    await freshUser(page, 'Budi')

    const now = new Date()
    const thisYear = now.getFullYear()
    const lastYear = thisYear - 1
    const oldYear = thisYear - 2

    await createBillViaApi(page, 'Tahun Ini ' + stamp, `${thisYear}-06-10T12:00:00`)
    await createBillViaApi(page, 'Tahun Lalu ' + stamp, `${lastYear}-06-10T12:00:00`)
    await createBillViaApi(page, 'Dua Tahun Lalu ' + stamp, `${oldYear}-06-10T12:00:00`)

    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Budi')
    // default: tiga tahun bercampur, dipisah judul bulan
    await expect(page.getByText('Tahun Ini ' + stamp)).toBeVisible()

    await page.getByRole('button', { name: /Atur/ }).click()
    const sheet = page.getByRole('dialog')

    // satu chip per tahun yang punya bill — bukan 36 baris bulan
    for (const year of [thisYear, lastYear, oldYear]) {
      await expect(sheet.getByRole('button', { name: new RegExp('^Tahun ' + year + ', 1 bill') })).toBeVisible()
    }

    // pilih tahun lama: hanya bill tahun itu, dan bulan lain di tahun itu mati
    await sheet.getByRole('button', { name: new RegExp('^Tahun ' + oldYear) }).click()
    await sheet.getByRole('button', { name: 'Terapkan' }).click()
    // exact: "Tahun Lalu …" adalah substring dari "Dua Tahun Lalu …", jadi
    // pencocokan longgar akan selalu menemukan satu baris dan tesnya bohong
    await expect(page.getByText('Dua Tahun Lalu ' + stamp, { exact: true })).toBeVisible()
    await expect(page.getByText('Tahun Ini ' + stamp, { exact: true })).toHaveCount(0)
    await expect(page.getByText('Tahun Lalu ' + stamp, { exact: true })).toHaveCount(0)

    // penanda saringan menyebut tahunnya, bukan cuma angka
    await expect(page.locator('.filter-active')).toContainText(String(oldYear))

    // di dalam tahun itu, bulan tanpa bill dimatikan supaya grid tidak berubah
    // bentuk tiap tahun
    await page.getByRole('button', { name: /Atur/ }).click()
    const sheet2 = page.getByRole('dialog')
    const emptyMonth = sheet2.getByRole('button', { name: new RegExp('^Jan ' + oldYear) })
    await expect(emptyMonth).toBeDisabled()
    const filledMonth = sheet2.getByRole('button', { name: new RegExp('^Jun ' + oldYear + ', 1 bill') })
    await expect(filledMonth).toBeEnabled()
    await filledMonth.click()
    await sheet2.getByRole('button', { name: 'Terapkan' }).click()
    await expect(page.getByText('Dua Tahun Lalu ' + stamp)).toBeVisible()

    // "Semua tahun" melepas saringan periode (labelnya pendek "Semua · N",
    // nama aksesibelnya yang panjang)
    await page.getByRole('button', { name: /Atur/ }).click()
    await page.getByRole('dialog').getByRole('button', { name: /^Semua tahun, \d+ bill$/ }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Terapkan' }).click()
    await expect(page.getByText('Tahun Ini ' + stamp)).toBeVisible()
    await expect(page.getByText('Dua Tahun Lalu ' + stamp)).toBeVisible()
  })

  test('130. angka "perlu dikerjakan" menghitung semua bulan, bukan yang tersaring', async ({ page }) => {
    await freshUser(page, 'Budi')

    const now = new Date()
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 10, 12)
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 10, 12)

    // dua bill yang sama-sama belum dipilih, di dua bulan berbeda
    await createBillViaApi(page, 'Perlu Okt ' + stamp, `${monthKey(thisMonth)}-10T12:00:00`)
    await createBillViaApi(page, 'Perlu Sep ' + stamp, `${monthKey(lastMonth)}-10T12:00:00`)

    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Budi')

    // blok kuning menyebut 2 — seluruh riwayat
    const banner = page.locator('#perlu-tindakan')
    await expect(banner).toContainText('2')

    // mengetuk blok kuning menyaring ke yang perlu dikerjakan, dan dua-duanya
    // tetap terlihat karena yang disaring bukan bulannya
    await banner.click()
    await expect(page.getByText('Perlu Sep ' + stamp)).toBeVisible()
    await expect(page.getByText('Perlu Okt ' + stamp)).toBeVisible()
    await expect(page.getByRole('button', { name: /Atur · 1/ })).toBeVisible()
  })

  test('134. tanggal bill bisa diubah saat dibuat, bawaannya hari ini', async ({ page }) => {
    await freshUser(page, 'Budi')
    await page.goto('/create')

    /**
     * Tanggal bawaan harus tanggal hari ini menurut jam perangkat. Kalau
     * dihitung lewat toISOString() (UTC), di WIB antara pukul 00.00 dan 07.00
     * tanggalnya masih tanggal kemarin.
     */
    const dateInput = page.locator('#bill-date')
    const today = await page.evaluate(() => {
      const now = new Date()
      const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
      const [y, m, d] = local.toISOString().slice(0, 10).split('-')
      return `${d}/${m}/${y}`
    })
    // dd/mm/yyyy, bukan mm/dd/yyyy bawaan pemilih tanggal browser
    await expect(dateInput).toHaveValue(today)
    await expect(dateInput).toHaveValue(/^\d{2}\/\d{2}\/\d{4}$/)

    // bill untuk bulan lalu: transaksinya beda dari tanggal pencatatan
    const now = new Date()
    const past = new Date(now.getFullYear(), now.getMonth() - 1, 15, 12)
    const pastISO = `${past.getFullYear()}-${String(past.getMonth() + 1).padStart(2, '0')}-15`
    const pastShort = past.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })

    await page.getByLabel('Nama bill').fill('Tanggal Lalu ' + stamp)
    await page.getByLabel('Item 1').fill('Nasi goreng')
    await page.getByLabel('Harga satuan').first().fill('30000')
    await dateInput.fill('15/' + String(past.getMonth() + 1).padStart(2, '0') + '/' + past.getFullYear())
    const shown = String(past.getMonth() + 1).padStart(2, '0')
    await expect(dateInput).toHaveValue('15/' + shown + '/' + past.getFullYear())
    await page.getByRole('button', { name: 'Buat bill' }).click()
    await expect(page).toHaveURL(/\/b\//)

    await page.goto('/')
    const row = page
      .getByText('Tanggal Lalu ' + stamp)
      .locator('xpath=ancestor::*[contains(@class,"app-row")]')
    // yang tampil tanggal pilihan (15 <bulan lalu>), bukan tanggal pencatatan
    await expect(row).toContainText(pastShort)
  })
})
