import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5199',
    viewport: { width: 390, height: 844 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    permissions: ['clipboard-read', 'clipboard-write'],
  },
  projects: [{ name: 'mobile-chrome', use: { ...devices['Pixel 7'] , viewport: { width: 390, height: 844 } } }],
  /**
   * Server dev dinyalakan sendiri kalau belum ada. Sebelumnya suite berjalan
   * dengan asumsi port 5199 sudah hidup: begitu prosesnya mati, seluruh tes
   * gagal dengan ERR_CONNECTION_REFUSED dan terlihat seperti aplikasi rusak.
   * reuseExistingServer menjaga server yang sudah jalan tetap dipakai, jadi
   * tidak ada dua Vite yang berebut port.
   */
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:5199',
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
