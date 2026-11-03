# Arsitektur

Cara backend dan frontend benar-benar bekerja. Dokumen ini dulunya `CLAUDE.md` di
akar repo — berkas itu dihapus karena hanya melayani satu alat, isinya dipindah
ke sini supaya tetap terbaca oleh siapa pun.

Aturan produk ada di `PRODUCT.md`; topologi, port, dan deploy di `RUNBOOK-V1.md`;
susunan frontend di `FRONTEND_STACK.md`. Dokumen ini soal *isi* kode.

## Backend (`backend/`, FastAPI + `sqlite3` stdlib, tanpa ORM)

- `main.py` — semua endpoint, otorisasi, validasi request, dan `_compute_response()`
  yang jadi satu-satunya pembangun payload untuk setiap endpoint yang mengubah data
  (klien selalu menerima keadaan bill yang dihitung ulang penuh setelah menulis).
- `db.py` — skema di `init_db()` plus migrasi `ALTER TABLE` idempoten yang
  ditambahkan di bagian bawahnya. Kolom baru lewat jalan itu; jangan menulis ulang
  `CREATE TABLE` dasarnya.
- `calc.py` — mesin pembagi murni. Tanpa I/O, tanpa DB.
- `ocr.py` — Gemini utama, cadangan vision gratis OpenRouter, plus `_normalize()`
  yang memperbaiki keluaran LLM (string `"false"`, rupiah desimal, total halusinasi)
  supaya lolos validasi pembuatan bill yang ketat.

## Identitas dan wewenang

Identitas punya `id` publik dan `secret` privat (keduanya `token_urlsafe(16)`);
klien mengirim `X-Identity-Id` **dan** `X-Identity-Secret`. Id saja bukan kredensial —
ia muncul di setiap payload bill, jadi siapa pun yang punya tautan tahu id-nya.
`_identity_from_request()` memvalidasi *dan* mengautentikasi pemanggil;
`_viewer_id()` versi best-effort untuk bacaan publik.

Dua aturan yang keduanya lahir dari bug pengambilalihan nyata
(`test_regressions_v47.py`, `test_regressions_v51.py`):

1. **Pelaku selalu diturunkan dari header, tidak pernah dari `identity_id` di path.**
2. **Secret tidak pernah dikembalikan ke siapa pun selain perangkat identitas itu sendiri.**

Identitas pra-v51 punya `secret IS NULL` dan terautentikasi lewat id saja sampai
`POST /api/identities/{id}/bind` mencetak secret (trust on first use). Id bill
adalah `token_urlsafe(16)` 22 karakter; memilikinya berarti boleh membaca.
Pembatasan laju per IP lewat slowapi.

## Kepemilikan

`_owner_id()` / `_can_manage()` di `main.py` memegang aturannya: **pembayar yang
CONFIRMED adalah satu-satunya pengelola** (v57). Hanya `identity_id` eksplisit pada
`PUT /paid_by` yang mengonfirmasi; mengirim `name` cuma menautkan identitas untuk
tampilan dan **tidak boleh** menyalakan `paid_by_confirmed` (v65 — kalau dinyalakan,
siapa pun yang punya tautan bisa mengganti namanya jadi placeholder lalu mengambil
alih bill).

Sebelum ada pembayar terkonfirmasi, pembuat yang mengelola. Begitu pengelola
mengonfirmasi pembayar, kekuasaan pindah sepenuhnya dan pembuat jadi peserta biasa.
Pembayar yang hanya cocok lewat nama bersifat tampilan saja dan tidak pernah
mengelola (v51). `can_manage` dihitung per pembaca dan dikirim di payload;
frontend memeriksa itu, tidak pernah `owner_id`.

Siapa pun selain pemilik boleh keluar dari bill terbuka lewat
`POST /api/bills/{id}/leave` — termasuk pembuat setelah pembayar terkonfirmasi
memegangnya (v58). Pemilik tidak bisa keluar (dialah yang memegang bill). Keanggotaan
orang lain diturunkan dari baris pembayaran/pemilihan mereka, jadi keluar cukup
menghapus baris itu; pembuat tidak punya baris seperti itu, sehingga keluarnya
memakai penanda `bill.creator_left` (bergabung lagi, atau bill jatuh kembali
kepadanya sebagai pemilik, menghapus penanda itu).

## Aturan pembagian (`calc.py`)

