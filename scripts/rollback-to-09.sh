#!/usr/bin/env bash
# Balik ke v0.9 (UI + API) dalam hitungan detik.
#
# Sejak v1 penuh, kedua domain dilayani build React + backend 8096. Skrip ini
# mengembalikan konfigurasi nginx yang disimpan sebelum cutover:
#   - bagiin.ardhiqi.com : UI 0.9 + API 0.9 (8082)
#   - bagiin-react...    : UI React + API sandbox (8090)
#
# DB TIDAK diubah, tidak dikembalikan, tidak perlu dimigrasi ulang: migrasi 1.0
# aditif (kolom nullable + tabel baru) dan backend 0.9 terbukti membaca DB hasil
# migrasi. Kode 0.9 tidak tahu kolom/tabel itu ada.
#
# Pakai: sudo bash rollback-to-09.sh
set -euo pipefail

PROD_CONF=/etc/nginx/sites-enabled/bagiin.ardhiqi.com.conf
BETA_CONF=/etc/nginx/sites-enabled/bagiin-react.ardhiqi.com.conf

for f in "$PROD_CONF.pre-v1" "$BETA_CONF.pre-v1"; do
  [ -f "$f" ] || { echo "GAGAL: cadangan $f tidak ada - jangan lanjut, cek manual"; exit 1; }
done

cp "$PROD_CONF.pre-v1" "$PROD_CONF"
cp "$BETA_CONF.pre-v1" "$BETA_CONF"

nginx -t
systemctl reload nginx
systemctl start bagiin.service
systemctl start bagiin-react-api 2>/dev/null || true
sleep 2

# UI 0.9 menandai dirinya dengan /static/app.js; v1 memakai /assets/
ui=$(curl -s -m 10 https://bagiin.ardhiqi.com/ | grep -c 'static/app.js' || true)
api=$(curl -s -o /dev/null -w "%{http_code}" -m 10 https://bagiin.ardhiqi.com/api/auth/config || true)
echo "penanda UI 0.9 di beranda: $ui (harus >= 1)"
echo "api/auth/config: $api (harus 404 - rute akun tidak ada di 0.9)"
echo "sekarang dilayani backend 0.9 (main). DB produksi tidak disentuh."
