"""Regression tests for v48 bugs: creator loses control after payer resolves.

- creator must keep management powers (change payer, close, delete) once the
  payer placeholder resolves to a joined identity (bug: ownership moved
  entirely to the payer -> creator got 403 on set_paid_by/delete/close)
- strangers still get 403 (no privilege widening)
- uncovered-slot warning format stays honest (no per_slot x empty != amount)

Run:
  cd backend && venv/bin/python -m pytest test_regressions_v48.py -q
"""
import os
import sys
import tempfile
from pathlib import Path

_tmp = Path(tempfile.mkdtemp()) / "test48.db"
os.environ["BAGIIN_DB"] = str(_tmp)
os.environ["BAGIIN_UPLOAD_DIR"] = str(Path(tempfile.mkdtemp()) / "uploads")

sys.path.insert(0, str(Path(__file__).resolve().parent))

import db
db.init_db()

from fastapi.testclient import TestClient
from main import app, _owner_id, _can_manage

app.state.limiter.enabled = False
c = TestClient(app, raise_server_exceptions=False)



def _H(who):
    """Auth headers for a caller. Accepts an identity dict or a bare id.

    Since v51 the identity id is only a public reference — requests must also
    carry the identity's secret, so tests go through this helper.
    """
    ident = who if isinstance(who, dict) else db.get_identity(who)
    h = {"X-Identity-Id": ident["id"]}
    if ident.get("secret"):
        h["X-Identity-Secret"] = ident["secret"]
    return h

def _mk_bill(creator, title="Makan", subtotal=0, tax=0, service=0, total=0,
             items=None, participants=None, tax_included=0, tax_mode="proportional",
             paid_by_name=None):
    data = db.create_bill(
        creator_id=creator["id"], title=title, tax_mode=tax_mode,
        subtotal=subtotal, tax=tax, service=service, total=total,
        items=items or [{"name": "A", "price": subtotal or 1}],
        participants=participants or ["Aufa", "Budi"],
        tax_included=tax_included, paid_by_name=paid_by_name,
    )
    return data["id"]


def test_creator_control_transfers_to_confirmed_payer():
    """Placeholder payer joins -> ownership resolves to them, but only for
    display (name match never grants powers). Once the creator CONFIRMS the
    payer by identity, the payer is the sole manager and the creator loses
    every manage action until the payer hands ownership back (v57)."""
    aufa = db.new_identity("Aufa48", role="creator")
    amel = db.new_identity("Amel48")
    bid = _mk_bill(aufa, subtotal=100000, total=100000,
                   items=[{"name": "A", "price": 100000}],
                   participants=["Aufa48", "Amel48"], paid_by_name="Amel48")
    HA = _H(aufa["id"])
    HAa = _H(amel["id"])

    # payer placeholder resolves once Amel joins — for display and auto-paid
    # only. Ownership must NOT follow a name match (v51): otherwise anyone who
    # joins under the payer's name takes the bill over.
    r = c.post(f"/api/bills/{bid}/join", headers=HAa, json={})
    assert r.status_code == 200, r.text
    data = db.get_bill(bid)
    assert db.resolve_payer(data)[0] == amel["id"], "payer should resolve to Amel"
    assert _owner_id(data) == aufa["id"], "ownership stays with the creator"
    assert not _can_manage(data, amel["id"]), "name match must not grant powers"
    assert _can_manage(data, aufa["id"]), "creator must still manage"

    # creator changes payer to Amel by identity. THIS is what promotes her to
    # owner — an explicit choice by someone who may manage.
    r = c.put(f"/api/bills/{bid}/paid_by", json={"identity_id": amel["id"]}, headers=HA)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["paid_by_id"] == amel["id"], d["paid_by_id"]
    assert _owner_id(db.get_bill(bid)) == amel["id"], "confirmed payer owns it"
    # v57: the confirmed payer is the SOLE manager — the creator is now a
    # regular participant and loses every manage action (v48 co-ownership
    # removed; name-matching can't hijack the bill anymore, so the creator
    # lockout is safe again).
    assert not _can_manage(db.get_bill(bid), aufa["id"]), "creator loses powers once payer confirmed"

    # creator can no longer change the payer back, close, or delete
    assert c.put(f"/api/bills/{bid}/paid_by", json={"identity_id": aufa["id"]}, headers=HA).status_code == 403
    assert c.post(f"/api/bills/{bid}/close", headers=HA).status_code == 403
    assert c.delete(f"/api/bills/{bid}", headers=HA).status_code == 403

    # the payer (owner) can hand ownership back; creator regains powers
    assert c.put(f"/api/bills/{bid}/paid_by", json={"identity_id": aufa["id"]}, headers=HAa).status_code == 200
    assert _can_manage(db.get_bill(bid), aufa["id"]), "creator manages again after hand-off"
    assert c.post(f"/api/bills/{bid}/close", headers=HA).status_code == 200
    assert c.delete(f"/api/bills/{bid}", headers=HA).status_code == 200


def test_stranger_still_cannot_manage():
    """Privilege widening guard: an unrelated identity still gets 403."""
    aufa = db.new_identity("Aufa48b", role="creator")
    amel = db.new_identity("Amel48b")
    mallory = db.new_identity("Mallory48")
    bid = _mk_bill(aufa, subtotal=100000, total=100000,
                   items=[{"name": "A", "price": 100000}],
                   participants=["Aufa48b", "Amel48b"], paid_by_name="Amel48b")
    c.post(f"/api/bills/{bid}/join", headers=_H(amel["id"]), json={})
    HM = _H(mallory["id"])
    assert c.post(f"/api/bills/{bid}/close", headers=HM).status_code == 403
    assert c.delete(f"/api/bills/{bid}", headers=HM).status_code == 403
    assert c.put(f"/api/bills/{bid}/paid_by", json={"identity_id": mallory["id"]}, headers=HM).status_code == 403
    assert c.put(f"/api/bills/{bid}", json={
        "title": "x", "participants": ["Aufa48b"], "participant_count": 1,
        "items": [{"name": "A", "price": 100000}],
        "subtotal": 100000, "tax": 0, "service": 0, "total": 100000,
        "tax_mode": "proportional", "tax_included": False,
    }, headers=HM).status_code == 403


def test_uncovered_slot_warning_honest_total():
    """Slot with rounding remainder: per_slot x empty != amount, so the
    warning must show the total amount, not misleading multiplication."""
    aufa = db.new_identity("Aufa48c", role="creator")
    bid = _mk_bill(aufa, subtotal=641283, total=641283, tax_included=1,
                   items=[{"name": "2 nights", "price": 641283, "mode": "slot", "slot_count": 2}],
                   participants=["Aufa48c"])
    HA = _H(aufa["id"])
    # pick 1 of 2 slots (like the real bill) so 1 stays uncovered
    d = c.get(f"/api/bills/{bid}", headers=HA).json()
    item_id = d["items"][0]["id"]
    assert c.post(f"/api/bills/{bid}/selections",
                  json={"picks": [{"item_id": item_id, "qty": 1}]},
                  headers=HA).status_code == 200
    d = c.get(f"/api/bills/{bid}", headers=HA).json()
    assert d["uncovered_idr"] == 320642, d["uncovered_idr"]
    # warning must not claim per_slot x empty == amount
    for w in d["warnings"]:
        assert "Rp 320,641/bagian" not in w, w
        assert "total Rp 320,642" in w, w
