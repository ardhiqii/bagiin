# Rencana: Akun (Google + username/password) & Kontak Bernama

Status: **selesai & terverifikasi.** 19 tes akun/kontak + suite penuh 119 tes
lulus. Google client ID sungguhan sudah terpasang dan tombolnya terverifikasi
terbuka ke akun Google (lihat bagian Google di bawah).

## Di mana kode ini hidup (v2)

Repo ini satu repo, tiga worktree. Sejak fase ini selesai, **versi 2 = branch
`react`**, berisi `app/` (frontend) dan `backend/` (akun, sesi, alias) sekaligus:

- `main`      -> `/opt/projects/bagiin`      -> produksi v1, port 8082, TIDAK disentuh
- `react`     -> `/opt/projects/bagiin-react` -> v2, service `bagiin-react-api`, port 8090,
  DB salinan `/var/lib/bagiin-sandbox/bagiin.db`, dipakai `bagiin-react.ardhiqi.com`

Worktree `/opt/projects/bagiin-auth` sudah dihapus setelah backend v2 masuk
`react`. Jadi tidak ada lagi branch backend terpisah yang harus di-merge sendiri.

## Google (keputusan final)

- Client ID ada di `backend/.env` sebagai `GOOGLE_CLIENT_ID` (di worktree react),
  dibaca server dan dikirim ke klien lewat `GET /api/auth/config`.
- **Tidak ada redirect URI dan tidak ada client secret** yang dipakai: alurnya
  GIS (tombol resmi di browser) -> ID token -> verifikasi di server. Redirect URI
  hanya relevan untuk code flow (butuh akses Google API / refresh token), yang
  tidak dilakukan Bagiin.
- Verifikasi yang sudah dilakukan: tombol dirender di origin live, klik membuka
  popup `accounts.google.com/v3/signin/...` tanpa error origin, halaman tidak
  berpindah. Yang belum: login consent sungguhan (butuh akun Google manusia).
Cabang: `bagiin-react` → `feat/auth-kontak`; backend → worktree `/opt/projects/bagiin-auth` cabang `feat/auth-kontak-be`

---

## 1. Masalah yang diselesaikan

**a. Akun tidak bisa dipindah dengan nyaman.** Sekarang identitas = satu `secret`
yang disimpan di localStorage. Kode pemulihan bisa memindahkannya, tapi tidak ada
cara login yang wajar di perangkat baru, tidak ada daftar perangkat, dan tidak ada
cara mematikan satu perangkat saja.

**b. Nama bukan pembeda.** Di DB sandbox ada 245 identity bernama "Aufa" dan 108
"Bima". `GET /contacts` hanya mengembalikan `{id, name, last_shared}`, jadi sheet
undangan menampilkan dua baris yang identik. Salah pilih = utang masuk ke orang
yang salah.

**Prinsip yang dipakai di seluruh rencana ini:**

> Nama adalah tampilan. Identitas adalah `identity.id`. Sistem tidak pernah
> menyelesaikan orang dari nama — dan UI tidak boleh memaksa manusia menebak.

---

## 2. Keputusan yang mengunci arah

| Keputusan | Pilihan | Alasan |
|---|---|---|
| Login utama | kode pemulihan (tetap ada) | nol gesekan, sudah dipakai |
| Tambahan | username+password, Google | permintaan user |
| Google | **ID token (Google Identity Services)**, bukan redirect OAuth | satu halaman, tanpa round-trip redirect; token diverifikasi di server |
| Kunci Google | `google_sub`, bukan email | email bisa berubah/di-reuse |
| Merge identitas | **tidak pernah otomatis** | salah merge = utang pindah orang |
| Password hash | argon2id (`argon2-cffi`) | standar sekarang; scrypt hanya cadangan |
| Sesi | device token (hash di DB), bukan secret global | bisa cabut satu perangkat |
| Kompatibilitas | `X-Identity-Secret` lama tetap diterima | app vanilla di `main` masih memakainya |
| Alias | **satu arah, privat** (gaya Steam) | orang tidak berhak tahu lu menamainya apa |
| Handle | `@username` (unik) + kode 4 huruf turunan id | pembeda yang bisa disebut di luar aplikasi |
| Alias di teks keluar | **tidak** | pesan tagihan memakai nama mereka sendiri |
| 2FA | tidak sekarang | belum perlu untuk produk dua orang per bill |

