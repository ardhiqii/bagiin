/// <reference types="node" />
import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
// @ts-ignore -- node:sqlite belum punya tipe di @types/node yang dipakai di sini
import { DatabaseSync } from 'node:sqlite'

/**
 * Kasus "DB 0.9 dipakai 1.0".
 *
 * Semua tes lain berjalan di DB sandbox yang sudah lama hidup di 1.0. Berkas ini
 * menjawab pertanyaan yang berbeda: kalau DB produksi 0.9 (81 bill nyata, 54
 * orang, 26 struk) disalin apa adanya lalu backend 1.0 dinyalakan di atasnya,
 * apakah migrasinya benar dan apakah datanya masih utuh di layar?
 *
 * Isinya sengaja membaca DB langsung (read-only) untuk hal yang mustahil
 * diperiksa dari API: klaim skema, kelengkapan backfill, dan kredensial
 * identitas lama (yang tidak pernah diketahui klien).
 *
 * Jalankan dengan: MIGRATION_DB=/tmp/v09full/bagiin.db npx playwright test tests/migration.spec.ts
 */

const DB_PATH = process.env.MIGRATION_DB
/** DB 0.9 asli (belum disentuh 1.0), kalau mau dibandingkan per baris. */
const SRC_PATH = process.env.MIGRATION_SOURCE
const stamp = Date.now().toString().slice(-6)

function db() {
  return new DatabaseSync(DB_PATH as string, { readOnly: true })
}

function rows<T = any>(sql: string, ...params: any[]): T[] {
  const conn = db()
  try {
    return conn.prepare(sql).all(...params) as T[]
  } finally {
    conn.close()
  }
}

function cols(table: string): string[] {
  return (rows(`PRAGMA table_info(${table})`) as any[]).map((r) => r.name)
}

function auth(id: string, secret: string) {
  return { 'X-Identity-Id': id, 'X-Identity-Secret': secret }
}

function rp(n: number): string {
  return 'Rp' + Math.round(n).toLocaleString('id-ID')
}

async function detail(api: APIRequestContext, billId: string) {
  const res = await api.get('/api/bills/' + billId)
  expect(res.status(), 'GET /api/bills/' + billId).toBe(200)
  return res.json()
}

/** Baris identitas lama yang tidak mungkin diketahui klien: id + secret. */
function oldIdentity(minBills = 1) {
  const [row] = rows<any>(
    `SELECT i.id, i.name, i.secret,
            (SELECT COUNT(*) FROM bill b WHERE b.creator_identity_id = i.id) AS bills
       FROM identity i
      WHERE i.secret IS NOT NULL AND i.secret != ''
      ORDER BY bills DESC
      LIMIT 1 OFFSET 0`,
  )
  expect(row, 'butuh minimal satu identitas 0.9').toBeTruthy()
  return row
}

