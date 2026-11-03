# Matriks pengujian versi 1

Dokumen ini adalah **sumber kebenaran pengujian** untuk versi 1 (branch `main`).
Isinya: siapa aktornya, cerita pengguna yang harus jalan, dan daftar kasus yang
dipakai e2e. Setiap kasus punya ID dan nama tes — kalau satu kasus tidak punya
tes, itu celah, bukan "nanti saja".

Legenda jenis kasus:

- **N** normal — jalur yang paling sering dilalui orang
- **A** alternatif — tujuan sama, jalan berbeda
- **X** anomali — keadaan tidak wajar tapi nyata (nama kembar, sesi dicabut, bill lunas)
- **E** edge — batas nilai/ukuran
- **G** negatif — harus ditolak, dan penolakannya harus jelas

## Aktor

| Aktor | Ciri |
|---|---|
| Tamu | identitas tanpa username/password/Google; hidup di satu perangkat |
| Pemilik akun | punya salah satu cara masuk; bisa masuk dari perangkat lain |
| Anggota | ikut bill lewat link, memilih item sendiri |
| Orang luar | punya link tapi bukan peserta |
| Kembar nama | dua identitas dengan nama tampilan identik |

## Cerita pengguna

**US-1 — Aku ikut bill tanpa daftar.**
Buka link → isi nama → pilih item → lihat bagianku.
Alternatif: masuk pakai kode pemulihan kalau ternyata sudah pernah ikut bill ini.
Anomali: nama sama dengan peserta lain → dibedakan handle/alias.
Negatif: link mati → halaman 404 berkerangka aplikasi, bukan layar putih.

**US-2 — Aku bikin bill dan menagih teman.**
Buat bill (manual atau foto struk) → bagikan link → lihat siapa belum memilih →
tandai lunas.
Anomali: bill lunas → semua kontrol edit mati (server 409, bukan cuma UI).
Edge: nominal Rp0, nominal puluhan juta, judul 120 karakter.

**US-3 — Aku pindah HP tanpa kehilangan bill.**
Tamu memasang username/password **atau** Google → masuk dari perangkat lain →
bill dan bagianku sama.
Negatif: password salah dan username tak dikenal memberi kalimat yang sama
(tidak membocorkan username mana yang ada).

**US-4 — Aku mengamankan identitas tamu.**
Beranda mengingatkan hanya kalau sudah ada bill yang bisa hilang; sekali ditutup
tidak muncul lagi.

**US-5 — Aku membedakan dua orang bernama sama.**
Kontak → beri nama pembeda → pembeda itu muncul di layar bill dan rekap **hanya
untukku**, tidak pernah dikirim ke orangnya.

**US-6 — Aku masuk lagi setelah sesi mati.**
Sesi dicabut server / identitas basi → aplikasi membuka layar masuk dengan tab
**Kode** terbuka, bukan menyuruhku mengetik nama baru (yang akan membuat profil
kosong).

## Kasus

### Normal

| ID | Kasus | Tes |
|---|---|---|
| N-01 | Tamu buat bill, teman ikut, pilih item, angka konsisten di beranda/bill/rekap | `app.spec.ts` 3, `integration.spec.ts` 73–74 |
| N-02 | Pemilik akun masuk username+password lalu melihat bill miliknya | `auth-and-contacts.spec.ts` 102 |
| N-03 | Tamu memasang username+password lalu masuk dari perangkat lain | `v1-cases.spec.ts` V-01 |
| N-04 | Login Google pertama kali: identitas dibuat + kode pemulihan tampil sekali | `auth-and-contacts.spec.ts` 111 |
| N-05 | Google `sub` yang sama tidak membuat identitas kedua | `auth-and-contacts.spec.ts` 111 |
| N-06 | Empat orang satu bill, tiap orang melihat bagiannya sendiri | `portions.spec.ts` 26–28 |

### Alternatif

| ID | Kasus | Tes |
|---|---|---|
| A-01 | Masuk pakai kode pemulihan, bukan password | `restore.spec.ts` 43 |
| A-02 | Masuk pakai Google yang sudah tertaut ke identitas lama | `auth-and-contacts.spec.ts` 112 |
| A-03 | Satu baris dibagi bertiga otomatis | `portions.spec.ts` 27 |
| A-04 | Tamu diundang lewat sheet undangan (bukan link) | `integration.spec.ts` 81 |
| A-05 | Foto struk mengisi form, bukan mengetik manual | `ocr.spec.ts` 36 |
| A-06 | Layar masuk dibuka dari `/masuk` langsung (tab Kode) vs dari beranda (tab Nama) | `v1-cases.spec.ts` V-04 |

### Anomali

