"""Focused mutation-regression tests for calc.compute's money invariants."""
import calc


def bill(total, *, tax=0, service=0, mode="proportional", tax_included=False):
    return {
        "subtotal_idr": total - tax - service,
        "tax_idr": tax,
        "service_idr": service,
        "total_idr": total,
        "tax_mode": mode,
        "tax_included": tax_included,
    }


def person(result, identity):
    return result["by_identity"][identity]


def test_free_split_round_robin_and_qty_are_per_serving():
    result = calc.compute(
        bill=bill(5),
        items=[{"id": 1, "name": "snack", "price_idr": 5}],
        selections=[
            {"item_id": 1, "identity_id": "alice", "qty": 2},
            {"item_id": 1, "identity_id": "bob", "qty": 1},
        ],
        participants=[],
        fallback_id="alice",
    )
    # Kills mutants 84 and 86-92: split the base by qty and distribute each Rp1 remainder by serving.
    assert person(result, "alice")["subtotal_idr"] == 3
    assert person(result, "bob")["subtotal_idr"] == 2
    assert result["total_ok"] is True


def test_slot_split_rounds_each_empty_remainder_to_taken_slots():
    result = calc.compute(
        bill=bill(10),
        items=[{"id": 1, "name": "pizza", "price_idr": 10, "mode": "slot", "slot_count": 3}],
        selections=[
            {"item_id": 1, "identity_id": "alice", "qty": 2},
            {"item_id": 1, "identity_id": "bob", "qty": 1},
        ],
        participants=[],
        fallback_id="alice",
    )
    # Kills mutants 37-53: all slots are covered and the Rp1 remainder is applied per slot, not per holder.
    assert person(result, "alice")["subtotal_idr"] == 7
    assert person(result, "bob")["subtotal_idr"] == 3
    assert result["uncovered_idr"] == 0
    assert result["total_ok"] is True


def test_partially_taken_slots_report_empty_slot_value():
    result = calc.compute(
        bill=bill(10),
        items=[{"id": 1, "name": "pizza", "price_idr": 10, "mode": "slot", "slot_count": 4}],
        selections=[{"item_id": 1, "identity_id": "alice", "qty": 1}],
        participants=[],
        fallback_id="owner",
    )
    # Kills mutants 54-69 and 162-170: an uncovered slot remains uncovered and is not a free-item assignment.
    assert person(result, "alice")["subtotal_idr"] == 2
    assert result["uncovered_idr"] == 8
    assert result["uncovered_slots"] == [{
        "item_id": 1, "name": "pizza", "per_slot": 2, "empty": 3, "amount_idr": 8,
    }]
    assert result["unassigned_items"] == []
    assert result["total_ok"] is True


def test_equal_tax_rounds_one_rupiah_to_first_positive_payer():
    result = calc.compute(
        bill=bill(12, tax=5, mode="equal"),
        items=[
            {"id": 1, "name": "a", "price_idr": 3},
            {"id": 2, "name": "b", "price_idr": 4},
        ],
        selections=[
            {"item_id": 1, "identity_id": "alice"},
            {"item_id": 2, "identity_id": "bob"},
        ],
        participants=[],
        fallback_id="alice",
    )
    # Kills mutants 112-126: equal tax is integer-rounded and its Rp1 remainder is assigned once.
    assert person(result, "alice")["tax_idr"] == 3
    assert person(result, "bob")["tax_idr"] == 2
    assert sum(p["tax_idr"] for p in result["people"]) == 5


def test_proportional_tax_truncates_and_puts_rp1_diff_on_fallback():
    result = calc.compute(
        bill=bill(8, tax=2),
        items=[
            {"id": 1, "name": "a", "price_idr": 3},
            {"id": 2, "name": "b", "price_idr": 3},
        ],
        selections=[
            {"item_id": 1, "identity_id": "alice"},
            {"item_id": 2, "identity_id": "bob"},
        ],
        participants=[],
        fallback_id="alice",
    )
    # Kills mutants 130-144: Decimal proportional Rp1 truncation is reconciled onto fallback_id.
    assert person(result, "alice")["tax_idr"] == 1
    assert person(result, "bob")["tax_idr"] == 1
    assert result["total_ok"] is True


