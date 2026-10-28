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

## Skala tipe dan jarak

Sampai 2026-10-27 ada **27 ukuran font** dan **7 ketebalan** tersebar di `app.css`, `design-system.css`, dan 33 angka `fontSize` di dalam TSX (9 / 9,5 / 10 / 10,5 / 11 / 11,5 / 12 / 12,5 / 13 / 13,5 / 14 / 14,5 / 15 …). Itu bukan keputusan desain, itu hasil tiap layar menambal sendiri-sendiri. Sekarang satu tangga, dipakai lewat token.

### Ukuran

| Token | px | Peran |
| --- | --- | --- |
| `--ds-text-2xs` | 10 | eyebrow & group label (kapital, berjarak) |
| `--ds-text-xs` | 11 | meta satu baris yang tidak dibaca berurutan |
| `--ds-text-sm` | 12 | label field, badge, hint, judul bagian |
| `--ds-text-md` | 13 | teks sekunder padat, isi notice/alert |
| `--ds-text-base` | 15 | paragraf & isi kontrol |
| `--ds-text-input` | 16 | **semua input** |
| `--ds-text-lg` | 17 | judul baris / judul kartu |
| `--ds-text-xl` | 20 | judul layar |
| `--ds-text-2xl` | 24 | judul besar |
| `--ds-text-3xl` | 30 | angka total di kartu |
| `--ds-text-4xl` | 34 | angka hero |

Angka-angka itu bukan selera. Teks paragraf di HP praktis tidak di bawah 14 px (Material 3 menaruh body-large di 16 sp, iOS body di 17 pt, panduan Material untuk Android: paragraf 14 sp, judul baris 16 sp, tombol 14 sp medium). Karena itu 10-11 px hanya dipakai untuk huruf kapital berjarak atau meta satu baris — bukan untuk kalimat.

**Input selalu 16 px.** Di bawah 16 px, iOS Safari memperbesar halaman sendiri saat input difokus dan tidak mengembalikannya. Ini bukan soal estetika, ini bug yang kelihatan seperti aplikasi rusak.

### Ketebalan: tiga, bukan tujuh

| Token | Nilai | Peran |
| --- | --- | --- |
| `--ds-weight-regular` | 400 | isi |
| `--ds-weight-medium` | 600 | penekanan di dalam baris (nama item, label aktif) |
| `--ds-weight-strong` | 800 | judul, angka, judul bagian |

500 / 650 / 700 yang dulu dipakai bergantian untuk hal yang sama sudah dilebur. Lebih dari tiga ketebalan di satu layar membuat hierarki jadi soal selera, bukan soal struktur.

### Line-height proporsional, bukan 1.5 untuk semua

`--ds-leading-tight: 1.15` (angka & judul besar) · `--ds-leading-snug: 1.3` (judul baris, meta) · `--ds-leading-normal: 1.5` (paragraf). Teks besar tidak butuh 1.5 — jarak yang sama justru membuat judul terlihat renggang; teks kecil butuh lebih dari 1.2 supaya mata gampang menemukan baris berikutnya.

### Judul bagian

Satu kelas, `ds-section-title`: 12 px, strong, kapital, berjarak `.06em`, warna muted. Dulu tiap layar menulis `<strong style={{ fontSize: 14, fontWeight: 800 }}>` sendiri. Di daftar, yang harus menang adalah nama item dan angkanya — judul bagian yang ikut tebal-terang membuat tiga hal berebut perhatian di satu baris.

### Jarak: grid 2 px

Kelipatan 4 saja tidak cukup: 5/6/7 px tetap muncul sebagai angka liar, dan itu memang terjadi (gap 2/3/4/5/6/7/8/9/10/11/12/13/14/16/22/32 tersebar). Token sekarang mengikuti grid 2 px (seperti Carbon): `2 · 4 · 6 · 8 · 12 · 16 · 20 · 24 · 32`. Angka 5 → 6, 7 → 8, 9 → 8, 10 → 12, 11 → 12, 13 → 12, 14 → 16.

**Larangan: menulis px langsung** untuk `font-size`, `font-weight`, `gap`, `row-gap`, `column-gap` di CSS maupun `fontSize`/`fontWeight` di TSX. Semua lewat token.

### Notice: aksi di bawah, bukan di kanan

