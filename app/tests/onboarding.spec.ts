import { test, expect, type Page } from '@playwright/test'

const stamp = Date.now().toString().slice(-6)

async function named(page: Page, name: string) {
  await page.goto('/')
  if (await page.getByRole('button', { name: 'Mulai pakai Bagiin' }).count()) {
    await page.getByLabel('Nama kamu').fill(name)
    await page.getByRole('button', { name: 'Mulai pakai Bagiin' }).click()
  }
  await expect(page.getByRole('heading', { level: 1 })).toContainText(name)
}

test.describe('Bagiin — gerbang nama', () => {
  test('50. tanpa nama tidak bisa masuk ke layar mana pun', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Kenalan dulu' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Mulai pakai Bagiin' })).toBeDisabled()
    // tidak ada identitas yang dibuat diam-diam
    expect(await page.evaluate(() => localStorage.getItem('bagiin_identity'))).toBeNull()

    for (const [path, needle] of [
      ['/create', 'Buat bill butuh nama dulu'],
      // /bills dialihkan ke beranda, jadi gate-nya memakai kalimat beranda
      ['/bills', 'Isi nama kamu dulu'],
      ['/recap', 'Isi nama dulu supaya rekap kamu'],
      ['/settings', 'Isi nama dulu untuk membuka pengaturan'],
    ] as const) {
      await page.goto(path)
      await expect(page.getByRole('heading', { name: 'Kenalan dulu' })).toBeVisible()
      await expect(page.getByText(needle, { exact: false })).toBeVisible()
      // tidak ada form bill yang bisa diisi
      await expect(page.getByLabel('Nama bill')).toHaveCount(0)
    }
  })

  test('51. setelah nama diisi, layar yang tadi terkunci terbuka', async ({ page }) => {
    await page.goto('/create')
    await expect(page.getByRole('heading', { name: 'Kenalan dulu' })).toBeVisible()
    await page.getByLabel('Nama kamu').fill('Aufa')
    await page.getByRole('button', { name: 'Mulai pakai Bagiin' }).click()

    // gerbang hilang dan layar Buat langsung bisa dipakai
    await expect(page.getByLabel('Nama bill')).toBeVisible()
    await page.getByLabel('Nama bill').fill('Gate ' + stamp)
    await page.getByLabel('Item 1').fill('Soto')
    await page.getByLabel('Harga satuan').first().fill('25000')
    await page.getByRole('button', { name: 'Buat bill' }).click()
    await expect(page).toHaveURL(/\/b\//)

    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Halo, Aufa')
  })

  test('52. tamu tanpa nama tetap bisa lihat bill, tapi diminta nama saat ikut', async ({ page, browser }) => {
    await named(page, 'Aufa')
    await page.goto('/create')
    await page.getByLabel('Nama bill').fill('Link ' + stamp)
    await page.getByLabel('Item 1').fill('Nasi uduk')
    await page.getByLabel('Harga satuan').first().fill('17000')
    await page.getByRole('button', { name: 'Buat bill' }).click()
    await expect(page).toHaveURL(/\/b\//)
    const url = page.url()

    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const guest = await ctx.newPage()
    await guest.goto(url)

    // isi bill terlihat tanpa perlu nama
    await expect(guest.getByText('Nasi uduk')).toBeVisible()
    await expect(guest.getByText('Rp17.000').first()).toBeVisible()

    // mencoba ikut: diminta nama dulu, bukan gagal diam-diam
    await guest.getByRole('button', { name: 'Ikut bill ini' }).click()
    await expect(guest.getByRole('dialog', { name: 'Isi nama dulu' })).toBeVisible()
    await guest.getByLabel('Nama kamu').fill('Bima')
    await guest.getByRole('button', { name: 'Simpan nama & ikut bill' }).click()
    await expect(guest.getByText('Kamu masuk ke bill ini')).toBeVisible()

    // setelah punya nama, memilih item langsung jalan
    await guest.getByRole('button', { name: /Nasi uduk, ketuk/ }).click()
    await expect(guest.getByText(/bagian kamu Rp17\.000/)).toBeVisible()
    await ctx.close()
  })

  test('53. hapus identitas mengembalikan aplikasi ke gerbang nama', async ({ page }) => {
    await named(page, 'Aufa')
    await page.goto('/settings')
    await page.getByLabel('Nama kamu').fill('Aufa Fauqi')
    await page.getByRole('button', { name: 'Simpan nama' }).click()
    await expect(page.getByText('Nama kamu sudah diperbarui')).toBeVisible()

    await page.getByRole('button', { name: 'Hapus identitas di perangkat ini' }).click()
    await expect(page.getByText('Yakin mulai dari nol?')).toBeVisible()
    await page.getByRole('button', { name: 'Ya, hapus identitas' }).click()
    await expect(page.getByText('Identitas dihapus dari perangkat ini')).toBeVisible()
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('heading', { name: 'Kenalan dulu' })).toBeVisible()

    await page.goto('/create')
    await expect(page.getByRole('heading', { name: 'Kenalan dulu' })).toBeVisible()
  })
})
