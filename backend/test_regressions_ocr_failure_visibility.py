"""Regresi: kegagalan penyedia OCR tidak boleh jadi kalimat generik tanpa jejak.

Bug aslinya (26 Okt): Gemini membalas 429, lalu `ocr_receipt` mencoba OpenRouter
dan exception yang lolos bukan RuntimeError (urllib.error.HTTPError/TimeoutError).
`main.ocr_upload` hanya menangkap RuntimeError untuk pesan spesifik, jadi
pengguna melihat "Layanan AI sedang mengalami gangguan" — bukan pesan kuota
penuh — dan penyebabnya tidak pernah masuk log sama sekali.
"""

import io
import os
import sys
import tempfile
import urllib.error
from pathlib import Path

os.environ.setdefault("BAGIIN_DB", str(Path(tempfile.mkdtemp(prefix="bagiin-ocrfix-")) / "ocrfix.db"))
os.environ.setdefault(
    "BAGIIN_UPLOAD_DIR",
    str(Path(tempfile.mkdtemp(prefix="bagiin-ocrfix-up-")) / "uploads"),
)
sys.path.insert(0, str(Path(__file__).resolve().parent))

from fastapi.testclient import TestClient

import db
import main

client = TestClient(main.app, raise_server_exceptions=False)


def _jpeg(seed: bytes) -> bytes:
    return b"\xff\xd8\xff" + seed


def _headers(identity) -> dict:
    return {"X-Identity-Id": identity["id"], "X-Identity-Secret": identity["secret"]}


def test_ocr_http_error_becomes_quota_message(monkeypatch):
    owner = db.new_identity("ocr-http-error")
    url = "https://generativelanguage.googleapis.com/v1beta/models/x:generateContent"
    error = urllib.error.HTTPError(url, 429, "Too Many Requests", {}, io.BytesIO(b"quota"))

    def explode(image, mime_type="image/jpeg"):
        raise error

    monkeypatch.setattr(main, "ocr_receipt", explode)
    response = client.post(
        "/api/ocr",
        files=[("file", ("receipt.jpg", _jpeg(b"a"), "image/jpeg"))],
        headers=_headers(owner),
    )

    assert response.status_code == 422, response.text
    detail = response.json()["detail"]
    assert "sedang penuh" in detail
    assert "isi secara manual" in detail.lower()


def test_ocr_timeout_becomes_quota_message(monkeypatch):
    owner = db.new_identity("ocr-timeout")

    def explode(image, mime_type="image/jpeg"):
        raise TimeoutError("timed out")

    monkeypatch.setattr(main, "ocr_receipt", explode)
    response = client.post(
        "/api/ocr",
        files=[("file", ("receipt.jpg", _jpeg(b"b"), "image/jpeg"))],
        headers=_headers(owner),
    )

    assert response.status_code == 422, response.text
    assert "sedang penuh" in response.json()["detail"]


def test_ocr_provider_failure_is_logged(monkeypatch, caplog):
    """Kegagalan yang tidak dikenali tetap harus meninggalkan jejak di log."""
    owner = db.new_identity("ocr-logged")

    def explode(image, mime_type="image/jpeg"):
        raise ValueError("provider payload rusak")

    monkeypatch.setattr(main, "ocr_receipt", explode)
    with caplog.at_level("ERROR", logger="bagiin"):
        response = client.post(
            "/api/ocr",
            files=[("file", ("receipt.jpg", _jpeg(b"c"), "image/jpeg"))],
            headers=_headers(owner),
        )

    assert response.status_code == 422, response.text
    assert any("OCR gagal" in record.message or "OCR gagal" in record.getMessage() for record in caplog.records)


def test_ocr_receipt_swallows_non_runtime_provider_errors(monkeypatch):
    """ocr_receipt sendiri harus lanjut ke cadangan, bukan meledak ke pemanggil."""
    import ocr

    calls = []

    def gemini_fails(image, mime_type="image/jpeg", deadline=None):
        calls.append("gemini")
        raise urllib.error.URLError("connection reset")

    def openrouter_works(image, deadline=None, mime_type="image/jpeg"):
        calls.append("openrouter")
        return {"merchant": "WARTEG BAHARI", "items": [], "total": 0}

    monkeypatch.setattr(ocr, "GEMINI_API_KEY", "k")
    monkeypatch.setattr(ocr, "OR_API_KEY", "k")
    monkeypatch.setattr(ocr, "_gemini_ocr", gemini_fails)
    monkeypatch.setattr(ocr, "_openrouter_ocr", openrouter_works)

    result = ocr.ocr_receipt(b"fake-image", "image/jpeg")

    assert calls == ["gemini", "openrouter"]
    assert result["merchant"] == "WARTEG BAHARI"