Total per orang tidak pernah disimpan, selalu dihitung ulang.

- **Item bebas:** dibagi menurut porsi yang diambil; item bebas yang tidak diambil
  siapa pun jatuh ke **pemilik** bill (`calc.compute(fallback_id=...)` — pembayar
  terkonfirmasi, kalau tidak ada berarti pembuat), karena dialah yang benar-benar
  keluar uang.
- **Item slot:** pembuat menyatakan N slot dengan `price // N`; slot yang tidak
  diklaim tetap `uncovered_idr` dan ditampilkan sebagai peringatan, bukan dibagi
  otomatis.
- **Pajak/service:** proporsional terhadap subtotal tiap orang (mode `equal` dan
  `creator` ada); bill `tax_included` membuang bagian pajak tetapi tetap membagi
  service. Item bebas yang tidak diambil jatuh ke pemilik dan karenanya tetap masuk
  dasar pajak — klien yang menghitung ulang wajib memasukkannya, kalau tidak ia
  membebankan pajak terlalu besar ke orang lain.
- Semua uang rupiah bulat. Sisa pembulatan ke pemilik.
- **Invarian:** `sum(total orang) + uncovered_idr + remaining_to_creator == total_idr`.
  Setiap perubahan `calc.py` harus menjaga `total_ok` tetap benar — itulah yang
  diperiksa uji regresi.
- `settled` berarti **tidak ada uang yang menggantung** (`all_paid` dan tidak ada slot
  kosong). Menutup bill **tidak** berarti lunas; bill tertutup dengan slot kosong
  sengaja tetap belum lunas.

Pembuatan/pengubahan bill memvalidasi ketat (`subtotal == sum(price - discount)`,
`total == subtotal + tax + service`, `tax_included` berarti `tax == 0`) dan menolak
400 daripada menyimpan bill yang pembagiannya mustahil cocok. `discountIdr > subtotal`
ditolak; UI mematikan tombol simpan dan menjelaskannya di kolom diskon, bukan
menampilkan total negatif. `db.update_bill()` membandingkan item per id supaya
pemilihan yang sudah ada selamat saat bill diubah; id yang bukan milik bill
disisipkan sebagai item baru, bukan menimpa baris.

## Frontend (`frontend/src/`)

- `router.tsx` — rute nyata (TanStack Router, path Indonesia): `/` (beranda),
  `/bills`, `/create`, `/b/$billId`, `/b/$billId/edit`, `/recap`, `/kontak`,
  `/masuk`, `/settings`. Tidak ada hash router, dan rute rekap adalah `/recap` —
  bukan `/rekap`.
- `screens/` — satu berkas per layar; `BillDetail.tsx` menangani pemilih tamu,
  tampilan pembuat, dan aksi bayar. `Create.tsx` / `EditBill.tsx` memegang OCR dan
  editor item.
- `lib/api.ts` — pembungkus fetch yang menyisipkan `X-Identity-Id`/`X-Identity-Secret`;
  `lib/session.ts` menyimpan identitas di `localStorage` (selalu dibungkus try/catch —
  mode privat tidak boleh mematikan aplikasi); `lib/money.ts` memformat rupiah.
- `design-system.css` — token warna/jarak/radius + komponen `ds-*`. Perubahan visual
  lewat token, bukan nilai ad hoc, supaya layar tetap konsisten.
- Penulisan pemilihan diserialkan supaya POST paralel tidak saling mendahului dan
  menelan ketukan.

## Kebiasaan yang perlu dijaga

- Komentar di kode ini menjelaskan **bug yang pernah terjadi** (`(bug: ...)`). Itu
  sejarah yang menahan kode, jangan dihapus saat merapikan sekitar.
- Setiap putaran perbaikan bug mengirim uji regresi di
  `backend/test_regressions_vNN.py` yang dinamai menurut versi frontend, plus entri
  changelog di `SPEC.md`. Perilaku end-to-end tinggal di `frontend/tests/*.spec.ts`
  (Playwright, viewport ponsel).
- Galat ke klien selalu 4xx walaupun kegagalannya dari OCR di hulu (badan 5xx
  ditelan Cloudflare dan diganti halaman HTML).
- Salinan UI, pesan galat (`HTTPException` detail), dan prompt OCR semuanya bahasa
  Indonesia kasual. Ikuti itu saat menambah teks untuk pengguna.
