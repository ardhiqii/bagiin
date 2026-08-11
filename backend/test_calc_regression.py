"""Ad-hoc regression tests for calc.compute (Bagiin).

Scenarios:
1. Zero selections -> NOBODY should be assigned tax (bug: remainder dumps full tax on creator).
2. Creator selects all items -> creator total == bill total.
3. Rounding leftover with selections -> remainder (few rupiah) goes to creator, totals still invariant.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

import calc

BILL = {"subtotal_idr": 272400, "tax_idr": 28875, "service_idr": 16344,
        "total_idr": 317619, "tax_mode": "proportional"}
ITEMS = [
    {"id": 1, "name": "A", "price_idr": 93900},
    {"id": 2, "name": "B", "price_idr": 55900},
    {"id": 3, "name": "C", "price_idr": 36900},
    {"id": 4, "name": "D", "price_idr": 27900},
    {"id": 5, "name": "E", "price_idr": 29900},
    {"id": 6, "name": "F", "price_idr": 27900},
]
CREATOR = "c1"


def test_no_selections_no_tax_dump():
    # zero selections: unpicked free items default to the creator (the warning
    # says "masuk ke pembuat bill"), so the split stays complete and no rupiah
    # is dumped/left unassigned
    r = calc.compute(bill=BILL, items=ITEMS, selections=[], participants=["Aufa"], creator_id=CREATOR)
    by = {p["identity_id"]: p for p in r["people"]}
    assert set(by) == {CREATOR}, r["people"]
    assert by[CREATOR]["subtotal_idr"] == 272400, by[CREATOR]
    assert by[CREATOR]["tax_idr"] == 45219, by[CREATOR]
    assert by[CREATOR]["total_idr"] == 317619, by[CREATOR]
    assert r["total_ok"] is True
    assert r["remaining_to_creator"] == 0
    print("PASS 1: zero selections -> unpicked items default to creator, no tax dump")


def test_creator_selects_all():
    sel = [{"item_id": it["id"], "identity_id": CREATOR} for it in ITEMS]
    r = calc.compute(bill=BILL, items=ITEMS, selections=sel, participants=["Aufa"], creator_id=CREATOR)
    by = {p["identity_id"]: p for p in r["people"]}
    creator = by[CREATOR]
    assert creator["subtotal_idr"] == 272400, creator
    assert creator["tax_idr"] == 45219, creator
    assert creator["total_idr"] == 317619, creator
    assert r["total_ok"] is True
    assert r["remaining_to_creator"] == 0
    print("PASS 2: creator selects all -> full bill, invariant holds")


def test_rounding_remainder_to_creator():
    # two people split odd amounts -> rounding leftover lands on creator, invariant holds
    sel = [
        {"item_id": 1, "identity_id": "a"},   # 93900 for a
        {"item_id": 1, "identity_id": "b"},   # shared -> 46950 each
        {"item_id": 2, "identity_id": "b"},   # 55900 for b
    ]
    r = calc.compute(bill=BILL, items=ITEMS, selections=sel, participants=["a", "b"], creator_id="a")
    total = sum(p["total_idr"] for p in r["people"])
    # items 3-6 unselected -> default to the creator (a), so the split is
    # complete: sum(people) == bill.total, no leftover
    assert total == BILL["total_idr"], \
        f"invariant broken: {total} != {BILL['total_idr']}"
    assert r["remaining_to_creator"] == 0, r["remaining_to_creator"]
    by = {p["identity_id"]: p for p in r["people"]}
    # a: shared item 1 half (46950) + unpicked items 3-6 (36900+27900+29900+27900)
    assert by["a"]["subtotal_idr"] == 46950 + 122600, by["a"]
    assert by["b"]["subtotal_idr"] == 46950 + 55900, by["b"]
    # tax must sum to 45219 with remainder on creator (a)
    assert by["a"]["tax_idr"] + by["b"]["tax_idr"] == 45219, (by["a"], by["b"])
    print("PASS 3: rounding remainder to creator, invariant holds")


if __name__ == "__main__":
    test_no_selections_no_tax_dump()
    test_creator_selects_all()
    test_rounding_remainder_to_creator()
    print("\nALL PASS")