---

## 3. Model data

```sql
-- identity: tambahan kolom
ALTER TABLE identity ADD COLUMN username TEXT;          -- unik, lowercase, 3..20
ALTER TABLE identity ADD COLUMN username_lower TEXT;    -- kunci unik (case-insensitive)
ALTER TABLE identity ADD COLUMN password_hash TEXT;     -- argon2id
ALTER TABLE identity ADD COLUMN handle TEXT;            -- 4 huruf, turunan id, untuk tampilan
CREATE UNIQUE INDEX idx_identity_username ON identity(username_lower) WHERE username_lower IS NOT NULL;

-- perangkat: satu baris = satu sesi yang bisa dicabut
CREATE TABLE device (
  id TEXT PRIMARY KEY,
  identity_id TEXT NOT NULL REFERENCES identity(id),
  token_hash TEXT NOT NULL UNIQUE,       -- sha256(token)
  label TEXT NOT NULL,                   -- "Chrome · Android"
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT,
  revoked_at TEXT
);

-- akun pihak ketiga
CREATE TABLE oauth_account (
  provider TEXT NOT NULL,                -- 'google'
  provider_id TEXT NOT NULL,             -- sub
  identity_id TEXT NOT NULL REFERENCES identity(id),
  email TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (provider, provider_id)
);

-- nama yang SAYA beri ke kontak SAYA
CREATE TABLE contact_alias (
  owner_id TEXT NOT NULL REFERENCES identity(id),
  contact_id TEXT NOT NULL REFERENCES identity(id),
  alias TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (owner_id, contact_id)
);
CREATE UNIQUE INDEX idx_alias_unique ON contact_alias(owner_id, lower(alias));
```

**Backfill:** `handle` diisi untuk semua identity lama (deterministik dari id, jadi
tidak perlu kolom terisi untuk bisa menampilkan — tetap diisi supaya bisa dicari).

**Multidevice tanpa mematahkan yang lama:** `identity.secret` tetap sah. Saat
login, server membuat baris `device` dan mengembalikan token; `_identity_from_request`
menerima **secret lama** ATAU token device yang cocok.

---

## 4. Permukaan API

### Auth

```
POST /api/auth/register      {username, password, name}   -> {identity, token, recovery_code}
POST /api/auth/login         {username, password}         -> {identity, token}
POST /api/auth/google        {id_token, mode}             -> {identity, token} | {linked:true}
POST /api/auth/logout        (auth)                       -> {ok}
POST /api/auth/password      {current_password?, new_password}   (auth)
POST /api/auth/username      {username}                   (auth)
GET  /api/auth/state         (auth)                       -> {username, has_password, providers[], devices[]}
POST /api/auth/recovery      (auth)                       -> {code}   (kode baru, sekali tampil)
DELETE /api/auth/devices/:id (auth)                       -> {ok}
POST /api/auth/claim         {mode:'password'|'google'}   (auth, untuk identitas guest)
```

Aturan yang tidak boleh dilanggar:

- Pesan galat login **seragam**: "Username atau password salah" — tidak membocorkan
  username mana yang ada.
- `mode` pada `/auth/google`: `login` (kalau `sub` belum tertaut → buat identitas
  baru + kode pemulihan) atau `link` (tambatkan ke identitas yang sedang login;
  kalau `sub` sudah tertaut ke identitas lain → 409 dengan kalimat yang jelas).
- Setiap pembuatan identitas lewat auth **selalu** mengembalikan kode pemulihan
  sekali, dan UI wajib menampilkannya sebelum lanjut.
- Rate limit: login 10/menit per IP, register 5/menit, google 20/menit.

### Kontak

