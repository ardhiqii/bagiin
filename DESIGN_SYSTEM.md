# Bagiin Design System — arah v0.1

**Keputusan pemilik produk:** struktur/layout konsep **Seimbang**, palet konsep **Saldo**. Dokumen ini adalah acuan visual dan interaksi untuk migrasi React + TypeScript + shadcn/ui. Alur bisnis tetap mengikuti [PRODUCT.md](PRODUCT.md). Lihat komponen hidup di [Design Lab](prototype/README.md) melalui `?view=system`.

## Karakter dan hierarki

Bagiin perlu terasa tenang dan cepat dibaca saat orang sedang membagi makanan atau mengecek utang. Angka utama, asal angka, dan langkah berikutnya harus ditemukan dalam urutan itu. Bentuk layar mengikuti Seimbang: ringkasan di atas, daftar bill/item sebagai konten utama, satu aksi utama dekat konteksnya, lalu navigasi tetap di bawah. Warna mengikuti Saldo: **navy** untuk informasi utama, **teal** untuk tindakan dan pilihan, latar **fog**, permukaan putih.

Warna tidak boleh menjadi satu-satunya penanda status. Teks seperti “Sementara”, “Pembagian lengkap”, dan “Kurang bayar Rp5.000” wajib tetap muncul.

## Token warna

| Token CSS | Nilai | Peran |
| --- | --- | --- |
| `--ds-navy` | `#142F3A` | Teks utama, kartu utang, area kepala bill |
| `--ds-navy-deep` | `#102731` | Kontras/overlay |
| `--ds-teal` | `#087665` | Tombol utama, item terpilih, tautan aksi, fokus |
| `--ds-teal-hover` | `#065E52` | Hover/pressed |
| `--ds-bg` | `#F5F8F8` | Latar layar |
| `--ds-surface` | `#FFFFFF` | Kartu, bottom sheet, navigasi |
| `--ds-mint` | `#E2F5EF` | Tombol sekunder dan sorotan yang tidak mendesak |
| `--ds-muted` | `#536D78` | Teks pendukung |
| `--ds-border` | `#DCE7E7` | Pemisah dan garis input |

Token status, khusus makna bisnis:

| Makna | Teks/ikon | Latar | Dipakai untuk |
| --- | --- | --- | --- |
| Menunggu / sementara | `#8A590F` | `#FFF1D8` | Orang/bagian belum memilih, nominal dapat berubah |
| Informasi final | `#356B8C` | `#E7F1F7` | Pembagian lengkap, angka sudah final |
| Sukses | `#167354` | `#E5F4EB` | Pembayaran ditandai lunas atau bill selesai |
| Butuh tindakan | `#B0443D` | `#FDEBE9` | Kurang bayar, selisih perlu ditangani, kesalahan |

Semua pasangan teks/latar status di atas memiliki rasio kontras minimal 4,5:1. Teal dengan teks putih sekitar 5,54:1, navy dengan putih sekitar 14,02:1. Jangan memakai teal pucat untuk teks kecil di permukaan putih.

## Tipografi, ruang, dan bentuk

- **Judul:** Manrope, tebal 700/800. Layar 24–28 px; angka hero 32 px; bagian 18–20 px.
- **Isi:** DM Sans. Teks utama 14–16 px; teks pendukung 12–14 px; label kecil minimal 12 px bila mengandung informasi penting.
- **Nominal:** `font-variant-numeric: tabular-nums`. Gunakan pemisah ribuan Indonesia, `Rp62.120`; jangan singkat menjadi `62k` untuk tagihan yang perlu dibayar.
- **Skala jarak:** kelipatan 4 px: 4, 8, 12, 16, 20, 24, 32. Jarak sisi layar mobile 20 px.
- **Radius:** 8 px untuk kontrol kecil, 12 px untuk tombol/input/item, 16 px untuk kartu, 24 px untuk sheet/hero. Hindari radius berbeda tanpa alasan komponen.
- **Bayangan:** tipis hanya bila menunjukkan lapisan seperti sheet atau navigasi. Kartu biasa memakai garis `--ds-border`.
- **Target sentuh:** minimal 44×44 px untuk aksi utama, navigasi, ikon interaktif, dan kontrol jumlah. Seluruh baris item dapat diketuk; kotak centang hanya penanda.

## Komponen dasar

