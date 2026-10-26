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

async function createBill(page: Page, title: string) {
  await page.goto('/create')
  await page.getByLabel('Nama bill').fill(title)
  await page.getByLabel('Item 1').fill('Ayam')
  await page.getByLabel('Harga satuan').fill('30000')
  await page.getByRole('button', { name: 'Buat bill' }).click()
  await expect(page).toHaveURL(/\/b\//)
  return page.url()
}

async function identityOf(page: Page) {
  const raw = await page.evaluate(() => localStorage.getItem('bagiin_identity'))
  return JSON.parse(raw ?? '{}') as { id: string; secret: string }
}

/** Dua orang, satu bill: pembuat (Aufa) + tamu yang ikut & memilih. */
async function twoPeople(page: Page, browser: import('@playwright/test').Browser, title: string) {
  await freshUser(page, 'Aufa')
  const url = await createBill(page, title)
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const guest = await ctx.newPage()
  await freshUser(guest, 'Bima')
  await guest.goto(url)
  await guest.getByRole('button', { name: 'Ikut bill ini' }).click()
  await guest.getByRole('button', { name: /Ayam, ketuk/ }).click()
  await expect(guest.getByText(/bagian kamu Rp30\.000/)).toBeVisible()
  await page.reload()
  return { ctx, guest, url }
}

test.describe('Bagiin — pembayar, undangan, keluar', () => {
  test('21. ganti pembayar memindahkan kepemilikan bill', async ({ page, browser }) => {
    const { ctx } = await twoPeople(page, browser, 'Payer ' + stamp)

    await page.getByRole('button', { name: 'Ganti yang bayar duluan' }).click()
    await page.getByRole('button', { name: 'Bima Jadikan pembayar' }).click()
    await expect(page.getByText('Pembayar diganti ke Bima')).toBeVisible()
    await expect(page.getByText('Dibayar Bima')).toBeVisible()

    // kepemilikan pindah: pembuat lama tidak lagi punya tombol tutup bill
    await expect(page.getByRole('button', { name: 'Tutup bill' })).toHaveCount(0)
    await ctx.close()
  })

  test('22. undang kontak yang pernah bareng -> langsung masuk', async ({ page, browser }) => {
    const { ctx } = await twoPeople(page, browser, 'Kontak ' + stamp)

    await page.goto('/create')
    await page.getByLabel('Nama bill').fill('Undang ' + stamp)
    await page.getByLabel('Item 1').fill('Sate')
    await page.getByLabel('Harga satuan').fill('20000')
    await page.getByRole('button', { name: 'Buat bill' }).click()
    await expect(page).toHaveURL(/\/b\//)

    await page.getByRole('button', { name: 'Undang teman' }).click()
    await expect(page.getByRole('dialog', { name: 'Undang teman' })).toBeVisible()
    await page.getByRole('button', { name: 'Undang', exact: true }).first().click()
    await expect(page.getByText(/langsung masuk|Undangan dikirim/)).toBeVisible()

    await page.reload()
    await expect(page.getByText('Bima').first()).toBeVisible()
    await ctx.close()
  })

  test('23. tamu bisa keluar dari bill, pembuat tidak', async ({ page, browser }) => {
    const { ctx, guest } = await twoPeople(page, browser, 'Keluar ' + stamp)

    // pembuat tidak punya tombol keluar
    await expect(page.getByRole('button', { name: 'Keluar dari bill ini' })).toHaveCount(0)

    await guest.reload()
    await guest.getByRole('button', { name: 'Keluar dari bill ini' }).click()
    await expect(guest.getByText('Kamu keluar dari bill ini')).toBeVisible()

    await page.reload()
    await expect(page.getByText('Bima')).toHaveCount(0)
    await ctx.close()
  })

  test('24. undangan menunggu muncul dan bisa dibatalkan', async ({ page, browser }) => {
    const { ctx, guest } = await twoPeople(page, browser, 'Pending ' + stamp)

    // tamu mematikan auto-accept supaya undangan berikutnya menunggu
    const guestIdentity = await identityOf(guest)
    const response = await page.request.post('/api/identities/' + guestIdentity.id + '/auto_accept', {
      headers: { 'X-Identity-Id': guestIdentity.id, 'X-Identity-Secret': guestIdentity.secret },
      data: { auto_accept: 0 },
    })
    expect(response.ok()).toBeTruthy()

    await page.goto('/create')
    await page.getByLabel('Nama bill').fill('Nunggu ' + stamp)
    await page.getByLabel('Item 1').fill('Kopi')
    await page.getByLabel('Harga satuan').fill('12000')
    await page.getByRole('button', { name: 'Buat bill' }).click()
    await expect(page).toHaveURL(/\/b\//)

    await page.getByRole('button', { name: 'Undang teman' }).click()
    await page.getByRole('button', { name: 'Undang', exact: true }).first().click()
    await expect(page.getByText(/Undangan dikirim ke Bima/)).toBeVisible()

    await page.reload()
    await expect(page.getByText('Undangan menunggu')).toBeVisible()
    await expect(page.getByText('Belum menerima undangan')).toBeVisible()

    await page.getByRole('button', { name: 'Batalkan', exact: true }).click()
    await expect(page.getByText('Undangan dibatalkan')).toBeVisible()
    await expect(page.getByText('Undangan menunggu')).toHaveCount(0)
    await ctx.close()
  })

  test('25. setelah ganti pembayar, pembuat lama bisa keluar', async ({ page, browser }) => {
    const { ctx } = await twoPeople(page, browser, 'Pindah ' + stamp)

    await page.getByRole('button', { name: 'Ganti yang bayar duluan' }).click()
    await page.getByRole('button', { name: 'Bima Jadikan pembayar' }).click()
    await expect(page.getByText('Pembayar diganti ke Bima')).toBeVisible()

    await page.reload()
    const leave = page.getByRole('button', { name: 'Keluar dari bill ini' })
    await expect(leave).toBeVisible()
    await leave.click()
    await expect(page.getByText('Kamu keluar dari bill ini')).toBeVisible()
    await ctx.close()
  })
})
