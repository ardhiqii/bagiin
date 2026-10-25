import { test, expect, type Page } from '@playwright/test'

const stamp = Date.now().toString().slice(-6)

async function freshUser(page: Page, name: string) {
  await page.goto('/')
  if (await page.getByText('Kenalan dulu').count()) {
    await page.getByLabel('Nama kamu').fill(name)
    await page.getByRole('button', { name: 'Simpan nama' }).click()
    await expect(page.getByRole('heading', { level: 1 })).toContainText(name)
  }
}

/** Bill dengan satu item yang dibagi rata jadi N slot. */
async function createSlotBill(page: Page, title: string, slots: string, price = '60000') {
  await page.goto('/create')
  await page.getByLabel('Nama bill').fill(title)
  await page.getByLabel('Item 1').fill('Pizza besar')
  await page.getByLabel('Harga satuan').fill(price)
  await page.getByLabel('Jumlah slot baris 1').fill(slots)
  await page.getByRole('button', { name: 'Buat bill' }).click()
  await expect(page).toHaveURL(/\/b\//)
  return page.url()
}

test.describe('Bagiin — item yang dibagi slot', () => {
  test('26. item 4 slot dibagi rata, satu orang bisa ambil dua slot', async ({ page }) => {
    await freshUser(page, 'Aufa')
    await createSlotBill(page, 'Pizza ' + stamp, '4')

    // 60.000 / 4 slot = 15.000 per slot
    await expect(page.getByText(/4 slot · Rp15\.000\/slot · sisa 4/)).toBeVisible()

    await page.getByRole('button', { name: 'Tambah slot Pizza besar' }).click()
    await expect(page.getByText(/bagian kamu Rp15\.000/)).toBeVisible()

    await page.getByRole('button', { name: 'Tambah slot Pizza besar' }).click()
    await expect(page.getByText(/bagian kamu Rp30\.000/)).toBeVisible()
    await expect(page.getByText(/sisa 2/)).toBeVisible()
  })

  test('27. dua orang mengisi slot yang sama sampai penuh', async ({ page, browser }) => {
    await freshUser(page, 'Aufa')
    const url = await createSlotBill(page, 'Pizza bareng ' + stamp, '4')

    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const guest = await ctx.newPage()
    await freshUser(guest, 'Bima')
    await guest.goto(url)
    await guest.getByRole('button', { name: 'Ikut bill ini' }).click()

    await guest.getByRole('button', { name: 'Tambah slot Pizza besar' }).click()
    await guest.getByRole('button', { name: 'Tambah slot Pizza besar' }).click()
    await expect(guest.getByText(/bagian kamu Rp30\.000/)).toBeVisible()

    // sisa 2 slot tidak bisa diambil lagi kalau sudah penuh dari sisi saya
    await page.getByRole('button', { name: 'Tambah slot Pizza besar' }).click()
    await page.getByRole('button', { name: 'Tambah slot Pizza besar' }).click()
    await expect(page.getByText(/sisa 0/)).toBeVisible()

    // penuh: tombol tambah mati
    await expect(page.getByRole('button', { name: 'Tambah slot Pizza besar' })).toBeDisabled()
    await ctx.close()
  })

  test('28. pemilik mengubah jumlah slot, porsi per slot ikut berubah', async ({ page }) => {
    await freshUser(page, 'Aufa')
    await createSlotBill(page, 'Pizza ubah ' + stamp, '4')

    await page.getByRole('button', { name: 'Atur jumlah slot' }).click()
    const dialog = page.getByRole('dialog', { name: 'Atur jumlah slot' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Tambah jumlah slot Pizza besar' }).click()
    await expect(page.getByText('Slot Pizza besar jadi 5')).toBeVisible()

    await page.getByRole('dialog', { name: 'Atur jumlah slot' }).getByRole('button', { name: 'Tutup' }).click().catch(() => {})
    await page.keyboard.press('Escape')

    // 60.000 / 5 = 12.000 per slot
    await expect(page.getByText(/5 slot · Rp12\.000\/slot/)).toBeVisible()
  })

  test('29. slot tidak bisa dikurangi di bawah yang sudah diambil', async ({ page, browser }) => {
    await freshUser(page, 'Aufa')
    const url = await createSlotBill(page, 'Pizza kunci ' + stamp, '4')

    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const guest = await ctx.newPage()
    await freshUser(guest, 'Bima')
    await guest.goto(url)
    await guest.getByRole('button', { name: 'Ikut bill ini' }).click()
    await guest.getByRole('button', { name: 'Tambah slot Pizza besar' }).click()
    await guest.getByRole('button', { name: 'Tambah slot Pizza besar' }).click()
    await expect(guest.getByText(/bagian kamu Rp30\.000/)).toBeVisible()

    await page.reload()
    await page.getByRole('button', { name: 'Atur jumlah slot' }).click()
    const dialog = page.getByRole('dialog', { name: 'Atur jumlah slot' })
    // sudah 2 slot terisi → tombol kurang berhenti di 2
    await dialog.getByRole('button', { name: 'Kurangi jumlah slot Pizza besar' }).click()
    await expect(page.getByText('Slot Pizza besar jadi 3')).toBeVisible()
    await dialog.getByRole('button', { name: 'Kurangi jumlah slot Pizza besar' }).click()
    await expect(page.getByText('Slot Pizza besar jadi 2')).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Kurangi jumlah slot Pizza besar' })).toBeDisabled()
    await ctx.close()
  })
})
