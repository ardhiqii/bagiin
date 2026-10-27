# Bagiin Design System — arah v0.3 (hybrid, berlapis)

**Keputusan pemilik produk:** struktur/layout konsep **Seimbang**, palet konsep **Saldo**. Dokumen ini adalah acuan visual dan interaksi untuk migrasi React + TypeScript + shadcn/ui. Alur bisnis tetap mengikuti [PRODUCT.md](PRODUCT.md). Komponen hidup dan seluruh state-nya ada di [Design Lab](prototype/README.md) melalui `?view=system`.

Istilah "hybrid" di sini berarti satu hal yang spesifik: **urutan informasi dan bentuk layar dari Seimbang, warna dari Saldo.** Bukan gabungan dua konsep, dan bukan varian Saldo utuh — pada Saldo, angka kewajiban menjadi pintu masuk utama; di sini item tetap menjadi isi utama dan angka mengikuti konteksnya.

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
- **Radius:** 10 px kontrol kecil, 14 px input, 20 px kartu dan kelompok baris, 28 px sheet/hero, dan pil penuh (`999px`) hanya untuk tombol, badge, dan chip. Hindari dua radius berbeda pada elemen yang sederajat.
- **Target sentuh:** minimal 44×44 px untuk aksi utama, navigasi, ikon interaktif, dan kontrol jumlah; **baris aksi di dalam sheet minimal 56 px** (`--ds-touch-row`). Seluruh baris item dapat diketuk; penanda centang hanya indikator.
- **Zona jempol:** aksi yang sering dipakai tinggal di sepertiga bawah layar. Menu tidak disembunyikan di pojok kanan atas — di ponsel itu zona paling sulit dijangkau satu tangan. Pola baku: toolbar di bawah (ikon sekunder + satu aksi utama), sheet muncul dari bawah.

## Lapisan, bukan garis

Kedalaman di Bagiin dibangun dari lapisan, mengikuti cara Apple HIG memisahkan *content layer* dari *functional layer* (materials: Liquid Glass untuk kontrol dan navigasi yang melayang, material standar untuk isi). Tiga aturan turunannya:

1. **Lapisan konten tidak punya garis keliling.** Kartu, panel, dan daftar memakai permukaan putih di atas latar fog dengan satu bayangan dua tingkat (`--ds-shadow-content`). Tidak ada `border: 1px` pada kartu atau baris.
2. **Pemisah hanya hairline di dalam kelompok.** Daftar item adalah satu permukaan dengan garis rambut `rgba(20,47,58,.09)` yang menjorok dari teks, bukan tumpukan kotak berbingkai. Elemen terpilih ditandai isian mint, bukan garis tepi.
3. **Lapisan fungsi boleh melayang, tapi tidak boleh transparan di atas teks.** Navigasi bawah dan bar aksi memakai permukaan tembus pandang dengan blur (`--ds-glass`, `--ds-blur`); **sheet selalu solid** (`--ds-bg`). Alasannya bukan selera: `backdrop-filter` tidak selalu ada (headless, GPU mati, browser lama), dan di sana teks halaman tembus ke dalam sheet sehingga terbaca sebagai teks yang tertimpa. Blur hanya pemanis scrim, tidak pernah menjadi penopang kontras.

Turunan lain: tombol berbentuk pil dengan tinggi minimal 50 px untuk aksi utama, tekanan (`:active`) memakai penskalaan kecil, dan cincin fokus 3 px selalu terlihat. Bayangan tidak dipakai sebagai dekorasi.

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

## Toolbar aksi dan daftar aksi

Dua komponen ini menggantikan kebiasaan lama "tempel beberapa pill di bawah". Keduanya sudah ada di `ds/primitives.tsx` dan `design-system.css`.

**Toolbar bawah (`.bill-action-bar`).** Satu baris 48 px di zona jempol:

- Ikon sekunder 48×48 (`--ds-radius-md`, latar `rgba(20,47,58,.06)`, ikon navy). Ikon **netral**, bukan mint: dua tombol mint di samping pill hijau membuat mata membaca tiga ajakan sekaligus.
- Satu aksi utama mengisi sisa lebar, tinggi 48 px, label memuat nominal (`Tandai lunas · Rp23.000`).
- Kalau tidak ada aksi pribadi, sisi kanan diisi **keterangan keadaan** (`Semua lunas`, `Ada sisa yang belum diambil`), bukan dibiarkan kosong dan bukan diisi tombol normatif.

**Daftar aksi (`ActionGroup` + `ActionRow`).** Isi sheet, satu grup = satu permukaan putih ber-radius 20 dengan hairline di dalam:

- Baris tinggi minimal 56 px, grid `22px | 1fr | auto`, ikon Phosphor 20 px di kiri supaya mata bisa memindai tanpa membaca.
- Label 15/700; catatan pendukung 12/400 di bawah label, satu baris dengan ellipsis.
- Label grup 11/800 uppercase, `letter-spacing .09em`, warna `--ds-muted-soft`.
- Aksi merusak (`Keluar dari bill ini`) di grup terpisah paling bawah dengan warna `--ds-danger`.
- Larangan: jangan menumpuk tombol pill penuh di dalam sheet. Sembilan pill mint bertumpuk (kasus nyata sebelum revisi ini) boros tinggi, tidak punya hierarki, dan tidak bisa dipindai.

## Logo provider pembayaran

Nama brand di database adalah teks bebas, jadi logo diselesaikan lewat `providerKey()` di `lib/providers.ts` (normalisasi huruf kecil tanpa tanda baca + alias, mis. `bankbca`/`bankcentralasia` → `bca`). Brand yang belum punya logo memakai ikon dompet netral, bukan inisial berwarna.

**Satu kotak untuk semua logo: 72 × 24 px, rata kiri.** Yang disesuaikan hanya tinggi gambar per brand (`h` di manifest), bukan kotaknya:

- Wordmark lebar (ShopeePay 5,2:1) dipatok lebih tinggi (13,5 px) supaya bobotnya seimbang dengan wordmark padat (BCA 3,2:1, 15,5 px).
- Lambang persegi (LinkAja 1:1) dipatok 22 px.
- Larangan: menyerahkan ukuran ke rasio mentah. Dengan begitu logo 5:1 akan tampak jauh lebih kecil daripada 1:1 di kotak yang sama.

**Sumber aset** (semua di `app/src/assets/providers/`, total ~57 KB):

- GoPay — media kit resmi `gopay.co.id/media-kit` (kit "New-Update-GoPay-Logo")
- ShopeePay — `shopeepay.co.id/logo/spp-logo.svg`
- Bank Jago — logo baru 11 Juni 2026 (peluncuran identitas visual "Say Yellow")
- BCA, Mandiri, OVO, LinkAja, DANA, SeaBank — artwork resmi via Wikimedia Commons

**Pipeline aset logo:** render SVG di Chromium (transparan) → keyout latar terang yang menyambung ke tepi (flood fill, toleransi 232) → trim → sisi terpanjang 200 px → WebP q92. Keyout wajib: dua aset resmi datang dengan latar terang opaque, dan tanpa keyout logo tampil sebagai kotak abu di kartu putih.

## Ukuran gambar di dalam kartu

Gambar ilustrasi **selalu mengikuti lebar kolom grid**, bukan atribut `width` di elemen `<img>`. Atribut itu hanya memberi ukuran intrinsik untuk mencegah layout shift.

- `.art-card` / `.art-head`: kolom 120 px, gambar `width:100%; height:auto; aspect-ratio:1; object-fit:contain`.
- Teks di kolom kedua wajib `minmax(0, 1fr)` supaya bisa menyusut dan tidak menabrak gambar.
- Kasus nyata yang pernah terjadi: `<img width={150}>` di dalam kartu berkolom 120 px membuat ilustrasi meluber 30 px dan menimpa judul kartu.

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

## Komponen dan state yang wajib ada

Setiap komponen di bawah harus punya seluruh state-nya sebelum React dianggap siap menggantikan vanilla. Yang berjalan ada di `?view=system`.

