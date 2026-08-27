"""Regression tests for the v59 settled fix: a solo bill is not "Lunas".

Root cause: with no payer declared, resolve_payer falls back to the creator,
who is then auto-paid. A brand-new bill where the creator picked everything
therefore had owed={creator} subset paid={creator} -> all_paid -> settled,
wearing a green "Lunas" chip before anyone else even joined
(bug: "blom ada yg join tp keterangannya lunas").

Fix: settled requires at least one person OTHER than the payer to owe a
share (and have paid it). Money must actually change hands.

Covered:
- solo creator picked everything -> NOT settled, NOT all_paid
- nothing picked at all -> NOT settled
- guest picks + pays (normal flow) -> settled STILL works
- guest joined but only the payer has a share -> NOT settled

Run:
  cd backend && venv/bin/python -m pytest test_regressions_v59.py -q
"""
import os
import sys
import tempfile
from pathlib import Path

_tmp = Path(tempfile.mkdtemp()) / "test59.db"
os.environ["BAGIIN_DB"] = str(_tmp)
os.environ["BAGIIN_UPLOAD_DIR"] = str(Path(tempfile.mkdtemp()) / "uploads")

sys.path.insert(0, str(Path(__file__).resolve().parent))

import db
db.init_db()

from fastapi.testclient import TestClient
from main import app

c = TestClient(app, raise_server_exceptions=False)


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


def _detail(bid, ident):
    return c.get(f"/api/bills/{bid}", headers=_H(ident)).json()


def test_solo_creator_picked_everything_not_settled():
    """The exact bug: creator alone, picks all items, nobody else joined.
    used to be settled=True (payer fallback = creator, auto-paid)."""
    aufa = db.new_identity("Aufa59", role="creator")
    bid = _mk_bill(aufa, items=[{"name": "A", "price": 100000}],
                   subtotal=100000, total=100000)
    iid = _item_ids(bid)[0]
    c.post(f"/api/bills/{bid}/selections", headers=_H(aufa),
           json={"picks": [{"item_id": iid, "qty": 1}]})

    data = _detail(bid, aufa)
    assert data["settled"] is False, f"solo bill must not be lunas: {data['settled']}"
    assert data["all_paid"] is False, f"solo bill must not be all_paid: {data['all_paid']}"


def test_solo_bill_nothing_picked_not_settled():
    """Even with zero picks (nothing to owe), a solo bill is not 'Lunas'."""
    aufa = db.new_identity("Aufa59b", role="creator")
    bid = _mk_bill(aufa, items=[{"name": "A", "price": 100000}],
                   subtotal=100000, total=100000)

    data = _detail(bid, aufa)
    assert data["settled"] is False
    assert data["all_paid"] is False


def test_guest_picks_and_pays_still_settles():
    """Normal flow must keep working: guest picks, guest pays -> settled."""
    aufa = db.new_identity("Aufa59c", role="creator")
    amel = db.new_identity("Amel59c")
    bid = _mk_bill(aufa, items=[{"name": "A", "price": 100000}],
                   subtotal=100000, total=100000,
                   participants=["Aufa59c", "Amel59c"])
    c.post(f"/api/bills/{bid}/join", headers=_H(amel))
    iid = _item_ids(bid)[0]
    c.post(f"/api/bills/{bid}/selections", headers=_H(amel),
           json={"picks": [{"item_id": iid, "qty": 1}]})
    c.post(f"/api/bills/{bid}/payments/{amel['id']}/paid", headers=_H(amel))

    data = _detail(bid, aufa)
    assert data["settled"] is True, f"normal flow must settle: {data['settled']}"


def test_guest_pending_blocks_settle_until_they_act():
    """v68 (reverses the v59 rule): a guest who joined but picked nothing does
    NOT settle the bill — their pick can still change amounts, so settling
    under them froze money that wasn't final (the settled-bill-mutable bug).
    The bill settles once they act: pick + pay. Escape hatches for a guest
    who will never pick: they leave, the payer removes them, or manual settle.
    Mirrors test_features.test_paid_by's pending-picker section."""
    aufa = db.new_identity("Aufa59d", role="creator")
    amel = db.new_identity("Amel59d")
    bid = _mk_bill(aufa, items=[{"name": "A", "price": 100000}],
                   subtotal=100000, total=100000,
                   participants=["Aufa59d", "Amel59d"])
    c.post(f"/api/bills/{bid}/join", headers=_H(amel))
    iid = _item_ids(bid)[0]
    # only the creator (fallback payer) has a share, guest pending -> not settled
    c.post(f"/api/bills/{bid}/selections", headers=_H(aufa),
           json={"picks": [{"item_id": iid, "qty": 1}]})
    data = _detail(bid, aufa)
    assert data["settled"] is False, "pending picker must block auto-settle"
    # guest acts: picks and pays -> settles
    c.post(f"/api/bills/{bid}/selections", headers=_H(amel),
           json={"picks": [{"item_id": iid, "qty": 1}]})
    c.post(f"/api/bills/{bid}/payments/{amel['id']}/paid", headers=_H(amel))
    assert _detail(bid, aufa)["settled"] is True


if __name__ == "__main__":
    test_solo_creator_picked_everything_not_settled()
    test_solo_bill_nothing_picked_not_settled()
    test_guest_picks_and_pays_still_settles()
    test_guest_pending_blocks_settle_until_they_act()
    print("PASS settled-not-solo tests")
