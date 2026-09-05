"""Additional behavioral tests targeting calc.py mutation survivors."""
import calc


def bill(total, *, tax=0, service=0, mode="proportional", tax_included=False):
    return {"subtotal_idr": total - tax - service, "tax_idr": tax,
            "service_idr": service, "total_idr": total, "tax_mode": mode,
            "tax_included": tax_included}


def person(result, identity):
    return result["by_identity"][identity]


def test_missing_qty_defaults_to_one_and_discount_is_subtracted():
    result = calc.compute(
        bill(7), [{"id": 1, "name": "discounted", "price_idr": 10, "discount_idr": 3}],
        [{"item_id": 1, "identity_id": "alice"}], [], "owner")
    assert person(result, "alice")["subtotal_idr"] == 7
    assert result["total_ok"] is True


def test_purchased_quantity_multiplies_selected_and_unpicked_lines():
    result = calc.compute(
        bill(24),
        items=[
            {"id": 1, "name": "double snack", "price_idr": 5, "quantity": 2},
            {"id": 2, "name": "double drink", "price_idr": 7, "quantity": 2},
        ],
        selections=[{"item_id": 1, "identity_id": "alice"}],
        participants=[],
        fallback_id="owner",
    )
    # Kills quantity lookup and line-total mutants in split and warning paths.
    assert person(result, "alice")["subtotal_idr"] == 10
    assert person(result, "owner")["subtotal_idr"] == 14
    assert "Rp 14" in result["warnings"][0]
    assert result["total_ok"] is True


def test_free_split_preserves_one_rupiah_remainder_when_share_is_zero():
    result = calc.compute(
        bill(1),
        items=[{"id": 1, "name": "tiny snack", "price_idr": 1}],
        selections=[
            {"item_id": 1, "identity_id": "alice"},
            {"item_id": 1, "identity_id": "bob"},
        ],
        participants=[],
        fallback_id="alice",
    )
    assert person(result, "alice")["subtotal_idr"] == 1
    assert person(result, "bob")["subtotal_idr"] == 0
    assert result["total_ok"] is True


def test_slot_rounding_distributes_remainder_per_taken_slot():
    result = calc.compute(
        bill(11),
        items=[{"id": 1, "name": "pizza", "price_idr": 11, "mode": "slot", "slot_count": 4}],
        selections=[
            {"item_id": 1, "identity_id": "alice", "qty": 2},
            {"item_id": 1, "identity_id": "bob", "qty": 2},
        ],
        participants=[],
        fallback_id="owner",
    )
    assert person(result, "alice")["subtotal_idr"] == 6
    assert person(result, "bob")["subtotal_idr"] == 5
    assert result["uncovered_idr"] == 0
    assert result["total_ok"] is True


def test_partial_slots_charge_all_taken_slots_before_uncovered_amount():
    result = calc.compute(
        bill(10),
        items=[{"id": 1, "name": "pizza", "price_idr": 10, "mode": "slot", "slot_count": 4}],
        selections=[{"item_id": 1, "identity_id": "alice", "qty": 2}],
        participants=[],
        fallback_id="owner",
    )
    assert person(result, "alice")["subtotal_idr"] == 4
    assert result["uncovered_idr"] == 6
    assert result["total_ok"] is True


def test_slot_rounding_with_zero_base_assigns_only_real_remainder():
    result = calc.compute(
        bill(1),
        items=[{"id": 1, "name": "tiny pizza", "price_idr": 1, "mode": "slot", "slot_count": 2}],
        selections=[
            {"item_id": 1, "identity_id": "alice"},
            {"item_id": 1, "identity_id": "bob"},
        ],
        participants=[],
        fallback_id="owner",
    )
    assert person(result, "alice")["subtotal_idr"] == 1
    assert person(result, "bob")["subtotal_idr"] == 0
    assert result["total_ok"] is True


