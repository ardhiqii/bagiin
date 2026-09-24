# Bagiin - Product Spec

> App web mobile-first untuk split bill bareng. Foto struk -> OCR gratis -> share link ->
> orang milih item -> pajak otomatis -> tombol "udah bayar" + info rekening. Tanpa akun.
>
> Status: DRAFT (brainstorm, 2026-08-09). Belum ada kode.
> Nama: BAGIIN (keputusan user 2026-08-09, rename dari PATUNGAN).
> Domain: bagiin.ardhiqi.com (A record SUDAH ada, proxied, VPS IP 209.17.118.186).

---

## 1. Ringkas

Creator (yang fronting uang) foto struk, app baca otomatis (Gemini free tier, Rp 0),
creator verifikasi item + total, atur cara bagi pajak, share link ke grup WhatsApp.
Tiap orang buka link, masukin nama, centang item yang dia tanggung, langsung keliatan
total dia (item + porsi pajak). Tombol "udah bayar" + info rekening/e-money creator.
Semua kesimpen: history bill.

## 2. Tujuan & non-tujuan

### Tujuan
- Mobile-first, fokus enak dipake di HP (mayoritas Android mid-range, buka dari WhatsApp)
- Biaya operasional Rp 0 (OCR pake free tier)
- Tanpa akun, tanpa password. Cukup nama + localStorage
- Satu bill = satu link. Fokus: "bagi bill ini", bukan kelola utang piutang
- Transparan: tiap orang liat breakdown detail (item + pajak + total)

### Non-tujuan (v1)
- Balance/utang-piutang antar orang, minimal-transfer, simplify debt
- Integrasi payment gateway / QRIS / virtual account
- Grup/komunitas, multi-currency, recurring expense
- Auth penuh, email, notifikasi push

## 3. Alur inti (user stories)

### US-1 Creator bikin bill
1. Creator buka app -> ketik nama (sekali, kesimpen localStorage)
2. "Buat bill" -> foto struk (camera) atau upload gambar
3. OCR baca -> tampil list item + harga + PPN/service + total (verifikasi manual)
4. Creator edit kalau salah, set judul bill ("Makan Sushi"), set cara bagi pajak
5. Share link -> WhatsApp share sheet (link + teks prefill)

### US-2 Guest buka link & milih item
1. Guest buka link dari WhatsApp (og preview keliatan)
2. Ketik nama (sekali, kesimpen localStorage per device)
3. Liat total bill + item list. Centang item yang dia tanggung
4. Live update: subtotal dia + porsi pajak + total dia (sticky bottom bar)
5. Guest bisa update kapan aja, selama bill belum ditutup creator

### US-3 Bayar & konfirmasi
1. Guest tap "Tandai udah bayar" -> bottom sheet: total dia + info kirim (rekening/e-money creator)
2. Guest konfirmasi -> status paid. Creator liat di summary siapa udah/belum
3. Rekap memasukkan bill ke alokasi final setelah semua blocker pembagian selesai. Status
   pembayaran tetap terpisah: bill bisa masih open dan tetap punya aksi bayar/menunggu
   sampai transferan benar-benar dicatat.

### US-4 Riwayat
- List bill yang pernah dibuat (creator) / yang pernah diikutin (guest, by device)
- Tap bill lama -> liat detail read-only

### US-5 Identitas portabel (opsional tapi wajib buat creator)
- Creator dapet identity code (sekali tampil, minta disimpen)
- Di device lain: "Punya kode? Pulihkan" -> masukin kode -> identitas + role + payment profiles balik

## 4. Screens (mobile)

| Kode | Screen | Isi |
|---|---|---|
| S1 | Onboarding nama | Sheet kecil "Siapa namamu?" (default saran nama Indonesia, bukan "User") |
| S2 | Buat bill | Tombol foto struk / upload. Loading state OCR. Form verifikasi item |
| S3 | Bill detail (creator) | Hero total + list item + status tiap orang + tombol share/edit |
| S4 | Item picker (guest) | Item list centang, sticky bottom bar total dia, tombol "udah bayar" |
| S5 | Konfirmasi bayar | Bottom sheet: total + info kirim (rekening a.n., e-money list) + tombol konfirmasi |
| S6 | Summary creator | Siapa milih apa, total masing-masing, status paid/unpaid, sisa pembulatan |
| S7 | Riwayat | List bill (bulan -> judul -> total -> status) |
| S8 | Pulihkan identitas | Input identity code |

Navigation: SINGLE PAGE + segmented tabs (pola proven Settle Up/Tricount: segmented pills
di header, FAB/tombol aksi utama di bawah), BUKAN bottom tabs (Splitwise pake bottom tabs
karena app-nya berat multi-modul; buat app satu-fitur tanpa akun itu overkill).
Alur guest (S4-S5) single-page penuh, fokus, tanpa tab.

## 5. Aturan bisnis

### Split item
- Siapa centang item, dia tanggung item itu 100%. Bisa lebih dari satu orang per item
  (kalau item dishare -> dibagi rata jumlah orang yang centang item itu).
- **JUMLAH ORANG DIHITUNG OTOMATIS dari jumlah centang, TIDAK perlu creator ngasih
  tau.** Creator gak usah input "item ini buat berapa orang" - sistem tinggal hitung
  siapa aja yang centang. 2 orang centang nasi goreng = dibagi 2, 3 orang = dibagi 3,
  1 orang = full. Simpel & anti-salah (kalau orang berubah pikiran, tinggal centang/
  uncentang, pembagian langsung berubah).
- **FINAL ALOKASI TIDAK SAMA DENGAN LUNAS.** Ini jawaban buat case "niatnya berdua
  tapi baru 1 yang centang": sistem gak bisa tau niat, jadi pembagian tetap live selama
  bill open. Rekap boleh memasukkan bill ke alokasi final kalau semua blocker pembagian
  sudah hilang, walaupun `status` masih `open`, `settled` masih `false`, dan orang lain
  masih punya aksi `pay_share`/`wait_payment`. Membaca Rekap tidak mengubah status bill,
  membuat payment row, atau menandai siapa pun lunas.