| Komponen | Struktur | Aturan |
| --- | --- | --- |
| Tombol utama | Teal penuh, teks putih, tinggi ≥44 px | Satu aksi utama per area. Label menyebut hasil: “Selesai pilih”, “Tandai lunas”. |
| Tombol sekunder | Mint dengan teks teal | Untuk aksi pendamping seperti “Bagikan” atau “Lihat rincian”. |
| Tombol teks | Teks teal, tanpa latar | Hanya untuk tindakan ringan seperti “Edit pilihan”; jangan menjadi satu-satunya jalan menyelesaikan tugas. |
| Kartu saldo | Navy, angka putih besar, teks penjelas | Beranda dan rekap memakai gaya yang sama untuk kewajiban utama. |
| Kartu item | Putih, border, nama kiri, nominal kanan, rincian di bawah | Seluruh baris bisa dipilih; selected memakai border/centang teal. Item bersama menampilkan jumlah pemakan dan bagian menunggu. |
| Status | Ikon + teks + latar semantik | Status pembagian, pembayaran, dan bill tampil terpisah. Jangan membuat badge “Selesai” ambigu. |
| Input | Putih, border, label terlihat, tinggi ≥44 px | Nominal memakai keyboard angka di mobile. Pesan salah menjelaskan cara membetulkan. |
| Bottom sheet | Permukaan putih, judul, alasan, angka/tindakan, tombol tutup | Untuk konfirmasi, tujuan bayar, dan pengaturan item yang kontekstual. Sheet bisa scroll pada HP pendek. |
| Navigasi bawah | Beranda, Bill, Buat, Rekap | Selalu punya area sendiri di luar konten scroll. Ikon dan label aktif teal. Aksi di akhir konten tidak boleh tertutup. |

## Bahasa status yang wajib konsisten

Tiga dimensi berikut **tidak digabung menjadi satu status**:

1. **Pembagian:** `Menunggu pilihan` → `Sementara` bila angka masih berubah → `Pembagian lengkap`. Label sementara menyebut siapa atau bagian mana yang menunggu.
2. **Pembayaran peserta:** `Belum bayar` → `Lunas`. Setelah nominal berubah: `Kurang bayar Rp X` atau `Lunas · kelebihan Rp X`; tampilkan nominal yang pernah ditandai dibayar.
3. **Bill:** `Berjalan` → `Selesai otomatis` bila syarat bisnis terpenuhi. Tindakan manual pembayar diberi label `Diselesaikan oleh pembayar`, dengan riwayat dan jalan membatalkan.

Untuk rekap, angka utama adalah **sisa** utang dan uang masuk. Pecah `Sudah pasti` dan `Perkiraan tambahan`; setiap rincian per orang bisa dibuka sampai bill sumber. Jangan memakai satu warna untuk menggantikan penjelasan bahwa nominal masih sementara. Bayar di Bagiin berarti mencatat status, bukan transfer uang.

## Pola layar mobile

- **Beranda:** ringkasan sisa utang dan uang masuk, bill aktif, aksi buat bill. Angka penting berada di bagian atas tanpa menutup daftar bill.
- **Bill:** header berisi merchant, total struk, orang yang terlibat; daftar item menjadi fokus utama. Status pembagian, rincian biaya, dan aksi pembayaran mengikuti konteks. Struktur rinci bill **belum final** dan akan dirancang setelah audit seluruh kasus item bersama, unit, assignment, peserta menunggu, dan revisi setelah bayar.
- **Buat bill:** OCR dan manual masuk ke editor yang sama. Jangan menanyakan orang dan mode pembagian sebelum bill dibuat.
- **Rekap:** total terutang dan akan diterima, dipisah final/sementara, lalu daftar per orang yang menunjukkan bill sumber.
- **Scroll:** isi layar bergerak sendiri; navigasi bawah tetap terlihat. Tombol akhir bill/editor harus bisa digulir sampai seluruhnya terlihat di atas navigasi pada tinggi layar 568 px.

## Pemetaan ke shadcn/ui

`prototype/src/design-system.css` adalah sumber token visual prototype. Variabel `--background`, `--foreground`, `--card`, `--primary`, `--secondary`, `--muted`, `--border`, `--input`, `--ring`, `--destructive`, dan `--radius` sudah dipetakan sebagai titik awal theme shadcn/ui. Saat migrasi produksi, pindahkan token ini ke theme aplikasi; jangan membuat warna hex baru di komponen. Komponen shadcn/ui yang paling relevan: Button, Card, Badge, Input, Dialog/Drawer, Tabs, dan NavigationMenu. Struktur dan copy tetap mengikuti aturan Bagiin di atas, bukan default library.

## Status pekerjaan

Prototype utama (`?v=seimbang`) sudah memakai palet ini pada beranda, bill, rekap, editor, kontrol varian, dan navigasi. Halaman `?view=system` menunjukkan token dan contoh komponen hidup. Varian Saldo/Teman/Struk tetap menjadi pembanding visual. Iterasi berikutnya adalah **merancang ulang halaman bill**, terutama kasus yang belum terwakili jelas di prototype; dokumen ini menetapkan bahasa visualnya dulu.
