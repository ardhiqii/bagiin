# Bagiin Design Lab

Prototype **mobile focused** untuk memilih arah UI/UX. Fondasi bisnis tetap di [`PRODUCT.md`](../PRODUCT.md); riset terdahulu ada di [`UX_RESEARCH.md`](../UX_RESEARCH.md). Prototype ini terpisah dari frontend lama dan tidak membaca/menulis data produksi.

**Arah terpilih:** layout Seimbang dengan palet Saldo. Ini satu-satunya arah yang dibangun; tiga konsep pembanding (Saldo, Teman, Struk) sudah dihapus dari kode pada v0.4. Aturannya ada di [`DESIGN_SYSTEM.md`](../DESIGN_SYSTEM.md); halaman visual dapat dibuka dengan `?view=system`. Konsep Seimbang (`?v=seimbang`) sekarang memakai token tersebut. Halaman bill masih perlu iterasi UX berikutnya.

## Jalankan

```bash
cd prototype
npm install
npm run dev
```

`npm run build` memeriksa TypeScript lalu membuat bundle statis.

## Peta fitur produk

| Area | Fitur yang perlu ada pada produk | Terlihat di prototype |
| --- | --- | --- |
| Membuat bill | Foto/upload struk, OCR ke editor, ketik manual, koreksi nama/harga/jumlah, diskon item, voucher bertarget, pajak/service, ongkir/kemasan, selisih terhadap total struk, edit bill | Editor OCR/manual contoh, item dan diskon contoh; penyimpanan dan OCR belum terhubung |
| Orang | Link untuk orang baru; undang kontak yang pernah se-bill; ID tetap, nama bebas, nickname pribadi; keluar/keluarkan orang | Link salin dan undang Citra contoh |
| Pembagian | Unit per orang; satu item dibagi rata; jumlah pemakan tetap; bagian menunggu orang; pembayar bisa assign sebelum peserta memilih; peserta bisa koreksi; selesai pilih per orang | Dimsum dibagi 3, pilihan B/C, assign C, jumlah pemakan oleh pembayar, status selesai pilih |
| Pembayaran | Tujuan bayar orang yang nalangin; tandai lunas sebagai status; catat nominal yang ditandai; kurang/lebih akibat revisi; pengembalian; pembatalan status salah; pindah pembayar dengan penerimaan | Metode BCA contoh, tandai lunas dan kurang bayar bila nominal naik; sisanya belum disimulasikan |
| Rekap | Utang dan uang masuk tersisa; final vs sementara; rincian per orang/bill; tanpa grup dan netting otomatis; riwayat perubahan | Satu bill interaktif + dua bill contoh; rincian per orang dan catatan sementara |
| Identitas & migrasi | Guest, recovery key, Google opsional, kontak otomatis, data dan tautan lama tetap bekerja | Belum disimulasikan |

## Empat arah desain

| Konsep | Pintu masuk | Cocok untuk | Risiko untuk diuji |
| --- | --- | --- | --- |
| 01 Seimbang | Item dan nominal bersisian; warna Saldo | Arah utama yang dipilih | Halaman bill perlu pendalaman kasus |
| 02 Saldo | Sisa utang dan uang masuk | Orang yang sering patungan | Item bisa terasa satu lapis lebih jauh |
| 03 Teman | Orang dan aktivitas bersama | Undangan/assignment kontak lama | Angka dan ketidakpastian harus tetap jelas |
| 04 Struk | Dokumen item dan biaya | Transaksi dengan banyak komponen | Lebih padat pada layar kecil |

Skenario bersama: Aufa nalangin bill Dapur Tiga Rp163.000; Bima memilih itemnya, Citra belum masuk, satu bagian dimsum menunggu. Coba tab **Bill**, **Rekap**, dan **Buat**; pilih peran untuk mencoba aksi pada layar bill. Beranda dan rekap adalah contoh sudut pandang Bima. Semua perubahan hanya hidup selama halaman dibuka.

## Referensi yang dipakai

- [Tab](https://www.tabapp.co/): foto struk lalu peserta mengetuk itemnya; ini memengaruhi konsep Seimbang.
- [Plates by Splitwise](https://plates.splitwise.com/): item bersama dan rincian biaya; ini memengaruhi kontrol bagian tetap dan konsep Struk.
- [Splitwise itemized expenses](https://kb.splitwise.com/balances-and-expenses/what-are-different-ways-i-can-split-an-expense): item bisa dialokasikan ke orang dan diskon/biaya tampak dalam pembagian; ini memengaruhi peta fitur.
- [Splitwise activity history](https://kb.splitwise.com/account-issues/where-can-i-view-a-history-of-recent-changes-to-my-account): jejak perubahan sebagai kebutuhan produk, belum sebagai layar prototype.

Keempat tampilan adalah interpretasi desain Bagiin sendiri, bukan salinan UI referensi. Keputusan bisnis Bagiin tetap mengikuti `PRODUCT.md`, termasuk tanpa grup wajib dan tanpa netting otomatis.

## Preview publik

https://bagiin-react.ardhiqi.com — hasil `npm run build` yang dipasang di
`/var/www/bagiin-react`, dilayani Nginx (`bagiin-react.ardhiqi.com.conf`) dengan
sertifikat Let's Encrypt (DNS-01). Preview ini demo: state hanya di memori,
tanpa backend, tanpa data asli.

Deploy ulang:

```bash
cd prototype && npm run build
sudo rsync -a --delete dist/ /var/www/bagiin-react/
sudo systemctl reload nginx
```

Nama host harus satu level di bawah `ardhiqi.com` (mis. `bagiin-react.ardhiqi.com`).
Nama dua level seperti `react.bagiin.ardhiqi.com` tidak tercakup sertifikat
wildcard Cloudflare, jadi TLS di edge gagal walaupun origin sehat.
