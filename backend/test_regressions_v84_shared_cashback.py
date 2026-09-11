"""Regression coverage for shared payment-method cashback (v84)."""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path
from typing import cast

import pytest

_DB = Path(tempfile.mkdtemp(prefix="bagiin-v84-shared-")) / "cashback.db"
os.environ["BAGIIN_DB"] = str(_DB)
os.environ.setdefault(
    "BAGIIN_UPLOAD_DIR",
    str(Path(tempfile.mkdtemp(prefix="bagiin-v84-shared-uploads-")) / "uploads"),
)
sys.path.insert(0, str(Path(__file__).resolve().parent))

import calc
import db
from fastapi.testclient import TestClient
from main import _MAX_IDR, app


db.init_db()
app.state.limiter.enabled = False
client = TestClient(app, raise_server_exceptions=False)


def _headers(identity: dict) -> dict[str, str]:
    return {
        "X-Identity-Id": identity["id"],
        "X-Identity-Secret": identity["secret"],
    }


def _person(result: dict, identity_id: str) -> dict:
    return result["by_identity"][identity_id]


def _bill(*, subtotal: int, tax: int = 0, service: int = 0,
          order_discount: int = 0, cashback: int = 0,
          total: int | None = None, tax_mode: str = "proportional",
          tax_included: bool = False) -> dict:
    if total is None:
        total = subtotal + tax + service - order_discount - cashback
    return {
        "subtotal_idr": subtotal,
        "tax_idr": tax,
        "service_idr": service,
        "order_discount_idr": order_discount,
        "cashback_idr": cashback,
        "total_idr": total,
        "tax_mode": tax_mode,
        "tax_included": tax_included,
    }


def _compute(bill: dict, items: list[dict], selections: list[dict],
             fallback_id: str = "owner") -> dict:
    return calc.compute(
        bill=bill,
        items=items,
        selections=selections,
        participants=[],
        fallback_id=fallback_id,
    )


def _assert_reconciles(result: dict, total: int) -> None:
    assert result["total_ok"] is True, result
    assert result["remaining_to_creator"] == 0
    assert sum(person["total_idr"] for person in result["people"]) + result["uncovered_idr"] == total


def test_zenbu_receipt_facts_stay_fixed_with_shared_cashback():
    items = [
        {"id": 1, "name": "Beef Mozaru Large", "price_idr": 109_000},
        {"id": 2, "name": "Beef Yakimeshi Regular", "price_idr": 59_000},
        {"id": 3, "name": "Okonomiyaki", "price_idr": 59_000},
        {"id": 4, "name": "Strawberry Yakult", "price_idr": 39_000},
        {"id": 5, "name": "Honey Lemonade", "price_idr": 33_000},
    ]
    selections = [
        {"item_id": index, "identity_id": identity}
        for index, identity in enumerate(("aufa", "budi", "citra", "dina", "eka"), 1)
    ]
    receipt = {"subtotal": 299_000, "tax": 32_292, "service": 23_920}

    without = _compute(
        _bill(subtotal=299_000, tax=32_292, service=23_920),
        items,
        selections,
        fallback_id="aufa",
    )
    shared = _compute(
        _bill(subtotal=299_000, tax=32_292, service=23_920, cashback=50_000),
        items,
        selections,
        fallback_id="aufa",
    )

    assert without["total_ok"] is True
    assert sum(person["total_idr"] for person in without["people"]) == 355_212
    assert sum(person["total_idr"] for person in shared["people"]) == 305_212
    assert shared["uncovered_idr"] == 0
    assert sum(person["cashback_idr"] for person in shared["people"]) == 50_000
    assert all(person["cashback_idr"] >= 0 and person["total_idr"] >= 0 for person in shared["people"])
    _assert_reconciles(shared, 305_212)
    assert receipt == {"subtotal": 299_000, "tax": 32_292, "service": 23_920}


