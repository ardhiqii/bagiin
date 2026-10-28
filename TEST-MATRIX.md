# Matriks pengujian versi 1

Dokumen ini adalah **sumber kebenaran pengujian** untuk branch `react` (versi 1).
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
| X-07 | Nama pembeda dobel ditolak (tidak ada dua "Amel" yang sama) | `auth-and-contacts.spec.ts` 116 |
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
