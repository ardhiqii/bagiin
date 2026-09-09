"""Bagiin - OCR service: Gemini free tier primary, OpenRouter free vision fallback."""
import base64
from decimal import Decimal, ROUND_DOWN
import io
import json
import logging
import os
import re
import socket
import time
from datetime import date as _date
import urllib.error
import urllib.request

log = logging.getLogger("bagiin.ocr")

GEMINI_MODEL = os.environ.get("BAGIIN_OCR_MODEL", "gemini-3.5-flash")
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
OR_API_KEY = os.environ.get("OPENROUTER_API_KEY", "")

DEFAULT_OPENROUTER_OCR_MODELS = (
    "google/gemma-4-26b-a4b-it:free",
    "google/gemma-4-31b-it:free",
    "dots-studio/dots-3-note-preview:free",
    "thinkingmachines/inkling-small:free",
    "thinkingmachines/inkling:free",
    "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
    "openrouter/free",
)


def _is_free_openrouter_model(model: str) -> bool:
    return model == "openrouter/free" or model.endswith(":free")


def _parse_openrouter_models(models_value=None, legacy_model=None) -> tuple[str, ...]:
    """Read the ordered free-model override without ever selecting paid IDs."""
    if models_value is None:
        models_value = os.environ.get("OPENROUTER_OCR_MODELS", "")
    if legacy_model is None:
        legacy_model = os.environ.get("OPENROUTER_OCR_MODEL", "")

    configured = str(models_value or "").strip()
    if not configured:
        configured = str(legacy_model or "").strip()
    if not configured:
        configured = ",".join(DEFAULT_OPENROUTER_OCR_MODELS)

    models = []
    for raw_model in configured.split(","):
        model = raw_model.strip()
        if not model or not _is_free_openrouter_model(model) or model in models:
            continue
        models.append(model)
    return tuple(models) or DEFAULT_OPENROUTER_OCR_MODELS


OPENROUTER_OCR_MODELS = _parse_openrouter_models()
# Keep the old singular constant for callers that import it directly. New
# requests use OR_MODELS and pass the selected model explicitly per payload.
OR_MODELS = OPENROUTER_OCR_MODELS
OR_MODEL = OR_MODELS[0]
MAX_ATTEMPTS = 3
RETRY_CODES = (429, 500, 502, 503, 504)
# (bug v66: Gemini alone could retry up to 3x60s + backoff, then OpenRouter fallback
# another 3x90s + backoff -> ~465s worst case on a single request. Cloudflare cuts the
# connection at 100s and returns its own 524 HTML, so anything past that point burns
# CPU for nobody. Both providers now share ONE wall-clock budget for the whole call.)
OCR_BUDGET_SECONDS = 45.0
_ATTEMPT_TIMEOUT_CAP = 15.0
_MIN_ATTEMPT_SECONDS = 3.0
_OPENROUTER_MAX_ATTEMPTS = 2
# Keep a bounded slice for the fallback instead of letting a slow primary
# consume the shared deadline. The ratio makes tiny test budgets scale down,
# while the cap keeps production fallback latency predictable.
_OPENROUTER_FALLBACK_RATIO = 1 / 3
_OPENROUTER_FALLBACK_MAX_SECONDS = 15.0

