"""Regression tests for bugs found in the v45 audit pass (backend).

Covers:
- settled flag consistency between detail and list endpoints (price-0 picks)
- create/update rejecting impossible combos (tax_included+tax, bad total)
- equal-mode tax landing on the creator when the subtotal base is zero

Run:
  cd backend && venv/bin/python -m pytest test_regressions_v45.py -q
"""
import os
import sys
import tempfile
from pathlib import Path

_tmp = Path(tempfile.mkdtemp()) / "test45.db"
os.environ["BAGIIN_DB"] = str(_tmp)

sys.path.insert(0, str(Path(__file__).resolve().parent))

import db
db.init_db()

from fastapi.testclient import TestClient
from main import app, _compute_response

c = TestClient(app)



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


def _ids(bid):
    data = db.get_bill(bid)
    return {it["name"]: it["id"] for it in data["items"]}


def test_settled_consistent_between_list_and_detail_price0_item():
    """Price-0 pick + tax: detail says settled, list must say settled too."""
    creator = db.new_identity("Aufa", role="creator")
    budi = db.new_identity("Budi")
    bid = _mk_bill(creator, subtotal=0, tax=1000, service=0, total=1000,
                   items=[{"name": "gratisan", "price": 0}],
                   participants=["Aufa", "Budi"])
    H = _H(creator["id"])
    Hb = _H(budi["id"])

    c.post(f"/api/bills/{bid}/join", headers=Hb, json={})
    ids = _ids(bid)
    c.post(f"/api/bills/{bid}/selections", headers=Hb,
           json={"picks": [{"item_id": ids["gratisan"], "qty": 1}]})
    c.post(f"/api/bills/{bid}/payments/{budi['id']}/paid", headers=Hb, json={})

    detail = c.get(f"/api/bills/{bid}", headers=H).json()
    listing = c.get(f"/api/identities/{creator['id']}/bills", headers=H).json()
    # find this bill in the list (list shape may nest under "bills")
    items = listing if isinstance(listing, list) else listing.get("bills", [])
    row = next((x for x in items if x["id"] == bid), None)
    assert detail["settled"] is True, f"detail settled: {detail['settled']}"
    assert row is not None, "bill missing from list"
    assert row["settled"] is True, f"list settled: {row['settled']}"


def test_settled_consistent_unpaid_guest():
    """A guest who picked but hasn't paid must be unsettled in BOTH views."""
    creator = db.new_identity("Aufa2", role="creator")
    budi = db.new_identity("Budi2")
    bid = _mk_bill(creator, subtotal=30000, tax=3000, total=33000,
                   items=[{"name": "Makan", "price": 30000}],
                   participants=["Aufa2", "Budi2"])
    H = _H(creator["id"])
    Hb = _H(budi["id"])

    c.post(f"/api/bills/{bid}/join", headers=Hb, json={})
    ids = _ids(bid)
    c.post(f"/api/bills/{bid}/selections", headers=Hb,
           json={"picks": [{"item_id": ids["Makan"], "qty": 1}]})

    detail = c.get(f"/api/bills/{bid}", headers=H).json()
    listing = c.get(f"/api/identities/{creator['id']}/bills", headers=H).json()
    items = listing if isinstance(listing, list) else listing.get("bills", [])
    row = next((x for x in items if x["id"] == bid), None)
    assert detail["settled"] is False
    assert row is not None and row["settled"] is False


def test_create_rejects_tax_included_with_tax():
    """tax_included + tax > 0 is an impossible combo -> 400."""
    creator = db.new_identity("Aufa3", role="creator")
    payload = {
        "title": "X",
        "items": [{"name": "A", "price": 10000}, {"name": "B", "price": 5000}],
        "subtotal": 15000, "tax": 1500, "service": 500, "total": 17000,
        "tax_included": True,
    }
    r = c.post("/api/bills", headers=_H(creator["id"]), json=payload)
    assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"


def test_create_rejects_inconsistent_total():
    """total must equal subtotal+tax+service -> 400 otherwise."""
    creator = db.new_identity("Aufa4", role="creator")
    payload = {
        "title": "X",
        "items": [{"name": "A", "price": 10000}],
        "subtotal": 10000, "tax": 1000, "service": 500, "total": 99999,
    }
    r = c.post("/api/bills", headers=_H(creator["id"]), json=payload)
    assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"


def test_update_rejects_inconsistent_total():
    """update_bill must apply the same total guard."""
    creator = db.new_identity("Aufa5", role="creator")
    bid = _mk_bill(creator, subtotal=10000, tax=1000, total=11000,
                   items=[{"name": "A", "price": 10000}])
    ids = _ids(bid)
    payload = {
        "title": "X",
        "items": [{"id": ids["A"], "name": "A", "price": 10000}],
        "subtotal": 10000, "tax": 1000, "service": 0, "total": 12345,
    }
    r = c.put(f"/api/bills/{bid}", headers=_H(creator["id"]), json=payload)
    assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"


def test_equal_tax_zero_subtotal_lands_on_creator():
    """equal mode + discount==price (zero subtotal base): tax must not vanish."""
    creator = db.new_identity("Aufa6", role="creator")
    budi = db.new_identity("Budi6")
    bid = _mk_bill(creator, subtotal=0, tax=1000, service=0, total=1000,
                   tax_mode="equal",
                   items=[{"name": "Gratis", "price": 5000, "discount": 5000}],
                   participants=["Aufa6", "Budi6"])
    H = _H(creator["id"])
    Hb = _H(budi["id"])

    c.post(f"/api/bills/{bid}/join", headers=Hb, json={})
    ids = _ids(bid)
    c.post(f"/api/bills/{bid}/selections", headers=Hb,
           json={"picks": [{"item_id": ids["Gratis"], "qty": 1}]})

    detail = c.get(f"/api/bills/{bid}", headers=H).json()
    people_total = sum(p["total_idr"] for p in detail["people"])
    assert people_total == 1000, f"tax vanished: sum(people)={people_total}"
    assert detail["total_ok"] is True, f"total_ok: {detail['total_ok']}"
    creator_row = next(p for p in detail["people"] if p["identity_id"] == creator["id"])
    assert creator_row["total_idr"] == 1000, f"creator should hold the tax: {creator_row}"
