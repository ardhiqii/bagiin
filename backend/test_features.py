"""Ad-hoc tests for Bagiin backend features (edit bill diff, payment accounts, rename).

Run with a throwaway DB: BAGIIN_DB=/tmp/bagiin_test.db venv/bin/python test_features.py
"""
import os
import sys
import tempfile
from pathlib import Path

_tmp = Path(tempfile.mkdtemp()) / "test.db"
os.environ["BAGIIN_DB"] = str(_tmp)

sys.path.insert(0, str(Path(__file__).resolve().parent))

import db

db.init_db()


def test_update_bill_diff():
    creator = db.new_identity("Aufa", role="creator")
    guest = db.new_identity("Rina")
    bill = db.create_bill(
        creator_id=creator["id"], title="Makan", tax_mode="proportional",
        subtotal=30000, tax=0, service=0, total=30000,
        items=[{"name": "A", "price": 10000}, {"name": "B", "price": 10000}, {"name": "C", "price": 10000}],
        participants=["Aufa", "Rina"],
    )
    data = db.get_bill(bill["id"])
    ids = {it["name"]: it["id"] for it in data["items"]}
    # Rina selects A and B
    db.set_selections(bill["id"], guest["id"], [ids["A"], ids["B"]])
    sel = db.get_bill(bill["id"])["selections"]
    assert len(sel) == 2, sel

    # edit: keep A (same id), rename B -> B2, remove C, add D
    new_items = [
        {"id": ids["A"], "name": "A", "price": 12000},
        {"id": ids["B"], "name": "B2", "price": 15000},
        {"name": "D", "price": 5000},
    ]
    db.update_bill(bill["id"], title="Makan Bareng", merchant="Waroeng", transacted_at="2026-08-09",
                   participants=["Aufa", "Rina", "Budi"], items=new_items,
                   subtotal=32000, tax=0, service=0, total=32000)

    data = db.get_bill(bill["id"])
    assert data["bill"]["title"] == "Makan Bareng"
    assert data["bill"]["merchant"] == "Waroeng"
    names = sorted(it["name"] for it in data["items"])
    assert names == ["A", "B2", "D"], names
    assert [p["name"] for p in data["participants"]] == ["Aufa", "Rina", "Budi"]
    # selections: A preserved, B preserved (as B2), C gone
    sel_by_item = {}
    for s in data["selections"]:
        sel_by_item.setdefault(s["item_id"], []).append(s["identity_name"])
    a = next(it for it in data["items"] if it["name"] == "A")
    b2 = next(it for it in data["items"] if it["name"] == "B2")
    d = next(it for it in data["items"] if it["name"] == "D")
    assert sel_by_item.get(a["id"]) == ["Rina"], sel_by_item
    assert sel_by_item.get(b2["id"]) == ["Rina"], sel_by_item
    assert d["id"] not in sel_by_item
    assert len(data["selections"]) == 2, data["selections"]
    print("PASS update_bill diff: selections preserved for kept items, dropped for removed")


def test_payment_accounts():
    ident = db.new_identity("Vera")
    a1 = db.add_account(ident["id"], "BCA", "1234567890", "Vera")
    a2 = db.add_account(ident["id"], "OVO", "08123456789", None)
    assert a1["brand"] == "BCA" and a1["account_no"] == "1234567890"
    accts = db.get_accounts(ident["id"])
    assert len(accts) == 2
    assert db.delete_account(a2["id"], ident["id"]) is True
    assert db.delete_account(a2["id"], ident["id"]) is False  # already gone
    # can't delete someone else's
    other = db.new_identity("Lain")
    assert db.delete_account(a1["id"], other["id"]) is False
    assert len(db.get_accounts(ident["id"])) == 1
    # update
    upd = db.update_account(a1["id"], ident["id"], "Mandiri", "9876543210", "Vera Baru")
    assert upd and upd["brand"] == "Mandiri" and upd["account_no"] == "9876543210" and upd["holder_name"] == "Vera Baru"
    upd2 = db.update_account(a1["id"], ident["id"], "Mandiri", "9876543210", None)
    assert upd2 and upd2["holder_name"] is None
    # can't update someone else's
    assert db.update_account(a1["id"], other["id"], "BCA", "1", None) is None
    print("PASS payment accounts CRUD + ownership guard")