def test_zero_subtotal_still_receives_equal_tax_at_fallback():
    result = calc.compute(
        bill=bill(5, tax=5, mode="equal"),
        items=[{"id": 1, "name": "free", "price_idr": 0}],
        selections=[{"item_id": 1, "identity_id": "guest"}],
        participants=[],
        fallback_id="owner",
    )
    # Kills mutants 103-111: a non-empty all-zero subtotal must not make equal-mode tax disappear.
    assert person(result, "guest")["subtotal_idr"] == 0
    assert person(result, "owner")["tax_idr"] == 5
    assert result["total_ok"] is True


def test_tax_included_drops_tax_but_keeps_service_charge():
    result = calc.compute(
        bill=bill(13, tax=10, service=3, tax_included=True),
        items=[{"id": 1, "name": "meal", "price_idr": 10}],
        selections=[{"item_id": 1, "identity_id": "alice"}],
        participants=[],
        fallback_id="alice",
    )
    # Kills mutants 97-99: tax_included excludes only tax, while service remains payable.
    assert person(result, "alice")["subtotal_idr"] == 10
    assert person(result, "alice")["tax_idr"] == 3
    assert person(result, "alice")["total_idr"] == 13
    assert result["total_ok"] is True


def test_discount_quantity_and_default_selection_qty_are_explicit():
    discounted = calc.compute(
        bill=bill(16),
        items=[{"id": 1, "name": "meal", "price_idr": 10, "discount_idr": 2, "quantity": 2}],
        selections=[{"item_id": 1, "identity_id": "alice"}],
        participants=[],
        fallback_id="alice",
    )
    assert person(discounted, "alice")["total_idr"] == 16

    default_quantity = calc.compute(
        bill=bill(10),
        items=[{"id": 1, "name": "meal", "price_idr": 10}],
        selections=[{"item_id": 1, "identity_id": "alice"}],
        participants=[],
        fallback_id="alice",
    )
    assert person(default_quantity, "alice")["total_idr"] == 10

    default_selection_qty = calc.compute(
        bill=bill(5),
        items=[{"id": 1, "name": "snack", "price_idr": 5}],
        selections=[
            {"item_id": 1, "identity_id": "alice"},
            {"item_id": 1, "identity_id": "bob", "qty": 1},
        ],
        participants=[],
        fallback_id="alice",
    )
    assert person(default_selection_qty, "alice")["subtotal_idr"] == 3
    assert person(default_selection_qty, "bob")["subtotal_idr"] == 2


def test_slot_guards_do_not_reclassify_free_items_or_stop_following_items():
    free_with_slot_count = calc.compute(
        bill=bill(9),
        items=[{"id": 1, "name": "free", "price_idr": 9, "mode": "free", "slot_count": 3}],
        selections=[],
        participants=[],
        fallback_id="owner",
    )
    assert person(free_with_slot_count, "owner")["subtotal_idr"] == 9
    assert free_with_slot_count["uncovered_idr"] == 0
    assert free_with_slot_count["unassigned_items"]

    one_slot = calc.compute(
        bill=bill(3),
        items=[{"id": 1, "name": "one", "price_idr": 3, "mode": "slot", "slot_count": 1}],
        selections=[{"item_id": 1, "identity_id": "alice"}],
        participants=[],
        fallback_id="owner",
    )
    assert person(one_slot, "alice")["subtotal_idr"] == 3
    assert one_slot["uncovered_idr"] == 0

    slot_then_free = calc.compute(
        bill=bill(8),
        items=[
            {"id": 1, "name": "slot", "price_idr": 3, "mode": "slot", "slot_count": 1},
            {"id": 2, "name": "drink", "price_idr": 5},
        ],
        selections=[{"item_id": 1, "identity_id": "alice"}],
        participants=[],
        fallback_id="owner",
    )
    assert person(slot_then_free, "owner")["subtotal_idr"] == 5
    assert person(slot_then_free, "alice")["subtotal_idr"] == 3
    assert slot_then_free["total_ok"] is True


