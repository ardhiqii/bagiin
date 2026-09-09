"""Regression coverage for explicit checkout-wide order discounts."""
import os
import sys
import tempfile
from pathlib import Path

import pytest

_DB = Path(tempfile.mkdtemp(prefix="bagiin-v78-")) / "order-discount.db"
os.environ["BAGIIN_DB"] = str(_DB)
os.environ.setdefault(
    "BAGIIN_UPLOAD_DIR",
    str(Path(tempfile.mkdtemp(prefix="bagiin-v78-uploads-")) / "uploads"),
)
sys.path.insert(0, str(Path(__file__).resolve().parent))

import calc
import db
import ocr
from fastapi.testclient import TestClient
from main import app


db.init_db()
client = TestClient(app, raise_server_exceptions=False)


def _headers(identity):
    return {
        "X-Identity-Id": identity["id"],
        "X-Identity-Secret": identity["secret"],
    }


def _person(result, identity_id):
    return result["by_identity"][identity_id]


def _bill(*, subtotal, tax=0, service=0, order_discount=0,
          total=None, tax_mode="proportional", tax_included=False):
    if total is None:
        total = subtotal + tax + service - order_discount
    return {
        "subtotal_idr": subtotal,
        "tax_idr": tax,
        "service_idr": service,
        "order_discount_idr": order_discount,
        "total_idr": total,
        "tax_mode": tax_mode,
        "tax_included": tax_included,
    }


def test_calc_gofood_allocates_discount_after_item_shares():
    result = calc.compute(
        bill=_bill(subtotal=81000, service=12500, order_discount=45000),
        items=[
            {"id": 1, "name": "Kopi", "price_idr": 18000, "quantity": 2},
            {"id": 2, "name": "Americano", "price_idr": 20000},
            {"id": 3, "name": "KSH", "price_idr": 25000},
        ],
        selections=[
            {"item_id": 1, "identity_id": "alice", "qty": 2},
            {"item_id": 2, "identity_id": "bob"},
            {"item_id": 3, "identity_id": "charlie"},
        ],
        participants=[],
        fallback_id="alice",
    )

    people = {p["identity_id"]: p for p in result["people"]}
    assert {identity: people[identity]["item_subtotal_idr"] for identity in people} == {
        "alice": 36000,
        "bob": 20000,
        "charlie": 25000,
    }
    assert sum(p["order_discount_idr"] for p in people.values()) == 45000
    assert sum(p["subtotal_idr"] for p in people.values()) == 36000
    assert sum(p["total_idr"] for p in people.values()) == 48500
    assert result["uncovered_idr"] == 0
    assert result["total_ok"] is True


def test_calc_keeps_per_unit_item_discount_and_discount_remainder():
    items = [{
        "id": 1,
        "name": "Shared",
        "price_idr": 10,
        "discount_idr": 2,
        "quantity": 3,
    }]
    result = calc.compute(
        bill=_bill(subtotal=24, order_discount=5),
        items=items,
        selections=[
            {"item_id": 1, "identity_id": "alice", "qty": 1},
            {"item_id": 1, "identity_id": "bob", "qty": 2},
        ],
        participants=[],
        fallback_id="alice",
    )

    people = {p["identity_id"]: p for p in result["people"]}
    assert items[0]["price_idr"] == 10
    assert items[0]["discount_idr"] == 2
    assert people["alice"]["item_subtotal_idr"] == 8
    assert people["bob"]["item_subtotal_idr"] == 16
    assert people["alice"]["order_discount_idr"] == 2
    assert people["bob"]["order_discount_idr"] == 3
    assert people["alice"]["subtotal_idr"] == 6
    assert people["bob"]["subtotal_idr"] == 13
    assert result["total_ok"] is True


def test_calc_unpicked_free_item_belongs_to_owner_before_discount():
    result = calc.compute(
        bill=_bill(subtotal=100, order_discount=20),
        items=[
            {"id": 1, "name": "Picked", "price_idr": 40},
            {"id": 2, "name": "Unpicked", "price_idr": 60},
        ],
        selections=[{"item_id": 1, "identity_id": "alice"}],
        participants=[],
        fallback_id="owner",
    )

    assert _person(result, "owner")["item_subtotal_idr"] == 60
    assert _person(result, "alice")["item_subtotal_idr"] == 40
    assert _person(result, "owner")["order_discount_idr"] == 12
    assert _person(result, "alice")["order_discount_idr"] == 8
    assert result["uncovered_idr"] == 0
    assert result["total_ok"] is True


