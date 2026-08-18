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
# (bug v66: Gemini alone could retry up to 3x60s + backoff, then OpenRouter fallback
# another 3x90s + backoff -> ~465s worst case on a single request. Cloudflare cuts the
# connection at 100s and returns its own 524 HTML, so anything past that point burns
# CPU for nobody. Both providers now share ONE wall-clock budget for the whole call.)
OCR_BUDGET_SECONDS = 45.0
_ATTEMPT_TIMEOUT_CAP = 15.0
_MIN_ATTEMPT_SECONDS = 3.0

SYSTEM_PROMPT = """Kamu membaca struk belanja/makanan Indonesia. Output JSON EXACTLY:
{"merchant":"nama tempat makan/toko","date":"YYYY-MM-DD","items":[{"name":"nama item","price":harga,"discount":diskon}],"subtotal":N,"tax":N,"service":N,"total":N,"tax_included":true/false}
Rules:
- merchant = nama tempat makan/toko yang tertera di struk (header paling atas), contoh "Kitchen & Dimsum"; kosongkan string kalau tidak ada
- date = tanggal transaksi yang tertera di struk, dalam format YYYY-MM-DD (misal struk tulis 8/8/26 -> "2026-08-08"); kalau hanya ada tanggal tanpa tahun, asumsikan tahun berjalan; kosongkan kalau tidak ada
- price dalam Rupiah integer (tanpa 'Rp', tanpa titik) = harga SEBELUM diskon (harga menu)
- discount = potongan harga item dalam Rupiah integer (0 kalau tidak ada). Struk sering mencetak baris diskon di bawah item, contoh "CLR-4ProdDis349" lalu "-5.500" — gabungkan diskon itu ke item yang tepat di atasnya sebagai discount. Kalau struk tidak mencetak diskon, discount = 0
- tax = PPN/PB1, service = service charge/SC (0 kalau tidak ada)
- tax_included = true kalau struk menyebut harga sudah termasuk pajak (misal tulisan "termasuk PAJAK", "trmasuk pajak", "harga sudah termasuk pajak", "tax included", "Tax Invoice"). Kalau true: subtotal = jumlah item setelah diskon, tax = 0 (PPN sudah nempel di harga item, jangan dihitung dobel) TAPI service charge/SC tetap dilaporkan apa adanya kalau ada tulisannya di struk — SC itu biaya terpisah dari pajak, bukan bagian dari harga item. Kalau false: subtotal = jumlah sebelum pajak, tax = PPN/PB1, service = SC
- subtotal = jumlah sebelum pajak (setelah diskon); total = yang dibayar
- Jangan menebak item yang tidak jelas; nama sesingkat mungkin tapi tetap terbaca
- Kalau struk tidak terbaca sama sekali, output: {"merchant":"","date":"","items":[],"subtotal":0,"tax":0,"service":0,"total":0,"tax_included":false}"""


def ocr_receipt(image_bytes: bytes, mime_type: str = "image/jpeg") -> dict:
    """OCR via Gemini; kalau Gemini gagal (quota/error), fallback ke OpenRouter gratis."""
    # (bug v66: pesan error dulu nge-leak nama env var mentah-mentah ke toast user,
    # misal "Gemini: GEMINI_API_KEY not set; cadangan: OPENROUTER_API_KEY not set" -
    # bahasa Inggris di app berbahasa Indonesia, dan judulnya bohong ["lagi penuh"]
    # padahal servernya yang belum disetel. Detail teknis sekarang cuma ke log;
    # user cuma liat kalimat pendek yang jujur, dan "belum disetel" dibedain dari
    # "lagi penuh / gagal baca".)
    if not GEMINI_API_KEY and not OR_API_KEY:
        log.error("OCR gak jalan: GEMINI_API_KEY dan OPENROUTER_API_KEY dua-duanya kosong")
        raise RuntimeError("Fitur baca struk otomatis belum disetel di server. Isi manual dulu ya.")

    deadline = time.monotonic() + OCR_BUDGET_SECONDS
    errors = []
    if GEMINI_API_KEY:
        try:
            return _gemini_ocr(image_bytes, mime_type, deadline)
        except RuntimeError as e:
            errors.append(f"Gemini: {e}")
            log.warning("Gemini OCR gagal, coba OpenRouter: %s", e)
    else:
        log.warning("GEMINI_API_KEY kosong, langsung coba OpenRouter")

    if OR_API_KEY:
        try:
            return _openrouter_ocr(image_bytes, deadline)
        except RuntimeError as e:
            errors.append(f"cadangan: {e}")
            log.warning("OpenRouter OCR gagal: %s", e)
    else:
        log.warning("OPENROUTER_API_KEY kosong, gak ada fallback")

    log.error("OCR gagal total: %s", "; ".join(errors) or "no provider berhasil dipanggil")
    raise RuntimeError(
        "AI gratis lagi penuh atau gangguan. Coba lagi beberapa menit atau isi manual aja."
    )