Anatomi: rel ikon **15 px** + kolom teks, jarak 8 px. Kalau ada aksi lanjutan, ia jadi baris kedua **di dalam kolom teks** dan memakai rel ikon yang sama supaya ikonnya segaris dengan ikon di atasnya.

Versi tiga kolom (ikon | teks | aksi) sudah dicoba dan salah: di layar 390 px teksnya tinggal ~180 px, jadi kalimat 40 karakter pecah tiga baris sementara tombolnya menggantung di tengah. Teks dan aksinya terlihat tidak satu paket. Kolom ikon juga harus **dipatok 15 px**, bukan `auto` — lebar tinta tiap ikon Phosphor beda-beda, dan dengan `auto` teks paragraf dan teks aksi mulai di titik yang berbeda.

`text-wrap: pretty` dipakai untuk paragraf, `small`, dan notice: kalimat pendek di layar sempit gampang berakhir dengan satu kata menggantung di baris terakhir.

## Sesi: empat keadaan, satu sumber

Status sesi hidup di `lib/session.ts` (`checking` · `authed` · `anonymous` · `expired`) dan divalidasi ke server lewat `GET /api/identities/{id}/me` sebelum layar mana pun dirender. "Ada id di localStorage" **bukan** bukti login: id bisa berasal dari database lama yang sudah tidak ada.

Aturan yang mengikat:

- **Layar yang butuh identitas wajib dibungkus `RequireIdentity`**, dan `children`-nya berupa **fungsi**, bukan elemen. `<Recap identityId={me!.id} />` dievaluasi lebih dulu, jadi null.id meledak tepat di layar yang seharusnya tidak pernah dirender.
- **Layar bill tidak dijaga.** Link bill harus bisa dibuka orang yang belum punya identitas; mereka memakai tombol "Ikut bill ini".
- **Error sesi diputus di satu tempat** (`api.ts` → `isSessionError`): 404 `Identitas tidak ditemukan`, 403 `Sesi tidak valid`, 403 `Identitas tidak cocok`. 403 lain (`Hanya owner bill`, `Bill sudah ditutup`) adalah soal izin, **bukan** sesi — memutus sesi karena itu akan mengeluarkan orang dari akunnya hanya karena dia menekan tombol yang bukan haknya.
- **Jaringan bermasalah tidak mengeluarkan orang dari akunnya.** Hanya jawaban server yang tegas soal identitas yang boleh memutus sesi.
- **Setelah daftar/masuk, kembalikan ke halaman yang tadi dituju** (`bagiin_after_login` di sessionStorage), bukan selalu ke beranda.
- **Keluar dari akun** harus memindahkan status sesi ke `anonymous`, bukan cuma menghapus localStorage — kalau tidak, layar yang sedang terbuka tetap menampilkan data orang sebelumnya sampai reload.

### Notice, bukan Alert, untuk konteks di dalam alur

`Alert` menjawab "ada yang gagal" dan tampil selebar kartu. `Notice` menjawab "perlu kamu tahu sebelum lanjut": ikon 15 px sebaris teks, satu-dua baris, boleh punya satu aksi teks di kanan. Alert selebar kartu di tengah layar pendaftaran menenggelamkan tugas utamanya (judul "Isi nama lagi" kalah oleh kotak kuning besar).

| Keadaan | Komponen | Nada |
| --- | --- | --- |
| Sesi lama berakhir di layar pendaftaran | `Notice` + aksi "Masuk pakai kode" | pending |
| Gagal memuat data di layar penuh | `Alert` | danger |
| Bill tidak bisa dibuka karena sesi basi | `Alert` + tombol "Isi nama lagi" | pending |
| Bill tidak bisa dibuka karena sebab lain | `Alert` | danger |

### Fokus keyboard

Selama ini tidak ada aturan fokus sama sekali, jadi field yang otomatis difokus menggambar outline hitam 2 px bawaan browser — terbaca seperti keadaan error. Sekarang: `:focus-visible` memakai cincin teal 2 px untuk semua kontrol, dan field memakai `box-shadow` teal lembut + latar putih saat fokus.

## Logo provider pembayaran

