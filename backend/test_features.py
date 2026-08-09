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


if __name__ == "__main__":
    test_update_bill_diff()
    test_payment_accounts()
    test_rename_and_code()
    print("\nALL PASS")
