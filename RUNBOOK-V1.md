# Runbook: v1 penuh (satu UI, satu backend, satu DB)

Sejak 31 Okt 2026 **semua trafik produksi** dilayani v1. Rollback ke v0.9
tersedia sebagai skrip satu perintah, bukan sebagai jalur harian.

| Apa | Di mana | Keterangan |
| --- | --- | --- |
| DB produksi | `/opt/projects/bagiin/backend/bagiin.db` | satu-satunya sumber kebenaran, skema v1 |
| Backend v1 (penulis) | `bagiin-v1.service`, port **8096** | kode branch `react` |
| UI v1 | `/var/www/bagiin-react`, disajikan nginx | `/api/` + `/uploads/` → 8096, sisanya `index.html` |
| Domain | `bagiin.ardhiqi.com` (utama), `bagiin-react.ardhiqi.com` | dua-duanya v1 |
| Backend 0.9 (siaga) | `bagiin.service`, port **8082** | tidak menerima trafik; target rollback |
| Backend sandbox (mati) | `bagiin-react-api.service`, port 8090 | DB sandbox sudah tidak dipakai |

Konfigurasi nginx v1 yang berlaku disimpan di repo:
`scripts/nginx/bagiin.ardhiqi.com.v1.conf`. Jangan mengedit `/etc/nginx`
langsung tanpa menyalin perubahannya balik ke file itu.

## Rollback ke 0.9

```bash
sudo bash /opt/projects/bagiin-react/scripts/rollback-to-09.sh
```

Mengembalikan dua file nginx dari `*.conf.pre-v1` (bagiin.ardhiqi.com → UI 0.9 +
API 8082, domain beta → UI React + API sandbox 8090), reload, lalu menyalakan
`bagiin.service`. Hitungan detik; tidak ada deploy.

**DB tidak dikembalikan dan tidak perlu dimigrasi ulang.** Migrasi v1 aditif —
kolom baru nullable, tiga tabel baru tidak dipakai 0.9 — dan backend 0.9 sudah
diuji membaca DB hasil migrasi (baca data, jumlah baris, dan menulis bill baru
normal). Rollback hanya memindahkan *siapa yang menjawab permintaan*.

Bukti yang dicetak skrip:

- `penanda UI 0.9 di beranda: 1` — beranda memuat `/static/app.js` (build 0.9)
- `api/auth/config: 404` — rute akun tidak ada di 0.9

## Maju lagi ke v1

```bash
sudo bash /opt/projects/bagiin-react/scripts/promote-to-v1.sh
```

Idempoten: cadangan `*.conf.pre-v1` dibuat sekali dan tidak pernah ditimpa,
memastikan `bagiin-v1` hidup, memasang konfigurasi v1, reload, lalu memverifikasi
`api/auth/config = 200` dan beranda memuat `/assets/` (build v1).

## Kenapa DB-nya DB produksi, bukan DB branch

DB branch (`/var/lib/bagiin-sandbox/bagiin.db`) adalah **salinan** DB produksi
yang dibuat 31 Okt pagi lalu dipakai untuk pengujian. Setelah diperiksa, seluruh
isinya yang tidak ada di produksi adalah artefak uji Playwright: 10 bill
("Piutang 842754", "Utang 842754", "Bima Nalangin 842754", …) dan 14 identitas
uji ("Aufa Saldo 842754", "Tamu Piutang 842754", …).

Memakai DB branch berarti membuang transaksi nyata yang masuk setelah salinan
itu dibuat. Jadi yang dipakai adalah DB produksi sendiri, dimigrasi di tempat.
Salinan sandbox disimpan sebagai `bagiin.db.bak-20261031` kalau masih perlu
dilihat, dan tidak lagi dilayani siapa pun.

## Aturan selama v0.9 masih bisa dihidupkan

1. **Skema hanya boleh nambah.** Kolom/tabel baru aman; menghapus atau mengubah
   tipe kolom lama membuat rollback tidak bisa membaca DB.
2. **Angka duit tidak boleh berubah tanpa sadar.** Mesin hitung 0.9 dan v1
   identik saat cutover; perubahan di `db.py` bagian hitungan langsung berlaku
   untuk semua user.
3. Rollback hanya untuk keadaan darurat. Kalau dipakai, catat waktunya: setiap
   bill yang dibuat lewat UI v1 setelah itu tetap ada di DB, tapi user 0.9 tidak
   akan melihat fitur akun (username/password, perangkat, alias kontak).

## Kalau ada yang salah

```bash
systemctl status bagiin-v1 bagiin.service
journalctl -u bagiin-v1 -n 100 --no-pager | grep -i 'error\|traceback'
sudo bash /opt/projects/bagiin-react/scripts/rollback-to-09.sh
```

Cadangan DB sebelum migrasi: `/opt/projects/bagiin/backend/bagiin.db.bak-v1-20261031`
(md5 `cf3830…`, skema 0.9, 10 tabel). Memulihkannya berarti kehilangan semua
transaksi setelah 2026-10-31 13:56 — pakai hanya kalau rollback nginx tidak cukup.

## Catatan yang masih menggantung

- `bagiin-v1` masih meminjam venv 0.9 (`/opt/projects/bagiin/backend/venv`).
  Aman selama `requirements.txt` v1 belum menambah paket baru.
- Rate limit 10/menit per IP (parity dengan 0.9), bukan 60 seperti di `.env` uji.
- `BAGIIN_GOOGLE_STUB=0`, `BAGIIN_ENV=production`: login Google memakai
  verifikasi sungguhan.
- Dua domain masih menyajikan aplikasi yang sama. Kalau mau, domain beta bisa
  dijadikan redirect 301 ke domain utama supaya bookmark lama tidak bingung.
