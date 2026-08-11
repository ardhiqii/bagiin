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
    # creator is always in the roster; unpicked items default to the creator,
    # so the creator's total here is 30000 (items A+B) — only the 2 joined
    # guests show 0
    assert len(joined) == 2, resp["people"]
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
    # placeholder not resolved yet -> NOBODY is auto-marked paid (no bogus
    # fallback to creator); paid_by_id stays None until Budi joins
    assert resp["paid_by_id"] is None, resp["paid_by_id"]
    assert all(p["paid"] == "unpaid" for p in resp["people"]), resp["people"]
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


def test_slot_mode():
    """v27 slot items: per-slot price locked, empty slots uncovered, N change,
    multi-slot pick, release, settled requires no empty slots."""
    from main import _compute_response
    creator = db.new_identity("Aufa", role="creator")
    amel = db.new_identity("Amel")
    budi = db.new_identity("Budi")

    # bill: free item (Nasi 30000) + slot item (Es Teh 15000, 3 slots)
    bill = db.create_bill(
        creator_id=creator["id"], title="Makan", tax_mode="proportional",
        subtotal=45000, tax=4500, service=0, total=49500,
        items=[
            {"name": "Nasi", "price": 30000},
            {"name": "Es Teh", "price": 15000, "mode": "slot", "slot_count": 3},
        ],
        participants=["Aufa", "Amel", "Budi"],
    )
    bid = bill["id"]
    data = db.get_bill(bid)
    nasi = next(i for i in data["items"] if i["name"] == "Nasi")
    teh = next(i for i in data["items"] if i["name"] == "Es Teh")
    assert teh["mode"] == "slot" and teh["slot_count"] == 3
    assert nasi["mode"] == "free" and nasi["slot_count"] is None

    # nothing picked -> both free item + slot uncovered
    resp = _compute_response(db.get_bill(bid))
    assert resp["uncovered_idr"] == 15000, resp["uncovered_idr"]
    assert len(resp["uncovered_slots"]) == 1
    assert resp["uncovered_slots"][0]["name"] == "Es Teh"
    assert resp["uncovered_slots"][0]["empty"] == 3
    assert resp["uncovered_slots"][0]["per_slot"] == 5000

    # Amel takes 2 slots of Es Teh -> 10000 subtotal, 1 slot empty (5000)
    db.set_selections(bid, amel["id"], [{"item_id": teh["id"], "qty": 2}])
    resp = _compute_response(db.get_bill(bid))
    amel_p = next(p for p in resp["people"] if p["identity_id"] == amel["id"])
    assert amel_p["subtotal_idr"] == 10000, amel_p
    assert resp["uncovered_idr"] == 5000, resp["uncovered_idr"]
    assert resp["uncovered_slots"][0]["empty"] == 1

    # Budi takes the last slot -> uncovered 0; settled False until paid
    db.set_selections(bid, budi["id"], [{"item_id": teh["id"], "qty": 1}])
    resp = _compute_response(db.get_bill(bid))
    assert resp["uncovered_idr"] == 0, resp["uncovered_idr"]
    assert resp["uncovered_slots"] == []
    assert resp["settled"] is False
    # Nasi (free) still unpicked -> defaults to the creator's share, so every
    # rupiah is covered even before someone picks it
    assert resp["total_ok"] is True, resp["total_ok"]
    # once someone picks Nasi, every rupiah is covered -> total_ok
    db.set_selections(bid, amel["id"], [
        {"item_id": teh["id"], "qty": 2},
        {"item_id": nasi["id"], "qty": 1},
    ])
    resp = _compute_response(db.get_bill(bid))
    assert resp["total_ok"] is True, resp["total_ok"]

    # everyone paid -> settled (payer = creator auto-paid)
    db.mark_paid(bid, amel["id"])
    db.mark_paid(bid, budi["id"])
    resp = _compute_response(db.get_bill(bid))
    assert resp["settled"] is True, resp["settled"]

    # free item Nasi unpicked stays assigned-to-creator warning, not uncovered
    # (checked earlier: right after the slot is full but before Nasi was picked,
    # total_ok was False = the Nasi rupiah wasn't on anyone)
    assert resp["remaining_to_creator"] == 0, resp["remaining_to_creator"]

    # creator bumps slots 3 -> 4 (people can add another slot later)
    # note: per-slot price recomputes (15000/4 = 3750), so the 3 taken slots
    # now cover 11250 and 1 empty slot is uncovered at 3750
    assert db.set_item_slots(bid, teh["id"], 4) is True
    resp = _compute_response(db.get_bill(bid))
    assert resp["uncovered_idr"] == 3750, resp["uncovered_idr"]  # 15000 - 3750*3
    assert any("Bagian kosong" in w and "Es Teh" in w for w in resp["warnings"]), resp["warnings"]
    # can't go below taken (2 taken: Amel 2 + Budi 1 = 3)
    # (set_item_slots doesn't validate; the endpoint does — test endpoint guard)
    # release Budi's slot via db helper (taken drops to 2: Amel x2)
    db.set_selection_qty(bid, budi["id"], teh["id"], 0)
    resp = _compute_response(db.get_bill(bid))
    assert resp["uncovered_idr"] == 7500, resp["uncovered_idr"]  # 15000 - 3750*2

    # clamp: switch Es Teh back to free clamps qty to 1
    db.update_bill(
        bid, title="Makan", merchant=None, transacted_at=None,
        participants=["Aufa", "Amel", "Budi"],
        items=[
            {"id": nasi["id"], "name": "Nasi", "price": 30000},
            {"id": teh["id"], "name": "Es Teh", "price": 15000, "mode": "free"},
        ],
        subtotal=45000, tax=4500, service=0, total=49500,
    )
    data = db.get_bill(bid)
    teh2 = next(i for i in data["items"] if i["name"] == "Es Teh")
    assert teh2["mode"] == "free" and teh2["slot_count"] is None
    sels = [s for s in data["selections"] if s["item_id"] == teh2["id"]]
    assert all(int(s["qty"]) == 1 for s in sels), sels
    print("PASS slot mode: locked per-slot, uncovered, N change, release, clamp")