SYSTEM_PROMPT = """Kamu membaca struk belanja/makanan Indonesia. Semua gambar dalam satu permintaan adalah halaman atau potongan dari SATU pesanan yang sama.
Gabungkan bukti dari semua gambar dan jangan menghitung baris, diskon, pajak, atau total yang tumpang tindih dua kali. Output JSON EXACTLY:
{"merchant":"nama tempat makan/toko","date":"YYYY-MM-DD","items":[{"name":"nama item","price":harga_satuan,"discount":diskon,"quantity":jumlah}],"subtotal":N,"order_discount":diskon_pesanan,"tax":N,"service":N,"total":N,"tax_included":true/false}
Rules:
- Gambar dapat merupakan halaman 1 dan 2 atau potongan berbeda dari pesanan yang sama; cocokkan baris yang sama sebelum menjumlahkan. Jangan menggandakan item atau angka yang muncul di lebih dari satu gambar.
- merchant = salin persis nama tempat makan/toko dari header struk, karakter dan ejaannya apa adanya; jangan menerjemahkan, memperbaiki, atau mengarang nama. Kalau satu bagian header buram atau meragukan, merchant = ""; kosongkan juga kalau nama tidak ada
- date = tanggal transaksi yang tertera di struk, dalam format YYYY-MM-DD (misal struk tulis 8/8/26 -> "2026-08-08"); kalau hanya ada tanggal tanpa tahun, asumsikan tahun berjalan; kosongkan kalau tidak ada
- price = harga satuan (unit price) SEBELUM diskon, dalam Rupiah integer (tanpa 'Rp', tanpa titik). price BUKAN line total/total baris.
- quantity = jumlah unit yang tercetak jelas pada baris item (bilangan bulat 1 sampai 99). Line total/total baris dihitung sebagai (price - discount) x quantity, bukan dimasukkan ke price. Contoh struk "2 x AYAM 35.000 70.000" berarti price = 35000, quantity = 2, line total = 70000. Kalau hanya tertulis "AYAM 70.000" tanpa pengali 2 yang jelas, pakai price = 70000 dan quantity = 1; jangan membagi harga atau menebak quantity.
- discount = potongan harga item dalam Rupiah integer (0 kalau tidak ada). Struk sering mencetak baris diskon di bawah item, contoh "CLR-4ProdDis349" lalu "-5.500", gabungkan diskon itu ke item yang tepat di atasnya sebagai discount. Kalau struk tidak mencetak diskon, discount = 0.
- Jika satu gambar menunjukkan harga satuan asli sebelum diskon dan gambar lain menunjukkan harga yang dibayar, gunakan price = harga satuan asli dan discount = selisih asli dikurangi dibayar PER UNIT. Contoh harga asli 23000, dibayar 18000, quantity 2 berarti discount 5000 dan subtotal 36000.
- Diskon promo tingkat pesanan atau voucher checkout yang tercetak sebagai nominal Rupiah masuk ke order_discount, BUKAN item discount. Diskon persentase jangan dikarang menjadi nominal dan jangan dibagi atau dipindahkan ke item discount. Biaya handling yang terpisah dilaporkan sebagai service.
- Kalau pengali/jumlah tidak jelas, meragukan, atau hanya terlihat sebagai baris struk yang berulang, quantity = 1 dan pertahankan setiap baris item terpisah; jangan menggabungkan item dengan nama sama.
- tax = PPN/PB1, service = service charge/SC (0 kalau tidak ada)
- tax_included = true kalau struk menyebut harga sudah termasuk pajak (misal tulisan "termasuk PAJAK", "trmasuk pajak", "harga sudah termasuk pajak", "tax included", "Tax Invoice"). Kalau true: subtotal = jumlah item setelah diskon, tax = 0 (PPN sudah nempel di harga item, jangan dihitung dobel) TAPI service charge/SC tetap dilaporkan apa adanya kalau ada tulisannya di struk, SC itu biaya terpisah dari pajak, bukan bagian dari harga item. Kalau false: subtotal = jumlah sebelum pajak, tax = PPN/PB1, service = SC
- subtotal = jumlah semua line total (setelah diskon item); order_discount = diskon voucher/promo untuk seluruh pesanan (0 kalau tidak tercetak jelas); total = subtotal + tax + service - order_discount. Jangan menebak order_discount dari selisih subtotal dan total.
- Semua nilai Rupiah output harus bilangan bulat Rupiah, tanpa pecahan atau desimal. Jangan menambahkan field item selain name, price, discount, quantity.
- Jangan menebak item yang tidak jelas; nama sesingkat mungkin tapi tetap terbaca. Pertahankan bentuk output item yang ada: name, price, discount, quantity; jangan tambahkan field line_total.
- Kalau struk tidak terbaca sama sekali, output: {"merchant":"","date":"","items":[],"subtotal":0,"order_discount":0,"tax":0,"service":0,"total":0,"tax_included":false}"""


