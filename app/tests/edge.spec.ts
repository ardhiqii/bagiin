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

/** Buat bill dan kembalikan URL-nya. Nilai default: satu item Rp30.000. */
async function createBill(
  page: Page,
  opts: { title: string; items?: { name: string; price: string; qty?: string }[]; tax?: string; service?: string },
) {
  await page.goto('/create')
  await page.getByLabel('Nama bill').fill(opts.title)
  const items = opts.items ?? [{ name: 'Ayam', price: '30000' }]
  items.forEach((item, index) => {
    if (index > 0) return
    void item
  })
  await page.getByLabel('Item 1').fill(items[0].name)
  await page.getByLabel('Harga satuan').first().fill(items[0].price)
  if (items[0].qty) await page.getByLabel('Qty').first().fill(items[0].qty)
  for (let i = 1; i < items.length; i++) {
    await page.getByRole('button', { name: '+ Tambah item' }).click()
    await page.getByLabel('Item ' + (i + 1)).fill(items[i].name)
    await page.getByLabel('Harga satuan').nth(i).fill(items[i].price)
  }
  if (opts.tax) await page.getByLabel('Pajak', { exact: true }).fill(opts.tax)
  if (opts.service) await page.getByLabel('Service').fill(opts.service)
  await page.getByRole('button', { name: 'Buat bill' }).click()
  await expect(page).toHaveURL(/\/b\//)
  return page.url()
}

test.describe('Bagiin — kasus pinggir', () => {
  test('9. qty lebih dari satu ikut dihitung di total', async ({ page }) => {
    await freshUser(page, 'Aufa')
    await createBill(page, { title: 'Qty ' + stamp, items: [{ name: 'Es teh', price: '10000', qty: '3' }] })
    await expect(page.getByText('Rp30.000').first()).toBeVisible()
  })

  test('10. memilih dua item menjumlahkan bagian saya', async ({ page }) => {
    await freshUser(page, 'Aufa')
    await createBill(page, {
      title: 'Dua item ' + stamp,
      items: [
        { name: 'Nasi', price: '20000' },
        { name: 'Ayam', price: '25000' },
      ],
    })
    await page.getByRole('button', { name: /Nasi, ketuk/ }).click()
    await page.getByRole('button', { name: /Ayam, ketuk/ }).click()
    await expect(page.getByText(/bagian kamu Rp45\.000/)).toBeVisible()
  })

  test('11. dua orang memilih item yang sama -> dibagi', async ({ page, browser }) => {
    await freshUser(page, 'Aufa')
    const url = await createBill(page, { title: 'Bagi ' + stamp })

    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const guest = await ctx.newPage()
    await freshUser(guest, 'Bima')
    await guest.goto(url)
    await guest.getByRole('button', { name: 'Ikut bill ini' }).click()
    await guest.getByRole('button', { name: /Ayam, ketuk/ }).click()

    await page.reload()
    await page.getByRole('button', { name: /Ayam, ketuk/ }).click()

    await expect(page.getByText(/Rp15\.000/).first()).toBeVisible()
    await ctx.close()
  })

  test('12. bill ditutup tidak bisa dipilih lagi, lalu bisa dibuka kembali', async ({ page }) => {
    await freshUser(page, 'Aufa')
    await createBill(page, { title: 'Tutup ' + stamp })

    await page.getByRole('button', { name: 'Tutup bill' }).click()
    await expect(page.getByText('Bill ditutup')).toBeVisible()
    await expect(page.getByText('Ditutup', { exact: true })).toBeVisible()

    const item = page.getByRole('button', { name: /Ayam, ketuk/ })
    await expect(item).toBeDisabled()

    await page.getByRole('button', { name: 'Buka lagi' }).click()
    await expect(page.getByText('Bill dibuka lagi')).toBeVisible()
    await expect(item).toBeEnabled()
  })

  test('13. tamu membatalkan status lunas', async ({ page, browser }) => {
    await freshUser(page, 'Aufa')
    const url = await createBill(page, { title: 'Batal lunas ' + stamp })

    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const guest = await ctx.newPage()
    await freshUser(guest, 'Bima')
    await guest.goto(url)
    await guest.getByRole('button', { name: 'Ikut bill ini' }).click()
    await guest.getByRole('button', { name: /Ayam, ketuk/ }).click()
    await guest.getByRole('button', { name: 'Tandai bagianku lunas' }).click()
    await expect(guest.getByText('Ditandai lunas')).toBeVisible()

    await guest.getByRole('button', { name: 'Batalkan status lunas' }).click()
    await expect(guest.getByText('Status lunas dibatalkan')).toBeVisible()
    await expect(guest.getByRole('button', { name: 'Tandai bagianku lunas' })).toBeVisible()
    await ctx.close()
  })

  test('14. relog di halaman bill tetap menampilkan data', async ({ page }) => {
    await freshUser(page, 'Aufa')
    const url = await createBill(page, { title: 'Reload ' + stamp })
    await page.goto(url)
    await page.reload()
    await expect(page.getByText('Reload ' + stamp)).toBeVisible()
    await expect(page.getByText('Total bill')).toBeVisible()
  })

  test('15. bill yang tidak ada memberi pesan, bukan layar kosong', async ({ page }) => {
    await freshUser(page, 'Aufa')
    await page.goto('/b/tidak-ada-bill-ini')
    await expect(page.getByText('Bill tidak bisa dibuka')).toBeVisible()
    await expect(page.getByText(/Data tidak ditemukan|tidak ditemukan/i)).toBeVisible()
  })

  test('16. form kosong tidak bisa dikirim', async ({ page }) => {
    await freshUser(page, 'Aufa')
    await page.goto('/create')
    await expect(page.getByRole('button', { name: 'Buat bill' })).toBeDisabled()
  })

  test('17. pajak dan service masuk ke total', async ({ page }) => {
    await freshUser(page, 'Aufa')
    await createBill(page, {
      title: 'Pajak ' + stamp,
      items: [{ name: 'Makan', price: '100000' }],
      tax: '11000',
      service: '9000',
    })
    await expect(page.getByText('Rp120.000').first()).toBeVisible()
  })

  test('18. setelah semua lunas, bill pindah ke rekap final', async ({ page, browser }) => {
    await freshUser(page, 'Aufa')
    const url = await createBill(page, { title: 'Final ' + stamp })

    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const guest = await ctx.newPage()
    await freshUser(guest, 'Bima')
    await guest.goto(url)
    await guest.getByRole('button', { name: 'Ikut bill ini' }).click()
    await guest.getByRole('button', { name: /Ayam, ketuk/ }).click()
    await guest.getByRole('button', { name: 'Tandai bagianku lunas' }).click()
    await expect(guest.getByText('Ditandai lunas')).toBeVisible()
    await ctx.close()

    await page.goto('/recap')
    await expect(page.getByText('Sudah final', { exact: true })).toBeVisible()
    await expect(page.getByText('Final ' + stamp)).toBeVisible()
  })

  test('19. layar tidak melebar di 390 px', async ({ page }) => {
    await freshUser(page, 'Aufa')
    await page.goto('/create')
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(0)
  })

  test('20. desktop 1280 px tetap terbaca dan tidak melebar', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await freshUser(page, 'Aufa')
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(0)
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Halo')
  })
})
