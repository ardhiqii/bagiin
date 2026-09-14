"""Regression coverage for calc.py mutation survivors (v86)."""
from __future__ import annotations

import calc


def _bill(*, subtotal: int, total: int, tax: int = 0, service: int = 0,
          order_discount: int = 0, cashback: int = 0,
          tax_mode: str = "proportional") -> dict:
    return {
        "subtotal_idr": subtotal,
        "tax_idr": tax,
        "service_idr": service,
        "order_discount_idr": order_discount,
        "cashback_idr": cashback,
        "total_idr": total,
        "tax_mode": tax_mode,
        "tax_included": False,
    }


def _person(result: dict, identity_id: str) -> dict:
    return result["by_identity"][identity_id]


def test_identity_remainder_precedes_uncovered_bucket_when_owner_has_no_share():
    result = calc.compute(
        _bill(subtotal=5, total=4, order_discount=1),
        items=[{"id": 1, "name": "shared", "price_idr": 5,
                "mode": "slot", "slot_count": 2}],
        selections=[{"item_id": 1, "identity_id": "guest", "qty": 1}],
        participants=[],
        fallback_id="owner",
    )

    assert _person(result, "guest")["order_discount_idr"] == 1
    assert _person(result, "guest")["subtotal_idr"] == 1
    assert result["uncovered_idr"] == 3
    assert result["uncovered_slots"][0]["amount_idr"] == 3
    assert result["total_ok"] is True


def test_zero_tax_identity_does_not_receive_shared_cashback():
    result = calc.compute(
        _bill(subtotal=3, total=4, tax=2, cashback=1, tax_mode="equal"),
        items=[
            {"id": 1, "name": "meal", "price_idr": 3},
            {"id": 2, "name": "free", "price_idr": 0},
        ],
        selections=[
            {"item_id": 1, "identity_id": "alice"},
            {"item_id": 2, "identity_id": "bob"},
        ],
        participants=[],
        fallback_id="bob",
    )

    assert _person(result, "alice")["cashback_idr"] == 1
    assert _person(result, "bob")["cashback_idr"] == 0
    assert _person(result, "bob")["total_idr"] == 0
    assert result["total_ok"] is True


def test_one_rupiah_uncovered_warning_survives_partial_cashback():
    result = calc.compute(
        _bill(subtotal=2, total=1, cashback=1),
        items=[{"id": 1, "name": "shared", "price_idr": 2,
                "mode": "slot", "slot_count": 1}],
        selections=[],
        participants=[],
        fallback_id="owner",
    )

    assert result["uncovered_idr"] == 1
    assert result["uncovered_slots"] == [{
        "item_id": 1,
        "name": "shared",
        "per_slot": 2,
        "empty": 1,
        "amount_idr": 1,
    }]
    assert result["warnings"] == [
        "Bagian kosong: shared 1 bagian belum terisi (total Rp 1)"
    ]
    assert result["total_ok"] is True
