"""Deterministic regressions for one-request multi-image OCR uploads."""
import base64
import json
import os
import sys
import tempfile
import time
from pathlib import Path

import pytest

_DB = Path(tempfile.mkdtemp(prefix="bagiin-v77-")) / "multi-image.db"
os.environ["BAGIIN_DB"] = str(_DB)
os.environ.setdefault(
    "BAGIIN_UPLOAD_DIR",
    str(Path(tempfile.mkdtemp(prefix="bagiin-v77-uploads-")) / "uploads"),
)
sys.path.insert(0, str(Path(__file__).resolve().parent))

import db
import main
import ocr
from fastapi.testclient import TestClient


db.init_db()
main.limiter.enabled = False
client = TestClient(main.app, raise_server_exceptions=False)


class _Response:
    def __init__(self, payload):
        self._payload = json.dumps(payload).encode()

    def read(self):
        return self._payload


def _gemini_response():
    return _Response({
        "candidates": [{
            "content": {
                "parts": [{
                    "text": json.dumps({
                        "items": [{"name": "Item", "price": 100}],
                        "subtotal": 100,
                        "tax": 0,
                        "service": 0,
                        "total": 100,
                        "tax_included": False,
                    }),
                }],
            },
        }],
    })


def _openrouter_response():
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


def _headers(identity):
    return {
        "X-Identity-Id": identity["id"],
        "X-Identity-Secret": identity["secret"],
    }


def _jpeg(marker=b"jpeg"):
    return b"\xff\xd8\xff" + marker


def _ocr_result():
    return {
        "merchant": "Warung",
        "date": "",
        "items": [{"name": "Item", "price": 100, "discount": 0, "quantity": 1}],
        "subtotal": 100,
        "tax": 0,
        "service": 0,
        "total": 100,
        "tax_included": False,
    }


# Provider request construction


def test_gemini_sends_all_images_before_one_combining_prompt(monkeypatch):
    requests = []
    monkeypatch.setattr(ocr, "GEMINI_API_KEY", "fake-gemini-key")
    monkeypatch.setattr(
        ocr.urllib.request,
        "urlopen",
        lambda request, timeout=None: (requests.append(request) or _gemini_response()),
    )

    first = b"first-image"
    second = b"second-image"
    result = ocr._gemini_ocr(
        [(first, "image/jpeg"), (second, "image/png")],
        "image/jpeg",
        time.monotonic() + 5,
    )

    assert result["total"] == 100
    assert len(requests) == 1
    parts = _request_payload(requests[0])["contents"][0]["parts"]
    assert [part["inline_data"]["mime_type"] for part in parts[:2]] == [
        "image/jpeg",
        "image/png",
    ]
    assert [
        base64.b64decode(part["inline_data"]["data"])
        for part in parts[:2]
    ] == [first, second]
    assert parts[2] == {"text": ocr.SYSTEM_PROMPT}


def test_openrouter_sends_all_images_in_upload_order(monkeypatch):
    requests = []
    monkeypatch.setattr(ocr, "_downscale", lambda image: image)
    monkeypatch.setattr(
        ocr.urllib.request,
        "urlopen",
        lambda request, timeout=None: (requests.append(request) or _openrouter_response()),
    )

    first = b"first-image"
    second = b"second-image"
    result = ocr._openrouter_ocr(
        [(first, "image/jpeg"), (second, "image/webp")],
        time.monotonic() + 5,
    )

    assert result["total"] == 100
    content = _request_payload(requests[0])["messages"][0]["content"]
    assert content[0] == {"type": "text", "text": ocr.SYSTEM_PROMPT}
    assert [part["image_url"]["url"].split(",", 1)[0] for part in content[1:]] == [
        "data:image/jpeg;base64",
        "data:image/webp;base64",
    ]
    assert [
        base64.b64decode(part["image_url"]["url"].split(",", 1)[1])
        for part in content[1:]
    ] == [first, second]


# OCR price semantics