- Creator daftar nama peserta pas bikin bill (nama doang, tanpa akun) - INI FLOW
  STANDAR, bukan opsional. Flow: kelar makan -> creator bikin bill -> tulis nama
  peserta ("Aufa, Rina") -> share link -> semua centang item -> Rekap menghitung alokasi.
  Gunanya: sistem tau SIAPA yang belum centang -> warning "Rina belum pilih".
  (Angka doang "3 orang" KURANG berguna: tau "1 dari 3 belum pilih" tapi gak tau
  siapa. Nama = 5 detik ngetik, dan itu yang ngejawab kebutuhan "gak lupa siapa
  yang belum dihandle".)
- Catatan: daftar nama = label buat warning, BUKAN batasan akses. Guest yang buka
  link tetap bisa centang walau namanya gak ada di daftar (nama dia ke-tambah
  otomatis). Gak ada hard matching.
- **Peringatan alokasi yang belum lengkap (safety net):** di summary creator, tampilkan
  peringatan yang jelas selama ada workflow yang belum selesai:
  - "Belum pilih: Rina (2 item belum dibagi)"
  - "Item cuma dicentang 1 orang (kemungkinan dishare): Nasi Goreng Rp 25.000 -> dibagi 1"
  Creator bisa menunggu, menghubungi peserta, atau memeriksa pembagian; tidak ada
  tombol "Tutup Bill" di tampilan creator yang mengunci alokasi.
- Rekap tetap **provisional** bila ada salah satu blocker berikut: identitas nyata yang
  sudah bergabung belum memilih item, slot masih uncovered, nama payer belum bisa
  di-resolve ke identitas, `total_ok` false, undangan invite-only belum diterima, atau
  bill open yang benar-benar belum punya selection sama sekali.
- Creator juga peserta biasa - dia centang item yang dia makan juga, flow sama.
- Item yang TIDAK dicentang siapa pun (leftover): default ditanggung **yang
  fronting uang** — payer confirmed kalau ada, kalau belum ya creator (v58;
  sebelumnya selalu creator, walaupun yang nombokin orang lain). Tampilkan
  warning di summary: "Item ini gak ada yang pilih: Nasi Goreng Rp 25.000 ->
  masuk ke kamu".

### Pajak & service
- Struk Indonesia: Subtotal, PPN (11%), Service (5-10%), Total.
- OCR baca baris pajak dari struk (JANGAN hardcode rate - PPN bisa berubah).
- Default: **proporsional ke subtotal item**. Opsi lain: rata ke peserta / ditanggung creator.
- Perhitungan (proporsional):
  `porsiPajak(user) = (subtotalUser / totalSubtotal) x (PPN + Service)`

### Pembulatan & konsistensi
- Simpan semua nominal sebagai INTEGER rupiah, jangan float.
- Sisa pembulatan (selisih 1-2 rupiah) -> ditanggung yang fronting uang (v58: owner
  = payer confirmed, else creator).
- Invariant: `sum(totalPerOrang) == totalBill` selalu. Ditampilin kalau ada selisih.

### Status bayar
- `unpaid` -> `paid` (klaim guest) -> `confirmed` (opsional, creator setuju).
- v1: cukup paid/unpaid. Two-way confirm boleh di fase 2.

## 6. Data model (SQLite)

```
identity
  id TEXT PK            -- random UUID (device)
  name TEXT
  role TEXT             -- 'creator' | 'guest'  (bisa dua-duanya)
  secret TEXT NULL      -- secret sesi perangkat; wajib untuk mutation
  identity_code_hash TEXT NULL   -- hash kode pemulihan
  created_at

bill
  id TEXT PK            -- kode 6-8 char, public (ada di URL)
  creator_identity_id FK
  title TEXT            -- "Makan Sushi"
  photo_path TEXT       -- struk tersimpan lokal (resized)
  subtotal_idr INT, tax_idr INT, service_idr INT, total_idr INT
  tax_mode TEXT         -- 'proportional' | 'equal' | 'creator'
  status TEXT           -- 'open' | 'closed'
  created_at, closed_at

item
  id INTEGER PK, bill_id FK
  name TEXT, price_idr INT
  sort_order INT

selection          -- siapa centang item apa (bisa 1 item banyak orang)
  id INTEGER PK, item_id FK, identity_id FK
  UNIQUE(item_id, identity_id)

payment
  id INTEGER PK, bill_id FK, identity_id FK
  amount_idr INT, status TEXT ('unpaid'|'paid'), paid_at
  UNIQUE(bill_id, identity_id)

payment_profile   -- milik identity, opsional
  id INTEGER PK, identity_id FK
  type TEXT ('bank'|'ewallet')
  label TEXT            -- "BCA", "DANA"
  detail TEXT           -- "1234567890 a.n. Aufa" / "0812xxxx"
```

Perhitungan total per orang TIDAK disimpan - dihitung on-the-fly dari items +
selections + tax_mode (selalu konsisten, gak ada drift data).

## 7. API (REST, JSON)

```
POST /api/identities            -- buat identity (name) -> {id, name, secret}
POST /api/identities/restore    -- {code} -> identity + secret (atau 404)
POST /api/identities/{id}/bind  -- legacy: {code} -> bind secret (atau 403)
GET  /api/bills/{code}          -- detail bill + items + tax info (public read)
POST /api/bills                 -- creator: buat bill (items, tax_mode, photo)
PATCH /api/bills/{code}         -- creator: edit items, tax_mode, close bill
POST /api/bills/{code}/selections      -- guest: set centang item (bulk upsert)
GET  /api/bills/{code}/summary  -- creator: per-orang breakdown + status
POST /api/bills/{code}/payments/{identity_id}/paid   -- guest: tandai bayar
GET  /api/me/bills              -- riwayat by identity (device)
POST /api/identities/payment-profiles  -- creator: simpan rekening/e-money
```

Auth: bill code = akses baca publik. Semua mutation identity-scoped wajib mengirim
`X-Identity-Id` dan secret sesi yang benar lewat `X-Identity-Secret`; id saja bukan
kredensial. Legacy identity dengan `secret IS NULL` harus dipulihkan lewat recovery
code atau di-bind lewat endpoint di atas sebelum dapat melakukan mutation. Creator-only
action tetap memvalidasi identity yang sudah terautentikasi dan rate limit berlaku
per IP (lihat Section 9).

### Token entropy (dari riset OWASP, verified)
- Bill code di URL: jangan 6-8 char pendek (30-40 bit, keburu brute-force).
  Pakai `secrets.token_urlsafe(16)` = 128-bit, URL `/b/<22-char>`.
  Gak masalah panjang karena dishare lewat tap link (WhatsApp), bukan diketik manual.
- Identity code: tetap 10-12 char manusiawi (diketik manual), diproteksi rate limit
  + lockout setelah N percobaan gagal.
- Rate limit (SlowAPI, in-memory cukup di 1 VPS):
  create bill 5-10/min/IP, GET share page 30-60/min/IP + cap total view per token
  (mis. 1000, anti-scrape), upload foto 5-10/min/IP max 5MB.

## 8. OCR - Gemini free tier

- **Verified (2026-08-09):** Google free tier masih ada, key AQ.Ab8... (disimpan
  /opt/projects/bagiin/backend/.env) valid di free tier, tanpa kartu. Limit ratusan request/hari
  per project - jauh di atas kebutuhan (beberapa struk/minggu).
- **MODEL YANG DIPAKAI: `gemini-3.5-flash`** (verified: baca struk test 100% bener,
  output JSON clean). CATATAN: `gemini-2.5-flash` udah GAK tersedia buat user baru
  (HTTP 404 "no longer available to new users") - jangan dipakai. Fallback:
  `gemini-3.6-flash` (sama bagusnya, output lebih pendek).
- Prompt: kirim gambar + minta output JSON terstruktur:
  `{items: [{name, price}], subtotal, tax, service, total}` (locale id-ID, Rp).
- Struk miring/buram: minta retry 1x, kalau gagal -> fallback manual entry.
- **Verifikasi & edit = bagian WAJIB dari flow (bukan emergency).** Setelah OCR,
  creator SELALU lewat screen verifikasi sebelum share. Ini editor lengkap:
  - **OCR juga baca merchant (nama tempat) + date (tanggal transaksi)** -> auto-fill
    judul bill + input tanggal (verified 2026-08-09: struk Kitchen & Dimsum -> 
    merchant "Kitchen & Dimsum", date 2026-08-08, 6 item, total 317.619 semua benar).
    Creator tetap bisa edit judul/tanggal.
  - Edit tiap item: nama, harga, hapus item
  - Tambah item manual (tombol "+ Tambah item")
  - Edit subtotal/PPN/service/total kalau OCR salah baca
  - Reorder item (drag/panah) biar urutan masuk akal
- **Auto-validation pas verifikasi (bantu ketemu error):**
  - `sum(items) != subtotal` -> tampilkan selisih: "Ada selisih Rp 5.000
    (mungkin diskon/promo)". Creator bisa input baris "Diskon" sebagai item
    negatif atau override subtotal.
  - `subtotal + tax + service != total` -> warning + tampilkan bedanya.
  - Item harga Rp 0 atau nama kosong -> highlight merah.
  - Dua item mirip (OCR dobel baca) -> saran "Item ini mirip: 'Nasi Goreng' &
    'Nasi Goreng' - hapus salah satu?"
- **Kalau OCR gagal total:** screen yang sama, tapi list item kosong -> creator
  ketik manual. Gak ada blokir, cuma butuh lebih lama dikit.
- Fallback (fase 2): Ollama qwen2.5-vl 3B lokal kalau API mati. Jangan di v1.
- Input: `<input type="file" accept="image/*" capture="environment">` (verified MDN).
  JANGAN `accept="image/jpeg"` - di iOS picker HEIC jadi grey-out.
  `capture` string: "environment" = kamera belakang (Android Chrome langsung kamera,
  iOS action sheet). Desktop ignore.
- DUA OPSI (keputusan user): kamera (capture="environment") DAN galeri. UX: tombol
  "Foto Struk" buka sheet [Ambil Foto] [Pilih dari Galeri]. Galeri = input file
  TANPA atribut capture (browser tampilin picker file).
- HEIC (verified caniuse): cuma Safari iOS/macOS yang bisa decode HEIC.
  Client: cek `file.type`; kalau `image/heic` di Android/Chrome -> pesan "pilih foto
  JPEG/PNG" (jangan load heic2any, 333KB gz, kebanyakan buat app kecil).
  Kalau perlu terima HEIC mentah -> pillow-heif di backend (fase 2).
- Client-side resize SEBELUM upload (verified): max 1600px long edge, JPEG q0.7
  -> ~200KB dari 2-5MB. 1600px cukup buat teks struk kebaca.
  Implement: `createImageBitmap` + `canvas.toBlob('image/jpeg', 0.7)`.
  Upload max 5MB di rate limit. Server simpan di disk, BUKAN SQLite blob.

## 9. Identitas & keamanan

- localStorage (verified MDN): 5 MiB per origin, private mode bisa 0/quota error.
  Simpan identity session (`identity_id` + `secret`), nama, dan preferensi hanya
  sebagai cache perangkat. SEMUA akses
  localStorage dibungkus try/catch + fallback in-memory (app tetap jalan tanpa storage).
  Server = source of truth via share link; localStorage cuma cache.
- Identity code: random 10-12 char (base32, tanpa O/0/I/1), tampil SEKALI,
  disimpan server sebagai hash, ada tombol "ganti kode" (invalidasi lama).
- PENTING di UI: kode identitas = RAHASIA (jangan dishare). Kode bill = PUBLIK.
- Tanpa akun -> konsekuensi: ganti device = identitas gak kebawa kecuali restore code;
  recovery code menjadi bukti untuk mengikat secret sesi pada identity legacy.
- Rate limit + token entropy: lihat Section 7 (128-bit bill token, identity code
  dilockout setelah N gagal).
- Receipt photo: privat, cuma bisa diakses via bill code (yang udah dishare creator).

## 10. Teknologi & deployment

- Backend: FastAPI + SQLite (pattern stockbit-backend: venv + systemd).
  Path: /opt/projects/bagiin/backend
- Frontend: TypeScript + React 18 + Vite, dengan primitives project-owned bergaya
  shadcn/ui. Source utama ada di `frontend/src`; `frontend/dist` adalah output build
  yang di-serve FastAPI di `/` dan `/assets/`. `frontend/static/` legacy tetap
  dipertahankan sebagai fallback lokal dan jalur rollback.
  Build wajib dijalankan sebelum restart service: `npm ci --no-audit --no-fund`,
  `npm run typecheck`, lalu `npm run build`.
  Budget dipisah agar terukur: source-owned app bundle < 50KB gzip, vendor React/icon
  dilaporkan terpisah. Pengukuran build saat ini dengan gzip level 9: app-owned
  44.03KB (43.00KiB), vendor/icon 59.75KB (58.35KiB), dan seluruh asset 103.78KB
  (101.35KiB). App-owned tetap lulus budget.
  Path: /opt/projects/bagiin/frontend
- Nginx reverse proxy + HTTPS (Let's Encrypt), subdomain: bagiin.ardhiqi.com.
  Infra note (cek 2026-08-09): VPS IP 209.17.118.186, zone ardhiqi.com di Cloudflare,
  A record bagiin SUDAH ada (proxied=true). Pattern deploy: certbot --dns-cloudflare (kredensial
  /root/.secrets/cloudflare.ini) + vhost di /etc/nginx/sites-available/ + A record
  via Cloudflare API (lihat skill hermes-infrastructure, pola stockbit.ardhiqi.com).
- TANPA auth_basic (guest butuh akses via link)
- Receipt storage: local disk (mis. /var/www/uploads), nama file random uuid4 hex,
  path traversal guard, metadata di SQLite. JANGAN di SQLite blob.
  Header `Cache-Control: private, max-age=31536000, immutable` (receipt immutable).
  Volume: ~200KB x 1000 receipt = 200MB, muat di VPS mana pun.
- PWA: manifest + icons 192/512 + apple-touch-icon 180 (verified web.dev:
  service worker SUDAH TIDAK WAJIB lagi untuk installable - skip SW di v1).
  iOS gak ada install prompt otomatis - jangan jadikan PWA install sebagai fitur utama.
- Viewport & safe-area (verified caniuse): `width=device-width, initial-scale=1,
  viewport-fit=cover` + `height: 100dvh` (fallback 100vh) + fixed bottom bar
  `padding-bottom: calc(env(safe-area-inset-bottom) + 12px)`.
- Dark mode: `prefers-color-scheme` + `<meta name="color-scheme" content="light dark">`
  (native controls ikut), theme-color dua varian. Ikut sistem, tanpa toggle di v1.
- Share WhatsApp (verified FAQ WA): `https://wa.me/?text=<urlencoded>` (tanpa nomor =
  contact picker) + `navigator.share()` kalau support, fallback wa.me.
  og meta dinamis per bill (og:title/description/image absolute URL, image 1200x630
  atau min 300x200, <5MB; cache WA agresif - ganti og tags pake query string ?v=2).
- Backup: SQLite dump harian (cron).

## 11. Design system (mobile-first)

Prinsip: **angka adalah hero, sisanya kertas.** Light-first, netral seperti
Obsidian/VS Code (selera user), satu accent orange, hijau/merah CUMI untuk status.

```css
:root {
  --bg:            #FAFAFA;   /* kertas, bukan putih murni (anti-silau) */
  --surface:       #FFFFFF;
  --surface-2:     #F4F4F5;
  --border:        #E4E4E7;
  --text:          #18181B;
  --text-2:        #52525B;
  --text-3:        #A1A1AA;
  --accent:        #F97316;   /* orange-500, SATU-SATUNYA aksen */
  --accent-press:  #EA580C;
  --on-accent:     #FFFFFF;
  --green:         #16A34A;   /* lunas/dibayar */
  --green-bg:      #F0FDF4;
  --red:           #DC2626;   /* tagihan belum dibayar */
  --red-bg:        #FEF2F2;
  --font: system-ui, -apple-system, "SF Pro Text", Roboto, "Segoe UI", Arial, sans-serif;
  --r-sm: 6px;  --r-md: 10px;  --r-lg: 14px;
  --shadow-1: 0 1px 2px rgba(24,24,27,.04);
  --shadow-2: 0 1px 3px rgba(24,24,27,.06), 0 1px 2px rgba(24,24,27,.03);
}
```

- Font: system stack (loading 0ms, penting di jaringan Indonesia). Google Fonts buang.
- ANGKA: `font-variant-numeric: tabular-nums` + `letter-spacing: -0.01em`, bold.
  Format `Rp 150.000` (titik ribuan, locale id-ID), desimal cuma kalau ada pecahan.
  Selalu diawali Rp, gak pernah angka telanjang.
- Type scale: TOTAL tagihan 32px/700 (satu-satunya elemen paling besar),
  item/nama 16px, timestamp/helper 12px.
- Spacing: kelipatan 4 (4/8/12/16/20/24/32/40).
- Kartu: border tipis, shadow tipis, radius konsisten. Bukan card-shadow tebal.
- Item terpilih: border orange 1.5px + bg #FFF7ED.
- Anggota: inisial avatar, bg netral. JANGAN warna-warni per anggota.
- Dark mode: fase 2 (auto prefers-color-scheme, token swap).

### Mobile rules (WAJIB)
- Touch target min 44px (48px ideal). Bottom sheet max 85% tinggi layar.
- Tap feedback: pressed state (surface-2 + scale 0.98, 100ms) + `navigator.vibrate(10)` di Android.
- Animasi <= 200ms, cuma opacity/transform. Gak ada confetti, gak ada parallax,
  gak ada WebGL. Layar murah gampang stutter.
- Keyboard: saat input nominal, scroll otomatis ke atas (jangan sampai nutup tombol simpan).
- Copy Bahasa Indonesia santai: "Tandai sudah bayar" bukan "Settle up";
  "Tambah item" bukan "Add expense".
- Kontras teks min 4.5:1. Hitam di kertas #FAFAFA aman.

### Pola UX proven dari riset kompetitor (verified via Play Store screenshots)
- Item picker (pola Tricount, proven): checkbox per item + STICKY BOTTOM BAR
  berisi "Total kamu: Rp X" yang update live tiap tap. Bukan stepper.
- Tombol aksi utama di strip atas atau FAB bawah (pola Settle Up/Tricount),
  bukan bottom nav.
- Foto struk: baris eksplisit "Foto Struk" (pola Settle Up), bukan ikon kamera kecil.
- Status bayar: hijau = lunas/piutang, merah = utang (proven semua app).
  Tombol "Udah Bayar" di baris orang -> tap -> hijau + teks berubah.
- History: dikelompokkan per bulan/tanggal + label warna kanan (pola Splitwise proven).
- Empty state bill kosong: ilustrasi + CTA "Buat Bill Baru" (belum ada bukti visual
  dari kompetitor, rekomendasi design).
- JANGAN tiru paywall Splitwise (free tier dibatasi 3 transaksi/hari, review marah).
  App ini gratis penuh.
- Anti-pola: jangan paksa invite berbasis akun (review Tricount: user bingung,
  invited users kena login error) - share link tanpa login itu keunggulan.

## 12. Copy penting

- Onboarding: "Siapa namamu?" / "Biar temenmu tau ini kamu."
- Buat bill: "Foto struknya" / "Biar gak ribet ngetik manual"
- Picker: "Centang yang kamu tanggung" / "Total kamu: Rp 81.667"
- Bayar: "Tandai sudah bayar" / "Kirim ke: BCA 1234567890 a.n. Aufa"
- Summary creator: "Belum bayar: Rina (Rp 81.667)" / "Bagian kosong: Rp 40.000"
- Identity code: "Simpan kode ini. Jangan dishare ke siapa pun."

## 13. Roadmap

- **Fase 1 (MVP):** S1-S7, US-1..4, OCR Gemini, split + pajak proporsional,
  paid/unpaid, history, payment profiles. Tidak ada identity code.
- **Fase 2:** Identity code (US-5), dark mode, PWA service worker, two-way confirm,
  fallback OCR lokal.
- **Fase 3 (opsional):** balance/utang piutang, reminder otomatis, export CSV.

## 14. Pertanyaan terbuka (status 2026-08-09)

1. ~~Nama final?~~ -> BAGIIN (diputuskan; rename dari PATUNGAN 2026-08-09)
2. ~~Subdomain?~~ -> bagiin.ardhiqi.com (A record SUDAH ada, deploy done 2026-08-09)
3. ~~Foto struk camera doang / upload?~~ -> DUA-DUANYA: input file dengan capture
   environment (kamera) + opsi pilih dari galeri (tanpa atribut capture / action
   sheet iOS). Tombol "Foto Struk" buka sheet: [Ambil Foto] [Pilih dari Galeri].
4. ~~Item dishare 2 orang -> dibagi rata?~~ -> YA, otomatis dari jumlah centang
   (keputusan 2026-08-09). Creator TIDAK perlu input jumlah orang. Detail di Section 5.

### Penjelasan item dishare (pertanyaan 4, dijawab 2026-08-09)

Case-nya: satu item struk yang dinikmati BERSAMA, bukan per orang. Contoh nyata:
- 1 porsi nasi goreng Rp 25.000 dimakan berdua (lu + doi) -> keduanya centang
  item "Nasi Goreng" -> masing-masing nanggung Rp 12.500.
- 1 es teh manis Rp 5.000 diminum bareng -> sama, dibagi rata 2 orang.
- 1 paket mie goreng + telur yang dipesan buat dishare 3 orang -> dibagi 3.

Rules-nya: setiap item punya N orang yang centang. Harga item dibagi RATA ke
N orang itu (Rp 25.000 / 2 = Rp 12.500, sisa pembulatan -> creator).
Item yang cuma 1 orang yang centang = dia tanggung full 100%.

Alasan perlu rule ini: struk restoran sering ada item "besar" (porsi keluarga,
paket, minuman 1 liter) yang emang dimaksudkan dishare. Tanpa ini, orang harus
manual ngitung-ngitung. Dengan checkbox multi-user per item, 1 tap aja.

Kalau user GAK mau fitur ini di v1: cukup tandai item "dishare" + input berapa
orang, atau skip dulu (item = 1 orang doang). Default spec: multi-centang
dibagi rata (murah dibangun, 1 tabel selection udah cukup).

## Sumber & status verifikasi

- [x] Gemini free tier masih ada (dicek langsung 2026-08-09, halaman rate-limits Google)
- [x] OpenRouter :free vision models ada (API dicek langsung): gemma-4-31b-it:free dkk
- [x] tasteskill.dev dicek langsung; skill design-taste-frontend sudah terpasang di Hermes
- [x] Spek desain: hasil subagent riset (Revolut/Wise/Splitwise/GoPay/OVO/DANA patterns)
- [x] Mobile UX patterns: subagent riset via browser CDP (Play Store screenshots,
      Splitwise/Tricount/Settle Up verified; Splid belum sempat dianalisis)
- [x] Technical best practices: subagent riset via browser CDP (MDN, caniuse, web.dev,
      ogp.me, WhatsApp FAQ, OWASP, htmx.org - semua diverifikasi langsung)
- [ ] Tarif BI-FAST / QRIS 2026: perlu uji langsung sebelum rilis (bukan bagian v1)

### Catatan subagent (2026-08-09)
- Toolset `web`/`search` flaky di environment ini -> subagent riset pakai toolset
  `browser` (connect ke local Chromium CDP :9222). Sudah disimpen di skill
  tool-research + verified smoke test.
- Subagent UX: 50 tool calls, sempat kena max_iterations sebelum Splid/Reddit selesai.
  Yang belum: Splid screenshots, Reddit/UX articles. Data inti (3 app) sudah lengkap.
- Subagent teknis: 44 tool calls, semua fakta kunci diverifikasi dari dokumen resmi.

## Changelog

### 2026-09-06 (v72), Rekap Patungan lintas bill

- Endpoint identity-scoped `GET /api/identities/{identity_id}/recap` merangkum utang dan piutang dari bill yang alokasinya sudah final, dengan autentikasi header dan pengecekan id path.
- Nilai final dipisahkan tegas dari bill yang masih menunggu pilihan, slot yang belum tertutup, atau workflow lain yang belum selesai. Estimasi sementara tidak pernah masuk ke saldo final.
- Drilldown dan antrean tindakan hanya membawa metadata bill yang aman; bill, undangan, rekening, dan rahasia identitas yang tidak terkait tidak ikut terbuka.
- Alias nama Rekap Patungan disimpan lokal di perangkat, bukan diubah ke nama identitas bersama atau dikirim ke server.

### 2026-09-07 (v73), cache rekap dan status menunggu yang jujur

- Rekap Patungan memakai cache in-memory terikat identity dengan TTL 15 detik, guard generation untuk response lambat, dan invalidation terpusat setelah mutasi berhasil. Cache error tidak dianggap sebagai data valid.
- Home dan Rekap Patungan berbagi aturan freshness serta invalidation. Bill list tidak lagi memakai snapshot tanpa batas waktu.
- Action `wait_payment` sekarang muncul untuk pemilik efektif ketika peserta lain punya alokasi positif tetapi belum membayar, termasuk bill tertutup yang alokasinya sudah final. Peserta tetap mendapat action `pay_share` miliknya sendiri.
- `waiting_other` tidak lagi dianggap kosong atau aman ketika masih ada orang yang belum memilih, belum membayar, atau belum menerima undangan. Nominal provisional tetap dipisahkan dari saldo final.
- Regression dan browser smoke mencakup pending selection plus pending payment, cache hit, invalidation setelah mutasi, auth/privacy, alias lokal, tema gelap, serta viewport HP dan desktop.

### 2026-09-07 (v74), audit input malformed dan route private guest

- Create/update bill menormalisasi nama dan mode item melalui satu validator, memvalidasi id item sebelum operasi set atau integer, serta membatasi `participant_count` supaya input ekstrem menjadi HTTP 400, bukan HTTP 500 atau overflow SQLite.
- Validator angka sekarang menolak boolean, pecahan, NaN, Infinity, dan overflow dengan HTTP 400; integer serta string-integer yang kompatibel tetap diterima.
- Direct link guest ke `#/settings`, `#/recap`, dan `#/create` sekarang dikembalikan ke `#/` sebelum onboarding; public `#/b/<id>` tetap bisa dibuka tanpa identity.
- Regression backend dan browser route-guard mencakup rejection malformed, valid write setelah rejection, canonical hash, public bill preservation, dan zero console error.

### 2026-09-07 (v75), navigasi mobile tetap fixed saat scroll

- Bottom navigation mobile untuk route Home, Rekap, dan Akun tetap terlihat dan menempel di bawah viewport saat scroll normal, termasuk first load dan setelah pindah route.
- Scroll hide berbasis `translateY(100%)` dihapus supaya navigasi utama tidak hilang tanpa aksi user. Contextual dock, editor/create/OCR, bill detail, onboarding/guest, desktop, safe-area, dan keyboard offset tetap mengikuti aturan masing-masing.
- Regression browser mencakup geometry fixed pada scroll turun/naik, transisi Home/Settings/Rekap, route yang wajib menyembunyikan nav, responsive matrix, dan zero console error.

### 2026-09-09 (v79), diskon checkout terpisah untuk split bill

- Bill menyimpan `order_discount_idr` terpisah dari diskon per item. Rumus total menjadi `subtotal item + pajak + service - diskon pesanan`, dengan validasi 400 sebelum data ditulis kalau diskon melebihi subtotal atau total tidak cocok.
- Diskon voucher tingkat pesanan dialokasikan proporsional setelah pembagian item, termasuk item quantity, item yang belum dipilih, dan slot yang masih uncovered. Breakdown server mengembalikan subtotal item, bagian diskon pesanan, pajak/service, serta total akhir dengan invariant tetap terjaga.
- OCR membedakan promo item dari voucher checkout. Diskon persentase atau field order-level yang tidak jelas tidak dipindahkan menjadi diskon item.
- Form verifikasi dan edit bill menerima field diskon pesanan terpisah. Tampilan bill menunjukkan subtotal item, diskon voucher, fee, dan total final dari server, termasuk kasus GoFood subtotal Rp81.000, diskon Rp45.000, service Rp12.500, total Rp48.500.
- Regression mencakup create/update HTTP, migrasi database, alokasi free/slot/uncovered, OCR, old payload tanpa field baru, full pytest, frontend logic, serta browser E2E.

### 2026-09-09 (v80), sinkronisasi harga dan jumlah item saat edit bill

- Editor verifikasi OCR dan pembuatan bill manual memakai state item canonical yang sama. Perubahan harga satuan, diskon item, dan jumlah dibeli langsung menghitung ulang total baris, subtotal, diskon pesanan, pajak/service, serta total akhir.
- Subtotal sekarang ditampilkan sebagai nilai turunan dari harga efektif dikali jumlah dibeli. Subtotal OCR yang stale tidak lagi mengunci kalkulasi setelah pengguna mengubah item.
- Tombol jumlah `+` dan `-`, input jumlah langsung, rerender, payload create/update, editor bill tersimpan, dan reload memakai nilai harga serta jumlah terbaru.
- Backend menghitung dan menyimpan subtotal dari item yang sudah dinormalisasi. Subtotal client yang stale atau tidak dikirim tidak menjadi sumber kebenaran, sedangkan total, diskon pesanan, dan invariant integer tetap divalidasi.
- Nilai jumlah yang tidak valid atau diskon item yang melebihi harga memblokir penyimpanan dan menyembunyikan total turunan stale. Regression backend, payload, HTTP, manual, OCR, editor tersimpan, reload, responsive browser, dan zero console error ditambahkan.

### 2026-09-09 (v81), status bill konsisten saat slot belum terambil

- History bill sekarang mengembalikan `uncovered_idr`, `all_paid`, dan `settled` dari snapshot kalkulasi yang sama dengan detail bill. Slot kosong tetap terlihat sebagai nominal yang belum terambil, walaupun semua pembayaran peserta sudah tercatat.
- Status chip memakai satu prioritas bersama, peserta yang masih menunggu dan pembayaran yang belum masuk dijelaskan lebih dulu, lalu slot uncovered, baru status hijau. Label "Lunas" tidak lagi menutupi sisa slot.
- Fallback payload lama tetap aman, dan nilai uncovered yang malformed atau negatif dinormalisasi menjadi nol di adapter frontend.
- Regression mencakup fixture item gratis yang dipilih plus slot kosong, konsistensi API detail/history, status chip, history row, dan fallback payload lama.

### 2026-09-09 (v83), repair pasca-review upload dan regression harness

- Transaksi penambahan foto selalu di-rollback dan koneksinya ditutup saat insert gagal, sehingga FK error tidak meninggalkan SQLite dalam keadaan locked untuk writer berikutnya.
- Root upload relatif dinormalisasi menjadi path absolut sejak startup. Path hasil `/api/photos` tetap dapat dipakai langsung saat membuat bill, tanpa menggandakan root konfigurasi.
- Fixture diskon checkout memakai subtotal item efektif yang benar, terpisah dari diskon pesanan. Harness brand fallback mengeksekusi helper escaping production dan menguji input brand tidak dikenal yang berbahaya.
- Regression mencakup FK failure lalu write berikutnya, konfigurasi upload relatif, validasi fixture diskon, dan escaping brand melalui kode production.

### 2026-09-11 (v84), cashback pembayaran yang dibagi bersama

- Bill menyimpan `cashback_idr` terpisah dari `order_discount_idr`. Cashback dari metode pembayaran bukan fakta yang dibaca dari struk, dan hanya dibagi kalau creator memasukkannya secara eksplisit. Kalau cashback hanya milik pembayar, nilainya tetap 0.
- Rumus bill menjadi `subtotal item + pajak + service - diskon pesanan - cashback`. Cashback dibatasi oleh total sebelum cashback, divalidasi sebelum write, dan payload lama tanpa field cashback tetap berarti 0.
- Cashback dialokasikan setelah diskon pesanan serta pajak/service, proporsional terhadap kewajiban tiap orang dan nominal slot yang belum terisi. Sisa pembulatan rupiah mengikuti fallback owner, seluruh komponen harus tetap reconcile, dan tidak ada nominal negatif.
- Form verifikasi OCR/manual, editor bill tersimpan, ringkasan total, dan breakdown per orang menampilkan `Cashback yang dibagi` secara terpisah. OCR tidak menebak cashback, dan breakdown final memakai nominal per orang dari server.
- Untuk receipt Zenbu dengan subtotal Rp299.000, service Rp23.920, PB1 Rp32.292, dan total struk Rp355.212, cashback Rp50.000 menghasilkan total bersama Rp305.212 tanpa mengubah fakta subtotal, service, atau pajak pada struk.
- Regression v84 mencakup migrasi, create/update persistence, validasi invalid tanpa persist, compatibility payload lama, pembulatan proporsional, order discount plus cashback, uncovered slot, tax-included/service, frontend state/payload, dan rendering server breakdown.

### 2026-09-12 (v85), audit responsive UI/UX dan integritas komponen frontend

- Audit real-browser mencakup lebar `320, 360, 375, 390, 412, 430, 480, 600, 719, 720, 721, 768, 820, 1024, 1039, 1040, 1041, 1280, 1440` serta tinggi pendek dan normal. Pemeriksaan membedakan content di bawah fold dari kontrol actionable yang benar-benar tertutup fixed dock.
- Action row creator bill dipindahkan sebelum content yang dapat bertambah tinggi, sehingga tombol `Metode Bayar` dan tambah foto tetap dapat dipakai pada viewport pendek `320x568`. Focus field editor juga memakai reserve dock yang diukur dan disinkronkan ke root scroll container.
- Filter home sekarang disabled selama daftar bill masih dimuat, route hash menolak suffix invalid dan mengkanonisasi URL ke `#/`, serta class `settings-page` dipasang saat route Akun aktif supaya rule responsive settings benar-benar berlaku.
- Dialog sheet selalu mempunyai accessible name, kontrol tambah peserta mempunyai nama eksplisit, toggle undangan mengubah `aria-checked` satu kali walaupun yang diklik ikon atau baris deskripsi, dan heading Rekap lebih stabil saat wrap di layar sempit.
- Warning creator yang panjang menjaga frasa konsekuensi pembayaran tetap utuh saat line-break. Regression frontend dan browser durable ditambahkan melalui `tools/e2e_frontend_logic.mjs`, `tools/e2e_create.mjs`, dan `tools/e2e_uiux_responsive.mjs`; full pytest serta flow browser utama tetap hijau.

### 2026-09-13 (v86), migrasi fondasi frontend TypeScript dan React

- Frontend dimigrasikan secara incremental ke TypeScript + React 18 + Vite. Primitive
  UI dimiliki project dan mengikuti pola shadcn/ui tanpa mengganti API, URL share,
  schema, atau aturan pembagian uang.
- Route home/onboarding, bill guest dan creator, create/manual/OCR verify, settings,
  recap, payment, identity, route guard, leave guard, responsive dock/rail, dan
  compatibility selector legacy dipertahankan di bawah `frontend/src`.
- FastAPI menyajikan `frontend/dist` pada `/` dan `/assets/` dengan root/manifest
  no-cache + ETag serta hashed asset immutable. `frontend/static/` tetap tersedia
  sebagai fallback rollback; production harus build sebelum restart service.
- Regression final dijalankan terhadap database dan upload directory isolated:
  `npm ci`, typecheck, build, frontend logic, full pytest `398 passed, 1 skipped`,
  browser create `28 matrix cases, 0 failed`, smoke, settled, recap, guest route
  guard, rounding, dan UI/UX responsive `10 navigations, 22 matrix cases` tanpa
  console/page error. Mutation `calc.py` menghasilkan `344/376 killed`, `32 survived`,
  score `91.49%`.
- Pengukuran gzip memisahkan budget source-owned app `43.36KB` dari vendor React/icon;
  seluruh asset terkirim berukuran `103.11KB`. Belum ada deployment atau perubahan
  data production pada migrasi ini.

### 2026-09-20 (v94), icon sizing dan logo asli Bagiin

- Tiga regresi visual dari port React, semuanya dilaporkan pengguna sebagai "iconnya kecil, logonya gw gk tau dah better ada atau kgk".
- Sizing icon ternyata kode mati. `@phosphor-icons/react` merender setiap icon sebagai `<svg width="1em">`, jadi ukuran sebuah icon sama dengan font-size parent-nya. Lembar legacy men-size icon lewat class (`ic(name, cls)` di `frontend/static/app.js` memancarkan `<svg class="ico ...">`), dan React tidak pernah mengirim className. Terukur: 62 pemakaian icon di `frontend/src/**`, nol yang punya sizing hook, sehingga enam aturan tidak pernah bisa cocok: `.brand-mark .ico`, `.ico`, `.empty-state .ico`, `.status-mark .ico`, `.onboarding-mark .ico`, `.app-nav-link .ico`. Akibatnya icon navigasi render 11px padahal niatnya 22px, `.empty-state` 16px dari 28px, dan icon di tombol serta judul kartu 15-16px dari baseline legacy 18px. Setiap aturan mati itu kini dinyatakan terhadap markup yang benar-benar dirender React, dan `.empty-state` sengaja memakai selector direct-child karena kontainer itu juga menyarangkan icon tombol.
- Logo yang tampil adalah glyph stok, bukan merek aslinya. Legacy punya `brandMark(size)` di `frontend/static/app.js` yang menggambar logo struk robek (viewport 512, tile gradient `rx=115` dengan `#FB943C` ke `#DF5208`, dua clipPath robekan), dan artwork yang sama dikirim sebagai `frontend/static/favicon.svg`. Port React justru menampilkan glyph `Receipt` Phosphor di dalam kotak `--accent` dengan `place-items:center`, sehingga terbaca sebagai cincin oranye berisi icon generik kecil. `BrandMark.tsx` baru mem-port artwork aslinya dan memakai `useId()` untuk id gradient/clipPath per instance, bukan `Math.random()` milik helper legacy yang tidak aman di React 18 StrictMode.
- Geometri lockup juga melenceng: `.brand` 20px dengan `align-items:center` dan flex gap 8px, sehingga titik setelah "Bagiin" berjarak 8px. Legacy 19px, rata baseline, dan tanpa flex gap sama sekali karena pemisahnya adalah `margin-right` milik `.brand-mark`. Kotak mark kini 26x26 transparan dengan logo mengisi penuh, sesuai legacy.
- Keputusan kontras: legacy mewarnai titik dengan `--brand` (#F97316) yang hanya 2,64:1 di latar terang, di bawah batas 3:1 untuk teks besar sekalipun padahal itu teks 19px bold. Itu cacat warisan; repo ini sudah pindah ke standar AA sejak v90, jadi titik kini memakai `--accent` (4,90:1 terang / 6,61:1 gelap, keduanya AA) dan `--brand` tidak dideklarasikan karena titik adalah satu-satunya konsumennya.
- Gate coverage tidak bisa melihat semua ini: ia memeriksa geometri, overflow, kontras, dan cakupan aturan, tetapi tidak pernah mengukur kotak sebuah icon. Sekarang gate menegaskan ukuran terukur icon navigasi, brand-mark, empty-state, dan status-mark, menegaskan brand mark adalah logo asli, serta menegaskan empty-state tidak memperbesar icon tombol di dalamnya. Route `bill-missing` baru merender `ErrorState`, satu-satunya tempat empty-state terlihat membawa icon tombol, supaya penjaga itu benar-benar berjalan.
- Bukti non-vakum: pada tree pre-fix gate GAGAL 140 dari 1260 check dengan menyebut "nav icon got 11px, want 22px" dan "brand mark rx=null rects=0"; pada tree perbaikan gate PASS 1260. Hasil ukur dingin di server sekali pakai, 390px, identitas asli, tema terang dan gelap: icon navigasi 11 menjadi 22px, empty-state 16 menjadi 28px, brand-mark 30 menjadi 26px dengan logo mengisi kotaknya, `.brand` 20 menjadi 19px, jarak titik 8px menjadi 0. Mark yang dirender identik secara struktur dengan favicon yang dikirim, dengan nol id DOM ganda. Verifikasi: `pytest` 422 passed 1 skipped, typecheck bersih, `test:logic` 9/9, battery browser 14/14, gate PASS 1260.

### 2026-09-18 (v93), shell pra-JS supaya HP tidak menatap layar kosong

- React port mengirim `<div id="root"></div>` tanpa CSS inline, tanpa token, dan tanpa skeleton. Akibatnya, pada profil HP 4G dengan CPU di-throttle 4x, dokumen menampilkan layar kosong selama 825-1129 ms sambil menunggu graph masuk (64 KB decoded entry + 138 KB decoded chunk react) selesai diunduh, di-parse, dan dijalankan.
- Build vanilla yang digantikan berperilaku sebaliknya. Dokumennya 57.770 byte dan meng-inline seluruh design token, sistem skeleton `.sk`/`.sk-row`, serta markup nyata (`<main id="app">`, `<nav id="app-nav">`, `<div id="toast">`), sehingga HP langsung melukis kerangka berbentuk aplikasi begitu HTML tiba. Secara byte, port React justru lebih kecil (80 KB gzip graph masuk vs 141 KB gzip vanilla). Itu sebabnya pengukuran byte saja menyimpulkan "lebih ringan" sementara HP mengatakan "berat": regresinya bukan berat, tapi jendela kosong.
- `src/index.html` sekarang mengirim shell pra-JS inline sekitar 6 KB: latar dan token yang sama dengan `globals.css`, wordmark Bagiin, status jujur "Memuat...", dan kartu skeleton berbentuk layar beranda. Inline memang disengaja supaya tidak menambah round trip, dan warnanya disalin dari `:root` di `globals.css` agar serah terima ke React tidak berkedip.
- `createRoot().render()` mengosongkan kontainer, jadi shell hilang sendiri saat mount, tanpa kode pembersihan dan tanpa markup sisa. Hasil ukur dingin, CPU 4x, 4G, 390px DPR 3, tema terang dan gelap: `first-contentful-paint` turun 1932 ms menjadi 456 ms, skeleton terlihat sejak 414 ms (gelap 409 ms), konten React muncul 716 ms (gelap 704 ms), dan cumulative layout shift tetap 0,009. Frame pertama yang dilukis sudah bertema di kedua mode, jadi tidak ada kedip putih di mode gelap.
- Bukti: 8 assertion lulus di tiap tema, `pytest` 422 passed 1 skipped, typecheck bersih, `test:logic` 9/9, battery browser 14/14 (termasuk suite shell-states yang kini melihat skeleton).

### 2026-09-18 (v92), caching dan berat first paint di HP

- Keluhan "berasa lebih berat dari versi vanilla" bukan soal ukuran bundle: React justru lebih kecil (80 KB gzip pada graph masuk, sedangkan vanilla 141 KB gzip). Penyebabnya nginx. `location /` menambahkan `Cache-Control: no-store, max-age=0`, dan karena `location /` juga mencocokkan `/assets/*`, header itu menimpa `public, max-age=31536000, immutable` dari backend untuk setiap bundle ber-hash. Terukur: Cloudflare menjawab `BYPASS` (bukan `HIT`), dan satu kunjungan ulang di HP mengunduh ulang seluruh graph masuk. Sebagai pembanding, vanilla disajikan lewat `/static/` dengan `max-age=86400` dan `cf-cache-status: HIT`.
- Efek perbaikannya terukur pada profil HP (390px, DPR 3, 4G 1.6 Mbps, latensi 70 ms): kunjungan ulang turun dari 90,6 KB menjadi 1,3 KB transfer, dan waktu sampai aplikasi bisa disentuh turun dari 756 ms menjadi 210 ms. Header per aset sekarang benar (`/` -> `no-cache, must-revalidate` + ETag, `/assets/<hash>` -> `immutable` 1 tahun) dengan `cf-cache-status: HIT` pada permintaan kedua.
- Bug kedua yang ketemu saat yang sama, dan lebih serius: `add_header` di level location **membatalkan pewarisan seluruh `add_header` server-level**, sehingga HSTS, X-Frame-Options, X-Content-Type-Options, dan Referrer-Policy hilang dari setiap path yang mendeklarasikan `Cache-Control` sendiri (`/`, `/api/`, `/static/`, `/uploads/`). Ketiga header keamanan itu sekarang dinyatakan ulang lewat `include conf.d/security-headers.conf` di setiap location yang memakai `add_header`, dan diverifikasi ada 4/4 di `/`, `/assets/*`, `/static/manifest.json`, dan `/uploads/*`.
- `/static/` sebelumnya memakai `max-age=86400` (satu hari) sementara `/assets/` memakai `immutable` satu tahun, walau keduanya ber-hash dan sama-sama immutable. Kebijakan `/static/` sekarang mengikuti backend (satu tahun) sehingga tidak ada lagi dua aturan cache untuk berkas ber-hash.
- `manualChunks` memaksa seluruh `@phosphor-icons/react` masuk satu chunk `icons` yang ikut di-`modulepreload` dari `index.html`. Akibatnya tamu yang membuka tautan bill dari WhatsApp mengunduh semua ikon yang dimiliki aplikasi, padahal `BillRoute` hanya butuh sebagian. Chunk paksa itu dihapus dan Rollup dibiarkan menempatkan ikon per route: graph masuk turun dari 4 berkas menjadi 3, dan biaya gzip turun 3,8 KB (home) sampai 7,1 KB (recap) per path masuk. Battery browser tetap 14/14 hijau dan audit merender 0 SVG kosong di enam route.
- Audit yang dijalankan untuk mencari kode mati: Rollup module graph (24 modul `src/`, satu-satunya berkas yang tidak tercapai adalah `lib/types.ts` yang type-only dan terhapus saat build), pencarian export tanpa konsumen, pemindaian selektor CSS yang tidak pernah di-emit, dan pemisahan duplikat CSS asli dari override media query. Hasilnya: tidak ada kode atau CSS mati yang layak dihapus; hanya ada 6 selektor dengan deklarasi ganda asli bernilai sekitar 1,3 KB.
- Bukti: `pytest` 422 passed 1 skipped, typecheck bersih, `test:logic` 9/9, battery browser 14/14, dan gate CSS coverage PASS 1055 check.

### 2026-09-18 (v91), logo brand pembayaran dan perbaikan tujuan transfer

- Migrasi React menjatuhkan seluruh sistem logo brand: 34 logo resmi di `frontend/static/assets/brands/` beserta `manifest.json` dan mekanisme fallback chip-nya tetap ada dan tetap disajikan, tapi `AccountRows` menggantinya dengan satu glyph wallet generik, sehingga GoPay, OVO, dan bank biasa tampil identik.
- `frontend/src/lib/brand-logos.ts` memuat ulang manifest (cache `localStorage` seperti legacy, jadi paint pertama setelah reload tidak menunggu jaringan), daftar kanonik 34 brand beserta warna chip, pencocokan brand tanpa peduli huruf besar-kecil, dan `brandLabel` untuk penulisan nama yang konsisten. `frontend/src/components/BrandLogo.tsx` merender logo resmi, dan jatuh ke chip bernama saat brand tidak punya logo atau gambarnya gagal dimuat, sehingga baris tidak pernah menyisakan kotak kosong.
- Ditemukan saat cek integritas: helper legacy `payerPayment()` (di `frontend/static/bill.js`) tidak ikut diport, diganti `paid_by_accounts || creator_accounts`. Akibatnya bila payer adalah orang lain yang belum menyimpan metode bayar, layar bertuliskan "Bayar ke Amel" justru menampilkan rekening Aufa, yaitu mengarahkan orang mentransfer ke pihak yang salah. Helper itu dipulihkan sebagai `payerAccounts()`: rekening creator hanya dipakai bila creator memang payer, atau belum ada payer sama sekali.
- Chip brand panjang tidak lagi terpotong: "Bank Nusantara Fantasi" sebelumnya terpangkas jadi "santara" di dalam kotak 48px. Chip teks sekarang boleh melebar sampai 108px dan membungkus dua baris, sedangkan kotak logo tetap 48px agar semua logo resmi seragam.
- Integritas 34 logo diverifikasi: manifest, daftar kanonik `BRANDS`, dan berkas di disk ketiganya 34 entri dan saling cocok, semuanya HTTP 200 dengan konten sesuai brand-nya. Catatan: `https://bagiin.ardhiqi.com/static/assets/brands/*` menolak User-Agent `Python-urllib` lewat Cloudflare (403) tapi melayani User-Agent browser dengan 200, jadi probe harus memakai UA browser agar tidak salah menyimpulkan logo hilang.
- Gate diperluas: `EXPECTED_RECOVERY` mencakup `brand-logo` dan `brand-chip`, fixture membuat metode bayar nyata (GoPay, Mandiri, dan satu brand tak dikenal untuk jalur chip), dan tiap sel meng-assert bahwa setiap baris metode bayar merender logo atau chip bernama serta bahwa brand yang dikenal benar-benar menghasilkan gambar ter-decode. Kegagalan gate versi pertama justru membongkar jebakan hampa: assertnya di-gate pada "ada elemen logo", padahal tree rusak tidak merender logo sama sekali, sehingga gate tetap hijau. Sekarang jumlahnya dihitung dari baris akun, bukan dari elemen logo.
- Bukti non-vakum: gate FAIL 44 dari 1055 check (exit 1) pada tree sebelum perbaikan dan PASS 1055 check (exit 0) pada tree sesudahnya. Battery browser 14/14 hijau, `pytest` 422 passed 1 skipped, typecheck bersih, `test:logic` 9/9.

### 2026-09-18 (v90), kontras token dark mode dan label kontrol yang membungkus

- React port menjatuhkan token `--on-accent` / `--on-green` / `--on-red` dari design system legacy dan menggantinya dengan `#fff` yang di-hardcode. Token itu ada justru karena aksen dark mode sengaja terang: `.btn-primary` di dark mode jadi putih di atas `--accent #F97316` = 2.80:1, gagal WCAG AA (minimal 4.5:1). Nilai legacy `--on-accent:#231202` mengembalikan 6.46:1. Bug ini hanya muncul di dark mode, dan gate lama berjalan light-only sehingga tidak pernah melihatnya.
- Token `--on-accent` / `--on-green` / `--on-red` dipulihkan per tema (`#ffffff` di light, `#231202` di dark) dan `.btn-primary`, `.btn-danger`, `.btn-success`, `.brand-mark`, `.onboarding-mark`, `.is-selected .item-check`, serta `.app-nav-badge` sekarang memakai token itu, bukan `#fff` literal. Light mode tidak berubah nilainya (semua sudah 5.19:1 ke atas).
- `.choice-grid` dan `.btn-row` tidak pernah punya fallback mobile. Pada 320px dua kartu `#/create` hanya selebar 139px sehingga label "Foto struk" dan "Isi manual" membungkus dua baris, dan dua tombol di baris aksi bill membungkus sampai tiga baris di dalam kontrol 46px. Keduanya sekarang menumpuk satu kolom di bawah 560px; label kembali satu baris dan target 44px tetap utuh.
- `--text-3` dark mode dinaikkan `#928878` menjadi `#a49a8a` karena 4.30:1 di atas `--surface-2` masih di bawah AA (nilai baru: 4.84:1 pada surface terburuk).
- Dua regresi pada gate ikut diperbaiki: assertion `.btn-row` yang memaku `display:flex` kini menerima `flex` atau `grid` (menumpuk di HP memang benar), dan pemeriksaan kontras hanya berlaku untuk kontrol yang benar-benar merender teks di atas fill-nya sendiri sehingga track `.switch` tidak lagi dihitung.
- Gate `tools/e2e_css_coverage.mjs` diperluas: route `#/create` ditambahkan (layar yang dilaporkan user justru tidak pernah masuk matriks), matriks kini berjalan di dua color scheme pada lebar 320-412px, dan ada dua assertion baru per sel: teks pada kontrol ber-fill solid harus lolos WCAG AA, dan label kontrol tidak boleh membungkus. Lantai check dinaikkan mengikuti sel dark tambahan.
- Bukti non-vakum: gate versi baru menghasilkan FAIL 54 dari 1011 check (exit 1) pada tree sebelum perbaikan dan PASS 1011 check (exit 0) pada tree sesudahnya. Jumlah check naik dari 467 menjadi 1011 karena route create dan sumbu dark mode.
- Bukti lain: `pytest` 422 passed 1 skipped, typecheck bersih, `test:logic` 9/9, dan pengukuran langsung `getComputedStyle` pada setiap tombol ber-fill di light dan dark mode menunjukkan 0 pelanggaran kontras (sebelumnya `.btn-primary` 2.80:1, `.btn-danger` 2.77:1, `.btn-success` 1.74:1 di dark).

### 2026-09-16 (v89), pemulihan design system React, kontrak pilihan, dan gate CSS

- Migrasi React sebelumnya mengirim `frontend/src/styles/globals.css` sebagai pengganti sebagian, bukan salinan, dari design system yang tinggal di blok `<style>` `frontend/index.html`. Akibatnya 63 nama class yang benar-benar di-render `frontend/src/**` tidak punya rule CSS sama sekali sementara rule-nya masih ada di `index.html`. Batch ini memulihkan seluruh set itu ke `globals.css` dengan blok alias token legacy (`--r-xs/sm/md/lg/full`, `--ease`) supaya rule yang disalin tetap identik dengan sumbernya, dan tidak ada `var()` yang menggantung.
- Yang ikut pulih: `.chip` beserta varian tone-nya, `.history-row` termasuk bar status `::before` dan tint `.status-mark` per status, `.item-row` sebagai flex row (konflik dengan `.bill-item` diselesaikan dengan menghapus deklarasi layout `.bill-item`), `.item-full`, `.btn-row`, `.toggle-row`, `.avatar-me`, `.delete-bill`, `.slot-mgr`, `is-pay/is-receive/is-unknown`, `.hidden`, dan seluruh keluarga `.recap-*` beserta override 359px/1040px-nya. Sebelum pemulihan, sel ringkasan Rekap saling menimpa (label, nominal, dan catatan jatuh ke satu baris teks).
- Filter Home dulu tampil dua kali di semua lebar karena swap CSS-only legacy (`.list-controls-inline` hidden lalu tampil di 1040px, `.list-ctl-btn` disembunyikan di 1040px) tidak ikut terbawa. Swap itu dikembalikan sehingga di bawah 1040px hanya tombol "Atur" yang tampil dan baris bill pertama tidak lagi terdorong jauh ke bawah, sementara di 1040px ke atas hanya kontrol inline yang tampil. Tidak ada percabangan lebar di JS.
- Tone status Home sekarang benar. `HomeRoute` mengirim `status-danger/neutral/success` sementara CSS hanya punya `status-due/ok/idle`, dan `.avatar` menang specificity sehingga setiap baris memakai tint accent yang sama. Rule diganti menjadi `.status-mark.status-*` (specificity 0,2,0) dan memetakan `danger/due`, `success/ok`, `neutral/idle`.
- Tujuh karakter em-dash/en-dash dihapus dari copy yang terlihat pengguna (`frontend/src/**`): placeholder rupiah memakai hyphen biasa, dan dua dialog hapus bill dipecah menjadi dua kalimat.
- `POST /api/bills/{id}/selections` tidak lagi menganggap body tanpa key yang dikenali sebagai "hapus semua pilihan". Body tanpa `picks` maupun `item_ids` sekarang 400 `Daftar pilihan wajib diisi`, sedangkan `{"picks": []}`, `{"item_ids": []}`, dan `{"picks": null}` tetap menghapus dan menjawab 200. Guard memakai ada-tidaknya key, bukan berguna-tidaknya nilai.
- `DELETE /api/bills/{id}/people/{identity_id}` untuk orang yang memang tidak ada di bill sekarang 404 `Orang ini tidak ada di bill`, bukan 200 tanpa efek. Urutan guard dipertahankan: 403 (bukan manager), 403 (bill ditutup), 400 (hapus diri sendiri), 404 (bukan anggota), baru mutasi.
- Gate baru `tools/e2e_css_coverage.mjs` menutup lubang yang membuat batch ini bisa lolos: harness lama hanya memeriksa geometri, overflow, dan a11y, sehingga UI yang jelas rusak tetap hijau. Gate baru berjalan pada 10 route x 7 lebar, menghitung coverage rule CSS langsung dari CSSOM runtime (memeriksa `selectorText` sebelum `cssRules`, karena `CSSStyleRule` sekarang juga mengekspos `cssRules` sehingga bentuk rekursi yang umum melewati setiap style rule), menegaskan nilainya lewat `getComputedStyle`, memeriksa swap kontrol Home, overflow, dan error konsol, serta gagal bila jumlah check di bawah ambang supaya tidak bisa lolos secara hampa.
- Regression v89 mencakup 12 test di `backend/test_regressions_v89.py`: body tanpa key/wrong key/unknown key ditolak 400 dan pilihan yang sudah ada tetap utuh di bill (assertion kelangsungan data, bukan sekadar status code), `picks: []`/`item_ids: []`/`picks: null` tetap menghapus, jalur legacy `item_ids` dan merge duplikat tetap jalan, kasus 400 lama tetap 400, serta remove-person 404/403/400 dengan keanggotaan yang tidak berubah.
- Bukti verifikasi: `pytest` 422 passed 1 skipped (baseline 410/1), typecheck bersih, `test:logic` 9/9, build sukses, dan seluruh 14 driver browser hijau. Gate baru dibuktikan tidak hampa dua arah: `RESULT FAIL (217 dari 460 check gagal)` dengan exit 1 pada tree sebelum perbaikan, dan `RESULT PASS (checks=460)` pada tree sesudahnya. `tools/e2e_create.mjs` ikut disesuaikan karena dua assertion-nya memaku placeholder em-dash yang sengaja dihapus batch ini.

### 2026-09-14 (v88), polish responsive UI/UX React dan integrasi komponen

- Layout React sekarang memakai breakpoint yang eksplisit: form dan grid menumpuk di layar sempit, rail desktop baru aktif saat ruang cukup, dan daftar bill/rekap dapat menyusut tanpa horizontal overflow.
- Fixed mobile navigation dan contextual action dock menghormati safe area serta reserve ruang berdasarkan tinggi surface yang benar-benar dirender. Field yang sedang fokus tidak tertutup dock, termasuk saat keyboard virtual mengubah viewport.
- Create/manual verify, bill detail, home, settings, dan recap memakai primitive UI project-owned yang sama, dengan kontrol minimum 44px, wrap untuk label panjang, dan state loading/error/empty yang tetap terbaca di mobile maupun desktop.
- Kontrak API, schema, kalkulasi uang, status final/payment, guest flow, identity recovery, dan `frontend/static/` fallback tidak berubah. Tailwind tidak ditambahkan sebagai dependency karena CSS design tokens yang sudah ada cukup untuk batch ini.
- Browser regression baru mencakup shell, dock/nav clearance, overflow, breakpoint `320` sampai `1440px`, light/dark state, storage isolation, dan zero page/console error. Full pytest serta flow create, smoke, settled, recap, guest guard, legacy recovery, creator, payment, deletion, dan rounding tetap diverifikasi sebelum merge.

### 2026-09-14 (v87), recovery identity legacy tanpa trust-on-first-use

- Identity lama dengan `secret IS NULL` tidak lagi dianggap terautentikasi hanya karena public `identity_id`. Semua operasi identity-scoped yang mengubah data sekarang memerlukan secret sesi yang benar.
- `POST /api/identities/{id}/bind` menerima recovery code sebagai bukti kepemilikan. Binding secret memakai update bersyarat yang atomic, sehingga code kosong/salah, identity yang sudah terikat, dan race request tidak dapat mengeluarkan secret baru.
- `POST /api/identities/restore` mempertahankan alur pemulihan lama, tetapi sekaligus mengikat secret untuk identity legacy yang valid. Restore yang salah tidak mengubah data.
- Frontend legacy tidak lagi melakukan bind otomatis dengan body kosong. API client React mengetik bind sebagai request yang wajib membawa recovery code, sementara restore tetap kompatibel dengan response yang sudah memiliki secret.
- Regression v87 mencakup id-only write, bind tanpa/salah/non-text code, valid bind dan restore, second bind, concurrent restore, existing secret, public bill read, dan secret non-disclosure. Full pytest dan frontend checks wajib dijalankan sebelum merge.

### 2026-09-09 (v82), audit integrasi halaman dan komponen

- Field koleksi untuk peserta, pilihan item, dan item legacy yang malformed sekarang ditolak sebagai HTTP 400, bukan error 500 atau TypeError yang lolos ke pengguna. Target pembayaran yang belum menjadi member bill juga tidak dapat diubah statusnya.
- Root upload disamakan antara modul database dan aplikasi. Path foto bare filename dan path absolut diperlakukan sebagai referensi yang sama saat proteksi penghapusan, dan file upload dibersihkan kembali kalau penyimpanan relasi foto gagal.
- Nilai numerik `tax_included: 1` dari provider OCR dinormalisasi sebagai boolean true, sehingga pajak tidak ikut terhitung dua kali.
- Brand rekening/e-wallet di semua halaman mencocokkan manifest tanpa membedakan huruf besar-kecil. Brand yang tidak dikenal tetap memakai chip teks yang di-escape, tanpa memperluas data brand atau menyuntikkan HTML berbahaya.
- Editor bill tersimpan sekarang memberi identitas pada setiap baris item sehingga perubahan harga atau diskon langsung menyegarkan total baris yang terlihat, sementara perubahan jumlah tetap memakai kalkulasi canonical yang sama.
- Regression v82 mencakup validasi collection, membership pembayaran, cleanup upload gagal, normalisasi OCR, proteksi path foto legacy, brand casing/fallback, dan edit bill tersimpan di browser.

### 2026-09-08 (v78), fallback OCR gratis multi-model

- OpenRouter OCR sekarang punya urutan model vision gratis, dimulai dari `google/gemma-4-26b-a4b-it:free`, lalu lanjut ke kandidat gratis lain bila provider mengembalikan rate limit, model unavailable, timeout, output tidak valid, atau format JSON terstruktur ditolak.
- Override `OPENROUTER_OCR_MODELS` menerima daftar comma-separated dan tetap kompatibel dengan `OPENROUTER_OCR_MODEL` lama. ID berbayar tidak dipilih oleh parser fallback.
- Budget OCR tetap satu deadline bersama, tetapi sebagian waktu dicadangkan untuk OpenRouter supaya Gemini yang lambat tidak mematikan fallback. Contract hasil OCR publik tidak berubah.
- Fallback ini meningkatkan peluang saat satu provider penuh, tetapi tidak menggandakan kuota gratis OpenRouter yang tetap dibatasi di level akun dan kapasitas upstream.

### 2026-09-07 (v76), finalisasi bill dari tampilan creator

- Creator atau manager kembali punya tombol "Tutup Bill" hanya saat bill masih open. Setelah berhasil, tampilan dimuat ulang dan tombol berubah menjadi "Buka Bill Lagi".
- Konfirmasi penutupan menampilkan peserta yang belum memilih, bagian slot yang kosong, dan item yang belum dipilih. Warning tersebut tetap terlihat setelah bill ditutup.
- Menutup bill hanya memfinalkan alokasi item. Aksi ini tidak menandai pembayaran lunas, sehingga orang yang belum bayar tetap terbaca belum bayar.
- Regression source-level, API, dan browser mencakup warning pending, slot uncovered, batas akses non-owner, guest read-only, dan zero console error.

### 2026-09-07 (v77), alokasi final Rekap terpisah dari settlement

- Tampilan creator tidak lagi menyediakan tombol **Tutup Bill**. Warning peserta yang
  belum memilih, slot uncovered, dan item yang belum dipilih tetap tampil sebagai
  informasi pembagian; jalur `reopen` dan API close lama dipertahankan hanya untuk
  kompatibilitas bill yang sudah terlanjur closed.
- Rekap menentukan `final` dari alokasi yang sudah lengkap, bukan dari aksi menutup
  bill. Bill yang masih `open`, `settled: false`, dan `all_paid: false` boleh masuk
  saldo final bila semua nominal sudah teralokasi; aksi `pay_share`/`wait_payment`
  tetap muncul dan tidak lagi diberi tanda provisional.
- Membaca Rekap adalah klasifikasi turunan: tidak mengubah `status`, tidak membuat
  payment row, dan tidak menandai pembayaran lunas. `settled`/`all_paid` baru berubah
  mengikuti state pembayaran yang benar-benar dicatat.
- Bill tetap provisional bila ada pilihan nyata yang belum masuk, slot yang belum
  terambil, payer yang belum bisa di-resolve, `total_ok` false, invite-only yang
  belum menerima undangan, atau bill open tanpa selection sama sekali.

### 2026-09-06 (v71), OCR receipt gratis yang lebih ketat

- Prompt OCR sekarang membedakan harga satuan, jumlah dibeli, potongan, dan total baris. Contoh `2 × Rp35.000 = Rp70.000` ditulis eksplisit supaya harga baris tidak salah dibaca sebagai harga satuan.
- Model diminta menyalin nama merchant persis dari header. Kalau header buram atau meragukan, hasilnya harus dikosongkan, bukan ditebak.
- OpenRouter diminta mengembalikan JSON terstruktur. Fallback hanya dijalankan kalau provider secara eksplisit menolak `response_format`, bukan untuk semua error request.
- MIME asli JPEG, PNG, atau WebP dipertahankan saat bytes foto tidak diubah. Bytes yang diproses ulang dikirim sebagai JPEG yang sesuai.
- Contract hasil OCR publik tetap sama: `name`, `price`, `discount`, dan `quantity`. Baris duplikat tetap terpisah, quantity yang hilang tetap `1`, dan total tetap dihitung dari harga satuan, diskon, serta quantity.
- Regression test mencakup pola quantity struk Ayam Aroma, kontrak JSON OpenRouter, fallback terarah, dan MIME upload.

### 2026-09-06 (v70), audit logic dan keamanan upload

- OCR sekarang menghitung subtotal berdasarkan harga satuan, diskon, dan quantity, termasuk diskon penuh serta validasi tanggal kalender nyata.
- Boolean API untuk `tax_included` dan `auto_accept` diparse strict tanpa mengubah default backward-compatible saat field opsional tidak dikirim.
- Upload JPEG, PNG, dan WebP diverifikasi dari magic bytes. Ekstensi serta MIME yang disajikan mengikuti format aktual.
- Path foto harus berupa file reguler langsung di bawah upload root. Path di luar root, symlink, dan nested symlink ditolak.
- Urutan penyimpanan selection diperbaiki agar claim participant gagal secara atomic saat selection tidak valid.
- Guard async frontend diperketat untuk bill list, invite Home, Settings, dan account creation agar response stale tidak menimpa screen baru.
- Regression suite backend, HTTP E2E, frontend logic, mutation, security, dan path foto ditambahkan atau diperkuat.

### 2026-09-06 (v69), editor manual quantity dan responsive

- Subtotal manual mengikuti `harga satuan × jumlah dibeli − potongan`, termasuk validasi backend create dan update.
- Editor item mobile memakai label permanen, quantity stepper 44px, total baris yang jelas, mode split yang dijelaskan, dan dock yang menjaga focus serta validasi tetap terlihat.
- Desktop mempertahankan kolom eksplisit untuk nama, harga satuan, jumlah dibeli, potongan, dan aksi hapus.
- Regression browser mencakup 28 kombinasi viewport, tema, quantity valid atau invalid, OCR, date placeholder, dock clearance, dan desktop grid.

### 2026-08-19 (v68) — satu daftar di menu utama + desktop yang gak melar

**Riwayat dihapus, home yang pegang daftarnya**

Home dan Riwayat itu daftar yang sama, dua kali. Sekarang tinggal home, dan `#/history`
diarahin ke `#/` (bukan dimatiin — ada yang nyimpen bookmark / kebuka di tab).

Kendala yang ngebentuk layoutnya: filter pernah ada di home dan bikin baris bill pertama
kedorong ke bawah lipatan di HP 390px — itu justru alasan filternya dulu dipindah keluar.
Jadi sekarang di HP cuma ada satu tombol kecil **⇅ Atur** di header kartu (ada penanda
angka kalau lagi ada pilihan non-default) yang buka sheet; di ≥1040px kontrol yang sama
digelar inline. Sakelarnya CSS, bukan cek lebar di JS, jadi resize gak pernah ninggalin
layar di mode yang salah. Terukur: baris pertama nangkring di 336px pada layar 390×844.

**Sortir (baru)**

Terbaru · Terlama · Paling besar · Paling kecil · Belum beres dulu. Dua detail yang
sengaja: sortir pakai tanggal yang **sama** dengan yang ditampilin baris dan dipakai
header bulan (banding string mentah itu UTC dan beda sama dua-duanya), dan **header bulan
ilang kalau sortirnya nominal** — "AGUSTUS 2026" di atas baris dari empat bulan itu bohong.

Sortir disimpen antar-reload; filternya sengaja **enggak** — buka app langsung ketemu
daftar kefilter bikin bill kelihatan kehapus.

**Nominal 7 digit nabrak tombol hapus**

`Rp 1.875.000` nembus keluar barisnya dan masuk ke kolom tombol hapus — terukur 59px
tumpang tindih di 390px. Chip status sama nominal dua-duanya dikunci gak boleh mengecil;
sekarang yang ngalah chip-nya, duitnya gak pernah dipotong.

**Desktop: dikomposisi, bukan dimelarin**

Di 1440 kotak "Judul Bill" selebar **920px** dan paragraf ngalir **136 karakter per
baris** (nyaman itu 45–75), sementara home/settings dipusatin 680px — dua layout beda di
satu app, gara-gara layar ber-rail bikin kolom kirinya ngisi semua sisa ruang.

Motong kolomnya doang pernah dicoba dan dibalikin (rail-nya jadi ngambang jauh dari
isinya). Jadi sekarang form + rail diperlakukan sebagai **satu komposisi yang dipusatin**
(720 + 320): margin kiri-kanan seimbang, rail tetap nempel ke isinya. Topbar ikut
disamain lebarnya.

Lebarnya dipakai buat kepadatan: di desktop Judul + Tanggal sebaris, dan satu baris item
muat nama | harga | potongan | hapus — potongan tadinya turun sendiri dan nyisain ~700px
kosong. Teks berjalan dibatasi 65ch.

Terukur di 1440: kolom utama 954 → **720**, input terlebar 920 → **567**, paragraf
terpanjang 131 → **83** karakter. Sama persis di 1280/1440/1920.

Sekalian: mepetin tiga field jadi satu baris bikin dua kotak "0" kembar tanpa penanda —
label potongannya cuma kebaca screen reader. Desktop sekarang punya header kolom
(Nama item · Harga · Potongan); di bawah 1040px header itu gak ada dan labelnya utuh.

**Layout HP gak gerak sepiksel pun** — semua di dalam query ≥1040px, dibuktiin dengan
diff gambar 390px sebelum/sesudah.

184 tes + tiga suite browser lulus.

### 2026-08-19 (v67) — audit lanjutan 2 + deploy

Pass ketiga, hasil audit paralel (undangan+foto, alur bikin bill, identitas/auth, sweep
visual 390px). Semua di bawah ini udah live di produksi (restart 2026-08-19 01:26).

**Duit: estimasi di dock sekarang persis sama dengan server**

`bill.js` ngitung ulang bagian kamu di JS biar angkanya gerak pas ngetuk item, tapi sisa
pembulatannya beda sama `calc.py` — jadi angkanya "tik" berubah pas server jawab
(3.833 → 3.834). Sekarang sisa pembulatannya dibagi sama persis kayak backend, buat item
bebas maupun item slot yang penuh, dan gak ikut masuk basis pajak (sama kayak di sana).
Dikunci sama suite baru `tools/e2e_rounding.mjs` yang sengaja pakai harga yang gak habis
dibagi, dicek dua kali: pas ngetuk dan setelah respons masuk.

**Keamanan & data**

- **Path foto gak divalidasi.** `POST /api/bills` nerima string apa pun sebagai path foto,
  termasuk path foto bill orang lain — yang lalu kesajiin ke semua orang yang pegang link
  kita. Sekarang tiap basename wajib cocok sama pola yang emang server ini bikin.
- **Foto yang dibuang sebelum bill jadi nyangkut selamanya di server.** Tombol ✕ di
  editor cuma ngapus dari array di browser. Sekarang ada `DELETE /api/photos/{filename}`
  (nolak file yang masih dipakai bill) dan klien manggilnya di semua jalur buang: ✕,
  tombol back, back sistem, dan retry scan — yang ternyata juga ninggalin foto lama tiap
  kali dipencet.
- **Undangan yang ditolak bisa dipaksa masuk lagi.** Undang ulang orang yang auto-accept-
  nya nyala langsung nyeret dia masuk, jadi "Tolak" bisa dibatalin sepihak. Sekarang
  undangan ulang setelah ditolak selalu pending.
- `/uploads/` kirim `X-Content-Type-Options: nosniff`.

**Kinerja**

Daftar bill nge-load tiap bill **dua kali** (query daftar → `_bill_settled` → `get_bill`,
terus `my_bills` → `get_bill` lagi): 242 koneksi SQLite buat 60 bill. Sekarang 122, dengan
payload yang sama persis.

**UI (temuan sweep visual 390px, terang & gelap)**

- **Sheet bayar mecah nama item jadi satu kata per baris.** Kolom harga `flex-shrink:0`,
  jadi catatan diskon ngunci kolom itu ~180px dan nama keremes: "Ayam Bakar Bumbu Rujak
  Pedas Level 5" jadi tujuh baris — di layar terakhir sebelum orang transfer duit.
  Catatan harganya pindah ke bawah nama; sekarang dua baris.
- Sheet "ubah yang nalangin" ngisi otomatis kotak "buat yang belum join" pakai nama payer
  yang udah kepilih, jadi satu orang muncul dua kali di satu sheet.
- Spinner "Lagi baca struknya" gak pernah muncul pas retry scan — hash diganti dan
  `uploadAndOcr` dipanggil di tick yang sama, jadi pencarian `#create-body` jalan sebelum
  router sempat ngegambar.
- Rekening dobel pas paste ke-deteksi (nomor + brand dinormalisasi), toggle auto-accept
  jadi 40px, foto yang filenya ilang nampilin placeholder bukan ikon rusak, baris item di
  layar manager gak pecah tiga baris lagi di HP, dan `#app` berhenti melar di 1400px
  (di 1920 "Judul Bill" tadinya selebar 1440px).

**Tes**

184 lulus (14 baru di `test_regressions_v67.py`, termasuk satu yang ngunci "daftar dan
layar bill harus sepakat" di lima keadaan sekaligus). Tiga suite browser:
`e2e_smoke` (angka tamu = angka server), `e2e_settled` (satu bill satu jawaban),
`e2e_rounding` (estimasi = server sampai rupiah terakhir).

### 2026-08-18 (v66) — audit lanjutan: bill gak bisa dihapus, service charge ilang

Pass kedua, hasil audit paralel per-fitur (undangan+foto, alur bikin bill/OCR,
identitas). Yang di bawah ini yang udah masuk; sisanya nyusul di entri yang sama.

**Bill yang pernah diundang gak bisa dihapus — dan sempat ngunci DB**

`bill_invite` nunjuk ke `bill(id)` dan tiap koneksi jalan dengan `foreign_keys = ON`,
tapi `delete_bill` gak pernah ngapus barisnya. Sekali tap "Hapus Bill" di bill yang
pernah diundang (jalur `auto_accept` default nulis satu baris tiap undangan) →
`IntegrityError` → 500 yang badannya diganti halaman error Cloudflare, dan billnya
**gak bisa dihapus selamanya**. Lebih parah: exception-nya ninggalin koneksi dengan
transaksi tulis kebuka, jadi request tulis lain di app ikut gagal "database is
locked" sampai koneksinya di-GC. Sekarang undangannya ikut dihapus dan fungsinya
exception-safe (rollback + close di `finally`).

**OCR ngapus service charge di struk "termasuk pajak"**

`_normalize` nge-nol-in `service` barengan `tax` waktu `tax_included`. Padahal
`calc.py` sengaja **tetap** misahin service charge di bill tax-included, dan editor
tetap nampilin field Service di bawah toggle-nya. Jadi Rp 10.000 SC ilang sebelum
user sempat lihat formnya, dan diam-diam nempel ke yang nalangin. Sekarang cuma
pajak yang di-nol-in; promptnya ikut dibenerin.

**OCR: 500, tanggal hantu, dan request 7¾ menit**

- Model kadang balikin JSON valid tapi bukan object (array telanjang, `null`, string).
  `_normalize` langsung `.get()` → `AttributeError` di luar semua handler → HTTP 500.
  Sekarang `RuntimeError`, yang emang udah ditangkep jadi 4xx.
- Tanggal non-ISO ("08/08/2026") bikin `<input type="date">` kelihatan **kosong** tapi
  nilainya tetap kebawa ke bill — lalu pengelompokan bulan dan filter tahun/bulan di
  daftar bill gagal parse. Sekarang dibuang kalau bukan `YYYY-MM-DD`.
- Satu request bisa jalan ~465 detik (Gemini 3×60s + backoff, lanjut fallback 3×90s).
  Cloudflare mutus di 100 detik dan balikin 524-nya sendiri, jadi sisanya kerja buat
  yang udah gak nunggu. Sekarang dua provider berbagi satu budget 45 detik.
- Pesan gagalnya nyebut nama env var dalam bahasa Inggris ("Gemini: GEMINI_API_KEY not
  set") di bawah judul yang bohong ("lagi penuh" padahal servernya belum disetel).
  Detail teknis pindah ke log.

**Back browser ngapus struk yang udah diketik ulang**

Layar verifikasi itu tempat orang ngetik ulang satu struk penuh, dan keluar dari situ
= ilang semua — makanya tombol back di app-nya udah lama nanya dulu. Tapi layar itu
gak punya route sendiri (hash-nya tetap `#/create`), jadi gesture back Android
langsung nembus ke router lewat `hashchange` dan isinya ilang tanpa peringatan:
satu-satunya gesture yang beneran dipakai orang di HP justru yang gak dijaga.

Sekarang editornya punya `#/create/verify` (masuk pakai `replaceState`, jadi gak
nambah entri history) dan `app.js` punya leave-guard di level router. Tiap jalan
keluar yang disengaja (simpan, tombol back, "Coba Scan Lagi") ngebersihin guard-nya,
jadi gak mungkin nyangkut dan bikin navigasi mati. Diuji di Chrome: back sistem
nanya dan semua ketikan utuh pas dibatalin, editor kosong keluar tanpa nanya, dua kali
back cepat (~140ms) cuma buka satu sheet dan gak ngapus apa-apa, load dingin ke
`#/create/verify` mendarat di layar buat-bill, dan deep link + suite e2e gak keganggu.

**Backend: 14 lubang dari audit**

- Siapa pun yang pegang link bisa **nyelundup ke roster** lewat
  `POST /payments/{id}/paid` — endpoint-nya cuma ngecek "ini gw?", gak pernah "gw ada
  di bill ini?", padahal `INSERT OR IGNORE` di situ bikin baris payment sendiri. Itu
  sama aja kayak `/join`, bedanya ini juga ngubah `len(people) > 1` — salah satu
  penjaga bill solo biar gak auto-lunas.
- `can_manage` di daftar bill sempat dikasih ke payer yang belum dikonfirmasi.
- Creator yang udah keluar gak bisa diundang balik (`identity_on_bill` ngitung dia
  terus).
- Foto masih bisa ditambah/dihapus di bill yang udah ditutup lewat API, padahal
  tombolnya disembunyiin — jadi foto di bill tertutup gak bisa dihapus selamanya.
- `POST /api/identities/restore` bisa dibikin 500 sama **siapa aja tanpa login**
  (body `{"code": [1,2,3]}` → `.strip()` di list). Plus body JSON non-objek, harga 20
  digit (OverflowError di sqlite), `PUT /api/accounts/{id}` yang gak lewat
  `_read_json`, endpoint foto yang nerima file apa aja, dan `/uploads/<direktori>`.
- Edit parsial diem-diem nge-null-in `merchant`/`transacted_at` — dan `transacted_at`
  sekarang nentuin urutan + filter bulan di daftar bill.
- Undangan pending sekarang kelihatan sama yang ngirim (khusus manager) dan bisa
  dibatalin.

**Lain-lain**

- Layar 1920px: kolomnya melar sampai "Judul Bill" selebar 1440px dan nama item
  kepisah sejauh layar dari harganya. Sekarang berhenti di 1400px — di bawah itu gak
  ada yang berubah, rail-nya tetap nempel di kanan.
- Creator yang udah keluar dari billnya masih kelihatan "Udah di bill ini" di sheet
  undangan, jadi gak bisa diundang balik.
- "Tambah Foto" di layar bill satu-satunya jalur foto tanpa cek 5MB — foto 12MB
  keupload penuh dulu baru ditolak.
- Sheet undangan nampilin kotak kosong selama kontak dimuat.
- `.btn-sm` (dipakai "Gabung", "Undang", "Tandai Lunas") 38px dan tombol hapus foto
  36px → 40px.

### 2026-08-18 (v65) — audit pass: takeover ditutup, UI dirapihin lagi

Pass audit penuh setelah v59–v64 (filter+paging riwayat, undangan langsung,
stepper inline, multi-foto, settle sekaligus, konfirmasi payer by name).

**Keamanan**

- **Bill bisa direbut lewat nama payer.** Bill dibikin "dibayar Budi". Siapa pun
  yang pegang link bisa ganti namanya jadi "budi", join, terus pas si pembuat
  ngetuk "Pakai Nama Ini" (kelihatannya gak ngapa-ngapain — namanya udah keisi
  duluan), backend nge-set `paid_by_confirmed = 1` → orang itu jadi **satu-satunya**
  owner: pembuatnya kena 403 di billnya sendiri dan bill-nya bisa dihapus orang
  lain. Ini aturan v51 yang bocor lagi dari sisi lain. Sekarang cuma `identity_id`
  eksplisit (banner konfirmasi v62) yang nge-confirm; jalur nama tetap nyambungin
  identitas buat tampilan doang.
- **Hapus foto gak dibatesin ke bill-nya.** `DELETE /api/bills/{bill}/photos/{id}`
  nyari foto by id doang. Id foto itu autoincrement global dan dikirim ke semua
  yang bisa baca bill, jadi orang bisa ngehapus foto bill orang lain lewat bill
  miliknya sendiri. Sekarang query-nya `WHERE id = ? AND bill_id = ?`.
- **Hapus bill sendiri bisa ngilangin struk orang lain.** Path foto ikut di
  payload, jadi bisa dipasang ke bill sendiri; pas bill itu dihapus, file-nya
  di-unlink — punya korban. `_unlink_photo` sekarang nolak hapus file yang masih
  dipakai bill lain.
- **Foto yang dihapus balik lagi tiap restart.** `init_db` nge-backfill kolom lama
  `bill.photo_path` ke `bill_photo` tiap boot, sementara hapus foto cuma ngapus
  baris `bill_photo`. Sekarang kolom lamanya ikut dikosongin.

**Status yang saling bantah**

- "Tandai Lunas" (v60) di bill solo: layar bill bilang **Lunas**, daftar di home
  bilang **Belum ada yang milih** — `_bill_settled` keburu return di cek "belum
  ada yang milih" sebelum baca flag manualnya. Padahal bill solo justru alasan
  tombol itu ada.
- Bill yang di-Tandai Lunas: header hijau "Lunas" tapi tiap baris orang masih
  nampilin tombol "Tandai Lunas", dan layar tamu masih nagih. Sekarang UI baca
  `settled_manual`.
- Bill ditutup + ditandai lunas manual masih nyetak "masih ada Rp X yang belum
  dibayar" merah di bawah chip hijau "Ditutup · lunas".
- Undangan yang **ditolak** gak bisa diundang lagi selamanya: `create_invite`
  balikin baris `declined`, endpoint-nya lapor "pending", yang diundang gak pernah
  liat kartunya. Sekarang di-reset jadi pending.
- Cek kontak buat undangan pakai daftar yang di-`LIMIT 50`, padahal pencarian
  kontak nyaring sebelum limit — jadi kontak ke-51 muncul di picker tapi ditolak
  "bisa ngundang orang yang udah pernah share bill aja". Sekarang pakai
  `db.is_contact()` tanpa limit.

**UI — HP dan desktop**

- **Baris item yang dicentang jebol di HP.** Stepper (−/+) + harga + checkbox
  nyisain ~90px buat nama, jadi "Ayam Bakar Madu" pecah jadi tiga baris. Di layar
  ≤430px stepper sekarang turun ke barisnya sendiri, tombolnya jadi 40px, dan
  keterangan "kamu 1×" dicopot (steppernya udah nunjukin angka yang sama).
- **Sheet bayar gak nyebut mau transfer ke mana.** Ini layar terakhir sebelum
  orang beneran ngirim duit, judulnya "Konfirmasi Item" dan isinya cuma daftar
  item — nomor rekeningnya ada di tombol lain di layar belakangnya. Sekarang:
  "Bayar ke <nama>", total, lalu **Kirim ke** + rekening/e-wallet + tombol Salin.
- **Home = salinan Riwayat.** Dua-duanya daftar bill lengkap dengan empat chip
  filter dan dua dropdown; di HP filternya doang udah makan setengah layar.
  Home sekarang cuma 4 bill terakhir + "Lihat Semua"; filter tinggal di Riwayat.
- **Filter tahun gak bisa dibalikin ke "Semua tahun".** Opsinya kehapus tiap
  daftar dimuat, jadi selectnya nulis "2026" padahal filternya mati, dan sekali
  milih tahun gak ada jalan pulang.
- Chip status "Belum dipilih" pakai warna aksen — di daftar normal empat baris
  ikutan oranye, warnanya sama kayak tombol utama, jadi gak ada yang menonjol.
  Sekarang warna = duit: hijau beres, merah masih ada tagihan, abu netral.
- Kartu owner nyetak chip status yang **sama persis dua kali** ("Rp 88.975 belum
  dibayar" di atas dan lagi 12px di bawahnya). Diganti bar progress "udah masuk".
- Tiga tombol full-width numpuk di kartu owner (Tandai Lunas / Tambah Foto /
  Metode Bayar) tanpa hierarki — yang paling berdampak malah paling atas.
  Sekarang dua utilitas sebaris, aksi duitnya sendirian di bawah.
- Baris orang di HP: nama + rincian + total + chip + tombol hapus rebutan 326px.
  Sekarang totalnya turun ke baris kedua.
- Toggle "Baca Otomatis" bohong: `aria-checked` di-hardcode `true`, padahal
  scanMode disimpen di module — matiin sekali, buka lagi, kelihatannya nyala tapi
  OCR-nya mati.
- PPN ilang di editor: nambah/hapus foto nge-reset `taxSaved` ke 0 kalau "harga
  termasuk pajak" lagi nyala.
- Tombol hapus 20–34px (chip peserta, hapus foto, hapus orang, stepper) dinaikin
  ke ≥30–40px. Tombol hapus bill di baris yang bukan punya kita gak dirender lagi
  sebagai tombol mati.
- Copy: "Parse" → "Cek Teksnya", "OCR gak nemu item" → "Struknya gak kebaca
  jelas", DOMException mentah di toast clipboard diganti instruksi, chip status
  konsisten sentence case.
- ~110 baris kode mati dibuang (`openFreePickerSheet`, `computeMyTotal` — sisa
  dari perpindahan ke stepper inline).

**Tes**

- `backend/conftest.py` baru: suite-nya selama ini kebind ke direktori upload
  **produksi** (`/var/www/bagiin-uploads`) karena cuma `BAGIIN_DB` yang di-set per
  file — di VPS itu berarti nulis JPEG tes ke folder live. Rate limiter juga
  dimatiin pas tes (bucket-nya global per-IP, suite-nya nge-429 sendiri).
- `test_regressions_v65.py` (8 tes) buat semua temuan di atas. Total 138 lulus.
- ⚠️ `test_regressions_v62.py::test_confirm_by_name_resolves_and_confirms` sekarang
  GAGAL — dia nge-assert perilaku yang jadi celah takeover di atas. File-nya
  mode 600 punya user `hermes`, jadi belum bisa diupdate.

### 2026-08-12 (lanjutan 4) — pembuat bill boleh keluar (v58)

Nutup celah desain yang ketinggalan dari v57: sejak payer di-confirm, pembuat bill
resmi jadi "peserta biasa" — tapi satu-satunya orang yang gak boleh keluar.

- **Pembuat bill sekarang bisa keluar**, asal billnya udah dipegang payer confirmed
  orang lain. Kalau belum ada payer confirmed (atau payernya dia sendiri), dia masih
  owner dan tetap gak bisa keluar — owner mindahin payer atau hapus billnya, bukan
  kabur dari billnya sendiri.
- **Sisa duit pindah ke owner, bukan ke pembuat.** `calc.compute()` dulu selalu
  numpuk item bebas yang gak dipilih siapa-siapa, pajak tanpa basis, dan sisa
  pembulatan ke pembuat bill (`creator_id`) — sekarang ke `fallback_id`, yaitu
  **yang nalangin** (payer confirmed, kalau gak ada ya pembuat). Ini bukan cuma
  demi fitur keluar: selama ini kalau Amel yang nombokin, item yang gak keambil
  malah ditagihin ke Aufa yang gak ngeluarin duit sepeser pun. Peringatannya ikut
  diperbaiki: "masuk ke pembuat bill" → "masuk ke yang nalangin".
- Estimasi lokal di HP ikut disamain (`iAmCreator` → `iAmOwner`) — kalau gak, angka
  di dock beda sama angka server, persis kelas bug yang dijaga `e2e_smoke.mjs`.
- **Keluar = keluar.** Billnya ilang dari daftar orang itu, sama kayak peserta lain
  yang keluar. Bedanya, keanggotaan orang lain itu baris di tabel (payment/selection)
  yang tinggal dihapus; pembuat bill gak punya baris apa-apa — dia masuk roster
  lewat id — jadi keluarnya disimpen sebagai flag `bill.creator_left`. Gabung lagi
  lewat link (atau billnya balik ke dia sebagai owner) otomatis batalin flag itu.
- Owner sekarang juga boleh ngehapus pembuat bill dari daftar orang, konsisten sama
  aturan di atas. Dulu diblok mentah-mentah karena "pembuat selalu kebagian item
  sisa" — alasan yang udah gak berlaku.
- Sheet konfirmasi keluarnya nyebut billnya tetap jalan dan sekarang dipegang siapa —
  pembuat bill perlu denger itu, dia biasa nganggep ini billnya dia.
- Di layar bill, "dibuat oleh X" + "Dikelola oleh Y" digabung jadi satu baris
  "dibuat X · nalangin Y". "Dikelola" itu istilah manajemen di layar yang gak punya
  satu pun aksi manajemen.
- Tes: 98 lulus (7 baru di `test_regressions_v57.py`), plus `e2e_smoke.mjs`.

### 2026-08-12 (lanjutan 3) — layar gabung tamu & editor lebih ringkas

- **Layar gabung tamu dibenerin.** Ini layar yang dilewatin *setiap* tamu dari link
  WhatsApp, dan isinya cuma total sama kotak nama di halaman tanpa brand — gak ada
  petunjuk ini app apa, siapa yang ngajak, atau habis ini ngapain. Sekarang ada logo,
  isi bill (jumlah item, berapa orang udah gabung), ke siapa nanti bayarnya, dan
  keterangan "tanpa akun".
- Bug white screen di layar yang sama: kalau pembuatan identity gagal (offline), blok
  `catch` ngasih identity `null` ke `renderGuestView` yang langsung baca `me.id`.
- **Editor**: teks penjelasan "Pilih bebas: ..." dicetak di bawah *tiap* item — di bill
  5 item, paragraf yang sama muncul 4 kali. Sekarang cuma sekali di atas daftar; yang
  per-item tinggal item slot, karena cuma itu yang angkanya beda-beda.
- **Harga per-bagian di Edit Bill salah**: dibagi dari harga sebelum diskon, jadi item
  slot yang didiskon nunjukin angka beda antara editor dan layar bill. Bug yang sama
  udah pernah dibenerin di editor buat-bill — ini salinan keduanya.
- Kalimat pakai sentence case ("Mau bagi bill apa hari ini?", "Aku yang bayar"); label
  dan tombol tetap Title Case. Empty state gak teriak lagi.

### 2026-08-12 (lanjutan 2) — status kebaca sekilas & bill baru mulai dari share

- **Warna status di daftar bill.** Dulu semua baris kelihatan sama, harus dibaca
  chip-nya satu-satu buat tau mana yang belum beres. Sekarang tiap baris punya
  batang warna + ikon yang diwarnain (hijau lunas / merah belum / abu selesai &
  belum dipilih), semuanya ditarik dari satu objek status yang sama dengan chip-nya
  jadi gak mungkin beda.
- Baris bill ditata ulang jadi dua baris: `[nama … tanggal]` / `[status … nominal]`.
  Ditumpuk satu baris bikin chip status cuma kebagian ~40px di HP 390px — kepotong
  jadi "Be…", dan sebelumnya malah nimpa nominalnya.
- **Urutan daftar salah.** Diurut `created_at` tapi yang ditampilin `transacted_at`,
  jadi tanggalnya kebaca 9 Agu, 2 Agu, 11 Agu, 28 Jul. Sekarang diurut pakai tanggal
  yang ditampilin, sekalian bikin home dan riwayat sepakat.
- **Bill baru sekarang dimulai dari "share".** Buka bill 3 detik setelah dibuat dulu
  nampilin "Belum lunas" merah, chip "Rp 0 udah masuk", dan kartu yang ngelistin
  semua item sebagai "tidak dipilih siapa pun → masuk ke pembuat bill" — semuanya
  bener secara teknis, semuanya gak berguna, dan kebacanya kayak laporan error.
  Tombol utamanya malah "Tutup Bill", aksi paling akhir dalam siklus. Selama belum
  ada yang gabung: kartu ajakan share naik ke paling atas, aksi utama di dock jadi
  "Bagikan Link", status cuma satu ("Belum ada yang gabung"), dan peringatan item
  ditahan sampai ada orangnya. Share link itu satu-satunya hal yang bikin produk ini
  jalan, tapi selama ini cuma ikon 20px di pojok.
- Logo produk (struk yang disobek, sama kayak favicon) akhirnya muncul di UI —
  sebelumnya onboarding pakai ikon orang generik dan brand-nya gak ada di mana-mana.
- Sheet bayar: PPN + service seluruh bill dicopot dari baris yang nampilin porsi
  pribadi (dua angka gak berhubungan bersebelahan, teksnya pecah tiga baris).
- Angka utama gak pecah dua baris lagi kalau chip status di sebelahnya panjang, dan
  tombol sekunder di `.btn-row` gak lagi ngambil separuh baris sampai label CTA-nya
  patah.

### 2026-08-12 (lanjutan) — kosakata status & perapian UI

Pass lanjutan setelah audit visual di browser (desktop 1440 + HP 390, terang & gelap).

- **Satu angka, satu label.** Tiga angka berbeda sama-sama dilabelin "belum lunas":
  header bilang Rp 35.280 sementara rail bilang Rp 53.280 buat hal yang keliatannya
  sama. Sekarang dipisah tegas — *belum dibayar* (orang), *belum keambil* (bagian
  slot kosong), *belum beres* (jumlah dua-duanya, cuma di rail, dengan rinciannya).
- **Tombol jebol.** `.btn-danger-ghost` gak ikut aturan kotak tombol bersama, jadi
  "Hapus Bill" dan "Keluar dari Bill" ke-render sebagai teks yang tumpah keluar dari
  bordernya sendiri.
- **Riwayat berhenti ngarang.** Bill yang belum disentuh siapa pun nampilin chip merah
  "Belum lunas" bersebelahan sama teks hijau "Kamu udah bayar". Daftar bill sekarang
  bawa `has_picks` + `i_am_payer`, jadi tampil "Belum ada yang milih" dan "Kamu yang
  nalangin" — yang nalangin itu nombokin, bukan bayar.
- Peringatan bagian kosong gak dobel lagi di layar pembuat bill (kartu peringatan udah
  nyebut nama itemnya).
- "Keluar dari Bill" dipindah ke bawah daftar item. Aksi destruktif yang jarang dipakai
  gak pantes jadi tombol merah selebar layar di atas tugas utama.
- Wordmark: `gap` flex bikin titiknya kelihatan jauh ("Bagiin ." jadi "Bagiin.").
- HP sempit: harga diskon ditumpuk, gak lagi bikin kolom nama kepencet sampai baris
  keterangan pecah jadi tiga baris.
- Tes: `backend/test_regressions_status.py` (4 tes, total suite 91) + `tools/e2e_smoke.mjs`,
  smoke test browser yang mastiin angka yang diliat tamu **persis** sama dengan hitungan
  server (ini regresi yang paling mahal kalau bocor — dulu tamu disuruh transfer
  Rp 145.000 padahal utangnya Rp 122.500).

### v51 (2026-08-12) — polish besar + tambal lubang keamanan

**Keamanan (paling penting).** Sebelum ini `identity_id` merangkap dua peran: referensi
publik (dia muncul di payload tiap bill — `owner_id`, `people[].identity_id`,
`creator_identity_id`) *dan* satu-satunya kredensial. Artinya siapa pun yang dapat link
WhatsApp bisa nyalin id pembuat bill terus:
ganti namanya, nempelin rekening sendiri ke profil dia (duit orang lain nyasar ke
penyerang), bikin kode pemulihan → ambil alih akun permanen, dan hapus bill.
Sekarang:

- `identity` punya kolom `secret` (128-bit). Id tetap publik, `secret` yang autentikasi,
  dikirim lewat header `X-Identity-Secret`. Disimpan di localStorage bareng id.
- Identity lama (sebelum v51) belum punya secret → `POST /api/identities/{id}/bind`
  bikin sekali (trust-on-first-use), panggilan kedua ditolak 403. Browser lama tetap
  jalan sampai dia bind. **Catatan: ini artinya identity lama yang belum kebind masih
  bisa direbut duluan sampai pemiliknya buka app lagi.**
- `paid_by_confirmed`: payer yang cuma *cocok nama* (`paid_by_name` = "Budi", ada tamu
  namanya "budi") sekarang display-only — dia dianggap lunas otomatis tapi **gak**
  dapat kuasa kelola. Kuasa cuma pindah kalau pengelola milih orangnya eksplisit.

**Logika yang salah:**

- `settled` gak lagi otomatis `true` cuma karena bill ditutup. Bill yang ditutup dengan
  Rp 75.000 slot kosong + orang belum bayar tetap "belum lunas" (dulu: chip hijau
  "Lunas" di riwayat padahal barisnya sendiri bilang "belum").
- Field baru `all_paid` (semua yang punya bagian udah bayar) dipisah dari `settled`
  (`all_paid` && gak ada bagian kosong).
- `db.resolve_payer()` jadi satu-satunya penentu siapa yang bayar. Dulu detail bill,
  flag `settled`, dan daftar riwayat masing-masing ngitung sendiri dan hasilnya beda —
  riwayat bilang "Kamu udah bayar" sementara bill-nya bilang orang itu masih ngutang penuh.
- `PUT /api/bills/{id}` nolak item dengan id dobel. Dulu validasi ngitung dua kali tapi
  DB nyimpen satu, jadi `total_idr` nyangkut lebih besar dari isi itemnya — ada duit yang
  gak ditagih ke siapa pun dan `total_ok` diam-diam `false`.
- Edit bill gak lagi ngehapus roster: `participants`/`participant_count` yang gak dikirim
  = "biarin", bukan "kosongin".
- Slot kosong yang harganya Rp 0 (item didiskon penuh) gak dilaporin lagi sebagai
  peringatan "3 bagian kosong = Rp 0".
- **Total tamu salah hitung.** Frontend nyalin ulang mesin split di JS tapi ngeluarin item
  bebas yang gak dipilih siapa pun dari basis pajak, padahal `calc.py` naruh item itu ke
  pembuat bill jadi dia tetap masuk penyebut. Akibatnya tamu diliatin Rp 145.000 padahal
  utangnya Rp 122.500 — dan angkanya baru betul pas bill ditutup. Sekarang angka resmi
  diambil dari `people` hasil server; hitungan lokal cuma buat estimasi optimistis.
- Toggle "harga sudah termasuk pajak" gak lagi ngehapus Service. `calc.py` emang
  mendukung bill tax-included yang tetap ada service charge.
- Preview harga slot di editor ngikutin diskon (dulu bagi harga sebelum diskon, jadi item
  yang sama nunjukin dua harga beda di dua layar).

**Tampilan & rasa pakai:**

- Sistem desain baru: satu keluarga netral hangat (dulu campur abu dingin + oranye), satu
  aksen, skala radius konsisten, bayangan yang diwarnain sesuai latar. Kontras diperbaiki —
  dulu tombol utama cuma 2.8:1 dan teks sekunder 2.45:1 (dua-duanya gagal WCAG AA).
- **Desktop beneran didesain.** Kolom 560px yang ngambang di layar 1440px sekarang jadi
  workspace dua kolom di ≥1040px: konten kiri, ringkasan + aksi utama jadi rail lengket
  di kanan. Bottom sheet berubah jadi modal ketengah di ≥720px.
- Padding bawah dihitung dari tinggi dock beneran. Dulu dipatok 96px padahal bar tamu
  ~147px, jadi baris item terakhir ketutupan permanen.
- Ikon SVG (satu set, stroke 1.75) gantiin emoji sebagai elemen antarmuka.
- Hover, focus-visible, skeleton loading, empty state, riwayat dikelompokin per bulan.
- `confirm()` bawaan browser diganti sheet sendiri; semua tombol async dikunci selama
  request jalan biar gak dobel submit.
- Aksesibilitas: `role`/`aria` di baris item & dialog, label nyambung ke input, target
  sentuh ≥44px, `aria-live` di toast, keyboard bisa jalan penuh.
- Ikon & favicon digambar ulang (struk yang disobek jadi dua, dibikin per-ukuran biar
  16px tetap kebaca), plus `manifest.json`, apple-touch-icon, dan `og:image` — link yang
  dishare ke WhatsApp sekarang ada preview-nya.
- Register bahasa diseragamin ke "kamu" (dulu campur "lu", "kamu", "saya" bahkan dalam
  satu kartu).

Tes: `backend/test_regressions_v51.py` (12 tes) + seluruh suite jadi 80 tes.

### v52 (2026-08-12) — re-deploy: bust cache Cloudflare

Kode sama persis dengan v51. Folder `static/v51` di-serve ulang sebagai `static/v52`
karena Cloudflare nyimpen draft partial yang sempat ke-request lewat domain live pas
pengembangan (app.js cuma 3,5KB, screens/bill.js juga versi lama). File bener ada di
git; CF tetap nyajian versi rusak sampai path-nya ganti. Bump versi folder = mekanisme
cache-busting resmi project (lihat CLAUDE.md).

### v53 (2026-08-12) — polish copy: kapitalisasi konsisten

Polesan teks di seluruh app (screens.js, bill.js, index.html):

- **Label form** → Title Case: Judul Bill, Tanggal Transaksi, Nama Item, Harga Item
  Sudah Termasuk Pajak, Yang Bayar, Aku Yang Bayar, Nama Yang Bayar, Kode Pemulihan,
  Metode Bayar, Bank / E-Wallet, Nomor Rekening / E-Money, Atas Nama (Opsional).
- **Tombol & CTA** → Title Case konsisten: Bikin Manual (Tanpa Foto), Tambah Item,
  Simpan Perubahan, Edit Bill, Buka Lagi, Buka Bill Lagi, Hapus Selamanya, Hapus Bill,
  Gabung Bill, Lanjut, Milih Item, Konfirmasi Item,
  Pakai Nama Ini, Pilih Item Kamu, Tambah Foto Struk, Tandai Lunas, Tandai Udah Bayar,
  Salin Link, Kirim Lewat WhatsApp, Bagikan Lewat Aplikasi Lain, Coba Lagi, Tempel Teks.
- **Heading & status** → Mau Bagi Bill Apa Hari Ini?, Bikin Bill Pertama Kamu Sekarang!,
  Foto Struknya, Gagal Baca Struk, Ditutup · Belum Lunas, Total Bagian, Estimasi Kamu,
  Slot Kamu, Porsi Kamu, Subtotal Item, Item & Siapa yang Pilih, Kamu yang Nalangin Bill Ini.
- Teks bantu/deskripsi tetap sentence case (cuma huruf pertama kapital), contoh
  "ketik item & harganya" → "Ketik item & harganya".
- Title tab & og:title → "Bagiin — Bagi Bill Bareng Tanpa Ribet".

**Catatan deploy:** v53 dan v54 sempat ke-serve publik dengan versi intermediate
(ada 1-2 tombol belum ke-title-case) karena CF cache 24h per path — dikoreksi dengan
bump v54, lalu v55 (versi final). Ketiganya isinya sama di git; v55 yang dirujuk index.html.

### v56 (2026-08-12) — fix chip "Nalangin" + tombol metode bayar di view creator

- Chip "nalangin" di baris pembayar (dan chip status lain: "lunas", "udah bayar",
  "semua lunas") sekarang kapital: "Nalangin", "Lunas", "Udah Bayar", "Semua Lunas".
- **View creator/manager sekarang punya tombol "Metode Bayar <nama>"** — dulu cuma
  ada di view tamu, padahal creator yang ngutang juga perlu liat rekening/e-wallet
  yang nalangin. Tombolnya di bawah baris "Yang nalangin: X", buka sheet yang sama
  (akun si pembayar; fallback akun creator cuma kalau creator yang bayar).

### v57 (2026-08-12) — payer = pemegang power tunggal + fitur keluar dari bill

Model kepemilikan diubah (keputusan Aufa): **payer yang di-confirm = satu-satunya
manager.** Sebelum ada payer confirmed → creator yang pegang. Setelah creator
confirm Amel sebagai payer → power pindah TOTAL ke Amel; creator jadi peserta
biasa (bisa pilih item, tandai lunas diri, lihat metode — gak bisa edit/close/
delete/set-payer/tandai lunas orang lain).

- `_can_manage` = `_owner_id` (confirmed payer, else creator). Co-ownership
  creator v49 dibuang — aman karena v51 memastikan name-match gak pernah
  ngasih power (dulu v48 yang bikin creator ke-lock itu payer resolve by name
  tanpa distinction; sekarang distinction-nya ada).
- `db.delete_bill` ikut diketatin: cuma confirmed payer / creator (saat belum
  ada payer confirmed) yang bisa delete — path name-resolution-as-owner dihapus.
- **Fitur baru: `POST /api/bills/{id}/leave`** — peserta (bukan owner, bukan
  creator) bisa keluar dari bill yang open: pilihan + payment record + roster
  dihapus, bagiannya balik ke creator / jadi slot kosong. Owner gak bisa keluar
  (dia pegang bill), creator gak bisa keluar (struktural: "dibuat oleh" +
  fallback item bebas). Bisa join lagi lewat link.
- **UI**: tombol "Keluar dari Bill" (btn-danger-ghost) di view tamu, ada hint
  "Dikelola oleh <payer>" di kartu ringkasan. View creator/tamu otomatis
  ngikut `can_manage` dari server.
- Tes: 4 test lama di-update ke model baru + 7 test baru
  (`test_regressions_v57.py`) → 87 total.

### v13 (2026-08-09) — join-based roster
- Creator no longer types participant names — just declares headcount (`Berapa orang ikut?`).
- Guests appear in the bill the moment they join (name prompt → join), even before picking items.
- No name cross-check: roster = who actually joined. Legacy typed-name claim kept for old bills.
- Creator can remove a wrong/double join (✕ per person, confirm sheet) — drops their items, payment, claim.
- Fixed "kamu" label showing on other people's items (guest side now shows real selector name).
- Guest pay sheet shows item confirmation list before marking paid + standalone "Metode bayar" sheet.
- Fix: "Total kamu" preview now mirrors backend tax calc (proportional to selected subtotal).

### v12 (2026-08-09) — participant claiming
- Guest with matching name (case-insensitive) claims the creator-typed slot — "Amel" vs "amel" = same person.
- (Superseded by v13's join model; claim still runs for legacy bills.)

### 2026-08-09 (v7) — feedback user dari test langsung
- **Foto struk asli di screen Periksa Hasil**: `/api/ocr` sudah nyimpen foto ke
  uploads & return `photo_path` → frontend tampilkan `<img src="/uploads/<name>">`
  (basename dari photo_path) + toggle perbesar (`.photo-preview.expanded`, ketuk).
  CSS `.photo-preview` ditambah `max-height:240px; object-fit:contain`.
- **Format rupiah di input verify**: item price + subtotal/PPN/service sekarang
  `type="text" inputmode="numeric"` + helper `rupiahFmt`/`rupiahParse`/`bindRupiahInput`
  (format titik ribuan, caret-safe, format ulang di blur). Semua parsing lewat
  `rupiahParse` (strip non-digit) — JANGAN parseInt langsung di value ber-format.
- **Creator bisa milih item**: tombol "🖐️ Pilih item kamu" di creator view (bill
  open) → `renderCreatorPick(data)` (mode picker ala guest: item tappable + sticky
  "Total kamu" + Selesai → refetch). Creator TIDAK dapat tombol "Udah bayar"
  (bayar ke diri sendiri gak masuk akal).
- **Fix bug calc**: zero selections → `diff` (seluruh pajak+service) dibuang ke
  creator sebagai "remainder" → orang liat Rp 45.219 padahal gak milih apa-apa.
  Fix: remainder ke creator HANYA kalau `subtotal_by_ident` ada isinya. Regression
  test: `backend/test_calc_regression.py` (3 skenario, ALL PASS).
- **Deploy**: static folder bump `/static/v6/` → `/static/v7/` (CF cache key =
  path, query string di-normalize → tiap ubah frontend WAJIB bump folder).
  Backend restart: `sudo systemctl restart bagiin.service`.
- Test E2E (CDP :9222, live): foto ke-load (naturalWidth>0), harga format titik,
  total Rp 317.619, edit 100000 → "100.000", warning diskon muncul, creator pick
  flow jalan (item share "Aufa", split proporsional bener), bill test dibersihkan
  dari DB prod setelah verifikasi.

### 2026-08-09 (v8-v9) — feedback round 2
- **Fix chip status misleading**: pas gak ada yang milih item, chip kedua nampilin
  "semua lunas" (gray) — user kira bill udah beres. Sekarang 3 state jelas:
  gak ada assignment → "Belum ada yang milih" (gray); ada yang belum bayar →
  "Rp X belum" (red); semua bayar → "semua lunas" (green).
- **Layout sticky bar dirapihin** (pick mode creator + guest view): sekarang
  stacked — "Total kamu Rp X" di atas, tombol (Selesai / Udah bayar) full-width
  di bawah. Sebelumnya horizontal berdampingan.
- **Fix race condition selection**: klik cepat beberapa item → POST /selections
  paralel bisa ke-reorder → state akhir salah (item kehilangan centang).
  Fix: `selectionSaveChain` promise chain — save di-serialize, POST terakhir =
  state final. Verified: klik 2 item cepat → server simpen 2 item (sebelumnya
  cuma 1).
- Test E2E: chips 3 state (kosong/mix/lunas) verified live, sticky stacked
  verified (creator pick + guest), race fix verified, bill test dibersihkan.
  CATATAN: ada 3 bill "Kitchen & Dimsum" di prod — 1 punya selections/payments
  asli dari user, JANGAN dibersihin.

### 2026-08-10 (v10) — edit bill, akun/settings, transfer code, metode bayar
- **Edit bill**: tombol "✏️ Edit" di creator view (bill open) → editor lengkap
  (judul, tanggal, item, subtotal/PPN/service, peserta) → PUT /api/bills/{id}.
  Backend `update_bill` baru: item diff — item yang id-nya dipertahankan →
  centangan orang KEPE; item dihapus → centangannya ikut hapus; item baru →
  insert. PUT sekarang cek status open (bill closed gak bisa diedit).
- **Screen Akun**: tombol 👤 (dulu langsung logout, bikin bingung) → screen
  settings: ganti nama, kode pemulihan, metode bayar, keluar (di bawah + konfirmasi).
- **Transfer code (auto-generate)**: 12 karakter 3 grup (XXXX-XXXX-XXXX, alphabet
  tanpa 0/O/1/I/L). Generate/regenerate via POST /code/generate — regenerate
  langsung matiin kode lama (hash di-overwrite). Restore: link "Punya kode
  pemulihan?" di onboarding.
- **Metode bayar**: tabel `payment_account` + CRUD. 33 brand (bank, bank digital,
  e-wallet) — warna diverifikasi subagent dari SVG asli (bukan logo file, chip
  warna → aman lisensi). Pay sheet guest nampilin akun creator + tombol copy.
- Endpoint baru: POST /api/identities/{id}/name, POST /code/generate,
  GET/POST accounts, DELETE /api/accounts/{id}; bill response + `creator_accounts`.
- Test: `test_features.py` (update_bill diff, accounts CRUD+ownership, rename,
  code regenerate) + E2E browser (settings UI, edit flow, pay sheet, restore).
- 2026-08-10: push ke GitHub — github.com/ardhiqii/bagiin (public, main).

### 2026-09-23 (v95), perapian mobile navigation dan flow buat bill

- Topbar mobile sekarang menempatkan judul secara geometris di tengah viewport, tidak ikut bergeser karena tombol kembali atau action di sisi kanan. Bottom navigation memakai kolom dengan lebar seimbang, icon dan label tetap terpusat, active state serta safe-area tetap dipertahankan.
- Flow buat bill menempatkan penanganan foto struk sebagai keputusan pertama: pilih foto untuk OCR, kamera, tempel foto, atau lanjut isi manual. Setelah itu metadata bill tetap terlihat jelas, termasuk judul, merchant, dan tanggal transaksi, sebelum editor item.
- Photo controls memakai primitive Button milik React/shadcn yang sudah dikustomisasi dengan token Bagiin. Jalur OCR dan jalur attach/manual tetap memakai kontrak API, validasi ukuran, dan cleanup upload yang sama.
- Sticky total dock di HP disusun menjadi baris total, warning, lalu CTA full-width. Dock tidak lagi menaruh tombol create di tengah blok teks yang tidak berhubungan, dan ruang konten dihitung dari tinggi surface aktual agar control yang sedang dipakai tidak tertutup.
- Tidak ada perubahan backend, schema, API payload, auth, atau aset legacy rollback. Light/dark mode dan layout desktop tetap dipertahankan.
- Bukti verifikasi: backend `422 passed, 1 skipped`; frontend typecheck, build, dan logic `9/9` lulus; browser create `28 matrix cases, 0 failed`; responsive `22 matrix cases` pada lebar 320-1440px dan tinggi 568-900px; polish shell lulus untuk home/verify/creator/guest dalam light/dark; smoke OCR dan no-OCR attachment lulus; tidak ada console/page error.

### 2026-09-23 (v96), perbaikan layout metadata dan pengembalian pilihan kontak "Yang ikut"

- Layout metadata di layar verifikasi diperbaiki dari akarnya, bukan ditambal secara visual. `.field` memakai `display: grid`, sehingga sebagai grid item dia mewarisi `align-self: stretch` implisit; akibatnya setiap sel di satu baris `.form-grid` ditarik setinggi sel tertinggi di baris itu, dan karena `.field` sendiri sebuah grid, kelebihan tinggi itu dibagi ke dua baris implisitnya (label dan control) sehingga label dan input ikut membesar. Pemicunya adalah sel "Tanggal transaksi" yang punya baris bantuan `<p class="date-helper">` dan menyeret tetangganya "Tempat, opsional".
- Angka sebelum perbaikan pada 390px di `.verify-detail-card .form-grid`: input merchant 66.5px padahal semua control lain di layar memakai tinggi 46px (`--control-height`), posisi atasnya 20.5px lebih rendah dari input tanggal (311.7 vs 291.2), kotak label merchant 38.5px padahal seharusnya 18px, dan selnya 110px di baris yang tinggi naturalnya 69px. Inflasi yang sama terjadi di grid "Biaya tambahan" pada layar edit bill (input "Pajak" 66px pada 390px dan 57.5px pada 1040px, dipicu oleh `field-hint` milik sel Subtotal). Itulah tampilan "aneh" yang dilaporkan.
- Perbaikannya dipasang di ITEM, bukan di container: `.form-grid > .field { align-self: start; }`. Versi container (`.form-grid { align-items: start }`) juga menghentikan stretch, tapi `.form-grid` juga dipakai grid yang selnya bukan `.field` (`.recap-money-grid`, `.recap-estimate-grid`) dan form akun di settings, sehingga versi menyeluruh itu ikut mengubah computed `align-items` container yang tidak pernah kena bug ini. Versi yang dipasang menyasar tepat primitive `.field` yang membesar, dan tidak menyentuh computed `align-items` grid lain.
- Pemeriksaan dampak ke konsumen primitive yang sama: grid "Biaya tambahan" di layar edit bill ikut membaik (Subtotal vs Pajak sama-sama 46px, selisih posisi atas 0px), dan kedua field metadata di sana juga sama-sama 46px dengan selisih atas 0px. Grid recap (`.recap-money-grid`) berisi sel `recap-money-cell` yang bukan `.field`, jadi rule ini tidak berlaku untuknya. Form akun di settings berisi `.field` sehingga rule-nya memang berlaku di sana, tapi terukur tidak mengubah apa pun: tinggi sel, tinggi input, dan computed `align-items` container identik dengan dan tanpa rule (sel 70px, input 46px di ketiganya).
- Angka sesudah perbaikan pada 320/360/375/390/412/480/600/768/820/1039/1040px, tanggal kosong dan terisi, light dan dark: input merchant dan tanggal sama-sama 46px dengan selisih posisi atas 0.0px, kedua label satu baris setinggi 18px, dan tinggi kartu metadata tidak bertambah (207px di HP, 214px di 768px ke atas). Grid recap dan settings tetap identik seperti sebelumnya.
- Pilihan kontak "yang pernah join" dikembalikan di kartu "Yang ikut", memindahkan perilaku blok `#people-pick` dari build legacy (`frontend/static/create.js`) ke editor verifikasi React. Daftar diisi dari `GET /api/identities/{id}/contacts`, jadi yang ditawarkan hanya kontak terbukti yang pernah berbagi bill dengan pembuat bill, bukan daftar orang asing.
- Tiap kontak dirender sebagai baris yang bisa dipilih memakai primitive yang sudah ada (`account-row`, `.avatar` berisi inisial, `.item-name`, dan `.caption`). Controlnya checkbox asli dengan nama aksesibel "Ikut sertakan <nama>", sehingga bisa dioperasikan lewat keyboard. Ada state loading, state kosong yang eksplisit ("Belum ada kontak — undang orang lewat tautan agar mereka muncul di sini."), state error yang membawa pesan dari API, dan penjaga response basi agar hasil fetch yang sudah tidak relevan tidak pernah dilukis.
- Pemisahan dua jalur peserta dipertahankan sebagai kontrak: kontak terbukti yang dipilih adalah identitas nyata dan baru dimasukkan ke bill setelah bill dibuat lewat `POST /api/bills/{id}/invite`, sedangkan nama yang diketik bebas tetap lewat array `participants` di `POST /api/bills` sebagai baris placeholder tanpa identitas. Keduanya disimpan di field draft yang terpisah supaya satu orang tidak pernah tercatat dua kali, sekali sebagai placeholder dan sekali sebagai anggota.
- Undangan dikirim sebagai satu batch (`allSettled`) dibatasi race 8 detik, dan kegagalannya dilaporkan lewat notifikasi sementara yang menempel di `document.body` karena layar pembuat bill sudah unmount saat hasilnya datang. Undangan yang gagal tidak pernah membatalkan atau memblokir bill yang sudah jadi. Kontak yang dipilih juga dihitung sebagai isi draft oleh leave-guard, jadi tombol Back tetap bertanya dulu sebelum membuang pilihan peserta.
- Kelas `create-photo-actions` yang sebelumnya dirender tanpa aturan CSS akhirnya diberi aturan, sehingga gate cakupan CSS kembali hijau.
- Tidak ada perubahan backend, schema, API payload, auth, maupun aset legacy rollback. Light/dark mode dan layout desktop tetap dipertahankan.
- Bukti verifikasi: ditambahkan `backend/test_regressions_v96.py` (15 test) yang mengunci kontrak yang dipakai pemilih kontak: kedua arah visibilitas kontak (kontak yang membuat bill, dan kontak yang join ke bill pembuat), kontak tidak pernah memuat pemanggilnya sendiri, penolakan auth (400 tanpa header, 404 id tidak dikenal, 403 secret salah/kosong) yang diverifikasi tidak membocorkan data kontak, path id yang tidak sama dengan identitas terautentikasi ditolak 403, serta setiap penolakan `/invite` (orang asing, undangan ganda, bukan manager) yang diverifikasi lewat state bill mentah bahwa tidak ada baris yang berubah. Arah yang menentukan (kontak adalah pembuat bill, pemanggil join) diuji terhadap bentuk query alternatif `COALESCE` yang diperingatkan `db.get_contacts` di komentarnya sendiri: bentuk itu mengembalikan daftar kontak KOSONG, sedangkan `get_contacts` mengembalikan kontaknya, jadi assertion ini betul-betul membedakan bentuk salah dan benar pada fixture yang sama. Suite backend penuh `437 passed, 1 skipped`, naik dari baseline `422 passed, 1 skipped` tanpa regresi.
- Bukti verifikasi frontend dan gate dijalankan ulang pada tree ini: typecheck `tsc -p tsconfig.app.json --noEmit` bersih; `npm run test:logic` `13/13` lulus (dari `9/9`, ditambah 4 test untuk aturan pemilih kontak); `tools/e2e_create.mjs` `28 matrix cases, 0 failed`; `tools/e2e_uiux_responsive.mjs` PASS (`22 matrix cases`); `tools/e2e_css_coverage.mjs` PASS (`checks=1260`, dari sebelumnya FAIL `12/1260`). Assertion geometri metadata ikut lulus di lebar HP: pada 390px input merchant dan tanggal sama-sama 46px, top keduanya 291.2px, label satu baris 18px, dan tinggi kartu metadata 207px tidak bertambah saat tanggal diisi.
- Audit independen setelah penggabungan menemukan bahwa port pemilih kontak sempat menghilangkan dua penjaga anti-duplikat yang masih dipakai build legacy (`frontend/static/create.js`). Akibatnya satu orang bisa tercatat dua kali di bill yang sama: sekali sebagai baris `participants` tanpa identitas dari daftar nama yang diketik, dan sekali sebagai anggota yang diundang. Kasus `auto_accept` ON terlihat aman karena backend mengklaim baris bernama sama, tapi kasus `auto_accept` OFF benar-benar menghasilkan baris placeholder "Budi" tanpa identitas berdampingan dengan undangan untuk Budi, sehingga setelah undangan diterima muncul dua baris Budi.
- Kedua penjaga itu dikembalikan: mencentang kontak menghapus entri nama yang diketik dengan nama sama (`create.js:1389`), dan menambah nama yang sama dengan kontak yang sudah dicentang ditolak dengan copy legacy "Nama itu sudah kepilih" (`create.js:1341-1342`). Perbandingan nama memakai satu helper `normalizePersonName` supaya kedua aturan tidak bisa berbeda lagi, dan `participantPlaceholders` juga mengecualikan kontak yang sudah dipilih sehingga payload create tidak bisa menyebut kontak yang dipilih walau penjaga di level widget terlewat.
- Jalur lain yang bisa mencapai keadaan duplikat juga ditutup: mengubah baris nama yang sudah ada secara inline menjadi nama kontak (yang tidak bisa dilihat penjaga widget mana pun). Sebelumnya itu mengirim `participants: ["Budi","BUDI"]`.
- Bukti verifikasi perbaikan duplikat: sebelum perbaikan payload create berisi `participants ["Budi"]` dan bill memuat placeholder Budi berdampingan dengan undangan; sesudahnya `participants []` dan tidak ada baris ganda. Notifikasi penolakan muncul dengan copy legacy, nama yang tidak bertabrakan tetap bisa ditambahkan seperti biasa. `npm run test:logic` `18/18` lulus, `tsc` bersih, `npm run build` sukses, dan keempat gate browser tetap pada baseline: `tools/e2e_create.mjs` `28 matrix cases, 0 failed`, `tools/e2e_uiux_responsive.mjs` PASS (`22 matrix cases`), `tools/e2e_css_coverage.mjs` PASS (`checks=1260`), suite backend `437 passed, 1 skipped`. Assertion baru terbukti membedakan: empat di antaranya gagal pada tree sebelum perbaikan.
- Verifikasi gate pembeda dijalankan pada dua tree sekaligus: harness yang sama dijalankan terhadap salinan baseline `main` dan terhadap tree hasil perbaikan, menghasilkan 59 kegagalan pada tree rusak dan 0 kegagalan pada tree perbaikan. Assertion yang benar-benar membedakan adalah 56 pemeriksaan geometri "metadata cells share input height and top" plus tiga assertion pemilih kontak (baris kontak dirender, satu undangan per kontak yang dipilih, dan kontak yang dipilih tidak masuk `participants`). Assertion lain di file itu lulus di kedua tree dan karena itu tidak membuktikan apa pun sendirian.

### 2026-09-23 (v97), penyatuan Rekap Patungan dengan list bill dan invalidation perubahan bill

- Rekap Patungan dan list bill sekarang memakai satu universe bill untuk identitas yang sama. `GET /api/identities/{id}/bills` ikut memuat bill yang memiliki undangan `pending` untuk identitas tersebut, sehingga bill yang muncul sebagai aksi "Terima undangan" di Rekap juga punya baris yang bisa dibuka di Home.
- Baris undangan tetap bukan anggota bill: tidak dibuat payment row, tidak mendapat owner action, tidak mengklaim sudah membayar atau memiliki nominal tagihan, dan hanya target undangan yang dapat melihatnya. Field `pending_invite`, `pending_invite_id`, dan `pending_invited_by_name` bersifat additive; metadata internal berawalan `_` tidak pernah keluar lewat API.
- Home menampilkan undangan dengan status netral "Menunggu jawabanmu", nama pengundang, ikon undangan, dan target bill yang sama. Status ini menjadi sumber tunggal untuk chip, warna status, filter, dan sorting; status tidak ditebak ulang dari response Rekap.
- Cache Rekap dipindahkan ke primitive cache identity-scoped yang sama dengan Home. In-flight dedupe, TTL, generation fence, retry setelah error, dan invalidation global berlaku walau layar Rekap sedang tidak ter-mount. Edit item/harga, pilihan peserta, pembayaran, settle, accept invite, create, dan delete tidak boleh meninggalkan snapshot Rekap atau list yang basi.
- Regresi keamanan mengunci parity bill-id Home/Rekap, isolasi stranger dan kontak lain, tidak ada private key/secret di response, invite-only tidak punya akses manage, serta rejected writes tidak mengubah state sebelumnya. Regresi live juga mengunci recalculation list dan Rekap dari snapshot bill yang sama setelah perubahan bill.
- Bukti verifikasi: `backend/test_regressions_v97.py` lulus 11 test; suite backend penuh `448 passed, 1 skipped`; frontend typecheck bersih; `npm run test:logic` `26/26`; build sukses; E2E Rekap `95 checks, 0 failures, 0 browser errors`; CSS coverage `1260 checks`; responsive matrix `22 cases`. Perubahan belum dideploy ke production.

### 2026-09-23 (v98), fallback OCR gratis tidak kehabisan budget sebelum model lambat

- Direct probe dengan foto struk nyata membuktikan OpenRouter `dots-studio/dots-3-note-preview:free` mengembalikan HTTP 200 dan payload OCR ternormalisasi (6 item + total), sementara dua kandidat awal terkena 429. Bug-nya bukan "free AI tidak bisa", tetapi budget fallback lama 15 detik habis sebelum kandidat yang berhasil selesai.
- Budget satu permintaan dijaga 90 detik: primary mendapat sampai 30 detik, fallback mendapat sampai 60 detik, tetap di bawah batas proxy sekitar 100 detik. Setiap kandidat fallback mendapat slice percobaan nyata; pembagian sisa waktu berdasarkan jumlah model dihapus karena itu membuat kandidat berikutnya kelaparan setelah kandidat sebelumnya gagal cepat.
- Regression OCR mensimulasikan primary timeout, dua fallback 429, lalu kandidat gratis lambat yang sukses. Hasil publik, redacted logging, model guard, dan retry terstruktur tetap dipertahankan.
- Bukti verifikasi: direct provider probe sanitized berhasil pada kandidat OpenRouter ketiga; suite backend dan focused OCR regression wajib lulus sebelum merge. Belum dideploy ke production.

### 2026-09-23 (v99), cegah OCR sukses terlambat berubah menjadi 504 nginx

- Akar masalah production dipastikan berada di reverse proxy: vhost Bagiin tidak menetapkan `proxy_read_timeout`, sehingga batas default nginx 60 detik berlaku. Log menunjukkan nginx mengirim 504 pada 22:33:31, sedangkan uvicorn menyelesaikan request OCR yang sama dengan 200 pada 22:33:38.
- Chain OCR sekarang membuang dua model OpenRouter yang terbukti selalu 403, tidak mengulang request Gemini untuk status retryable, membatasi budget default satu request menjadi 40 detik dengan margin setup dan overshoot terukur, serta menyisakan slice untuk kandidat fallback berikutnya. Clamp konfigurasi juga strict: nilai maksimum `60 - 5 - 7 - 2 = 46` detik, jadi margin tetap ada walaupun environment memasang budget terlalu besar. Reserve kandidat fallback dibatasi maksimal 50% dari window agar chain panjang tidak membuat kandidat pertama kelaparan. Kontrak normalisasi, MIME/downscale, quantity, duplicate rows, dan perhitungan nominal dipertahankan.
- Jika edge mengembalikan 502/503/504 atau body OCR kosong, UI menjelaskan bahwa baca otomatis gagal dan foto tetap tersimpan untuk input manual. Detail provider 4xx tetap ditampilkan, sementara endpoint non-OCR tetap memakai pesan generic.
- Regression backend dan frontend mencakup model eligibility, advancement 403/429/timeout, hard elapsed boundary, retry structured-output yang sempit, error mapper OCR-only, dan fallback foto/manual. Perubahan sudah diverifikasi di feature branch tetapi belum dideploy ke production.
- Residual risk dicatat: timeout `urllib` membatasi operasi socket, bukan pembatalan paksa saat body sedang trickle. Card ops terpisah untuk menaikkan `proxy_read_timeout` nginx tetap blocked sampai ada approval eksplisit.

### 2026-09-24 (v100), aksi undangan pending di Home

- Baris bill dengan `pending_invite=true` sekarang menampilkan tombol aksesibel "Terima" dan "Tolak" bersama copy nama pengundang yang sudah ada. Tombol hanya muncul jika `pending_invite_id` tersedia, tidak membuka baris bill saat diklik, dan navigasi keyboard pada baris tetap dipertahankan.
- Kedua aksi memanggil endpoint scoped memakai pasangan `bill_id` dan `pending_invite_id` dari row yang sama. Setelah berhasil, row dihapus dari tampilan lalu list di-refresh; jika gagal, row tetap tampil dan memberi pesan santai "Undangannya belum bisa diproses, coba lagi ya.".
- Ditambahkan regression test deterministic untuk model aksi pending dan argumen callback endpoint. Tidak ada perubahan backend, API contract, aset, atau deploy.

### 2026-09-24 (v101), backend invariant audit

- Rekap sekarang memeriksa blocker allocation (`pending_selection`, slot yang belum tertutup, payer unresolved, dan workflow pending) sebelum flag `settled`. Manual settle hanya menutup sisi pembayaran; tidak mengubah allocation yang belum final menjadi final.
- Pending invite dibatalkan saat manual settle dan invite-only bill yang sudah settled tidak lagi muncul di Home/Rekap/inbox invite. Endpoint decline/cancel juga menolak mutasi pada bill closed atau settled, sehingga tidak ada lagi row invite yang tampil tetapi accept berakhir 409.
- Duplicate selection setelah merge tetap dibatasi maksimal 99 porsi per item, termasuk payload yang mengirim item ID sama beberapa kali.
- `tax_mode` kini hanya menerima `proportional`, `equal`, atau `creator` pada create dan update. PUT bill benar-benar menyimpan mode baru, sementara request tanpa field itu mempertahankan mode lama.
- Regression backend v101 menutup lima kasus tersebut melalui HTTP/TestClient dan readback state. Perubahan belum dideploy sampai focused/full suite dan browser/API smoke pass.
