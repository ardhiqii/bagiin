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