def test_rename_and_code():
    ident = db.new_identity("Old Name")
    db.update_identity_name(ident["id"], "New Name")
    assert db.get_identity(ident["id"])["name"] == "New Name"
    # code roundtrip (existing behavior, regression)
    db.set_identity_code(ident["id"], "ABC-123-456")
    assert db.restore_identity("ABC-123-456")["id"] == ident["id"]
    assert db.restore_identity("WRONG") is None
    # regenerate kills old
    db.set_identity_code(ident["id"], "NEW-CODE-789")
    assert db.restore_identity("ABC-123-456") is None
    assert db.restore_identity("NEW-CODE-789")["id"] == ident["id"]
    print("PASS rename + code regenerate kills old code")


def test_claim_participant():
    """Guest "amel" should claim the creator-typed slot "Amel" (normalized match)."""
    creator = db.new_identity("Aufa", role="creator")
    bill = db.create_bill(
        creator_id=creator["id"], title="Makan", tax_mode="proportional",
        subtotal=30000, tax=0, service=0, total=30000,
        items=[{"name": "A", "price": 10000}, {"name": "B", "price": 20000}],
        participants=["Aufa", "Amel"],
    )
    bid = bill["id"]

    # before claim: participant exists unclaimed
    data = db.get_bill(bid)
    part = next(p for p in data["participants"] if p["name"] == "Amel")
    assert part["identity_id"] is None, part

    # guest with different casing claims it on selection
    amel = db.new_identity("amel")
    db.claim_participant(bid, amel["id"], amel["name"])
    data = db.get_bill(bid)
    part = next(p for p in data["participants"] if p["name"] == "Amel")
    assert part["identity_id"] == amel["id"], part

    # a second "amel" can't steal the claim
    amel2 = db.new_identity("AMEL")
    db.claim_participant(bid, amel2["id"], amel2["name"])
    data = db.get_bill(bid)
    part = next(p for p in data["participants"] if p["name"] == "Amel")
    assert part["identity_id"] == amel["id"], part

    # claim survives update_bill (same name keeps its identity link)
    db.update_bill(bid, title="Makan Bareng", merchant=None, transacted_at=None,
                   participants=["Aufa", "Amel"], items=[{"name": "A", "price": 10000}],
                   subtotal=10000, tax=0, service=0, total=10000)
    data = db.get_bill(bid)
    part = next(p for p in data["participants"] if p["name"] == "Amel")
    assert part["identity_id"] == amel["id"], part

    # response payload: participants include identity_id, claimed person shows canonical name
    from main import _compute_response
    resp = _compute_response(db.get_bill(bid))
    part = next(p for p in resp["participants"] if p["name"] == "Amel")
    assert part["identity_id"] == amel["id"], resp["participants"]
    db.set_selections(bid, amel["id"], [data["items"][0]["id"]])
    resp = _compute_response(db.get_bill(bid))
    amel_person = next(p for p in resp["people"] if p["identity_id"] == amel["id"])
    assert amel_person["name"] == "Amel", resp["people"]
    print("PASS claim participant: normalized matching, no double identity, survives edit")


