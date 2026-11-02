import { test, expect, type Page } from '@playwright/test'

/** Aksi sekunder sekarang ada di sheet 'Aksi lain' supaya layar bill tidak penuh tombol. */
async function openActions(screen: any) {
  await screen.getByRole('button', { name: 'Aksi lain' }).click()
  await screen.waitForTimeout(150)
}

const stamp = Date.now().toString().slice(-6)

async function freshUser(page: Page, name: string) {
  await page.goto('/')
  if (await page.getByRole('button', { name: 'Mulai pakai Bagiin' }).count()) {
    await page.getByLabel('Nama kamu').fill(name)
    await page.getByRole('button', { name: 'Mulai pakai Bagiin' }).click()
  }
  await expect(page.getByRole('heading', { level: 1 })).toContainText(name)
}

/**
 * Peserta sekarang dipilih dari orang yang pernah sebill, bukan diketik.
 * Helper ini membuka sheet-nya dan mencentang nama yang diminta.
 */
async function pickPeople(page: Page, names: string[]) {
  await page.getByRole('button', { name: /\+ Pilih orang|\+ Tambah orang lagi/ }).click()
  const sheet = page.getByRole('dialog', { name: 'Siapa yang ikut?' })
  for (const name of names) {
    await sheet.getByRole('button', { name: new RegExp(name) }).first().click()
  }
  await sheet.getByRole('button', { name: /^Selesai/ }).click()
}

