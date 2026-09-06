"""Focused regressions for OCR normalization, booleans, dates, and uploads."""
import os
import sys
import tempfile
from pathlib import Path

os.environ["BAGIIN_DB"] = str(Path(tempfile.mkdtemp()) / "logic-fixes.db")
os.environ["BAGIIN_UPLOAD_DIR"] = tempfile.mkdtemp()
sys.path.insert(0, str(Path(__file__).resolve().parent))

import db
import ocr
from fastapi.testclient import TestClient
from main import app


db.init_db()
client = TestClient(app)


def headers(identity):
    return {"X-Identity-Id": identity["id"], "X-Identity-Secret": identity["secret"]}


def create_bill(owner, *, tax_included=False):
    response = client.post(
        "/api/bills",
        headers=headers(owner),
        json={
            "title": "logic regression",
            "items": [{"name": "item", "price": 100}],
            "subtotal": 100,
            "tax": 0,
            "service": 0,
            "total": 100,
            "tax_included": tax_included,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["id"]


def test_ocr_normalize_quantity_discount_duplicates_and_zero_reconcile():
    normalized = ocr._normalize({
        "items": [
            {"name": "same", "price": 100, "discount": 100, "quantity": 2},
            {"name": "same", "price": 100, "discount": 100},
        ],
        "subtotal": 999,
        "tax": 0,
        "service": 0,
        "total": 999,
        "tax_included": False,
    })
    assert len(normalized["items"]) == 2
    assert [item["quantity"] for item in normalized["items"]] == [2, 1]
    assert normalized["subtotal"] == 0
    assert normalized["total"] == 0


def test_ocr_normalize_quantity_scales_effective_subtotal():
    normalized = ocr._normalize({
        "items": [{"name": "x", "price": 250, "discount": 50, "quantity": 3}],
        "subtotal": 1,
        "tax": 10,
        "service": 5,
        "total": 16,
        "tax_included": False,
    })
    assert normalized["subtotal"] == 600
    assert normalized["total"] == 615


def test_ocr_date_requires_real_calendar_date():
    assert ocr._normalize({"date": "2026-08-08"})["date"] == "2026-08-08"
    assert ocr._normalize({"date": "2026-99-99"})["date"] == ""
    assert ocr._normalize({"date": "2026-02-30"})["date"] == ""


def test_create_and_update_string_false_is_not_tax_included():
    owner = db.new_identity("logic-bool-owner")
    bill_id = create_bill(owner, tax_included="false")
    assert db.get_bill(bill_id)["bill"]["tax_included"] == 0
    response = client.put(
        f"/api/bills/{bill_id}",
        headers=headers(owner),
        json={
            "title": "updated",
            "items": [{"id": db.get_bill(bill_id)["items"][0]["id"], "name": "item", "price": 100}],
            "subtotal": 100,
            "tax": 0,
            "service": 0,
            "total": 100,
            "tax_included": "false",
        },
    )
    assert response.status_code == 200, response.text
    assert db.get_bill(bill_id)["bill"]["tax_included"] == 0


def test_create_and_update_reject_malformed_tax_included():
    owner = db.new_identity("logic-malformed-bool")
    response = client.post(
        "/api/bills",
        headers=headers(owner),
        json={"title": "bad", "items": [{"name": "x", "price": 1}], "subtotal": 1, "tax": 0, "service": 0, "total": 1, "tax_included": "no"},
    )
    assert response.status_code == 400
    bill_id = create_bill(owner)
    item_id = db.get_bill(bill_id)["items"][0]["id"]
    response = client.put(
        f"/api/bills/{bill_id}",
        headers=headers(owner),
        json={"title": "bad", "items": [{"id": item_id, "name": "item", "price": 100}], "subtotal": 100, "tax": 0, "service": 0, "total": 100, "tax_included": "no"},
    )
    assert response.status_code == 400


def test_photo_uploads_require_matching_magic_bytes():
    owner = db.new_identity("logic-photo-owner")
    bill_id = create_bill(owner)
    for path, kwargs in (
        (f"/api/bills/{bill_id}/photo", {"headers": headers(owner)}),
        ("/api/photos", {"headers": headers(owner)}),
    ):
        response = client.post(path, files={"file": ("fake.bin", b"not-an-image", kwargs.pop("content_type", "image/jpeg"))}, **kwargs)
        assert response.status_code == 400, (path, response.text)


def test_photo_upload_accepts_declared_valid_signatures():
    owner = db.new_identity("logic-valid-photo")
    valid = {
        "image/jpeg": b"\xff\xd8\xff\xe0minimal",
        "image/png": b"\x89PNG\r\n\x1a\nminimal",
        "image/webp": b"RIFFxxxxWEBPminimal",
    }
    for mime, raw in valid.items():
        response = client.post("/api/photos", headers=headers(owner), files={"file": ("photo", raw, mime)})
        assert response.status_code == 200, (mime, response.text)
