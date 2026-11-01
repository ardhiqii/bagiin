"""Deterministic regressions for free-provider OCR receipt accuracy.

These tests exercise request construction and normalization only. They never call
Gemini or OpenRouter.
"""
import base64
from email.message import Message
import io
import json
import os
import socket
import sys
import tempfile
import time
import urllib.error
from pathlib import Path

import pytest

os.environ.setdefault("BAGIIN_DB", str(Path(tempfile.mkdtemp()) / "ocr-accuracy.db"))
os.environ.setdefault("BAGIIN_UPLOAD_DIR", str(Path(tempfile.mkdtemp()) / "uploads"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import ocr


class _Response:
    def __init__(self, payload):
        self._payload = json.dumps(payload).encode()

    def read(self):
        return self._payload


class _RawResponse:
    def __init__(self, payload):
        self._payload = payload

    def read(self):
        return self._payload


def _gemini_response(parts):
    return _Response({
        "candidates": [{"content": {"parts": parts}}],
    })


def _provider_response():
    return _Response({
        "choices": [{
            "message": {
                "content": json.dumps({
                    "items": [{"name": "Item", "price": 100}],
                    "subtotal": 100,
                    "tax": 0,
                    "service": 0,
                    "total": 100,
                    "tax_included": False,
                }),
            },
        }],
    })


def _request_payload(request):
    return json.loads(request.data.decode())


def _model_from_request(request):
    return _request_payload(request)["model"]


def test_gemini_ignores_thought_part_when_answer_text_is_present(monkeypatch):
    thought = {
        "thought": True,
        "text": json.dumps({
            "merchant": "Thought only",
            "items": [],
            "subtotal": 0,
            "tax": 0,
            "service": 0,
            "total": 0,
            "tax_included": False,
        }),
    }
    answer = {
        "text": json.dumps({
            "merchant": "Warung Nyata",
            "items": [{"name": "Nasi Goreng", "price": 25000}],
            "subtotal": 25000,
            "tax": 0,
            "service": 0,
            "total": 25000,
            "tax_included": False,
        }),
    }
    monkeypatch.setattr(ocr, "GEMINI_API_KEY", "fake-gemini-key")
    monkeypatch.setattr(
        ocr.urllib.request,
        "urlopen",
        lambda request, timeout=None: _gemini_response([thought, answer]),
    )

    result = ocr._gemini_ocr(b"image", "image/jpeg", time.monotonic() + 5)

    assert result["merchant"] == "Warung Nyata"
    assert result["items"] == [{"name": "Nasi Goreng", "price": 25000, "discount": 0, "quantity": 1}]


def test_gemini_keeps_single_text_part_compatibility(monkeypatch):
    answer = {
        "text": json.dumps({
            "merchant": "Satu Bagian",
            "items": [{"name": "Teh", "price": 5000}],
            "subtotal": 5000,
            "tax": 0,
            "service": 0,
            "total": 5000,
            "tax_included": False,
        }),
    }
    monkeypatch.setattr(ocr, "GEMINI_API_KEY", "fake-gemini-key")
    monkeypatch.setattr(
        ocr.urllib.request,
        "urlopen",
        lambda request, timeout=None: _gemini_response([answer]),
    )

    result = ocr._gemini_ocr(b"image", "image/jpeg", time.monotonic() + 5)

    assert result["merchant"] == "Satu Bagian"
    assert result["total"] == 5000


def test_system_prompt_explains_unit_price_quantity_discount_and_line_total():
    prompt = ocr.SYSTEM_PROMPT.lower()

    assert "harga satuan" in prompt
    assert "unit price" in prompt
    assert "quantity" in prompt
    assert "diskon" in prompt
    assert "line total" in prompt
    assert "total baris" in prompt
    assert "35000" in prompt
    assert "70000" in prompt
    assert "salin persis" in prompt
    assert "jangan menerjemahkan" in prompt
    assert "meragukan" in prompt
    assert "jangan menggabungkan" in prompt or "terpisah" in prompt


def test_openrouter_data_url_uses_jpeg_for_transformed_bytes(monkeypatch):
    requests = []
    monkeypatch.setattr(ocr, "_downscale", lambda image: b"transformed-jpeg")

    def fake_urlopen(request, timeout=None):
        requests.append(request)
        return _provider_response()

    monkeypatch.setattr(ocr.urllib.request, "urlopen", fake_urlopen)
    ocr._openrouter_ocr(
        b"original-png",
        time.monotonic() + 5,
        mime_type="image/png",
    )

    payload = _request_payload(requests[0])
    image_url = payload["messages"][0]["content"][1]["image_url"]["url"]
    assert image_url.startswith("data:image/jpeg;base64,")
    assert base64.b64decode(image_url.split(",", 1)[1]) == b"transformed-jpeg"


def test_openrouter_data_url_preserves_mime_when_bytes_are_not_transformed(monkeypatch):
    requests = []
    original = b"original-webp"
    monkeypatch.setattr(ocr, "_downscale", lambda image: image)

    def fake_urlopen(request, timeout=None):
        requests.append(request)
        return _provider_response()

    monkeypatch.setattr(ocr.urllib.request, "urlopen", fake_urlopen)
    ocr._openrouter_ocr(
        original,
        time.monotonic() + 5,
        mime_type="image/webp",
    )

    payload = _request_payload(requests[0])
    image_url = payload["messages"][0]["content"][1]["image_url"]["url"]
    assert image_url.startswith("data:image/webp;base64,")
    assert base64.b64decode(image_url.split(",", 1)[1]) == original


def test_openrouter_requests_json_object_response_format(monkeypatch):
    requests = []
    monkeypatch.setattr(ocr, "_downscale", lambda image: image)

    def fake_urlopen(request, timeout=None):
        requests.append(request)
        return _provider_response()

    monkeypatch.setattr(ocr.urllib.request, "urlopen", fake_urlopen)
    ocr._openrouter_ocr(b"image", time.monotonic() + 5)

    payload = _request_payload(requests[0])
    assert payload["response_format"] == {"type": "json_object"}


def test_openrouter_retries_without_json_option_when_provider_rejects_it(monkeypatch):
    requests = []
    monkeypatch.setattr(ocr, "_downscale", lambda image: image)

    def fake_urlopen(request, timeout=None):
        requests.append(request)
        if len(requests) == 1:
            raise urllib_http_error(request, b"response_format is unsupported")
        return _provider_response()

    monkeypatch.setattr(ocr.urllib.request, "urlopen", fake_urlopen)
    result = ocr._openrouter_ocr(b"image", time.monotonic() + 5)

    assert len(requests) == 2
    first_payload = _request_payload(requests[0])
    fallback_payload = _request_payload(requests[1])
    assert first_payload["response_format"] == {"type": "json_object"}
    assert "response_format" not in fallback_payload
    assert result["items"] == [{"name": "Item", "price": 100, "discount": 0, "quantity": 1}]


def test_openrouter_model_config_preserves_order_and_legacy_override():
    assert ocr._parse_openrouter_models(
        " second:free, first:free, second:free, paid/model",
        "legacy:free",
    ) == ("second:free", "first:free")
    assert ocr._parse_openrouter_models("", "legacy:free") == ("legacy:free",)
    assert ocr._parse_openrouter_models("paid/model", "legacy:free") == ocr.DEFAULT_OPENROUTER_OCR_MODELS
    # Urutan default = urutan hasil ukur (yang benar-benar menjawab lebih dulu).
    assert ocr.DEFAULT_OPENROUTER_OCR_MODELS[0] == "nvidia/nemotron-3.5-super-vl:free"
    assert "openrouter/free" in ocr.DEFAULT_OPENROUTER_OCR_MODELS
    assert all(ocr._is_free_openrouter_model(model) for model in ocr.DEFAULT_OPENROUTER_OCR_MODELS)


def test_openrouter_passes_selected_model_in_each_payload(monkeypatch):
    requests = []
    monkeypatch.setattr(ocr, "OR_MODELS", ("first:free", "second:free"))
    monkeypatch.setattr(ocr, "_downscale", lambda image: image)

    def fake_urlopen(request, timeout=None):
        requests.append(request)
        return _provider_response()

    monkeypatch.setattr(ocr.urllib.request, "urlopen", fake_urlopen)
    ocr._openrouter_ocr(b"image", time.monotonic() + 5)

    assert [_model_from_request(request) for request in requests] == ["first:free"]


def test_openrouter_status_failures_advance_in_order_to_next_model(monkeypatch):
    requests = []
    models = ("first:free", "second:free", "third:free")
    monkeypatch.setattr(ocr, "OR_MODELS", models)
    monkeypatch.setattr(ocr, "_downscale", lambda image: image)

    def fake_urlopen(request, timeout=None):
        requests.append(request)
        model = _model_from_request(request)
        if model == "first:free":
            raise urllib_http_error(request, b'{"error":"quota receipt fields"}', code=429)
        if model == "second:free":
            raise urllib_http_error(request, b'{"error":"model unavailable"}', code=404)
        return _provider_response()

    monkeypatch.setattr(ocr.urllib.request, "urlopen", fake_urlopen)
    result = ocr._openrouter_ocr(b"image", time.monotonic() + 5)

    assert result["total"] == 100
    assert [_model_from_request(request) for request in requests] == list(models)


def test_openrouter_timeout_advances_to_next_model(monkeypatch):
    requests = []
    monkeypatch.setattr(ocr, "OR_MODELS", ("first:free", "second:free"))
    monkeypatch.setattr(ocr, "_downscale", lambda image: image)

    def fake_urlopen(request, timeout=None):
        requests.append((request, timeout))
        if len(requests) == 1:
            raise socket.timeout("provider timeout")
        return _provider_response()

    monkeypatch.setattr(ocr.urllib.request, "urlopen", fake_urlopen)
    result = ocr._openrouter_ocr(b"image", time.monotonic() + 5)

    assert result["total"] == 100
    assert [_model_from_request(request) for request, _ in requests] == ["first:free", "second:free"]
    assert all(timeout > 0 for _, timeout in requests)


def test_openrouter_malformed_output_advances_to_next_model(monkeypatch):
    requests = []
    monkeypatch.setattr(ocr, "OR_MODELS", ("first:free", "second:free"))
    monkeypatch.setattr(ocr, "_downscale", lambda image: image)

    def fake_urlopen(request, timeout=None):
        requests.append(request)
        if len(requests) == 1:
            return _RawResponse(b"not json at all")
        return _provider_response()

    monkeypatch.setattr(ocr.urllib.request, "urlopen", fake_urlopen)
    result = ocr._openrouter_ocr(b"image", time.monotonic() + 5)

    assert result["total"] == 100
    assert [_model_from_request(request) for request in requests] == ["first:free", "second:free"]


def test_openrouter_exhausted_chain_raises_short_runtime_error(monkeypatch, caplog):
    requests = []
    models = ("first:free", "second:free")
    monkeypatch.setattr(ocr, "OR_MODELS", models)
    monkeypatch.setattr(ocr, "_downscale", lambda image: image)

    def fake_urlopen(request, timeout=None):
        requests.append(request)
        raise urllib_http_error(request, b'{"private":"receipt data"}', code=500)

    monkeypatch.setattr(ocr.urllib.request, "urlopen", fake_urlopen)
    with pytest.raises(RuntimeError, match="Kegagalan setelah beberapa percobaan"):
        ocr._openrouter_ocr(b"image", time.monotonic() + 5)

    assert [_model_from_request(request) for request in requests] == list(models)
    assert "receipt data" not in caplog.text
    assert "first:free" in caplog.text
    assert "status=500" in caplog.text


def urllib_http_error(request, body, code=400):
    """Build a provider-like 400 without putting a credential in the fixture."""
    return urllib.error.HTTPError(
        request.full_url,
        code,
        "bad request",
        Message(),
        io.BytesIO(body),
    )


def test_normalize_reconciles_discounted_quantity_line_totals_without_new_fields():
    normalized = ocr._normalize({
        "merchant": "Ayam Aroma",
        "date": "2026-08-08",
        "items": [
            {
                "name": "Ayam Bakar",
                "price": 35000,
                "discount": 5000,
                "quantity": 2,
                "line_total": 999999,
            },
            {"name": "Es Teh", "price": 7000, "discount": 0, "quantity": 1},
        ],
        "subtotal": 1,
        "tax": 7700,
        "service": 3000,
        "total": 2,
        "tax_included": False,
    })

    assert normalized["subtotal"] == 67000
    assert normalized["total"] == 77700
    assert normalized["items"] == [
        {"name": "Ayam Bakar", "price": 35000, "discount": 5000, "quantity": 2},
        {"name": "Es Teh", "price": 7000, "discount": 0, "quantity": 1},
    ]
    assert all("line_total" not in item for item in normalized["items"])


def test_normalize_preserves_duplicate_rows_and_does_not_infer_quantity():
    normalized = ocr._normalize({
        "items": [
            {"name": "AYAM GORENG", "price": 35000},
            {"name": "AYAM GORENG", "price": 35000},
            {"name": "AYAM GORENG", "price": 35000, "quantity": "2"},
        ],
        "subtotal": 105000,
        "tax": 0,
        "service": 0,
        "total": 105000,
        "tax_included": False,
    })

    assert len(normalized["items"]) == 3
    assert [item["quantity"] for item in normalized["items"]] == [1, 1, 1]
    assert normalized["subtotal"] == 105000


def test_supplied_ayam_aroma_receipt_shape_keeps_public_item_contract():
    normalized = ocr._normalize({
        "merchant": "Ayam Aroma",
        "date": "2026-09-06",
        "items": [
            {"name": "Bebek Goreng Dada", "price": 35000, "quantity": 1, "discount": 0},
            {"name": "Bebek Goreng Paha", "price": 35000, "quantity": 2, "discount": 0},
            {"name": "Sate Paru", "price": 7000, "quantity": 1, "discount": 0},
            {"name": "Nasi Putih", "price": 7000, "quantity": 2, "discount": 0},
            {"name": "Teh Manis Es", "price": 8000, "quantity": 2, "discount": 0},
        ],
        "subtotal": 142000,
        "tax": 0,
        "service": 0,
        "total": 142000,
        "tax_included": False,
    })

    assert normalized["merchant"] == "Ayam Aroma"
    assert normalized["date"] == "2026-09-06"
    assert normalized["subtotal"] == 142000
    assert normalized["total"] == 142000
    assert [(item["name"], item["quantity"], item["price"]) for item in normalized["items"]] == [
        ("Bebek Goreng Dada", 1, 35000),
        ("Bebek Goreng Paha", 2, 35000),
        ("Sate Paru", 1, 7000),
        ("Nasi Putih", 2, 7000),
        ("Teh Manis Es", 2, 8000),
    ]
    assert all(set(item) == {"name", "price", "discount", "quantity"} for item in normalized["items"])


def test_unrelated_bad_request_does_not_trigger_json_fallback():
    assert not ocr._structured_response_rejected(400, "invalid image data")
    assert not ocr._structured_response_rejected(422, "missing image")
    assert ocr._structured_response_rejected(400, "response_format is unsupported")


if __name__ == "__main__":
    import pytest

    raise SystemExit(pytest.main([__file__, "-q"]))


def test_gemini_sends_downscaled_image(monkeypatch):
    """Gemini wajib menerima gambar yang sudah dikecilkan.

    Bug 1 Nov 2026: `_downscale` cuma dipanggil di jalur OpenRouter, sementara
    Pillow belum terpasang di venv sehingga fungsinya mengembalikan byte asli.
    Foto HP 3-4 MB dikirim apa adanya, permintaan Gemini melewati batas 15 detik
    per percobaan DUA KALI, dan 30 dari 45 detik anggaran habis sebelum satu pun
    model cadangan dicoba. Tes ini mengunci dua hal: hasil _downscale yang
    dipakai, dan mime ikut berubah jadi JPEG saat byte-nya berubah.
    """
    captured = {}

    class _Response:
        def read(self):
            return json.dumps({
                "candidates": [{"content": {"parts": [{"text": json.dumps({
                    "merchant": "Kecil",
                    "items": [],
                    "subtotal": 0,
                    "tax": 0,
                    "service": 0,
                    "total": 0,
                    "tax_included": False,
                })}]}}],
            }).encode()

    def fake_urlopen(request, timeout=None):
        captured["payload"] = json.loads(request.data)
        return _Response()

    monkeypatch.setattr(ocr, "GEMINI_API_KEY", "fake-gemini-key")
    monkeypatch.setattr(ocr, "_downscale", lambda raw, max_side=1280: b"kecil-jpeg")
    monkeypatch.setattr(ocr.urllib.request, "urlopen", fake_urlopen)

    result = ocr._gemini_ocr(b"x" * 5000, "image/png", time.monotonic() + 5)

    part = captured["payload"]["contents"][0]["parts"][0]["inline_data"]
    assert part["data"] == base64.b64encode(b"kecil-jpeg").decode()
    assert part["mime_type"] == "image/jpeg"
    assert result["merchant"] == "Kecil"


def test_gemini_quota_moves_to_next_key(monkeypatch):
    """429 kuota harus pindah KUNCI, bukan pindah model.

    Kuota gratis dihitung per project, jadi kunci yang habis akan menjawab 429
    untuk model apa pun. Kalau 429 malah dijawab dengan pindah model, seluruh
    daftar model habis dan kunci kedua yang masih punya kuota tidak pernah
    dicoba — itu kesalahan yang justru membuat fitur ini terlihat "tidak ada
    fallback".
    """
    used = []

    def fake(image_bytes, mime_type="image/jpeg", deadline=None, model=None, api_key=None):
        used.append((model, api_key))
        if api_key == "kunci-habis":
            raise ocr._GeminiFailure("quota", "kuota harian habis (reset tengah malam)", 429)
        return {"merchant": "Kedua", "items": [], "total": 0}

    monkeypatch.setattr(ocr, "_gemini_ocr", fake)
    monkeypatch.setattr(ocr, "GEMINI_API_KEYS", ("kunci-habis", "kunci-segar"))
    monkeypatch.setattr(ocr, "OR_API_KEY", "")

    result = ocr.ocr_receipt(b"image", "image/jpeg")

    assert result["merchant"] == "Kedua"
    # model pertama dicoba di kedua kunci sebelum pindah model
    assert used[:2] == [(ocr.GEMINI_MODELS[0], "kunci-habis"), (ocr.GEMINI_MODELS[0], "kunci-segar")]


def test_gemini_timeout_moves_to_next_model_not_next_key(monkeypatch):
    """Timeout itu antrean model, bukan kuota: kunci lain tidak menolong."""
    used = []

    def fake(image_bytes, mime_type="image/jpeg", deadline=None, model=None, api_key=None):
        used.append((model, api_key))
        if model == ocr.GEMINI_MODELS[0]:
            raise ocr._GeminiFailure("timeout", "Permintaan OCR gagal (waktu habis)")
        return {"merchant": "ModelKedua", "items": [], "total": 0}

    monkeypatch.setattr(ocr, "_gemini_ocr", fake)
    monkeypatch.setattr(ocr, "GEMINI_API_KEYS", ("kunci-satu", "kunci-dua"))
    monkeypatch.setattr(ocr, "OR_API_KEY", "")

    result = ocr.ocr_receipt(b"image", "image/jpeg")

    assert result["merchant"] == "ModelKedua"
    assert used[0] == (ocr.GEMINI_MODELS[0], "kunci-satu")
    assert used[1][0] == ocr.GEMINI_MODELS[1]
    # kunci kedua tidak dicoba untuk model pertama
    assert not [entry for entry in used if entry == (ocr.GEMINI_MODELS[0], "kunci-dua")]


def test_paid_openrouter_models_tried_before_free(monkeypatch):
    """Jalur berbayar murah dicoba sebelum model gratis yang butuh 48-168 detik."""
    calls = []

    def fake_openrouter(image_bytes, deadline, mime_type="image/jpeg", models=None):
        calls.append(models)
        return {"merchant": "Berbayar", "items": [], "total": 0}

    monkeypatch.setattr(ocr, "GEMINI_API_KEYS", ())
    monkeypatch.setattr(ocr, "GEMINI_API_KEY", "")
    monkeypatch.setattr(ocr, "OR_API_KEY", "kunci-openrouter")
    monkeypatch.setattr(ocr, "PAID_OPENROUTER_OCR_MODELS", ("google/gemini-2.5-flash:nitro",))
    monkeypatch.setattr(ocr, "_openrouter_ocr", fake_openrouter)

    result = ocr.ocr_receipt(b"image", "image/jpeg")

    assert result["merchant"] == "Berbayar"
    assert calls[0] == ("google/gemini-2.5-flash:nitro",)


def test_paid_models_not_offered_when_disallowed(monkeypatch):
    """Saklar biaya: BAGIIN_OCR_ALLOW_PAID=0 mengosongkan daftar berbayar."""
    monkeypatch.setenv("BAGIIN_OCR_ALLOW_PAID", "0")
    monkeypatch.delenv("BAGIIN_OCR_PAID_MODELS", raising=False)
    assert ocr._parse_paid_openrouter_models() == ()

    monkeypatch.setenv("BAGIIN_OCR_ALLOW_PAID", "1")
    models = ocr._parse_paid_openrouter_models()
    assert models and all(not ocr._is_free_openrouter_model(model) for model in models)