| Komponen | Padanan shadcn/ui | State/varian |
| --- | --- | --- |
| Button | Button | primary, secondary, quiet, danger, loading, disabled, block |
| StatusBadge | Badge | menunggu, final, sukses, butuh tindakan |
| Card / BalanceCard | Card | permukaan, mint, navy |
| ItemRow | Card + Checkbox | belum dipilih, dipilih, dibagi bersama, dengan diskon item |
| Field | Input + Label | default, fokus, error, nominal rupiah |
| Sheet | Drawer/Dialog | konfirmasi, rincian biaya, tujuan bayar |
| BottomNav | NavigationMenu | beranda, bill, buat, rekap |
| Alert | Alert | menunggu, final, sukses, butuh tindakan |
| EmptyState | custom | belum ada bill, belum ada utang |
| Avatar | Avatar | empat nada + placeholder "belum bergabung" |

Aturan yang mengikat semua komponen: target sentuh minimal 44×44 px, cincin fokus 3 px terlihat, radius hanya empat ukuran (8/12/16/24), dan bayangan hanya untuk lapisan yang menutup konten — kartu biasa memakai garis border.

## Implementasi token (react)

Skala di atas sudah jadi variabel CSS di `app/src/design-system.css`. Pakai
nama ini, jangan angka mentah:

| token | nilai | untuk |
|---|---|---|
| `--ds-space-1` | 4px | ikon kecil, chip |
| `--ds-space-2` | 8px | ikon ↔ teks, dua tombol berdampingan |
| `--ds-space-3` | 12px | padding kartu kecil, gap dalam grup |
| `--ds-space-4` | 16px | padding kartu normal |
| `--ds-space-5` | 20px | jarak antar blok halaman + gutter mobile |
| `--ds-space-6` | 24px | padding kartu besar, jarak setelah blok panjang |
| `--ds-space-8` | 32px | pemisah antar seksi besar |
| `--ds-gutter` | = `--ds-space-5` | gutter kiri-kanan |
| `--ds-touch` | 44px | target sentuh minimum |

Tiga hal yang pernah bikin layout rusak dan harus dijaga:

1. `.app-body > * { flex: 0 0 auto; }` — tanpa ini flexbox mengompres kartu yang
   isinya tinggi; kartu total pernah jatuh ke 40px dari 139px sehingga nominal
   hero terpotong dan tidak terlihat sama sekali.
2. `html, body, button, input, select, textarea` wajib memakai `--ds-font-body`.
   Elemen yang di-portal ke `<body>` (toast, sheet) tidak mewarisi font dari
   `.app-shell` dan jatuh ke Times New Roman.
3. `.app-bottom` memakai `--ds-gutter`; tanpa itu CTA menempel ke tepi layar
   sementara kartu di atasnya punya gutter.

Konvensi tambahan:

- Bar aksi bawah = satu CTA utama + tombol **Aksi lain** pembuka sheet. Aksi
  sekunder dan destruktif masuk sheet, tidak menumpuk di halaman.
- Sheet utilitas tanpa ilustrasi. Ilustrasi hanya untuk sheet bercerita (undang
  teman, ganti pembayar, atur bagian). Piring-garpu-pisau di sheet "Aksi lain"
  salah arti: aset itu untuk konsep *item*, bukan *aksi*.
- Thumbnail struk 84×112, diketuk membuka viewer penuh dengan penanda "n dari m".

## Aturan kerja: design system dulu, komponen setelahnya

Setiap perubahan UI lewat urutan ini, bukan sebaliknya:

1. **Cari komponen yang sudah ada.** Kalau sebuah pola muncul dua kali (`Group`, `ActionRow`, `BalanceCard`, `EmptyState`, `Button`), pakai komponennya, jangan salin CSS-nya.
2. **Kalau belum ada, tambahkan ke design system lebih dulu** — token kalau perlu angka baru, komponen di `ds/primitives.tsx` + kelas di `design-system.css` — baru dipakai di layar.
3. **Kalau menemukan flaw, perbaiki di design system**, bukan di satu layar. Contoh: gambar meluber karena kolom grid, bukan karena satu kartu — perbaikannya di `.art-card img`, bukan tambal per halaman.
4. **Hapus CSS mati** setelah komponen lama diganti (`.seg`, `.recap-month`, `.ds-empty-soft`, `.bill-more` sudah dihapus dengan cara ini).
5. **Ukur, jangan kira-kira.** Perubahan layout diverifikasi dengan rect nyata (lebar/tinggi/posisi elemen vs bar dan rail), bukan hanya screenshot yang dilihat sekilas.