```
GET  /api/identities/:id/contacts
     -> [{id, name, alias, display_name, username, handle,
          last_shared, last_bill_title, shared_count}]
PUT  /api/identities/:id/contacts/:contact_id/alias   {alias|null}
     -> {alias}
```

`display_name = alias ?? name`. Nama asli tetap dikirim supaya UI bisa menampilkan
baris kedua sebagai verifikasi.

Alias juga dipakai server saat menyusun data untuk penampil:

- `GET /api/bills/:id` → tiap orang dapat `display_name`
- `GET /api/recap` → tiap counterparty dapat `display_name` + `username`/`handle`

---

## 5. UI / UX

Aturan umum (diambil dari design system yang sudah ada): target sentuh ≥ 44 px,
aksi utama di 96 px terakhir layar (thumb zone), satu aksi primer per layar,
tidak ada kontrol menyala yang tidak bisa dipakai, semua keadaan punya kalimat.

### 5.1 Layar masuk (`/masuk`) — dirombak

Tiga cara masuk, disusun sebagai **segmented control** di atas (menghindari tiga
halaman terpisah): **Kode** · **Akun** · **Google**.

- **Kode**: input 3×4 karakter, auto-uppercase, auto-pindah kelompok, tombol
  "Masuk" selebar layar di thumb zone.
- **Akun**: username + password, tombol "Masuk", tautan "Belum punya akun? Buat"
  (pindah ke mode daftar di layar yang sama, bukan layar baru).
- **Google**: tombol resmi selebar layar, tinggi 48 px; kalau GIS belum siap,
  tombol tampil disabled dengan kalimat "Menyiapkan Google…", bukan tombol mati
  tanpa alasan.
- Di bawah: "Cukup ikut bill orang? Nggak perlu akun — isi nama aja" → jalur tamu
  tetap satu ketuk.

### 5.2 Pengaturan → bagian **Keamanan**

Kartu ringkas: `@username` (atau "Belum ada"), `Password` (Ada/Belum), `Google`
(Tertaut/Belum), lalu baris:

- **Ubah username** → sheet, validasi langsung (3–20, huruf/angka/underscore),
  tampilkan `@` sebagai prefix, error dari server ditampilkan apa adanya.
- **Atur/Ganti password** → sheet 2 kolom (baru + ulangi), indikator kekuatan
  sederhana, tanpa aturan rumit yang tidak dijelaskan.
- **Tautkan Google** / **Lepas Google** (lepas hanya kalau masih ada cara masuk
  lain — kalau tidak, tolak dengan penjelasan).
- **Kode pemulihan** → "Buat kode baru" + tampil sekali dalam kartu gelap
  (pola yang sudah dipakai sekarang).
- **Perangkat** → daftar (label, terakhir aktif), tombol "Keluarkan" per baris;
  perangkat yang sedang dipakai ditandai "Ini perangkat ini" dan tidak bisa
  dikeluarkan.

### 5.3 Layar **Kontak** (`/kontak`, baru)

Tujuan: satu tempat untuk melihat "siapa saja yang saya kenal di Bagiin" dan
memberi nama pembeda.

- Daftar: avatar warna+inisial, `display_name`, `@username` atau `handle` kecil,
  "3 bill bareng · terakhir Kopi Human".
- Pencarian di atas (nama, alias, username).
- Ketuk baris → sheet: nama asli (tidak bisa diubah), kolom alias, tombol
  **Simpan nama** dan **Hapus nama** (kalau ada alias).
- Kalau ada dua kontak dengan nama sama dan belum beralias: baris menampilkan
  penanda "nama sama" + ajakan "Kasih nama pembeda".

### 5.4 Sheet undangan di layar bill

- Tiap baris: avatar, `display_name`, `@username`/handle, "terakhir: <bill>, <tanggal>".
- Ikon pensil di kanan baris → sheet alias (tanpa harus keluar dari undangan).
- Kalau pencarian menghasilkan ≥2 nama identik tanpa alias: tampilkan peringatan
  kecil di atas daftar — "Ada 2 orang bernama X, bedakan lewat nama atau @username".

