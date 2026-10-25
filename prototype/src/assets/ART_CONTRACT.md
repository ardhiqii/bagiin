# Kontrak aset ilustrasi

Dokumen ini yang dipakai kalau ada aset baru. Bagian **kontrak** disalin apa adanya
ke tiap brief; yang berubah hanya subjek dan komposisi. Kalau sebuah aset butuh
medium lain (foto, 3D), itu kontrak baru — jangan dicampur di produk yang sama.

Generator: model GPT Image lewat Codex CLI (`image_gen`). Output asli 1254×1254,
lalu dipotong dan dikompres di sisi kita.

## Kontrak (tidak berubah)

```
Style/medium: flat illustration, printed. Screen-print or risograph feel, not
  vector icons: solid flat colour shapes with visible paper grain and ink texture
  across the whole surface, edges slightly imperfect, one hard offset shadow in a
  darker tint of the surface colour so objects sit on it instead of floating.
  No outlines around shapes.
Depth: only the single hard offset shadow and overlapping shapes. No gradients,
  no 3D shading, no glossy highlights.
Grain: applied to every surface, not only the background.
Colour palette: deep teal-navy #142F3A, teal #087665, mint #E2F5EF, warm off-white
  #F5F1E8, pure white paper, amber #C98A2E (status pending). Nothing outside this list.
Constraints: no readable text or numbers, no logos, no people, no hands, no phone
  UI. Paper carries only faint rules, no characters. Square 1:1.
```

## Yang berubah per aset

```
Primary request: <satu subjek, satu kalimat>
Scene/backdrop: <permukaan tempat subjek berada>
Composition/framing: <porsi frame, penempatan, ruang kosong>
```

## Aset yang sudah ada

| File | Subjek | Tampil | Berat |
| --- | --- | --- | --- |
| `empty-bill.webp` 648 px | meja dari atas, struk kosong, cangkir, koin | 216 px (empty state) | 30 KB |
| `create-hero.webp` 576 px | struk sobek jadi tiga strip, cangkir, koin | 120 px (Buat · Dari foto) | 10 KB |
| `manual.webp` 320 px | struk dan pensil | 120 px (Buat · Ketik manual) | 13 KB |
| `invite.webp` 320 px | dua cangkir bersulang | 108 px (sheet Undang teman) | 13 KB |
| `item.webp` 320 px | piring, sendok, garpu | 108 px (sheet item) | 7 KB |
| `person.webp` 320 px | koin dan setengah struk | 108 px (sheet orang) | 9 KB |
| `recap.webp` 320 px | koin dan catatan | 104 px (layar Rekap) | 6 KB |

Aset besar (648/576 px) untuk tempat yang tampil ≥200 px; aset kecil (320 px) untuk
thumbnail dan sheet, cukup untuk layar 3× pada ukuran 104–120 px.

## Aturan produksi

- Titik akhir: `1014×1014` tidak ada gunanya; resize ke 648 (tampil 216) atau 576
  (tampil ≤140) sebelum masuk repo.
- Format: WebP q86–88 untuk ilustrasi bertekstur. PNG palet hanya kalau background
  benar-benar satu warna datar dan perlu transparan.
- Ukuran tampil minimum: **110 px**. Di bawah itu grain jadi noise; naikkan ukuran
  tampil atau sederhanakan gambar.
- **Jangan memotong subjek saat crop.** Ukur dulu kotak subjek (paling luar dari
  objek, bayangan ikut), lalu sisakan paling sedikit **4% sisi pendek** di sisi
  terketat. Crop tengah dengan fraksi tetap (0.78, 0.80) adalah cara paling gampang
  memotong pisau — pernah kejadian di `item.webp`.
- Kalau subjek terpotong, **perbaiki crop dari PNG asli 1254 px**, jangan generate
  ulang. Generatornya benar; pemotongnya yang salah.
- Jangan menaruh teks, angka, atau logo di dalam gambar. Semua makna dibawa teks UI.

## Cara menilai hasil

Tolak dan brief ulang kalau:

- hasilnya terbaca sebagai icon set atau bentuk yang digambar kode (tanpa grain,
  tanpa bayangan, tepi terlalu bersih);
- mediumnya melawan sistem (foto atau 3D di dalam UI flat);
- subjeknya salah jenis (struk yang terbaca sebagai serbet atau kartu);
- ada teks/angka/logo/wajah yang ikut;
- palet keluar dari daftar hex;
- gambar hanya bagus di ukuran penuh dan hancur di ukuran tampil.