async function createBill(page: Page, title: string, opts: { people?: string[] } = {}) {
  await page.goto('/create')
  await page.getByLabel('Nama bill').fill(title)
  await page.getByLabel('Item 1').fill('Sate ayam')
  await page.getByLabel('Harga satuan').first().fill('30000')
  if (opts.people?.length) await pickPeople(page, opts.people)
  // Tunggu aplikasi menyatakan siap, jangan menebak lewat jeda: tombol ini
    // mati selama identitas belum siap, dan klik ke tombol mati hilang tanpa
    // jejak — di mesin lambat itu terbaca sebagai "aplikasi tidak berpindah".
    await expect(page.getByRole('button', { name: 'Buat bill' })).toBeEnabled()
    await page.getByRole('button', { name: 'Buat bill' }).click()
  await expect(page).toHaveURL(/\/b\//)
  return page.url()
}

/** Matikan "Terima undangan otomatis": undangan berhenti di kartu dulu. */
async function turnOffAutoAccept(page: Page) {
  await page.goto('/settings')
  const toggle = page.getByLabel('Terima undangan otomatis')
  await expect(toggle).toBeVisible({ timeout: 20000 })
  if (await toggle.isChecked()) {
    await toggle.click()
    await expect(toggle).not.toBeChecked()
  }
}

test.describe('Bagiin — lunas manual dan daftar nama', () => {
  test('38. pemilik bisa menandai seluruh bill lunas lalu membatalkannya', async ({ page, browser }) => {
    await freshUser(page, 'Budi')
    const url = await createBill(page, 'Lunas ' + stamp)

    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const guest = await ctx.newPage()
    await freshUser(guest, 'Bima')
    await guest.goto(url)
    await guest.getByRole('button', { name: 'Ikut bill ini' }).click()
    await guest.getByRole('button', { name: /Sate ayam, ketuk/ }).click()
    await expect(guest.getByText(/bagian kamu Rp30\.000/)).toBeVisible()

    await page.reload()
    await openActions(page)
    await page.getByRole('button', { name: 'Tandai semua lunas' }).first().click()
    await expect(page.getByText(/ditandai lunas|Bill ditandai lunas/).first()).toBeVisible()
    // muat ulang: label aksi bergantung pada status bill yang baru berubah
    await page.reload()
    await openActions(page)
    await expect(page.getByRole('button', { name: 'Batalkan lunas seluruh bill' })).toBeVisible()
    await page.getByRole('button', { name: 'Batalkan lunas seluruh bill' }).click()
    await expect(page.getByText(/Tanda lunas dibatalkan/).first()).toBeVisible()
    await openActions(page)
    await expect(page.getByRole('button', { name: 'Tandai semua lunas' }).first()).toBeVisible()
    await ctx.close()
  })

  test('39. orang yang dipilih dari kontak menyambung ke dirinya saat join', async ({ page, browser }) => {
    await freshUser(page, 'Budi')
    // Bima harus pernah sebill dulu supaya muncul di daftar pilihan
    const basis = await createBill(page, 'Basis ' + stamp)
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const guest = await ctx.newPage()
    await freshUser(guest, 'Bima')
    // Bima mematikan undangan otomatis, jadi undangan berhenti sebagai kartu
    // sampai dia sendiri membuka link — inilah yang membuat nama di daftar
    // masih berstatus "diundang, belum bergabung"
    await turnOffAutoAccept(guest)
    await guest.goto(basis)
    await guest.getByRole('button', { name: 'Ikut bill ini' }).click()
    await guest.getByRole('button', { name: /Sate ayam, ketuk/ }).click()

    const url = await createBill(page, 'Roster ' + stamp, { people: ['Bima'] })

    // undangan berhenti sebagai kartu menunggu sampai orangnya membuka link;
    // namanya tetap terlihat di layar bill, bukan hilang tanpa jejak
    await page.reload()
    await expect(page.getByText('Undangan menunggu')).toBeVisible({ timeout: 15000 })
    await expect(page.getByText('Belum menerima undangan')).toBeVisible()

    await guest.goto(url)
    await guest.getByRole('button', { name: 'Ikut bill ini' }).click()
    await guest.getByRole('button', { name: /Sate ayam, ketuk/ }).click()
    await expect(guest.getByText(/bagian kamu Rp30\.000/)).toBeVisible()

    // klaim berhasil: kartu undangan hilang, Bima jadi baris orang biasa
    await page.reload()
    await expect(page.getByText('Undangan menunggu')).toHaveCount(0, { timeout: 15000 })
    await expect(page.getByText(/Bagian Rp30\.000/)).toBeVisible()
    await expect(page.getByText(/Bima/).first()).toBeVisible()
    await ctx.close()
  })

  test('40. pemilik mengeluarkan orang dari bill', async ({ page, browser }) => {
    await freshUser(page, 'Budi')
    const url = await createBill(page, 'Keluarkan ' + stamp)

    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const guest = await ctx.newPage()
    await freshUser(guest, 'Bima')
    await guest.goto(url)
    await guest.getByRole('button', { name: 'Ikut bill ini' }).click()
    await guest.getByRole('button', { name: /Sate ayam, ketuk/ }).click()

    await page.reload()
    await expect(page.getByRole('button', { name: 'Keluarkan Bima' })).toBeVisible()
    await page.getByRole('button', { name: 'Keluarkan Bima' }).click()
    await expect(page.getByText('Bima dikeluarkan')).toBeVisible()

    await page.reload()
    await expect(page.getByText('Bima')).toHaveCount(0)
    await expect(page.getByText(/bagian kamu Rp30\.000/)).toBeVisible()
    await ctx.close()
  })

})


/**
 * Bug: memilih orang dari kontak saat membuat bill hanya mengirim NAMANYA.
 * Baris peserta tersimpan tanpa identitas, tidak ada undangan, dan orang yang
 * sudah dipilih tidak pernah tahu dirinya masuk bill — sampai dia membuka link
 * yang belum tentu dikirim.
 */
test.describe('Bagiin — peserta dari kontak', () => {
  test('55. orang yang dipilih dari kontak langsung dapat billnya tanpa link', async ({ page, browser }) => {
    const ownerName = 'Aufa ' + stamp
    const guestName = 'Amel ' + stamp
    await freshUser(page, ownerName)

    // mereka harus pernah sebill dulu supaya muncul di pemilih kontak
    const firstUrl = await createBill(page, 'Kenalan ' + stamp)
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const guest = await ctx.newPage()
    await freshUser(guest, guestName)
    await guest.goto(firstUrl)
    await guest.getByRole('button', { name: 'Ikut bill ini' }).click()
    await guest.getByRole('button', { name: /Sate ayam, ketuk/ }).click()

    // bill kedua: dia dipilih dari kontak, bukan lewat link
    await page.goto('/create')
    await page.getByLabel('Nama bill').fill('Dipilih ' + stamp)
    await page.getByLabel('Item 1').fill('Kopi susu')
    await page.getByLabel('Harga satuan').first().fill('24000')
    await pickPeople(page, [guestName])
    await expect(page.getByRole('button', { name: 'Buat bill' })).toBeEnabled()
    await page.getByRole('button', { name: 'Buat bill' }).click()
    await expect(page).toHaveURL(/\/b\//)

    // tanpa membuka link apa pun, bill itu harus sudah ada di berandanya
    await guest.goto('/')
    await expect(guest.getByText('Dipilih ' + stamp)).toBeVisible({ timeout: 15000 })

    await ctx.close()
  })
})
