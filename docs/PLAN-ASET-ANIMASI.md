# Rencana aset & animasi

Status: **rencana**, belum ada kode yang diubah. Disusun 4 Nov 2026 setelah
memeriksa seluruh aset, seluruh layar, dan mengukur bayangan yang dipakai.

## 1. Temuan pemeriksaan

### 1.1 Inventaris aset

| Berkas | Ukuran | Tampil | Dipakai di |
| --- | --- | --- | --- |
| `welcome.webp` 512² | 5 KB | 200 px | Entry |
| `home-empty.webp` 512² | 24 KB | 216 px | Beranda kosong (2 keadaan) |
| `create-hero.webp` 576² | 10 KB | 100–120 px | Buat · Dari foto |
| `manual.webp` 320² | 13 KB | 120 px | Edit tagihan |
| `scan.webp` 384² | 24 KB | 120 px | Buat · membaca struk |
| `scan-line.webp` 420×140 | 19 KB | garis sapu | Buat · membaca struk |
| `invite.webp` 320² | 13 KB | 108 px | Sheet Undang teman |
| `item.webp` 320² | 8 KB | 108 px | Sheet item |
| `person.webp` 320² | 10 KB | 108 px | Sheet orang, Kontak, Rekap |
| `paid.webp` 384² | 24 KB | 108–150 px | Bill lunas, Rekap kosong |
| `error.webp` 384² | 14 KB | 120 px | 404, bill gagal dibuka |
| `share.webp` 384² | 9 KB | 108 px | Sheet bagikan |
| `transfer.webp` 384² | 18 KB | 108 px | Sheet rekening |
| `anim/receipt-app.webp` 256² | 14 KB | 112 px | Loading (Beranda, Rekap) |
| `anim/coin-app.webp` 128² | 9 KB | 47 px | Loading |
| `empty-bill.webp` 648² | 31 KB | — | **tidak dipakai** |
| `recap.webp` 320² | 6 KB | — | **tidak dipakai** |

Dua aset terakhir masih tercatat di `ART_CONTRACT.md` sebagai dipakai padahal
tidak ada satu pun komponen yang mengimpornya: **37 KB mati**. Pilihannya
dipakai (BillDetail saat daftar item kosong, Rekap saat belum ada lawan
transaksi) atau dihapus dari repo dan kontrak.

### 1.2 Bayangan tidak konsisten — ini yang dikeluhkan

Diukur langsung di browser pada kotak art 112 px, dan dilihat dari tangkapan
layar tiga kali:

- **Struk** (`anim/receipt-app.webp`): bayangan **keras, offset, tepi tajam**,
  tergambar di dalam aset. Sesuai kontrak.
- **Koin** (`anim/coin-app.webp`): tidak punya bayangan di asetnya; bayangan
  digambar CSS sebagai `radial-gradient(closest-side, rgba(20,47,58,.62) …)`
  — **lembut/blur**. Di bawahnya ada `border-radius: 50%`.
- Hasilnya: dua bahasa cahaya dalam satu kotak. Struk tampak seperti hasil
  cetak risograph; koin tampak seperti benda digital dengan bayangan airbrush.
  Saat koin melompat, bayangan lembutnya menyusut sampai **hampir tidak
  terlihat**, jadi koin terbaca melayang tanpa bayangan sama sekali.

Dua pelanggaran lain yang ikut ditemukan:

- **`create-hero.webp` punya bayangan lembut di dalam asetnya** (diperiksa
  visual: bayangan ambient bertepi kabur, jatuh ke kanan bawah). Kontrak
  mensyaratkan satu bayangan keras. Jadi keluarga asetnya sendiri sudah pecah:
  `paid.webp` keras, `create-hero.webp` lembut.
- **Aset diberi `box-shadow` CSS lembut sebagai wadah** (`.create-hero img`
  memakai `--ds-shadow-content`). Untuk aset yang sudah punya bayangan di
  dalam gambarnya, ini jadi bayangan ganda dengan dua arah dan dua kelembutan.
  `.ds-empty-art`, `.ds-art`, `.recap-empty-art` perlu diperiksa dengan cara
  yang sama.

### 1.3 Animasi yang sudah ada

| Tempat | Sekarang |
| --- | --- |
| Loading Beranda ("Menghitung tagihan") | struk goyang 3,4 s + koin memantul 1,55 s + bayangan CSS |
| Loading Rekap ("Menyusun rekap") | art yang sama |
| Buat · membaca struk | `scan.webp` diam + `scan-line.webp` menyapu 2,3 s |
| Semua tombol | `:active` scale 0,975 + getar 8 ms |
| Sisanya | tanpa animasi |

### 1.4 Slot yang belum ada aset atau animasinya

