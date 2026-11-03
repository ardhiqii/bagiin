# Dokumen Bagiin

Semua dokumen proyek ada di folder ini. Di akar repo hanya tinggal tiga berkas
yang memang harus di akar: `README.md` (pintu masuk), `AGENTS.md` dan
`CLAUDE.md` (aturan kerja agen — alat baca keduanya dari akar repo, jadi
memindahkannya membuatnya tidak terbaca).

Urutan baca yang masuk akal untuk orang baru: `PRODUCT.md` → `DESIGN_SYSTEM.md`
→ `FRONTEND_STACK.md` → `API_CONTRACT.md` → `RUNBOOK-V1.md`.

## Produk dan aturan

| Berkas | Isi | Kapan dibuka |
| --- | --- | --- |
| `PRODUCT.md` | Aturan produk dan bisnis dari pemilik. Kalau berbeda dengan kode, dokumen ini yang menang. | Sebelum mengubah perilaku yang dilihat pengguna. |
| `SPEC.md` | Spesifikasi + changelog implementasi historis. | Saat mencari "kenapa dulu diputuskan begitu". |
| `PLAN-AUTH-KONTAK.md` | Rencana identitas, tautan akun, dan kontak. | Sebelum menyentuh identitas, tamu, atau undangan. |
| `PLAN-REKAP.md` | Rencana rekap tagihan antar orang. | Sebelum menyentuh rekap. |

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
| `TEST-MATRIX.md` | Kasus uji kotak hitam, dua mesin (Chromium + WebKit), dan hasil putaran terakhir. | Sebelum menambah kasus uji atau membaca kenapa sebuah kasus ada. |

## Di luar folder ini

- `../AGENTS.md`, `../CLAUDE.md` — aturan kerja agen; harus di akar repo.
- `../frontend/src/assets/ART_CONTRACT.md` — kontrak seni aset ilustrasi; sengaja
  menempel pada asetnya supaya ikut terbaca saat membuat aset baru.
- `../frontend/README.md` — catatan khusus frontend (perintah dev, uji, build).
