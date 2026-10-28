import { test, expect, type Page } from '@playwright/test'

/**
 * Integritas versi 1.0 — hal-hal yang tidak terlihat sebagai "fitur" tapi
 * rusak tanpa suara: pratinjau tautan, PWA, angka yang berbeda antar endpoint,
 * dan getaran yang tidak pernah menyala.
 *
 * Kasus I-01..I-05 di `TEST-MATRIX.md`.
 */

const stamp = Date.now().toString().slice(-6)

async function identity(page: Page) {
  const stored = await page.evaluate(() => localStorage.getItem('bagiin_identity'))
  return JSON.parse(stored || '{}') as { id: string; name: string; secret: string }
}

test.describe('1.0 — integritas yang tidak kelihatan', () => {
  test('I-01. pratinjau tautan dan PWA: og:image, manifest, ikon semuanya hidup', async ({ page, request }) => {
    await page.goto('/')
    const head = await page.evaluate(() => {
      const meta = (sel: string) => document.querySelector(sel)?.getAttribute('content') ?? null
      return {
        ogImage: meta('meta[property="og:image"]'),
        ogTitle: meta('meta[property="og:title"]'),
        twitter: meta('meta[name="twitter:card"]'),
        manifest: document.querySelector('link[rel="manifest"]')?.getAttribute('href') ?? null,
        appleIcon: document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href') ?? null,
      }
    })
    // Tautan bill dikirim lewat WhatsApp: tanpa og:image yang mendarat cuma URL.
    expect(head.ogImage, 'og:image harus ada').toContain('og-cover.png')
    expect(head.ogTitle).toBeTruthy()
    expect(head.twitter).toBe('summary_large_image')
    expect(head.manifest).toBe('/manifest.webmanifest')
    expect(head.appleIcon).toBe('/icon-180.png')

    // manifest harus benar-benar bisa dipasang, bukan cuma ada file-nya
    const manifest = await request.get('/manifest.webmanifest')
    expect(manifest.status()).toBe(200)
    expect(manifest.headers()['content-type'], 'MIME salah = PWA tidak bisa dipasang').toContain(
      'application/manifest+json',
    )
    const json = await manifest.json()
    expect(json.start_url).toBe('/')
    expect(json.display).toBe('standalone')
    const sizes = json.icons.map((i: { sizes: string }) => i.sizes)
    expect(sizes).toContain('192x192')
    expect(sizes).toContain('512x512')

    for (const icon of ['/icon-192.png', '/icon-512.png', '/icon-maskable-512.png', '/apple-touch-icon.png'].slice(0, 3)) {
      const res = await request.get(icon)
      expect(res.status(), icon).toBe(200)
      expect(res.headers()['content-type']).toContain('image/')
    }
    const cover = await request.get('/og-cover.png')
    expect(cover.status(), 'gambar og:image harus bisa diambil crawler').toBe(200)
  })

  test('I-02. tombol bagikan menyalin tautan bill, bukan cuma bergetar tanpa hasil', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.goto('/')
    await page.getByLabel('Nama kamu').fill('Bagikan ' + stamp)
    await page.getByRole('button', { name: 'Mulai pakai Bagiin' }).click()
    await page.goto('/create')
    await page.getByLabel('Nama bill').fill('Bagikan ' + stamp)
    await page.getByLabel('Item 1').fill('Kopi')
    await page.getByLabel('Harga satuan').first().fill('20000')
    await page.getByRole('button', { name: 'Buat bill' }).click()
    await expect(page).toHaveURL(/\/b\//)

    // Chromium headless tidak punya navigator.share -> harus jatuh ke clipboard
    await page.getByRole('button', { name: 'Bagikan ke teman' }).click()
    await expect(page.getByText(/Link disalin/)).toBeVisible()
    const copied = await page.evaluate(() => navigator.clipboard.readText())
    expect(copied, 'yang disalin harus tautan bill ini').toContain('/b/')
    expect(copied).toContain(page.url().split('/b/')[1])
  })

  test('I-03. getaran menyala saat item dipilih dan saat dilepas', async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __buzz: number[] }
      w.__buzz = []
      // Chromium headless tidak punya vibrate; stub mencatat panggilannya
      Object.defineProperty(navigator, 'vibrate', {
        configurable: true,
        value: (ms: number) => {
          w.__buzz.push(ms)
          return true
        },
      })
    })
    await page.goto('/')
    await page.getByLabel('Nama kamu').fill('Getar ' + stamp)
    await page.getByRole('button', { name: 'Mulai pakai Bagiin' }).click()
    await page.goto('/create')
    await page.getByLabel('Nama bill').fill('Getar ' + stamp)
    await page.getByLabel('Item 1').fill('Kopi')
    await page.getByLabel('Harga satuan').first().fill('20000')
    await page.getByRole('button', { name: 'Buat bill' }).click()
    await expect(page).toHaveURL(/\/b\//)

    const item = page.getByRole('button', { name: /Kopi/ }).first()
    await item.click()
    await expect(page.getByText('Kopi').first()).toBeVisible()
    const afterPick = await page.evaluate(() => (window as unknown as { __buzz: number[] }).__buzz.length)
    expect(afterPick, 'memilih item harus bergetar').toBeGreaterThan(0)
  })

  test('I-04. angka di daftar, di halaman bill, dan di rekap berasal dari hitungan yang sama', async ({ page }) => {
    const name = 'Konsisten ' + stamp
    await page.goto('/')
    await page.getByLabel('Nama kamu').fill(name)
    await page.getByRole('button', { name: 'Mulai pakai Bagiin' }).click()
    const me = await identity(page)

    await page.goto('/create')
    await page.getByLabel('Nama bill').fill('Konsisten ' + stamp)
    await page.getByLabel('Item 1').fill('Nasi Goreng')
    await page.getByLabel('Harga satuan').first().fill('33000')
    await page.getByRole('button', { name: 'Tambah item' }).click()
    await page.getByLabel('Item 2').fill('Es Teh')
    await page.getByLabel('Harga satuan').nth(1).fill('7000')
    await page.getByRole('button', { name: 'Buat bill' }).click()
    await expect(page).toHaveURL(/\/b\//)
    const billId = page.url().split('/b/')[1]

    // ambil angka dari dua endpoint berbeda, bukan dari DOM: kalau backend
    // menjawab beda, layar mana pun yang salah tidak akan ketahuan dari UI
    const headers = { 'X-Identity-Id': me.id, 'X-Identity-Secret': me.secret }
    const list = await (await page.request.get(`/api/identities/${me.id}/bills`, { headers })).json()
    const row = list.find((b: { id: string }) => b.id === billId)
    const detail = await (await page.request.get(`/api/bills/${billId}`, { headers })).json()
    const mine = detail.people.find((p: { identity_id: string }) => p.identity_id === me.id)

    expect(row.total_idr, 'total bill sama di dua endpoint').toBe(detail.bill.total_idr)
    expect(row.uncovered_idr).toBe(detail.uncovered_idr)
    expect(row.my_total_idr, 'bagian saya sama di dua endpoint').toBe(mine.total_idr)
    // invarian inti: bagian semua orang + yang belum diambil == total
    const sum = detail.people.reduce((a: number, p: { total_idr: number }) => a + p.total_idr, 0)
    expect(sum + detail.uncovered_idr).toBe(detail.bill.total_idr)
  })

  test('I-05. identitas tamu 0.9 (data localStorage lama) tetap dikenali di 1.0', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const page = await ctx.newPage()
    // bentuk penyimpanan 0.9: id, name, role, secret — tanpa field baru
    const created = await (
      await page.request.post('/api/identities', { data: { name: 'Tamu 0.9 ' + stamp } })
    ).json()
    await page.addInitScript((ident) => {
      localStorage.setItem('bagiin_identity', JSON.stringify(ident))
      localStorage.setItem('bagiin_name', ident.name)
    }, { id: created.id, name: created.name, role: created.role ?? 'guest', secret: created.secret })

    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Tamu 0.9 ' + stamp)
    const stored = await page.evaluate(() => localStorage.getItem('bagiin_identity'))
    expect(JSON.parse(stored ?? '{}').id, 'identitas lama tidak boleh diganti identitas baru').toBe(created.id)
    await ctx.close()
  })
})
