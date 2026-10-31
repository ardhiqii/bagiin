#!/usr/bin/env bash
# Maju ke v1: semua /api/ dan /uploads/ dilayani backend 1.0 (port 8096) yang
# memakai DB produksi. UI 0.9 tetap disajikan backend 0.9 di 8082 (file statis
# saja), UI 1.0 dilayani nginx dari /var/www/bagiin-react.
#
# Aman dijalankan berulang. Pakai: sudo bash promote-to-v1.sh
set -euo pipefail

PROD_CONF=/etc/nginx/sites-enabled/bagiin.ardhiqi.com.conf
BETA_CONF=/etc/nginx/sites-enabled/bagiin-react.ardhiqi.com.conf

[ -f "$PROD_CONF.pre-v1" ] || cp "$PROD_CONF" "$PROD_CONF.pre-v1"
[ -f "$BETA_CONF.pre-v1" ] || cp "$BETA_CONF" "$BETA_CONF.pre-v1"

systemctl start bagiin-v1 2>/dev/null || true
systemctl is-active --quiet bagiin-v1 || { echo "GAGAL: bagiin-v1 tidak hidup"; exit 1; }

# /api/ + /uploads/ ke 8096, sisanya (UI 0.9) tetap ke 8082
sed -i -E '/location \/uploads\//,/^    }/ s|proxy_pass http://127\.0\.0\.1:808[0-9];|proxy_pass http://127.0.0.1:8096;|' "$PROD_CONF"
sed -i -E '/location \/api\//,/^    }/ s|proxy_pass http://127\.0\.0\.1:808[0-9];|proxy_pass http://127.0.0.1:8096;|' "$PROD_CONF"
# domain beta: instance sandbox (8090/8094/8095) -> 8096
sed -i -E 's#proxy_pass http://127\.0\.0\.1:(8090|8094|8095);#proxy_pass http://127.0.0.1:8096;#' "$BETA_CONF"

nginx -t
systemctl reload nginx
sleep 1

code=$(curl -s -o /dev/null -w "%{http_code}" -m 10 https://bagiin.ardhiqi.com/api/auth/config || true)
echo "bagiin.ardhiqi.com /api/auth/config -> $code (harus 200: rute akun hanya ada di 1.0)"