def test_cashback_is_proportional_and_remainder_prefers_fallback():
    result = _compute(
        _bill(subtotal=3, cashback=2),
        items=[
            {"id": 1, "name": "A", "price_idr": 1},
            {"id": 2, "name": "B", "price_idr": 1},
            {"id": 3, "name": "C", "price_idr": 1},
        ],
        selections=[
            {"item_id": 1, "identity_id": "alice"},
            {"item_id": 2, "identity_id": "bob"},
            {"item_id": 3, "identity_id": "charlie"},
        ],
        fallback_id="alice",
    )

    assert {identity: _person(result, identity)["cashback_idr"]
            for identity in ("alice", "bob", "charlie")} == {
        "alice": 1, "bob": 1, "charlie": 0,
    }
    assert {identity: _person(result, identity)["total_idr"]
            for identity in ("alice", "bob", "charlie")} == {
        "alice": 0, "bob": 0, "charlie": 1,
    }
    _assert_reconciles(result, 1)


def test_allocator_rejects_invalid_and_zero_buckets_without_losing_rupiah():
    assert calc._allocate_proportionally(
        [("bad", cast(int, "not-a-number")), ("good", 2)], 1,
    ) == {"good": 1}
    assert calc._allocate_proportionally(
        [("zero", 0), ("good", 2)], 1,
    ) == {"good": 1}
    assert calc._allocate_proportionally([("good", 2)], cast(int, "not-a-number")) == {"good": 0}


def test_single_rupiah_cashback_remainder_prefers_fallback():
    result = _compute(
        _bill(subtotal=2, cashback=1),
        items=[
            {"id": 1, "name": "A", "price_idr": 1},
            {"id": 2, "name": "B", "price_idr": 1},
        ],
        selections=[
            {"item_id": 1, "identity_id": "alice"},
            {"item_id": 2, "identity_id": "bob"},
        ],
        fallback_id="alice",
    )
    assert _person(result, "alice")["cashback_idr"] == 1
    assert _person(result, "bob")["cashback_idr"] == 0
    _assert_reconciles(result, 1)


@pytest.mark.parametrize(
    ("field", "order_discount", "cashback"),
    [
        ("order_discount_idr", 2, 0),
        ("cashback_idr", 0, 2),
    ],
)
def test_equal_share_adjustment_remainders_are_stable_across_selection_order(
    field: str, order_discount: int, cashback: int,
):
    items = [{"id": 1, "name": "Shared", "price_idr": 3}]
    selections = [
        {"item_id": 1, "identity_id": "alice"},
        {"item_id": 1, "identity_id": "bob"},
        {"item_id": 1, "identity_id": "charlie"},
    ]
    reordered = [selections[0], selections[2], selections[1]]
    bill = _bill(
        subtotal=3, order_discount=order_discount, cashback=cashback, total=1,
    )

    first = _compute(bill, items, selections, fallback_id="alice")
    second = _compute(bill, items, reordered, fallback_id="alice")
    first_adjustments = {
        identity: _person(first, identity)[field]
        for identity in ("alice", "bob", "charlie")
    }
    second_adjustments = {
        identity: _person(second, identity)[field]
        for identity in ("alice", "bob", "charlie")
    }

    assert first_adjustments == second_adjustments == {
        "alice": 1,
        "bob": 1,
        "charlie": 0,
    }
    assert first["total_ok"] is True
    assert second["total_ok"] is True
    _assert_reconciles(first, 1)
    _assert_reconciles(second, 1)


def test_one_rupiah_uncovered_bucket_is_discount_eligible_and_warning_is_removed():
    cashback = _compute(
        _bill(subtotal=1, cashback=1, total=0),
        items=[{"id": 1, "name": "Slot", "price_idr": 1,
                "mode": "slot", "slot_count": 1}],
        selections=[],
    )
    assert cashback["uncovered_idr"] == 0
    assert cashback["uncovered_slots"] == []
    assert cashback["warnings"] == []
    _assert_reconciles(cashback, 0)

    voucher = _compute(
        _bill(subtotal=1, order_discount=1, total=0),
        items=[{"id": 1, "name": "Slot", "price_idr": 1,
                "mode": "slot", "slot_count": 1}],
        selections=[],
    )
    assert voucher["uncovered_idr"] == 0
    assert voucher["uncovered_slots"] == []
    assert voucher["warnings"] == []
    _assert_reconciles(voucher, 0)


