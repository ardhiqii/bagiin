"""Baris "bebas pilih" tidak boleh menagih lebih dari harga satuannya.

Aturan (sejak fitur ini): harga per klaim = min(harga satuan, total baris /
jumlah klaim). Kalau yang mengklaim lebih sedikit daripada jumlah yang dibeli,
selisihnya jadi "belum ada yang ambil" (uncovered) dan ditanggung yang
nalangin — bukan dibebankan ke orang pertama yang mengetuk.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

import calc


def bill_for(items, tax=0, service=0):
    subtotal = sum(it["price_idr"] * it.get("quantity", 1) for it in items)
    return {
        "subtotal_idr": subtotal,
        "tax_idr": tax,
        "service_idr": service,
        "order_discount_idr": 0,
        "cashback_idr": 0,
        "total_idr": subtotal + tax + service,
        "tax_mode": "proportional",
    }, items


def run(items, picks, tax=0, service=0, fallback="owner"):
    bill, item_list = bill_for(items, tax, service)
    sel = [
        {"item_id": item_id, "identity_id": who, "qty": qty}
        for (item_id, who, qty) in picks
    ]
    people = sorted({who for (_, who, _) in picks})
    return calc.compute(bill, item_list, sel, people, fallback)


def totals(result):
    return {p["identity_id"]: p["total_idr"] for p in result["people"]}


def test_single_claim_on_two_units_pays_one_unit():
    # RE Blok M: tiket 2 x 62.000, satu orang ambil satu. Dulu dia ditagih 124.000.
    items = [{"id": 1, "name": "tiket", "price_idr": 62000, "mode": "free", "quantity": 2}]
    r = run(items, [(1, "amel", 1)])
    assert totals(r) == {"amel": 62000}, totals(r)
    assert r["uncovered_idr"] == 62000, r["uncovered_idr"]
    slot = r["uncovered_slots"][0]
    assert slot["name"] == "tiket" and slot["empty"] == 1 and slot["per_slot"] == 62000, slot
    assert r["total_ok"] is True


def test_single_claim_on_three_units_pays_one_unit():
    items = [{"id": 1, "name": "Es teh", "price_idr": 5000, "mode": "free", "quantity": 3}]
    r = run(items, [(1, "amel", 1)])
    assert totals(r) == {"amel": 5000}, totals(r)
    assert r["uncovered_idr"] == 10000, r["uncovered_idr"]
    assert r["uncovered_slots"][0]["empty"] == 2, r["uncovered_slots"]


def test_all_units_claimed_pays_unit_price():
    items = [{"id": 1, "name": "Es teh", "price_idr": 5000, "mode": "free", "quantity": 3}]
    r = run(items, [(1, "a", 1), (1, "b", 1), (1, "c", 1)])
    assert totals(r) == {"a": 5000, "b": 5000, "c": 5000}, totals(r)
    assert r["uncovered_idr"] == 0, r["uncovered_idr"]


def test_more_people_than_units_shares_the_line():
    # 3 es teh dipatok 6 orang: ini kasus patungan, harga boleh turun.
    items = [{"id": 1, "name": "Es teh", "price_idr": 5000, "mode": "free", "quantity": 3}]
    r = run(items, [(1, who, 1) for who in "abcdef"])
    assert totals(r) == {who: 2500 for who in "abcdef"}, totals(r)
    assert r["uncovered_idr"] == 0, r["uncovered_idr"]
    assert sum(totals(r).values()) == 15000


def test_one_portion_shared_by_two_people():
    # Darilaut: Rahang Tuna 135.000 (qty 1) dimakan berdua.
    items = [{"id": 1, "name": "Rahang Tuna", "price_idr": 135000, "mode": "free", "quantity": 1}]
    r = run(items, [(1, "a", 1), (1, "b", 1)])
    assert totals(r) == {"a": 67500, "b": 67500}, totals(r)
    assert r["uncovered_idr"] == 0, r["uncovered_idr"]


def test_one_person_takes_two_of_three_units():
    items = [{"id": 1, "name": "Es teh", "price_idr": 5000, "mode": "free", "quantity": 3}]
    r = run(items, [(1, "amel", 2)])
    assert totals(r) == {"amel": 10000}, totals(r)
    assert r["uncovered_idr"] == 5000, r["uncovered_idr"]


def test_invariant_holds_with_tax_and_partial_claim():
    items = [{"id": 1, "name": "tiket", "price_idr": 62000, "mode": "free", "quantity": 2}]
    bill, item_list = bill_for(items, tax=6200, service=3100)
    sel = [{"item_id": 1, "identity_id": "amel", "qty": 1}]
    r = calc.compute(bill, item_list, sel, ["amel"], "amel")
    assert r["total_ok"] is True, r
    paid = sum(p["total_idr"] for p in r["people"])
    assert paid + r["uncovered_idr"] + r["remaining_to_creator"] == bill["total_idr"], (
        paid, r["uncovered_idr"], r["remaining_to_creator"], bill["total_idr"])


def test_rounding_still_splits_evenly_when_all_claimed():
    # 10.001 dibagi 3 orang: 3.333 + sisa 2 rupiah tetap masuk, bukan jadi uncovered.
    items = [{"id": 1, "name": "Kopi", "price_idr": 10001, "mode": "free", "quantity": 3}]
    r = run(items, [(1, "a", 1), (1, "b", 1), (1, "c", 1)])
    assert sum(totals(r).values()) == 30003, totals(r)
    assert r["uncovered_idr"] == 0, r["uncovered_idr"]


def test_slot_mode_untouched():
    # Bill lama bermode slot harus tetap sama persis.
    items = [{"id": 1, "name": "Pizza", "price_idr": 200000, "mode": "slot",
              "quantity": 1, "slot_count": 8}]
    r = run(items, [(1, "a", 2), (1, "b", 1)])
    assert totals(r) == {"a": 50000, "b": 25000}, totals(r)
    assert r["uncovered_idr"] == 125000, r["uncovered_idr"]


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print("PASS", name)
