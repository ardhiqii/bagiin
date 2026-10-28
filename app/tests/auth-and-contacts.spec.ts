import { test, expect, type Page } from '@playwright/test'

const stamp = Date.now().toString().slice(-6)

/* ------------------------------------------------------------------ helpers */

type Ident = { id: string; name: string; secret?: string | null }
type Session = { identity: Ident; token: string; recovery_code?: string }

async function registerViaApi(
  page: Page,
  input: { username: string; password: string; name: string },
): Promise<Session> {
  const res = await page.request.post('/api/auth/register', { data: input })
  expect(res.ok(), 'register via API').toBeTruthy()
  return res.json()
}

async function loginViaApi(page: Page, username: string, password: string): Promise<Session> {
  const res = await page.request.post('/api/auth/login', { data: { username, password } })
  expect(res.ok()).toBeTruthy()
  return res.json()
}

function headers(session: { identity?: Ident; token?: string }) {
  return {
    'X-Identity-Id': session.identity?.id ?? '',
    'X-Identity-Secret': session.token ?? session.identity?.secret ?? '',
  }
}

/**
 * Pasang sesi langsung di localStorage lalu buka satu layar.
 *
 * Guard "hanya kalau kosong" itu penting: addInitScript jalan di SETIAP muat
 * halaman. Tanpa guard, setelah layar ini login ulang dan aplikasi menyimpan
 * token baru, muat ulang berikutnya menimpa token baru dengan token lama yang
 * sudah dicabut — dan tes gagal seolah aplikasinya salah.
 */
async function openAs(page: Page, session: Session, path = '/') {
  const stored = {
    id: session.identity.id,
    name: session.identity.name,
    role: 'creator',
    secret: session.token,
  }
  await page.addInitScript(
    ([value]) => {
      if (!localStorage.getItem('bagiin_identity')) localStorage.setItem('bagiin_identity', value)
    },
    [JSON.stringify(stored)] as const,
  )
  await page.goto(path)
}

/** Bill baru milik `owner` berisi satu item, plus tamu opsional yang ikut. */
async function createBill(
  page: Page,
  owner: Session,
  title: string,
  guest?: Session,
): Promise<string> {
  const res = await page.request.post('/api/bills', {
    headers: headers(owner),
    data: {
      title,
      items: [{ name: 'Kopi', price: 20000, quantity: 1 }],
      subtotal: 20000,
      total: 20000,
    },
  })
  expect(res.ok()).toBeTruthy()
  const bill = await res.json()
  if (guest) {
    const joined = await page.request.post(`/api/bills/${bill.id}/join`, {
      headers: headers(guest),
      data: {},
    })
    expect(joined.ok()).toBeTruthy()
  }
  return bill.id
}

async function stubMode(page: Page): Promise<boolean> {
  const res = await page.request.get('/api/auth/config')
  if (!res.ok()) return false
  const config = await res.json()
  return Boolean(config.google_stub)
}

async function googleLoginViaApi(page: Page, sub: string, name: string): Promise<Session> {
  const res = await page.request.post('/api/auth/google', {
    data: { id_token: `stub:${sub}:${sub}@example.com:${name}`, mode: 'login' },
  })
  expect(res.ok()).toBeTruthy()
  return res.json()
}

/* -------------------------------------------------------------------- akun */