def _gemini_ocr(image_bytes: bytes, mime_type: str, deadline: float) -> dict:
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
        remaining = deadline - time.monotonic()
        if remaining < _MIN_ATTEMPT_SECONDS:
            log.warning(
                "Gemini: budget waktu abis sebelum attempt %d/%d (sisa %.1fs)",
                attempt + 1, MAX_ATTEMPTS, remaining,
            )
            break
        timeout = min(_ATTEMPT_TIMEOUT_CAP, remaining)
        try:
            resp = urllib.request.urlopen(req, timeout=timeout)
            data = json.loads(resp.read())
            break
        except urllib.error.HTTPError as e:
            code = e.code
            body = e.read().decode()[:300]
            log.warning("Gemini HTTP %d (attempt %d/%d): %s", code, attempt + 1, MAX_ATTEMPTS, body)
            if code == 429 and "quota" in body.lower():
                raise RuntimeError("kuota harian habis (reset tengah malam)")
            backoff = 2 * (attempt + 1)
            if code in RETRY_CODES and attempt < MAX_ATTEMPTS - 1 and backoff < deadline - time.monotonic():
                time.sleep(backoff)
                continue
            raise RuntimeError(f"HTTP {code}: {body}")
        except Exception as e:
            log.warning("Gemini request gagal (attempt %d/%d): %s", attempt + 1, MAX_ATTEMPTS, e)
            backoff = 2 * (attempt + 1)
            if attempt < MAX_ATTEMPTS - 1 and backoff < deadline - time.monotonic():
                time.sleep(backoff)
                continue
            raise RuntimeError(f"request gagal: {e}")
    if data is None:
        raise RuntimeError("gagal setelah beberapa percobaan (waktu abis)")

    try:
        text = data["candidates"][0]["content"]["parts"][0]["text"]
        parsed = _parse_json_text(text)
    except Exception:
        raise RuntimeError("respons tidak bisa dibaca")
    return _normalize(parsed)


def _openrouter_ocr(image_bytes: bytes, deadline: float) -> dict:
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
        remaining = deadline - time.monotonic()
        if remaining < _MIN_ATTEMPT_SECONDS:
            log.warning(
                "OpenRouter: budget waktu abis sebelum attempt %d/%d (sisa %.1fs)",
                attempt + 1, MAX_ATTEMPTS, remaining,
            )
            break
        timeout = min(_ATTEMPT_TIMEOUT_CAP, remaining)
        try:
            resp = urllib.request.urlopen(req, timeout=timeout)
            data = json.loads(resp.read())
            break
        except urllib.error.HTTPError as e:
            code = e.code
            body = e.read().decode()[:300]
            log.warning("OpenRouter HTTP %d (attempt %d/%d): %s", code, attempt + 1, MAX_ATTEMPTS, body)
            if code == 429 and "quota" in body.lower():
                raise RuntimeError("kuota harian OpenRouter habis")
            backoff = 3 * (attempt + 1)
            if code in RETRY_CODES and attempt < MAX_ATTEMPTS - 1 and backoff < deadline - time.monotonic():
                time.sleep(backoff)
                continue
            raise RuntimeError(f"HTTP {code}: {body}")
        except Exception as e:
            log.warning("OpenRouter request gagal (attempt %d/%d): %s", attempt + 1, MAX_ATTEMPTS, e)
            backoff = 3 * (attempt + 1)
            if attempt < MAX_ATTEMPTS - 1 and backoff < deadline - time.monotonic():
                time.sleep(backoff)
                continue
            raise RuntimeError(f"request gagal: {e}")
    if data is None:
        raise RuntimeError("gagal setelah beberapa percobaan (waktu abis)")

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


