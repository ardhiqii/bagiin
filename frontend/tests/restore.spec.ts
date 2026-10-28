import { test, expect } from '@playwright/test'

const stamp = Date.now().toString().slice(-6)

/** Bikin identitas lewat API, pasang kode pemulihan, kembalikan kodenya. */
async function identityWithCode(page: import('@playwright/test').Page, name: string, code: string) {
  const created = await page.request.post('/api/identities', { data: { name } })
  const ident = await created.json()
  await page.request.post('/api/identities/' + ident.id + '/code', {
    headers: { 'X-Identity-Id': ident.id, 'X-Identity-Secret': ident.secret },
    data: { code },
  })
  return ident
}

test.describe('Bagiin — masuk di perangkat lain', () => {
  test('43. kode pemulihan memindahkan akun ke perangkat baru', async ({ page, browser }) => {
    const name = 'Pindah HP ' + stamp
    const code = 'KODE' + stamp + 'QZ'
    const ident = await identityWithCode(page, name, code)

    // perangkat baru: tidak ada identitas di localStorage
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const phone = await ctx.newPage()
    await phone.goto('/masuk')
    await phone.getByLabel('Kode pemulihan').fill(code)
    await phone.getByRole('button', { name: 'Masuk', exact: true }).click()

    await expect(phone.getByText('Masuk sebagai ' + name)).toBeVisible()
    // identitas yang tersimpan harus identitas lama, bukan identitas baru
    const stored = await phone.evaluate(() => JSON.parse(localStorage.getItem('bagiin_identity') || '{}'))
    expect(stored.id).toBe(ident.id)
    await ctx.close()
  })

  test('44. kode salah ditolak dengan pesan yang jelas', async ({ page, browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const phone = await ctx.newPage()
    await phone.goto('/masuk')
    await phone.getByLabel('Kode pemulihan').fill('KODE-SALAH-999')
    await phone.getByRole('button', { name: 'Masuk', exact: true }).click()
    await expect(phone.getByText(/Kode tidak dikenal/)).toBeVisible()
    const stored = await phone.evaluate(() => localStorage.getItem('bagiin_identity'))
    expect(stored).toBeNull()
    await ctx.close()
  })

  test('45. pengaturan bisa membuat kode pemulihan baru', async ({ page }) => {
    const ident = await page.request.post('/api/identities', { data: { name: 'Kode Baru ' + stamp } })
    const me = await ident.json()
    await page.addInitScript(
      ([identity]) => localStorage.setItem('bagiin_identity', identity),
      [JSON.stringify(me)] as const,
    )
    await page.goto('/settings')
    await page.getByRole('button', { name: 'Buat kode pemulihan' }).click()
    const code = page.locator('.recovery-code code')
    await expect(code).toBeVisible()
    await expect(code).toHaveText(/^[A-Z0-9-]{8,}$/)
  })
})
