# Rencana: foto struk dan tempelan di layar buat bill

Status: **rencana, belum dikerjakan.** Menunggu persetujuan.

## Masalah yang harus dibereskan

1. **"ATAU" tidak pada tempatnya.** Tempel itu *sumber* foto, bukan niat ketiga.
   Menaruhnya sebaris dengan "Scan pakai AI" dan "Lampirkan saja" membuat mata
   membaca tiga ajakan yang setara, padahal dua di antaranya adalah keputusan
   (dibacakan AI atau tidak) dan satu cuma cara memasukkan berkas.
2. **Kartu tidak berubah saat foto masuk.** Setelah menempel, ilustrasi struk
   masih di tempatnya; yang tertempel cuma muncul sebagai kotak 64 px. Padahal
   sejak foto masuk, foto itu yang jadi subjek — ilustrasinya sudah tidak relevan.
3. **Tempel berulang tidak terdefinisi.** Sekarang tempelan kedua **menimpa**
   tempelan pertama tanpa kabar. Tidak ada jalan untuk melihat, membuang, atau
   menambah tanpa kehilangan yang sudah ada.

## Yang ditemukan saat membaca dokumen

- `docs/PRODUCT.md` bagian "Foto struk di layar buat bill (2026-10-26)" menulis
  *"tidak ada alur tempel, karena Ctrl+V memang tidak ada di HP"*. Alasan itu
  sudah tidak benar (papan klip bisa dibaca atas izin pengguna), jadi bagian itu
  perlu diperbarui, bukan dilanggar diam-diam.
- Dokumen yang sama menyebut **AI membaca paling banyak 2 foto per permintaan**,
  sedangkan `Create.tsx` mengirim `files.slice(0, 3)`. Salah satu harus menang;
  lihat "Keputusan yang harus diambil" di bawah.
- Bug nyata: `forAi = files.slice(0, 3)` tetapi `extras = files.slice(2)`. Dengan
  tiga foto, foto ketiga **dibaca AI sekaligus dilampirkan sebagai bukti** —
  dobel di bill.
- `docs/DESIGN_SYSTEM.md` sudah menyediakan dua hal yang dibutuhkan rencana ini:
  **ikon sekunder 48×48** (`.ds-icon-button`, latar `rgba(20,47,58,.06)`, ikon
  netral navy, "bukan mint") dan **`ActionGroup`/`ActionRow`** untuk daftar aksi
  di dalam sheet.

## Model yang dipakai

**Tempel adalah sumber, bukan niat.** Ada dua keputusan yang berbeda dan tidak
boleh dicampur di satu baris:

| Pertanyaan | Dijawab oleh | Bentuk |
| --- | --- | --- |
| Foto ini mau dibacakan AI atau cuma jadi bukti? | dua tombol niat | pil primary + pil secondary |
| Fotonya datang dari mana? | kamera/geleri (input file), atau papan klip | afordans kecil, bukan pil ketiga |

## Opsi A — ikon papan klip di baris aksi (rekomendasi)

Baris aksi jadi `1fr 1fr 48px`:

```
┌─────────────────────────────────────────────┐
│ Foto struk (opsional)          Isi manual saja
│ AI bisa membaca struk atau screenshot …      │
│                                              │
│ ┌───────────────┐ ┌──────────────┐ ┌────┐   │
│ │ Scan pakai AI │ │Lampirkan saja│ │ ⧉  │   │
│ └───────────────┘ └──────────────┘ └────┘   │
│ Bisa juga tempel screenshot — Ctrl+V.        │
└─────────────────────────────────────────────┘
```

- Ikon 48×48 netral (bukan mint), `aria-label="Tempel screenshot"`, judul
  `Tempel screenshot dari papan klip`.
- Muncul hanya kalau `navigator.clipboard.read` ada. Di komputer yang tidak
  mendukung, hint tetap menyebut Ctrl+V karena jalur `paste` tidak butuh izin.
- Tidak ada kata "atau", tidak ada baris teks tambahan, tidak ada pil ketiga.

Saat ada tempelan (1..10 berkas), kartu berganti bentuk — foto **menggantikan
ilustrasi**, bukan menemaninya:

```
┌─────────────────────────────────────────────┐
│ ┌─────────────────────────────────────────┐ │
│ │   [ hasil tempel, 16:10, object-cover ] │ │
│ └─────────────────────────────────────────┘ │
│ · · ▣          (strip 48 px untuk 2..10)     │
│                                              │
│ Screenshot siap dipakai          3 dari 10   │
│ Mau dibacakan AI, atau cuma dilampirkan?     │
│ ┌───────────────┐ ┌──────────────┐           │
│ │ Baca pakai AI │ │Lampirkan saja│           │
│ └───────────────┘ └──────────────┘           │
│ Tempel lagi · Batal                          │
└─────────────────────────────────────────────┘
```

- Tempelan berikutnya **menambah**, bukan menimpa. Tiap thumbnail punya tombol
  buang sendiri (`aria-label="Buang foto ke-2"`), strip bisa digeser mendatar.
- Batas 10 (batas bill), dan kalau sudah 10 tempelan berikutnya ditolak dengan
  pesan, bukan diam-diam.
- Foto pertama tampil besar karena itulah yang menentukan "ini struk yang benar
  atau bukan"; sisanya cukup strip.

## Opsi B — satu tombol "Tambah foto", sumber dipilih di sheet

```
┌─────────────────────────────────────────────┐
│ Foto struk (opsional)          Isi manual saja
│ ┌───────────────────────────────────────────┐│
│ │  ＋  Tambah foto struk                    ││
│ └───────────────────────────────────────────┘│
└─────────────────────────────────────────────┘
        ↓ sheet
   Kamera
   Pilih dari galeri
   Tempel screenshot          (kalau ada di papan klip)
```

Lebih rapi secara teori (satu aksi utama, sumber di daftar aksi), tapi menambah
**satu ketukan di jalur paling umum** (foto struk → kamera) dan menghapus
perbedaan niat di depan — padahal niat itulah yang menentukan orang menunggu AI
5–20 detik atau tidak. Untuk aplikasi yang dipakai sambil berdiri di kasir,
ketukan tambahan itu mahal.

**Rekomendasi: Opsi A**, dengan catatan sheet sumber dari Opsi B dipakai justru
saat papan klip berisi lebih dari satu gambar (memilih mana yang ditempel) —
kalau nanti terbukti perlu.

## Keputusan yang harus diambil pemilik

1. **AI membaca 2 atau 3 foto?** Dokumen bilang 2, kode mengirim 3. Kalau 3 yang
   benar (kode punya catatan struk 11 item terpotong tiga bagian tetap terbaca
   utuh), `PRODUCT.md` yang diperbarui. Kalau 2 yang benar, kode yang mundur.
2. **Tempelan ikut jadi bukti?** Kalau orang menempel 3 screenshot lalu memilih
   "Baca pakai AI", sisa yang tidak dibaca AI — dilampirkan otomatis sebagai bukti
   (perilaku sekarang untuk foto) atau dibuang? Rekomendasi: dilampirkan, karena
   membuang foto yang sudah diberikan pengguna itu mengejutkan.

## Perubahan yang akan dibuat (kalau disetujui)

1. `Create.tsx`: hapus baris "ATAU"; baris aksi jadi grid `1fr 1fr 48px` dengan
   `.ds-icon-button`; state tempelan jadi daftar (`File[]`), tambah/buang, batas
   10; kartu review dengan foto besar + strip; `Batal` di kanan atas.
2. `app.css`: `.photo-actions` versi tiga kolom, blok `.photo-review` (foto,
   strip, hitungan), hapus `.photo-or` dan `.photo-paste-hint` yang lama.
3. `Create.tsx`: perbaiki `extras = files.slice(2)` → `files.slice(forAi.length)`.
4. `docs/PRODUCT.md`: bagian foto struk diperbarui (alur tempel ada; batas AI
   sesuai keputusan di atas).
5. `docs/TEST-MATRIX.md` + `photo-intents.spec.ts`: kasus 40c/40d diperbarui,
   tambah kasus tempel berulang (3 tempelan → 3 berkas, buang satu → 2, batas 10).

## Ukuran dan aksesibilitas

- Ikon papan klip 48×48 (di atas minimum 44 px Apple HIG).
- Foto review: lebar penuh kolom teks, tinggi maksimum 168 px, radius 20.
- Strip thumbnail 48×48 radius 10, jarak 8, bisa digeser; tombol buang 24 px di
  pojok dengan area sentuh 44 px lewat padding.
- Hitungan ("3 dari 10") memakai `--ds-text-2xs` huruf kapital berjarak, bukan
  kalimat — sesuai aturan skala tipe.
- Fokus keyboard: masuk ke thumbnail pertama, `Enter` membuka penampil penuh.
