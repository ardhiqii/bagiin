"""Batas jumlah foto per pembacaan OCR.

Struk panjang sering difoto dua atau tiga kali, jadi batasnya dinaikkan dari 2
ke 4. Yang dijaga di sini bukan kualitas bacaan model (itu diuji manual dengan
potongan struk asli), melainkan kontrak HTTP-nya: tiga dan empat foto diterima,
lima ditolak dengan pesan yang menyebut batas barunya.
"""

import os
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("BAGIIN_DB", str(Path(tempfile.mkdtemp(prefix="bagiin-ocrlimit-")) / "limit.db"))
os.environ.setdefault(
    "BAGIIN_UPLOAD_DIR",
    str(Path(tempfile.mkdtemp(prefix="bagiin-ocrlimit-up-")) / "uploads"),
)
sys.path.insert(0, str(Path(__file__).resolve().parent))

from fastapi.testclient import TestClient

import main

client = TestClient(main.app, raise_server_exceptions=False)


def _identity() -> dict:
    res = client.post("/api/identities", json={"name": "Penguji"})
    assert res.status_code == 200, res.text
    return res.json()


def _headers(identity: dict) -> dict:
    return {"X-Identity-Id": identity["id"], "X-Identity-Secret": identity["secret"]}


def _files(count: int):
    # isi byte tidak perlu gambar asli: batas jumlah diperiksa sebelum OCR jalan
    return [
        ("file", (f"foto{i}.png", b"\x89PNG\r\n\x1a\n" + bytes(64), "image/png"))
        for i in range(count)
    ]


def _fake_ocr(_images, mime_type=None):
    return {
        "items": [{"name": "Soto", "price": 13000, "quantity": 1}],
        "subtotal": 13000,
        "total": 13000,
    }


def test_tiga_foto_diterima(monkeypatch):
    monkeypatch.setattr(main, "ocr_receipt", _fake_ocr)
    res = client.post("/api/ocr", files=_files(3), headers=_headers(_identity()))
    assert res.status_code == 200, res.text
    assert res.json()["items"][0]["name"] == "Soto"


def test_empat_foto_diterima(monkeypatch):
    monkeypatch.setattr(main, "ocr_receipt", _fake_ocr)
    res = client.post("/api/ocr", files=_files(4), headers=_headers(_identity()))
    assert res.status_code == 200, res.text


def test_lima_foto_ditolak_dengan_pesan_baru():
    res = client.post("/api/ocr", files=_files(5), headers=_headers(_identity()))
    assert res.status_code == 400, res.text
    assert "Maksimal 4 foto" in res.json()["detail"]