def _normalize(parsed) -> dict:
    # (bug v66: model kadang balikin JSON valid tapi bukan object - array telanjang,
    # `null`, atau string biasa. `_parse_json_text` cuma nyelametin teks yang ada
    # `{...}`-nya; sisanya lolos ke sini sebagai list/None/str lalu .get() meledak
    # jadi AttributeError yang gak ketangkep RuntimeError manapun -> lolos ke luar
    # semua try/except pemanggil dan jadi HTTP 500 mentah ke client.)
    if not isinstance(parsed, dict):
        raise RuntimeError("Hasil baca AI-nya gak sesuai format, coba foto ulang atau isi manual aja.")
    raw_items = parsed.get("items") or []
    if not isinstance(raw_items, list):
        raw_items = []
    items = []
    for it in raw_items:
        if not isinstance(it, dict):
            continue
        try:
            price = _to_int(it.get("price"))
        except Exception:
            price = 0
        try:
            discount = _to_int(it.get("discount"))
        except Exception:
            discount = 0
        if discount < 0 or discount > price:
            discount = 0
        name = str(it.get("name", "")).strip()
        if name and price >= 0:
            items.append({"name": name, "price": price, "discount": discount})

    # LLMs often emit tax_included as a STRING ("false"/"0") — bool("false")
    # is True in Python, which silently flipped bills into tax-included mode
    # (bug: tax zeroed, total rewritten). Only real true/1 count.
    ti = parsed.get("tax_included")
    tax_included = ti is True or (isinstance(ti, str) and ti.strip().lower() == "true")
    subtotal = max(0, _to_int(parsed.get("subtotal")))
    tax = max(0, _to_int(parsed.get("tax")))
    service = max(0, _to_int(parsed.get("service")))
    total = max(0, _to_int(parsed.get("total")))
    eff_sum = sum(i["price"] - i["discount"] for i in items)

    if tax_included:
        # harga item sudah termasuk pajak -> PAJAK gak diitung dobel (subtotal = total
        # item), TAPI service charge tetap keitung terpisah.
        # (bug v66: dulu `service = 0` di sini juga -> Rp service ilang sebelum user
        # sempet liat form sama sekali, padahal calc.py sengaja TETAP misahin service
        # charge pas tax_included dan editor tetap nampilin field Service di bawah
        # toggle-nya. Duitnya nyangkut diam-diam ke siapa pun yang udah nalangin.)
        subtotal = eff_sum
        tax = 0
        total = subtotal + service
    else:
        # reconcile LLM-hallucinated numbers so bill-create's strict validation
        # (subtotal == sum items, total == subtotal+tax+service) doesn't 400 on
        # a receipt that OCR read almost-right
        if items and eff_sum > 0 and subtotal != eff_sum:
            subtotal = eff_sum
        if total <= 0:
            total = subtotal + tax + service
        elif total != subtotal + tax + service:
            total = subtotal + tax + service
    # (bug v66: model kadang balikin tanggal non-ISO ("08/08/2026", "8 Agustus 2026").
    # <input type="date"> gak render itu -> kelihatan KOSONG di form verifikasi, tapi
    # nilainya tetep kebawa kalau user gak sadar dan langsung submit; lolos ke bill
    # tersimpan lalu bikin pengelompokan bulan & filter tahun/bulan di daftar bill
    # gagal parse. Drop diam-diam kalau bukan YYYY-MM-DD, biarin user isi manual.)
    raw_date = str(parsed.get("date", "") or "").strip()
    date = raw_date if re.match(r"^\d{4}-\d{2}-\d{2}$", raw_date) else ""
    return {
        "merchant": str(parsed.get("merchant", "") or "").strip(),
        "date": date,
        "items": items,
        "subtotal": subtotal,
        "tax": tax,
        "service": service,
        "total": total,
        "tax_included": tax_included,
    }


def _to_int(v) -> int:
    """Parse a Rupiah value into an int, tolerating LLM float output.

    Handles: int, float (15000.5 -> 15000 via round, NOT 150005), 'Rp 15.000',
    '15.000', '15,5' (comma decimal). Dots followed by exactly 3 digits are
    thousands separators and are stripped; anything else is a decimal point.
    """
    if v is None:
        return 0
    if isinstance(v, bool):
        return 1 if v else 0
    if isinstance(v, (int, float)):
        try:
            return int(round(v))
        except Exception:
            return 0
    s = str(v).strip().replace("Rp", "").replace(" ", "").strip()
    if not s:
        return 0
    # thousands dots: "15.000" -> "15000" (only when followed by exactly 3 digits)
    s = re.sub(r"\.(?=\d{3}(?:\D|$))", "", s)
    # comma as decimal separator: "15,5" -> "15.5"
    s = s.replace(",", ".")
    try:
        return int(round(float(s)))
    except Exception:
        return 0
