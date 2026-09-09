"""Regression coverage for v82 backend integration audit.

Malformed collection fields must be client errors rather than uncaught TypeError
500s, and the unpaid-payment target must already belong to the bill just like
mark-paid does.
"""
import os
import sys
import tempfile
from pathlib import Path

_DB = Path(tempfile.mkdtemp(prefix="bagiin-v82-")) / "backend-audit.db"
os.environ["BAGIIN_DB"] = str(_DB)
os.environ.setdefault("BAGIIN_UPLOAD_DIR", str(
    Path(tempfile.mkdtemp(prefix="bagiin-v82-uploads-")) / "uploads"
))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import db
from fastapi.testclient import TestClient
import main
from main import app
import ocr


db.init_db()
app.state.limiter.enabled = False
client = TestClient(app, raise_server_exceptions=False)

# main.py binds the upload root when the app is imported. Other test modules
# may change BAGIIN_UPLOAD_DIR during collection, so assertions must follow
# the root the app actually uses rather than the mutable environment value.
_UPLOAD_DIR = main.UPLOAD_DIR
# Keep legacy tests that still read BAGIIN_UPLOAD_DIR aligned with the app after
# collection, when another module may have overwritten the process environment.
os.environ["BAGIIN_UPLOAD_DIR"] = str(_UPLOAD_DIR)


def _headers(identity):
    return {
        "X-Identity-Id": identity["id"],
        "X-Identity-Secret": identity["secret"],
    }


def _make_bill(owner):
    response = client.post(
        "/api/bills",
        headers=_headers(owner),
        json={
            "title": "Audit bill",
            "items": [{"name": "Meal", "price": 100}],
            "subtotal": 100,
            "tax": 0,
            "service": 0,
            "total": 100,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["id"]


def test_malformed_collection_fields_return_400_not_500():
    owner = db.new_identity("v82-owner")
    base = {
        "title": "Malformed",
        "items": [{"name": "Meal", "price": 100}],
        "subtotal": 100,
        "tax": 0,
        "service": 0,
        "total": 100,
    }

    create = client.post(
        "/api/bills",
        headers=_headers(owner),
        json={**base, "participants": 1},
    )
    assert create.status_code == 400, create.text

    bill_id = _make_bill(owner)
    item_id = client.get(f"/api/bills/{bill_id}").json()["items"][0]["id"]
    update = client.put(
        f"/api/bills/{bill_id}",
        headers=_headers(owner),
        json={**base, "items": [{"id": item_id, "name": "Meal", "price": 100}],
              "participants": 1},
    )
    assert update.status_code == 400, update.text

    guest = db.new_identity("v82-guest")
    assert client.post(
        f"/api/bills/{bill_id}/join", headers=_headers(guest), json={}
    ).status_code == 200
    for payload in ({"picks": 1}, {"item_ids": 1}):
        response = client.post(
            f"/api/bills/{bill_id}/selections",
            headers=_headers(guest),
            json=payload,
        )
        assert response.status_code == 400, (payload, response.text)


def test_mark_unpaid_rejects_non_member_but_allows_joined_target():
    owner = db.new_identity("v82-unpaid-owner")
    guest = db.new_identity("v82-unpaid-guest")
    stranger = db.new_identity("v82-unpaid-stranger")
    bill_id = _make_bill(owner)

    for target in (guest, stranger):
        response = client.post(
            f"/api/bills/{bill_id}/payments/{target['id']}/unpaid",
            headers=_headers(owner),
        )
        assert response.status_code == 404, (target, response.text)

    assert client.post(
        f"/api/bills/{bill_id}/join", headers=_headers(guest), json={}
    ).status_code == 200
    item_id = client.get(f"/api/bills/{bill_id}").json()["items"][0]["id"]
    assert client.post(
        f"/api/bills/{bill_id}/selections",
        headers=_headers(guest),
        json={"picks": [{"item_id": item_id}]},
    ).status_code == 200
    assert client.post(
        f"/api/bills/{bill_id}/payments/{guest['id']}/paid",
        headers=_headers(guest),
    ).status_code == 200
    response = client.post(
        f"/api/bills/{bill_id}/payments/{guest['id']}/unpaid",
        headers=_headers(owner),
    )
    assert response.status_code == 200, response.text


def test_bill_photo_db_failure_cleans_written_file(monkeypatch):
    """A failed bill_photo insert must not orphan the just-uploaded file."""
    owner = db.new_identity("v82-photo-owner")
    bill_id = _make_bill(owner)
    upload_dir = _UPLOAD_DIR
    before = {path.name for path in upload_dir.iterdir()}

    def fail_add_bill_photo(*args, **kwargs):
        raise RuntimeError("simulated database failure")

    monkeypatch.setattr(main.db, "add_bill_photo", fail_add_bill_photo)
    response = client.post(
        f"/api/bills/{bill_id}/photo",
        headers=_headers(owner),
        files={"file": ("receipt.jpg", b"\xff\xd8\xffreceipt", "image/jpeg")},
    )

    assert response.status_code == 500, response.text
    assert {path.name for path in upload_dir.iterdir()} == before


def test_ocr_numeric_tax_included_flag_is_true():
    """Provider JSON using 1 for true must not retain tax as extra money."""
    normalized = ocr._normalize({
        "items": [{"name": "Meal", "price": 1000}],
        "subtotal": 1000,
        "tax": 100,
        "service": 25,
        "total": 1125,
        "tax_included": 1,
    })

    assert normalized["tax_included"] is True
    assert normalized["tax"] == 0
    assert normalized["total"] == 1025


def test_standalone_photo_delete_respects_bare_referenced_path():
    """A legacy bare filename in bill_photo must still be protected."""
    owner = db.new_identity("v82-bare-photo-owner")
    stranger = db.new_identity("v82-bare-photo-stranger")
    uploaded = client.post(
        "/api/photos",
        headers=_headers(owner),
        files={"file": ("receipt.jpg", b"\xff\xd8\xffreceipt", "image/jpeg")},
    )
    assert uploaded.status_code == 200, uploaded.text
    filename = uploaded.json()["filename"]
    photo_path = _UPLOAD_DIR / filename
    assert photo_path.is_file()

    created = client.post(
        "/api/bills",
        headers=_headers(owner),
        json={
            "title": "Bare path",
            "items": [{"name": "Meal", "price": 100}],
            "subtotal": 100,
            "tax": 0,
            "service": 0,
            "total": 100,
            "photos": [filename],
        },
    )
    assert created.status_code == 200, created.text

    deleted = client.delete(f"/api/photos/{filename}", headers=_headers(stranger))
    assert deleted.status_code == 409, deleted.text
    assert photo_path.is_file()
