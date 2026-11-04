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

## 2b. Keputusan pemilik: frame-per-frame dari Codex (dikerjakan)

Pemilik memilih jalur frame-per-frame, bukan satu gambar + transform. Sudah
dikerjakan dan terpasang untuk koin di loading:

- 16 frame koin digenerate Codex satu per satu (satu `image_gen` per frame),
  lalu dirakit jadi satu sprite 3584x224 yang diputar `steps(16)` selama 1,28 s
  (12,5 fps) di kotak art 112 px.
- Posisi vertikal tiap frame **dipaksa dari kurva yang kita hitung**, bukan dari
  tempat model menaruhnya — model menggambar koinnya, geraknya presisi. Tanpa
  ini koin goyang ke samping karena tiap frame digambar dengan pusat berbeda.
- Berat: **62 KB** sprite, dibanding 9 KB untuk satu gambar. Waktu muat tidak
  berubah berarti karena dimuat bersamaan dengan layar pertama, tapi ini
  konsekuensi yang harus dicatat.
- Bayangan tetap lapisan CSS terpisah, sekarang **keras satu warna** (bukan
  `radial-gradient`), dengan 16 langkah sepadan frame koin.
- `anim/coin-app.webp` dihapus; tidak ada lagi dua sumber untuk benda yang sama.

Catatan mutu: pada pengujian 6 frame pertama, bentuk koin bergeser 1,2-4,4%
antar frame. Di ukuran tampil 47 px itu tidak terlihat; di 112 px pun masih
terbaca sebagai satu koin. Yang membuat geraknya halus ternyata **jumlah fase
dan posisi yang presisi**, bukan kesamaan sempurna antar frame.

## 2c. Perayaan lunas (dikerjakan)

- `anim/stamp-paid.webp`: **6 frame** stempel hasil generate (jatuh, menyentuh,
  menekan/squash, lepas), 1344x260, 116 KB. Diputar `steps(1)` dengan keyframe
  tidak rata; turunnya diatur `translateY` ber-steps karena kalau posisi ikut
  digambar, tiap frame mendarat di titik berbeda dan capnya terlihat melayang.
- Cincin tinta: CSS, menyusul 420 ms setelah cap menyentuh.
- Konfeti: **canvas**, 84 partikel, 1,15 detik, nol byte aset.
- Total di bawah 1,8 detik, `pointer-events: none` supaya bisa terus diketuk, dan
  seluruh gerak dimatikan saat `prefers-reduced-motion`.
- Muncul **hanya kalau server menerima** aksi (bukan saat gagal), sekali per aksi.

## 2d. `create-hero` v2 (dikerjakan)

Versi baru digenerate dengan instruksi tegas: **satu bayangan keras per benda,
tepi tajam, tanpa blur/gradien**. Diperiksa visual: mug, tiga strip struk, dan
tumpukan koin semuanya berbayangan keras satu warna, tanpa gradien. 576 px,
63 KB (dari 10 KB — versi lama bayangannya lembut dan melanggar kontrak).

`box-shadow` di `.create-hero img` dihapus: aset membawa bayangannya sendiri.

## 2e. Keadaan membaca struk (dikerjakan)

- `anim/scan-frames.webp`: **8 frame** struk tegak dengan pita pindai yang turun
  dari frame ke frame, 1920x240, **24 KB** — lebih ringan dari pasangan lama
  (`scan.webp` 24 KB + `scan-line.webp` 19 KB), dan `scan-line.webp` dihapus.
- Diputar `steps(8)` 1,9 detik. Jarak langkah tepat 8 x 120 = 960 px; dengan
  persentase, tiap langkah jatuh di antara dua sel.
- Modelnya mengembalikan kedelapan frame dengan kotak objek **identik**
  (468x918 di koordinat yang sama), jadi tidak ada normalisasi posisi yang
  perlu dikerjakan — potong kotak yang sama, susun satu baris.
- Ilustrasi diamnya tetap diam; frame-frame ini masuk dengan silang-pudar 180 ms
  karena komposisinya beda (struk tegak vs struk miring di bingkai bidik).
- Uji 40b diubah mengikuti kontrak baru: yang diperiksa `background-position`
  yang benar-benar berubah, bukan `transform` satu garis.

## 2f. Menutup bill (dikerjakan)

- `anim/bill-closed.webp`: **6 frame** struk terlipat (dari 8 yang digenerate;
  dua frame terakhir — versi berikat karet — dibuang karena pembaca visual
  menilainya berhenti bergerak dan bentuknya jadi mirip blok lain).
- Satu faktor skala untuk semua frame, dihitung dari frame pertama. Kalau tiap
  frame diskalakan sendiri-sendiri, struk terlihat menyusut saat terlipat —
  padahal kertasnya cuma terlipat.
- Kaki semua frame di garis yang sama; model mengembalikan tepi bawah struk di y
  yang konstan (1068 px di semua frame), dan itu dipertahankan.
- **Alas mint di kotak art.** Kertas krem di atas kartu putih nyaris tidak
  bertepi — pemeriksaan visual pertama menyebutnya "terlihat seperti bayangan".
  Alas `#EAF2EE` membuat bentuknya terbaca sebagai benda.
- Tanpa konfeti: menutup bill bukan prestasi, cuma memastikan angkanya berhenti
  berubah.

## 2g. Tamu yang baru bergabung (dikerjakan)