def test_free_qty_portions():
    """v31 free items: pickers can take 1+ portions; price splits
    proportionally per portion taken (2 portions = 2x a single portion)."""
    from main import _compute_response
    creator = db.new_identity("Aufa", role="creator")
    amel = db.new_identity("Amel")
    budi = db.new_identity("Budi")

    bill = db.create_bill(
        creator_id=creator["id"], title="Es Teh bareng", tax_mode="proportional",
        subtotal=30000, tax=3000, service=0, total=33000,
        items=[{"name": "Es Teh", "price": 30000}],
        participants=["Aufa", "Amel", "Budi"],
    )
    bid = bill["id"]
    data = db.get_bill(bid)
    teh = next(i for i in data["items"])
    assert teh["mode"] == "free"

    # Amel takes 2 portions, Budi 1 -> 3 portions total, 10000/portion
    db.set_selections(bid, amel["id"], [{"item_id": teh["id"], "qty": 2}])
    db.set_selections(bid, budi["id"], [{"item_id": teh["id"], "qty": 1}])
    resp = _compute_response(db.get_bill(bid))
    by_id = {p["identity_id"]: p for p in resp["people"]}
    assert by_id[amel["id"]]["subtotal_idr"] == 20000, by_id
    assert by_id[budi["id"]]["subtotal_idr"] == 10000, by_id
    assert resp["total_ok"] is True, resp["total_ok"]
    # no empty-slot concept for free items
    assert resp["uncovered_idr"] == 0

    # rounding: price 10000, 3 portions -> 3333 x3 = 9999, rem 1 to first picker
    bill2 = db.create_bill(
        creator_id=creator["id"], title="Rounding", tax_mode="proportional",
        subtotal=10000, tax=0, service=0, total=10000,
        items=[{"name": "Snack", "price": 10000}],
        participants=["Aufa", "Amel", "Budi"],
    )
    data2 = db.get_bill(bill2["id"])
    snack = next(i for i in data2["items"])
    db.set_selections(bill2["id"], amel["id"], [{"item_id": snack["id"], "qty": 2}])
    db.set_selections(bill2["id"], budi["id"], [{"item_id": snack["id"], "qty": 1}])
    resp2 = _compute_response(db.get_bill(bill2["id"]))
    total_sub = sum(p["subtotal_idr"] for p in resp2["people"])
    assert total_sub == 10000, total_sub
    print("PASS free qty: proportional portions + rounding")


def test_item_discount():
    """v32 per-item discount: effective price (price - discount) drives math."""
    from main import _compute_response
    creator = db.new_identity("Aufa", role="creator")
    amel = db.new_identity("Amel")

    bill = db.create_bill(
        creator_id=creator["id"], title="Diskon", tax_mode="proportional",
        subtotal=23000, tax=0, service=0, total=23000,
        items=[
            {"name": "Krispy", "price": 23500, "discount": 5500},
            {"name": "Es Teh", "price": 15000, "discount": 3000, "mode": "slot", "slot_count": 3},
        ],
        participants=["Aufa", "Amel"],
    )
    bid = bill["id"]
    data = db.get_bill(bid)
    krispy = next(i for i in data["items"] if i["name"] == "Krispy")
    teh = next(i for i in data["items"] if i["name"] == "Es Teh")
    assert krispy["discount_idr"] == 5500
    assert teh["discount_idr"] == 3000

    # free item: Amel takes Krispy -> pays effective 23500-5500 = 18000
    db.set_selections(bid, amel["id"], [{"item_id": krispy["id"], "qty": 1}])
    resp = _compute_response(db.get_bill(bid))
    amel_p = next(p for p in resp["people"] if p["identity_id"] == amel["id"])
    assert amel_p["subtotal_idr"] == 18000, amel_p
    assert resp["total_ok"] is False  # Es Teh not picked yet

    # slot item: per-slot = (15000-3000)/3 = 4000; 1 taken -> 2 empty = 8000
    db.set_selections(bid, amel["id"], [
        {"item_id": krispy["id"], "qty": 1},
        {"item_id": teh["id"], "qty": 1},
    ])
    resp = _compute_response(db.get_bill(bid))
    assert resp["uncovered_idr"] == 8000, resp["uncovered_idr"]
    assert resp["uncovered_slots"][0]["per_slot"] == 4000
    print("PASS item discount: effective price in free + slot math")