def _image_records(
    image_bytes,
    mime_type: str | list[str] = "image/jpeg",
) -> list[tuple[bytes, str]]:
    """Normalize legacy bytes and ordered image records for provider calls."""
    byte_types = (bytes, bytearray, memoryview)
    if isinstance(image_bytes, byte_types):
        scalar_mime = mime_type if isinstance(mime_type, str) and mime_type else "image/jpeg"
        return [(bytes(image_bytes), scalar_mime)]

    if (
        isinstance(image_bytes, (tuple, list))
        and len(image_bytes) == 2
        and isinstance(image_bytes[0], byte_types)
        and (image_bytes[1] is None or isinstance(image_bytes[1], str))
    ):
        raw_images = [image_bytes]
    else:
        try:
            raw_images = list(image_bytes)
        except TypeError as error:
            raise RuntimeError("Data gambar tidak sesuai format, coba foto ulang.") from error
    if not raw_images:
        raise RuntimeError("Minimal satu foto diperlukan untuk membaca struk.")

    mime_values = mime_type if isinstance(mime_type, (list, tuple)) else None
    if mime_values is not None and len(mime_values) != len(raw_images):
        raise RuntimeError("Data gambar tidak sesuai format, coba foto ulang.")

    records = []
    for index, entry in enumerate(raw_images):
        entry_mime = mime_values[index] if mime_values is not None else mime_type
        raw = entry
        if (
            isinstance(entry, (tuple, list))
            and len(entry) == 2
        ):
            raw, entry_mime = entry
        if not isinstance(raw, byte_types):
            raise RuntimeError("Data gambar tidak sesuai format, coba foto ulang.")
        if not isinstance(entry_mime, str) or not entry_mime:
            entry_mime = "image/jpeg"
        records.append((bytes(raw), entry_mime))
    return records


def ocr_receipt(image_bytes, mime_type: str | list[str] = "image/jpeg") -> dict:
    """OCR via Gemini; kalau Gemini gagal (quota/error), fallback ke OpenRouter gratis."""
    # (bug v66: pesan error dulu nge-leak nama env var mentah-mentah ke toast user,
    # misal "Gemini: GEMINI_API_KEY not set; cadangan: OPENROUTER_API_KEY not set" -
    # bahasa Inggris di app berbahasa Indonesia, dan judulnya bohong ["lagi penuh"]
    # padahal servernya yang belum disetel. Detail teknis sekarang cuma ke log;
    # user cuma liat kalimat pendek yang jujur, dan "belum disetel" dibedain dari
    # "lagi penuh / gagal baca".)
    if not GEMINI_API_KEY and not OR_API_KEY:
        log.error("OCR tidak berjalan: GEMINI_API_KEY dan OPENROUTER_API_KEY sama-sama kosong")
        raise RuntimeError("Fitur baca struk otomatis belum disetel di server. Isi manual dulu ya.")

    records = _image_records(image_bytes, mime_type)
    provider_input = image_bytes if isinstance(image_bytes, (bytes, bytearray, memoryview)) else records
    started = time.monotonic()
    deadline = started + max(0.0, OCR_BUDGET_SECONDS)
    # (bug v66 review: Gemini dulu menerima deadline penuh, jadi provider yang
    # menggantung bisa menghabiskan seluruh budget sebelum fallback dimulai.)
    # Reserve only when a fallback is configured; Gemini keeps the full budget
    # when there is no second provider to call.
    fallback_seconds = 0.0
    if OR_API_KEY:
        fallback_seconds = min(
            _OPENROUTER_FALLBACK_MAX_SECONDS,
            max(0.0, OCR_BUDGET_SECONDS * _OPENROUTER_FALLBACK_RATIO),
        )
    primary_deadline = deadline - fallback_seconds
    providers_tried = []
    if GEMINI_API_KEY:
        try:
            return _gemini_ocr(provider_input, mime_type, primary_deadline)
        except RuntimeError:
            providers_tried.append("Gemini")
            log.warning("Gemini OCR model=%s failure=provider, coba OpenRouter", GEMINI_MODEL)
    else:
        log.warning("GEMINI_API_KEY kosong, langsung coba OpenRouter")

    if OR_API_KEY:
        try:
            return _openrouter_ocr(provider_input, deadline, mime_type=mime_type)
        except RuntimeError:
            providers_tried.append("OpenRouter")
            log.warning("OpenRouter OCR fallback exhausted")
    else:
        log.warning("OPENROUTER_API_KEY kosong, tidak ada fallback")

    log.error("OCR gagal total: providers=%s", ",".join(providers_tried) or "none")
    raise RuntimeError(
        "Layanan AI gratis sedang penuh atau mengalami gangguan. Coba lagi beberapa menit kemudian atau isi secara manual."
    )