def test_zero_net_person_does_not_receive_shared_cashback():
    result = _compute(
        _bill(subtotal=100, cashback=10, total=90),
        items=[
            {"id": 1, "name": "Fully discounted", "price_idr": 100,
             "discount_idr": 100},
            {"id": 2, "name": "Regular", "price_idr": 100},
        ],
        selections=[
            {"item_id": 1, "identity_id": "alice"},
            {"item_id": 2, "identity_id": "bob"},
        ],
        fallback_id="alice",
    )
    assert _person(result, "alice")["subtotal_idr"] == 0
    assert _person(result, "alice")["cashback_idr"] == 0
    assert _person(result, "bob")["cashback_idr"] == 10
    _assert_reconciles(result, 90)


def test_invalid_direct_cashback_and_order_discount_default_to_zero():
    cashback = _compute(
        _bill(subtotal=100, cashback=cast(int, "not-a-number"), total=100),
        items=[{"id": 1, "name": "Meal", "price_idr": 100}],
        selections=[{"item_id": 1, "identity_id": "alice"}],
        fallback_id="alice",
    )
    assert _person(cashback, "alice")["cashback_idr"] == 0
    assert _person(cashback, "alice")["total_idr"] == 100
    assert cashback["total_ok"] is True

    discount = _compute(
        _bill(subtotal=100, order_discount=cast(int, "not-a-number"), total=100),
        items=[{"id": 1, "name": "Meal", "price_idr": 100}],
        selections=[{"item_id": 1, "identity_id": "alice"}],
        fallback_id="alice",
    )
    assert _person(discount, "alice")["order_discount_idr"] == 0
    assert _person(discount, "alice")["total_idr"] == 100
    assert discount["total_ok"] is True


def test_tax_fallback_identity_and_missing_fee_fields_stay_zero_safe():
    result = _compute(
        _bill(subtotal=2, tax=1, cashback=3, total=0),
        items=[
            {"id": 1, "name": "B", "price_idr": 1},
            {"id": 2, "name": "C", "price_idr": 1},
        ],
        selections=[
            {"item_id": 1, "identity_id": "bob"},
            {"item_id": 2, "identity_id": "charlie"},
        ],
    )
    assert _person(result, "owner")["item_subtotal_idr"] == 0
    assert _person(result, "owner")["order_discount_idr"] == 0
    assert _person(result, "owner")["tax_idr"] == 1
    assert _person(result, "owner")["cashback_idr"] == 1
    assert all(_person(result, ident)["total_idr"] == 0
               for ident in ("owner", "bob", "charlie"))
    _assert_reconciles(result, 0)

    missing_fees = {
        "subtotal_idr": 100, "total_idr": 100,
        "tax_mode": "proportional", "tax_included": False,
    }
    no_fee_result = _compute(
        missing_fees,
        items=[{"id": 1, "name": "Meal", "price_idr": 100}],
        selections=[{"item_id": 1, "identity_id": "alice"}],
        fallback_id="alice",
    )
    assert _person(no_fee_result, "alice")["tax_idr"] == 0
    assert no_fee_result["total_ok"] is True

    missing_included_service = {
        "subtotal_idr": 100, "tax_idr": 0, "total_idr": 100,
        "tax_mode": "proportional", "tax_included": True,
    }
    included_result = _compute(
        missing_included_service,
        items=[{"id": 1, "name": "Meal", "price_idr": 100}],
        selections=[{"item_id": 1, "identity_id": "alice"}],
        fallback_id="alice",
    )
    assert _person(included_result, "alice")["tax_idr"] == 0
    assert included_result["total_ok"] is True


def test_legacy_cashback_alias_and_missing_total_keep_explicit_contract():
    alias_bill = _bill(subtotal=100, cashback=10, total=90)
    alias_bill.pop("cashback_idr")
    alias_bill["cashback"] = 10
    alias = _compute(
        alias_bill,
        items=[{"id": 1, "name": "Meal", "price_idr": 100}],
        selections=[{"item_id": 1, "identity_id": "alice"}],
        fallback_id="alice",
    )
    assert _person(alias, "alice")["cashback_idr"] == 10
    assert alias["total_ok"] is True

    missing_total = _bill(subtotal=1, total=0)
    missing_total.pop("total_idr")
    invalid = _compute(
        missing_total,
        items=[{"id": 1, "name": "Meal", "price_idr": 1}],
        selections=[{"item_id": 1, "identity_id": "alice"}],
        fallback_id="alice",
    )
    assert invalid["total_ok"] is False

    zero = _compute(_bill(subtotal=0, total=0), items=[], selections=[])
    assert zero["total_ok"] is True


