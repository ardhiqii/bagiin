import { test, expect, type Page } from '@playwright/test'

/**
 * Kotak hitam gelombang 16 — sheet harus milik viewport, bukan milik kotak isi.
 *
 * Bug yang dijaga di sini terjadi di iPhone 15 dan TIDAK muncul di Chromium:
 * sheet dirender di dalam `<main class="app-body">`, dan elemen itu memakai
 * `-webkit-overflow-scrolling: touch`. Di iOS Safari wadah gulir seperti itu
 * menjadi containing block untuk `position: fixed`, jadi overlay terkurung di
 * kotak isi — sheet terpotong tepat di atas bar "Total bill"/navigasi, dan sisa
 * isinya tidak bisa dicapai jari. Karena Chromium tidak mereproduksinya, satu-
 * satunya cara menjaganya adalah memeriksa strukturnya: sheet harus dipasang di
 * <body>, menutupi seluruh tinggi layar, dan menggulir sendiri.
 */

async function freshUser(page: Page, name: string) {
  await page.goto('/')
  if (await page.getByRole('button', { name: 'Mulai pakai Bagiin' }).count()) {
    await page.getByLabel('Nama kamu').fill(name)
    await expect(page.getByRole('button', { name: 'Mulai pakai Bagiin' })).toBeEnabled({ timeout: 20000 })
    await page.getByRole('button', { name: 'Mulai pakai Bagiin' }).click()
  }
  await expect(page.getByRole('heading', { level: 1 })).toContainText(name, { timeout: 20000 })
}

async function openPicker(page: Page) {
  await page.goto('/create')
  await expect(page.locator('#bill-title')).toBeVisible({ timeout: 20000 })
  await page.locator('#bill-title').fill('Sheet')
  await page.locator('#item-name-0').fill('Nasi goreng')
  await page.locator('#item-price-0').fill('25000')
  await page.getByRole('button', { name: /Siapa yang ikut|Tambah orang|Pilih orang/i }).first().click()
  await expect(page.getByRole('dialog', { name: 'Siapa yang ikut?' })).toBeVisible({ timeout: 20000 })
}

test.describe('Kotak hitam — sheet dan viewport', () => {
  test('S1. sheet dipasang di <body> dan menutupi bar bawah, bukan terkurung di kotak isi', async ({ page }) => {
    await freshUser(page, 'Ios Satu')
    await openPicker(page)

    const geometri = await page.evaluate(() => {
      const overlay = document.querySelector('.ds-overlay') as HTMLElement | null
      const sheet = document.querySelector('.ds-sheet') as HTMLElement | null
      const dock = document.querySelector('.app-bottom') as HTMLElement | null
      const nav = document.querySelector('.app-nav') as HTMLElement | null
      if (!overlay || !sheet || !dock || !nav) return null
      const o = overlay.getBoundingClientRect()
      const d = dock.getBoundingClientRect()
      const n = nav.getBoundingClientRect()
      const atas = (y: number) => {
        const el = document.elementFromPoint(Math.round(window.innerWidth / 2), Math.round(y))
        return Boolean(el && el.closest('.ds-sheet'))
      }
      return {
        indukOverlay: overlay.parentElement?.tagName ?? '',
        overlayBawah: Math.round(o.bottom),
        viewport: window.innerHeight,
        sheetBawah: Math.round(sheet.getBoundingClientRect().bottom),
        dockTengah: Math.round(d.top + d.height / 2),
        navTengah: Math.round(n.top + n.height / 2),
        sheetDiAtasDock: atas(d.top + d.height / 2),
        sheetDiAtasNav: atas(n.top + n.height / 2),
      }
    })
    expect(geometri, 'sheet, dock, dan navigasi harus ada').not.toBeNull()

    // Inilah yang gagal di iPhone: overlay hidup di dalam .app-body.
    expect(geometri!.indukOverlay).toBe('BODY')
    // Overlay menutupi seluruh tinggi layar, dan sheet menempel ke dasarnya.
    expect(Math.abs(geometri!.overlayBawah - geometri!.viewport)).toBeLessThanOrEqual(1)
    expect(Math.abs(geometri!.sheetBawah - geometri!.viewport)).toBeLessThanOrEqual(1)
    // Bar "Total bill" dan navigasi berada DI BELAKANG sheet, bukan menimpanya.
    expect(geometri!.sheetDiAtasDock, 'bar aksi tidak boleh menimpa sheet').toBe(true)
    expect(geometri!.sheetDiAtasNav, 'navigasi tidak boleh menimpa sheet').toBe(true)
  })

  test('S2. isi sheet yang panjang digulir oleh sheet itu sendiri, halaman di belakang berhenti', async ({ page }) => {
    await freshUser(page, 'Ios Dua')
    await openPicker(page)

    // Daftar kontak yang panjang membuat isi sheet melebihi tinggi layar.
    await page.evaluate(() => {
      const sheet = document.querySelector('.ds-sheet') as HTMLElement
      const filler = document.createElement('div')
      filler.style.height = '1400px'
      sheet.appendChild(filler)
    })

    const hasil = await page.evaluate(() => {
      const sheet = document.querySelector('.ds-sheet') as HTMLElement
      const body = document.querySelector('.app-body') as HTMLElement
      const bisaGulir = sheet.scrollHeight > sheet.clientHeight
      sheet.scrollTop = 420
      return {
        bisaGulir,
        posisi: Math.round(sheet.scrollTop),
        tinggiMaksimal: Math.round(sheet.getBoundingClientRect().height),
        viewport: window.innerHeight,
        isiTerkunci: getComputedStyle(body).overflowY === 'hidden',
      }
    })

    expect(hasil.bisaGulir, 'isi yang lebih panjang dari layar harus bisa digulir').toBe(true)
    expect(hasil.posisi, 'sheet harus benar-benar bergerak saat digulir').toBeGreaterThan(0)
    // Tidak lebih tinggi dari layar — kalau lebih, tombol bawahnya tidak terjangkau.
    expect(hasil.tinggiMaksimal).toBeLessThanOrEqual(hasil.viewport)
    // Halaman di belakang tidak ikut tergulir selama sheet terbuka.
    expect(hasil.isiTerkunci).toBe(true)
  })
})