def test_slot_remainder_uncovered_and_warning_invariants():
    remainder = calc.compute(
        bill=bill(15),
        items=[{"id": 1, "name": "pizza", "price_idr": 15, "mode": "slot", "slot_count": 4}],
        selections=[
            {"item_id": 1, "identity_id": "alice", "qty": 3},
            {"item_id": 1, "identity_id": "bob", "qty": 1},
        ],
        participants=[],
        fallback_id="owner",
    )
    assert person(remainder, "alice")["subtotal_idr"] == 12
    assert person(remainder, "bob")["subtotal_idr"] == 3

    remainder_across_holders = calc.compute(
        bill=bill(14),
        items=[{"id": 1, "name": "pizza", "price_idr": 14, "mode": "slot", "slot_count": 4}],
        selections=[
            {"item_id": 1, "identity_id": "alice", "qty": 1},
            {"item_id": 1, "identity_id": "bob", "qty": 3},
        ],
        participants=[],
        fallback_id="owner",
    )
    assert person(remainder_across_holders, "alice")["subtotal_idr"] == 4
    assert person(remainder_across_holders, "bob")["subtotal_idr"] == 10

    partial = calc.compute(
        bill=bill(22),
        items=[
            {"id": 1, "name": "pizza", "price_idr": 10, "mode": "slot", "slot_count": 4},
            {"id": 2, "name": "cake", "price_idr": 6, "mode": "slot", "slot_count": 3},
            {"id": 3, "name": "free", "price_idr": 10, "discount_idr": 10, "mode": "slot", "slot_count": 4},
            {"id": 4, "name": "small", "price_idr": 2, "mode": "slot", "slot_count": 2},
            {"id": 5, "name": "empty", "price_idr": 4, "mode": "slot", "slot_count": 2},
        ],
        selections=[
            {"item_id": 1, "identity_id": "alice", "qty": 2},
            {"item_id": 2, "identity_id": "bob"},
            {"item_id": 3, "identity_id": "alice"},
            {"item_id": 4, "identity_id": "bob"},
        ],
        participants=[],
        fallback_id="owner",
    )
    assert partial["uncovered_idr"] == 15
    assert len(partial["uncovered_slots"]) == 4
    assert partial["unassigned_items"] == []
    assert partial["remaining_to_creator"] == 0
    assert partial["total_ok"] is True
    assert "warnings" in partial
    assert partial["warnings"] == [
        "Bagian kosong: pizza 2 bagian belum terisi (total Rp 6)",
        "Bagian kosong: cake 2 bagian belum terisi (total Rp 4)",
        "Bagian kosong: small 1 bagian belum terisi (total Rp 1)",
        "Bagian kosong: empty 2 bagian belum terisi (total Rp 4)",
    ]


