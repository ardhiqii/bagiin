"""Deterministic regressions for free-provider OCR receipt accuracy.

These tests exercise request construction and normalization only. They never call
Gemini or OpenRouter.
"""
import base64
from email.message import Message
import io
import json
import os
import sys
import tempfile
import time
import urllib.error
from pathlib import Path

os.environ.setdefault("BAGIIN_DB", str(Path(tempfile.mkdtemp()) / "ocr-accuracy.db"))
os.environ.setdefault("BAGIIN_UPLOAD_DIR", str(Path(tempfile.mkdtemp()) / "uploads"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import ocr


class _Response:
    def __init__(self, payload):
        self._payload = json.dumps(payload).encode()

    def read(self):
        return self._payload


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


def urllib_http_error(request, body):
    """Build a provider-like 400 without putting a credential in the fixture."""
    return urllib.error.HTTPError(
        request.full_url,
        400,
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
