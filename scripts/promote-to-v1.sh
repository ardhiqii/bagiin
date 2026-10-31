#!/usr/bin/env bash
# v1 penuh: satu UI (React), satu backend (8096), satu DB produksi.
#
# Aman dijalankan berulang. Pakai: sudo bash promote-to-v1.sh
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
PROD_CONF=/etc/nginx/sites-enabled/bagiin.ardhiqi.com.conf
BETA_CONF=/etc/nginx/sites-enabled/bagiin-react.ardhiqi.com.conf
V1_CONF="$HERE/nginx/bagiin.ardhiqi.com.v1.conf"
# Cadangan pra-v1 disimpan DI LUAR sites-enabled: nginx.conf memuat
# `include /etc/nginx/sites-enabled/*`, jadi berkas .pre-v1 di sana ikut
# dimuat dan bentrok server_name dengan konfigurasi yang aktif.
BACKUP_DIR=/etc/nginx/backups
mkdir -p "$BACKUP_DIR"
PROD_BAK="$BACKUP_DIR/bagiin.ardhiqi.com.conf.pre-v1"
BETA_BAK="$BACKUP_DIR/bagiin-react.ardhiqi.com.conf.pre-v1"

[ -f "$V1_CONF" ] || { echo "GAGAL: $V1_CONF tidak ada"; exit 1; }

# cadangan konfigurasi pra-v1 hanya dibuat sekali, jangan ditimpa
[ -f "$PROD_BAK" ] || cp "$PROD_CONF" "$PROD_BAK"
[ -f "$BETA_BAK" ] || cp "$BETA_CONF" "$BETA_BAK"

systemctl start bagiin-v1 2>/dev/null || true
systemctl is-active --quiet bagiin-v1 || { echo "GAGAL: bagiin-v1 tidak hidup"; exit 1; }

cp "$V1_CONF" "$PROD_CONF"
# domain beta: instance sandbox (8090/8094/8095) -> 8096
sed -i -E 's#proxy_pass http://127\.0\.0\.1:(8090|8094|8095);#proxy_pass http://127.0.0.1:8096;#' "$BETA_CONF"

nginx -t
systemctl reload nginx
sleep 1

code=$(curl -s -o /dev/null -w "%{http_code}" -m 10 https://bagiin.ardhiqi.com/api/auth/config || true)
ui=$(curl -s -m 10 https://bagiin.ardhiqi.com/ | grep -c '/assets/' || true)
echo "api/auth/config -> $code (harus 200)"
echo "penanda UI v1 di beranda: $ui (harus >= 1)"