test.describe('Bagiin — akun dan sesi perangkat', () => {
  test('101. daftar akun: kode pemulihan tampil sekali, sesi bertahan setelah muat ulang', async ({ page }) => {
    const username = 'daftar_' + stamp
    await page.goto('/masuk')
    await page.getByRole('tab', { name: 'Akun' }).click()
    await page.getByRole('button', { name: /Belum punya akun/ }).click()
    await page.getByLabel('Nama kamu').fill('Daftar ' + stamp)
    await page.getByLabel('Username').fill(username)
    await page.getByLabel('Password').fill('rahasia123')
    await page.getByRole('button', { name: 'Buat akun' }).click()

    // kode pemulihan wajib tampil sebelum orang boleh lanjut
    const code = page.locator('.recovery-code code')
    await expect(code).toBeVisible()
    await expect(code).toHaveText(/^[A-Z0-9-]{8,}$/)
    await page.getByRole('button', { name: /Sudah kusimpan/ }).click()
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Halo')

    // sesi bertahan setelah muat ulang: token perangkat, bukan state di memori
    await page.reload()
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Halo')
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('bagiin_identity') || '{}'))
    expect(stored.secret, 'token perangkat disimpan').toBeTruthy()
  })

  test('102. keluar lalu masuk lagi dengan username dan password: bill tetap di tempatnya', async ({ page }) => {
    const session = await registerViaApi(page, {
      username: 'ulang_' + stamp,
      password: 'rahasia123',
      name: 'Ulang ' + stamp,
    })
    const billId = await createBill(page, session, 'Bill Ulang ' + stamp)

    await openAs(page, session, '/settings')
    await page.getByRole('button', { name: /Keluar dari akun ini/ }).click()
    await expect(page).toHaveURL(/\/$/)
    expect(await page.evaluate(() => localStorage.getItem('bagiin_identity'))).toBeNull()

    // masuk lewat layar, bukan lewat localStorage
    await page.goto('/masuk')
    await page.getByRole('tab', { name: 'Akun' }).click()
    await page.getByLabel('Username').fill('ulang_' + stamp)
    await page.getByLabel('Password').fill('rahasia123')
    await page.getByRole('button', { name: 'Masuk', exact: true }).click()
    // setelah masuk, aplikasi menghormati halaman yang tadi dituju (di sini
    // /settings yang tersimpan sebagai intent) — bukan selalu melempar ke beranda
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Pengaturan|Halo/)
    const storedId = await page.evaluate(
      () => JSON.parse(localStorage.getItem('bagiin_identity') || '{}').id,
    )
    expect(storedId, 'masuk lagi memakai identitas yang sama').toBe(session.identity.id)

    const again = await loginViaApi(page, 'ulang_' + stamp, 'rahasia123')
    expect(again.identity.id).toBe(session.identity.id)
    const bill = await page.request.get(`/api/bills/${billId}`, { headers: headers(again) })
    expect(bill.ok()).toBeTruthy()
  })

  test('103. password salah dan username tak dikenal memberi kalimat yang sama', async ({ page }) => {
    await registerViaApi(page, {
      username: 'pesan_' + stamp,
      password: 'rahasia123',
      name: 'Pesan ' + stamp,
    })
    await page.goto('/masuk')
    await page.getByRole('tab', { name: 'Akun' }).click()

    await page.getByLabel('Username').fill('pesan_' + stamp)
    await page.getByLabel('Password').fill('password-salah')
    await page.getByRole('button', { name: 'Masuk', exact: true }).click()
    const wrongPassword = await page.locator('.ds-field-error').innerText()

    await page.getByLabel('Username').fill('tidak_ada_' + stamp)
    await page.getByLabel('Password').fill('password-salah')
    await page.getByRole('button', { name: 'Masuk', exact: true }).click()
    const unknownUser = await page.locator('.ds-field-error').innerText()

    expect(wrongPassword).toContain('Username atau password salah')
    expect(unknownUser).toBe(wrongPassword)
  })

  test('104. username yang sudah dipakai ditolak dengan penjelasan, bukan diam', async ({ page }) => {
    const username = 'dipakai_' + stamp
    await registerViaApi(page, { username, password: 'rahasia123', name: 'Pemilik ' + stamp })

    await page.goto('/masuk')
    await page.getByRole('tab', { name: 'Akun' }).click()
    await page.getByRole('button', { name: /Belum punya akun/ }).click()
    await page.getByLabel('Nama kamu').fill('Penyusup ' + stamp)
    await page.getByLabel('Username').fill(username)
    await page.getByLabel('Password').fill('rahasia123')
    await page.getByRole('button', { name: 'Buat akun' }).click()

    await expect(page.getByText(/sudah dipakai orang lain/i)).toBeVisible()
    // tetap di layar daftar: yang salah cuma username, bukan seluruh isian
    await expect(page.getByRole('button', { name: 'Buat akun' })).toBeVisible()
  })

  test('105. password pendek ditolak sebelum akun dibuat', async ({ page }) => {
    await page.goto('/masuk')
    await page.getByRole('tab', { name: 'Akun' }).click()
    await page.getByRole('button', { name: /Belum punya akun/ }).click()
    await page.getByLabel('Nama kamu').fill('Pendek ' + stamp)
    await page.getByLabel('Username').fill('pendek_' + stamp)
    await page.getByLabel('Password').fill('123')
    await page.getByRole('button', { name: 'Buat akun' }).click()
    await expect(page.getByText(/minimal 8 karakter/i)).toBeVisible()
  })

  test('106. username disaring saat diketik: huruf besar, spasi, dan simbol tidak lolos', async ({ page }) => {
    await page.goto('/masuk')
    await page.getByRole('tab', { name: 'Akun' }).click()
    const field = page.getByLabel('Username')
    await field.fill('Aufa Besar!@#')
    await expect(field).toHaveValue('aufabesar')
  })

  test('107. ganti username: yang sudah dipakai orang lain ditolak, yang bebas disimpan', async ({ page }) => {
    const taken = 'sudah_' + stamp
    await registerViaApi(page, { username: taken, password: 'rahasia123', name: 'Sudah ' + stamp })
    const mine = await registerViaApi(page, {
      username: 'punya_' + stamp,
      password: 'rahasia123',
      name: 'Punya ' + stamp,
    })

    await openAs(page, mine, '/settings')
    await page.getByRole('button', { name: /^Username/ }).first().click()
    await page.getByLabel('Username baru').fill(taken)
    await page.getByRole('button', { name: 'Simpan username' }).click()
    await expect(page.getByText(/sudah dipakai orang lain/i)).toBeVisible()

    await page.getByLabel('Username baru').fill('baru_' + stamp)
    await page.getByRole('button', { name: 'Simpan username' }).click()
    await expect(page.getByText('Username disimpan')).toBeVisible()
  })

  test('108. ganti password mengeluarkan perangkat lain, perangkat ini tetap masuk', async ({ page, browser }) => {
    test.setTimeout(120_000)
    const session = await registerViaApi(page, {
      username: 'ganti_' + stamp,
      password: 'rahasia123',
      name: 'Ganti ' + stamp,
    })

    // perangkat kedua dengan sesi sendiri
    const second = await loginViaApi(page, 'ganti_' + stamp, 'rahasia123')
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const phone = await ctx.newPage()
    await openAs(phone, second, '/settings')
    await expect(phone.getByRole('heading', { level: 1 })).toContainText('Pengaturan')

    await openAs(page, session, '/settings')
    await page.getByRole('button', { name: /^Password/ }).first().click()
    await page.getByLabel('Password sekarang').fill('rahasia123')
    await page.getByLabel('Password baru', { exact: true }).fill('rahasia456')
    await page.getByLabel('Ulangi password baru').fill('rahasia456')
    await page.getByRole('button', { name: 'Simpan password' }).click()
    await expect(page.getByText('Password disimpan')).toBeVisible()

    // perangkat kedua: sesi lama harus mati, bukan cuma "dikatakan" mati
    const probe = await page.request.get('/api/auth/state', { headers: headers(second) })
    expect(probe.status(), 'sesi perangkat lain dicabut').toBe(403)
    await ctx.close()
  })

  test('109. kode pemulihan tetap bisa dipakai walau sudah punya password', async ({ page, browser }) => {
    const session = await registerViaApi(page, {
      username: 'cadangan_' + stamp,
      password: 'rahasia123',
      name: 'Cadangan ' + stamp,
    })
    expect(session.recovery_code).toBeTruthy()

    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const phone = await ctx.newPage()
    await phone.goto('/masuk')
    await phone.getByLabel('Kode pemulihan').fill(session.recovery_code as string)
    await phone.getByRole('button', { name: 'Masuk', exact: true }).click()
    await expect(phone.getByText('Masuk sebagai Cadangan ' + stamp)).toBeVisible()
    const stored = await phone.evaluate(() => JSON.parse(localStorage.getItem('bagiin_identity') || '{}'))
    expect(stored.id).toBe(session.identity.id)
    await ctx.close()
  })

  test('110. daftar perangkat: perangkat ini ditandai, yang lain bisa dikeluarkan', async ({ page }) => {
    test.setTimeout(120_000)
    const session = await registerViaApi(page, {
      username: 'devices_' + stamp,
      password: 'rahasia123',
      name: 'Devices ' + stamp,
    })
    const other = await loginViaApi(page, 'devices_' + stamp, 'rahasia123')

    await openAs(page, session, '/settings')
    await expect(page.locator('.app-row', { hasText: 'Ini perangkat ini' })).toBeVisible()

    const kick = page.getByRole('button', { name: 'Keluarkan' }).first()
    await expect(kick).toBeVisible()
    await kick.click()
    await expect(page.getByText('Perangkat dikeluarkan')).toBeVisible()

    const probe = await page.request.get('/api/auth/state', { headers: headers(other) })
    expect(probe.status()).toBe(403)
  })
})

