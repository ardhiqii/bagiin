# AGENTS.md — Bagiin 1.0

Bagiin adalah **satu aplikasi, satu folder, satu DB**. Versi 1 (React) adalah
satu-satunya garis yang hidup; tidak ada lagi dua jalur vanilla/React.

## Fakta yang berlaku

| Hal | Nilai |
| --- | --- |
| Versi | **1.0.0** (`frontend/package.json`) |
| Branch kerja | `main` — tidak ada branch lain |
| Kode | `/opt/projects/bagiin` |
| Frontend | React 19 + TypeScript + Vite (`frontend/`) |
| Backend | FastAPI + SQLite stdlib (`backend/`) |
| Produksi | https://bagiin.ardhiqi.com |
| DB produksi | `/var/lib/bagiin/bagiin.db` — **di luar repo, jangan dipindah** |
| Uploads produksi | `/var/www/bagiin-uploads` |
| Build yang dilayani | `/var/www/bagiin` |
| Layanan produksi | `bagiin-api.service` — port **8096**, `BAGIIN_ENV=production` |
| Layanan uji (e2e) | `bagiin-dev.service` — port **8090**, DB `/var/lib/bagiin-dev/bagiin.db` |

Versi vanilla 0.9 sudah pensiun: kodenya hanya ada di riwayat git, tidak ada
`frontend/static/`, tidak ada `prototype/`, dan `main` sekarang berisi versi 1.
Domain `bagiin-react.ardhiqi.com` sudah **dihapus** (vhost, sertifikat, arsip)
sejak 2 Nov 2026 — jangan dihidupkan lagi.

## Aturan kerja

- Semua perubahan di `main`. Kalau butuh branch sementara, hapus setelah merge —
  jangan biarkan garis kedua tumbuh lagi.
- **Jangan menulis ke DB produksi di luar API.** Untuk membaca boleh
  (`mode=ro`), untuk mengubah lewat backend. Data hidup ada di
  `/var/lib/bagiin/bagiin.db`, bukan di repo.
- Deploy hanya lewat `bash scripts/deploy-web.sh` (menyimpan build + DB lama,
  lalu membuktikan hasilnya lewat HTTP). Membatalkan: `bash scripts/rollback-web.sh`.
  Jangan `rsync` manual ke `/var/www/bagiin` dan jangan lupa restart `bagiin-api`
  kalau kode backend berubah.
- Jangan mengarahkan e2e ke 8096. Playwright memakai `bagiin-dev` (8090).
- Jangan mengubah `/etc/nginx` tanpa menyalin perubahannya ke
  `scripts/nginx/bagiin.ardhiqi.com.v1.conf`.

## Source of truth, berurutan

Semua dokumen ada di `docs/`; daftarnya `docs/README.md`.

1. `docs/PRODUCT.md` — aturan produk dan bisnis dari pemilik (Indonesian). Kalau
   berbeda dengan kode, dokumen ini menang dan selisihnya dibahas dulu.
2. `docs/DESIGN_SYSTEM.md` — arah visual (Seimbang layout, Saldo palette), token,
   komponen, kosakata status.
3. `docs/UX_RESEARCH.md` — catatan riset; memisahkan perilaku pihak ketiga dari
   rekomendasi untuk Bagiin.
4. `docs/RUNBOOK-V1.md` — topologi, deploy, rollback, keadaan darurat.
5. `CLAUDE.md` — cara backend dan frontend benar-benar bekerja (di akar repo,
   karena alat agen membacanya dari sana).
6. `docs/SPEC.md` — changelog implementasi historis.

## Aturan uang (tidak negotiable)

- Angka final selalu dari server (`backend/calc.py` + `_compute_response()`).
  Klien yang menghitung ulang split adalah kelas bug termahal di proyek ini —
  pernah menyuruh tamu transfer nominal yang salah.
- Semua rupiah integer. Jaga invariant
  `sum(people totals) + uncovered_idr + remaining_to_creator == bill.total_idr`.
- Diskon tidak boleh melebihi subtotal; tombol simpan mati dan alasannya
  ditulis di kolom diskon (layar tidak boleh menampilkan total minus).

## Struktur

- `frontend/src/screens/` — satu berkas per layar (`Home`, `Create`, `EditBill`,
  `BillDetail`, `Recap`, `Contacts`, `Settings`, `Entry`, `Welcome`, `NotFound`).
- `frontend/src/lib/` — `api.ts` (fetch + header identitas), `session.ts`,
  `queries.ts`, `mutations.ts`, `money.ts`, `share.ts`.
- `frontend/src/design-system.css` + `app.css` — token dan komponen. Jangan
  menambah warna/ukuran ad hoc; pakai token yang ada.
- `backend/main.py` (endpoint + `_compute_response()`), `db.py` (skema +
  `ALTER TABLE` idempoten), `calc.py` (mesin split murni), `ocr.py`.
- `backend/venv/` — venv milik repo ini sendiri (Python 3.14). Bukan warisan
  folder lain.

## Commands

```bash
# backend
cd backend
./venv/bin/python -m pytest -q                     # 422 kasus, ~25 dtk
BAGIIN_DB=/tmp/x.db ./venv/bin/python -m pytest -q  # pakai DB sekali pakai

# frontend
cd frontend
npm run dev        # http://localhost:5199, proxy /api -> 127.0.0.1:8090
npm run build      # tsc -b && vite build -> dist/
npx playwright test  # 33 berkas / 253 kasus; butuh bagiin-dev.service hidup
```

Kalau habis pindah branch atau merge yang mengganti banyak isi `frontend/`,
**restart Vite** sebelum menjalankan e2e — module graph basi bikin layar
kosong dan tes gagal massal padahal aplikasinya sehat.

## Konvensi

- UI copy, pesan error (`HTTPException` detail), dan prompt OCR memakai bahasa
  Indonesia santai. Ikuti.
- Komentar di kode ini menceritakan bug yang pernah terjadi; jangan dihapus
  saat merapikan sekitarnya.
- Perubahan skema lewat `ALTER TABLE` idempoten di bawah `db.init_db()`.
  Jangan menulis ulang `CREATE TABLE` dasar.
- Jangan `parseInt` nilai input rupiah — input berisi teks bertitik.
- Jangan pakai `confirm()` bawaan browser; pakai sheet komponen proyek.
