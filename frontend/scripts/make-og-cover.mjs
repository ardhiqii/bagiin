/**
 * og-cover.png versi mark baru (dua struk bertumpuk).
 *
 * Kenapa lewat Chromium dan bukan PIL: cover ini isinya tipografi — line-height,
 * tracking, dan optis huruf besar semuanya harus benar, dan itu satu baris CSS,
 * bukan tiga puluh hitungan pixel. Chromium juga memakai font aplikasi (Manrope),
 * jadi preview link tidak memakai typeface yang berbeda dari produknya.
 *
 * Jalankan: node scripts/make-og-cover.mjs
 */
import { chromium } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '../..')   // repo root
const OUT = path.join(ROOT, 'frontend/public/og-cover.png')
const MARK = path.join(ROOT, 'frontend/public/logo.svg')
const ART = path.join(ROOT, 'frontend/src/assets/empty-bill.webp')

const mark = fs.readFileSync(MARK).toString('base64')
const art = fs.readFileSync(ART).toString('base64')

const html = `<!doctype html><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400..800&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{width:1200px;height:630px;background:#FBFAF6;font-family:Manrope,system-ui,sans-serif;
       -webkit-font-smoothing:antialiased;display:flex;align-items:center;justify-content:space-between;
       padding:0 72px 0 80px;position:relative;overflow:hidden;color:#142F3A}
  /* satu bidang mint di kanan sebagai penyeimbang, bukan gradien */
  .disc{position:absolute;right:-150px;top:-90px;width:640px;height:640px;border-radius:50%;background:#E2F5EF}
  .col{position:relative;z-index:2;max-width:640px}
  .brand{display:flex;align-items:center;gap:20px;margin-bottom:38px}
  .brand img{width:104px;height:104px;border-radius:24px}
  .brand b{font-size:56px;font-weight:800;letter-spacing:-.03em}
  h1{font-size:74px;line-height:1.06;font-weight:800;letter-spacing:-.035em}
  /* amber mark #C98A2E hanya ~2,9:1 di atas kertas: cukup untuk bentuk, tidak
     untuk teks. Untuk huruf dipakai amber yang digelapkan. */
  h1 em{font-style:normal;color:#A8701F}
  p{margin-top:26px;font-size:33px;line-height:1.45;color:#415254;font-weight:600;max-width:560px}
  .url{margin-top:32px;font-size:31px;font-weight:800;color:#087665;letter-spacing:-.015em}
  .art{position:relative;z-index:2;width:400px;height:400px;display:flex;align-items:center;justify-content:center}
  .art img{width:100%;height:100%;object-fit:contain;filter:drop-shadow(0 18px 0 rgba(20,47,58,.08))}
</style>
<div class="disc"></div>
<div class="col">
  <div class="brand">
    <img src="data:image/svg+xml;base64,${mark}">
    <b>Bagiin</b>
  </div>
  <h1>Bagi bill bareng,<br><em>tanpa ribet.</em></h1>
  <p>Foto struk, bagi tautannya, semua pilih item masing-masing. Tanpa akun.</p>
  <div class="url">bagiin.ardhiqi.com</div>
</div>
<div class="art"><img src="data:image/webp;base64,${art}"></div>
`

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 })
await page.setContent(html, { waitUntil: 'networkidle' })
await page.evaluate(() => document.fonts.ready)
await page.waitForTimeout(500)
await page.screenshot({ path: OUT, type: 'png' })
await browser.close()

const { size } = fs.statSync(OUT)
console.log(`og-cover.png ${1200}x630 · ${(size / 1024).toFixed(1)} KB`)