/* ------------------------------------------------------------------ google */

test.describe('Bagiin — masuk dengan Google', () => {
  test('111. akun Google baru: identitas dibuat, kode pemulihan tampil, lalu masuk', async ({ page }) => {
    test.skip(!(await stubMode(page)), 'Server tidak menjalankan mode uji Google')
    const sub = 'google-baru-' + stamp
    await page.goto('/masuk')
    await page.getByRole('button', { name: /Lanjut dengan Google \(mode uji\)/ }).click()

    const code = page.locator('.recovery-code code')
    await expect(code).toBeVisible()
    await page.getByRole('button', { name: /Sudah kusimpan/ }).click()
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Halo')

    // sub yang sama tidak membuat identitas baru
    const first = await googleLoginViaApi(page, sub, 'Google Baru ' + stamp)
    const second = await googleLoginViaApi(page, sub, 'Google Baru ' + stamp)
    expect(second.identity.id).toBe(first.identity.id)
  })

  test('112. tautkan Google dari Pengaturan', async ({ page }) => {
    test.skip(!(await stubMode(page)), 'Server tidak menjalankan mode uji Google')
    const session = await registerViaApi(page, {
      username: 'taut_' + stamp,
      password: 'rahasia123',
      name: 'Taut ' + stamp,
    })

    await openAs(page, session, '/settings')
    await page.getByRole('button', { name: /^Google/ }).first().click()
    await page.getByRole('button', { name: /Tautkan Google \(mode uji\)/ }).click()
    await expect(page.getByText('Akun Google tertaut')).toBeVisible()

    const state = await page.request.get('/api/auth/state', { headers: headers(session) })
    expect((await state.json()).google.linked).toBe(true)
  })

  test('113. melepas Google ditolak kalau tidak ada cara masuk lain yang tersisa', async ({ page }) => {
    test.skip(!(await stubMode(page)), 'Server tidak menjalankan mode uji Google')
    // identitas tanpa password dan tanpa kode pemulihan, hanya Google
    const created = await page.request.post('/api/identities', { data: { name: 'Cuma Google ' + stamp } })
    const ident = await created.json()
    const linked = await page.request.post('/api/auth/google', {
      headers: { 'X-Identity-Id': ident.id, 'X-Identity-Secret': ident.secret },
      data: { id_token: `stub:solo-${stamp}:solo@example.com:Solo`, mode: 'link' },
    })
    expect(linked.ok()).toBeTruthy()

    const unlink = await page.request.post('/api/auth/google/unlink', {
      headers: { 'X-Identity-Id': ident.id, 'X-Identity-Secret': ident.secret },
    })
    expect(unlink.status()).toBe(400)
    expect((await unlink.json()).detail).toMatch(/kode pemulihan|password/i)
  })
})

