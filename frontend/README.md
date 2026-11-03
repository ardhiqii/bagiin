# Bagiin — app

Aplikasi React yang benar-benar jalan, terhubung ke backend FastAPI.

```
npm install
npm run dev        # http://localhost:5199, proxy /api -> 127.0.0.1:8090
npm run build      # dist/
npm run e2e        # Playwright, 253 kasus
```

Dev/E2E memakai instance uji `bagiin-dev.service` (port 8090) dengan DB
`/var/lib/bagiin-dev/bagiin.db`. Jangan mengarahkan e2e ke 8096 — itu produksi.

Kalau perlu menjalankan backend sendiri tanpa layanan:

```
cd ../backend
BAGIIN_DB=/tmp/bagiin-e2e.db BAGIIN_UPLOAD_DIR=/tmp/bagiin-e2e-uploads \
  ./venv/bin/uvicorn main:app --host 127.0.0.1 --port 8090
```

Deploy dan rollback: `bash scripts/deploy-web.sh` / `bash scripts/rollback-web.sh`
(lengkapnya di `../docs/RUNBOOK-V1.md`). Tampilan produksi dilayani dari `/var/www/bagiin`.

Tidak ada lagi lab desain terpisah: `prototype/` sudah dihapus bersama frontend
vanilla. Bentuk, ilustrasi, dan komponen dikerjakan langsung di sini, dan
aturannya hidup di `../docs/DESIGN_SYSTEM.md`.