def test_original_and_paid_unit_prices_produce_per_unit_discount_and_subtotal():
    normalized = ocr._normalize({
        "items": [{
            "name": "Ayam",
            "original_unit_price": 23000,
            "paid_unit_price": 18000,
            "quantity": 2,
        }],
        "subtotal": 0,
        "tax": 0,
        "service": 0,
        "total": 0,
        "tax_included": False,
    })

    assert normalized["items"] == [{
        "name": "Ayam",
        "price": 23000,
        "discount": 5000,
        "quantity": 2,
    }]
    assert normalized["subtotal"] == 36000
    assert normalized["total"] == 36000


def test_price_plus_paid_unit_price_also_derives_discount():
    normalized = ocr._normalize({
        "items": [{
            "name": "Ayam",
            "price": 23000,
            "paid_price": 18000,
            "quantity": 2,
        }],
        "tax": 0,
        "service": 0,
        "total": 0,
    })

    assert normalized["items"][0]["price"] == 23000
    assert normalized["items"][0]["discount"] == 5000
    assert normalized["subtotal"] == 36000


def test_ocr_money_truncates_fractional_rupiah_toward_zero():
    normalized = ocr._normalize({
        "items": [{"name": "Item", "price": 23666.666666}],
        "subtotal": 23666.666666,
        "tax": 0,
        "service": 0,
        "total": 23666.666666,
    })

    assert normalized["items"][0]["price"] == 23666
    assert normalized["subtotal"] == 23666
    assert normalized["total"] == 23666
    assert isinstance(normalized["items"][0]["price"], int)


def test_order_level_percentage_or_discount_is_not_item_rupiah(monkeypatch):
    normalized = ocr._normalize({
        "items": [{
            "name": "Item",
            "price": 10000,
            "discount": "10%",
            "discount_percent": 10,
        }],
        "order_discount": 5000,
        "subtotal": 5000,
        "tax": 0,
        "service": 0,
        "total": 5000,
    })

    assert normalized["items"][0]["discount"] == 0
    assert normalized["order_discount"] == 5000
    assert normalized["subtotal"] == 10000
    assert normalized["total"] == 5000


# Endpoint upload contract


def test_ocr_endpoint_uses_one_provider_call_and_returns_ordered_photos(monkeypatch, tmp_path):
    owner = db.new_identity("v77-two-images")
    provider_inputs = []
    upload_dir = tmp_path / "uploads"
    upload_dir.mkdir()
    monkeypatch.setattr(main, "UPLOAD_DIR", upload_dir)

    def fake_ocr(images, mime_type="image/jpeg"):
        provider_inputs.append((images, mime_type))
        assert list(upload_dir.iterdir()) == []
        return _ocr_result()

    monkeypatch.setattr(main, "ocr_receipt", fake_ocr)
    first = _jpeg(b"first")
    second = _jpeg(b"second")
    response = client.post(
        "/api/ocr",
        files=[
            ("file", ("first.jpg", first, "image/jpeg")),
            ("file", ("second.jpg", second, "image/jpeg")),
        ],
        headers=_headers(owner),
    )

    assert response.status_code == 200, response.text
    assert len(provider_inputs) == 1
    assert provider_inputs[0] == ([(first, "image/jpeg"), (second, "image/jpeg")], "image/jpeg")
    body = response.json()
    assert len(body["photos"]) == 2
    assert body["photo_path"] == body["photos"][0]
    assert [Path(path).read_bytes() for path in body["photos"]] == [first, second]


