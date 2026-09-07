"""Regression coverage for malformed bill input returning client errors."""
import os
import sys
import tempfile
from pathlib import Path

_DB = Path(tempfile.mkdtemp(prefix="bagiin-v74-")) / "malformed-input.db"
os.environ["BAGIIN_DB"] = str(_DB)
os.environ["BAGIIN_UPLOAD_DIR"] = str(Path(tempfile.mkdtemp(prefix="bagiin-v74-uploads-")) / "uploads")
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


def _create_payload(**overrides):
    payload = {
        "title": "Bill v74",
        "items": [{"name": "Nasi", "price": 100, "discount": 0, "mode": "free"}],
        "subtotal": 100,
        "tax": 0,
        "service": 0,
        "total": 100,
    }
    payload.update(overrides)
    return payload


def _create_bill(identity, **overrides):
    response = client.post(
        "/api/bills",
        json=_create_payload(**overrides),
        headers=_headers(identity),
    )
    assert response.status_code == 200, response.text
    return response.json()["id"]


def _valid_followup_create(identity):
    """A successful bill write proves the rejected request did not wedge SQLite."""
    _create_bill(identity, title="Follow-up bill")


def _valid_update(identity, bill_id, item_id, *, name="Updated"):
    response = client.put(
        f"/api/bills/{bill_id}",
        json=_create_payload(
            title="Follow-up update",
            items=[{"id": item_id, "name": name, "price": 100, "mode": "free"}],
        ),
        headers=_headers(identity),
    )
    assert response.status_code == 200, response.text


def test_create_rejects_malformed_mode_and_allows_followup_write():
    owner = db.new_identity("v74-mode")
    response = client.post(
        "/api/bills",
        json=_create_payload(items=[{"name": "Nasi", "price": 100, "mode": {}}]),
        headers=_headers(owner),
    )
    assert response.status_code == 400, response.text
    _valid_followup_create(owner)


def test_create_rejects_sqlite_overflow_participant_count_and_allows_followup_write():
    owner = db.new_identity("v74-count")
    response = client.post(
        "/api/bills",
        json=_create_payload(participant_count=10**20),
        headers=_headers(owner),
    )
    assert response.status_code == 400, response.text
    _valid_followup_create(owner)


def test_create_rejects_nonfinite_numeric_and_allows_followup_write():
    owner = db.new_identity("v74-nonfinite")
    response = client.post(
        "/api/bills",
        content=(
            '{"title":"Bill v74","items":[{"name":"Nasi","price":100,"discount":0,"mode":"free"}],'
            '"subtotal":100,"tax":0,"service":0,"total":100,"participant_count":1e309}'
        ),
        headers={**_headers(owner), "Content-Type": "application/json"},
    )
    assert response.status_code == 400, response.text
    _valid_followup_create(owner)


def test_create_rejects_bool_and_fractional_money_and_allows_followup_write():
    for bad_price, suffix in ((True, "bool"), (1.5, "fraction")):
        owner = db.new_identity(f"v74-price-{suffix}")
        response = client.post(
            "/api/bills",
            json=_create_payload(items=[{"name": "Nasi", "price": bad_price, "mode": "free"}]),
            headers=_headers(owner),
        )
        assert response.status_code == 400, response.text
        _valid_followup_create(owner)


def test_update_rejects_nonfinite_item_id_and_allows_followup_write():
    owner = db.new_identity("v74-id-nonfinite")
    bill_id = _create_bill(owner)
    item_id = db.get_bill(bill_id)["items"][0]["id"]
    response = client.put(
        f"/api/bills/{bill_id}",
        content=(
            '{"title":"Follow-up update","items":[{"id":1e309,"name":"Nasi","price":100,"mode":"free"}],'
            '"subtotal":100,"tax":0,"service":0,"total":100}'
        ),
        headers={**_headers(owner), "Content-Type": "application/json"},
    )
    assert response.status_code == 400, response.text
    assert db.get_bill(bill_id)["items"][0]["id"] == item_id
    _valid_update(owner, bill_id, item_id)


def test_create_normalizes_item_name_and_mode():
    owner = db.new_identity("v74-normalize-create")
    bill_id = _create_bill(
        owner,
        items=[{"name": "  Nasi  ", "price": 100, "mode": " SLOT ", "slot_count": 2}],
    )
    item = db.get_bill(bill_id)["items"][0]
    assert item["name"] == "Nasi"
    assert item["mode"] == "slot"
    assert item["slot_count"] == 2


def test_update_rejects_malformed_item_name_and_allows_followup_write():
    owner = db.new_identity("v74-name")
    bill_id = _create_bill(owner)
    item_id = db.get_bill(bill_id)["items"][0]["id"]
    response = client.put(
        f"/api/bills/{bill_id}",
        json=_create_payload(items=[{"id": item_id, "name": {}, "price": 100, "mode": "free"}]),
        headers=_headers(owner),
    )
    assert response.status_code == 400, response.text
    assert db.get_bill(bill_id)["items"][0]["name"] == "Nasi"
    _valid_update(owner, bill_id, item_id)


def test_update_rejects_non_numeric_item_id_and_allows_followup_write():
    owner = db.new_identity("v74-id-string")
    bill_id = _create_bill(owner)
    item_id = db.get_bill(bill_id)["items"][0]["id"]
    response = client.put(
        f"/api/bills/{bill_id}",
        json=_create_payload(items=[{"id": "abc", "name": "Nasi", "price": 100, "mode": "free"}]),
        headers=_headers(owner),
    )
    assert response.status_code == 400, response.text
    assert db.get_bill(bill_id)["items"][0]["id"] == item_id
    _valid_update(owner, bill_id, item_id)


def test_update_rejects_unhashable_item_id_and_allows_followup_write():
    owner = db.new_identity("v74-id-list")
    bill_id = _create_bill(owner)
    item_id = db.get_bill(bill_id)["items"][0]["id"]
    response = client.put(
        f"/api/bills/{bill_id}",
        json=_create_payload(items=[{"id": [], "name": "Nasi", "price": 100, "mode": "free"}]),
        headers=_headers(owner),
    )
    assert response.status_code == 400, response.text
    assert db.get_bill(bill_id)["items"][0]["id"] == item_id
    _valid_update(owner, bill_id, item_id)


def test_update_accepts_numeric_item_id_and_normalizes_name_and_mode():
    owner = db.new_identity("v74-normalize-update")
    bill_id = _create_bill(owner)
    item_id = db.get_bill(bill_id)["items"][0]["id"]
    _valid_update(owner, bill_id, item_id, name="  Mie  ")
    item = db.get_bill(bill_id)["items"][0]
    assert item["id"] == item_id
    assert item["name"] == "Mie"
    assert item["mode"] == "free"