def test_calc_slot_discount_reduces_uncovered_bucket():
    result = calc.compute(
        bill=_bill(subtotal=100, order_discount=30),
        items=[{"id": 1, "name": "Pizza", "price_idr": 100,
                "mode": "slot", "slot_count": 4}],
        selections=[
            {"item_id": 1, "identity_id": "alice"},
            {"item_id": 1, "identity_id": "bob"},
        ],
        participants=[],
        fallback_id="alice",
    )

    people = {p["identity_id"]: p for p in result["people"]}
    assert people["alice"]["item_subtotal_idr"] == 25
    assert people["bob"]["item_subtotal_idr"] == 25
    assert sum(p["order_discount_idr"] for p in people.values()) == 15
    assert result["uncovered_idr"] == 35
    assert result["uncovered_slots"][0]["amount_idr"] == 35
    assert result["total_ok"] is True


def test_calc_discount_can_exceed_selected_people_base_when_slots_uncovered():
    result = calc.compute(
        bill=_bill(subtotal=120, order_discount=60),
        items=[
            {"id": 1, "name": "Slot", "price_idr": 100,
             "mode": "slot", "slot_count": 4},
            {"id": 2, "name": "Free", "price_idr": 20},
        ],
        selections=[],
        participants=[],
        fallback_id="owner",
    )

    owner = _person(result, "owner")
    assert owner["item_subtotal_idr"] == 20
    assert owner["order_discount_idr"] == 10
    assert owner["subtotal_idr"] == 10
    assert result["uncovered_idr"] == 50
    assert sum(p["order_discount_idr"] for p in result["people"]) + 50 == 60
    assert result["total_ok"] is True
    assert all(p["subtotal_idr"] >= 0 for p in result["people"])


def test_calc_zero_effective_base_with_discount_is_defensive():
    result = calc.compute(
        bill=_bill(subtotal=0, order_discount=1, total=0),
        items=[{"id": 1, "name": "Free", "price_idr": 100,
                "discount_idr": 100}],
        selections=[],
        participants=[],
        fallback_id="owner",
    )

    assert result["total_ok"] is False
    assert all(p["item_subtotal_idr"] >= 0 for p in result["people"])
    assert all(p["order_discount_idr"] >= 0 for p in result["people"])
    assert all(p["subtotal_idr"] >= 0 for p in result["people"])


def test_calc_equal_creator_and_tax_included_modes_use_net_subtotal():
    equal = calc.compute(
        bill=_bill(subtotal=100, tax=10, service=6, order_discount=20, tax_mode="equal"),
        items=[
            {"id": 1, "name": "A", "price_idr": 40},
            {"id": 2, "name": "B", "price_idr": 60},
        ],
        selections=[
            {"item_id": 1, "identity_id": "alice"},
            {"item_id": 2, "identity_id": "bob"},
        ],
        participants=[],
        fallback_id="alice",
    )
    assert _person(equal, "alice")["tax_idr"] == 8
    assert _person(equal, "bob")["tax_idr"] == 8
    assert equal["total_ok"] is True

    creator = calc.compute(
        bill=_bill(subtotal=100, tax=10, service=6, order_discount=20, tax_mode="creator"),
        items=[
            {"id": 1, "name": "A", "price_idr": 40},
            {"id": 2, "name": "B", "price_idr": 60},
        ],
        selections=[
            {"item_id": 1, "identity_id": "alice"},
            {"item_id": 2, "identity_id": "bob"},
        ],
        participants=[],
        fallback_id="alice",
    )
    assert _person(creator, "alice")["tax_idr"] == 16
    assert _person(creator, "bob")["tax_idr"] == 0
    assert creator["total_ok"] is True

    included = calc.compute(
        bill=_bill(subtotal=100, service=10, order_discount=20,
                   tax_included=True),
        items=[{"id": 1, "name": "A", "price_idr": 100}],
        selections=[{"item_id": 1, "identity_id": "alice"}],
        participants=[],
        fallback_id="owner",
    )
    assert _person(included, "alice")["total_idr"] == 90
    assert included["total_ok"] is True


def test_http_create_get_update_persists_order_discount_breakdown():
    owner = db.new_identity("v78-http-owner")
    payload = {
        "title": "GoFood",
        "items": [
            {"name": "Kopi", "price": 18000, "quantity": 2},
            {"name": "Americano", "price": 20000},
            {"name": "KSH", "price": 25000},
        ],
        "subtotal": 81000,
        "tax": 0,
        "service": 12500,
        "order_discount": 45000,
        "total": 48500,
    }
    response = client.post("/api/bills", json=payload, headers=_headers(owner))
    assert response.status_code == 200, response.text
    bill_id = response.json()["id"]

    detail = client.get(f"/api/bills/{bill_id}").json()
    assert detail["bill"]["order_discount_idr"] == 45000
    assert detail["total_ok"] is True
    assert all("item_subtotal_idr" in p and "order_discount_idr" in p
               for p in detail["people"])

    update = dict(payload)
    update["title"] = "GoFood updated"
    update["order_discount"] = 40000
    update["total"] = 53500
    response = client.put(f"/api/bills/{bill_id}", json=update,
                          headers=_headers(owner))
    assert response.status_code == 200, response.text
    updated = response.json()
    assert updated["bill"]["order_discount_idr"] == 40000
    assert updated["bill"]["total_idr"] == 53500
    assert updated["total_ok"] is True