def test_ocr_endpoint_preserves_legacy_one_file_bytes_and_photo_path(monkeypatch, tmp_path):
    owner = db.new_identity("v77-one-image")
    provider_inputs = []
    upload_dir = tmp_path / "uploads"
    upload_dir.mkdir()
    monkeypatch.setattr(main, "UPLOAD_DIR", upload_dir)
    monkeypatch.setattr(
        main,
        "ocr_receipt",
        lambda image, mime_type="image/jpeg": (
            provider_inputs.append((image, mime_type)) or _ocr_result()
        ),
    )
    image = _jpeg(b"legacy")

    response = client.post(
        "/api/ocr",
        files={"file": ("receipt.jpg", image, "image/jpeg")},
        headers=_headers(owner),
    )

    assert response.status_code == 200, response.text
    assert provider_inputs == [(image, "image/jpeg")]
    body = response.json()
    assert body["photos"] == [body["photo_path"]]
    assert Path(body["photo_path"]).read_bytes() == image


@pytest.mark.parametrize(
    "files",
    [
        [
            ("file", ("one.jpg", _jpeg(b"1"), "image/jpeg")),
            ("file", ("two.jpg", _jpeg(b"2"), "image/jpeg")),
            ("file", ("three.jpg", _jpeg(b"3"), "image/jpeg")),
        ],
        [("file", ("bad.jpg", b"not-a-jpeg", "image/jpeg"))],
        [("file", ("bad.txt", _jpeg(b"1"), "text/plain"))],
        [("file", ("large.jpg", b"\xff\xd8\xff" + b"x" * (5 * 1024 * 1024), "image/jpeg"))],
    ],
)
def test_ocr_endpoint_rejects_invalid_batch_before_provider_or_file_write(
    monkeypatch,
    tmp_path,
    files,
):
    owner = db.new_identity("v77-invalid-" + str(len(files)) + str(len(files[0][1][1])))
    upload_dir = tmp_path / "uploads"
    upload_dir.mkdir()
    monkeypatch.setattr(main, "UPLOAD_DIR", upload_dir)
    calls = []
    monkeypatch.setattr(
        main,
        "ocr_receipt",
        lambda *args, **kwargs: calls.append((args, kwargs)) or _ocr_result(),
    )

    response = client.post("/api/ocr", files=files, headers=_headers(owner))

    assert response.status_code == 400, response.text
    assert calls == []
    assert list(upload_dir.iterdir()) == []


def test_ocr_endpoint_does_not_save_when_provider_fails(monkeypatch, tmp_path):
    owner = db.new_identity("v77-provider-failure")
    upload_dir = tmp_path / "uploads"
    upload_dir.mkdir()
    monkeypatch.setattr(main, "UPLOAD_DIR", upload_dir)
    calls = []

    def failed_ocr(*args, **kwargs):
        calls.append(True)
        raise RuntimeError("provider failed")

    monkeypatch.setattr(main, "ocr_receipt", failed_ocr)
    response = client.post(
        "/api/ocr",
        files=[("file", ("one.jpg", _jpeg(b"1"), "image/jpeg"))],
        headers=_headers(owner),
    )

    assert response.status_code == 422, response.text
    assert calls == [True]
    assert list(upload_dir.iterdir()) == []


def test_ocr_endpoint_rolls_back_all_paths_after_write_failure(monkeypatch, tmp_path):
    owner = db.new_identity("v77-write-failure")
    upload_dir = tmp_path / "uploads"
    upload_dir.mkdir()
    monkeypatch.setattr(main, "UPLOAD_DIR", upload_dir)
    monkeypatch.setattr(main, "ocr_receipt", lambda *args, **kwargs: _ocr_result())
    original_write = Path.write_bytes
    writes = []

    def flaky_write(path, data):
        original_write(path, data)
        writes.append(path)
        if len(writes) == 2:
            raise OSError("simulated second write failure")
        return len(data)

    monkeypatch.setattr(Path, "write_bytes", flaky_write)
    response = client.post(
        "/api/ocr",
        files=[
            ("file", ("one.jpg", _jpeg(b"1"), "image/jpeg")),
            ("file", ("two.jpg", _jpeg(b"2"), "image/jpeg")),
        ],
        headers=_headers(owner),
    )

    assert response.status_code == 500, response.text
    assert len(writes) == 2
    assert list(upload_dir.iterdir()) == []


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-q"]))