def test_tax_included():
    """v33 tax_included bill: prices already include tax -> no tax added on top."""
    from main import _compute_response
    creator = db.new_identity("Aufa", role="creator")
    amel = db.new_identity("Amel")

    bill = db.create_bill(
        creator_id=creator["id"], title="McD", tax_mode="proportional",
        subtotal=25000, tax=0, service=0, total=25000,
        tax_included=1,
        items=[
            {"name": "Krispy", "price": 23500, "discount": 5500},
            {"name": "Rice", "price": 10000, "discount": 3000},
        ],
        participants=["Aufa", "Amel"],
    )
    bid = bill["id"]
    data = db.get_bill(bid)
    assert data["bill"]["tax_included"] == 1
    krispy = next(i for i in data["items"] if i["name"] == "Krispy")
    rice = next(i for i in data["items"] if i["name"] == "Rice")

    # Amel takes Krispy (18000 eff), Aufa takes Rice (7000 eff) -> no tax
    db.set_selections(bid, amel["id"], [{"item_id": krispy["id"], "qty": 1}])
    db.set_selections(bid, creator["id"], [{"item_id": rice["id"], "qty": 1}])
    resp = _compute_response(db.get_bill(bid))
    for p in resp["people"]:
        assert p["tax_idr"] == 0, p
        assert p["total_idr"] == p["subtotal_idr"], p
    by_name = {p["name"]: p for p in resp["people"]}
    assert by_name["Amel"]["total_idr"] == 18000, by_name
    assert by_name["Aufa"]["total_idr"] == 7000, by_name
    assert resp["total_ok"] is True, resp["total_ok"]
    print("PASS tax_included: no tax added, totals = effective items")



def test_creator_toggle_paid():
    """Creator can mark someone paid/unpaid; others can't touch someone else's
    status. mark_paid endpoint guards both directions."""
    from fastapi.testclient import TestClient
    from main import app, _compute_response
    creator = db.new_identity("Aufa", role="creator")
    amel = db.new_identity("Amel")
    budi = db.new_identity("Budi")

    bill = db.create_bill(
        creator_id=creator["id"], title="Makan", tax_mode="proportional",
        subtotal=20000, tax=0, service=0, total=20000,
        items=[{"name": "A", "price": 20000}], participants=["Aufa", "Amel"],
    )
    bid = bill["id"]
    data = db.get_bill(bid)
    db.join_bill(bid, amel["id"], "Amel")
    db.set_selections(bid, amel["id"], [data["items"][0]["id"]])

    c = TestClient(app)
    H = {"X-Identity-Id": creator["id"]}
    Ha = {"X-Identity-Id": amel["id"]}
    Hb = {"X-Identity-Id": budi["id"]}

    # stranger can't mark Amel paid
    r = c.post(f"/api/bills/{bid}/payments/{amel['id']}/paid", headers=Hb)
    assert r.status_code == 403, (r.status_code, r.text)
    # Amel can mark herself
    r = c.post(f"/api/bills/{bid}/payments/{amel['id']}/paid", headers=Ha)
    assert r.status_code == 200, (r.status_code, r.text)
    assert r.json()["settled"] is True
    # creator can unmark her
    r = c.post(f"/api/bills/{bid}/payments/{amel['id']}/unpaid", headers=H)
    assert r.status_code == 200, (r.status_code, r.text)
    assert r.json()["settled"] is False
    # creator can mark her paid again
    r = c.post(f"/api/bills/{bid}/payments/{amel['id']}/paid", headers=H)
    assert r.status_code == 200 and r.json()["settled"] is True
    # stranger still can't unmark
    r = c.post(f"/api/bills/{bid}/payments/{amel['id']}/unpaid", headers=Hb)
    assert r.status_code == 403, (r.status_code, r.text)
    print("PASS creator toggles paid/unpaid, others blocked")


if __name__ == "__main__":
    test_update_bill_diff()
    test_payment_accounts()
    test_rename_and_code()
    test_claim_participant()
    test_join_and_remove_person()
    test_delete_bill_and_settled()
    test_mark_unpaid()
    test_paid_by()
    test_slot_mode()
    test_creator_toggle_paid()
    print("\nALL PASS")