Katalog berisi **47 brand**: bank besar (BCA, Mandiri, BNI, BRI, BTN, CIMB Niaga, Permata, Danamon, Panin, OCBC, Maybank, Mega, BSI, Muamalat, BJB, DKI, Jateng, Jatim, Sinarmas, BTPN, KB Bukopin, QNB, Maybank, Maspion, Mayapada, Victoria, Amar, Aladin), bank digital (Jago, SeaBank, Neo Commerce, Raya, Allo, Saqu, Superbank, blu, Jenius, TMRW), dan dompet/uang elektronik (GoPay, OVO, DANA, ShopeePay, LinkAja, Grab, QRIS, Flazz, e-Money Mandiri).

Nama brand di database tetap **teks bebas**. `providerKey()` di `lib/providers.ts` menormalkan ("Bank BCA", "bca mobile", "BCA" → `bca`) dan mengenali produk sebagai bank induknya: `brizzi`→BRI, `tapcash`→BNI, `isaku`/`sakuku`→BCA, `bsb`→BSI, `flazz`→BCA. Brand yang tidak dikenal memakai ikon dompet netral, bukan inisial berwarna.

### Ukuran: satu kotak, tinggi dihitung

Semua logo menempati kotak **72 × 24 px, rata kiri**. Tinggi gambar di dalamnya **tidak didata per brand**, tapi dihitung dari rasio aslinya lewat `opticalHeight(ar)`:

| Rasio asli | Tinggi tampil | Contoh |
| --- | --- | --- |
| < 1,6 (lambang) | 22 px | TMRW, LinkAja, CIMB, Panin, BRI |
| 1,6–2,6 | 16 px | BTPN, Mega, blu, Amar |
| 2,6–3,6 | 15 px | BCA, Mandiri, Danamon, SeaBank |
| 3,6–4,8 | 13,5 px | BNI, Permata, GoPay, Nobu |
| ≥ 4,8 | 12,5 px | DKI, Superbank |

Lebar tetap dibatasi 72 px, jadi logo yang sangat lebar otomatis mengecil tingginya. Larangan: memakai tinggi yang sama untuk semua rasio — logo 12:1 akan jadi garis tipis sementara 1:1 terlihat raksasa.

### Lockup sangat lebar dipotong ke lambangnya

Rasio ≥ 6 berarti lockup "lambang + nama panjang" (BRI 12,9; Panin 8,0; KB Bukopin 6,8; Mayapada 10,1; Maspion 9,1; Superbank 6,3; CIMB 6,5). Pada 72 px lebar, wordmark seperti itu hanya setinggi ±6 px dan tidak terbaca. Untuk aset ini, **simpan hanya lambangnya**: potong pada celah kosong pertama setelah tinta pembuka (deteksi kolom tanpa tinta ≥ 10% tinggi gambar). Nama brand tetap ada sebagai teks di baris, jadi tidak ada informasi yang hilang.

### Sumber aset (semua resmi)

- **GoPay** — media kit `gopay.co.id/media-kit` (kit "New-Update-GoPay-Logo")
- **ShopeePay** — `shopeepay.co.id/logo/spp-logo.svg`
- **Bank Jago** — logo baru 11 Juni 2026
- **Dari situs resmi masing-masing** — CIMB Niaga, OCBC, Nobu, Victoria, Amar, Bank Raya, Bank Saqu, blu, Jenius, TMRW, Bank Jateng
- **Artwork resmi via Wikimedia Commons** — sisanya (BCA, Mandiri, BNI, BRI, BTN, Permata, Danamon, Panin, Mega, BSI, Muamalat, DKI, Jatim, Sinarmas, BTPN, Maspion, Mayapada, Allo, UOB, Maybank, KB Bukopin, QNB, Superbank, Aladin, Flazz, e-Money, QRIS, Grab, OVO, DANA, LinkAja)

DBS sengaja **tidak** dipakai: tidak ada aset resmi yang bersih, dan satu kandidat dari Commons ternyata logo "Daimler und Benz Stiftung". Lebih baik fallback dompet daripada logo yang salah.

### Pipeline aset

Render SVG di Chromium (latar transparan) → keyout latar terang yang menyambung ke tepi (flood fill, toleransi 232) → potong ke lambang bila rasio ≥ 6 → trim → sisi terpanjang 200 px → WebP q92. Total 47 logo ≈ **325 KB**.

Keyout wajib: beberapa aset resmi datang dengan latar terang opaque; tanpa keyout, logo tampil sebagai kotak abu di kartu putih. Putih di dalam logo (mis. tulisan "linkaja") tetap utuh karena flood fill hanya menyentuh area yang menyambung ke tepi.

