"""Regression tests for the v57 permission model change.

The confirmed payer is the SOLE manager. The creator manages only while no
payer is confirmed; once a manager explicitly confirms a payer, the creator
becomes a regular participant (v48 co-ownership removed — name-matching can't
hijack a bill anymore, so the lockout is safe). New endpoint: participants can
leave an open bill — the owner can't, and (v58) neither can the creator while
they still are the owner.

Run:
  cd backend && venv/bin/python -m pytest test_regressions_v57.py -q
"""
import os
import sys
import tempfile
from pathlib import Path

_tmp = Path(tempfile.mkdtemp()) / "test57.db"
os.environ["BAGIIN_DB"] = str(_tmp)
os.environ["BAGIIN_UPLOAD_DIR"] = str(Path(tempfile.mkdtemp()) / "uploads")

sys.path.insert(0, str(Path(__file__).resolve().parent))

import db
db.init_db()

from fastapi.testclient import TestClient
from main import app

c = TestClient(app)


def _H(who):
    ident = who if isinstance(who, dict) else db.get_identity(who)
    h = {"X-Identity-Id": ident["id"]}
    if ident.get("secret"):
        h["X-Identity-Secret"] = ident["secret"]
    return h


def _mk_bill(creator, **kw):
    payload = {
        "title": kw.get("title", "Bill"),
        "items": kw.get("items", [{"name": "A", "price": 100000}]),
        "subtotal": kw.get("subtotal", 100000),
        "tax": kw.get("tax", 0),
        "service": kw.get("service", 0),
        "total": kw.get("total", 100000),
    }
    for k in ("paid_by_name", "participants", "tax_included"):
        if k in kw:
            payload[k] = kw[k]
    r = c.post("/api/bills", json=payload, headers=_H(creator))
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _item_ids(bill_id):
    return [i["id"] for i in db.get_bill(bill_id)["items"]]


# ---------- 1. participant leaves ----------

def test_participant_leaves_bill():
    """A joined participant can leave: selections + payment record + roster
    membership gone, split stays balanced, and they can rejoin."""
    alice = db.new_identity("Alice57", role="creator")
    bob = db.new_identity("Bob57")
    bid = _mk_bill(alice, items=[{"name": "Makan", "price": 100000}],
                   subtotal=100000, tax=0, total=100000)
    iid = _item_ids(bid)[0]
    c.post(f"/api/bills/{bid}/join", headers=_H(bob))
    c.post(f"/api/bills/{bid}/selections", json={"picks": [{"item_id": iid, "qty": 1}]},
           headers=_H(bob))

    before = c.get(f"/api/bills/{bid}", headers=_H(bob)).json()
    assert any(p["identity_id"] == bob["id"] for p in before["people"])

    r = c.post(f"/api/bills/{bid}/leave", headers=_H(bob))
    assert r.status_code == 200, r.text
    data = r.json()
    assert all(p["identity_id"] != bob["id"] for p in data["people"]), "leaver gone from people"
    assert data["total_ok"] is True, "split must stay balanced"
    # the unpicked free item falls back to the creator
    me = next(p for p in data["people"] if p["identity_id"] == alice["id"])
    assert me["total_idr"] == 100000, me["total_idr"]

    # rejoin works
    assert c.post(f"/api/bills/{bid}/join", headers=_H(bob)).status_code == 200


def test_leaver_paid_record_dropped():
    """Even a participant marked paid is removed cleanly on leave."""
    alice = db.new_identity("Alice57b", role="creator")
    bob = db.new_identity("Bob57b")
    bid = _mk_bill(alice, items=[{"name": "A", "price": 100000}],
                   subtotal=100000, tax=0, total=100000)
    iid = _item_ids(bid)[0]
    c.post(f"/api/bills/{bid}/join", headers=_H(bob))
    c.post(f"/api/bills/{bid}/selections", json={"picks": [{"item_id": iid, "qty": 1}]},
           headers=_H(bob))
    c.post(f"/api/bills/{bid}/payments/{bob['id']}/paid", headers=_H(bob))

    # v68 freeze: a paid member can't leave a settled bill (the ledger must
    # never lose their payment record while money is final) — unmark first.
    c.post(f"/api/bills/{bid}/payments/{bob['id']}/unpaid", headers=_H(bob))
    r = c.post(f"/api/bills/{bid}/leave", headers=_H(bob))
    assert r.status_code == 200, r.text
    assert all(p["identity_id"] != bob["id"] for p in r.json()["people"])


