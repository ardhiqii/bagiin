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

## Integritas angka

Yang harus selalu benar di setiap layar, dan diuji ulang setelah perubahan apa pun:

1. `sum(bagian orang) + uncovered + remaining_to_creator == total` — dijaga backend,
   diuji `integration.spec.ts` 73–74 dan audit 59 bill.
2. Angka di beranda adalah **bagian saya**, bukan total bill.
3. Rekap: `sum(counterparties) == payable + receivable`.
4. Perkiraan (`±`) ditampilkan terpisah, tidak dijumlahkan ke angka pasti.
5. Saldo nol tidak menampilkan kartu besar.

## Cara menjalankan

```bash
cd frontend
npx playwright test                     # semua
npx playwright test tests/v1-cases.spec.ts
```