## Empat larangan mahal

Bukan preferensi visual. Ini empat hal yang kalau dilanggar membuat orang mentransfer nominal salah atau tidak bisa memakai aplikasi.

1. **Status tidak boleh hanya warna.** Selalu ikon + teks + latar. Sekitar 8% pria kesulitan membedakan hijau–merah.
2. **Uang tidak boleh dihitung di klien.** Klien merender payload server apa adanya. Ini bug termahal Bagiin: tamu disuruh transfer nominal yang salah karena klien punya mesin hitung kedua.
3. **Nominal wajib tabular numbers.** Angka yang bergeser lebar saat nilainya berubah membuat orang salah baca.
4. **Target sentuh minimal 44 px.** Dipakai satu tangan sambil makan; meleset tap di layar bill berarti salah tagihan.

## Ilustrasi dan aset

Ilustrasi dibuat dengan model gambar (Codex `image_gen`), bukan stok. Prompt-nya mengunci: kanvas persegi 1024, ukuran tampil akhir (mis. 240 px), enam warna hex yang sama dengan token, "flat vector, hard edges, no outlines, no gradients, no shadows, no texture, no 3D", larangan teks/logo/orang, dan komposisi (subjek 55–62% tinggi frame).

Setelah keluar dari generator, tiap aset melewati dua langkah di repo:

1. **Background datar dijadikan transparan** (`keyout.py`, toleransi ≤ 10 per kanal) supaya ilustrasi duduk langsung di kartu tanpa kotak putih.
2. **Kuantisasi palet** (`quantize(colors=48)`) sehingga 1024 px turun ke ~8 KB PNG pada 512 px.

Aturan pakai: ilustrasi hanya untuk empty state dan layar pembuka; tidak untuk menghias data. Ukuran tampil empty state 216 px, sampul editor 68 px. Jangan memakai ilustrasi sebagai pengganti teks status.

## Pemetaan ke shadcn/ui

`prototype/src/design-system.css` adalah sumber token visual prototype. Variabel `--background`, `--foreground`, `--card`, `--primary`, `--secondary`, `--muted`, `--border`, `--input`, `--ring`, `--destructive`, dan `--radius` sudah dipetakan sebagai titik awal theme shadcn/ui. Saat migrasi produksi, pindahkan token ini ke theme aplikasi; jangan membuat warna hex baru di komponen. Komponen shadcn/ui yang paling relevan: Button, Card, Badge, Input, Dialog/Drawer, Tabs, dan NavigationMenu. Struktur dan copy tetap mengikuti aturan Bagiin di atas, bukan default library.

## Status pekerjaan

Design Lab v0.3 (`?view=system`) memakai bahasa berlapis di atas: kartu tanpa garis, daftar sebagai satu permukaan ber-hairline, navigasi dan aksi melayang dengan blur, tombol pil, serta ilustrasi empty-state SVG yang digambar tangan (bukan aset hasil generator) agar skalanya tajam dan paletnya terkunci.

Halaman ini memuat delapan bagian: fondasi warna + token status, tipografi dan angka, ruang/radius/elevasi, komponen lengkap dengan state-nya, tata bahasa tiga status, komposisi halaman bill, empat larangan mahal, serta inventaris komponen + pemetaan token ke shadcn/ui. Semua contoh interaktif.

Prototype utama (`?v=seimbang`) memakai palet ini pada beranda, bill, rekap, editor, kontrol varian, dan navigasi. Varian Saldo/Teman/Struk tetap menjadi pembanding visual.

Iterasi berikutnya tetap **merancang ulang halaman bill**. Dua keputusan yang masih terbuka: kontrol "siapa ikut makan" (sheet per item dengan tombol "Tambah yang ikut makan" versus kontrol jumlah pemakan), dan cara menampilkan unit barang pada satu baris struk.
