# Bagiin — app

Aplikasi React yang benar-benar jalan, terhubung ke backend FastAPI.

```
npm install
npm run dev        # http://localhost:5199, proxy /api -> 127.0.0.1:8090
npm run build      # dist/
npm run e2e        # Playwright, 20 kasus perilaku
```

Backend lokal untuk dev/E2E (DB terpisah, jangan pakai DB produksi):

```
cd ../bagiin/backend
BAGIIN_DB=/tmp/bagiin-e2e.db BAGIIN_UPLOAD_DIR=/tmp/bagiin-e2e-uploads \
  ./venv/bin/uvicorn main:app --host 127.0.0.1 --port 8090
```

Deploy: `rsync dist/ /var/www/bagiin-react/`; nginx host itu meneruskan `/api/`
ke instance 8090 supaya preview ini punya data sendiri.

`../prototype/` adalah lab desain (bukan aplikasi) — dipakai untuk mencoba
bentuk, ilustrasi, dan komponen sebelum masuk ke sini.
