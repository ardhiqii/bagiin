# Rekap v2 — rencana (belum diimplementasikan)

Status: disetujui arahnya, menunggu implementasi. Tidak ada perubahan kode.

## Definisi yang dipakai

Dua sumbu terpisah, tidak boleh digabung:

| Sumbu | Kosakata UI | Arti |
|---|---|---|
| Pembagian | **Sudah jelas / Belum jelas** | semua item punya pemilik, angka tiap orang tidak berubah |
| Uang | **lunas / belum lunas** | sudah transfer atau belum |

Kata "final" tidak dipakai di UI. Backend tetap memakai `final` = pembagian sudah jelas (termasuk yang belum dibayar) — sudah sesuai definisi ini, hanya label UI kemarin yang salah.

## Isi layar, urut dari atas

1. **Kartu** — `Harus kamu bayar Rp22.000` atau `Harus kamu terima RpX`. Catatan kecil: `N bill belum lunas`. Kalau ada bill dengan pembagian belum jelas: chip amber `N bill pembagiannya belum jelas` (tap → ke seksinya).
   Angka kartu = sisa yang belum dibayar, bukan total belanja. Tidak pernah menjumlahkan angka belum jelas.
2. **Pembagian belum jelas** (hanya kalau ada) — per bill: judul, item tanpa pengaku + nominalnya, siapa yang menanggung kalau ditutup, tombol `Tutup bill` untuk pembuat bill.
3. **Kamu bayar** — per orang, urut nominal terbesar: nama, `N bill`, nominal + label `kamu bayar`. Kalau dua arah: sub-baris `dia juga bayar RpX ke kamu`.
4. **Kamu tagih** — bentuk sama, arah `kamu tagih`.
5. **Kosong** — satu ilustrasi + "Semua bill beres".

Sheet per orang (tap baris): header nama + net, lalu daftar bill yang **masih ada sisa** (judul, nominal, label `belum kamu transfer` / `belum dia transfer` / `bill ditutup`), tiap baris membuka bill.

Tidak ada: arsip per bulan, total bulanan, tab final/belum final, daftar bill di layar utama.

## Pemetaan data (sudah diverifikasi live, tanpa perubahan backend)

- `final.counterparties[]` → baris per orang. `net_idr`/`direction`/`amount_idr` untuk angka utama, `payable_idr`/`receivable_idr` untuk deteksi dua arah, `bills[]` untuk isi sheet.
- `bills[]` **hanya berisi bill yang masih ada sisa** (`_recap_edges_for_viewer` memfilter `_recap_pending_payment_people`). Bill yang sudah beres otomatis tidak muncul — jadi "yang lunas jangan dikasih tahu" terpenuhi tanpa logika tambahan.
- `direction` per bill = `pay` (kamu belum transfer) / `receive` (dia belum transfer). Ini yang jadi label di sheet; `status` hanya status bill (`open`/`closed`), bukan status bayar.
- `final.payable_idr` / `receivable_idr` = sisa belum dibayar, bukan total belanja.
- `provisional.bills[]` + `provisional.bill_count` → seksi belum jelas dan chip di kartu. `owner_absorbed_items` / `uncovered_items` untuk kalimat penyebab.
- `counts.provisional_bills` untuk chip.
- Urutan buang 1: `final_rows.sort(key=(-abs(net_idr), name))` — sudah terbesar di atas, sesuai keputusan.
- Urutan buang 2: `final.bill_count` (53, termasuk yang sudah lunas) **tidak dipakai** di kartu; hitung sendiri jumlah `bill_id` unik dari `counterparties[].bills[]`.

## Kasus pinggir yang sudah diketahui

- Orang dengan net nol (utang dan piutang sama besar) dibuang backend (`if net == 0: continue`). Tidak ada yang perlu diselesaikan, jadi dibiarkan.
- Estimasi bill belum jelas tidak diatribusikan per orang (backend memang tidak menghitungnya). Tidak ditampilkan per orang — angka perkiraan yang bisa digeser tidak boleh tampil seperti angka yang bisa ditransfer.
- Bill yang ditutup paksa (`settle`) tidak punya sisa, jadi hilang dari rekap. Sesuai keinginan: sudah dikerjakan di luar aplikasi.

---

# Spesifikasi layout (angka dari token, bukan karangan)

## Ritme layar

`app-body`: padding 20 (`--ds-gutter`), gap 20 (`--ds-space-5`), max-width frame 480.
Semua seksi memakai `Group` (primitif DS): label 11/800 uppercase di luar, satu
permukaan `--ds-surface` radius 20 dengan hairline di dalam.

## 1. Kartu (primitif `BalanceCard` / `.ds-balance`)

