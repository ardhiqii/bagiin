#!/usr/bin/env bash
# Deploy versi 1.0 ke https://bagiin-react.ardhiqi.com lalu BUKTIKAN hasilnya.
#
# Kenapa ada skrip, bukan dua perintah yang dihafal: sekali `nginx` salah peta
# MIME, seluruh situs berubah jadi unduhan dan tidak ada yang gagal — build sukses,
# reload sukses, rsync sukses. Satu-satunya yang tahu bedanya adalah permintaan
# HTTP sesudah deploy. Jadi deploy di sini dianggap gagal kalau content-type salah.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="/var/www/bagiin-react"
BASE="https://bagiin-react.ardhiqi.com"

cd "$ROOT/frontend"
echo "== build =="
npm run build

echo "== salin ke $TARGET =="
sudo rsync -a --delete dist/ "$TARGET/"
sudo systemctl reload nginx

# Backend WAJIB ikut di-restart, walaupun deploy ini cuma soal tampilan.
# Pernah terjadi: frontend baru sudah live, endpoint baru masih 404 karena
# proses uvicorn menjalankan kode lama -- "deploy sah" tapi fiturnya tidak ada.
# Restart satu worker ini makan ~1 detik, jauh lebih murah daripada satu jam
# mencari bug yang sebenarnya cuma proses basi.
echo "== restart backend v1 (kode lama tidak hilang sendiri) =="
sudo systemctl restart bagiin-v1
code="000"
for _ in $(seq 1 20); do
  code="$(curl -s -o /dev/null -m 3 -w '%{http_code}' http://127.0.0.1:8096/api/auth/config || true)"
  [[ "$code" == "200" ]] && break
  sleep 1
done
if [[ "$code" != "200" ]]; then
  echo "  GAGAL backend tidak menjawab 200 setelah restart (HTTP $code)"
  journalctl -u bagiin-v1 -n 20 --no-pager || true
  exit 1
fi
echo "  ok    backend v1 hidup"

echo "== bukti sesudah deploy =="
fail=0
check() { # path, harapan content-type (substring), boleh 404?
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
check "/icon-512.png" "image/png"
check "/api/auth/config" "application/json"

if [[ $fail -ne 0 ]]; then
  echo
  echo "DEPLOY TIDAK SAH: ada yang menjawab dengan tipe/status salah."
  echo "Kalau '/' bukan text/html, hampir pasti peta MIME nginx rusak"
  echo "(blok 'types {}' di level server mengganti seluruh peta bawaan)."
  exit 1
fi
echo "deploy sah."
