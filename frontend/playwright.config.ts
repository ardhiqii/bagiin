import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  /**
   * 60 s, bukan 45: tes yang memakai empat konteks browser (empat orang di satu
   * bill) butuh 34 s hanya untuk alur normalnya. Batas 45 s membuat tes yang
   * benar sesekali gagal karena lambat, dan kegagalan seperti itu mengaburkan
   * kegagalan yang sungguhan.
   */
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5199',
    viewport: { width: 390, height: 844 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'mobile-chrome',
      use: {
        ...devices['Pixel 7'],
        viewport: { width: 390, height: 844 },
        /* WebKit menolak nama izin ini dan menggagalkan seluruh konteks, jadi
           izin clipboard hanya diberikan di jalur Chromium. */
        permissions: ['clipboard-read', 'clipboard-write'],
      },
    },
    /* Jalur kedua: WebKit, mesin yang dipakai Safari. Bukan hiasan — bug sheet
       yang dilaporkan di iPhone 15 tidak muncul sama sekali di Chromium, karena
       `position: fixed` di dalam wadah `-webkit-overflow-scrolling: touch`
       terkurung di iOS. Tanpa proyek ini, seluruh suite hijau sementara Safari
       rusak. */
    { name: 'mobile-safari', use: { ...devices['iPhone 15'] } },
  ],
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
