# Storyboard integrasi Beranda · Bill · Rekap

Dokumen ini yang diuji `app/tests/integration.spec.ts`. Tiga layar menampilkan uang
yang sama dari tiga sudut; yang dijaga bukan "tiap layar jalan", tapi **ketiganya
menceritakan angka yang sama setelah setiap perubahan**, tanpa reload.

## Aturan dasar

- **Beranda** = daftar + ringkasan: satu baris per bill, angka di kanan selalu
  **bagian saya**, bukan total bill.
- **Bill** = sumber kebenaran satu bill: item, siapa ambil apa, total, tujuan transfer.
- **Rekap** = pekerjaan yang belum beres: nominal yang **sudah pasti** dipisah dari
  bill yang **pembagiannya belum jelas**. Keduanya tidak pernah dijumlahkan.
- Setiap perubahan yang menyentuh uang harus menyegarkan ketiganya
  (`lib/mutations.ts` → `invalidateMoneyViews`). Kalau tidak, dua layar bisa
  menampilkan angka berbeda sampai ada yang reload.

## Alur pemakaian yang harus benar

### 1. Buat bill
Aufa memotret/ketik bill Rp20.000, lalu membuka beranda dan rekap.
- Beranda: baris baru muncul, angka kanan `Belum pilih` (dia belum memilih item),
  keterangan `dari Rp20.000`.
- Bill: total Rp20.000.
- Rekap: bill masuk **Pembagian belum jelas**, bukan nominal final. Nominal final
  tidak berubah sama sekali — uang yang belum ada pengakunya tidak boleh masuk
  hitungan "sudah pasti".

### 2. Pilih item
Dia mengetuk satu item.
- Bill: bagian saya = harga item itu.
- Rekap: bill pindah dari "belum jelas" ke daftar orang; nominal final bertambah
  **tepat** sebesar bagian saya.
- Beranda: angka baris = bagian saya, kartu ringkasan ikut berubah.

### 3. Tandai lunas
- Bill: status bagian saya jadi lunas.
- Beranda: baris jadi `bagianmu lunas`; banner "belum kamu selesaikan" berkurang.
- Rekap: kalau semua orang sudah lunas, bill hilang dari rekap (rekap = pekerjaan,
  bukan arsip).

### 4. Ubah harga / item
- Bill: total baru.
- Beranda: total & bagian saya ikut (tidak ada sisa angka lama).
- Rekap: nominal final dihitung ulang dari total baru.

### 5. Tutup bill (sisa ditanggung pembayar)
Dari Rekap, bill yang pembagiannya belum jelas ditutup.
- Rekap: hilang dari "belum jelas".
- Beranda: pindah ke bagian **Lunas**.
- Bill: status terkunci; angka tidak berubah lagi.

### 6. Tambah foto struk
- Bill: foto muncul.
- Beranda: thumbnail baris ikut muncul (butuh invalidasi daftar, bukan cuma bill).

### 7. Ganti rekening di Pengaturan
- Bill: tujuan transfer menampilkan nomor rekening baru tanpa reload.
- Beranda & Rekap: nominal tidak berubah (rekening bukan uang), tapi data ikut segar.

### 8. Hapus bill
- Beranda & Rekap: hilang.
- Link bill: tidak bisa dibuka lagi.

## Invariant yang diuji, bukan diasumsikan

1. `kartu Beranda == |recap.final.net_idr|`
2. `angka baris Beranda == bill.my_total_idr`
3. `total di layar bill == bill.total_idr`
4. Satu bill tidak boleh muncul sekaligus di `final` dan `provisional`
5. `sum(amount_idr di final) == payable_idr + receivable_idr`
6. Tidak ada angka lama yang tertinggal setelah perubahan (dibuktikan dengan
   navigasi **client-side**, bukan reload — reload selalu menyembunyikan bug cache)

## Yang terbukti saat diuji (dan tidak kelihatan dari membaca kode)

1. **Pemilik bill otomatis "lunas".** Dia yang menalangi, jadi backend mencatat
   bagiannya sudah dibayar. Tombol "Tandai lunas" karena itu hanya muncul untuk
   orang yang berutang — kasus lunas diuji dari sisi tamu, bukan pemilik.
2. **Bill tanpa pilihan tidak boleh masuk hitungan final.** Rekap memisahkan
   `provisional` dari `final`; begitu satu bill muncul di `final`, ia tidak boleh
   muncul lagi di `provisional`.
3. **Cache rekap adalah tempat bug bersembunyi.** Membuat bill lalu menekan tab
   Rekap dalam 15 detik memperlihatkan rekap lama (bill baru tidak ada) kalau
   invalidasi tidak jalan. Ini terbukti: dengan invalidasi lama, e2e gagal;
   setelah `invalidateMoneyViews`, lulus.
4. **Angka baris di beranda punya dua bagian** (bagian saya + "dari Rp…").
   Membaca `textContent` mentah menggabungkan keduanya, jadi pembanding angka
   harus memotong di kata "dari" — kalau tidak, tesnya membandingkan angka palsu.

