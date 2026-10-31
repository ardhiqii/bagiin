#!/usr/bin/env bash
# Balik ke v0.9 dalam hitungan detik.
#
# Yang berubah cuma dua file nginx: /api/ dan /uploads/ diarahkan balik ke
# backend 0.9 (8082), dan domain beta balik ke instance sandbox 8090.
#
# DB TIDAK diubah, tidak dikembalikan, dan tidak perlu dimigrasi ulang: migrasi
# 1.0 aditif (kolom nullable + tabel baru), dan backend 0.9 sudah terbukti
# membaca DB hasil migrasi. Kode 0.9 tidak tahu kolom/tabel itu ada.
#
# Pakai: sudo bash rollback-to-09.sh
set -euo pipefail

PROD_CONF=/etc/nginx/sites-enabled/bagiin.ardhiqi.com.conf
BETA_CONF=/etc/nginx/sites-enabled/bagiin-react.ardhiqi.com.conf

for f in "$PROD_CONF.pre-v1" "$BETA_CONF.pre-v1"; do
  [ -f "$f" ] || { echo "GAGAL: cadangan $f tidak ada — jangan lanjut, cek manual"; exit 1; }
done

cp "$PROD_CONF.pre-v1" "$PROD_CONF"
cp "$BETA_CONF.pre-v1" "$BETA_CONF"

nginx -t
systemctl reload nginx
systemctl start bagiin.service
sleep 2

code=$(curl -s -o /dev/null -w "%{http_code}" -m 10 http://127.0.0.1:8082/api/bills/x || true)
echo "backend 0.9 /api/bills/x -> $code (harus 404)"
echo "sekarang dilayani backend 0.9 (main). DB produksi tidak disentuh."
