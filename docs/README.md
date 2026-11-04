# Dokumen Bagiin

Semua dokumen proyek ada di folder ini. Di akar repo hanya tinggal dua berkas
yang memang harus di akar: `README.md` (pintu masuk) dan `AGENTS.md` (aturan kerja
agen — alat agen membacanya dari akar repo, jadi memindahkannya membuatnya tidak
terbaca).

Urutan baca yang masuk akal untuk orang baru: `PRODUCT.md` → `DESIGN_SYSTEM.md`
→ `FRONTEND_STACK.md` → `ARCHITECTURE.md` → `API_CONTRACT.md` → `RUNBOOK-V1.md`.

## Produk dan aturan

| Berkas | Isi | Kapan dibuka |
| --- | --- | --- |
| `PRODUCT.md` | Aturan produk dan bisnis dari pemilik. Kalau berbeda dengan kode, dokumen ini yang menang. | Sebelum mengubah perilaku yang dilihat pengguna. |
| `SPEC.md` | Spesifikasi + changelog implementasi historis. | Saat mencari "kenapa dulu diputuskan begitu". |
| `PLAN-AUTH-KONTAK.md` | Rencana identitas, tautan akun, dan kontak. | Sebelum menyentuh identitas, tamu, atau undangan. |
| `PLAN-REKAP.md` | Rencana rekap tagihan antar orang. | Sebelum menyentuh rekap. |
| `PLAN-ASET-ANIMASI.md` | Rencana aset & animasi: inventaris aset per layar, hukum bayangan, dan apa yang perlu dibuat — termasuk kenapa kehalusan dikejar lewat lapisan + CSS, bukan urutan frame. | Sebelum membuat atau mengganti aset, atau saat bayangan/animasi terasa tidak konsisten. |
| `PERF-AUDIT.md` | Audit performa & responsivitas per layar: apa yang sudah instan, apa yang menunggu jaringan, angka terukur, dan sisa yang belum dikerjakan. | Sebelum mengubah jalur aksi, atau saat ada keluhan "kerasa lambat". |
| `PLAN-FOTO-INPUT.md` | Rencana bentuk kartu foto struk: dua niat, sumber foto, tempelan berulang. | Sebelum mengubah kartu foto di layar buat bill. |

## Tampilan

| Berkas | Isi | Kapan dibuka |
| --- | --- | --- |
| `DESIGN_SYSTEM.md` | Arah visual (layout Seimbang, palet Saldo), token, ukuran, aturan komponen. | Setiap kali mengubah UI. |
| `STORYBOARD.md` | Alur layar dari sisi pengguna. | Saat menambah layar atau mengubah urutan langkah. |
| `UX_RESEARCH.md` | Catatan riset; memisahkan perilaku pihak ketiga dari keputusan kita. | Saat mempertanyakan kenapa sebuah pola dipilih. |
| `FRONTEND_STACK.md` | Susunan React 19 + TypeScript + Vite, router, query, dan batasnya. | Saat menyentuh struktur frontend. |

## Teknis

| Berkas | Isi | Kapan dibuka |
| --- | --- | --- |
| `API_CONTRACT.md` | Bentuk endpoint yang sebenarnya dipakai frontend. | Sebelum mengubah request/response. |
| `RUNBOOK-V1.md` | Topologi, layanan, port, DB, deploy, rollback, keadaan darurat. | Sebelum deploy atau saat produksi bermasalah. |
| `ARCHITECTURE.md` | Cara backend dan frontend benar-benar bekerja: model identitas, kepemilikan, invarian pembagian, kebiasaan kode. | Sebelum menyentuh otorisasi, pembagian, atau struktur kode. |
| `TEST-MATRIX.md` | Kasus uji kotak hitam, dua mesin (Chromium + WebKit), dan hasil putaran terakhir. | Sebelum menambah kasus uji atau membaca kenapa sebuah kasus ada. |

## Di luar folder ini

- `../AGENTS.md` — aturan kerja agen; harus di akar repo.
- `../frontend/src/assets/ART_CONTRACT.md` — kontrak seni aset ilustrasi; sengaja
  menempel pada asetnya supaya ikut terbaca saat membuat aset baru.
- `../frontend/README.md` — catatan khusus frontend (perintah dev, uji, build).
