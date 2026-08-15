"""Regression tests for v60: bill-level settle (Tandai Lunas satu klik).

Auto-settled requires the bill to have started (roster > 1), so a solo bill
can never reach "Lunas" on its own — but the owner may still want to declare
the whole bill done (paid cash outside the app, or literally one person).
v60 adds a manual override: POST /api/bills/{id}/settle (+ /unsettle),
owner-only, works on open AND closed bills.

Covered:
- solo bill auto = NOT settled, manual settle = settled (detail AND list)
- manual unsettle flips it back
- group bill with unpaid guest: manual settle still marks the bill lunas
- non-owner (guest) cannot settle -> 403
- manual settle works on a closed bill too

Run:
  cd backend && venv/bin/python -m pytest test_regressions_v60.py -q
"""
import os
import sys
import tempfile
from pathlib import Path

_tmp = Path(tempfile.mkdtemp()) / "test60.db"
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


def _list_row(bid, ident):
    rows = c.get(f"/api/identities/{ident['id']}/bills", headers=_H(ident)).json()
    return next((x for x in rows if x["id"] == bid), None)


def test_solo_bill_manual_settle():
    """Solo bill: auto NOT settled, owner settles -> settled in detail AND
    list, unsettle flips back."""
    aufa = db.new_identity("Aufa60", role="creator")
    bid = _mk_bill(aufa, items=[{"name": "A", "price": 100000}],
                   subtotal=100000, total=100000)
    iid = _item_ids(bid)[0]
    c.post(f"/api/bills/{bid}/selections", headers=_H(aufa),
           json={"picks": [{"item_id": iid, "qty": 1}]})

    # auto: not settled (nobody joined the creator)
    data = _detail(bid, aufa)
    assert data["settled"] is False
    assert data["settled_manual"] is False

    # owner taps Tandai Lunas
    r = c.post(f"/api/bills/{bid}/settle", headers=_H(aufa))
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["settled"] is True, f"manual settle must settle solo bill: {data['settled']}"
    assert data["settled_manual"] is True
    assert data["all_paid"] is True
    row = _list_row(bid, aufa)
    assert row is not None and row["settled"] is True, f"list must agree: {row}"

    # undo
    r = c.post(f"/api/bills/{bid}/unsettle", headers=_H(aufa))
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["settled"] is False
    assert data["settled_manual"] is False
    row = _list_row(bid, aufa)
    assert row["settled"] is False


def test_group_bill_with_unpaid_guest_manual_settle():
    """A guest who hasn't paid keeps the bill auto-unsettled, but the owner
    can still declare the whole bill lunas (e.g. cash settled outside app)."""
    aufa = db.new_identity("Aufa60b", role="creator")
    amel = db.new_identity("Amel60b")
    bid = _mk_bill(aufa, items=[{"name": "A", "price": 100000}],
                   subtotal=100000, total=100000,
                   participants=["Aufa60b", "Amel60b"])
    c.post(f"/api/bills/{bid}/join", headers=_H(amel))
    iid = _item_ids(bid)[0]
    c.post(f"/api/bills/{bid}/selections", headers=_H(amel),
           json={"picks": [{"item_id": iid, "qty": 1}]})

    assert _detail(bid, aufa)["settled"] is False  # guest unpaid

    r = c.post(f"/api/bills/{bid}/settle", headers=_H(aufa))
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["settled"] is True
    assert data["settled_manual"] is True
    # the guest's own row is still unpaid — manual settle is a bill-level
    # declaration, not a rewrite of each person's payment state
    guest = next(p for p in data["people"] if p["identity_id"] == amel["id"])
    assert guest["paid"] == "unpaid", guest["paid"]


def test_non_owner_cannot_settle():
    """Only the owner (confirmed payer, else creator) may settle the bill."""
    aufa = db.new_identity("Aufa60c", role="creator")
    amel = db.new_identity("Amel60c")
    bid = _mk_bill(aufa)
    c.post(f"/api/bills/{bid}/join", headers=_H(amel))

    assert c.post(f"/api/bills/{bid}/settle", headers=_H(amel)).status_code == 403
    assert c.post(f"/api/bills/{bid}/unsettle", headers=_H(amel)).status_code == 403
    # creator still can
    assert c.post(f"/api/bills/{bid}/settle", headers=_H(aufa)).status_code == 200


def test_manual_settle_on_closed_bill():
    """Settle works even after the bill is closed (the split is final, but
    the owner can still declare it lunas)."""
    aufa = db.new_identity("Aufa60d", role="creator")
    bid = _mk_bill(aufa)
    assert c.post(f"/api/bills/{bid}/close", headers=_H(aufa)).status_code == 200

    r = c.post(f"/api/bills/{bid}/settle", headers=_H(aufa))
    assert r.status_code == 200, r.text
    assert r.json()["settled"] is True
    assert r.json()["bill"]["status"] == "closed"


if __name__ == "__main__":
    test_solo_bill_manual_settle()
    test_group_bill_with_unpaid_guest_manual_settle()
    test_non_owner_cannot_settle()
    test_manual_settle_on_closed_bill()
    print("PASS bill-level settle tests")