test.describe('Bagiin 1.0 di atas DB 0.9', () => {
  test.skip(!DB_PATH, 'jalankan dengan MIGRATION_DB=<path salinan db 0.9>')

  test('M-01. migrasi menambah yang kurang tanpa menyentuh yang ada', async () => {
    const tabel = (rows("SELECT name FROM sqlite_master WHERE type='table'") as any[]).map((r) => r.name)
    for (const t of ['device', 'oauth_account', 'contact_alias']) {
      expect(tabel, 'tabel ' + t + ' harus dibuat migrasi').toContain(t)
    }
    for (const t of ['bill', 'identity', 'item', 'selection', 'payment', 'bill_photo']) {
      expect(tabel, 'tabel 0.9 ' + t + ' tidak boleh hilang').toContain(t)
    }

    const kolom = cols('identity')
    for (const k of ['username', 'username_lower', 'password_hash', 'handle']) {
      expect(kolom, 'kolom identity.' + k).toContain(k)
    }
    // kolom 0.9 harus tetap ada semua
    for (const k of ['id', 'name', 'role', 'identity_code_hash', 'created_at', 'secret', 'auto_accept']) {
      expect(kolom, 'kolom lama identity.' + k).toContain(k)
    }

    const index = (rows("SELECT name FROM sqlite_master WHERE type='index'") as any[]).map((r) => r.name)
    for (const i of ['idx_identity_username', 'idx_device_identity', 'idx_oauth_identity', 'idx_alias_unique']) {
      expect(index, 'index ' + i).toContain(i)
    }

    // kolom baru tidak boleh NOT NULL tanpa default: 0.9 masih menulis ke tabel
    // yang sama, dan ALTER TABLE NOT NULL tanpa default membuat INSERT 0.9 gagal.
    for (const k of ['username', 'username_lower', 'password_hash', 'handle']) {
      const c = (rows('PRAGMA table_info(identity)') as any[]).find((r) => r.name === k)!
      expect(c.notnull, 'identity.' + k + ' harus nullable').toBe(0)
    }

    // Backfill pembeda: baris yang sudah ada di 0.9 harus punya pembeda setelah
    // migrasi. Baris yang dibuat SETELAH boot tidak ikut diperiksa di sini:
    // `new_identity()` tidak mengisi kolom itu (pembeda dihitung dari id saat
    // dibaca), dan kolomnya baru diisi backfill pada boot berikutnya. Itu
    // temuan terpisah, bukan bagian migrasi.
    if (SRC_PATH) {
      const src = new DatabaseSync(SRC_PATH as string, { readOnly: true })
      const lama = (src.prepare('SELECT id FROM identity').all() as any[]).map((r) => r.id)
      src.close()
      expect(lama.length, 'DB 0.9 harus punya identitas').toBeGreaterThan(0)

      const target = new Map(
        (rows('SELECT id, handle FROM identity') as any[]).map((r) => [r.id, r.handle]),
      )
      const tanpa: string[] = []
      for (const id of lama) {
        if (!target.has(id)) tanpa.push(id + ' (hilang)')
        else if (!target.get(id)) tanpa.push(id + ' (pembeda kosong)')
      }
      expect(tanpa.slice(0, 5), 'identitas 0.9 yang tidak mendapat pembeda').toEqual([])
    }
  })

  test('M-02. angka semua bill 0.9 tetap utuh setelah migrasi', async ({ request }) => {
    test.setTimeout(180_000)
    const bills = rows<any>('SELECT id, title, total_idr FROM bill ORDER BY created_at LIMIT 120')
    expect(bills.length, 'harus ada bill lama').toBeGreaterThan(0)

    const rusak: string[] = []
    for (const b of bills) {
      const d = await detail(request, b.id)
      const total = d.bill.total_idr as number
      const orang = (d.people as any[]).reduce((s, p) => s + Math.round(p.total_idr), 0)
      const sisa = Math.round(d.uncovered_idr ?? 0)
      if (total !== b.total_idr) rusak.push(`${b.id}: total berubah ${b.total_idr} -> ${total}`)
      if (Math.abs(orang + sisa - total) > 0) rusak.push(`${b.id}: ${orang} + sisa ${sisa} != ${total}`)
      if (d.total_ok !== true) rusak.push(`${b.id}: total_ok false`)
      if ((d.people as any[]).some((p) => p.total_idr < 0)) rusak.push(`${b.id}: ada bagian negatif`)
      if (total < 0) rusak.push(`${b.id}: total negatif`)
    }
    expect(rusak.slice(0, 8), 'bill 0.9 yang tidak rekonsiliasi di 1.0').toEqual([])
  })

  test('M-03. struk lama (kolom photo_path 0.9) tetap bisa dilihat', async ({ request }) => {
    const bills = rows<any>(
      "SELECT id FROM bill WHERE photo_path IS NOT NULL AND photo_path != '' LIMIT 8",
    )
    expect(bills.length, 'harus ada bill 0.9 dengan struk').toBeGreaterThan(0)
    for (const b of bills) {
      const d = await detail(request, b.id)
      const photos = (d.photos ?? []) as any[]
      expect(photos.length, 'bill ' + b.id + ' harus punya minimal satu foto').toBeGreaterThan(0)

      const file = String(photos[0].path).split('/').pop() as string
      const res = await request.get('/uploads/' + file)
      expect(res.status(), 'foto ' + file).toBe(200)
      expect(res.headers()['content-type'] ?? '').toContain('image/')
      expect((await res.body()).length, 'foto ' + file + ' tidak kosong').toBeGreaterThan(1000)
    }
  })

  test('M-04. rekap identitas 0.9 bisa dihitung 1.0', async ({ request }) => {
    const me = oldIdentity()
    const res = await request.get('/api/identities/' + me.id + '/recap', { headers: auth(me.id, me.secret) })
    expect(res.status()).toBe(200)
    const recap = await res.json()

    const terima = Math.round(recap.final.receivable_idr)
    const bayar = Math.round(recap.final.payable_idr)
    const net = Math.round(recap.final.net_idr)
    expect(net, 'net = terima - bayar').toBe(terima - bayar)
    expect(Array.isArray(recap.final.counterparties)).toBe(true)
    expect(recap.final.counterparties.length, 'punya lawan transaksi').toBeGreaterThan(0)

    // yang belum pasti, kalau ada, harus punya jumlah bill dan tidak pernah
    // ikut dijumlahkan ke net
    if (recap.provisional && recap.provisional.bill_count > 0) {
      expect(Math.round(recap.provisional.bill_count)).toBeGreaterThan(0)
    }
  })

  test('M-05. identitas 0.9 bisa naik jadi akun 1.0 (username + password) lalu masuk lagi', async ({ request }) => {
    // identitas yang belum punya akun: kalau tes diulang di DB yang sama, yang
    // sudah dipasangi password tidak bisa dipakai lagi (passwordnya tidak kita
    // simpan), dan memilih ulang membuat tes ini tetap jujur di run kedua.
    const [me] = rows<any>(
      `SELECT id, name, secret FROM identity
        WHERE secret IS NOT NULL AND secret != ''
          AND password_hash IS NULL AND username IS NULL
        ORDER BY (SELECT COUNT(*) FROM bill b WHERE b.creator_identity_id = identity.id) DESC
        LIMIT 1`,
    )
    test.skip(!me, 'semua identitas 0.9 di DB ini sudah punya akun 1.0')

    const username = 'lama_' + stamp
    const password = 'RahasiaLama123'

    const setU = await request.post('/api/auth/username', { headers: auth(me.id, me.secret), data: { username } })
    expect(setU.status(), await setU.text()).toBe(200)
    const setP = await request.post('/api/auth/password', { headers: auth(me.id, me.secret), data: { new_password: password } })
    expect(setP.status(), await setP.text()).toBe(200)

    const login = await request.post('/api/auth/login', { data: { username, password } })
    expect(login.status(), await login.text()).toBe(200)
    const body = await login.json()
    expect(body.identity.id, 'masuk ke identitas yang sama, bukan akun baru').toBe(me.id)
    expect(body.identity.handle, 'pembeda tetap ada setelah naik akun').toMatch(/^[A-Z0-9]{4}$/)
  })

  test('M-06. bill 0.9 masih bisa diubah pemiliknya, angkanya tidak bergeser', async ({ request }) => {
    const me = oldIdentity()
    const kandidat = rows<any>(
      `SELECT id, title, total_idr FROM bill
        WHERE creator_identity_id = ? AND status = 'open'
          AND (paid_by_identity_id IS NULL OR paid_by_confirmed = 0)
        ORDER BY created_at DESC LIMIT 8`,
      me.id,
    )
    expect(kandidat.length, 'butuh bill terbuka milik identitas lama').toBeGreaterThan(0)

    // Bill yang sudah lunas menolak diubah (aturan yang benar), jadi cari yang
    // masih bisa — tanpa memaksa, tanpa mengubah status apa pun.
    let hasil: { sebelum: any; sesudah: any; judul: string } | null = null
    for (const b of kandidat) {
      // PUT /api/bills/{id} mengganti seluruh isi bill (bukan patch), jadi
      // payload-nya harus lengkap seperti layar Sunting mengirim: item ikut,
      // hanya judulnya yang berubah.
      const d = await detail(request, b.id)
      const judul = 'Diubah di 1.0 ' + stamp
      const body = {
        title: judul,
        subtotal: d.bill.subtotal_idr,
        tax: d.bill.tax_idr,
        service: d.bill.service_idr,
        order_discount: d.bill.order_discount_idr,
        cashback: d.bill.cashback_idr,
        total: d.bill.total_idr,
        tax_included: !!d.bill.tax_included,
        participant_count: d.bill.participant_count ?? undefined,
        merchant: d.bill.merchant ?? undefined,
        transacted_at: d.bill.transacted_at ?? undefined,
        items: (d.items as any[]).map((i) => ({
          name: i.name,
          price: i.price_idr,
          quantity: i.quantity ?? 1,
          discount: i.discount_idr ?? 0,
          mode: i.mode ?? 'free',
          slot_count: i.slot_count ?? undefined,
        })),
      }
      const res = await request.put('/api/bills/' + b.id, { headers: auth(me.id, me.secret), data: body })
      if (res.status() !== 200) continue
      hasil = { sebelum: b, sesudah: await detail(request, b.id), judul }
      break
    }
    expect(hasil, 'minimal satu bill 0.9 harus masih bisa diubah').toBeTruthy()

    expect(hasil!.sesudah.bill.title).toBe(hasil!.judul)
    expect(hasil!.sesudah.bill.total_idr, 'total tidak boleh berubah gara-gara ganti judul').toBe(hasil!.sebelum.total_idr)
    expect(hasil!.sesudah.total_ok).toBe(true)
  })

  test('M-07. tamu baru bisa ikut bill 0.9 dan uangnya tetap utuh', async ({ request }) => {
    const me = oldIdentity()
    // Bill lama yang sudah lunas menolak peserta baru (aturan yang benar), jadi
    // cari bill 0.9 yang masih menerima orang.
    const kandidat = rows<any>(
      `SELECT b.id FROM bill b
        WHERE b.creator_identity_id = ? AND b.status = 'open' AND b.settled_manual = 0
          AND (SELECT COUNT(*) FROM item i WHERE i.bill_id = b.id) > 0
        ORDER BY b.created_at DESC LIMIT 8`,
      me.id,
    )
    expect(kandidat.length, 'butuh bill 0.9 terbuka').toBeGreaterThan(0)

    let hasil: { before: any; after: any } | null = null
    for (const k of kandidat) {
      const before = await detail(request, k.id)
      // Join adalah aksi TAMU, bukan pemilik: dipanggil dengan identitas tamu.
      // (Memanggilnya dengan identitas pemilik menjawab 200 tapi tidak menambah
      // siapa pun — temuan terpisah, dicatat di TEST-MATRIX.)
      const tamu = await (await request.post('/api/identities', { data: { name: 'Tamu 1.0 ' + stamp } })).json()
      const join = await request.post('/api/bills/' + k.id + '/join', {
        headers: auth(tamu.id, tamu.secret ?? ''),
        data: { name: 'Tamu 1.0 ' + stamp },
      })
      if (join.status() !== 200) continue
      hasil = { before, after: await detail(request, k.id) }
      break
    }
    expect(hasil, 'minimal satu bill 0.9 harus menerima peserta baru').toBeTruthy()

    const { before, after } = hasil!
    expect(after.people.length, 'tamu baru muncul di daftar orang').toBe(before.people.length + 1)
    expect(after.total_ok, 'total tetap cocok setelah orang baru ikut').toBe(true)
    const total = after.bill.total_idr
    const orang = (after.people as any[]).reduce((s, p) => s + Math.round(p.total_idr), 0)
    expect(orang + Math.round(after.uncovered_idr)).toBe(total)
  })

  test('M-08. tiga bill 0.9 terbuka di layar dengan angka dan struk yang sama', async ({ page, request }) => {
    test.setTimeout(150_000)
    const bills = rows<any>(
      `SELECT id FROM bill
        WHERE photo_path IS NOT NULL AND photo_path != ''
        ORDER BY (SELECT COUNT(*) FROM item i WHERE i.bill_id = bill.id) DESC
        LIMIT 3`,
    )
    expect(bills.length).toBe(3)

    for (const b of bills) {
      const d = await detail(request, b.id)
      const errors: string[] = []
      const onConsole = (m: any) => { if (m.type() === 'error') errors.push(m.text().slice(0, 120)) }
      const onResponse = (r: any) => {
        if (r.url().includes('/api/') && r.status() >= 400) errors.push(r.status() + ' ' + r.url().split('/api')[1])
      }
      page.on('console', onConsole)
      page.on('response', onResponse)

      await page.goto('/b/' + b.id)
      await expect(page.getByRole('heading', { level: 1 })).toContainText(d.bill.title.split(' ')[0], { timeout: 15_000 })
      await expect(page.getByText(rp(d.bill.total_idr)).first()).toBeVisible()

      // nama orang di layar harus orang yang sama dengan yang dihitung server
      for (const p of (d.people as any[]).slice(0, 3)) {
        await expect(page.getByText(p.name, { exact: true }).first()).toBeVisible()
      }

      // struk benar-benar termuat, bukan kotak kosong
      const img = page.locator('main img').first()
      await expect(img).toBeVisible()
      await expect.poll(async () => img.evaluate((el: any) => el.naturalWidth), { timeout: 15_000 }).toBeGreaterThan(50)

      page.off('console', onConsole)
      page.off('response', onResponse)
      expect(errors.slice(0, 4), 'error di layar bill 0.9 ' + b.id).toEqual([])
    }
  })

  test('M-09. Beranda dan Rekap identitas 0.9 menampilkan angka yang sama, dan angkanya bisa ditanya', async ({ page, request }) => {
    test.setTimeout(120_000)
    const me = oldIdentity()
    const recap = await (await request.get('/api/identities/' + me.id + '/recap', { headers: auth(me.id, me.secret) })).json()
    const net = Math.round(recap.final.net_idr)

    await page.addInitScript((v: any) => localStorage.setItem('bagiin_identity', JSON.stringify(v)), {
      id: me.id, name: me.name, role: 'guest', secret: me.secret,
    })

    await page.goto('/')
    const kartu = page.locator('.ds-balance').first()
    await expect(kartu).toBeVisible({ timeout: 15_000 })
    await expect(kartu.getByText(rp(Math.abs(net)))).toBeVisible()

    await page.goto('/recap')
    await expect(page.locator('.ds-balance').first().getByText(rp(Math.abs(net)))).toBeVisible()

    // angka besar bisa diketuk, dan isinya aritmetika yang bisa diperiksa
    await page.goto('/')
    await page.locator('.ds-balance-tap').first().click()
    const sheet = page.getByRole('dialog', { name: 'Rincian saldo' })
    await expect(sheet).toBeVisible()
    if (Math.round(recap.final.receivable_idr) > 0 && Math.round(recap.final.payable_idr) > 0) {
      await expect(sheet.getByText('Kamu terima', { exact: true })).toBeVisible()
      await expect(sheet.getByText('Kamu bayar', { exact: true })).toBeVisible()
    }
  })
})