def test_owner_cannot_leave():
    """The confirmed payer holds the bill — they can't walk out of it."""
    alice = db.new_identity("Alice57c", role="creator")
    amel = db.new_identity("Amel57c")
    bid = _mk_bill(alice)
    c.post(f"/api/bills/{bid}/join", headers=_H(amel))
    c.put(f"/api/bills/{bid}/paid_by", json={"identity_id": amel["id"]}, headers=_H(alice))

    r = c.post(f"/api/bills/{bid}/leave", headers=_H(amel))
    assert r.status_code == 400, r.text
    assert "Owner" in r.json()["detail"]


def test_creator_can_leave_once_a_payer_holds_the_bill():
    """v58: a confirmed payer makes the creator a regular participant (v57),
    so the creator can walk out like anyone else. The money they used to
    absorb (unpicked free items) follows the bill to its owner."""
    alice = db.new_identity("Alice57d", role="creator")
    amel = db.new_identity("Amel57d")
    bid = _mk_bill(alice, items=[{"name": "A", "price": 100000}],
                   subtotal=100000, tax=0, total=100000)
    c.post(f"/api/bills/{bid}/join", headers=_H(amel))
    c.put(f"/api/bills/{bid}/paid_by", json={"identity_id": amel["id"]}, headers=_H(alice))

    r = c.post(f"/api/bills/{bid}/leave", headers=_H(alice))
    assert r.status_code == 200, r.text
    data = r.json()
    assert all(p["identity_id"] != alice["id"] for p in data["people"]), "creator gone"
    # the unpicked item lands on the owner now, and the split still reconciles
    me = next(p for p in data["people"] if p["identity_id"] == amel["id"])
    assert me["total_idr"] == 100000, me["total_idr"]
    assert data["total_ok"] is True


def test_creator_leaving_drops_the_bill_from_their_list():
    """Leaving means leaving: the bill stops showing up in the creator's
    history, exactly like it does for any other participant who leaves."""
    alice = db.new_identity("Alice57d2", role="creator")
    amel = db.new_identity("Amel57d2")
    bid = _mk_bill(alice)
    c.post(f"/api/bills/{bid}/join", headers=_H(amel))
    c.put(f"/api/bills/{bid}/paid_by", json={"identity_id": amel["id"]}, headers=_H(alice))
    assert any(b["id"] == bid for b in c.get(f"/api/identities/{alice['id']}/bills", headers=_H(alice)).json())

    assert c.post(f"/api/bills/{bid}/leave", headers=_H(alice)).status_code == 200
    assert not any(b["id"] == bid for b in c.get(f"/api/identities/{alice['id']}/bills", headers=_H(alice)).json())
    # still the payer's bill, and the link still works for the creator
    assert any(b["id"] == bid for b in c.get(f"/api/identities/{amel['id']}/bills", headers=_H(amel)).json())
    assert c.get(f"/api/bills/{bid}", headers=_H(alice)).status_code == 200


def test_creator_can_rejoin_after_leaving():
    """The share link is the way back in — rejoining undoes the exit."""
    alice = db.new_identity("Alice57d3", role="creator")
    amel = db.new_identity("Amel57d3")
    bid = _mk_bill(alice)
    c.post(f"/api/bills/{bid}/join", headers=_H(amel))
    c.put(f"/api/bills/{bid}/paid_by", json={"identity_id": amel["id"]}, headers=_H(alice))
    c.post(f"/api/bills/{bid}/leave", headers=_H(alice))

    r = c.post(f"/api/bills/{bid}/join", headers=_H(alice))
    assert r.status_code == 200, r.text
    assert any(p["identity_id"] == alice["id"] for p in r.json()["people"])
    assert any(b["id"] == bid for b in c.get(f"/api/identities/{alice['id']}/bills", headers=_H(alice)).json())


def test_owner_can_remove_a_creator_who_no_longer_holds_the_bill():
    """Mirror of leaving: the manager can drop the creator too, once the
    creator is just another participant (v58)."""
    alice = db.new_identity("Alice57d7", role="creator")
    amel = db.new_identity("Amel57d7")
    bid = _mk_bill(alice)
    c.post(f"/api/bills/{bid}/join", headers=_H(amel))
    c.put(f"/api/bills/{bid}/paid_by", json={"identity_id": amel["id"]}, headers=_H(alice))

    r = c.delete(f"/api/bills/{bid}/people/{alice['id']}", headers=_H(amel))
    assert r.status_code == 200, r.text
    assert all(p["identity_id"] != alice["id"] for p in r.json()["people"])
    assert not any(b["id"] == bid for b in c.get(f"/api/identities/{alice['id']}/bills", headers=_H(alice)).json())