| Elemen | Ukuran | Warna |
|---|---|---|
| label | 12.5/400 | `#c3d6da` |
| nilai | 34/800 Manrope, -.05em, tabular | `#fff` |
| catatan | 12.5/400 | `#c3d6da` |
| padding / radius | 20 / 20 | navy `--ds-navy` |

Catatan kartu menggabungkan dua fakta dalam satu baris supaya tidak ada baris
yatim di bawah kartu:
`"1 bill belum lunas"` atau `"1 bill belum lunas · kamu juga terima Rp40.000"`.

## 2. Banner "belum jelas" (`.app-banner.is-pending`)

| Elemen | Ukuran |
|---|---|
| padding / radius | 12 / 14 |
| ikon | 19 |
| judul | 13.5/700 |
| keterangan | 11.5/400, opacity .8 |
| chevron | 16 |

Warna: `--ds-pending` di atas `--ds-pending-bg`. Tap → scroll ke seksi.
`prefers-reduced-motion` → `auto`, bukan `smooth`.

## 3. Seksi "Pembagian belum jelas"

Label: `ds-group-label` 11/800, letter-spacing .08em, uppercase, `--ds-muted`,
margin `0 0 8px 4px`.

Baris (`.recap-open`): padding `14px 12px 14px 16px`, min-height 64, flex,
gap 12, align-items center, hairline `--ds-hairline` inset kiri 16 / kanan 16.

| Elemen | Ukuran | Warna |
|---|---|---|
| judul bill | 14.5/700 | `--ds-navy` |
| alasan | 11.5/400, margin-top 2 | `--ds-muted` |
| pill penanggung | 11/700, padding 2px 8px, radius pill | `--ds-pending` / `--ds-pending-bg` |
| tombol | `.ds-button-quiet.is-compact`: min-height 44, padding 0 14, font 12.5/800 | `--ds-teal` |

## 4–5. Seksi per orang

Baris (`.recap-person`): padding `14px 16px`, min-height 64, gap 12, hairline
inset kiri 62 / kanan 16 (62 = padding 16 + avatar 34 + gap 12).

| Elemen | Ukuran | Warna |
|---|---|---|
| avatar | `.ds-avatar` 34, 12.5/800 | navy / mint saat `tagih` |
| nama | 14.5/700 | `--ds-navy` |
| meta (`N bill · status`) | 11.5/400, margin-top 2 | `--ds-muted` |
| bruto silang | 11.5/600, margin-top 2 | `--ds-teal` |
| nominal | 14.5/800 tabular | `--ds-navy` |
| label arah | 11/600, margin-top 2 | `--ds-muted` |
| chevron | 16 | `--ds-muted-soft` |

## Sheet per orang (primitif `Sheet`, art `person.webp` 108)

| Elemen | Ukuran |
|---|---|
| label total | 11/800 uppercase, letter-spacing .08em |
| nilai total | 24/800 Manrope |
| catatan | 12/400 `--ds-muted` |
| baris bill | `.app-row` (padding 14/16), judul 14.5/700, status 11.5/400, nominal 14.5/800 |
| daftar bill | `.app-list` radius 20 + hairline |

Kalau orang itu dua arah, tiga baris ringkas sebelum daftar bill:
`Kamu bayar RpX` · `Dia bayar RpY` · `Bersih RpZ` (14.5/700 tabular, label 11/600 muted).

## 6. Empty state (primitif `EmptyState`, art `paid.webp` 150)

judul 15/800, isi 12.5/400 `--ds-muted`, max-width 270, padding 28/20.

## Interaksi & aksesibilitas

- Baris orang = `<button>`, baris bill = `<Link>`; `:focus-visible` outline 2px
  `--ds-teal` offset 2.
- Target sentuh ≥44px: baris 64, tombol 44.
- Tidak ada konfirmasi kecuali menutup bill bersisa (uang berpindah, tidak bisa dibatalkan).
- Angka uang selalu `formatRp()`, integer rupiah, tabular-nums.

## Aset

Semua slot terisi aset yang ada: `paid.webp` (empty state 150) dan
`person.webp` (sheet orang 108). Kontrak aset melarang ilustrasi <110px dan
ilustrasi di samping deretan angka, jadi seksi "belum jelas" tetap teks — tidak
ada placeholder baru yang ditambahkan.

## Tes yang perlu ada setelah implementasi

- e2e: bill dengan item tanpa pemilih muncul di "Pembagian belum jelas", tutup → hilang dari rekap.
- e2e: satu orang berutang → muncul di "Kamu bayar" dengan nominal benar; setelah ditandai bayar → hilang dari rekap.
- e2e: orang dua arah → sub-baris "dia juga bayar RpX ke kamu" muncul.
- e2e: tanpa utang/piutang/bill belum jelas → empty state.
- backend: tidak ada perubahan, tes lama tetap jadi penjaga.
