"""Regression tests for the bill-list status fields.

The bill list and the bill screen kept telling the user different stories about
the same bill:

- A bill nobody had picked from showed a red "Belum lunas" chip *and* a green
  "Kamu udah bayar" line, on a bill where nothing had happened at all.
- The payer is force-marked paid because they fronted the money, so the list
  called that "Kamu udah bayar" — no money had moved.

The list now carries `has_picks` and `i_am_payer` so the UI can say "Belum ada
yang milih" and "Kamu yang nalangin" instead of inventing a payment.

Run:
  cd backend && venv/bin/python -m pytest test_regressions_status.py -q
"""
import os
import sys
import tempfile
from pathlib import Path

_tmp = Path(tempfile.mkdtemp()) / "teststatus.db"
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
    if "paid_by_name" in kw:
        payload["paid_by_name"] = kw["paid_by_name"]
    r = c.post("/api/bills", json=payload, headers=_H(creator))
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _row(ident, bill_id):
    rows = c.get(f"/api/identities/{ident['id']}/bills", headers=_H(ident)).json()
    return next(b for b in rows if b["id"] == bill_id)


def test_untouched_bill_is_neither_settled_nor_unpaid():
    """Nobody has picked anything: the row must not claim a payment happened."""
    alice = db.new_identity("AliceS1", role="creator")
    bid = _mk_bill(alice)

    row = _row(alice, bid)
    assert row["has_picks"] is False, "no selections exist yet"
    assert row["settled"] is False
    # she is the payer, so my_paid is true — but the UI must render that as
    # "kamu yang nalangin", never as a red "belum lunas" + green "udah bayar"
    assert row["i_am_payer"] is True
    assert row["my_paid"] is True


def test_has_picks_flips_once_someone_picks():
    alice = db.new_identity("AliceS2", role="creator")
    bob = db.new_identity("BobS2")
    bid = _mk_bill(alice)
    c.post(f"/api/bills/{bid}/join", headers=_H(bob))
    assert _row(alice, bid)["has_picks"] is False

    iid = db.get_bill(bid)["items"][0]["id"]
    c.post(f"/api/bills/{bid}/selections", json={"picks": [{"item_id": iid, "qty": 1}]},
           headers=_H(bob))

    row = _row(alice, bid)
    assert row["has_picks"] is True
    assert row["settled"] is False, "Bob still owes"
    bob_row = _row(bob, bid)
    assert bob_row["i_am_payer"] is False
    assert bob_row["my_paid"] is False
    assert bob_row["has_picks"] is True


def test_guest_is_not_the_payer_even_when_they_paid():
    alice = db.new_identity("AliceS3", role="creator")
    bob = db.new_identity("BobS3")
    bid = _mk_bill(alice)
    c.post(f"/api/bills/{bid}/join", headers=_H(bob))
    iid = db.get_bill(bid)["items"][0]["id"]
    c.post(f"/api/bills/{bid}/selections", json={"picks": [{"item_id": iid, "qty": 1}]},
           headers=_H(bob))
    c.post(f"/api/bills/{bid}/payments/{bob['id']}/paid", headers=_H(bob))

    row = _row(bob, bid)
    assert row["my_paid"] is True
    assert row["i_am_payer"] is False, "Bob paid Alice; he did not front the bill"
    assert row["settled"] is True, "everyone with a share has paid"


def test_payer_flag_follows_the_resolved_payer_not_the_creator():
    """paid_by_name that resolves to a guest: that guest is the payer, the
    creator is not — even though the creator still manages the bill."""
    alice = db.new_identity("AliceS4", role="creator")
    budi = db.new_identity("BudiS4")
    bid = _mk_bill(alice, paid_by_name="BudiS4")
    c.post(f"/api/bills/{bid}/join", headers=_H(budi))

    assert _row(alice, bid)["i_am_payer"] is False
    assert _row(budi, bid)["i_am_payer"] is True
    # ...and management still belongs to the creator (name match grants nothing)
    assert _row(alice, bid)["can_manage"] is True
    assert _row(budi, bid)["can_manage"] is False


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print("PASS", name)
    print("\nALL PASS")