def test_tax_modes_positive_payers_fallback_and_people_order():
    equal = calc.compute(
        bill=bill(9, tax=5, mode="equal"),
        items=[
            {"id": 1, "name": "small", "price_idr": 1},
            {"id": 2, "name": "large", "price_idr": 3},
        ],
        selections=[
            {"item_id": 1, "identity_id": "alice"},
            {"item_id": 2, "identity_id": "bob"},
        ],
        participants=[],
        fallback_id="alice",
    )
    assert person(equal, "alice")["tax_idr"] == 3
    assert person(equal, "bob")["tax_idr"] == 2

    creator_tax = calc.compute(
        bill=bill(7, tax=5, mode="creator"),
        items=[{"id": 1, "name": "meal", "price_idr": 2}],
        selections=[{"item_id": 1, "identity_id": "alice"}],
        participants=[],
        fallback_id="owner",
    )
    assert person(creator_tax, "owner")["tax_idr"] == 5

    positive_only = calc.compute(
        bill=bill(9, tax=5, mode="equal"),
        items=[
            {"id": 1, "name": "free", "price_idr": 0},
            {"id": 2, "name": "meal", "price_idr": 4},
        ],
        selections=[
            {"item_id": 1, "identity_id": "zero"},
            {"item_id": 2, "identity_id": "alice"},
        ],
        participants=[],
        fallback_id="owner",
    )
    assert person(positive_only, "alice")["tax_idr"] == 5
    assert person(positive_only, "zero")["tax_idr"] == 0

    zero_subtotal = calc.compute(
        bill=bill(5, tax=5),
        items=[{"id": 1, "name": "free", "price_idr": 0}],
        selections=[{"item_id": 1, "identity_id": "guest"}],
        participants=[],
        fallback_id="owner",
    )
    assert person(zero_subtotal, "owner")["tax_idr"] == 5

    one_rupiah_subtotal = calc.compute(
        bill=bill(6, tax=5),
        items=[{"id": 1, "name": "cheap", "price_idr": 1}],
        selections=[{"item_id": 1, "identity_id": "alice"}],
        participants=[],
        fallback_id="owner",
    )
    assert person(one_rupiah_subtotal, "alice")["tax_idr"] == 5

    fallback_remainder = calc.compute(
        bill=bill(9, tax=5),
        items=[
            {"id": 1, "name": "a", "price_idr": 1},
            {"id": 2, "name": "b", "price_idr": 3},
        ],
        selections=[
            {"item_id": 1, "identity_id": "alice"},
            {"item_id": 2, "identity_id": "bob"},
        ],
        participants=[],
        fallback_id="owner",
    )
    assert person(fallback_remainder, "owner")["tax_idr"] == 1
    assert fallback_remainder["people"][0]["identity_id"] == "bob"

    exact_tax = calc.compute(
        bill=bill(4, tax=2),
        items=[
            {"id": 1, "name": "a", "price_idr": 1},
            {"id": 2, "name": "b", "price_idr": 1},
        ],
        selections=[
            {"item_id": 1, "identity_id": "alice"},
            {"item_id": 2, "identity_id": "bob"},
        ],
        participants=[],
        fallback_id="owner",
    )
    assert {p["identity_id"] for p in exact_tax["people"]} == {"alice", "bob"}


def test_unassigned_warning_uses_canonical_discount_quantity_text():
    result = calc.compute(
        bill=bill(40),
        items=[
            {"id": 1, "name": "snack", "price_idr": 10, "discount_idr": 2, "quantity": 3},
            {"id": 2, "name": "plain", "price_idr": 5, "discount_idr": 1},
            {"id": 3, "name": "default", "price_idr": 5},
            {"id": 4, "name": "gratis", "price_idr": 0},
            {"id": 5, "name": "zeroqty", "price_idr": 7, "discount_idr": 0, "quantity": 0},
        ],
        selections=[],
        participants=[],
        fallback_id="owner",
    )
    assert result["unassigned_items"]
    assert person(result, "owner")["subtotal_idr"] == 40
    assert result["warnings"] == [
        "Item tidak dipilih siapa pun: snack Rp 24 -> otomatis dibebankan ke pembayar dahulu",
        "Item tidak dipilih siapa pun: plain Rp 4 -> otomatis dibebankan ke pembayar dahulu",
        "Item tidak dipilih siapa pun: default Rp 5 -> otomatis dibebankan ke pembayar dahulu",
        "Item tidak dipilih siapa pun: gratis Rp 0 -> otomatis dibebankan ke pembayar dahulu",
        "Item tidak dipilih siapa pun: zeroqty Rp 7 -> otomatis dibebankan ke pembayar dahulu",
    ]
