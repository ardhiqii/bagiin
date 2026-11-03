# Runbook: satu aplikasi, satu folder, satu DB

Sejak 2 Nov 2026 hanya ada satu aplikasi — versi 1 — dan satu folder kerja.
Versi vanilla (0.9) sudah pensiun: kodenya diarsipkan, layanannya dimatikan,
dan domainnya dialihkan. Catatan di bawah ini menggantikan runbook dua-jalur
yang lama.

## Topologi

| Apa | Di mana | Keterangan |
| --- | --- | --- |
| Kode | `/opt/projects/bagiin` | branch `main` (versi 1), satu-satunya checkout |
| DB produksi | `/var/lib/bagiin/bagiin.db` | di luar repo; satu-satunya sumber kebenaran |
| API produksi | `bagiin-api.service`, port **8096** | venv `backend/venv`, `BAGIIN_ENV=production` |
| UI produksi | `/var/www/bagiin` | dilayani nginx; `/api/` + `/uploads/` → 8096 |
| Uploads | `/var/www/bagiin-uploads` | dipakai hanya oleh produksi |
| API uji (e2e) | `bagiin-dev.service`, port **8090** | DB `/var/lib/bagiin-dev/bagiin.db` |
| Domain | `bagiin.ardhiqi.com` | satu-satunya; domain `bagiin-react` sudah dihapus |

Konfigurasi nginx yang berlaku disimpan di repo:
`scripts/nginx/bagiin.ardhiqi.com.v1.conf` dan `scripts/nginx/000-catch-all.conf`
(catch-all menutup Host yang tidak punya vhost, supaya domain lama tidak
diam-diam menampilkan produk). Jangan mengedit `/etc/nginx` langsung tanpa
menyalin perubahannya balik ke file itu.

**Sisa yang bukan urusan mesin ini:** record DNS `bagiin-react.ardhiqi.com`
masih ada di Cloudflare, dan origin-nya sudah tidak punya sertifikat, jadi
pengunjung melihat halaman error 526 — bukan aplikasi. Hapus record itu di
Cloudflare (DNS → Records) supaya domainnya mati total.

## Deploy

```bash
bash scripts/deploy-web.sh
```

Urutannya: build frontend → salin DB ke `backups/db-<waktu>.db` → tarball build
yang sekarang hidup ke `backups/dist-<waktu>.tar.gz` → rsync `dist/` →
**restart `bagiin-api`** (kode backend baru tidak pernah hidup sendiri) → lalu
membuktikan hasilnya lewat HTTP: `/` harus `text/html`,
`/manifest.webmanifest` harus `application/manifest+json`, `/api/auth/config`
harus `application/json`, dan `/recap` harus 200 (rute SPA jatuh ke
`index.html`).

Tanpa langkah pembuktian itu, nginx yang salah peta MIME pernah membuat seluruh
situs jadi unduhan sementara build, rsync, dan reload semuanya "sukses".

## Rollback deploy

```bash
bash scripts/rollback-web.sh                    # build sebelumnya
bash scripts/rollback-web.sh backups/dist-20261102-0915.tar.gz
```

Menyalin balik tarball build, me-restart API, lalu memeriksa ulang lewat HTTP.
DB tidak ikut dikembalikan: transaksi yang sudah masuk tidak boleh hilang
karena tampilan yang salah. Salinan DB dari setiap deploy ada di
`backups/db-<waktu>.db` kalau memang perlu dipulihkan manual — itu berarti
kehilangan transaksi setelah snapshot tersebut.

## Kalau perlu kembali ke 0.9 (darurat saja)

0.9 tidak lagi hidup di mesin ini. Untuk menghidupkannya lagi perlu tiga hal
yang semuanya disimpan di `/home/hermes/backups/bagiin-consolidation-<waktu>/`:

1. `bagiin-0.9.tar.gz` — kode + venv 0.9 apa adanya.
2. `bagiin-prod.db` — salinan DB saat konsolidasi.
3. `nginx-sites-enabled/` — konfigurasi nginx sebelum konsolidasi, plus
   `bagiin.service.txt` dan `bagiin-v1.service.txt` untuk unit systemd-nya.

Langkahnya: ekstrak tarball ke `/opt/projects/bagiin-0.9`, pasang kembali unit
`bagiin.service` (port 8082, DB produksi), kembalikan konfigurasi nginx lama,
reload. Skema v1 aditif, jadi DB v1 masih bisa dibaca 0.9 — tetapi transaksi
yang dibuat lewat UI v1 setelah konsolidasi hanya terlihat lagi kalau v1
dinaikkan kembali.

Rollback yang **wajar** dipakai sehari-hari adalah `rollback-web.sh` di atas,
bukan menghidupkan 0.9.

## Verifikasi cepat setelah apa pun berubah

```bash
systemctl is-active bagiin-api bagiin-dev
ss -tlnp | grep -E ':8096|:8090'
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' https://bagiin.ardhiqi.com/
curl -s -o /dev/null -w '%{http_code}\n' https://bagiin.ardhiqi.com/recap
curl -s -o /dev/null -w '%{http_code}\n' https://bagiin.ardhiqi.com/api/auth/config
journalctl -u bagiin-api -n 100 --no-pager | grep -i 'error\|traceback'
```

## Login Google hanya di domain yang terdaftar

OAuth client Google hanya mengizinkan origin yang terdaftar. Halaman di origin
lain ditolak (403 pada `accounts.google.com/gsi/button`) dan yang terlihat
pengguna cuma tombol mati. Karena itu `/api/auth/config` mengirim
`google_origins` dari env `BAGIIN_GOOGLE_ORIGINS`, dan frontend hanya merender
tombol Google kalau `location.hostname` ada di daftar itu (kosong = tanpa
batas, untuk pengembangan lokal).

Domain yang terdaftar: `https://bagiin.ardhiqi.com` dan `http://localhost:5199`.
`https://bagiin-react.ardhiqi.com` masih tercatat di Google Console tapi
situsnya sudah tidak ada; kalau sempat, hapus dari daftar itu juga.

Kalau nanti ada domain baru:

1. Google Cloud Console → APIs & Services → Credentials → OAuth client
   `9976223407401-…apps.googleusercontent.com` (Web application).
2. **Authorized JavaScript origins** → tambahkan `https://<domain-baru>`.
3. Save, tunggu beberapa menit.
4. Tambahkan domain itu ke `BAGIIN_GOOGLE_ORIGINS` di
   `/etc/systemd/system/bagiin-api.service`, lalu
   `sudo systemctl daemon-reload && sudo systemctl restart bagiin-api`.

## Catatan

- Venv v1 sekarang milik sendiri: `/opt/projects/bagiin/backend/venv`
  (Python 3.14). Sebelumnya produksi meminjam venv 0.9 — itu sebabnya dulu
  folder 0.9 tidak boleh disentuh sama sekali.
- Rate limit produksi 10/menit per IP untuk bill/akun/upload, bawaan kode.
  Instance uji memakai 60/menit lewat `bagiin-dev.service`.
- `BAGIIN_GOOGLE_STUB=0` dan `BAGIIN_ENV=production` di produksi; instance uji
  memakai stub supaya e2e tidak butuh kredensial Google.
- Dua domain yang dulu menyajikan aplikasi yang sama sekarang satu: domain beta
  301 ke domain utama, jadi tautan bill lama tetap sampai ke bill yang benar.