| ID | Kasus | Tes |
|---|---|---|
| X-01 | Dua peserta bernama identik di satu bill tetap bisa dibedakan | `auth-and-contacts.spec.ts` 118 |
| X-02 | Sesi dicabut server saat layar terbuka → keluar rapi, bukan pesan mentah | `auth.spec.ts` 72 |
| X-03 | Bill lunas beku: `paid_by` ditolak 409, form ubah menjelaskan keadaan | `integration.spec.ts` 95, 100 |
| X-04 | Item tanpa pemilih dilaporkan (belum jelas), bukan dibebankan diam-diam | `integration.spec.ts` 76 |
| X-05 | Identitas basi (server tidak kenal) → tab Kode, bukan Nama | `v1-cases.spec.ts` V-05 |
| X-06 | Ganti password mencabut sesi perangkat lain | `auth-and-contacts.spec.ts` 108 |
| X-07 | Nama pembeda dobel ditolak (tidak ada dua "Sari" yang sama) | `auth-and-contacts.spec.ts` 116 |
| X-08 | Net nol **tapi** masih ada bill yang menunggu: kalimat "tidak ada utang tersisa" tidak boleh muncul di samping banner "1 bill perlu kamu bereskan" | audit data (2 identitas di DB produksi: *deandra*, *temen terbaik aufa*), perbaikan copy di `Home.tsx` |

### Edge

| ID | Kasus | Tes |
|---|---|---|
| E-01 | Judul 120 karakter + coba XSS tidak mengeksekusi apa pun | `integration.spec.ts` 98 |
| E-02 | Nominal Rp9.999.999 tetap bulat, tanpa pembulatan aneh | `integration.spec.ts` 99 |
| E-03 | Bill Rp0 tidak menuntut siapa pun memilih item | `integration.spec.ts` 96 |
| E-04 | Nama 60 karakter + emoji tampil utuh, tidak memotong layout | `v1-cases.spec.ts` V-06 |
| E-05 | 390 px tidak melebar horizontal | `edge.spec.ts` 19 |
| E-06 | 1280 px tidak melebar; kartu masuk benar-benar center | `edge.spec.ts` 20, `v1-cases.spec.ts` V-07 |
| E-07 | Porsi lebih banyak daripada orang yang ikut | `portions.spec.ts` 28 |

### Negatif

| ID | Kasus | Tes |
|---|---|---|
| G-01 | Password salah dan username tak dikenal: kalimat sama persis | `auth-and-contacts.spec.ts` 103 |
| G-02 | Username sudah dipakai ditolak, isian tidak hilang | `auth-and-contacts.spec.ts` 104 |
| G-03 | Password < 8 karakter ditolak sebelum akun dibuat | `auth-and-contacts.spec.ts` 105 |
| G-04 | Kode pemulihan salah: pesan jelas, identitas tidak dibuat | `restore.spec.ts` 44, `v1-cases.spec.ts` V-08 |
| G-05 | Melepas Google ditolak kalau tidak ada cara masuk lain | `auth-and-contacts.spec.ts` 113 |
| G-06 | Alamat dalam tanpa identitas tertutup, tapi link bill tetap terbuka | `auth.spec.ts` 71 |
| G-07 | Alamat asing (404) memberi jalan pulang, bukan layar putih | `integration.spec.ts` 94 |
| G-08 | Perangkat lain tidak bisa memakai token perangkat ini | `v1-cases.spec.ts` V-09 |

### Abuse & ketahanan (orang tidak sabar, jaringan jelek, isian nakal)

| ID | Kasus | Tes |
|---|---|---|
| A-01 | Ketuk item 6x cepat: porsi bertambah tepat, satu baris pilihan, uang pas | `abuse.spec.ts` A-01 |
| A-02 | Tiga ketukan "Buat bill": hanya satu bill lahir | `abuse.spec.ts` A-02 |
| A-03 | Spam "Tandai lunas": status akhir lunas, total tidak bergeser | `abuse.spec.ts` A-03 |
| A-04 | Spam tombol tambah porsi berhenti di qty item | `abuse.spec.ts` A-04 |
| A-05 | Satu tamu menekan "Ikut bill" berkali-kali: tetap satu peserta | `abuse.spec.ts` A-05 |
| B-01 | Dua tamu menekan item terakhir bersamaan: uang tetap utuh, tidak ada bagian negatif | `abuse.spec.ts` B-01 |
| C-01 | Pilih item gagal karena jaringan: pesan "Koneksi bermasalah", server tidak berubah | `abuse.spec.ts` C-01 |
| C-02 | Daftar bill lambat 2,5 detik: tidak mengklaim "tidak ada utang" sebelum data datang | `abuse.spec.ts` C-02 |
| C-03 | Server menolak simpan nama: pesan muncul, nama di perangkat tidak berubah | `abuse.spec.ts` C-03 |
| D-01 | Harga diisi huruf/minus/angka raksasa: tidak ada NaN di layar, bill tetap bisa dibuat | `abuse.spec.ts` D-01 |
| D-02 | Judul 400 karakter: klien menahan di 120, layar tidak melebar | `abuse.spec.ts` D-02 |
| D-03 | Item tanpa nama: tombol mati **dan** alasannya tertulis | `abuse.spec.ts` D-03 |
| E-01 | Kembali lalu maju: angka bill tidak berubah | `abuse.spec.ts` E-01 |
| E-02 | Muat ulang di tengah memilih: pilihan bertahan | `abuse.spec.ts` E-02 |
| E-03 | Dua tab identitas sama: aksi tab satu terlihat di tab dua setelah muat ulang | `abuse.spec.ts` E-03 |
| A-06 | 2 minuman dibagi 4 orang: tiap orang bayar seperempat, layar menulis "dibagi 4 orang" | `abuse.spec.ts` A-06 |

