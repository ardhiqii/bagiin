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
3. Creator bisa "tutup bill" -> semua status final, masuk history

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
| S3 | Bill detail (creator) | Hero total + list item + status tiap orang + tombol share/tutup |
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
- **SPLIT SELALU PROVISIONAL SAMPAI BILL DITUTUP.** Ini jawaban buat case "niatnya
  berdua tapi baru 1 yang centang": sistem gak bisa tau niat, jadi sistem gak pernah
  mengunci pembagian. Orang yang telat centang (mager/nantian) = pembagian item itu
  langsung berubah otomatis. Total per orang di UI selalu "live estimate", bukan
  final. Final cuma terjadi pas creator klik "Tutup bill".
- Creator daftar nama peserta pas bikin bill (nama doang, tanpa akun) - INI FLOW
  STANDAR, bukan opsional. Flow: kelar makan -> creator bikin bill -> tulis nama
  peserta ("Aufa, Rina") -> share link -> semua centang item -> creator tutup bill.
  Gunanya: sistem tau SIAPA yang belum centang -> warning "Rina belum pilih".
  (Angka doang "3 orang" KURANG berguna: tau "1 dari 3 belum pilih" tapi gak tau
  siapa. Nama = 5 detik ngetik, dan itu yang ngejawab kebutuhan "gak lupa siapa
  yang belum dihandle".)
- Catatan: daftar nama = label buat warning, BUKAN batasan akses. Guest yang buka
  link tetap bisa centang walau namanya gak ada di daftar (nama dia ke-tambah
  otomatis). Gak ada hard matching.
- **Konfirmasi tutup bill (safety net):** pas creator mau tutup, tampilkan screen
  konfirmasi yang jelas:
  - "Belum pilih: Rina (2 item belum dibagi)"
  - "Item cuma dicentang 1 orang (kemungkinan dishare): Nasi Goreng Rp 25.000 -> dibagi 1"
  - Tombol: [Tutup bill] [Batal, tunggu yang lain]
  Jadi kalau Rina mager gak pernah centang, Nasi Goreng full ke orang yang centang,
  TAPI creator liat warning-nya dulu dan bisa putusin mau ping Rina atau terima.
- Creator juga peserta biasa - dia centang item yang dia makan juga, flow sama.
- Item yang TIDAK dicentang siapa pun (leftover): default ditanggung creator
  (yang fronting uang). Tampilkan warning di summary creator: "Item ini gak ada
  yang pilih: Nasi Goreng Rp 25.000 -> masuk ke kamu".

### Pajak & service
- Struk Indonesia: Subtotal, PPN (11%), Service (5-10%), Total.
- OCR baca baris pajak dari struk (JANGAN hardcode rate - PPN bisa berubah).
- Default: **proporsional ke subtotal item**. Opsi lain: rata ke peserta / ditanggung creator.
- Perhitungan (proporsional):
  `porsiPajak(user) = (subtotalUser / totalSubtotal) x (PPN + Service)`

### Pembulatan & konsistensi
- Simpan semua nominal sebagai INTEGER rupiah, jangan float.
- Sisa pembulatan (selisih 1-2 rupiah) -> ditanggung creator (yang fronting uang).
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
POST /api/identities            -- buat identity (name) -> {id, name}
POST /api/identities/restore    -- {code} -> identity (atau 404)
GET  /api/bills/{code}          -- detail bill + items + tax info (public read)
POST /api/bills                 -- creator: buat bill (items, tax_mode, photo)
PATCH /api/bills/{code}         -- creator: edit items, tax_mode, close bill
POST /api/bills/{code}/selections      -- guest: set centang item (bulk upsert)
GET  /api/bills/{code}/summary  -- creator: per-orang breakdown + status
POST /api/bills/{code}/payments/{identity_id}/paid   -- guest: tandai bayar
GET  /api/me/bills              -- riwayat by identity (device)
POST /api/identities/payment-profiles  -- creator: simpan rekening/e-money
```

Auth: TIDAK ADA. Bill code = akses baca. Mutasi butuh identity id (device UUID,
random, susah ditebak). Creator-only action divalidasi: identity id harus match
creator_identity_id. Rate limit per IP (lihat Section 9).

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
  Simpan CUMA data non-kritis (nama, identity_id, preferensi). SEMUA akses
  localStorage dibungkus try/catch + fallback in-memory (app tetap jalan tanpa storage).
  Server = source of truth via share link; localStorage cuma cache.
- Identity code: random 10-12 char (base32, tanpa O/0/I/1), tampil SEKALI,
  disimpan server sebagai hash, ada tombol "ganti kode" (invalidasi lama).
- PENTING di UI: kode identitas = RAHASIA (jangan dishare). Kode bill = PUBLIK.
- Tanpa akun -> konsekuensi: ganti device = identitas gak kebawa kecuali restore code.
- Rate limit + token entropy: lihat Section 7 (128-bit bill token, identity code
  dilockout setelah N gagal).
- Receipt photo: privat, cuma bisa diakses via bill code (yang udah dishare creator).

## 10. Teknologi & deployment

- Backend: FastAPI + SQLite (pattern stockbit-backend: venv + systemd).
  Path: /opt/projects/bagiin/backend
- Frontend: server-rendered HTML + htmx (~16KB gz, verified htmx.org) atau vanilla JS.
  JANGAN React (~45-50KB gz, parse bottleneck di Android mid-range, verified).
  Budget: total JS < 50KB gz (hard cap 100KB). System font stack (no webfont).
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
- Summary creator: "Belum bayar: Rina (Rp 81.667)" / "Tutup bill"
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
