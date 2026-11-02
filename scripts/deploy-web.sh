#!/usr/bin/env bash
# Deploy build React ke https://bagiin.ardhiqi.com lalu BUKTIKAN hasilnya.
#
# Kenapa ada skrip, bukan dua perintah yang dihafal: sekali `nginx` salah peta
# MIME, seluruh situs berubah jadi unduhan dan tidak ada yang gagal — build
# sukses, reload sukses, rsync sukses. Satu-satunya yang tahu bedanya adalah
# permintaan HTTP sesudah deploy. Jadi deploy di sini dianggap gagal kalau
# status atau content-type salah.
#
# Sebelum menimpa apa pun, skrip menyimpan dua salinan: build yang sedang hidup
# dan DB produksi. Tanpa itu "rollback" cuma niat.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET=/var/www/bagiin
DB=/var/lib/bagiin/bagiin.db
BACKUPS="$ROOT/backups"
BASE=https://bagiin.ardhiqi.com
STAMP="$(date +%Y%m%d-%H%M%S)"

mkdir -p "$BACKUPS"

echo "== build =="
cd "$ROOT/frontend"
npm run build

echo "== salinan sebelum menimpa =="
if [ -d "$TARGET" ]; then
  tar czf "$BACKUPS/dist-$STAMP.tar.gz" -C "$(dirname "$TARGET")" "$(basename "$TARGET")"
  echo "   build lama  -> $BACKUPS/dist-$STAMP.tar.gz"
fi
if [ -f "$DB" ]; then
  cp "$DB" "$BACKUPS/db-$STAMP.db"
  echo "   DB          -> $BACKUPS/db-$STAMP.db"
fi

echo "== salin ke $TARGET =="
sudo rsync -a --delete dist/ "$TARGET/"

# Backend WAJIB ikut di-restart, walaupun deploy ini cuma soal tampilan.
# Pernah terjadi: frontend baru sudah live, endpoint baru masih 404 karena
# proses uvicorn menjalankan kode lama -- "deploy sah" tapi fiturnya tidak ada.
echo "== restart API produksi (kode lama tidak hilang sendiri) =="
sudo systemctl restart bagiin-api

code="000"
for _ in $(seq 1 20); do
  code="$(curl -s -o /dev/null -m 3 -w '%{http_code}' http://127.0.0.1:8096/api/auth/config || true)"
  [[ "$code" == "200" ]] && break
  sleep 1
done
if [[ "$code" != "200" ]]; then
  echo "  GAGAL API tidak menjawab 200 setelah restart (HTTP $code)"
  journalctl -u bagiin-api -n 30 --no-pager || true
  echo "  Batalkan dengan: bash scripts/rollback-web.sh $BACKUPS/dist-$STAMP.tar.gz"
  exit 1
fi
echo "  ok    API hidup"

echo "== bukti sesudah deploy =="
fail=0
check() { # path, harapan content-type (substring)
  local path="$1" want="$2" code ctype resp
  resp="$(curl -s -o /dev/null --max-time 15 -w '%{http_code}|%{content_type}' "$BASE$path")" || resp="000|"
  code="${resp%%|*}"
  ctype="${resp#*|}"
  if [[ "$code" != "200" ]]; then
    echo "  GAGAL $path -> HTTP $code"; fail=1; return
  fi
  if [[ "$ctype" != *"$want"* ]]; then
    echo "  GAGAL $path -> content-type '$ctype' (harus mengandung '$want')"; fail=1; return
  fi
  echo "  ok    $path ($code, $ctype)"
}

check "/" "text/html"
check "/manifest.webmanifest" "application/manifest+json"
check "/favicon.svg" "image/svg+xml"
check "/og-cover.png" "image/png"
check "/api/auth/config" "application/json"

# SPA: rute dalam harus tetap index.html, bukan 404.
spa="$(curl -s -o /dev/null --max-time 15 -w '%{http_code}' "$BASE/recap")"
if [[ "$spa" != "200" ]]; then
  echo "  GAGAL /recap -> HTTP $spa (rute SPA tidak jatuh ke index.html)"; fail=1
else
  echo "  ok    /recap ($spa)"
fi

if [[ $fail -ne 0 ]]; then
  echo
  echo "DEPLOY TIDAK SAH: ada yang menjawab dengan tipe/status salah."
  echo "Kalau '/' bukan text/html, hampir pasti peta MIME nginx rusak"
  echo "(blok 'types {}' di level server mengganti seluruh peta bawaan)."
  echo "Batalkan dengan: bash scripts/rollback-web.sh $BACKUPS/dist-$STAMP.tar.gz"
  exit 1
fi

echo
echo "deploy sah. Salinan sebelumnya: backups/dist-$STAMP.tar.gz"