/* ------------------------------------------------------------------ kontak */

test.describe('Bagiin — nama pembeda kontak', () => {
  test('114. kontak menyebut pembeda dan konteks, bukan cuma nama', async ({ page }) => {
    const me = await registerViaApi(page, {
      username: 'kontak_' + stamp,
      password: 'rahasia123',
      name: 'Kontak ' + stamp,
    })
    const friend = await registerViaApi(page, {
      username: 'teman_' + stamp,
      password: 'rahasia123',
      name: 'Teman ' + stamp,
    })
    await createBill(page, me, 'Warung ' + stamp, friend)

    await openAs(page, me, '/kontak')
    const row = page.locator('.app-row.is-tappable', { hasText: 'Teman ' + stamp })
    await expect(row).toBeVisible()
    await expect(row).toContainText('@teman_' + stamp)
    await expect(row).toContainText('1 bill')
    await expect(row).toContainText('Warung ' + stamp)
  })

  test('115. nama pembeda muncul untuk saya, tidak untuk orang lain', async ({ page, browser }) => {
    test.setTimeout(120_000)
    const me = await registerViaApi(page, {
      username: 'alias_' + stamp,
      password: 'rahasia123',
      name: 'Alias ' + stamp,
    })
    const friend = await registerViaApi(page, {
      username: 'kenalan_' + stamp,
      password: 'rahasia123',
      name: 'Kenalan ' + stamp,
    })
    const billId = await createBill(page, me, 'Bakso ' + stamp, friend)

    await openAs(page, me, '/kontak')
    await page.locator('.app-row.is-tappable', { hasText: 'Kenalan ' + stamp }).click()
    await page.getByLabel('Kamu mengenalnya sebagai').fill('Kenalan Kampus')
    await page.getByRole('button', { name: 'Simpan nama' }).click()
    await expect(page.getByText('Nama pembeda disimpan')).toBeVisible()

    // di layar bill: nama pembeda dipakai untuk saya
    await page.goto('/b/' + billId)
    await expect(page.getByText('Kenalan Kampus').first()).toBeVisible()

    // orang lain melihat nama asli, bukan nama yang saya karang
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const outsider = await ctx.newPage()
    await openAs(outsider, friend, '/b/' + billId)
    await expect(outsider.getByText('Kenalan ' + stamp).first()).toBeVisible()
    expect(await outsider.getByText('Kenalan Kampus').count()).toBe(0)
    await ctx.close()
  })

  test('116. dua kontak tidak boleh memakai nama pembeda yang sama', async ({ page }) => {
    const me = await registerViaApi(page, {
      username: 'dobel_' + stamp,
      password: 'rahasia123',
      name: 'Dobel ' + stamp,
    })
    const a = await registerViaApi(page, {
      username: 'kembar_a_' + stamp,
      password: 'rahasia123',
      name: 'Kembar ' + stamp,
    })
    const b = await registerViaApi(page, {
      username: 'kembar_b_' + stamp,
      password: 'rahasia123',
      name: 'Kembar ' + stamp,
    })
    await createBill(page, me, 'Sate ' + stamp, a)
    await createBill(page, me, 'Soto ' + stamp, b)

    const first = await page.request.put(`/api/identities/${me.identity.id}/contacts/${a.identity.id}/alias`, {
      headers: headers(me),
      data: { alias: 'Kembar Warkop' },
    })
    expect(first.ok()).toBeTruthy()
    const second = await page.request.put(`/api/identities/${me.identity.id}/contacts/${b.identity.id}/alias`, {
      headers: headers(me),
      data: { alias: 'kembar warkop' },
    })
    expect(second.status()).toBe(400)
    expect((await second.json()).detail).toMatch(/sudah kamu pakai/i)
  })

  test('117. menghapus nama pembeda mengembalikan nama asli', async ({ page }) => {
    const me = await registerViaApi(page, {
      username: 'hapus_' + stamp,
      password: 'rahasia123',
      name: 'Hapus ' + stamp,
    })
    const friend = await registerViaApi(page, {
      username: 'sahabat_' + stamp,
      password: 'rahasia123',
      name: 'Sahabat ' + stamp,
    })
    await createBill(page, me, 'Nasi ' + stamp, friend)

    await openAs(page, me, '/kontak')
    await page.locator('.app-row.is-tappable', { hasText: 'Sahabat ' + stamp }).click()
    await page.getByLabel('Kamu mengenalnya sebagai').fill('Sahabat Lama')
    await page.getByRole('button', { name: 'Simpan nama' }).click()
    await expect(page.getByText('Nama pembeda disimpan')).toBeVisible()

    await page.locator('.app-row.is-tappable', { hasText: 'Sahabat Lama' }).click()
    await page.getByRole('button', { name: 'Hapus nama pembeda' }).click()
    await expect(page.getByText('Nama pembeda dihapus')).toBeVisible()
    await expect(page.locator('.app-row.is-tappable', { hasText: 'Sahabat ' + stamp })).toBeVisible()
  })

  test('118. nama sama tanpa pembeda memunculkan peringatan di daftar undangan', async ({ page }) => {
    test.setTimeout(120_000)
    const me = await registerViaApi(page, {
      username: 'kembar_' + stamp,
      password: 'rahasia123',
      name: 'Pemilik ' + stamp,
    })
    // dua orang bernama persis sama
    const a = await registerViaApi(page, {
      username: 'k1_' + stamp,
      password: 'rahasia123',
      name: 'Amel ' + stamp,
    })
    const b = await registerViaApi(page, {
      username: 'k2_' + stamp,
      password: 'rahasia123',
      name: 'Amel ' + stamp,
    })
    await createBill(page, me, 'Kopi Satu ' + stamp, a)
    const billId = await createBill(page, me, 'Kopi Dua ' + stamp, b)

    await openAs(page, me, '/b/' + billId)
    await page.getByRole('button', { name: /Aksi lain/ }).click()
    await page.getByRole('button', { name: /Undang teman/ }).click()

    await expect(page.getByText('Ada nama yang sama')).toBeVisible()
    // dua baris tetap bisa dibedakan: @username tampil
    await expect(page.getByText('@k1_' + stamp)).toBeVisible()
    await expect(page.getByText('@k2_' + stamp)).toBeVisible()
  })

  test('119. nama pembeda bisa dibuat langsung dari daftar undangan', async ({ page }) => {
    test.setTimeout(120_000)
    const me = await registerViaApi(page, {
      username: 'pensil_' + stamp,
      password: 'rahasia123',
      name: 'Pensil ' + stamp,
    })
    const friend = await registerViaApi(page, {
      username: 'kawan_' + stamp,
      password: 'rahasia123',
      name: 'Kawan ' + stamp,
    })
    const billId = await createBill(page, me, 'Pecel ' + stamp, friend)

    await openAs(page, me, '/b/' + billId)
    await page.getByRole('button', { name: /Aksi lain/ }).click()
    await page.getByRole('button', { name: /Undang teman/ }).click()
    await page.getByRole('button', { name: /Ganti nama pembeda Kawan/ }).click()
    await page.getByLabel('Kamu mengenalnya sebagai').fill('Kawan Kuliah')
    await page.getByRole('button', { name: 'Simpan nama' }).click()
    await expect(page.getByText('Nama pembeda disimpan')).toBeVisible()
    // baris undangan sudah memakai nama pembeda (dan baris peserta di belakang
    // sheet juga — itu sebabnya dicek di dalam sheet saja)
    await expect(
      page.getByRole('dialog', { name: 'Undang teman' }).getByText('Kawan Kuliah'),
    ).toBeVisible()
  })
})
