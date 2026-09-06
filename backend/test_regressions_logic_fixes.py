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


def test_selection_failure_does_not_claim_matching_participant(monkeypatch):
    owner = db.new_identity("logic-race-owner")
    guest = db.new_identity("logic-race-guest")
    bill = db.create_bill(
        creator_id=owner["id"],
        title="selection failure",
        tax_mode="proportional",
        items=[{"name": "slot", "price": 100, "mode": "slot", "slot_count": 1}],
        participants=[guest["name"]],
        subtotal=100,
        tax=0,
        service=0,
        total=100,
    )
    bill_id = bill["id"]
    item_id = db.get_bill(bill_id)["items"][0]["id"]

    def fail_set_selections(*args, **kwargs):
        raise ValueError("Slot tersisa 0")

    monkeypatch.setattr(db, "set_selections", fail_set_selections)
    response = client.post(
        f"/api/bills/{bill_id}/selections",
        headers=headers(guest),
        json={"picks": [{"item_id": item_id, "qty": 1}]},
    )

    assert response.status_code == 400
    live = db.get_bill(bill_id)
    participant = next(p for p in live["participants"] if p["name"] == guest["name"])
    assert participant["identity_id"] is None
    assert not any(p["identity_id"] == guest["id"] for p in live["payments"])
    assert not any(s["identity_id"] == guest["id"] for s in live["selections"])


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


def test_auto_accept_missing_field_is_rejected():
    owner = db.new_identity("logic-auto-accept-missing")
    response = client.post(
        f"/api/identities/{owner['id']}/auto_accept",
        headers=headers(owner),
        json={},
    )
    assert response.status_code == 400, response.text
    fresh = db.get_identity(owner["id"])
    assert fresh and fresh["auto_accept"] == 1


def test_photo_uploads_require_matching_magic_bytes():
    owner = db.new_identity("logic-photo-owner")
    bill_id = create_bill(owner)
    for path, kwargs in (
        (f"/api/bills/{bill_id}/photo", {"headers": headers(owner)}),
        ("/api/photos", {"headers": headers(owner)}),
    ):
        response = client.post(path, files={"file": ("fake.bin", b"not-an-image", kwargs.pop("content_type", "image/jpeg"))}, **kwargs)
        assert response.status_code == 400, (path, response.text)


def test_ocr_rejects_arbitrary_bytes_before_provider_call():
    owner = db.new_identity("logic-ocr-bytes")
    response = client.post(
        "/api/ocr",
        headers=headers(owner),
        files={"file": ("receipt.jpg", b"not-an-image", "image/jpeg")},
    )
    assert response.status_code == 400
    assert "Isi file" in response.text


def test_photo_upload_accepts_declared_valid_signatures():
    owner = db.new_identity("logic-valid-photo")
    valid = {
        "image/jpeg": (b"\xff\xd8\xff\xe0minimal", ".jpg"),
        "image/png": (b"\x89PNG\r\n\x1a\nminimal", ".png"),
        "image/webp": (b"RIFFxxxxWEBPminimal", ".webp"),
    }
    for mime, (raw, suffix) in valid.items():
        response = client.post("/api/photos", headers=headers(owner), files={"file": ("photo", raw, mime)})
        assert response.status_code == 200, (mime, response.text)
        filename = response.json()["filename"]
        assert filename.endswith(suffix)
        served = client.get(f"/uploads/{filename}")
        assert served.status_code == 200
        assert served.headers["content-type"] == mime
        assert served.headers["x-content-type-options"] == "nosniff"