- **Lunas** (satu orang menandai lunas, dan momen orang terakhir melunasi bill)
  — sekarang hanya toast "Ditandai lunas". Ini momen paling pantas dirayakan
  dan asetnya sudah ada: `paid.webp` adalah **stempel karet dengan centang**.
- **Bill dibuat** — toast saja.
- **Tutup bill** — toast saja.
- **Tamu baru masuk bill** ("Kamu masuk ke bill ini") — toast saja.
- **Kontak kosong / Kontak dimuat** — skeleton saja, tanpa art.
- **Edit tagihan saat memuat** — skeleton saja.
- **Pengaturan** — tidak ada slot art (memang benar: layar pengaturan sarat
  baris, ilustrasi di sebelah angka/baris mengganggu).
- **Gagal simpan / gagal unggah** — `Alert` teks, tanpa visual.

## 2. Hukum bayangan (aturan baru, satu bahasa)

Tiga jenis, dan hanya tiga, dengan tempat yang tegas:

1. **Bayangan cetak — di dalam aset.** Satu bayangan keras, offset ke kanan
   bawah, tepi tajam, warna tint lebih gelap dari permukaan. Dipakai semua
   ilustrasi diam.
2. **Bayangan kontak — digambar CSS, tepi keras.** Untuk objek yang bergerak
   (koin). Elips rata tanpa gradien, warna `rgba(20,47,58,.55)`, menyusut dan
   memudar saat objek naik, membesar dan menggelap saat mendarat. Bukan
   `radial-gradient`.
3. **Bayangan kartu — CSS lembut** (`--ds-shadow-content`/`-raise`). Hanya
   untuk kartu, sheet, dan baris. **Tidak pernah dipasang pada `<img>` aset** —
   aset membawa bayangannya sendiri.

Akibatnya: `.create-hero img { box-shadow: … }` dihapus, dan setiap aset yang
menyimpang (koin, `create-hero`) diseragamkan.

## 3. Soal "frame per frame" dari Codex

Perlu dijelaskan sebelum dikerjakan, karena ini menentukan bentuk asetnya:

- `image_gen` di Codex mengembalikan **satu PNG diam per panggilan**. Tidak ada
  Lottie, Rive, video, atau sprite sheet. Jadi "minta 30 frame" berarti 30
  panggilan, dan tiap panggilan menggambar ulang dari nol — konsistensi antar
  frame mulai melenceng sejak sekitar frame keempat (bentuk, posisi, warna).
  Hasilnya justru **berkedip**, bukan halus, dan totalnya bisa ratusan KB.
- Yang terbukti halus: **satu gambar per bagian yang bergerak**, geraknya
  seluruhnya di CSS `transform`/`opacity`. Compositor jalan 60 fps, ukuran
  berkas tetap kecil, dan tidak ada frame yang bisa melenceng karena hanya ada
  satu gambar per bagian. Ini yang sudah dipakai di loading sekarang (13,8 KB +
  9,1 KB).
- Untuk kilauan satu kali (konfeti saat lunas), **canvas** lebih tepat daripada
  frame gambar: deterministik, 60 fps, nol byte aset, dan bisa dimatikan total
  saat `prefers-reduced-motion`.

Kesimpulan: kehalusan dikejar lewat **lapisan + transform**, bukan jumlah frame.
Aset baru dari Codex tetap dipakai — untuk benda yang lebih baik digambar
sebagai gambar, bukan untuk urutan frame.

## 4. Rencana per halaman

Prioritas: **P1** = yang dikeluhkan / paling sering dilihat, **P2** = momen
penting, **P3** = pelengkap.

### Entry (kenalan + pilih identitas)

- Ada: `welcome.webp` 200 px diam.
- Rencana: koin di kaki struk dipisah ke lapisan sendiri lalu memantul pelan
  (durasi 4,1 s, bukan kelipatan durasi struk) — P3.
- Bayangan: koin ikut aturan kontak (keras).

### Beranda

- Ada: loading art + `home-empty.webp` untuk dua keadaan kosong.
- Rencana P2: sapuan kilau pada banner "perlu dikerjakan" saat angkanya
  berubah (bukan berdenyut terus-menerus — berdenyut terus terbaca sebagai
  alarm dan bikin lelah).
- Rencana P3: transisi baris baru masuk (baris yang baru dibayar turun
  statusnya) — geser 6 px + pudar 180 ms.
- Bayangan: koin loading diperbaiki ke P1.

### Buat tagihan

- Ada: `create-hero.webp`, `manual.webp`, `scan.webp` + garis sapu.
- P1: ganti `create-hero.webp` (bayangan lembut → keras) atau terima sebagai
  satu-satunya aset berbayangan lembut **secara sadar**; gua sarankan diganti
  supaya satu bahasa.
- P2: saat AI membaca, tambahkan dua keadaan yang sekarang tidak ada sama
  sekali: "membaca" (garis sapu, sudah ada) → "menyusun angka" (tiga baris
  skeleton muncul berurutan) → hasil. Tanpa ini, jeda 10–20 detik terasa mati.
