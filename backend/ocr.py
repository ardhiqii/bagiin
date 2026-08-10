"""Bagiin - OCR service: Gemini free tier primary, OpenRouter free vision fallback."""
import base64
import io
import json
import logging
import os
import re
import time
import urllib.error
import urllib.request

log = logging.getLogger("bagiin.ocr")

GEMINI_MODEL = os.environ.get("BAGIIN_OCR_MODEL", "gemini-3.5-flash")
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
OR_API_KEY = os.environ.get("OPENROUTER_API_KEY", "")
OR_MODEL = os.environ.get("OPENROUTER_OCR_MODEL", "google/gemma-4-26b-a4b-it:free")
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
    """OCR via Gemini; kalau Gemini gagal (quota/error), fallback ke OpenRouter gratis."""
    errors = []
    if GEMINI_API_KEY:
        try:
            return _gemini_ocr(image_bytes, mime_type)
        except RuntimeError as e:
            errors.append(f"Gemini: {e}")
            log.warning("Gemini OCR gagal, coba OpenRouter: %s", e)
    else:
        errors.append("Gemini: GEMINI_API_KEY not set")

    if OR_API_KEY:
        try:
            return _openrouter_ocr(image_bytes)
        except RuntimeError as e:
            errors.append(f"cadangan: {e}")
    else:
        errors.append("cadangan: OPENROUTER_API_KEY not set")

    raise RuntimeError(
        "AI gratis lagi penuh (" + "; ".join(errors) + "). Coba lagi beberapa menit "
        "atau isi manual aja."
    )


def _gemini_ocr(image_bytes: bytes, mime_type: str) -> dict:
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
        f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}"
        f":generateContent?key={GEMINI_API_KEY}"
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
                raise RuntimeError("kuota harian habis (reset tengah malam)")
            if code in RETRY_CODES and attempt < MAX_ATTEMPTS - 1:
                time.sleep(2 * (attempt + 1))
                continue
            raise RuntimeError(f"HTTP {code}: {body}")
        except Exception as e:
            log.warning("Gemini request gagal (attempt %d/%d): %s", attempt + 1, MAX_ATTEMPTS, e)
            if attempt < MAX_ATTEMPTS - 1:
                time.sleep(2 * (attempt + 1))
                continue
            raise RuntimeError(f"request gagal: {e}")
    if data is None:
        raise RuntimeError("gagal setelah beberapa percobaan")

    try:
        text = data["candidates"][0]["content"]["parts"][0]["text"]
        parsed = _parse_json_text(text)
    except Exception:
        raise RuntimeError("respons tidak bisa dibaca")
    return _normalize(parsed)


def _openrouter_ocr(image_bytes: bytes) -> dict:
    b64 = base64.b64encode(_downscale(image_bytes)).decode()
    payload = {
        "model": OR_MODEL,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "text", "text": SYSTEM_PROMPT},
                {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
            ],
        }],
        "temperature": 0.1,
    }
    req = urllib.request.Request(
        "https://openrouter.ai/api/v1/chat/completions",
        data=json.dumps(payload).encode(),
        headers={
            "Authorization": f"Bearer {OR_API_KEY}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://bagiin.ardhiqi.com",
            "X-Title": "Bagiin",
        },
    )
    data = None
    for attempt in range(MAX_ATTEMPTS):
        try:
            resp = urllib.request.urlopen(req, timeout=90)
            data = json.loads(resp.read())
            break
        except urllib.error.HTTPError as e:
            code = e.code
            body = e.read().decode()[:300]
            log.warning("OpenRouter HTTP %d (attempt %d/%d): %s", code, attempt + 1, MAX_ATTEMPTS, body)
            if code == 429 and "quota" in body.lower():
                raise RuntimeError("kuota harian OpenRouter habis")
            if code in RETRY_CODES and attempt < MAX_ATTEMPTS - 1:
                time.sleep(3 * (attempt + 1))
                continue
            raise RuntimeError(f"HTTP {code}: {body}")
        except Exception as e:
            log.warning("OpenRouter request gagal (attempt %d/%d): %s", attempt + 1, MAX_ATTEMPTS, e)
            if attempt < MAX_ATTEMPTS - 1:
                time.sleep(3 * (attempt + 1))
                continue
            raise RuntimeError(f"request gagal: {e}")
    if data is None:
        raise RuntimeError("gagal setelah beberapa percobaan")

    try:
        content = data["choices"][0]["message"]["content"]
        if isinstance(content, list):
            content = "".join(
                c.get("text", "") for c in content if isinstance(c, dict)
            )
        parsed = _parse_json_text(content)
    except Exception:
        raise RuntimeError("respons tidak bisa dibaca")
    return _normalize(parsed)


def _downscale(image_bytes: bytes, max_side: int = 1280) -> bytes:
    """Kecilin gambar biar request lebih cepat & gak ditolak model gratis."""
    try:
        from PIL import Image
    except ImportError:
        return image_bytes
    try:
        img = Image.open(io.BytesIO(image_bytes))
        img.thumbnail((max_side, max_side))
        buf = io.BytesIO()
        img.convert("RGB").save(buf, format="JPEG", quality=85)
        return buf.getvalue()
    except Exception:
        return image_bytes


def _parse_json_text(text: str) -> dict:
    """Strip markdown fences, ambil JSON pertama yang valid."""
    text = str(text or "").strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    # kalau masih ada teks di luar JSON, ambil bagian {...} pertama
    if not text.startswith("{"):
        m = re.search(r"\{.*\}", text, re.DOTALL)
        if m:
            text = m.group(0)
    return json.loads(text)


def _normalize(parsed: dict) -> dict:
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

    tax_included = bool(parsed.get("tax_included"))
    subtotal = _to_int(parsed.get("subtotal"))
    tax = _to_int(parsed.get("tax"))
    service = _to_int(parsed.get("service"))
    total = _to_int(parsed.get("total"))
    eff_sum = sum(i["price"] - i["discount"] for i in items)

    if tax_included:
        # harga item sudah termasuk pajak -> pajak gak diitung dobel, total = item
        subtotal = eff_sum
        tax = 0
        service = 0
        total = eff_sum
    else:
        if total <= 0:
            total = subtotal + tax + service
    return {
        "merchant": str(parsed.get("merchant", "") or "").strip(),
        "date": str(parsed.get("date", "") or "").strip(),
        "items": items,
        "subtotal": subtotal,
        "tax": tax,
        "service": service,
        "total": total,
        "tax_included": tax_included,
    }


def _to_int(v) -> int:
    try:
        return int(str(v).replace(".", "").replace("Rp", "").strip())
    except Exception:
        return 0