def test_owner_cannot_remove_themselves():
    """No self-removal — that's what leaving (or deleting) is for."""
    alice = db.new_identity("Alice57d8", role="creator")
    bid = _mk_bill(alice)
    r = c.delete(f"/api/bills/{bid}/people/{alice['id']}", headers=_H(alice))
    assert r.status_code == 400, r.text


def test_creator_owner_cannot_leave():
    """No confirmed payer -> the creator still holds the bill -> no exit."""
    alice = db.new_identity("Alice57d4", role="creator")
    bob = db.new_identity("Bob57d4")
    bid = _mk_bill(alice)
    c.post(f"/api/bills/{bid}/join", headers=_H(bob))

    r = c.post(f"/api/bills/{bid}/leave", headers=_H(alice))
    assert r.status_code == 400, r.text
    assert "Owner" in r.json()["detail"]


def test_creator_confirmed_as_payer_cannot_leave():
    """Creator confirmed as the payer: they fronted the money, no exit."""
    alice = db.new_identity("Alice57d5", role="creator")
    bid = _mk_bill(alice)
    c.put(f"/api/bills/{bid}/paid_by", json={"identity_id": alice["id"]}, headers=_H(alice))

    r = c.post(f"/api/bills/{bid}/leave", headers=_H(alice))
    assert r.status_code == 400, r.text
    assert "Owner" in r.json()["detail"]


def test_payer_handed_back_returns_the_creator_to_the_bill():
    """The owner un-picks themselves as payer, so the bill falls back to the
    creator — an owner outside their own bill would be a ghost."""
    alice = db.new_identity("Alice57d6", role="creator")
    amel = db.new_identity("Amel57d6")
    bid = _mk_bill(alice)
    c.post(f"/api/bills/{bid}/join", headers=_H(amel))
    c.put(f"/api/bills/{bid}/paid_by", json={"identity_id": amel["id"]}, headers=_H(alice))
    assert c.post(f"/api/bills/{bid}/leave", headers=_H(alice)).status_code == 200

    r = c.put(f"/api/bills/{bid}/paid_by", json={"identity_id": None}, headers=_H(amel))
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["owner_id"] == alice["id"]
    assert any(p["identity_id"] == alice["id"] for p in data["people"])
    assert any(b["id"] == bid for b in c.get(f"/api/identities/{alice['id']}/bills", headers=_H(alice)).json())


def test_stranger_cannot_leave():
    """An identity that was never part of the bill gets 404."""
    alice = db.new_identity("Alice57e", role="creator")
    mallory = db.new_identity("Mallory57")
    bid = _mk_bill(alice)
    assert c.post(f"/api/bills/{bid}/leave", headers=_H(mallory)).status_code == 404


def test_cannot_leave_closed_bill():
    alice = db.new_identity("Alice57f", role="creator")
    bob = db.new_identity("Bob57f")
    bid = _mk_bill(alice)
    c.post(f"/api/bills/{bid}/join", headers=_H(bob))
    assert c.post(f"/api/bills/{bid}/close", headers=_H(alice)).status_code == 200
    assert c.post(f"/api/bills/{bid}/leave", headers=_H(bob)).status_code == 403


# ---------- 2. sole-manager model ----------

def test_creator_locked_out_but_payer_full():
    """Once confirmed, the payer can edit/close/mark-paid/delete; the creator
    gets 403 on all of them (regression guard for the v57 rule)."""
    alice = db.new_identity("Alice57g", role="creator")
    amel = db.new_identity("Amel57g")
    bid = _mk_bill(alice, items=[{"name": "A", "price": 100000}],
                   subtotal=100000, tax=0, total=100000)
    c.post(f"/api/bills/{bid}/join", headers=_H(amel))
    c.put(f"/api/bills/{bid}/paid_by", json={"identity_id": amel["id"]}, headers=_H(alice))

    HA = _H(alice)
    HAa = _H(amel)
    assert c.post(f"/api/bills/{bid}/close", headers=HA).status_code == 403
    assert c.delete(f"/api/bills/{bid}", headers=HA).status_code == 403
    assert c.post(f"/api/bills/{bid}/payments/{amel['id']}/paid", headers=HA).status_code == 403
    assert c.get(f"/api/bills/{bid}", headers=HA).json()["can_manage"] is False

    assert c.post(f"/api/bills/{bid}/close", headers=HAa).status_code == 200
    assert c.post(f"/api/bills/{bid}/reopen", headers=HAa).status_code == 200
    assert c.post(f"/api/bills/{bid}/payments/{alice['id']}/paid", headers=HAa).status_code == 200
    assert c.get(f"/api/bills/{bid}", headers=HAa).json()["can_manage"] is True


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print("PASS", name)
    print("\nALL PASS")
