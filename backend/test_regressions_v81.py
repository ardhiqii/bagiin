"""Regression coverage for v81: bill-list status includes uncovered slots.

A zero-price selection can make every participant's computed total zero while
an unrelated slot item still has money uncovered. The detail payload already
exposed that state, but the identity bill list omitted ``uncovered_idr`` and
``all_paid`` and could not explain why ``settled`` remained false.
"""
import os
import sys
import tempfile
from pathlib import Path

_DB = Path(tempfile.mkdtemp(prefix="bagiin-v81-")) / "uncovered-slot.db"
os.environ["BAGIIN_DB"] = str(_DB)
os.environ["BAGIIN_UPLOAD_DIR"] = str(
    Path(tempfile.mkdtemp(prefix="bagiin-v81-uploads-")) / "uploads"
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


def _row_for(identity, bill_id):
    response = client.get(
        f"/api/identities/{identity['id']}/bills",
        headers=_headers(identity),
    )
    assert response.status_code == 200, response.text
    rows = [row for row in response.json() if row["id"] == bill_id]
    assert len(rows) == 1, rows
    return rows[0]


def test_bill_list_exposes_uncovered_slot_and_all_paid_state():
    owner = db.new_identity("v81-owner")
    guest = db.new_identity("v81-guest")
    create = client.post(
        "/api/bills",
        headers=_headers(owner),
        json={
            "title": "Uncovered slot",
            "items": [
                {"name": "Gratis", "price": 0},
                {"name": "Slot", "price": 10000, "mode": "slot", "slot_count": 2},
            ],
            "subtotal": 10000,
            "tax": 0,
            "service": 0,
            "total": 10000,
            "participants": [owner["name"], guest["name"]],
        },
    )
    assert create.status_code == 200, create.text
    bill_id = create.json()["id"]

    joined = client.post(
        f"/api/bills/{bill_id}/join",
        headers=_headers(guest),
        json={},
    )
    assert joined.status_code == 200, joined.text

    detail_before_pick = client.get(f"/api/bills/{bill_id}")
    assert detail_before_pick.status_code == 200, detail_before_pick.text
    free_item_id = next(
        item["id"]
        for item in detail_before_pick.json()["items"]
        if item["name"] == "Gratis"
    )
    picked = client.post(
        f"/api/bills/{bill_id}/selections",
        headers=_headers(guest),
        json={"picks": [{"item_id": free_item_id, "qty": 1}]},
    )
    assert picked.status_code == 200, picked.text

    detail = client.get(f"/api/bills/{bill_id}")
    assert detail.status_code == 200, detail.text
    detail_data = detail.json()
    row = _row_for(owner, bill_id)

    for data in (detail_data, row):
        assert data["uncovered_idr"] == 10000, data
        assert data["all_paid"] is True, data
        assert data["settled"] is False, data

    assert row["has_picks"] is True
    assert row["pending_names"] == []
    assert row["total_unpaid"] == 0
