"""Regression tests for v50: personal payment status (my_paid) in bill list.

The bill-level status (Selesai / Lunas / Belum lunas) only tells whether
EVERYONE has paid. A guest who already paid their share still saw "Belum
lunas" and couldn't tell their own position. v50 adds `my_paid` per row so
the home/history list can show a personal line ("Kamu udah bayar" /
"Kamu belum bayar").

Covered:
- resolved payer is always my_paid=true even while others are unpaid
- unpaid guest: my_paid=false
- guest marks paid: my_paid=true
- bill becomes settled only after everyone with a share has paid
- creator with no share/payment stays my_paid=false

Run:
  cd backend && venv/bin/python -m pytest test_regressions_v50.py -q
"""
import os
import sys
import tempfile
from pathlib import Path

_tmp = Path(tempfile.mkdtemp()) / "test50.db"
os.environ["BAGIIN_DB"] = str(_tmp)
os.environ["BAGIIN_UPLOAD_DIR"] = str(Path(tempfile.mkdtemp()) / "uploads")

sys.path.insert(0, str(Path(__file__).resolve().parent))

import db
db.init_db()

from fastapi.testclient import TestClient
from main import app

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
    return db.create_bill(
        creator_id=creator["id"], title=title, tax_mode=tax_mode,
        subtotal=subtotal, tax=tax, service=service, total=total,
        items=items or [{"name": "A", "price": subtotal or 1}],
        participants=participants or ["Aufa", "Budi"],
        tax_included=tax_included, paid_by_name=paid_by_name,
    )["id"]


def _pick(bid, identity, item_id, qty=1):
    db.set_selections(bid, identity["id"], [{"item_id": item_id, "qty": qty}])


def _row_for(ident, bid):
    r = c.get(f"/api/identities/{ident['id']}/bills",
              headers=_H(ident["id"]))
    assert r.status_code == 200, r.text
    rows = [x for x in r.json() if x["id"] == bid]
    assert len(rows) == 1, f"bill {bid} not in {ident['name']}'s list"
    return rows[0]


def test_my_paid_personal_status_in_list():
    """Payer auto-paid, unpaid guest false, paid guest true, settled only when
    everyone with a share has paid."""
    aufa = db.new_identity("Aufa50")
    amel = db.new_identity("Amel50")
    budi = db.new_identity("Budi50")
    bid = _mk_bill(aufa, subtotal=300000, total=300000,
                   items=[{"name": "A", "price": 300000}],
                   participants=["Aufa50", "Amel50", "Budi50"],
                   paid_by_name="Amel50")
    HAa = _H(amel["id"])
    HB = _H(budi["id"])
    c.post(f"/api/bills/{bid}/join", headers=HAa, json={})
    c.post(f"/api/bills/{bid}/join", headers=HB, json={})
    item_id = db.get_bill(bid)["items"][0]["id"]
    # everyone takes one share so all three owe money
    _pick(bid, aufa, item_id)
    _pick(bid, amel, item_id)
    _pick(bid, budi, item_id)

    # payer: auto-paid even though others haven't paid -> bill NOT settled
    row = _row_for(amel, bid)
    assert row["my_paid"] is True, row
    assert row["settled"] is False, row

    # unpaid guest: my_paid false
    row = _row_for(budi, bid)
    assert row["my_paid"] is False, row
    assert row["settled"] is False, row

    # guest marks paid -> my_paid true, but bill still unsettled (Aufa left)
    r = c.post(f"/api/bills/{bid}/payments/{budi['id']}/paid", headers=HB)
    assert r.status_code == 200, r.text
    row = _row_for(budi, bid)
    assert row["my_paid"] is True, row
    assert row["settled"] is False, f"should stay unsettled: {row}"

    # creator pays too -> everyone settled
    r = c.post(f"/api/bills/{bid}/payments/{aufa['id']}/paid", headers=_H(aufa))
    assert r.status_code == 200, r.text
    row = _row_for(budi, bid)
    assert row["my_paid"] is True, row
    assert row["settled"] is True, row


def test_my_paid_false_for_creator_without_share():
    """Creator who hasn't paid and has no share -> my_paid false (so the UI
    shows 'Kamu belum bayar')."""
    aufa = db.new_identity("Aufa50b")
    amel = db.new_identity("Amel50b")
    budi = db.new_identity("Budi50b")
    bid = _mk_bill(aufa, subtotal=300000, total=300000,
                   items=[{"name": "A", "price": 300000}],
                   participants=["Aufa50b", "Amel50b", "Budi50b"],
                   paid_by_name="Amel50b")
    HAa = _H(amel["id"])
    HB = _H(budi["id"])
    c.post(f"/api/bills/{bid}/join", headers=HAa, json={})
    c.post(f"/api/bills/{bid}/join", headers=HB, json={})
    item_id = db.get_bill(bid)["items"][0]["id"]
    _pick(bid, amel, item_id)
    _pick(bid, budi, item_id)

    # payer paid; both guests paid; creator has NO share -> settled
    r = c.post(f"/api/bills/{bid}/payments/{budi['id']}/paid", headers=HB)
    assert r.status_code == 200, r.text
    row = _row_for(aufa, bid)
    assert row["my_paid"] is False, row
    assert row["settled"] is True, f"guests settled everything: {row}"


if __name__ == "__main__":
    test_my_paid_personal_status_in_list()
    test_my_paid_false_for_creator_without_share()
    print("PASS my_paid tests")