Bukan aset baru, tetapi ini yang membuat bill terasa hidup: dulu bill yang
sedang dibuka **berhenti pada gambar saat dibuka**. Orang lain memilih item,
ikut bergabung, atau membayar, dan layar tidak berubah sampai ditarik ulang.
Jadi:

- `useBill` sekarang menyegarkan tiap **12 detik** selama layar bill terbuka
  (`refetchInterval`; saat tab disembunyikan berhenti sendiri). Satu GET /bill
  terukur 4–13 ms di server, jadi ini murah.
- Baris orang yang **baru** muncul diberi gerak masuk sekali: naik 7 px, kilau
  mint 12%, selesai 0,7 detik. Render pertama hanya mengisi daftar orang —
  kalau tidak, saat layar dibuka semua orang beranimasi masuk sekaligus dan
  geraknya kehilangan arti.
- Diukur di aplikasi nyata: baris baru ditemukan **9,7 detik** setelah tamu
  bergabung, `background-color` saat terdeteksi `rgba(8,118,101,.12)`, animasi
  `ds-orang-masuk` 0,7 dtk.

## 2h. Dua aset mati (diputuskan)

- `empty-bill.webp` (31 KB) **dihapus**: subjeknya meja kafe dengan struk kosong,
  sedangkan keadaan "belum ada bill" sudah dipegang `home-empty.webp` (dompet
  kosong) — dua gambar untuk satu makna.
- `recap.webp` (6 KB) **dihapus**: keadaan kosong Rekap berjudul "Semua bill
  beres", dan `paid.webp` (stempel) memang lebih tepat untuk itu daripada koin
  dan kartu kosong.
- Keduanya hilang dari `ART_CONTRACT.md`; tidak ada kode yang mengimpornya.

## 2i. Angka besar naik, daftar masuk berurutan (dikerjakan)

- **Angka besar** (Beranda & Rekap, satu komponen `BalanceCard`) naik dari 0 ke
  nilai akhir dalam 460 ms, ease-out kubik. Saat nilainya berubah karena
  penyegaran, dia naik dari nilai lama ke nilai baru dalam 320 ms — bukan
  berdetak dari 0 lagi.
- **Angka panjang (di atas 8 karakter) tidak dinaikkan.** Tiap langkah mengubah
  lebar teks, dan di nominal 10 digit itu memicu perubahan ukuran font
  (`is-long` / `is-xl`) di tengah jalan: angka besar melompat ukuran sambil
  berdetak.
- **Baris daftar masuk berurutan**, maksimal enam baris (35–150 ms). Setelah
  baris keenam tidak ditunda lagi: daftarnya panjang, dan menunda baris
  keduapuluh membuat layar terasa lambat.
- Semuanya mati saat `prefers-reduced-motion`.

Jebakan yang kena dua kali dan layak dicatat: **React StrictMode menjalankan
efek dua kali**. Versi pertama memakai "nilai render sebelumnya" sebagai titik
awal; jalan pertama sudah mencatat nilai akhir, jalan kedua menyimpulkan "tidak
ada perubahan" dan angkanya melompat 0 → final tanpa animasi. Yang benar: titik
awal dibaca dari nilai yang **sedang tampil** (`ref`), jadi jalan kedua
melanjutkan dari tempat jalan pertama berhenti.

## 2j. 24–30 fps (dikerjakan)

Model gambar tidak bisa menjaga benda yang sama di 24 frame berturut-turut. Yang
stabil: 6–8 frame kunci. Jadi **frame antaranya diinterpolasi gerak** — ffmpeg
`minterpolate` mode mci/aobmc, cara yang sama dengan retiming video. Hasil
pemeriksaan visual: tidak ada ghosting atau bayangan ganda pada frame tengah.

| Animasi | Frame | Durasi | fps | Berat |
| --- | --- | --- | --- | --- |
| Struk terlipat | 24 | 820 ms | ~29 | 136 KB |
| Stempel lunas | 20 | 640 ms | ~31 | 103 KB |
| Pita pindai | 20 | 700 ms | ~28 | 126 KB |

Tiga hal yang harus benar:

1. **Pemutarnya `requestAnimationFrame`, bukan `steps()`.** Keyframe CSS harus
   ditulis satu per satu untuk tiap jumlah frame; pemutar JS menerima jumlah apa
   pun dan menghitung sel dari **waktu nyata** — di layar 120 Hz, "satu frame per
   render" akan berjalan dua kali lebih cepat.
2. **Butir kertas dihaluskan 3 px sebelum encode.** Butir halus adalah biaya
   terbesar WebP: 24 frame dengan grain utuh 260 KB, dengan grain dihaluskan
   128–136 KB pada ukuran tampil yang sama. Di 112 px butirnya tidak terlihat.
3. **`p` dijepit ke ≥ 0.** Di frame pertama jam rAF bisa sedikit lebih awal dari
   `performance.now()`; tanpa penjepit, sel-nya jadi −1 dan muncul satu frame
   kosong di awal animasi.

Total aset animasi naik dari 219 KB ke 365 KB — harga dari 30 fps. Dicatat
terang-terangan karena ini trade-off, bukan perbaikan gratis.

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

1. ~~**Fase 1 — satu bahasa bayangan.**~~ **Selesai**: bayangan koin jadi keras
   satu warna, `box-shadow` di `.create-hero img` dihapus. Sisa: dua aset mati
   (`empty-bill.webp`, `recap.webp`) belum diputuskan.
2. ~~**Fase 2 — perayaan lunas.**~~ **Selesai**: stempel 6 frame + cincin +
   konfeti canvas, `prefers-reduced-motion` mematikannya total.
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
