"""Regression coverage for creator-side open-bill finalization."""
import os
import sys
import tempfile
from pathlib import Path

_DB = Path(tempfile.mkdtemp(prefix="bagiin-v76-")) / "close-bill.db"
os.environ["BAGIIN_DB"] = str(_DB)
os.environ["BAGIIN_UPLOAD_DIR"] = str(Path(tempfile.mkdtemp(prefix="bagiin-v76-uploads-")) / "uploads")
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


def _create_bill(owner, guest_name, pending_name):
    response = client.post(
        "/api/bills",
        json={
            "title": "Bill v76",
            "items": [
                {"name": "Nasi", "price": 60000, "mode": "free"},
                {"name": "Teh Poci", "price": 40000, "mode": "slot", "slot_count": 2},
            ],
            "subtotal": 100000,
            "tax": 0,
            "service": 0,
            "total": 100000,
            "participants": [guest_name, pending_name],
        },
        headers=_headers(owner),
    )
    assert response.status_code == 200, response.text
    return response.json()["id"]


def test_open_bill_can_be_finalized_without_claiming_payment():
    owner = db.new_identity("Owner v76", role="creator")
    guest = db.new_identity("Guest v76")
    pending = db.new_identity("Pending v76")
    bill_id = _create_bill(owner, guest["name"], pending["name"])

    joined_guest = client.post(f"/api/bills/{bill_id}/join", headers=_headers(guest))
    assert joined_guest.status_code == 200, joined_guest.text
    joined_pending = client.post(f"/api/bills/{bill_id}/join", headers=_headers(pending))
    assert joined_pending.status_code == 200, joined_pending.text

    detail = client.get(f"/api/bills/{bill_id}", headers=_headers(owner)).json()
    item_ids = {item["name"]: item["id"] for item in detail["items"]}
    picked = client.post(
        f"/api/bills/{bill_id}/selections",
        json={"picks": [{"item_id": item_ids["Nasi"], "qty": 1}]},
        headers=_headers(guest),
    )
    assert picked.status_code == 200, picked.text

    before = client.get(f"/api/bills/{bill_id}", headers=_headers(owner)).json()
    assert before["bill"]["status"] == "open"
    assert before["uncovered_idr"] == 40000
    assert before["settled"] is False
    assert any(person["identity_id"] == pending["id"] for person in before["people"])

    denied = client.post(f"/api/bills/{bill_id}/close", headers=_headers(guest))
    assert denied.status_code == 403, denied.text

    closed = client.post(f"/api/bills/{bill_id}/close", headers=_headers(owner))
    assert closed.status_code == 200, closed.text

    after = client.get(f"/api/bills/{bill_id}", headers=_headers(owner)).json()
    assert after["bill"]["status"] == "closed"
    assert after["uncovered_idr"] == before["uncovered_idr"]
    assert after["warnings"] == before["warnings"]
    assert after["settled"] is False
    assert after["all_paid"] is False