### Menambah brand baru

1. Simpan aset ke `app/src/assets/providers/<key>.webp` (nama file = key).
2. Tambahkan baris di `CATALOG`-nya: key, label, dan alias yang mungkin diketik.
3. Isi `AR` dengan rasio asli aset setelah di-trim.
4. Tidak perlu menyentuh CSS atau layar mana pun — `import.meta.glob` menemukan asetnya otomatis.

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

## Arah uang: label dulu, tanda kedua, warna ketiga

Satu angka uang di layar ini selalu menjawab satu hal, dan arahnya harus
terbaca tanpa menebak:

1. **Kalau ada label**, label yang menyebut arah: `Harus kamu bayar`,
   `Harus kamu terima`. Angkanya polos. `Harus kamu bayar −Rp22.000` terbaca
   seperti uang kembali, bukan tagihan.
2. **Kalau tidak ada label**, arah ditulis sebagai tanda: `−Rp23.000` untuk
   uang yang keluar dari kantong, `+Rp…` untuk uang yang masuk. Tanda tetap
   terbaca saat warnanya tidak — buta warna, layar kotor, mode gelap.
   Tanda **tidak** dipakai bersama kata kerja di baris yang sama: baris yang
   sudah menulis `Tinggal kamu bayar` lalu menulis `−Rp22.000` mengatakan hal
   yang sama dua kali, dan yang terbaca justru "saldo minus".
3. **Warna hanya menguatkan, tidak pernah jadi satu-satunya pembeda.**
   Merah = uang keluar. Hijau = uang masuk. Amber = angkanya belum pasti.
   Abu/netral = tidak ada yang perlu dikerjakan. Nol tidak diberi tanda dan
   tidak diteriakkan.

Merah hanya untuk satu arti itu. Kalau merah dipakai untuk hiasan atau untuk
"penting", artinya luntur dan orang berhenti membacanya.

### Dua angka: pasti dan kasar

Beranda memikul dua pertanyaan berbeda, jadi angkanya dua — dan **tidak pernah
dijumlahkan**:

- **Angka pasti** (`Harus kamu bayar` / `Harus kamu terima`) — dari bill yang
  pembagiannya sudah selesai. Ini yang boleh ditransfer sekarang.
- **Angka kasar** (`Perkiraan tambahan ± Rp…`) — dari bill yang pembagiannya
  belum selesai. Selalu berawalan `±`, warnanya lebih lembut, dan taruh di baris
  sendiri di dalam kartu, bukan di kartu kedua yang bersaing.

Menjumlahkan keduanya menghasilkan angka yang tidak pasti tapi terlihat pasti —
persis kesalahan yang membuat orang mentransfer nominal yang salah. Angka kasar
tetap berguna: dia memberi tahu besarannya kira-kira, tanpa berpura-pura final.

Catatan di bawah angka pasti menjawab **"angka ini angka apa"** — mis.
`Sudah dikurangi yang harus kamu terima` — bukan menambah hitungan baru.

## Satu layar, satu angka per konsep

Dulu beranda punya tiga penghitung untuk hal yang mirip: `2 belum lunas` di
kepala, `2 belum kamu selesaikan` di banner, `6 belum jelas` di kartu. Semuanya
benar, tidak ada yang bisa dipercaya.

Aturannya sekarang: **satu konsep, satu angka, satu tempat.** Angka "perlu
dikerjakan" hanya ada di satu blok, dan tiap bill masuk hitungan **tepat satu
kali** dengan urutan alasan yang tegas:

1. bagian saya belum memilih item → `Pilih N item lagi`
2. sudah memilih, bagian saya belum dibayar → `Tinggal kamu bayar`
3. saya pembayar dan masih ada sisa yang tidak diambil → `Pilih N item lagi`

Konsekuensinya: **jumlah rincian selalu sama dengan angka besarnya**. Kalau
rincian tidak bisa dijumlahkan menjadi angka utama, itu tanda konsepnya belum
jelas — bukan tanda butuh angka tambahan.

Hal yang bukan tugas saya (mis. peserta lain belum membayar, porsi yang akan
ditanggung pembayar) **tidak** diberi penanda aksi. Daftar yang semua barisnya
berteriak tidak lagi memberi tahu apa pun.