def test_http_old_payload_defaults_order_discount_to_zero():
    owner = db.new_identity("v78-http-old")
    response = client.post("/api/bills", json={
        "title": "Old",
        "items": [{"name": "A", "price": 100}],
        "subtotal": 100,
        "tax": 10,
        "service": 5,
        "total": 115,
    }, headers=_headers(owner))
    assert response.status_code == 200, response.text
    detail = client.get(f"/api/bills/{response.json()['id']}").json()
    assert detail["bill"]["order_discount_idr"] == 0
    assert detail["people"][0]["item_subtotal_idr"] == 100
    assert detail["people"][0]["order_discount_idr"] == 0
    assert detail["total_ok"] is True


@pytest.mark.parametrize("bad_discount", [10001, -1])
def test_http_rejects_impossible_order_discount_without_persisting(bad_discount):
    owner = db.new_identity(f"v78-http-bad-{bad_discount}")
    before = len(db.get_bills_for_identity(owner["id"]))
    response = client.post("/api/bills", json={
        "title": "Bad discount",
        "items": [{"name": "A", "price": 10000}],
        "subtotal": 10000,
        "tax": 0,
        "service": 0,
        "order_discount": bad_discount,
        "total": max(0, 10000 - bad_discount),
    }, headers=_headers(owner))
    assert response.status_code == 400, response.text
    assert len(db.get_bills_for_identity(owner["id"])) == before


def test_http_update_rejects_discount_greater_than_subtotal_and_keeps_bill():
    owner = db.new_identity("v78-http-update")
    create = client.post("/api/bills", json={
        "title": "Keep me",
        "items": [{"name": "A", "price": 10000}],
        "subtotal": 10000,
        "tax": 0,
        "service": 0,
        "total": 10000,
    }, headers=_headers(owner))
    assert create.status_code == 200, create.text
    bill_id = create.json()["id"]
    item_id = client.get(f"/api/bills/{bill_id}").json()["items"][0]["id"]

    response = client.put(f"/api/bills/{bill_id}", json={
        "title": "Should not save",
        "items": [{"id": item_id, "name": "Changed", "price": 10000}],
        "subtotal": 10000,
        "tax": 0,
        "service": 0,
        "order_discount": 10001,
        "total": 0,
    }, headers=_headers(owner))
    assert response.status_code == 400, response.text
    detail = client.get(f"/api/bills/{bill_id}").json()
    assert detail["bill"]["title"] == "Keep me"
    assert detail["bill"]["order_discount_idr"] == 0
    assert detail["items"][0]["name"] == "A"


def test_ocr_normalizes_explicit_order_discount_without_moving_it_to_items():
    normalized = ocr._normalize({
        "items": [{
            "name": "Item",
            "price": 10000,
            "discount": "10%",
            "discount_percent": 10,
        }],
        "order_discount": 5000,
        "subtotal": 5000,
        "tax": 0,
        "service": 0,
        "total": 5000,
    })

    assert normalized["items"][0]["discount"] == 0
    assert normalized["subtotal"] == 10000
    assert normalized["order_discount"] == 5000
    assert normalized["total"] == 5000


def test_ocr_accepts_clear_voucher_alias_and_missing_field_stays_zero():
    alias = ocr._normalize({
        "items": [{"name": "Item", "price": 10000}],
        "voucher_discount": "Rp 2.000",
        "subtotal": 10000,
        "tax": 0,
        "service": 0,
        "total": 8000,
    })
    assert alias["order_discount"] == 2000
    assert alias["total"] == 8000

    missing = ocr._normalize({
        "items": [{"name": "Item", "price": 10000}],
        "subtotal": 10000,
        "tax": 0,
        "service": 500,
        "total": 9500,
    })
    assert missing["order_discount"] == 0
    assert missing["total"] == 10500


def test_ocr_percentage_order_discount_is_not_treated_as_rupiah():
    normalized = ocr._normalize({
        "items": [{"name": "Item", "price": 10000}],
        "order_discount": "10%",
        "subtotal": 10000,
        "tax": 0,
        "service": 0,
        "total": 9000,
    })
    assert normalized["order_discount"] == 0
    assert normalized["total"] == 10000


def test_ocr_prompt_documents_order_level_discount_contract():
    prompt = ocr.SYSTEM_PROMPT.lower()
    assert "order_discount" in prompt
    assert "tingkat pesanan" in prompt
    assert "jangan" in prompt
    assert "subtotal + tax + service - order_discount" in prompt