def _gemini_ocr(image_bytes, mime_type: str | list[str] = "image/jpeg", deadline: float | None = None) -> dict:
    if deadline is None and isinstance(mime_type, (int, float)):
        deadline = float(mime_type)
        mime_type = "image/jpeg"
    if deadline is None:
        deadline = time.monotonic() + OCR_BUDGET_SECONDS
    records = _image_records(image_bytes, mime_type)
    image_parts = [
        {
            "inline_data": {
                "mime_type": image_mime,
                "data": base64.b64encode(raw).decode(),
            }
        }
        for raw, image_mime in records
    ]
    payload = {
        "contents": [
            {
                "parts": image_parts + [{"text": SYSTEM_PROMPT}]
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
                "budget waktu habis sebelum attempt %d/%d (sisa %.1fs)",
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
            log.warning(
                "Gemini OCR model=%s failure=http status=%d attempt=%d/%d",
                GEMINI_MODEL,
                code,
                attempt + 1,
                MAX_ATTEMPTS,
            )
            if code == 429 and "quota" in body.lower():
                raise RuntimeError("kuota harian habis (reset tengah malam)")
            backoff = 2 * (attempt + 1)
            if code in RETRY_CODES and attempt < MAX_ATTEMPTS - 1 and backoff < deadline - time.monotonic():
                time.sleep(backoff)
                continue
            raise RuntimeError(f"HTTP {code}")
        except Exception:
            log.warning(
                "Gemini OCR model=%s failure=request attempt=%d/%d",
                GEMINI_MODEL,
                attempt + 1,
                MAX_ATTEMPTS,
            )
            backoff = 2 * (attempt + 1)
            if attempt < MAX_ATTEMPTS - 1 and backoff < deadline - time.monotonic():
                time.sleep(backoff)
                continue
            raise RuntimeError("Permintaan OCR gagal")
    if data is None:
        raise RuntimeError("Kegagalan setelah beberapa percobaan (waktu habis)")

    try:
        text = _gemini_response_text(data)
        parsed = _parse_json_text(text)
    except Exception:
        raise RuntimeError("respons tidak bisa dibaca")
    return _normalize(parsed)


def _gemini_response_text(data) -> str:
    """Join answer text parts while ignoring Gemini's internal thoughts."""
    parts = data["candidates"][0]["content"]["parts"]
    return "".join(
        part["text"]
        for part in parts
        if isinstance(part, dict)
        and isinstance(part.get("text"), str)
        and part.get("thought") is not True
    )


class _OpenRouterFailure(RuntimeError):
    """Internal failure with a safe-to-log class/status only."""

    def __init__(self, kind: str, status: int | None = None):
        self.kind = kind
        self.status = status
        label = kind if status is None else f"{kind} status={status}"
        super().__init__(label)


def _active_openrouter_models() -> tuple[str, ...]:
    # OR_MODEL was the only selector before the ordered override existed;
    # honor a direct mutation by older callers while keeping the new list
    # authoritative for normal configuration.
    configured_models = OR_MODELS
    if (
        configured_models == OPENROUTER_OCR_MODELS
        and OR_MODEL != OPENROUTER_OCR_MODELS[0]
    ):
        configured_models = (OR_MODEL,)
    models = tuple(
        model.strip()
        for model in configured_models
        if isinstance(model, str) and model.strip() and _is_free_openrouter_model(model.strip())
    )
    return models or DEFAULT_OPENROUTER_OCR_MODELS


def _openrouter_model_deadline(deadline: float, remaining_models: int) -> float:
    """Give every remaining model a fair slice of the shared wall-clock budget."""
    now = time.monotonic()
    remaining = max(0.0, deadline - now)
    share = remaining / max(1, remaining_models)
    return min(deadline, now + min(_ATTEMPT_TIMEOUT_CAP, share))


def _openrouter_ocr(
    image_bytes,
    deadline: float,
    mime_type: str | list[str] = "image/jpeg",
) -> dict:
    records = _image_records(image_bytes, mime_type)
    prepared_records = []
    for raw, image_mime in records:
        prepared_image = _downscale(raw)
        # _downscale returns the original object when Pillow is unavailable or
        # the input cannot be decoded. Transformed bytes are always JPEG.
        prepared_mime = "image/jpeg" if prepared_image is not raw else image_mime
        prepared_records.append((prepared_image, prepared_mime))
    encoded_images = [base64.b64encode(raw).decode() for raw, _ in prepared_records]
    image_mimes = [image_mime for _, image_mime in prepared_records]
    payload_images = encoded_images[0] if len(encoded_images) == 1 else encoded_images
    payload_mimes = image_mimes[0] if len(image_mimes) == 1 else image_mimes
    models = _active_openrouter_models()

    for index, model in enumerate(models):
        if deadline <= time.monotonic():
            break
        model_deadline = _openrouter_model_deadline(deadline, len(models) - index)
        try:
            return _openrouter_model_ocr(
                payload_images,
                payload_mimes,
                model,
                model_deadline,
            )
        except _OpenRouterFailure as failure:
            # (bug v66: provider bodies can contain receipt fields or other
            # sensitive response data; only the selected model and a safe
            # class/status are allowed into logs.)
            log.warning("OpenRouter OCR model=%s failure=%s", model, failure)
        except Exception:
            # Keep an unexpected model-specific failure from preventing later
            # free candidates, while avoiding exception text in logs.
            log.warning("OpenRouter OCR model=%s failure=unexpected", model)

    raise RuntimeError("Kegagalan setelah beberapa percobaan (waktu habis)")


def _openrouter_model_ocr(
    image_b64: str | list[str],
    image_mime: str | list[str],
    model: str,
    deadline: float,
) -> dict:
    """Try one model, retrying only the optional structured-output hint."""
    structured = True
    for _ in range(_OPENROUTER_MAX_ATTEMPTS):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise _OpenRouterFailure("timeout")
        payload = _openrouter_payload(
            image_b64,
            image_mime,
            structured=structured,
            model=model,
        )
        req = _openrouter_request(payload)
        try:
            response = urllib.request.urlopen(
                req,
                timeout=min(_ATTEMPT_TIMEOUT_CAP, remaining),
            )
            try:
                data = json.loads(response.read())
            except (TypeError, ValueError, json.JSONDecodeError) as error:
                raise _OpenRouterFailure("invalid_json") from error
            return _normalize_openrouter_response(data)
        except urllib.error.HTTPError as error:
            code = error.code
            body = _read_http_error_body(error)
            if structured and _structured_response_rejected(code, body):
                # Some free OpenRouter models reject response_format even
                # though they accept the same vision prompt. Retry this model
                # once without the optional hint, then move to the next model
                # for every other failure.
                structured = False
                continue
            raise _OpenRouterFailure(_http_failure_class(code), status=code) from error
        except _OpenRouterFailure:
            raise
        except (socket.timeout, TimeoutError) as error:
            raise _OpenRouterFailure("timeout") from error
        except urllib.error.URLError as error:
            if isinstance(error.reason, (socket.timeout, TimeoutError)):
                raise _OpenRouterFailure("timeout") from error
            raise _OpenRouterFailure("request_error") from error
        except OSError as error:
            raise _OpenRouterFailure("request_error") from error
        except Exception as error:
            raise _OpenRouterFailure("request_error") from error

    raise _OpenRouterFailure("timeout")


def _normalize_openrouter_response(data) -> dict:
    try:
        content = data["choices"][0]["message"]["content"]
        if isinstance(content, list):
            content = "".join(
                c.get("text", "") for c in content if isinstance(c, dict)
            )
        parsed = _parse_json_text(content)
        return _normalize(parsed)
    except _OpenRouterFailure:
        raise
    except Exception as error:
        raise _OpenRouterFailure("invalid_response") from error


def _read_http_error_body(error: urllib.error.HTTPError) -> str:
    try:
        body = error.read(4096)
    except TypeError:
        # A small fake HTTPError in a test or adapter may expose read() without
        # urllib's optional byte-count argument.
        try:
            body = error.read()
        except Exception:
            return ""
    except Exception:
        return ""
    if isinstance(body, bytes):
        return body.decode("utf-8", "replace")[:4096]
    return str(body)[:4096]


def _http_failure_class(code: int) -> str:
    if code == 404:
        return "not_found"
    if code == 429:
        return "rate_limited"
    if 500 <= code <= 599:
        return "provider_error"
    return "http_error"


def _openrouter_payload(
    image_b64: str | list[str],
    image_mime: str | list[str],
    *,
    structured: bool,
    model: str | None = None,
) -> dict:
    b64_values = [image_b64] if isinstance(image_b64, str) else list(image_b64)
    mime_values = (
        [image_mime] * len(b64_values)
        if isinstance(image_mime, str)
        else list(image_mime)
    )
    if (
        not b64_values
        or len(b64_values) != len(mime_values)
        or not all(isinstance(value, str) and value for value in b64_values)
        or not all(isinstance(value, str) and value for value in mime_values)
    ):
        raise RuntimeError("Data gambar tidak sesuai format, coba foto ulang.")
    image_parts = [
        {
            "type": "image_url",
            "image_url": {"url": f"data:{mime};base64,{b64}"},
        }
        for b64, mime in zip(b64_values, mime_values)
    ]
    payload = {
        "model": model or OR_MODEL,
        "messages": [{
            "role": "user",
            "content": [{"type": "text", "text": SYSTEM_PROMPT}] + image_parts,
        }],
        "temperature": 0.1,
    }
    if structured:
        payload["response_format"] = {"type": "json_object"}
    return payload


def _openrouter_request(payload: dict) -> urllib.request.Request:
    return urllib.request.Request(
        "https://openrouter.ai/api/v1/chat/completions",
        data=json.dumps(payload).encode(),
        headers={
            "Authorization": f"Bearer {OR_API_KEY}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://bagiin.ardhiqi.com",
            "X-Title": "Bagiin",
        },
    )


def _structured_response_rejected(code: int, body: str) -> bool:
    """Return whether a provider rejected only the optional JSON hint."""
    if code not in (400, 422):
        return False
    text = body.lower()
    if "response_format" in text or "json_object" in text:
        return True
    return "structured" in text and any(
        marker in text for marker in ("unsupported", "not support", "not supported")
    )


def _downscale(image_bytes: bytes, max_side: int = 1280) -> bytes:
    """Kecilkan gambar agar permintaan lebih cepat dan tidak ditolak model gratis."""
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


def _rupiah_decimal(value) -> Decimal:
    """Parse a provider money value without rounding fractional Rupiah."""
    if value is None:
        return Decimal(0)
    if isinstance(value, bool):
        return Decimal(1 if value else 0)
    if isinstance(value, Decimal):
        number = value
    elif isinstance(value, (int, float)):
        number = Decimal(str(value))
    else:
        text = str(value).strip().replace(" ", "")
        if not text:
            return Decimal(0)
        text = re.sub(r"(?i)rp", "", text)
        text = re.sub(r"\.(?=\d{3}(?:\D|$))", "", text)
        text = text.replace(",", ".")
        number = Decimal(text)
    if not number.is_finite():
        raise ValueError("non-finite money")
    return number


def _to_int_truncated(value) -> int:
    """Convert provider money to Rupiah by truncating toward zero."""
    try:
        return int(_rupiah_decimal(value).to_integral_value(rounding=ROUND_DOWN))
    except Exception:
        return 0


def _first_present(mapping: dict, keys: tuple[str, ...]):
    for key in keys:
        if key not in mapping:
            continue
        value = mapping[key]
        if value is None or (isinstance(value, str) and not value.strip()):
            continue
        return value
    return None


def _is_percentage(value) -> bool:
    return isinstance(value, str) and "%" in value


def _has_percentage_discount(item: dict) -> bool:
    if _is_percentage(item.get("discount")):
        return True
    return any(
        key in item and item[key] not in (None, "")
        for key in (
            "discount_percent",
            "discount_percentage",
            "discount_rate",
            "discount_pct",
            "percentage_discount",
        )
    )


_ORIGINAL_PRICE_KEYS = (
    "original_price",
    "original_unit_price",
    "regular_price",
    "list_price",
    "catalog_price",
    "unit_price",
)
_PAID_PRICE_KEYS = (
    "paid_price",
    "paid_unit_price",
    "discounted_price",
    "discounted_unit_price",
    "net_price",
    "net_unit_price",
    "final_price",
    "final_unit_price",
    "sale_price",
)

_ORDER_DISCOUNT_KEYS = (
    "order_discount",
    "order_discount_idr",
    "order_level_discount",
    "checkout_discount",
    "checkout_discount_idr",
    "voucher_discount",
    "voucher_discount_idr",
    "promo_discount",
    "promo_discount_idr",
)


def _normalize(parsed) -> dict:
    # (bug v66: model kadang balikin JSON valid tapi bukan object - array telanjang,
    # `null`, atau string biasa. `_parse_json_text` cuma nyelametin teks yang ada
    # `{...}`-nya; sisanya lolos ke sini sebagai list/None/str lalu .get() meledak
    # jadi AttributeError yang gak ketangkep RuntimeError manapun -> lolos ke luar
    # semua try/except pemanggil dan jadi HTTP 500 mentah ke client.)
    if not isinstance(parsed, dict):
        raise RuntimeError("Hasil pembacaan AI tidak sesuai format, coba foto ulang atau isi secara manual.")
    raw_items = parsed.get("items") or []
    if not isinstance(raw_items, list):
        raw_items = []
    items = []
    for it in raw_items:
        if not isinstance(it, dict):
            continue
        try:
            price = _to_int_truncated(it.get("price"))
        except Exception:
            price = 0
        try:
            discount = _to_int_truncated(it.get("discount"))
        except Exception:
            discount = 0

        original_raw = _first_present(it, _ORIGINAL_PRICE_KEYS)
        paid_raw = _first_present(it, _PAID_PRICE_KEYS)
        if original_raw is not None and not _is_percentage(original_raw):
            price = _to_int_truncated(original_raw)
        if (
            paid_raw is not None
            and not _is_percentage(paid_raw)
            and (original_raw is not None or "price" in it)
        ):
            paid_price = _to_int_truncated(paid_raw)
            discount = max(0, min(price, price - paid_price))
        elif _has_percentage_discount(it):
            discount = 0
        raw_quantity = it.get("quantity", 1)
        # Only a real integer emitted in the dedicated quantity field counts
        # as a clear multiplier. Ambiguous text, booleans, and numeric strings
        # remain x1; repeated rows are intentionally not deduplicated.
        quantity = raw_quantity if type(raw_quantity) is int and 1 <= raw_quantity <= 99 else 1
        if discount < 0 or discount > price:
            discount = 0
        name = str(it.get("name", "")).strip()
        if name and price >= 0:
            # Receipt OCR must be conservative: repeated/ambiguous rows are
            # separate purchased lines, never an inferred multiplier.
            items.append({"name": name, "price": price, "discount": discount, "quantity": quantity})

    # LLMs often emit tax_included as a STRING ("false"/"0") — bool("false")
    # is True in Python, which silently flipped bills into tax-included mode
    # (bug: tax zeroed, total rewritten). Only real true/1 count.
    ti = parsed.get("tax_included")
    tax_included = ti is True or (isinstance(ti, str) and ti.strip().lower() == "true")
    subtotal = max(0, _to_int_truncated(parsed.get("subtotal")))
    tax = max(0, _to_int_truncated(parsed.get("tax")))
    service = max(0, _to_int_truncated(parsed.get("service")))
    total = max(0, _to_int_truncated(parsed.get("total")))
    raw_order_discount = _first_present(parsed, _ORDER_DISCOUNT_KEYS)
    has_order_discount = (
        raw_order_discount is not None
        and not _is_percentage(raw_order_discount)
    )
    order_discount = (
        max(0, _to_int_truncated(raw_order_discount))
        if has_order_discount else 0
    )
    eff_sum = sum((i["price"] - i["discount"]) * i["quantity"] for i in items)

    if tax_included:
        # harga item sudah termasuk pajak -> PAJAK gak diitung dobel (subtotal = total
        # item), TAPI service charge tetap keitung terpisah.
        # (bug v66: dulu `service = 0` di sini juga -> Rp service ilang sebelum user
        # sempet liat form sama sekali, padahal calc.py sengaja TETAP misahin service
        # charge pas tax_included dan editor tetap nampilin field Service di bawah
        # toggle-nya. Duitnya nyangkut diam-diam ke siapa pun yang udah nalangin.)
        subtotal = eff_sum
        tax = 0
        total = max(0, subtotal + service - order_discount)
    else:
        # reconcile LLM-hallucinated numbers so bill-create's strict validation
        # (subtotal == sum items, total == subtotal+tax+service) doesn't 400 on
        # a receipt that OCR read almost-right
        if items and subtotal != eff_sum:
            subtotal = eff_sum
        expected_total = subtotal + tax + service - order_discount
        if total <= 0 or total != expected_total:
            total = max(0, expected_total)
    # (bug v66: model kadang balikin tanggal non-ISO ("08/08/2026", "8 Agustus 2026").
    # <input type="date"> gak render itu -> kelihatan KOSONG di form verifikasi, tapi
    # nilainya tetep kebawa kalau user gak sadar dan langsung submit; lolos ke bill
    # tersimpan lalu bikin pengelompokan bulan & filter tahun/bulan di daftar bill
    # gagal parse. Drop diam-diam kalau bukan YYYY-MM-DD, biarin user isi manual.)
    raw_date = str(parsed.get("date", "") or "").strip()
    date = ""
    if re.match(r"^\d{4}-\d{2}-\d{2}$", raw_date):
        try:
            _date.fromisoformat(raw_date)
            date = raw_date
        except ValueError:
            pass
    return {
        "merchant": str(parsed.get("merchant", "") or "").strip(),
        "date": date,
        "items": items,
        "subtotal": subtotal,
        "order_discount": order_discount,
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
