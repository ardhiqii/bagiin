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

Angka di tabel ini diuji dengan membandingkan **layar** dan **respons server**,
bukan dengan angka yang ditulis di tes. Kalau server berubah, tes ikut berubah;
kalau layar menampilkan angka lama, tes gagal.

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