### Perilaku uang yang dikunci e2e (bukan asumsi)

| Kejadian | Yang harus benar di tiga layar |
|---|---|
| Bill dibuat | total bill == kartu layar bill; baris beranda == bagian saya; rekap menandainya belum jelas |
| Semua orang memilih | bill pindah dari belum jelas ke final; kartu beranda == net rekap |
| Ganti pembayar | arah berbalik: yang tadinya "harus kamu terima" jadi "harus kamu bayar", nominal == bagian saya |
| Tamu keluar dari bill | itemnya pindah ke tanggungan pembayar (owner_absorbed), total bill tidak berubah, uang tidak menguap |
| Pajak + diskon | jumlah bagian semua orang == total bill persis, tidak ada sisa pembulatan yang hilang |
| Batalkan undangan | kartu undangan hilang dari beranda orang yang diundang |
| Ubah harga | total baru sampai ke bill, baris beranda, dan kartu rekap |
| Tutup bill | hilang dari daftar belum jelas, muncul di Lunas |
| Hapus bill | hilang dari beranda dan rekap, link-nya 404 |
| Satu item, tiga unit | dua unit diambil dua orang, satu unit sisa tetap terlihat sebagai belum jelas 10.000; baru setelah unit terakhir diambil bill boleh dianggap pasti |
| Buka di perangkat lain | kode pemulihan mengembalikan **identitas yang sama** (bukan akun baru), dan angka di beranda/rekap sama dengan yang dilihat server |

Angka di tabel ini diuji dengan membandingkan **layar** dan **respons server**,
bukan dengan angka yang ditulis di tes. Kalau server berubah, tes ikut berubah;
kalau layar menampilkan angka lama, tes gagal.

## Pembayar yang belum memilih bukan "belum memilih"

Di daftar orang pada layar bill, siapa pun yang bagiannya Rp0 dilabeli "Belum
memilih" — termasuk pembayar. Padahal pembayar yang tidak mengambil satu item
pun sudah menalangi seluruh bill dan menanggung sisa yang tidak diambil siapa
pun. Menulis "belum memilih" di sebelah lencana "Lunas" membuat orang mengira
masih ada yang harus dia kerjakan. Sekarang: "Menalangi bill ini".

## Rincian per orang, dan pengingat yang nominalnya sama

Kartu orang di rekap bisa dibuka: rinciannya per bill, dan tiap baris membawa
nominal versi server — bukan hasil hitung ulang di layar. Kalau angkanya
dihitung dua kali di dua tempat, cepat atau lambat keduanya berbeda.

Untuk sisi piutang ada tombol "Salin pesan pengingat": satu ketukan menyalin
teks berisi nama, daftar bill beserta nominal, total, dan nomor rekening saya
(kalau ada). Nominal di pesan diambil dari angka rekap yang sama — menagih lewat
WhatsApp dengan nominal berbeda dari yang ada di aplikasi adalah cara tercepat
memulai pertengkaran. Tombol ini tidak muncul kalau justru saya yang berutang.

## Dua tombol "tutup" yang artinya beda — sekarang dibedakan

Ketemu saat menguji: tombol "Tutup bill" ada di dua layar dengan **akibat uang
yang berbeda**.

- Di **layar bill** ia memanggil `close`: status bill jadi `closed`, terkunci
  dari perubahan. Tidak ada utang yang dihapus. Orang yang belum bayar tetap
  tercatat, dan bill-nya tetap dihitung sebagai belum lunas.
- Di **rekap** ia memanggil `settle`: seluruh bill dianggap lunas
  (`settled_manual`), supaya cocok untuk pembayaran tunai di luar aplikasi.
  Setelah itu tidak ada lagi yang ditagih.

Label yang sama untuk dua akibat berbeda adalah cara tercepat membuat orang
salah paham soal uang. Jadi:

- rekap: judul "Tandai bill ini lunas?", tombol "Tandai lunas, sisa ditanggung
  {pembayar}", dan salinan yang menyebut bahwa sisanya tidak ditagih lagi;
- layar bill: catatan "Kunci bill: tidak bisa dipilih atau diubah lagi. Yang
  belum bayar tetap tercatat." — karena memang itu yang terjadi.

Diuji di e2e 88 (tandai lunas → batalkan, status uang bolak-balik utuh) dan 89
(tutup → tidak masuk "Lunas", tetap muncul di Semua, buka lagi → kembali
berjalan dengan total yang sama).

## Satu angka tindakan, dan arah uang yang terbaca

Beranda dulu punya tiga penghitung untuk hal yang mirip: `2 belum lunas` di
kepala, `2 belum kamu selesaikan` di banner, `6 belum jelas` di kartu saldo.
Ketiganya benar, tidak ada yang bisa dipercaya — dan begitu satu bill ditandai
lunas, angkanya berubah sendiri tanpa penjelasan.

Sekarang satu blok, satu angka, tiap bill masuk hitungan **tepat sekali**:

1. bagian saya belum memilih item → `Pilih N item lagi`
2. sudah memilih, bagian saya belum dibayar → `Tinggal kamu bayar`
3. saya pembayar dan masih ada sisa yang tidak diambil → `Pilih N item lagi`

Jumlah rincian selalu sama dengan angka besarnya. Yang bukan tugas saya
(peserta lain belum membayar, porsi yang nanti ditanggung pembayar) tidak
diberi penanda: daftar yang semua barisnya berteriak tidak memberi tahu apa pun.

Arah uang: kata kerja/label dulu (`Harus kamu bayar`, `Tinggal kamu bayar`),
warna kedua (merah keluar, hijau masuk, amber belum pasti), dan tanda hanya
kalau dua-duanya tidak ada. "Harus kamu bayar −Rp22.000" sengaja tidak dipakai:
terbaca seperti uang kembali. Baris yang sudah menulis "Tinggal kamu bayar"
tidak lagi menulis "−Rp22.000" — dua kali untuk hal yang sama.

## Kepala layar diam, dua angka di kartu, satu blok kuning

Judul layar berhenti menghitung: tidak ada `59 bill`, tidak ada `belum lunas`.
Penghitung di kepala berubah sendiri setiap ada yang dibayar, dan angka yang
berubah tanpa penjelasan membuat orang menebak mana yang benar.

Yang dipakai sekarang:

- **Kartu navy** memuat dua angka yang tidak pernah dijumlahkan: yang **pasti**
  (`Harus kamu bayar`) dan yang **kasar** (`Perkiraan tambahan ± Rp…`). Angka
  kasar selalu berawalan `±` dan duduk di baris sendiri di dalam kartu — bukan
  kartu kedua yang bersaing. Catatan di bawahnya menjawab "angka ini angka apa",
  bukan menambah hitungan.
- **Blok kuning** isinya hanya pekerjaan: jumlah + rincian dalam kata kerja
  (`3 tinggal dipilih · 2 tinggal dibayar`). Tanpa panah. Blok itu sendiri yang
  menyaring daftar ke bill tersebut, dan yang menandakan itu chip saringan yang
  ikut aktif.

## Nol tidak perlu diteriakkan

Beranda dulu selalu memasang kartu saldo besar, termasuk saat nilainya Rp0.
Akibatnya angka nol — yang tidak perlu ditindaklanjuti — tampil lebih berat
daripada undangan dan bill yang benar-benar menunggu keputusan.

Sekarang:
- ada uang yang pasti → kartu saldo seperti biasa;
- nol dan masih ada bill belum dibagi → satu baris notice: "Belum ada yang harus
  dibayar. N bill belum selesai dibagi." + tautan "Bagi sekarang";
- nol dan semua beres → notice tenang tanpa tautan;
- belum punya bill sama sekali → tidak ada apa-apa (empty state yang bicara).

Sekalian ketemu satu kesalahan informasi: kepala beranda menulis "N belum lunas"
dari **jumlah bill yang masih terbuka**, padahal "belum lunas" bagi pembaca
berarti **bagian dia** belum dibayar. Bill terbuka dengan bagian saya sudah
dibayar jadi tampak seperti utang yang tidak ada. Sekarang angkanya dari bagian
yang benar-benar belum dibayar, dan kalau tidak ada: "semua bagianmu lunas".

## Pintu masuk kedua: /masuk

Satu-satunya halaman yang boleh dibuka tanpa identitas selain beranda. Kode
pemulihan adalah bukti "ini orang yang sama" — karena itu setelah masuk,
seluruh query diinvalidasi, bukan cuma diganti nama di layar. Tanpa itu, orang
yang memulihkan akun di perangkat baru bisa melihat daftar bill kosong sampai
ada yang reload, dan mengira datanya hilang.

Catatan untuk siapa pun yang menulis tes: rutenya `/masuk`, bukan `/restore`.
Salah alamat berarti tes menunggu kolom yang tidak pernah muncul.

## Undangan: jalur terpendek yang tetap jujur

Backend sudah memasukkan orang yang diundang ke bill tanpa bertanya kalau
`auto_accept` menyala (bawaan). Jadi jalur normalnya **nol ketukan**.

Kartu undangan hanya muncul untuk dua kasus sisa: orangnya mematikan
`auto_accept`, atau pernah menolak undangan sebelumnya (menolak = "tidak untuk
saat ini", bukan larangan; undangan berikutnya harus disetujui dengan sadar).
Di dua kasus itu, beranda sekarang menampilkan kartu:

- nama bill, siapa yang mengundang, dan **total** bill (bukan bagianmu — bagian
  baru ada setelah memilih item di dalamnya),
- tombol **Ikut** (satu ketukan, langsung masuk lalu dibuka bill-nya),
- tombol **Tolak** — bukan "Nanti". Menekan tombol ini benar-benar menolak
  undangan, jadi labelnya harus jujur. Keluar dari bill tetap bisa kapan saja
  dari layar bill, dan itu yang membuat auto-accept aman.