def test_join_and_remove_person():
    """Join-based roster: creator declares count, guests join, creator can delete."""
    creator = db.new_identity("Aufa", role="creator")
    bill = db.create_bill(
        creator_id=creator["id"], title="Makan", tax_mode="proportional",
        subtotal=30000, tax=0, service=0, total=30000,
        items=[{"name": "A", "price": 10000}, {"name": "B", "price": 20000}],
        participants=[], participant_count=3,
    )
    bid = bill["id"]
    data = db.get_bill(bid)
    assert data["bill"]["participant_count"] == 3

    # two guests join (no selections yet)
    amel = db.new_identity("amel")
    budi = db.new_identity("Budi")
    db.join_bill(bid, amel["id"], "amel")
    db.join_bill(bid, budi["id"], "Budi")

    # roster includes joined-but-unselected people
    from main import _compute_response
    resp = _compute_response(db.get_bill(bid))
    names = {p["identity_id"]: p["name"] for p in resp["people"]}
    assert names[amel["id"]] == "amel", names
    assert names[budi["id"]] == "Budi", names
    joined = [p for p in resp["people"] if p["total_idr"] == 0]
    # creator is always in the roster now (paid, 0 total) + 2 joined guests
    assert len(joined) == 3, resp["people"]
    assert len(resp["people"]) == 3, resp["people"]

    # creator removes a wrong/double join -> gone from roster + selections
    amel_id = amel["id"]
    db.set_selections(bid, amel_id, [data["items"][0]["id"]])
    assert len(db.get_bill(bid)["selections"]) == 1
    db.remove_person(bid, amel_id)
    data = db.get_bill(bid)
    assert len(data["selections"]) == 0, data["selections"]
    assert all(p["identity_id"] != amel_id for p in data["payments"]), data["payments"]
    resp = _compute_response(data)
    assert all(p["identity_id"] != amel_id for p in resp["people"]), resp["people"]
    # budi still there
    assert any(p["identity_id"] == budi["id"] for p in resp["people"])
    print("PASS join roster + creator removes wrong/double join")


def test_delete_bill_and_settled():
    """Creator deletes bill (cascades), settled reflects paid status."""
    creator = db.new_identity("Aufa", role="creator")
    bill = db.create_bill(
        creator_id=creator["id"], title="Makan", tax_mode="proportional",
        subtotal=30000, tax=3000, service=2000, total=35000,
        items=[{"name": "A", "price": 10000}, {"name": "B", "price": 20000}],
        participants=[], participant_count=2,
    )
    bid = bill["id"]
    guest = db.new_identity("Rina")
    data = db.get_bill(bid)
    db.join_bill(bid, guest["id"], "Rina")
    db.set_selections(bid, guest["id"], [data["items"][0]["id"]])

    # not settled yet (guest has selections, unpaid)
    from main import _compute_response
    resp = _compute_response(db.get_bill(bid))
    assert resp["settled"] is False, resp["settled"]

    db.mark_paid(bid, guest["id"])
    resp = _compute_response(db.get_bill(bid))
    assert resp["settled"] is True, resp["settled"]

    # creator delete cascades everything
    assert db.delete_bill(bid, creator["id"]) is True
    assert db.get_bill(bid) is None
    assert db.delete_bill(bid, creator["id"]) is False  # already gone
    # non-creator can't delete
    bill2 = db.create_bill(
        creator_id=creator["id"], title="Lain", tax_mode="proportional",
        subtotal=10000, tax=0, service=0, total=10000,
        items=[{"name": "A", "price": 10000}], participants=[],
    )
    assert db.delete_bill(bill2["id"], guest["id"]) is False
    assert db.get_bill(bill2["id"]) is not None

    # bills list includes creator + settled flags
    bills = db.get_bills_for_identity(creator["id"])
    assert all("creator_identity_id" in b and "settled" in b for b in bills), bills
    assert any(b["id"] == bill2["id"] and b["creator_identity_id"] == creator["id"] and b["settled"] is False for b in bills), bills
    print("PASS delete bill cascade + settled status + bills list flags")