### Integritas yang tidak kelihatan

| ID | Kasus | Tes |
|---|---|---|
| I-01 | Pratinjau tautan + PWA: `og:image`, `manifest.webmanifest` (MIME `application/manifest+json`), ikon 192/512/maskable | `v1-integrity.spec.ts` I-01 |
| I-02 | Tombol bagikan menyalin tautan bill; tanpa `navigator.share` jatuh ke clipboard, bukan diam | `v1-integrity.spec.ts` I-02 |
| I-03 | Getaran menyala saat item dipilih/dilepas (stub `navigator.vibrate`) | `v1-integrity.spec.ts` I-03 |
| I-04 | Angka daftar == angka halaman bill == invarian `sum(bagian) + uncovered == total`, diambil dari API | `v1-integrity.spec.ts` I-04 |
| I-05 | Identitas tamu 0.9 (localStorage lama) dikenali 1.0 tanpa diganti identitas baru | `v1-integrity.spec.ts` I-05 |
| I-06 | Sapuan semua layar: 0 error konsol, 0 gambar rusak, tidak melebar, tidak ada NaN | `v1-integrity.spec.ts` I-06 |
| I-07 | Nama pembeda 0.9 di localStorage pindah ke server sekali, lalu tampil di Kontak | `v1-integrity.spec.ts` I-07 |
| I-08 | Pembeda publik yang terpampang (#ABCD) bisa dipakai sebagai kata cari di Kontak | `auth-and-contacts.spec.ts` 120 |
| I-09 | Terima Rp230.000 + bayar Rp22.000: Beranda dan Rekap menampilkan angka NET yang sama beserta rincian `Terima +…` / `Bayar −…` | `recap.spec.ts` 125 |
| — | Tombol "Buat bill" ditunggu sampai `enabled` sebelum diklik (41 tempat): klik ke tombol mati hilang tanpa jejak dan di mesin lambat terbaca sebagai "aplikasi tidak berpindah" | semua spec |
| I-10 | Angka besar bisa diketuk: sheet Rincian saldo menunjukkan terima − bayar = selisih, memisahkan yang belum pasti, dan tombolnya menggulir ke daftar bill | `recap.spec.ts` 126 |
| I-11 | Beranda memuat **semua** bulan sekaligus dipisah judul bulan dengan satu query; penyaringan bulan ada di sheet "Atur" dan terjadi di klien (tidak meminta data lagi) | `monthly.spec.ts` 128 |
| I-12 | Pencarian menembus semua bulan, termasuk saat bulan sedang tersaring | `monthly.spec.ts` 129 |
| I-13 | Peserta bill dipilih dari kontak lewat sheet pencarian (multi-centang), bukan nama ketik; nama lama tetap bisa dihapus | `roster.spec.ts` 39, `edit.spec.ts` 49 |
| I-14 | Bill yang sudah lunas memakai lencana hijau **Lunas** dan angkanya meredup; baris yang belum selesai tidak punya lencana, jadi menonjol saat daftar disapu mata | `monthly.spec.ts` 131 |
| I-15 | Riwayat lintas tahun disaring dua tingkat: chip tahun (dengan jumlah bill) lalu grid 12 bulan; bulan tanpa bill dimatikan; memilih tahun menyaring daftar ke tahun itu | `monthly.spec.ts` 132 |
| I-16 | Tanggal bill bisa diubah saat membuat bill, bawaannya hari ini menurut jam perangkat (bukan UTC); tanggal pilihan yang tampil di beranda dan yang menentukan bulannya | `monthly.spec.ts` 134 |
| I-17 | Foto struk di layar buat bill bisa diketuk untuk diperiksa penuh sebelum bill disimpan | `photo-intents.spec.ts` 43 |
| I-18 | Tanggal bill bisa diganti saat mengubah bill, dan tanggal barunya yang menentukan bulan di beranda | `edit.spec.ts` 50 |
| I-19 | Foto struk ikut tampil di layar Ubah bill dan bisa dilihat penuh | `photo-intents.spec.ts` 44 |

## Integritas angka

Yang harus selalu benar di setiap layar, dan diuji ulang setelah perubahan apa pun:

1. `sum(bagian orang) + uncovered + remaining_to_creator == total` — dijaga backend,
   diuji `integration.spec.ts` 73–74, `v1-integrity.spec.ts` I-04, dan audit mesin
   split (`calc.compute`) atas **seluruh 81 bill** di salinan DB produksi: 0 pelanggaran.
2. Angka di beranda adalah **bagian saya**, bukan total bill.
3. Rekap: `sum(counterparties) == payable + receivable`.
4. Perkiraan (`±`) ditampilkan terpisah, tidak dijumlahkan ke angka pasti.
5. Saldo nol tidak menampilkan kartu besar.
6. **Lintas endpoint:** angka di daftar bill == angka di halaman bill == angka di
   rekap. Audit terakhir: 54 identitas × 162 pemeriksaan, 81 bill, 0 pelanggaran.
7. **Buku besar seimbang:** jumlah `net_idr` semua identitas = 0 (uang tidak
   muncul atau hilang dari perhitungan). Audit terakhir: tepat 0.
8. **Tombol mati harus menjelaskan alasannya.** Tombol "Buat bill" dan "Simpan
   perubahan" menampilkan alasan di tempat yang sama saat dinonaktifkan. Diukur
   `abuse.spec.ts` D-03.

## 2 minuman dibagi 4 orang (kasus yang diminta)

Perilaku uang yang terbukti lewat API:

| Klaim | Hasil |
|---|---|
| 1 orang klaim 1 dari 2 porsi (item Rp40.000) | bayar Rp20.000, Rp20.000 belum diambil |
| 1 orang klaim 2 porsi | bayar Rp40.000, tidak ada sisa |
| 2 orang masing-masing 1 | Rp20.000 + Rp20.000 |
| 4 orang masing-masing 1 | Rp10.000 + Rp10.000 + Rp10.000 + Rp10.000 |
| 2 orang, klaim 1 dan 2 | proporsional Rp26.666 + Rp13.334 |

Jumlah bagian selalu == total bill, tidak pernah ada bagian negatif, dan uang
tidak pernah lebih atau hilang. Batas di UI adalah **per orang** (satu orang
tidak bisa mengklaim lebih dari jumlah porsi), bukan batas jumlah pengambil —
jadi 4 orang memang boleh berbagi 2 minuman.

Yang dulu salah bukan hitungannya, tapi layarnya: baris item menulis
"4 dari 2 diambil" dan menampilkan harga satu porsi (Rp20.000) padahal tiap
orang membayar Rp10.000. Sekarang baris menulis "dibagi 4 orang" dan
menampilkan harga baris; bagian per orang ada di daftar orang. Dijaga
`abuse.spec.ts` A-06.

## Uji kering migrasi database produksi

Dijalankan pada **salinan** DB produksi (`sqlite3 .backup`, produksi tidak
disentuh):

- boot backend 1.0 → 3 tabel baru (`device`, `oauth_account`, `contact_alias`),
  4 kolom baru di `identity` (`username`, `username_lower`, `password_hash`,
  `handle`), 54 handle terisi
- **jumlah baris semua tabel lama tidak berubah satu pun** (identity 54, bill 81,
  item 175, selection 208, payment 140, bill_photo 27, bill_invite 51,
  bill_participant 6)
- boot backend 0.9 pada DB yang sudah dimigrasi → tetap membaca bill yang sama
  (200). Artinya rollback ke 0.9 masih mungkin setelah migrasi.
- salinan uji dihapus setelah selesai

## DB 0.9 dipakai 1.0 (migrasi + data lama)

Dijalankan dengan `MIGRATION_DB=<salinan db 0.9> MIGRATION_SOURCE=<db 0.9 asli>`.
Spec: `tests/migration.spec.ts`.

| Kode | Yang dijaga | Hasil |
|---|---|---|
| M-01 | migrasi menambah 3 tabel + 4 kolom + 4 index; kolom lama utuh; kolom baru **nullable** (0.9 masih menulis ke tabel yang sama); semua identitas 0.9 dapat pembeda | lulus |
| M-02 | sapuan semua bill 0.9: total tidak berubah, `sum(orang) + uncovered == total`, `total_ok` benar, tak ada bagian negatif | lulus |
| M-03 | struk lama (`bill.photo_path` 0.9) ikut jadi `bill_photo` dan filenya benar-benar terambil (200, `image/*`, > 1 KB) | lulus |
| M-04 | rekap identitas 0.9 dihitung 1.0: `net = terima − bayar`, punya lawan transaksi | lulus |
| M-05 | identitas 0.9 bisa naik jadi akun 1.0 (username + password) lalu masuk lagi ke identitas yang sama | lulus |
| M-06 | bill 0.9 masih bisa disunting pemiliknya; total tidak bergeser | lulus |
| M-07 | tamu baru bisa ikut bill 0.9; uang tetap utuh setelah orang bertambah | lulus |
| M-08 | tiga bill 0.9 terbuka di layar: judul, total, nama orang sama dengan server; struk termuat; nol error konsol/4xx | lulus |
| M-09 | Beranda dan Rekap identitas 0.9 menampilkan angka yang sama, dan angka besar bisa diketuk jadi rincian | lulus |
| M-10 | identitas baru langsung menyimpan pembedanya, tanpa menunggu restart | lulus |

Bukti migrasi (salinan DB produksi 0.9, boot backend 1.0):

| | 0.9 | setelah boot 1.0 |
|---|---|---|
| tabel | 10 | 13 (`+device, oauth_account, contact_alias`) |
| kolom `identity` | 7 | 11 (`+username, username_lower, password_hash, handle`) |
| index | 7 | 11 |
| baris | 54/81/175/208/140/27/51/6/10 | **sama persis** |
| pembeda kosong | – | 0 |

Temuan yang lahir dari run ini:

- `POST /api/bills` tadinya dibatasi 10/menit per IP dengan angka hardcode. Suite
  penuh kadang menembusnya (11 bill dalam satu menit) → tes gagal karena 429, bukan
  karena aplikasi. Sekarang batasnya bisa dituning lewat `BAGIIN_RL_BILL` /
  `BAGIIN_RL_ACCOUNT` / `BAGIIN_RL_UPLOAD` (bawaan tetap `10/minute`), dan instance
  uji memakai `60/minute`. Efek produksinya dicatat di `API_CONTRACT.md` §0.5: banyak
  orang di satu IP (Wi-Fi kantor/kafe/NAT operator) berbagi jatah yang sama.
- `POST /api/bills/{id}/join` dulu menerima `identity_id` di body lalu
  mengabaikannya: pemanggil yang mengira mendaftarkan orang lain tetap dapat 200
  tanpa ada yang berubah. Sekarang ditolak 403 "Join hanya untuk diri sendiri", dan
  pemilik yang menekan join di bill-nya sendiri tidak lagi dibuatkan baris
  `payment` (dia sudah ada di bill secara implisit). Dijaga tes **J-01**.
- `identity.handle` dulu hanya diisi `backfill_handles()` saat boot, jadi identitas
  baru menyimpan kolom kosong sampai restart berikutnya. Sekarang ditulis saat
  identitas dibuat. Dijaga tes **M-10**.

## Hasil verifikasi Google sungguhan (bukan stub)

Dijalankan di Chromium headful yang sudah punya sesi Google, terhadap build live:

1. Tombol Google memunculkan popup `accounts.google.com/v3/signin/accountchooser`
   → akun dipilih → layar consent → kembali ke aplikasi.
2. Aplikasi mengirim `id_token` asli ke `/api/auth/google`.
3. Server live menjawab **401 "Token Google tidak valid"** karena
   `BAGIIN_GOOGLE_STUB=1`. Ini bukan bug kode: stub memang hanya menerima token
   `stub:`. Tapi artinya **login Google sungguhan belum hidup di situs live**.
4. Token yang sama dikirim ke instance backend dengan stub **mati**
   (`BAGIIN_GOOGLE_STUB=0`) → **200**, identitas dibuat dari nama akun Google,
   `recovery_code` diberikan, sesi perangkat terbit, dan baris `oauth_account`
   tersimpan. Login kedua dengan token yang sama → identitas yang sama (tidak
   ada akun dobel).

### Dua hal yang ketemu dari uji ini

- **`requests` tidak terpasang** di lingkungan Python bersama, padahal
  `google.oauth2.id_token` memakai transport itu untuk memeriksa tanda tangan
  ke kunci publik Google. Selama stub menyala, kekurangan ini tidak kelihatan;
  begitu stub dimatikan, login Google akan gagal 500. Sudah ditambahkan ke
  `backend/requirements.txt` dan dipasang.
- Lingkungan Python 1.0 **meminjam venv 0.9**
  (`ExecStart=/opt/projects/bagiin/backend/venv/bin/uvicorn`). Bekerja, tapi
  artinya perubahan paket untuk 1.0 menyentuh runtime 0.9. Sebaiknya 1.0 punya
  venv sendiri sebelum cutover.

## Kotak hitam 1.0 — e2e sebagai orang yang belum pernah melihat aplikasi

Sembilan belas berkas, **136 kasus**, semuanya dijalankan lewat layar: tidak ada
satu pun pemanggilan API langsung untuk menyiapkan keadaan, karena yang diuji
adalah apa yang bisa dilakukan orang, bukan apa yang bisa dilakukan klien HTTP.

Sejak bug sheet iPhone, setiap kasus dijalankan di **dua mesin**: `mobile-chrome`
(Pixel 7) dan `mobile-safari` (WebKit, iPhone 15).

| Berkas | Kasus | Isi |
|---|---|---|
| `tests/blackbox.spec.ts` | 19 | masuk/layar awal, buat bill, layar bill, navigasi dan spam klik |
| `tests/blackbox-two-users.spec.ts` | 11 | tamu lewat link, dua tamu berebut item, beranda & rekap, pengaturan |
| `tests/blackbox-three.spec.ts` | 11 | saringan beranda, kontak & nama pembeda, undangan, ganti pembayar, kode pemulihan |
| `tests/blackbox-four.spec.ts` | 6 | akun & pindah perangkat, foto struk, alur scan yang dibatalkan, "Mulai dari nol" |
| `tests/blackbox-five.spec.ts` | 9 | nudge pengamanan, tautan bill tak dikenal, kembali berulang, bill dikunci, keluar, tolak undangan, item terakhir, pajak+diskon, pencarian kosong |
| `tests/blackbox-six.spec.ts` | 6 | rekening, tiga item, porsi qty 3, "Lampirkan saja", ganti nama |
| `tests/blackbox-seven.spec.ts` | 4 | rekap: kosong, terisi, tandai lunas, kesamaan angka dengan beranda |
| `tests/blackbox-eight.spec.ts` | 4 | pajak/service/diskon, diskon melebihi tagihan, mengeluarkan tamu |
| `tests/blackbox-nine.spec.ts` | 4 | rekening ubah/hapus, lunas per orang, kelompok bulan, cari merchant |
| `tests/blackbox-ten.spec.ts` | 8 | isian janggal: nama kosong, harga nol, qty 99, 12 item, nama 120 karakter + emoji, diskon = subtotal, pajak 100% |
| `tests/blackbox-eleven.spec.ts` | 7 | batas wewenang: tamu buka `/edit`, tiga peserta, keluarkan peserta, keluar sendiri, gabung lagi, lunas lalu menambah, bill ditutup |
| `tests/blackbox-twelve.spec.ts` | 7 | keadaan tidak rapi: identitas rusak, data situs dihapus, segarkan di tengah memilih, dua tab, judul 120 karakter di 320 px, tautan salah, bolak-balik Back |
| `tests/blackbox-thirteen.spec.ts` | 6 | angka: item dibagi tiga, pajak termasuk harga, diskon penuh + pajak, dua item senama, rekap dua bill, harga diubah setelah dipilih |
| `tests/blackbox-fourteen.spec.ts` | 6 | pintu masuk: gabung ke bill tertutup, dua tamu senama, nama 60 karakter, pemilik buka tautannya sendiri, ditutup saat tamu diam, klik "Ikut" dua kali |
| `tests/blackbox-fifteen.spec.ts` | 6 | dua orang mengubah hal sama: item dihapus, harga berubah, ditutup di tengah, ganti penalangi, keluar-lalu-masuk, tutup lalu buka |
| `tests/blackbox-sixteen.spec.ts` | 2 | sheet harus milik viewport: dipasang di `<body>`, menutupi bar bawah, isi panjang digulir sendiri |
| `tests/blackbox-seventeen.spec.ts` | 6 | realitas iPhone: ketukan cepat tidak jadi zoom, papan ketik menutupi layar, ponsel mendatar, nama beremoji, cari dengan huruf besar & spasi, tarik-ke-bawah tidak memuat ulang |
| `tests/blackbox-eighteen.spec.ts` | 6 | orang yang belum tahu apa-apa: tautan bill dari orang asing, langkah berikutnya setelah memilih, tautan salah, jaringan mati, nominal miliaran di 320 px, bahasa daftar aksi |
| `tests/blackbox-nineteen.spec.ts` | 6 | isian uang seperti orang mengetik: tempel "Rp 25.000", ketik "25rb", jumlah dikosongkan lalu 0, jumlah 999, nama item hanya spasi, tempel nama menu beberapa baris |

Jumlah seluruhnya: **630 penjalanan** (315 kasus × 2 mesin).

**Hasil putaran penuh terakhir (serial, dua mesin): 606 lulus, 20 dilewati,
0 gagal, 1,5 jam.** Yang dilewati adalah kasus yang memang butuh OCR asli,
login Google asli, atau kamera fisik.

Satu bug aplikasi lagi ditemukan justru karena putaran penuh ini: di WebKit,
pendaftaran nama kadang berhenti separuh jalan — identitas benar-benar dibuat
(server 200, `localStorage` terisi) tetapi layar tetap di "Mulai atau masuk",
tanpa pesan apa pun. Sekarang layar masuk memasang jaring pengaman: kalau masih
terpasang 1,2 detik setelah pendaftaran berhasil, ia memuat ulang ke beranda.
Jalur masuk lewat kode pemulihan dan login akun memakai jaring yang sama.

**Suite ini harus serial (`workers: 1`).** Percobaan dengan tiga pekerja
memunculkan kegagalan palsu — E4 "dua tab identitas yang sama" gagal sekali,
lalu lulus 3/3 ketika dijalankan sendiri; C2 dan U5 juga membaca layar yang
belum selesai dimuat. Kalau ada yang merah, jalankan ulang kasus itu sendiri
sebelum menyimpulkan ada bug.

### Cacat yang ditemukan gelombang ini

| # | Gejala | Akar | Perbaikan |
|---|---|---|---|
| 1 | dua ketukan cepat "Buat bill" melahirkan **dua** bill | `setBusy(true)` belum berlaku pada putaran render yang sama, jadi kedua ketukan lolos | kunci sinkron `useRef` di samping status tombol (`Create.tsx`) |
| 2 | tanggal `32/13/2026` diterima diam-diam | mask hanya memeriksa bentuk, bukan keberadaan tanggal di kalender | `DateField` menandai `aria-invalid` + hint merah, dan mengembalikan nilai sah saat ditinggal |
| 3 | qty item bisa 0 di Buat bill, padahal Ubah bill memaksa 1 | dua layar, dua aturan | `Math.max(1, …)` + clamp saat kolom ditinggal |
| 4 | peserta yang diundang tapi belum bergabung hilang dari daftar Orang, dan terkunci sebagai "bergabung" di Ubah bill | `waiting`/`claimed` memakai `identity_id`, bukan keanggotaan nyata | `waiting` mengecualikan `pending_invites`; `claimed` dari `data.people` |
| 5 | hapus nama peserta menyisakan kartu "Undangan menunggu" | undangan pending tidak dicabut | `set_participants` menghapus `bill_invite` pending yang identitasnya sudah tidak ada |
| 6 | "Terima undangan otomatis" tidak pernah dibaca ulang dari server | sesi hanya menggabungkan `name` dan `role` dari `/me` | `mergeIdentity` ikut membawa `auto_accept`, `username`, `handle` |
| 7 | saringan tanpa hasil mengunci orang: bilah "Bill kamu", tombol Atur, dan kolom cari ikut hilang | keadaan kosong hanya punya satu bentuk | keadaan "Tidak ada bill di saringan ini" + tombol "Tampilkan semua bill" |
| 8 | diskon melebihi tagihan menampilkan total **minus** (Rp-70.000) dengan alasan "Total masih Rp0" | total dihitung tanpa batas; batas server (diskon ≤ subtotal) tidak dicerminkan di layar | total ditahan di Rp0, kolom diskon menjelaskan, tombol simpan mati — di Buat dan Ubah bill |
| 9 | tombol "Keluarkan" tetap ditawarkan pada bill yang **sudah lunas**; diklik, ia gagal dan hanya memunculkan pesan galat | daftar Orang memeriksa `canManage` dan status bill, tetapi tidak memeriksa `settled`, sedangkan server menolak perubahan bill lunas (`_ensure_editable`) | `removable` ikut mensyaratkan `!data.settled` (`BillDetail.tsx`) — tombol yang pasti gagal tidak ditampilkan |

### Jalur yang ternyata sudah benar (tidak diubah)

- item terakhir tidak bisa dihapus di layar Ubah bill (tombolnya memang mati);
- tiga ketukan "Undang" pada kontak yang sama tetap satu undangan (unique + idempoten);
- bagian "Transfer ke …" hanya muncul kalau ada orang lain yang berutang;
- tautan bill tak dikenal mendarat di halaman "tidak ditemukan" berkerangka aplikasi;
- tamu yang sudah menandai lunas **tidak bisa** mengetuk item lagi — baris item mati,
  dan jalan keluarnya "Batalkan status lunas" di Aksi lain. Ini yang mencegah orang
  menambah utang yang sudah ia nyatakan selesai;
- setelah keluar dari bill, orangnya dibawa pulang ke beranda, bukan ditahan di bill;
- bill yang ditutup menampilkan lencana **Ditutup** di badan layar, sedangkan judul
  layar tetap nama bill — bukan judul "Bill ditutup";
- tamu yang membuka `/edit` melihat "Hanya yang menalangi bisa mengubah", bukan
  pesan status bill: batas wewenang diperiksa lebih dulu;
- dua tamu dengan nama yang sama tetap dua baris terpisah (identitas bukan nama);
- layar orang lain tidak menyegarkan diri sendiri: angka baru muncul setelah dimuat
  ulang, dan itu memang perilakunya sekarang;
- porsi yang tidak habis dibagi rata menaruh sisa 1 rupiah pada yang menalangi
  (10.000 dibagi 3 → 3.333 / 3.333 / 3.334).

| 10 | nominal **Rp1.234.567.890 terpotong** di layar 320 px: angka hero 34 px lebih lebar dari kartunya, jadi angkanya meluber keluar kotak | ukuran angka hero tetap (`--ds-text-4xl`) berapa pun panjang nominalnya | `.ds-balance-value.is-long` / `.is-xl` menurunkan ukuran satu-dua tingkat menurut panjang angka; dipakai kartu saldo dan total bill (`ds/primitives.tsx`, `BillDetail.tsx`, `design-system.css`) |
| 11 | di iPhone 15, sheet "Siapa yang ikut?" **tidak bisa digulir**: isinya terpotong tepat di atas bar "Total bill"/navigasi, dan sisanya tidak terjangkau jari | sheet dirender di dalam `<main class="app-body">`, dan elemen itu memakai `-webkit-overflow-scrolling: touch` + `overflow-y: auto`. Di iOS Safari wadah gulir seperti itu menjadi containing block untuk `position: fixed`, jadi overlay terkurung di kotak isi; Chromium tidak mereproduksinya karena `fixed` di sana tetap menempel ke viewport | `Sheet` dipasang lewat `createPortal` ke `document.body` (`ds/primitives.tsx`), plus `body.sheet-open .app-body { overflow: hidden }` supaya halaman di belakang berhenti menggulir. Dijaga `blackbox-sixteen.spec.ts` |

### Yang khas Safari dan tidak terlihat di Chromium

Enam hal ini ditemukan dengan menjalankan suite yang sama di WebKit, bukan dengan
membaca CSS. Semuanya diperbaiki, dan yang bisa dijaga lewat tes sudah dijaga.

1. **`position: fixed` di dalam `.app-body` terkurung** karena
   `-webkit-overflow-scrolling: touch` (cacat 11).
2. **`backdrop-filter` tanpa `-webkit-`**: Safari < 18 mengabaikannya, jadi bar
   bawah kehilangan blur. Sekarang ditulis berpasangan.
3. **`color-mix()` tanpa cadangan**: di iOS < 16.2 seluruh deklarasi `background`
   dibuang, dan bar bawah jadi bening — teks halaman terbaca menembusnya.
   Sekarang ada `background` solid sebelum `color-mix`.
4. **`height: 100dvh` tanpa cadangan `vh`**: di iOS < 15.4 frame aplikasi tidak
   punya tinggi, dan isi tidak bisa digulir. Sekarang `vh` ditulis lebih dulu.
5. **Tidak ada `touch-action`**: dua ketukan cepat pada tombol + / − memicu
   zoom halaman di iOS, dan halaman tidak kembali sendiri. Semua kontrol yang
   bisa diketuk sekarang `touch-action: manipulation` (dijaga T1).
6. **Status bar menimpa header saat dipasang ke layar utama** (PWA standalone):
   `.app-top` sekarang menambah `env(safe-area-inset-top)`.

Dua hal kecil lain: `-webkit-text-size-adjust: 100%` supaya iOS tidak membesarkan
teks sendiri, `overscroll-behavior-y: contain` supaya tarikan ke bawah tidak
memuat ulang halaman di tengah mengisi bill (dijaga T6), dan kolom pencarian
memakai `autoCapitalize="none" autoCorrect="off"` supaya kata kunci tidak diubah
mesin (`budi` tidak menjadi `Budi`).

### Catatan gelombang 10–15

Enam gelombang terakhir (40 kasus) tidak menemukan cacat uang: pembagian, pajak
proporsional, diskon, dan pembulatan tetap konsisten di layar tamu, layar pemilik,
dan rekap. Satu-satunya cacat baru ada di lapisan tombol (butir 9 di atas).

## Animasi pindai: garisnya yang bergerak, bukan gambarnya

Ilustrasi `scan.webp` dan berkas garis `scan-line.webp` adalah dua lapis terpisah.
Gambarnya diam; hanya garis hijau yang menyapu atas-bawah lewat `transform`
(`scan-sweep`, 2,3 detik, bolak-balik) sehingga kompositor yang menjalankannya di
60 fps. Diuji oleh `photo-intents.spec.ts` kasus **40b**: transform ilustrasi harus
`none`, transform garis harus berubah, garis harus tetap di dalam kotak ilustrasi,
dan dengan `prefers-reduced-motion: reduce` animasinya mati (bukan melambat).

Kenapa bukan sprite frame: `image_gen` hanya menghasilkan gambar diam, dan
menjejalkan beberapa frame hasil generate membuat gerakannya tersendat sekaligus
goyah antar-frame. Satu lapis per bagian yang bergerak + transform CSS adalah
satu-satunya jalan yang benar-benar mulus.

## Tempel screenshot (kasus 40c)

Struk yang paling sering dibagi orang Indonesia bukan berkas: screenshot pesanan
ojol yang masih menempel di papan klip. Layar buat bill karena itu menerima
tempelan di dua jalur — `Ctrl+V` di mana saja di layar itu, dan tombol "tempel
dari papan klip" yang muncul hanya kalau browser mengizinkan membacanya.

Keduanya bermuara ke fungsi yang sama dengan "Scan pakai AI": satu pembaca, dua
pintu masuk. Teks biasa yang ditempel dibiarkan menempel di kolomnya sendiri.
Dijaga oleh kasus 40c di `photo-intents.spec.ts` (teks tidak memicu pembacaan,
gambar memicu).
