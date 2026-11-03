# Audit performa & responsivitas

Bukan daftar keinginan: setiap baris di bawah berasal dari pengukuran atau dari
jalur kode yang dibaca. Angkanya diukur di mesin ini, DB salinan produksi.

## Prinsip yang dipakai

Urutan perbaikan, dari yang paling terasa oleh jari:

1. **Umpan balik lokal** — sentuhan harus mengubah layar di frame yang sama.
   Jaringan urusan belakangan. Ini yang bikin tombol "kerasa" atau tidak.
2. **Jumlah perjalanan** — satu aksi cukup satu permintaan. Kalau balasannya
   sudah berisi data yang dibutuhkan, jangan minta lagi.
3. **Kerja server** — koneksi dan kueri per permintaan. 3 ms tidak terasa, tapi
   N+1 membuatnya naik linear terhadap jumlah peserta.
4. **Berat halaman** — CSS/JS/gambar. Ini biaya buka pertama, bukan biaya
   ketukan.

## Angka terukur (sebelum -> sesudah)

| Jalur | Sebelum | Sesudah |
|---|---|---|
| `POST /selections` (pilih item) | 3,3 ms, 10 koneksi, 25 kueri | 1 koneksi nama, sisa sama |
| `GET /bill` | 7 koneksi, 19 kueri, ~7–10 ms | **4 koneksi, 13 kueri, ~7 ms** |
| Daftar bill 71 baris | 142 koneksi, 639 kueri, 75 ms | 3 koneksi, 11 kueri, 8 ms |
| Filter bulan, 3.000 bill | `SCAN` 1,76 ms | `SEARCH ... USING INDEX` 0,03 ms |
| Ketuk item | centang muncul setelah POST + `GET /bill` (+daftar +rekap) | centang **< 100 ms**, 0 permintaan tambahan |
| Aksi di layar bill | 3 permintaan (bill + daftar + rekap) | 1 (bill), daftar ditandai basi |

## Per layar

### Beranda
- **Buka bill** — sudah: `prefetchQuery` mulai saat jari menyentuh baris
  (`onPointerEnter`/`onPointerDown`), jadi perjalanan terjadi sebelum halaman
  dibuka.
- **Terima/tolak undangan** — menunggu server, lalu menyegarkan undangan,
  daftar, dan rekap. Satu perjalanan; tombolnya kecil dan jarang dipakai, jadi
  tidak dioptimistiskan (risiko salah taut lebih buruk daripada 200 ms).
- **Saring per bulan / cari / muat lagi** — lokal atau query cache. Saat pindah
  bulan, daftar lama sempat kosong lalu terisi.

### Buat bill
- **Ambil foto, buang foto, jadikan utama, tempel** — lokal sepenuhnya, tidak
  menyentuh server. Sudah instan.
- **Baca pakai AI** — satu-satunya aksi yang memang menunggu jaringan panjang
  (model vision). Itu batasnya, bukan bug.
- **Tambah/buang item** — lokal.
- **Buat bill** — satu POST, lalu pindah ke layar bill. Layar tujuan masih
  mengambil `GET /bill` sendiri.

### Ubah bill
- **Simpan** — satu PUT lalu segarkan.
- **Hapus bill** — konfirmasi, lalu DELETE.
- **Tambah/buang item, pilih orang** — lokal.
- **Hapus bill dari daftar** — daftar ikut disegarkan (perlu, karena barisnya
  hilang dari daftar).

### Layar bill
- **Pilih item, tambah/kurangi porsi** — optimistis: state lokal dulu, balasan
  POST dipakai sebagai cache, kiriman beruntun digabung, gagal jaringan tidak
  me-rollback tapi dikirim ulang.
- **Tandai lunas, tutup bill, tandai dibayar, undang, buang peserta, keluar** —
  sekarang hanya menyegarkan bill yang sedang dibuka; daftar dan Rekap ditandai
  basi (`refetchType: 'none'`) dan segar saat layarnya dibuka.
- **Ikut bill** (tamu jadi peserta) — menunggu server karena identitas harus
  dibuat dulu; tidak aman ditebak di klien.
- **Bagikan link / hapus foto** — satu permintaan.

### Rekap
- **Tandai lunas dari Rekap** — satu POST + segarkan rekap. Daftar dan bill
  tidak ikut disegarkan lagi.
- **Salin pengingat, buka bagian belum jelas** — lokal.

### Pengaturan
- **Simpan nama, rekening, alias, auto-terima, hapus perangkat** — satu
  permintaan per aksi; tidak ada yang beruntun, jadi tidak dioptimistiskan.

### Lintas layar (design system)
- **Getar** dipindah ke komponen `Button` dan `ActionRow`: satu perilaku untuk
  semua tombol di semua layar, bukan tempelan per layar. Tombol `quiet` (tautan
  berteks) sengaja diam.
- **Keadaan tekan** (`:active`) sudah ada di design system untuk tombol, baris,
  dan tombol ikon.

## Sisa yang belum dikerjakan (urut dampak)

1. **155 dari 425 kelas CSS tidak dipakai (~90 KB, ~30%).** Berat buka pertama.
   Perlu verifikasi visual karena ada kelas yang dibentuk dinamis
   (`ds-amount--${tone}`).
2. **Layar bill setelah "Buat bill"**: `POST /api/bills` bisa mengembalikan
   payload bill seperti `POST /selections`, jadi layar tujuan tidak perlu
   `GET /bill` lagi.
3. **Filter bulan di Beranda**: `placeholderData` menahan daftar bulan
   sebelumnya saat pindah bulan, jadi tidak ada kedipan kosong.
4. **Gambar**: `scan.webp` 384 px dan `home-empty.webp` masih bisa turun;
   `scan.webp` belum dipakai dalam ukuran penuh di layar terkecil.
5. **Peta identitas per permintaan** bisa di-cache pendek (misal 5 detik di
   proses) kalau suatu saat peserta bill jadi puluhan.