Penanda aksi memakai **kata kerja**, bukan kata sifat: `Tinggal kamu bayar`,
`Pilih 2 item lagi`. "Belum lunas" adalah keadaan; orang butuh perintah.

### Kepala layar tidak menghitung

Judul layar hanya menyebut siapa/apa (`Halo, Aufa`). Tidak ada jumlah bill,
tidak ada "belum lunas", tidak ada lencana angka. Penghitung di kepala berubah
sendiri setiap ada yang dibayar, dan angka yang berubah tanpa penjelasan membuat
orang menebak mana yang harus dipercaya.

Semua yang perlu dikerjakan tinggal di **satu blok** (kuning) berisi jumlah dan
rinciannya dalam kata kerja (`3 tinggal dipilih · 2 tinggal dibayar`). Blok itu
boleh diketuk untuk menyaring daftar ke bill tersebut, dan yang menandakan
tindakan itu adalah chip saringan yang ikut aktif — **bukan panah** yang
menjanjikan pindah layar.

## Nama adalah tampilan, bukan identitas

Di data, orang selalu dikenali dari `identity.id`. Di layar, yang dibaca orang
adalah nama — dan nama itu bisa sama persis untuk dua orang berbeda (di DB uji:
245 identity bernama "Aufa"). Karena itu setiap tempat yang meminta orang
memilih manusia harus memberi **pembeda**, bukan cuma nama:

1. **Nama pembeda milik penampil** (alias) — privat, satu arah. Tidak pernah
   dikirim ke orang yang diberi nama, dan tidak pernah dipakai di teks yang
   dikirim kepadanya.
2. **@username** kalau ada, atau **kode 4 huruf** turunan id (`#SW9C`).
3. **Konteks**: jumlah bill bareng + judul bill terakhir.

Aturannya satu: **kalau dua baris bisa membingungkan, itu kegagalan desain, bukan
kegagalan orang.** Daftar yang menampilkan dua "Amel" identik tanpa pembeda tidak
boleh dikirim ke layar.

Nama asli selalu ada di baris kedua saat alias dipakai — orang berhak memastikan
dirinya tidak menamai orang yang salah.

## Sakelar tiga cara masuk, bukan tiga halaman

Layar masuk memakai **segmented control dua tab** (Kode / Akun) plus **satu
tombol Google** di bawah pemisah "atau". Alasan Google tidak jadi tab: tab
berarti "ada formulir di dalamnya", sedangkan Google adalah satu tombol yang
membuka milik Google sendiri. Menaruhnya sebagai tab membuat orang mencari
kolom isian yang tidak ada.

Ukuran: tiap tab ≥ 44 px, lebar sama; tombol utama selebar kartu; jalur tamu
("Ikut bill tanpa akun") berupa tombol sekunder — bukan tautan kecil, karena itu
jalan yang setara, bukan catatan kaki.

## Baris yang bisa diketuk

Baris pengaturan dan kontak memakai pola **kartu + baris + chevron** dengan
seluruh baris sebagai target sentuh (≥ 56 px), bukan hanya teks di ujung kanan.
Nama maksimal satu baris (ellipsis), meta satu baris (ellipsis): baris yang
tingginya berbeda-beda membuat daftar tidak bisa dipindai dan kontrol di kanan
jadi tidak sejajar.

## Kontrol mati lebih baik daripada kontrol yang gagal

Kalau server menolak sebuah tindakan (bill lunas, bill ditutup, bukan pemilik),
kontrolnya **dimatikan atau tidak ditawarkan** — bukan dibiarkan menyala lalu
memunculkan galat setelah diketuk. Kontrol yang menyala adalah janji; janji yang
tidak ditepati mengajari orang untuk tidak percaya tombol lain di layar yang
sama.

Yang tetap ditawarkan pada keadaan beku hanya jalur untuk membukanya kembali
(mis. "Batalkan lunas seluruh bill"), dan jalur itu disebut namanya.

## Alamat asing punya jalan pulang

Halaman 404 memakai kerangka aplikasi yang sama: judul, ilustrasi, satu tombol
aksi, dan navigasi bawah. Tanpa itu, satu salah ketik alamat berakhir di layar
yang terlihat seperti situs rusak — padahal aplikasinya baik-baik saja.

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
