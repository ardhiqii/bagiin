import { test, expect, type Page } from '@playwright/test'

/**
 * Mengetuk item harus terasa instan.
 *
 * Yang diuji bukan "server menyimpan" (itu sudah diuji di tempat lain), tapi
 * bahwa tampilan berubah **sebelum** server menjawab — dan bahwa mengetuk
 * beruntun-cepat tidak menumpuk permintaan.
 *
 * Kalau jalur ini kembali menunggu balasan (seperti sebelumnya: POST lalu
 * `GET /bill`), tes 1 gagal karena tanda pilih baru muncul setelah 1,5 detik.
 */

const stamp = Date.now().toString().slice(-6)

async function buatBillDua(p: Page, nama: string) {
  await p.goto('/')
  await p.getByLabel('Nama kamu').fill(nama)
  await expect(p.getByRole('button', { name: 'Mulai pakai Bagiin' })).toBeEnabled({ timeout: 20000 })
  await p.getByRole('button', { name: 'Mulai pakai Bagiin' }).click()
  await expect(p.getByRole('heading', { level: 1 })).toContainText(nama)

  await p.goto('/create')
  await p.getByLabel('Nama bill').fill('Respons ketuk ' + stamp)
  await p.getByLabel('Item 1').fill('Kopi')
  await p.getByLabel('Harga satuan').first().fill('20000')
  await p.getByRole('button', { name: '+ Tambah item' }).click()
  await p.getByLabel('Item 2').fill('Roti')
  await p.getByLabel('Harga satuan').nth(1).fill('10000')

  await expect(p.getByRole('button', { name: 'Buat bill' })).toBeEnabled({ timeout: 20000 })
  await p.getByRole('button', { name: 'Buat bill' }).click()
  await expect(p).toHaveURL(/\/b\//, { timeout: 20000 })
  await expect(p.locator('.ds-item').first()).toBeVisible({ timeout: 20000 })
}

test.describe('Pilih item: umpan balik duluan, server menyusul', () => {
  test('45a. tanda pilih muncul sebelum server menjawab', async ({ page }) => {
    await buatBillDua(page, 'Cepat' + stamp)

    // Server ditahan 1,5 detik: kalau layar masih menunggu balasan,
    // tanda pilih tidak akan muncul dalam 400 ms.
    let ditahan = 0
    await page.route('**/api/bills/*/selections', async (route) => {
      ditahan += 1
      await new Promise((r) => setTimeout(r, 1500))
      await route.continue()
    })

    const item = page.locator('.ds-item').first()
    await expect(item).toHaveAttribute('aria-pressed', 'false')

    const mulai = Date.now()
    await item.click()
    await expect(item).toHaveAttribute('aria-pressed', 'true', { timeout: 400 })
    const jeda = Date.now() - mulai

    expect(jeda, 'tanda pilih harus muncul sebelum balasan server').toBeLessThan(400)
    expect(ditahan, 'ketukan pertama tetap dikirim').toBeGreaterThan(0)

    // Setelah balasan mendarat, layar tetap menunjukkan pilihan yang sama
    // (payload server yang menang, bukan salinan lokal yang tertinggal).
    await expect(item).toHaveAttribute('aria-pressed', 'true', { timeout: 10000 })
  })

  test('45b. lima ketukan cepat: layar mengikuti, kiriman tidak menumpuk', async ({ page }) => {
    await buatBillDua(page, 'Beruntun' + stamp)

    let kiriman = 0
    await page.route('**/api/bills/*/selections', async (route) => {
      kiriman += 1
      await new Promise((r) => setTimeout(r, 400))
      await route.continue()
    })

    const item = page.locator('.ds-item').first()
    for (let i = 0; i < 5; i += 1) {
      await item.click()
      await page.waitForTimeout(60)
    }

    // 5 ketukan tidak boleh jadi 5 kiriman: endpoint menerima satu set utuh,
    // jadi yang perlu sampai hanya keadaan terakhir.
    await page.waitForTimeout(2500)
    // Yang penting bukan angka pastinya, tapi bahwa 5 ketukan tidak menjadi
    // 5 kiriman: paling banyak satu kiriman berjalan + satu kiriman penutup
    // (kalau ketukan terakhir mendarat setelah kiriman kedua berangkat).
    expect(kiriman, 'kiriman digabung, bukan satu per ketukan').toBeLessThanOrEqual(3)
    expect(kiriman, 'tetap ada yang dikirim').toBeGreaterThan(0)

    // Keadaan akhir harus sama dengan yang dilihat server setelah disegarkan.
    const terakhir = await item.getAttribute('aria-pressed')
    await page.reload()
    await expect(page.locator('.ds-item').first()).toBeVisible({ timeout: 20000 })
    await expect(page.locator('.ds-item').first()).toHaveAttribute('aria-pressed', terakhir ?? 'false', {
      timeout: 20000,
    })
  })

  test('45c. sinyal putus: pilihan tetap di layar, dikirim ulang saat pulih', async ({ page }) => {
    await buatBillDua(page, 'Sinyal' + stamp)

    let putus = true
    await page.route('**/api/bills/*/selections', async (route) => {
      if (putus) await route.abort('failed')
      else await route.continue()
    })

    const item = page.locator('.ds-item').first()
    await item.click()

    // Gagal jaringan bukan penolakan: pilihan tidak boleh dibalik, tapi juga
    // tidak boleh diam-diam dianggap tersimpan.
    await expect(item).toHaveAttribute('aria-pressed', 'true', { timeout: 2000 })
    await expect(page.getByText(/Belum terkirim/)).toBeVisible({ timeout: 10000 })

    putus = false
    await expect(page.getByText(/Belum terkirim/)).toBeHidden({ timeout: 25000 })

    // Dan benar-benar sampai ke server, bukan cuma hilang dari layar.
    await page.reload()
    await expect(page.locator('.ds-item').first()).toHaveAttribute('aria-pressed', 'true', { timeout: 20000 })
  })
})