### 5.5 Tampilan nama di seluruh aplikasi

`display_name` dipakai di: beranda (kalau menampilkan orang), layar bill (peserta,
"ditanggung"), rekap (daftar orang), sheet undangan. Nama asli muncul di baris
kedua pada konteks yang berisiko salah orang (undangan, kontak, rekap).

---

## 6. Google: yang benar-benar bisa dan tidak bisa dikerjakan di sini

**Bisa:** kode verifikasi ID token (`google-auth`), alur `mode=login|link`, tabel
`oauth_account`, penanganan konflik, UI tombol Google, dan konfigurasi env.

**Tidak bisa:** uji tangan nyata ke Google. Alasannya: console Google Cloud untuk
client OAuth tidak bisa saya akses dari sini, dan tidak ada akun Google yang bisa
saya pakai login. Yang saya lakukan sebagai gantinya:

1. Verifikasi tetap **sungguhan**: `google.oauth2.id_token.verify_oauth2_token`
   dengan audience = `GOOGLE_CLIENT_ID`, cek `iss`, `aud`, `exp`, `email_verified`.
2. Uji negatif yang nyata: token buatan sendiri (salah tanda tangan), audience
   salah, token kedaluwarsa → harus ditolak. Ini membuktikan jalur verifikasi
   bukan karangan.
3. Jalur `mode=login|link` diuji lewat **stub dev** yang hanya hidup kalau
   `BAGIIN_GOOGLE_STUB=1` **dan** `BAGIIN_ENV != production`; server menolak start
   kalau stub dinyalakan di produksi.

### Langkah yang harus dilakukan pemilik (sekali, ±5 menit)

1. Google Cloud Console → APIs & Services → Credentials → **Create OAuth client ID**
   → Web application.
2. Authorized JavaScript origins:
   `https://bagiin-react.ardhiqi.com`, `http://localhost:5199`, `http://localhost:8090`
3. Simpan `GOOGLE_CLIENT_ID` di env backend. (`CLIENT_SECRET` tidak dibutuhkan
   untuk alur ID token.)
4. Buka aplikasi → Pengaturan → Keamanan → **Tautkan Google** → pastikan muncul
   "Tertaut".

Selama env belum diisi, tombol Google tampil sebagai "Google belum dikonfigurasi"
dan tiga cara masuk lain tetap jalan.

---

## 7. Urutan kerja & batas commit

1. **DB + migrasi + fungsi db** (backend, tanpa UI).
2. **API auth** + penyesuaian `_identity_from_request` (backward compatible).
3. **API kontak/alias/handle** + `display_name` di bill & rekap.
4. **UI masuk** (tiga cara) + state sesi.
5. **UI Pengaturan → Keamanan** + perangkat.
6. **UI Kontak** + alias di sheet undangan.
7. **Bangun, deploy ke sandbox, QA manual dengan tangkapan layar** (mobile 390×844).
8. **E2E**: skenario normal, anomali, edge, alternatif (daftar di `STORYBOARD`).

Belum ada unit test, sesuai permintaan. Verifikasi di fase 7 dilakukan dengan
menjalankan aplikasi nyata, bukan dengan membaca kode.

---

## 8. Risiko & mitigasi

| Risiko | Mitigasi |
|---|---|
| Prod (`bagiin.service`, port 8082) memakai working tree `main` | backend dikerjakan di worktree terpisah `/opt/projects/bagiin-auth`; prod tidak direstart |
| App vanilla (`frontend/`) memakai `identity.secret` | secret lama tetap diterima; kolom baru nullable |
| Username di-squat | username bukan bukti identitas; undangan tetap harus diterima |
| Orang bikin identitas kedua lewat Google | `/auth/google?mode=link` dari Pengaturan; tidak ada merge otomatis |
| Kode pemulihan hilang + password lupa + Google lepas | paling sedikit satu cara masuk harus tersisa; UI menolak melepas cara terakhir |
| Alias dipakai untuk menyakiti orang | alias privat, tidak pernah dikirim ke yang diberi nama |