def test_order_discount_and_cashback_both_reduce_uncovered_warning_bucket():
    result = _compute(
        _bill(subtotal=100, order_discount=20, cashback=20),
        items=[{"id": 1, "name": "Pizza", "price_idr": 100,
                "mode": "slot", "slot_count": 4}],
        selections=[{"item_id": 1, "identity_id": "alice", "qty": 1}],
        fallback_id="alice",
    )

    assert _person(result, "alice")["item_subtotal_idr"] == 25
    assert _person(result, "alice")["order_discount_idr"] == 5
    assert _person(result, "alice")["cashback_idr"] == 5
    assert _person(result, "alice")["total_idr"] == 15
    assert result["uncovered_idr"] == 45
    assert result["uncovered_slots"][0]["amount_idr"] == 45
    assert "Rp 45" in result["warnings"][0]
    _assert_reconciles(result, 60)


def test_fallback_zero_base_and_tax_included_service_reconcile():
    zero_base = _compute(
        _bill(subtotal=0, service=10, cashback=5),
        items=[{"id": 1, "name": "Gratis", "price_idr": 100,
                "discount_idr": 100}],
        selections=[],
        fallback_id="owner",
    )
    assert _person(zero_base, "owner")["tax_idr"] == 10
    assert _person(zero_base, "owner")["cashback_idr"] == 5
    assert _person(zero_base, "owner")["total_idr"] == 5
    _assert_reconciles(zero_base, 5)

    included = _compute(
        _bill(subtotal=100, service=10, cashback=20, tax_included=True),
        items=[{"id": 1, "name": "Meal", "price_idr": 100}],
        selections=[{"item_id": 1, "identity_id": "alice"}],
        fallback_id="owner",
    )
    assert _person(included, "alice")["subtotal_idr"] == 100
    assert _person(included, "alice")["tax_idr"] == 10
    assert _person(included, "alice")["cashback_idr"] == 20
    assert _person(included, "alice")["total_idr"] == 90
    _assert_reconciles(included, 90)


def test_legacy_calc_payload_defaults_cashback_to_zero():
    bill = _bill(subtotal=100, tax=11, service=7, order_discount=12)
    legacy = dict(bill)
    legacy.pop("cashback_idr")
    items = [{"id": 1, "name": "A", "price_idr": 100}]
    selections = [{"item_id": 1, "identity_id": "alice"}]

    result = _compute(legacy, items, selections, fallback_id="alice")
    explicit_zero = _compute(bill, items, selections, fallback_id="alice")
    fields = ("item_subtotal_idr", "order_discount_idr", "subtotal_idr", "tax_idr", "total_idr")
    assert {field: _person(result, "alice")[field] for field in fields} == {
        field: _person(explicit_zero, "alice")[field] for field in fields
    }
    assert _person(result, "alice")["cashback_idr"] == 0
    assert explicit_zero["total_ok"] is True


def test_http_create_get_update_persists_cashback_and_list_snapshot():
    owner = db.new_identity("v84-shared-http-owner")
    create_payload = {
        "title": "Cashback create",
        "items": [{"name": "Meal", "price": 1_000}],
        "subtotal": 1_000,
        "tax": 100,
        "service": 50,
        "order_discount": 100,
        "cashback": 100,
        "total": 950,
    }
    created = client.post("/api/bills", json=create_payload, headers=_headers(owner))
    assert created.status_code == 200, created.text
    bill_id = created.json()["id"]

    detail = client.get(f"/api/bills/{bill_id}")
    assert detail.status_code == 200, detail.text
    data = detail.json()
    assert data["bill"]["cashback_idr"] == 100
    assert data["bill"]["total_idr"] == 950
    assert data["people"][0]["cashback_idr"] == 100
    assert data["people"][0]["total_idr"] == 950
    assert data["total_ok"] is True

    listing = client.get(f"/api/identities/{owner['id']}/bills", headers=_headers(owner))
    assert listing.status_code == 200, listing.text
    listed = next(row for row in listing.json() if row["id"] == bill_id)
    assert listed["cashback_idr"] == 100

    item_id = data["items"][0]["id"]
    update_payload = {
        "title": "Cashback updated",
        "items": [{"id": item_id, "name": "Meal", "price": 2_000}],
        "subtotal": 2_000,
        "tax": 200,
        "service": 100,
        "order_discount": 100,
        "cashback": 300,
        "total": 1_900,
    }
    updated = client.put(f"/api/bills/{bill_id}", json=update_payload, headers=_headers(owner))
    assert updated.status_code == 200, updated.text
    updated_data = updated.json()
    assert updated_data["bill"]["cashback_idr"] == 300
    assert updated_data["bill"]["total_idr"] == 1_900
    assert updated_data["people"][0]["cashback_idr"] == 300
    assert updated_data["people"][0]["total_idr"] == 1_900
    assert updated_data["total_ok"] is True


