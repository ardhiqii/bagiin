"""Bagiin - Gemini OCR service (free tier, gemini-3.5-flash)."""
import base64
import json
import logging
import os
import time
import urllib.error
import urllib.request

log = logging.getLogger("bagiin.ocr")

MODEL = os.environ.get("BAGIIN_OCR_MODEL", "gemini-3.5-flash")
API_KEY = os.environ.get("GEMINI_API_KEY", "")
MAX_ATTEMPTS = 3
RETRY_CODES = (429, 500, 502, 503, 504)

SYSTEM_PROMPT = """Kamu membaca struk belanja/makanan Indonesia. Output JSON EXACTLY:
{"merchant":"nama tempat makan/toko","date":"YYYY-MM-DD","items":[{"name":"nama item","price":harga,"discount":diskon}],"subtotal":N,"tax":N,"service":N,"total":N,"tax_included":true/false}
Rules:
- merchant = nama tempat makan/toko yang tertera di struk (header paling atas), contoh "Kitchen & Dimsum"; kosongkan string kalau tidak ada
- date = tanggal transaksi yang tertera di struk, dalam format YYYY-MM-DD (misal struk tulis 8/8/26 -> "2026-08-08"); kalau hanya ada tanggal tanpa tahun, asumsikan tahun berjalan; kosongkan kalau tidak ada
- price dalam Rupiah integer (tanpa 'Rp', tanpa titik) = harga SEBELUM diskon (harga menu)
- discount = potongan harga item dalam Rupiah integer (0 kalau tidak ada). Struk sering mencetak baris diskon di bawah item, contoh "CLR-4ProdDis349" lalu "-5.500" — gabungkan diskon itu ke item yang tepat di atasnya sebagai discount. Kalau struk tidak mencetak diskon, discount = 0
- tax = PPN/PB1, service = service charge/SC (0 kalau tidak ada)
- tax_included = true kalau struk menyebut harga sudah termasuk pajak (misal tulisan "termasuk PAJAK", "trmasuk pajak", "harga sudah termasuk pajak", "tax included", "Tax Invoice"). Kalau true: subtotal = total yang dibayar, tax = 0, service = 0 (harga item sudah termasuk pajak). Kalau false: subtotal = jumlah sebelum pajak, tax = PPN/PB1, service = SC
- subtotal = jumlah sebelum pajak (setelah diskon); total = yang dibayar
- Jangan menebak item yang tidak jelas; nama sesingkat mungkin tapi tetap terbaca
- Kalau struk tidak terbaca sama sekali, output: {"merchant":"","date":"","items":[],"subtotal":0,"tax":0,"service":0,"total":0,"tax_included":false}"""


def ocr_receipt(image_bytes: bytes, mime_type: str = "image/jpeg") -> dict:
    """Send image to Gemini, return structured receipt dict."""
    if not API_KEY:
        raise RuntimeError("GEMINI_API_KEY not set")
    b64 = base64.b64encode(image_bytes).decode()
    payload = {
        "contents": [
            {
                "parts": [
                    {"inline_data": {"mime_type": mime_type, "data": b64}},
                    {"text": SYSTEM_PROMPT},
                ]
            }
        ],
        "generationConfig": {
            "temperature": 0.1,
            "responseMimeType": "application/json",
        },
    }
    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}"
        f":generateContent?key={API_KEY}"
    )
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
    )
    data = None
    for attempt in range(MAX_ATTEMPTS):
        try:
            resp = urllib.request.urlopen(req, timeout=60)
            data = json.loads(resp.read())
            break
        except urllib.error.HTTPError as e:
            code = e.code
            body = e.read().decode()[:300]
            log.warning("Gemini HTTP %d (attempt %d/%d): %s", code, attempt + 1, MAX_ATTEMPTS, body)
            if code == 429 and "quota" in body.lower():
                raise RuntimeError(
                    "Kuota harian AI gratis (Gemini) habis. Reset tengah malam, "
                    "atau isi manual aja sekarang."
                )
            if code in RETRY_CODES and attempt < MAX_ATTEMPTS - 1:
                time.sleep(2 * (attempt + 1))
                continue
            raise RuntimeError(f"Gemini HTTP {code}: {body}")
        except Exception as e:
            log.warning("Gemini request gagal (attempt %d/%d): %s", attempt + 1, MAX_ATTEMPTS, e)
            if attempt < MAX_ATTEMPTS - 1:
                time.sleep(2 * (attempt + 1))
                continue
            raise RuntimeError(f"Gemini request gagal: {e}")
    if data is None:
        raise RuntimeError("Gemini gagal setelah beberapa percobaan")

    try:
        text = data["candidates"][0]["content"]["parts"][0]["text"]
        parsed = json.loads(text)
    except Exception:
        raise RuntimeError("Gemini returned unparseable response")

    # normalize
    items = []
    for it in parsed.get("items", []):
        try:
            price = int(str(it.get("price", "0")).replace(".", "").replace("Rp", "").strip())
        except Exception:
            price = 0
        try:
            discount = int(str(it.get("discount", "0")).replace(".", "").replace("Rp", "").replace("-", "").strip())
        except Exception:
            discount = 0
        if discount < 0 or discount > price:
            discount = 0
        name = str(it.get("name", "")).strip()
        if name and price >= 0:
            items.append({"name": name, "price": price, "discount": discount})
    return {
        "merchant": str(parsed.get("merchant", "") or "").strip(),
        "date": str(parsed.get("date", "") or "").strip(),
        "items": items,
        "subtotal": _to_int(parsed.get("subtotal")),
        "tax": _to_int(parsed.get("tax")),
        "service": _to_int(parsed.get("service")),
        "total": _to_int(parsed.get("total")),
        "tax_included": bool(parsed.get("tax_included")),
    }


def _to_int(v) -> int:
    try:
        return int(str(v).replace(".", "").replace("Rp", "").strip())
    except Exception:
        return 0
