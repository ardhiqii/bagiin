#!/usr/bin/env bash
# Kembalikan tampilan ke build sebelumnya, lalu buktikan hasilnya.
#
#   bash scripts/rollback-web.sh                       # build terakhir sebelum ini
#   bash scripts/rollback-web.sh backups/dist-....tar.gz
#
# Yang dikembalikan hanya build frontend. DB TIDAK dikembalikan: transaksi yang
# sudah masuk tidak boleh hilang karena tampilan salah. Salinan DB dari setiap
# deploy ada di backups/db-<waktu>.db kalau memang perlu dipulihkan manual.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET=/var/www/bagiin
BACKUPS="$ROOT/backups"
BASE=https://bagiin.ardhiqi.com

ARCHIVE="${1:-}"
if [[ -z "$ARCHIVE" ]]; then
  # tarball terbaru, kecuali yang baru saja dibuat oleh rollback sebelumnya
  ARCHIVE="$(ls -1t "$BACKUPS"/dist-*.tar.gz 2>/dev/null | head -1 || true)"
fi
if [[ -z "$ARCHIVE" || ! -f "$ARCHIVE" ]]; then
  echo "GAGAL: tidak ada salinan build di $BACKUPS"
  echo "Deploy berikutnya akan membuatnya otomatis (scripts/deploy-web.sh)."
  exit 1
fi

echo "== pakai salinan: $ARCHIVE =="
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
tar xzf "$ARCHIVE" -C "$TMP"

SRC="$TMP/$(basename "$TARGET")"
if [[ ! -f "$SRC/index.html" ]]; then
  SRC="$(dirname "$(find "$TMP" -maxdepth 3 -name index.html | head -1)")"
fi
[[ -f "$SRC/index.html" ]] || { echo "GAGAL: salinan tidak berisi index.html"; exit 1; }

sudo rsync -a --delete "$SRC/" "$TARGET/"
sudo systemctl restart bagiin-api
sleep 2

echo "== bukti =="
fail=0
for pair in "/ text/html" "/manifest.webmanifest application/manifest+json" "/api/auth/config application/json" "/recap text/html"; do
  path="${pair%% *}"; want="${pair##* }"
  resp="$(curl -s -o /dev/null --max-time 15 -w '%{http_code}|%{content_type}' "$BASE$path")" || resp="000|"
  code="${resp%%|*}"; ctype="${resp#*|}"
  if [[ "$code" != "200" || "$ctype" != *"$want"* ]]; then
    echo "  GAGAL $path -> $code '$ctype'"; fail=1
  else
    echo "  ok    $path ($code)"
  fi
done
[ $fail -eq 0 ] || { echo "Rollback selesai tapi pemeriksaan gagal — periksa nginx."; exit 1; }
echo "rollback sah."