def test_equal_tax_is_not_replaced_by_proportional_tax():
    result = calc.compute(
        bill(8, tax=4, mode="equal"),
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
    assert person(result, "alice")["tax_idr"] == 2
    assert person(result, "bob")["tax_idr"] == 2


def test_proportional_tax_handles_one_rupiah_subtotal():
    result = calc.compute(
        bill(2, tax=1),
        items=[{"id": 1, "name": "tiny", "price_idr": 1}],
        selections=[{"item_id": 1, "identity_id": "alice"}],
        participants=[],
        fallback_id="owner",
    )
    assert person(result, "alice")["tax_idr"] == 1
    assert "owner" not in result["by_identity"]
    assert result["total_ok"] is True


def test_proportional_tax_remainder_can_land_on_owner():
    result = calc.compute(
        bill(4, tax=1),
        items=[
            {"id": 1, "name": "a", "price_idr": 1},
            {"id": 2, "name": "b", "price_idr": 2},
        ],
        selections=[
            {"item_id": 1, "identity_id": "alice"},
            {"item_id": 2, "identity_id": "bob"},
        ],
        participants=[],
        fallback_id="owner",
    )
    assert person(result, "owner")["tax_idr"] == 1
    assert result["total_ok"] is True


def test_unpicked_slot_is_not_reported_as_free_item():
    result = calc.compute(
        bill(10),
        items=[{"id": 1, "name": "shared pizza", "price_idr": 10, "mode": "slot", "slot_count": 2}],
        selections=[],
        participants=[],
        fallback_id="owner",
    )
    assert result["unassigned_items"] == []
    assert result["uncovered_idr"] == 10
    assert any("Bagian kosong" in warning for warning in result["warnings"])
    assert result["total_ok"] is True


def test_unpicked_free_item_with_slot_count_still_warns():
    result = calc.compute(
        bill(3),
        items=[{"id": 1, "name": "free item", "price_idr": 3, "slot_count": 2}],
        selections=[],
        participants=[],
        fallback_id="owner",
    )
    assert result["unassigned_items"] == [{"id": 1, "name": "free item", "price_idr": 3, "slot_count": 2}]
    assert person(result, "owner")["subtotal_idr"] == 3
    assert "Rp 3" in result["warnings"][0]
    assert result["total_ok"] is True


def test_unpicked_zero_price_item_warning_stays_zero():
    result = calc.compute(
        bill(0),
        items=[{"id": 1, "name": "free", "price_idr": 0}],
        selections=[],
        participants=[],
        fallback_id="owner",
    )
    assert "Rp 0" in result["warnings"][0]
    assert result["total_ok"] is True


def test_slot_count_one_is_not_changed_by_minimum_guard():
    result = calc.compute(
        bill(5), [{"id": 1, "name": "single", "price_idr": 5, "mode": "slot", "slot_count": 1}],
        [{"item_id": 1, "identity_id": "alice"}], [], "owner")
    assert person(result, "alice")["subtotal_idr"] == 5
    assert result["uncovered_idr"] == 0


def test_slot_remainder_stops_after_all_taken_slots():
    result = calc.compute(
        bill(10), [{"id": 1, "name": "pizza", "price_idr": 10, "mode": "slot", "slot_count": 3}],
        [{"item_id": 1, "identity_id": "alice", "qty": 3}], [], "owner")
    assert person(result, "alice")["subtotal_idr"] == 10
    assert result["total_ok"] is True


def test_multiple_partial_slot_items_accumulate_uncovered_amount():
    result = calc.compute(
        bill(16), [
            {"id": 1, "name": "a", "price_idr": 10, "mode": "slot", "slot_count": 4},
            {"id": 2, "name": "b", "price_idr": 6, "mode": "slot", "slot_count": 3},
        ], [{"item_id": 1, "identity_id": "alice", "qty": 1},
             {"item_id": 2, "identity_id": "alice", "qty": 1}], [], "owner")
    assert result["uncovered_idr"] == 12
    assert len(result["uncovered_slots"]) == 2
    assert result["total_ok"] is True


def test_zero_value_uncovered_slots_are_not_reported():
    result = calc.compute(
        bill(0), [{"id": 1, "name": "free pizza", "price_idr": 0, "mode": "slot", "slot_count": 3}],
        [{"item_id": 1, "identity_id": "alice", "qty": 1}], [], "owner")
    assert result["uncovered_idr"] == 0
    assert result["uncovered_slots"] == []
    assert result["warnings"] == []


def test_creator_tax_mode_uses_fallback_owner():
    result = calc.compute(
        bill(13, tax=3, mode="creator"), [{"id": 1, "name": "meal", "price_idr": 10}],
        [{"item_id": 1, "identity_id": "guest"}], [], "owner")
    assert person(result, "guest")["tax_idr"] == 0
    assert person(result, "owner")["tax_idr"] == 3
    assert result["total_ok"] is True


def test_equal_tax_excludes_zero_subtotal_identity():
    result = calc.compute(
        bill(8, tax=4, mode="equal"),
        [{"id": 1, "name": "free", "price_idr": 0}, {"id": 2, "name": "meal", "price_idr": 4}],
        [{"item_id": 1, "identity_id": "zero"}, {"item_id": 2, "identity_id": "payer"}], [], "owner")
    assert person(result, "zero")["tax_idr"] == 0
    assert person(result, "payer")["tax_idr"] == 4


def test_proportional_tax_reconciles_when_fallback_has_no_subtotal():
    result = calc.compute(
        bill(11, tax=5), [{"id": 1, "name": "meal", "price_idr": 6}],
        [{"item_id": 1, "identity_id": "guest"}], [], "owner")
    assert person(result, "guest")["tax_idr"] == 5
    assert result["total_ok"] is True


def test_people_are_sorted_by_total_descending():
    result = calc.compute(
        bill(7), [{"id": 1, "name": "a", "price_idr": 2}, {"id": 2, "name": "b", "price_idr": 5}],
        [{"item_id": 1, "identity_id": "small"}, {"item_id": 2, "identity_id": "large"}], [], "owner")
    assert [p["identity_id"] for p in result["people"]] == ["large", "small"]


def test_unpicked_free_item_falls_to_owner_and_warning_reports_effective_price():
    result = calc.compute(
        bill(7), [{"id": 1, "name": "unpicked", "price_idr": 10, "discount_idr": 3}],
        [], [], "owner")
    assert person(result, "owner")["subtotal_idr"] == 7
    assert result["unassigned_items"][0]["id"] == 1
    assert "Rp 7" in result["warnings"][0]
    assert result["remaining_to_creator"] == 0


def test_free_item_with_slot_count_field_stays_free_without_slot_mode():
    result = calc.compute(
        bill(3), [{"id": 1, "name": "free", "price_idr": 3, "slot_count": 2}],
        [{"item_id": 1, "identity_id": "alice"}], [], "owner")
    assert person(result, "alice")["subtotal_idr"] == 3
    assert result["total_ok"] is True


def test_one_rupiah_uncovered_slot_is_reported():
    result = calc.compute(
        bill(1), [{"id": 1, "name": "tiny", "price_idr": 1, "mode": "slot", "slot_count": 2}],
        [{"item_id": 1, "identity_id": "alice"}], [], "owner")
    assert result["uncovered_idr"] == 1
    assert result["uncovered_slots"][0]["amount_idr"] == 1


def test_equal_tax_includes_payer_with_one_rupiah_subtotal():
    result = calc.compute(
        bill(5, tax=2, mode="equal"), [{"id": 1, "name": "tiny", "price_idr": 1}],
        [{"item_id": 1, "identity_id": "alice"}], [], "owner")
    assert person(result, "alice")["tax_idr"] == 2


def test_default_tax_mode_is_proportional_when_omitted():
    result = calc.compute(
        {"subtotal_idr": 3, "tax_idr": 1, "service_idr": 0, "total_idr": 4},
        [{"id": 1, "name": "meal", "price_idr": 3}],
        [{"item_id": 1, "identity_id": "alice"}], [], "owner")
    assert person(result, "alice")["tax_idr"] == 1
    assert result["total_ok"] is True


def test_remaining_to_creator_subtracts_uncovered_slots():
    result = calc.compute(
        bill(10), [{"id": 1, "name": "pizza", "price_idr": 10, "mode": "slot", "slot_count": 2}],
        [{"item_id": 1, "identity_id": "alice", "qty": 1}], [], "owner")
    assert result["remaining_to_creator"] == 0
    assert result["uncovered_idr"] == 5
    assert result["total_ok"] is True
