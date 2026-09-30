"""Regression coverage for the optional bounded local OCR fallback."""
import os
from pathlib import Path
import shutil
import sys
import tempfile

import pytest

os.environ.setdefault("BAGIIN_DB", str(Path(tempfile.mkdtemp()) / "ocr-local.db"))
os.environ.setdefault("BAGIIN_UPLOAD_DIR", str(Path(tempfile.mkdtemp()) / "uploads"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import ocr


def _normalized_result(merchant="Local Warung"):
    return {
        "merchant": merchant,
        "date": "2026-09-30",
        "items": [{"name": "Nasi", "price": 12000, "discount": 0, "quantity": 1}],
        "subtotal": 12000,
        "order_discount": 0,
        "tax": 0,
        "service": 0,
        "total": 12000,
        "tax_included": False,
    }


def test_provider_exhaustion_reaches_local_fallback(monkeypatch):
    calls = []
    monkeypatch.setattr(ocr, "GEMINI_API_KEY", "gemini-test")
    monkeypatch.setattr(ocr, "OR_API_KEY", "openrouter-test")
    monkeypatch.setattr(ocr, "_local_ocr_available", lambda: True)

    def fail_gemini(*args, **kwargs):
        calls.append("gemini")
        raise RuntimeError("provider failure")

    def fail_openrouter(*args, **kwargs):
        calls.append("openrouter")
        raise RuntimeError("provider failure")

    def local(image_bytes, mime_type, deadline):
        calls.append("local")
        assert image_bytes == b"image"
        assert mime_type == "image/jpeg"
        assert deadline > 0
        return _normalized_result()

    monkeypatch.setattr(ocr, "_gemini_ocr", fail_gemini)
    monkeypatch.setattr(ocr, "_openrouter_ocr", fail_openrouter)
    monkeypatch.setattr(ocr, "_local_ocr", local)

    assert ocr.ocr_receipt(b"image", "image/jpeg") == _normalized_result()
    assert calls == ["gemini", "openrouter", "local"]


def test_local_text_normalization_is_conservative_and_contract_compatible():
    result = ocr._normalize_local_text(
        """WARUNG MAKMUR
08/08/2026
2 x AYAM BAKAR 35.000 70.000
ES TEH 7.000
Subtotal 77.000
PPN 7.700
Service 3.000
Total 87.700
"""
    )

    assert result == {
        "merchant": "WARUNG MAKMUR",
        "date": "2026-08-08",
        "items": [
            {"name": "AYAM BAKAR", "price": 35000, "discount": 0, "quantity": 2},
            {"name": "ES TEH", "price": 7000, "discount": 0, "quantity": 1},
        ],
        "subtotal": 77000,
        "order_discount": 0,
        "tax": 7700,
        "service": 3000,
        "total": 87700,
        "tax_included": False,
    }


@pytest.mark.parametrize(
    "metadata_line",
    [
        "Invoice 12345",
        "Order #12345",
        "Receipt No 12345",
        "Jl. Sudirman 123",
        "Cashier: Budi 123",
        "Phone: 0812 123",
        "Telp: 0812 123",
    ],
)
def test_local_text_metadata_only_is_unusable(metadata_line):
    with pytest.raises(RuntimeError, match="tidak berisi data struk"):
        ocr._normalize_local_text(metadata_line)


def test_local_text_metadata_does_not_become_item_when_receipt_has_real_item():
    result = ocr._normalize_local_text(
        """Invoice 12345
Cashier: Budi 123
Nasi Goreng 25.000
"""
    )

    assert result["items"] == [
        {"name": "Nasi Goreng", "price": 25000, "discount": 0, "quantity": 1}
    ]


def test_local_ocr_timeout_cleans_isolated_temp_directory(monkeypatch, tmp_path):
    created = tmp_path / "ocr-run"

    class TemporaryDirectory:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            created.mkdir()
            return str(created)

        def __exit__(self, exc_type, exc, traceback):
            shutil.rmtree(created)
            return False

    monkeypatch.setattr(ocr, "_local_ocr_available", lambda: True)
    monkeypatch.setattr(ocr.shutil, "which", lambda name: "/usr/bin/tesseract")
    monkeypatch.setattr(ocr.tempfile, "TemporaryDirectory", TemporaryDirectory)

    def timeout(*args, **kwargs):
        raise ocr.subprocess.TimeoutExpired(kwargs.get("args", args[0]), kwargs["timeout"])

    monkeypatch.setattr(ocr.subprocess, "run", timeout)
    with pytest.raises(RuntimeError, match="batas waktu"):
        ocr._local_ocr(b"image", deadline=ocr.time.monotonic() + 1)
    assert not created.exists()


def test_local_ocr_process_error_cleans_isolated_temp_directory(monkeypatch, tmp_path):
    created = tmp_path / "ocr-run"

    class TemporaryDirectory:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            created.mkdir()
            return str(created)

        def __exit__(self, exc_type, exc, traceback):
            shutil.rmtree(created)
            return False

    monkeypatch.setattr(ocr, "_local_ocr_available", lambda: True)
    monkeypatch.setattr(ocr.shutil, "which", lambda name: "/usr/bin/tesseract")
    monkeypatch.setattr(ocr.tempfile, "TemporaryDirectory", TemporaryDirectory)
    monkeypatch.setattr(
        ocr.subprocess,
        "run",
        lambda *args, **kwargs: type("Completed", (), {"returncode": 1, "stdout": b"", "stderr": b"private"})(),
    )

    with pytest.raises(RuntimeError, match="gagal membaca"):
        ocr._local_ocr(b"image", deadline=ocr.time.monotonic() + 1)
    assert not created.exists()


def test_local_ocr_missing_binary_is_a_manual_fallback(monkeypatch):
    monkeypatch.setattr(ocr.shutil, "which", lambda name: None)
    monkeypatch.delenv("BAGIIN_LOCAL_OCR_ENABLED", raising=False)
    assert ocr._local_ocr_available() is False
    with pytest.raises(RuntimeError, match="tidak tersedia"):
        ocr._local_ocr(b"image")


def test_local_ocr_safe_env_disable_wins_over_present_binary(monkeypatch):
    monkeypatch.setattr(ocr.shutil, "which", lambda name: "/usr/bin/tesseract")
    monkeypatch.setenv("BAGIIN_LOCAL_OCR_ENABLED", "false")
    assert ocr._local_ocr_available() is False
