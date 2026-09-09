"""Regression coverage for canonical bill totals from normalized items."""
import os
import sys
import tempfile
from pathlib import Path

import pytest

_DB = Path(tempfile.mkdtemp(prefix="bagiin-v79-")) / "bill-sync.db"
os.environ["BAGIIN_DB"] = str(_DB)
os.environ.setdefault(
    "BAGIIN_UPLOAD_DIR",
    str(Path(tempfile.mkdtemp(prefix="bagiin-v79-uploads-")) / "uploads"),
)
sys.path.insert(0, str(Path(__file__).resolve().parent))

import db
from fastapi.testclient import TestClient
from main import app


db.init_db()
app.state.limiter.enabled = False
client = TestClient(app, raise_server_exceptions=False)


def _headers(identity):
    return {
        "X-Identity-Id": identity["id"],
        "X-Identity-Secret": identity["secret"],
    }


def _detail(bill_id):
    response = client.get(f"/api/bills/{bill_id}")
    assert response.status_code == 200, response.text
    return response.json()


def _assert_invariant(data):
    assert data["total_ok"] is True, data
    assert (
        sum(person["total_idr"] for person in data["people"])
        + data["uncovered_idr"]
        + data["remaining_to_creator"]
        == data["bill"]["total_idr"]
    )


@pytest.mark.parametrize("omit_subtotal", [False, True])
def test_create_canonicalizes_stale_or_omitted_subtotal(omit_subtotal):
    owner = db.new_identity(f"v79-create-{omit_subtotal}")
    payload = {
        "title": "Canonical create",
        "items": [{
            "name": "Nasi",
            "price": 1000,
            "discount": 100,
            "quantity": 2,
        }],
        "tax": 50,
        "service": 25,
        "order_discount": 100,
        # (1000 - 100) * 2 = 1800; the old OCR subtotal is stale.
        "subtotal": 9999,
        "total": 1775,
    }
    if omit_subtotal:
        del payload["subtotal"]

    response = client.post("/api/bills", json=payload, headers=_headers(owner))
    assert response.status_code == 200, response.text
    data = _detail(response.json()["id"])

    assert data["bill"]["subtotal_idr"] == 1800
    assert data["bill"]["order_discount_idr"] == 100
    assert data["bill"]["total_idr"] == 1775
    assert data["items"][0]["discount_idr"] == 100
    assert data["items"][0]["quantity"] == 2
    _assert_invariant(data)


def test_update_canonicalizes_stale_subtotal_and_persists_quantity_discount():
    owner = db.new_identity("v79-update")
    create = client.post(
        "/api/bills",
        json={
            "title": "Before edit",
            "items": [{"name": "Item", "price": 1000}],
            "subtotal": 1000,
            "tax": 25,
            "service": 25,
            "total": 1050,
        },
        headers=_headers(owner),
    )
    assert create.status_code == 200, create.text
    bill_id = create.json()["id"]
    item_id = _detail(bill_id)["items"][0]["id"]

    # (2000 - 250) * 3 = 5250. The submitted subtotal is from before the edit.
    response = client.put(
        f"/api/bills/{bill_id}",
        json={
            "title": "After edit",
            "items": [{
                "id": item_id,
                "name": "Item updated",
                "price": 2000,
                "discount": 250,
                "quantity": 3,
            }],
            "subtotal": 1000,
            "tax": 100,
            "service": 50,
            "order_discount": 200,
            "total": 5200,
        },
        headers=_headers(owner),
    )
    assert response.status_code == 200, response.text
    data = _detail(bill_id)

    assert data["bill"]["subtotal_idr"] == 5250
    assert data["bill"]["order_discount_idr"] == 200
    assert data["bill"]["total_idr"] == 5200
    item = data["items"][0]
    assert item["name"] == "Item updated"
    assert item["price_idr"] == 2000
    assert item["discount_idr"] == 250
    assert item["quantity"] == 3
    _assert_invariant(data)


def test_total_and_order_discount_are_validated_against_canonical_subtotal():
    owner = db.new_identity("v79-validate")
    before = len(db.get_bills_for_identity(owner["id"]))

    # The stale subtotal would make this discount look valid; the current item
    # subtotal is only 100, so the write must be rejected before persistence.
    response = client.post(
        "/api/bills",
        json={
            "title": "Invalid discount",
            "items": [{"name": "Item", "price": 100}],
            "subtotal": 10000,
            "tax": 0,
            "service": 0,
            "order_discount": 101,
            "total": 9899,
        },
        headers=_headers(owner),
    )
    assert response.status_code == 400, response.text
    assert len(db.get_bills_for_identity(owner["id"])) == before

    # A stale subtotal alone is harmless, but an inconsistent total is not.
    response = client.post(
        "/api/bills",
        json={
            "title": "Invalid total",
            "items": [{"name": "Item", "price": 100}],
            "subtotal": 10000,
            "tax": 0,
            "service": 0,
            "total": 10000,
        },
        headers=_headers(owner),
    )
    assert response.status_code == 400, response.text
    assert len(db.get_bills_for_identity(owner["id"])) == before