def test_mark_unpaid():
    """Undo 'sudah bayar' flips settled back to False and clears paid_at."""
    creator = db.new_identity("Aufa", role="creator")
    bill = db.create_bill(
        creator_id=creator["id"], title="Makan", tax_mode="proportional",
        subtotal=30000, tax=0, service=0, total=30000,
        items=[{"name": "A", "price": 30000}], participants=[],
    )
    bid = bill["id"]
    guest = db.new_identity("Rina")
    data = db.get_bill(bid)
    db.join_bill(bid, guest["id"], "Rina")
    db.set_selections(bid, guest["id"], [data["items"][0]["id"]])

    from main import _compute_response
    assert _compute_response(db.get_bill(bid))["settled"] is False

    db.mark_paid(bid, guest["id"])
    assert _compute_response(db.get_bill(bid))["settled"] is True
    paid = db.get_bill(bid)["payments"][0]
    assert paid["status"] == "paid" and paid["paid_at"] is not None

    db.mark_unpaid(bid, guest["id"])
    assert _compute_response(db.get_bill(bid))["settled"] is False
    unpaid = db.get_bill(bid)["payments"][0]
    assert unpaid["status"] == "unpaid" and unpaid["paid_at"] is None
    print("PASS mark_unpaid: undo flips settled back, clears paid_at")


def test_paid_by():
    """Who paid the bill: default creator, resolve on join, auto-paid, accounts."""
    from main import _compute_response
    creator = db.new_identity("Aufa", role="creator")
    guest = db.new_identity("Budi")

    # default: creator pays -> creator auto-paid even with no payment row
    bill = db.create_bill(
        creator_id=creator["id"], title="Makan", tax_mode="proportional",
        subtotal=20000, tax=0, service=0, total=20000,
        items=[{"name": "A", "price": 20000}], participants=["Aufa", "Budi"],
    )
    bid = bill["id"]
    data = db.get_bill(bid)
    db.set_selections(bid, guest["id"], [data["items"][0]["id"]])
    resp = _compute_response(db.get_bill(bid))
    assert resp["paid_by_id"] == creator["id"]
    assert resp["paid_by_name"] == "Aufa"
    assert next(p for p in resp["people"] if p["identity_id"] == creator["id"])["paid"] == "paid"
    assert next(p for p in resp["people"] if p["identity_id"] == guest["id"])["paid"] == "unpaid"
    assert resp["settled"] is False  # guest hasn't paid

    # creator marks themselves paid via normal flow? not needed — auto
    db.mark_paid(bid, guest["id"])
    assert _compute_response(db.get_bill(bid))["settled"] is True

    # paid_by = guest by name: placeholder resolved once they join
    bill2 = db.create_bill(
        creator_id=creator["id"], title="Makan2", tax_mode="proportional",
        subtotal=20000, tax=0, service=0, total=20000,
        items=[{"name": "A", "price": 20000}], participants=["Aufa", "Budi"],
        paid_by_name="Budi",
    )
    bid2 = bill2["id"]
    resp = _compute_response(db.get_bill(bid2))
    assert resp["paid_by_name"] == "Budi"
    assert resp["paid_by_id"] == creator["id"]  # fallback: creator until Budi joins
    # Budi joins + claims slot -> resolves to his identity
    db.join_bill(bid2, guest["id"], "Budi")
    resp = _compute_response(db.get_bill(bid2))
    assert resp["paid_by_id"] == guest["id"]
    assert resp["paid_by_name"] == "Budi"
    assert next(p for p in resp["people"] if p["identity_id"] == guest["id"])["paid"] == "paid"
    # settled immediately if only payer selected items
    data2 = db.get_bill(bid2)
    db.set_selections(bid2, guest["id"], [data2["items"][0]["id"]])
    assert _compute_response(db.get_bill(bid2))["settled"] is True

    # set_paid_by: creator re-assigns payer by identity (must be in roster)
    assert db.set_paid_by(bid2, creator["id"]) is None  # creator pays again
    resp = _compute_response(db.get_bill(bid2))
    assert resp["paid_by_id"] == creator["id"]
    print("PASS paid_by: default creator, resolve on join, auto-paid, re-assign")


if __name__ == "__main__":
    test_update_bill_diff()
    test_payment_accounts()
    test_rename_and_code()
    test_claim_participant()
    test_join_and_remove_person()
    test_delete_bill_and_settled()
    test_mark_unpaid()
    test_paid_by()
    print("\nALL PASS")