- P2: biaya unggah foto — indikator halus di kartu foto (bukan mematikan
  tombol).
- P3: "Bill sudah jadi" — animasi struk dilipat masuk ke daftar.

### Detail tagihan

- Ada: `item.webp`, `person.webp`, `invite.webp`, `share.webp`,
  `transfer.webp`, `paid.webp`, `error.webp`.
- **P1 — Lunas (yang diminta):** stempel `paid.webp` menghantam kertas: masuk
  dari skala 1,6 dengan rotasi −14°, mendarat dengan squash 0,9/1,06, lalu
  cincin tinta menyebar (CSS `scale` + `opacity` 0 dalam 420 ms) dan konfeti
  canvas 1,1 detik. Getar 18 ms saat menghantam. Total di bawah 1,2 detik, dan
  **hanya sekali per aksi** — bukan setiap kali layar dibuka.
- **P1 — Semua lunas:** versi lebih tenang, bukan konfeti kedua: stempel
  mendarat, lalu baris "Semua sudah lunas" naik 8 px memudar masuk.
- P2 — "Tutup bill": struk terlipat (aset baru: struk terlipat, bayangan keras)
  atau, tanpa aset baru, baris status berubah dengan geser halus. Gua usul
  tanpa aset baru dulu.
- P2 — "Kamu masuk ke bill ini": avatar orang masuk ke strip dengan pop 220 ms.
- P3 — buang foto: kartu mengecil 0,92 lalu hilang 160 ms.

### Rekap

- Ada: `person.webp`, `paid.webp`.
- P2: `LoadingState` dipakai ulang apa adanya (bahasa sama) — cukup.
- P3: angka total menghitung naik saat pertama tampil (bukan tiap render).
- Catatan: `recap.webp` mati — pakai di sini atau hapus.

### Kontak

- Ada: `person.webp` untuk keadaan kosong.
- P3: skeleton sudah cukup; tambah art hanya kalau daftar benar-benar kosong
  (sudah ada).

### Edit tagihan

- Ada: `manual.webp`.
- P3: tidak perlu animasi tambahan; layar ini urusan form.

### Pengaturan

- Tidak ada art dan **tidak perlu**: layar ini deretan baris dan angka. Satu
  ilustrasi di sini hanya menambah tinggi tanpa menambah arti.

### 404 / gagal

- Ada: `error.webp`. P3: tidak perlu animasi; diam lebih jujur daripada animasi
  lucu di layar gagal.

## 5. Aset baru yang perlu dibuat Codex

| Aset | Untuk | Prioritas |
| --- | --- | --- |
| `create-hero` v2 | mengganti versi berbayangan lembut | P1 |
| `coin-motion` (tanpa bayangan, sudah ada) | — tidak perlu baru | — |
| `receipt-fold` | "Tutup bill" (opsional, kalau mau visual) | P3 |
| — | stempel lunas memakai `paid.webp` yang sudah ada | — |

Semua brief memakai kontrak di `src/assets/ART_CONTRACT.md` apa adanya, dengan
tambahan satu baris wajib: **"one hard offset shadow, crisp edge, no blur, no
gradient"**. Bagian subjek/komposisi yang berubah saja.

## 6. Urutan kerja

1. **Fase 1 — satu bahasa bayangan (tanpa aset baru).** Koin: bayangan CSS
   keras. Hapus `box-shadow` dari semua `<img>` aset. Putuskan dua aset mati.
   Ukur ulang dengan tangkapan layar tiga fase.
2. **Fase 2 — perayaan lunas.** Stempel + cincin + konfeti canvas, plus
   `prefers-reduced-motion` mematikannya total.
3. **Fase 3 — keadaan membaca di Buat tagihan** (garis sapu → skeleton angka →
   hasil) dan indikator unggah.
4. **Fase 4 — aset baru dari Codex** (`create-hero` v2, opsional struk
   terlipat), lalu penilaian di ukuran tampil, bukan di 1024 px.

## 7. Cara memverifikasi (harus, bukan opsional)

- Tangkapan layar pada 393 px dan 506 px, `deviceScaleFactor: 3`, animasi
  **dibekukan di beberapa fase** (0%, 46%, 90%) lalu dibandingkan — bukan satu
  frame.
- `prefers-reduced-motion: reduce` harus mematikan semua animasi (bukan
  memperlambat), dan tidak ada elemen yang bergeser posisinya saat animasi
  mati.
- Tidak ada pergeseran tata letak: kotak art berukuran tetap (112 px) sebelum
  dan sesudah animasi.
- Rekaman MP4 30 fps untuk diserahkan, bukan GIF — dan tidak diklaim sebagai
  bukti gerak; bukti tetap dari fase yang dibekukan.
