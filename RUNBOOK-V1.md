# Runbook: satu DB, dua UI

Sejak 31 Okt 2026 produksi memakai **satu database dan satu backend v1**, dengan
dua antarmuka. User lama tidak melihat perubahan apa pun; UI baru ada di domain
beta.

| Apa | Di mana | Keterangan |
| --- | --- | --- |
| DB produksi | `/opt/projects/bagiin/backend/bagiin.db` | satu-satunya sumber kebenaran |
| Backend v1 (penulis) | `bagiin-v1.service`, port **8096** | kode branch `react`, rute 0.9 + 12 rute akun |
| Backend 0.9 (baca saja) | `bagiin.service`, port **8082** | hanya melayani **file statis** UI 0.9 |
| UI 0.9 | `https://bagiin.ardhiqi.com` | nginx: `/` → 8082, `/api/` + `/uploads/` → 8096 |
| UI 1.0 | `https://bagiin-react.ardhiqi.com` | nginx menyajikan `/var/www/bagiin-react`, `/api/` + `/uploads/` → 8096 |

Kunci desainnya: **satu proses yang menulis**. nginx tidak pernah mengirim `/api/`
ke 8082, jadi backend 0.9 cuma jadi server file. Dua penulis ke satu file SQLite
adalah cara tercepat bikin data pecah.

## Rollback ke 0.9

```bash
sudo bash /opt/projects/bagiin-react/scripts/rollback-to-09.sh
```

Yang dilakukan: mengembalikan dua file nginx dari `*.conf.pre-v1` (API kembali ke
8082, domain beta kembali ke instance sandbox 8090), lalu reload nginx dan
memastikan `bagiin.service` hidup. Butuh hitungan detik; tidak ada deploy.

**DB tidak dikembalikan dan tidak perlu dimigrasi ulang.** Migrasi v1 aditif —
kolom baru nullable, tiga tabel baru tidak dipakai 0.9 — dan backend 0.9 sudah
diuji membaca DB hasil migrasi (data, jumlah baris, dan pembuatan bill baru
normal). Jadi rollback hanya memindahkan *siapa yang menjawab `/api/`*.

Bukti rollback bekerja: `curl -s -o /dev/null -w "%{http_code}"
https://bagiin.ardhiqi.com/api/auth/config` → **404** (rute akun tidak ada di 0.9).
Maju lagi: **200**.

## Maju lagi ke v1

```bash
sudo bash /opt/projects/bagiin-react/scripts/promote-to-v1.sh
```

Idempoten: menyimpan `*.conf.pre-v1` kalau belum ada, memastikan `bagiin-v1`
hidup, mengarahkan `/api/` + `/uploads/` ke 8096, reload, lalu memverifikasi
`/api/auth/config` = 200.

## Aturan selama dua UI hidup

1. **API hanya boleh nambah, jangan ubah bentuk respons lama.** UI 0.9 yang
   sudah dibekukan membaca respons yang sama; kolom baru aman, kolom yang hilang
   atau berubah tipe tidak.
2. **Build UI 0.9 dibekukan.** Jangan `deploy` ulang dari `main` ke
   `/var/www`/8082 tanpa alasan — user asli langsung kena.
3. **Jangan pernah mengarahkan `/api/` ke 8082 selama v1 yang menulis.** Dua
   backend menulis satu file SQLite = lock contention dan dua versi aturan
   membaca baris yang sama.
4. **Angka duit tidak boleh diubah tanpa sadar.** Perubahan pada `db.py` bagian
   hitungan langsung berlaku untuk semua user (0.9 dan 1.0), karena mesinnya
   satu. Mesin hitung 0.9 vs v1 saat ini **identik** — diff `db.py` hanya
   `init_db`, `new_identity`, `get_contacts`.

## Kalau ada yang salah

```bash
systemctl status bagiin-v1 bagiin.service
journalctl -u bagiin-v1 -n 100 --no-pager | grep -i 'error\|traceback'
sudo bash /opt/projects/bagiin-react/scripts/rollback-to-09.sh   # balik 0.9
```

Cadangan DB sebelum migrasi: `/opt/projects/bagiin/backend/bagiin.db.bak-v1-20261031`
(md5 `cf3830…`, skema 0.9, 10 tabel). Sandbox lama:
`/var/lib/bagiin-sandbox/bagiin.db.bak-20261031`.

Memulihkan cadangan itu berarti **kehilangan semua transaksi setelah
2026-10-31 13:56** — pakai hanya kalau rollback nginx tidak cukup.

## Catatan yang masih menggantung

- `bagiin-v1` masih meminjam venv 0.9 (`/opt/projects/bagiin/backend/venv`).
  Aman selama `requirements.txt` v1 belum menambah paket baru; kalau nanti
  menambah, bikin venv sendiri dulu.
- Rate limit disetel **10/menit per IP** (sama dengan 0.9), bukan 60 seperti di
  `.env` uji.
- `BAGIIN_GOOGLE_STUB=0` dan `BAGIIN_ENV=production`: login Google memakai
  verifikasi sungguhan. Tamu dan username/password tidak terpengaruh.
- Instance sandbox 8090 dimatikan. Site beta sekarang memakai **data
  produksi**, jadi semua yang dibuat di UI baru benar-benar masuk DB produksi.
