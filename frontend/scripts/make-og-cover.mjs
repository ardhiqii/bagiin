/**
 * og-cover.png versi mark baru (dua struk bertumpuk).
 *
 * Kenapa lewat Chromium dan bukan PIL: cover ini isinya tipografi — line-height,
 * tracking, dan optis huruf besar semuanya harus benar, dan itu satu baris CSS,
 * bukan tiga puluh hitungan pixel. Chromium juga memakai font aplikasi (Manrope),
 * jadi preview link tidak memakai typeface yang berbeda dari produknya.
 *
 * Kenapa tidak memakai aset ilustrasi .webp: aset itu sudah punya latar sendiri
 * (panel krem + blob mint), jadi menempelkannya ke cover selalu menyisakan kotak
 * yang kelihatan ditempel — dua latar bertumpuk, bukan satu komposisi. Sisi
 * kanan sekarang digambar langsung sebagai kartu bill: bentuk yang memang dipakai
 * aplikasi, jadi tidak ada gambar yang bisa "salah tempel".
 *
 * Jalankan: node scripts/make-og-cover.mjs
 */
import { chromium } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '../..') // repo root
const OUT = path.join(ROOT, 'frontend/public/og-cover.png')
const MARK = path.join(ROOT, 'frontend/public/logo.svg')

const mark = fs.readFileSync(MARK).toString('base64')

const html = `<!doctype html><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400..800&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{width:1200px;height:630px;background:#FBFAF6;font-family:Manrope,system-ui,sans-serif;
       -webkit-font-smoothing:antialiased;display:flex;align-items:center;justify-content:space-between;
       padding:0 84px 0 80px;position:relative;overflow:hidden;color:#142F3A}
  /* satu bidang mint di kanan sebagai penyeimbang, bukan gradien */
  .disc{position:absolute;right:-140px;top:-110px;width:660px;height:660px;border-radius:50%;background:#E2F5EF}
  .col{position:relative;z-index:2;max-width:610px}
  .brand{display:flex;align-items:center;gap:20px;margin-bottom:34px}
  .brand img{width:100px;height:100px;border-radius:24px}
  .brand b{font-size:54px;font-weight:800;letter-spacing:-.03em}
  h1{font-size:72px;line-height:1.07;font-weight:800;letter-spacing:-.035em}
  /* amber mark #C98A2E hanya 2,81:1 di atas kertas: cukup untuk bentuk, gagal
     untuk teks. Untuk huruf dipakai amber yang digelapkan (4,02:1). */
  h1 em{font-style:normal;color:#A8701F}
  p{margin-top:24px;font-size:32px;line-height:1.45;color:#415254;font-weight:600;max-width:560px}
  .url{margin-top:26px;font-size:31px;font-weight:800;color:#087665;letter-spacing:-.015em}

  /* Kartu bill: bentuk yang benar-benar ada di aplikasi (nama + bagiannya),
     digambar di sini, bukan aset yang ditempel. */
  /* Tanpa bayangan: bayangan blok di atas bentuk mint terbaca sebagai kotak abu
     yang ikut ditempel. Kartu dipisahkan dari latar oleh warna dan garis saja. */
  .stack{position:relative;z-index:2;width:392px}
  .bill{position:relative;background:#fff;border-radius:30px;padding:26px 26px 22px;
        border:1px solid #DCE5E3}
  .bill-head{display:flex;justify-content:space-between;align-items:baseline;
             font-size:15px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#8A9795}
  .total{font-size:30px;font-weight:800;letter-spacing:-.03em;color:#142F3A;margin:4px 0 20px}
  .row{display:flex;align-items:center;gap:14px;padding:11px 0;border-top:1px solid #EEF2F1}
  .av{width:40px;height:40px;border-radius:14px;display:flex;align-items:center;justify-content:center;
      font-size:17px;font-weight:800;background:#E6F2EF;color:#087665;flex:none}
  .nm{font-size:23px;font-weight:700;flex:1}
  .am{font-size:23px;font-weight:800;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
  .row.mine .av{background:#142F3A;color:#FBFAF6}
  .row.mine .am{color:#087665}
  .foot{margin-top:16px;padding-top:14px;border-top:1px solid #EEF2F1;
        font-size:17px;font-weight:600;color:#8A9795}
</style>
<div class="disc"></div>

<div class="col">
  <div class="brand">
    <img src="data:image/svg+xml;base64,${mark}">
    <b>Bagiin</b>
  </div>
  <h1>Bagi bill bareng,<br><em>tanpa ribet.</em></h1>
  <p>Foto struk, bagi tautannya,<br>semua pilih item masing-masing. Tanpa akun.</p>
  <div class="url">bagiin.ardhiqi.com</div>
</div>

<div class="stack">
  <div class="bill">
    <div class="bill-head"><span>Makan malam</span><span>31 Okt</span></div>
    <div class="total">Rp 245.000</div>
    <div class="row mine"><span class="av">A</span><span class="nm">Aufa</span><span class="am">Rp 81.667</span></div>
    <div class="row"><span class="av">B</span><span class="nm">Budi</span><span class="am">Rp 81.667</span></div>
    <div class="row"><span class="av">D</span><span class="nm">Dina</span><span class="am">Rp 81.666</span></div>
    <div class="foot">Pajak &amp; service terbagi otomatis</div>
  </div>
</div>
`

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 })
await page.setContent(html, { waitUntil: 'networkidle' })
await page.evaluate(() => document.fonts.ready)
await page.waitForTimeout(500)
await page.screenshot({ path: OUT, type: 'png' })
await browser.close()

const { size } = fs.statSync(OUT)
console.log(`og-cover.png 1200x630 · ${(size / 1024).toFixed(1)} KB`)