def test_http_old_payload_and_migration_are_backward_compatible():
    owner = db.new_identity("v84-shared-old")
    created = client.post("/api/bills", json={
        "title": "Old payload",
        "items": [{"name": "Meal", "price": 100}],
        "subtotal": 100,
        "tax": 10,
        "service": 5,
        "total": 115,
    }, headers=_headers(owner))
    assert created.status_code == 200, created.text
    detail = client.get(f"/api/bills/{created.json()['id']}").json()
    assert detail["bill"]["cashback_idr"] == 0
    assert all(person["cashback_idr"] == 0 for person in detail["people"])
    assert detail["total_ok"] is True

    db.init_db()
    db.init_db()
    conn = db.get_db()
    try:
        columns = {row["name"] for row in conn.execute("PRAGMA table_info(bill)").fetchall()}
    finally:
        conn.close()
    assert "cashback_idr" in columns


@pytest.mark.parametrize("bad_cashback", [-1, True, 1.5, "not-a-number", _MAX_IDR + 1])
def test_http_rejects_invalid_cashback_without_persisting(bad_cashback):
    owner = db.new_identity(f"v84-shared-invalid-{bad_cashback}")
    before = len(db.get_bills_for_identity(owner["id"]))
    response = client.post("/api/bills", json={
        "title": "Bad cashback",
        "items": [{"name": "Meal", "price": 1_000}],
        "subtotal": 1_000,
        "tax": 100,
        "service": 50,
        "cashback": bad_cashback,
        "total": 1_150,
    }, headers=_headers(owner))
    assert response.status_code == 400, response.text
    assert len(db.get_bills_for_identity(owner["id"])) == before


def test_http_rejects_cashback_above_post_order_total_and_mismatched_total():
    owner = db.new_identity("v84-shared-invalid-bound")
    base = {
        "title": "Invalid cashback bound",
        "items": [{"name": "Meal", "price": 1_000}],
        "subtotal": 1_000,
        "tax": 100,
        "service": 50,
        "order_discount": 100,
    }
    for payload in (
        dict(base, cashback=1_051, total=0),
        dict(base, cashback=100, total=999),
    ):
        response = client.post("/api/bills", json=payload, headers=_headers(owner))
        assert response.status_code == 400, response.text
    assert not db.get_bills_for_identity(owner["id"])


def test_http_invalid_update_does_not_change_existing_bill():
    owner = db.new_identity("v84-shared-update-invalid")
    created = client.post("/api/bills", json={
        "title": "Keep cashback",
        "items": [{"name": "Meal", "price": 1_000}],
        "subtotal": 1_000,
        "tax": 0,
        "service": 0,
        "cashback": 100,
        "total": 900,
    }, headers=_headers(owner))
    assert created.status_code == 200, created.text
    bill_id = created.json()["id"]
    before = client.get(f"/api/bills/{bill_id}").json()
    item_id = before["items"][0]["id"]

    response = client.put(f"/api/bills/{bill_id}", json={
        "title": "Should not save",
        "items": [{"id": item_id, "name": "Changed", "price": 1_000}],
        "subtotal": 1_000,
        "tax": 0,
        "service": 0,
        "cashback": 1_001,
        "total": 0,
    }, headers=_headers(owner))
    assert response.status_code == 400, response.text

    after = client.get(f"/api/bills/{bill_id}").json()
    assert after["bill"]["cashback_idr"] == 100
    assert after["bill"]["total_idr"] == 900
    assert after["items"][0]["name"] == "Meal"
