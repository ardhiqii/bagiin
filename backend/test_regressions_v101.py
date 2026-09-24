"""Regression coverage for the backend invariant audit (v101).

Covers recap allocation blockers after manual settle, pending-invite lifecycle,
post-merge selection limits, and the documented tax_mode update contract.
"""
import os
import tempfile
from pathlib import Path

_TEST_ROOT = Path(tempfile.mkdtemp(prefix="bagiin-v101-"))
os.environ["BAGIIN_DB"] = str(_TEST_ROOT / "test_v101.db")
os.environ.setdefault("BAGIIN_UPLOAD_DIR", str(_TEST_ROOT / "uploads"))

import db

db.init_db()

from fastapi.testclient import TestClient
import main

main.limiter.enabled = False
client = TestClient(main.app)


def _h(identity):
    return {"X-Identity-Id": identity["id"], "X-Identity-Secret": identity["secret"]}


def _create(owner, *, title="V101", price=100_000, tax_mode=None, item=None):
    item = item or {"name": "Makan", "price": price}
    payload = {
        "title": title,
        "items": [item],
        "subtotal": price,
        "tax": 0,
        "service": 0,
        "total": price,
    }
    if tax_mode is not None:
        payload["tax_mode"] = tax_mode
    response = client.post("/api/bills", json=payload, headers=_h(owner))
    return response


def _join(bill_id, identity):
    return client.post(f"/api/bills/{bill_id}/join", headers=_h(identity))


def _item_id(bill_id):
    return db.get_bill(bill_id)["items"][0]["id"]


def test_recap_keeps_unselected_member_provisional_after_manual_settle():
    owner = db.new_identity("V101 owner")
    guest = db.new_identity("V101 guest")
    created = _create(owner)
    assert created.status_code == 200, created.text
    bill_id = created.json()["id"]
    assert _join(bill_id, guest).status_code == 200
    settled = client.post(f"/api/bills/{bill_id}/settle", headers=_h(owner))
    assert settled.status_code == 200, settled.text

    recap = client.get(f"/api/identities/{owner['id']}/recap", headers=_h(owner)).json()
    assert recap["final"]["bill_count"] == 0, recap
    provisional = {entry["bill_id"]: entry for entry in recap["provisional"]["bills"]}
    assert bill_id in provisional, recap
    assert "pending_selection" in provisional[bill_id]["reason_codes"]


def test_settling_cancels_pending_invite_across_home_recap_and_accept():
    owner = db.new_identity("V101 invite owner")
    guest = db.new_identity("V101 invite guest")
    contact = _create(owner, title="V101 contact", price=10_000)
    assert contact.status_code == 200
    assert _join(contact.json()["id"], guest).status_code == 200
    assert client.post(
        f"/api/identities/{guest['id']}/auto_accept",
        json={"auto_accept": False}, headers=_h(guest),
    ).status_code == 200
    created = _create(owner, title="V101 pending", price=20_000)
    bill_id = created.json()["id"]
    invited = client.post(
        f"/api/bills/{bill_id}/invite", json={"identity_id": guest["id"]}, headers=_h(owner),
    )
    assert invited.status_code == 200 and invited.json()["status"] == "pending"
    invite_id = db.get_pending_invites(guest["id"])[0]["id"]

    assert client.post(f"/api/bills/{bill_id}/settle", headers=_h(owner)).status_code == 200
    home = client.get(f"/api/identities/{guest['id']}/bills", headers=_h(guest)).json()
    assert bill_id not in {row["id"] for row in home}
    assert client.get(f"/api/identities/{guest['id']}/invites", headers=_h(guest)).json() == []
    recap = client.get(f"/api/identities/{guest['id']}/recap", headers=_h(guest)).json()
    assert bill_id not in {entry["bill_id"] for entry in recap["provisional"]["bills"]}
    accepted = client.post(
        f"/api/bills/{bill_id}/invites/{invite_id}/accept", headers=_h(guest),
    )
    assert accepted.status_code == 409, accepted.text
    declined = client.post(
        f"/api/bills/{bill_id}/invites/{invite_id}/decline", headers=_h(guest),
    )
    assert declined.status_code == 409, declined.text
    cancelled = client.delete(
        f"/api/bills/{bill_id}/invites/{invite_id}", headers=_h(owner),
    )
    assert cancelled.status_code == 409, cancelled.text
    assert db.get_invite(invite_id)["status"] == "cancelled"
    assert client.post(f"/api/bills/{bill_id}/unsettle", headers=_h(owner)).status_code == 200
    reinvited = client.post(
        f"/api/bills/{bill_id}/invite", json={"identity_id": guest["id"]},
        headers=_h(owner),
    )
    assert reinvited.status_code == 200, reinvited.text
    assert reinvited.json()["status"] == "pending"
    reopened = db.get_invite(invite_id)
    assert reopened is not None
    assert reopened["status"] == "pending"


def test_duplicate_selection_merge_still_obeys_maximum_qty():
    owner = db.new_identity("V101 slots")
    created = _create(
        owner,
        title="V101 slot",
        price=200_000,
        item={"name": "Slot", "price": 200_000, "mode": "slot", "slot_count": 200},
    )
    assert created.status_code == 200, created.text
    bill_id = created.json()["id"]
    iid = _item_id(bill_id)
    response = client.post(
        f"/api/bills/{bill_id}/selections",
        json={"picks": [{"item_id": iid, "qty": 99}, {"item_id": iid, "qty": 99}]},
        headers=_h(owner),
    )
    assert response.status_code == 400, response.text
    assert db.get_bill(bill_id)["selections"] == []


def test_tax_mode_is_validated_and_update_persists_without_clobbering_absent_key():
    owner = db.new_identity("V101 tax")
    invalid = _create(owner, title="V101 invalid tax", tax_mode="nonsense")
    assert invalid.status_code == 400, invalid.text
    created = _create(owner, title="V101 valid tax", tax_mode="equal")
    assert created.status_code == 200, created.text
    bill_id = created.json()["id"]
    base = {"title": "V101 valid tax", "items": [{"name": "Makan", "price": 100_000}], "subtotal": 100_000, "tax": 0, "service": 0, "total": 100_000}
    changed = client.put(f"/api/bills/{bill_id}", json={**base, "tax_mode": "creator"}, headers=_h(owner))
    assert changed.status_code == 200, changed.text
    assert changed.json()["bill"]["tax_mode"] == "creator"
    unchanged = client.put(f"/api/bills/{bill_id}", json=base, headers=_h(owner))
    assert unchanged.status_code == 200, unchanged.text
    assert unchanged.json()["bill"]["tax_mode"] == "creator"
    bad_update = client.put(f"/api/bills/{bill_id}", json={**base, "tax_mode": "nope"}, headers=_h(owner))
    assert bad_update.status_code == 400, bad_update.text
    assert client.get(f"/api/bills/{bill_id}", headers=_h(owner)).json()["bill"]["tax_mode"] == "creator"
