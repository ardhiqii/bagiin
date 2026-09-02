"""Regression coverage for persisted item quantities and quantity-aware splits."""
import os
import sqlite3
import sys
import tempfile
from pathlib import Path

_DB = Path(tempfile.mkdtemp(prefix="bagiin-v69-")) / "quantity.db"
os.environ["BAGIIN_DB"] = str(_DB)
os.environ.setdefault("BAGIIN_UPLOAD_DIR", tempfile.mkdtemp(prefix="bagiin-v69-uploads-"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import calc
import db
from fastapi.testclient import TestClient
from main import app


db.init_db()
client = TestClient(app)


def _headers(identity):
    return {"X-Identity-Id": identity["id"], "X-Identity-Secret": identity["secret"]}


def _bill(owner, items, *, subtotal=None, tax=0, service=0, total=None,
          tax_included=False, tax_mode="proportional", participants=None):
    subtotal = sum((i.get("price", 0) - i.get("discount", 0)) * i.get("quantity", 1) for i in items) if subtotal is None else subtotal
    total = subtotal + tax + service if total is None else total
    payload = {
        "title": "Quantity regression",
        "items": items,
        "subtotal": subtotal,
        "tax": tax,
        "service": service,
        "total": total,
        "tax_included": tax_included,
        "tax_mode": tax_mode,
    }
    if participants is not None:
        payload["participants"] = participants
    response = client.post("/api/bills", json=payload, headers=_headers(owner))
    assert response.status_code == 200, response.text
    return response.json()["id"]


def _detail(bill_id):
    response = client.get(f"/api/bills/{bill_id}")
    assert response.status_code == 200, response.text
    return response.json()


def test_omitted_quantity_is_one_and_quantity_two_persists():
    owner = db.new_identity("v69-owner-1")
    bill_id = _bill(owner, [{"name": "omitted", "price": 100}, {"name": "double", "price": 250, "quantity": 2}])
    data = _detail(bill_id)
    assert [item["quantity"] for item in data["items"]] == [1, 2]
    assert data["bill"]["subtotal_idr"] == 600
    assert data["bill"]["total_idr"] == 600
    assert data["total_ok"] is True


def test_quantity_three_scales_line_subtotal_and_calc():
    owner = db.new_identity("v69-owner-2")
    bill_id = _bill(owner, [{"name": "three", "price": 700, "quantity": 3}])
    item = _detail(bill_id)["items"][0]
    assert item["quantity"] == 3
    result = calc.compute(
        {"subtotal_idr": 2100, "tax_idr": 0, "service_idr": 0, "total_idr": 2100},
        [{"id": item["id"], "name": "three", "price_idr": 700, "quantity": 3}],
        [], [], owner["id"],
    )
    assert result["by_identity"][owner["id"]]["subtotal_idr"] == 2100
    assert result["total_ok"] is True


def test_duplicate_names_remain_distinct_item_ids_and_are_calculated_separately():
    owner = db.new_identity("v69-owner-3")
    bill_id = _bill(owner, [{"name": "same", "price": 100}, {"name": "same", "price": 300, "quantity": 2}])
    data = _detail(bill_id)
    assert [item["name"] for item in data["items"]] == ["same", "same"]
    assert len({item["id"] for item in data["items"]}) == 2
    assert data["bill"]["subtotal_idr"] == 700
    assert data["total_ok"] is True


def test_free_quantity_and_selection_qty_are_independent():
    owner = db.new_identity("v69-owner-4")
    alice = db.new_identity("v69-alice-4")
    bob = db.new_identity("v69-bob-4")
    bill_id = _bill(owner, [{"name": "free", "price": 600, "quantity": 3}])
    item_id = _detail(bill_id)["items"][0]["id"]
    for person, qty in ((alice, 1), (bob, 2)):
        response = client.post(f"/api/bills/{bill_id}/selections", json={"picks": [{"item_id": item_id, "qty": qty}]}, headers=_headers(person))
        assert response.status_code == 200, response.text
    data = _detail(bill_id)
    stored = {(s["identity_id"], s["qty"]) for s in db.get_bill(bill_id)["selections"]}
    assert stored == {(alice["id"], 1), (bob["id"], 2)}
    totals = {p["identity_id"]: p["subtotal_idr"] for p in data["people"]}
    assert totals[alice["id"]] == 600
    assert totals[bob["id"]] == 1200
    assert data["total_ok"] is True


def test_slot_quantity_scales_slots_and_reports_empty_slot_value():
    owner = db.new_identity("v69-owner-5")
    alice = db.new_identity("v69-alice-5")
    bill_id = _bill(owner, [{"name": "slot", "price": 100, "quantity": 3, "mode": "slot", "slot_count": 4}])
    item_id = _detail(bill_id)["items"][0]["id"]
    response = client.post(f"/api/bills/{bill_id}/selections", json={"picks": [{"item_id": item_id, "qty": 1}]}, headers=_headers(alice))
    assert response.status_code == 200, response.text
    data = _detail(bill_id)
    assert data["uncovered_idr"] == 225
    assert data["uncovered_slots"][0]["empty"] == 3
    assert data["uncovered_slots"][0]["per_slot"] == 75
    assert data["people"]
    assert data["total_ok"] is True


def test_per_unit_discount_scales_with_quantity():
    owner = db.new_identity("v69-owner-6")
    bill_id = _bill(owner, [{"name": "discounted", "price": 1000, "discount": 100, "quantity": 3}])
    data = _detail(bill_id)
    assert data["items"][0]["discount_idr"] == 100
    assert data["items"][0]["quantity"] == 3
    assert data["bill"]["subtotal_idr"] == 2700
    assert data["total_ok"] is True


def test_tax_and_service_are_proportional_after_quantity_scaling():
    owner = db.new_identity("v69-owner-7")
    alice = db.new_identity("v69-alice-7")
    bill_id = _bill(owner, [{"name": "A", "price": 100, "quantity": 2}, {"name": "B", "price": 300}], tax=40, service=20)
    items = _detail(bill_id)["items"]
    for person, item in ((owner, items[0]), (alice, items[1])):
        response = client.post(f"/api/bills/{bill_id}/selections", json={"picks": [{"item_id": item["id"]}]}, headers=_headers(person))
        assert response.status_code == 200, response.text
    people = {p["identity_id"]: p for p in _detail(bill_id)["people"]}
    assert people[owner["id"]]["subtotal_idr"] == 200
    assert people[alice["id"]]["subtotal_idr"] == 300
    assert people[owner["id"]]["tax_idr"] + people[alice["id"]]["tax_idr"] == 60
    assert sum(p["total_idr"] for p in people.values()) == 560
    assert _detail(bill_id)["total_ok"] is True


def test_tax_included_drops_tax_but_keeps_service_in_split():
    owner = db.new_identity("v69-owner-8")
    bill_id = _bill(owner, [{"name": "included", "price": 1000, "quantity": 2}], tax=0, service=90, tax_included=True)
    data = _detail(bill_id)
    assert data["bill"]["tax_included"] == 1
    assert data["bill"]["tax_idr"] == 0
    assert data["bill"]["service_idr"] == 90
    assert data["people"][0]["total_idr"] == 2090
    assert data["total_ok"] is True


def test_invalid_quantity_values_are_rejected_on_create():
    owner = db.new_identity("v69-owner-9")
    for bad in (True, 1.5, "2", 0, -1, 100):
        response = client.post("/api/bills", json={"title": "bad", "items": [{"name": "x", "price": 10, "quantity": bad}], "subtotal": 10, "tax": 0, "service": 0, "total": 10}, headers=_headers(owner))
        assert response.status_code == 400, (bad, response.text)


def test_invalid_quantity_is_rejected_on_update_and_update_is_atomic():
    owner = db.new_identity("v69-owner-10")
    bill_id = _bill(owner, [{"name": "original", "price": 100, "quantity": 2}])
    before = _detail(bill_id)
    item = before["items"][0]
    for bad in (True, 1.5, "2", 0, -1, 100):
        payload = {"title": "should not save", "items": [{"id": item["id"], "name": "changed", "price": 100, "quantity": bad}], "subtotal": 100, "tax": 0, "service": 0, "total": 100}
        response = client.put(f"/api/bills/{bill_id}", json=payload, headers=_headers(owner))
        assert response.status_code == 400, (bad, response.text)
        after = _detail(bill_id)
        assert after["bill"]["title"] == before["bill"]["title"]
        assert after["items"][0]["name"] == "original"
        assert after["items"][0]["quantity"] == 2
        assert after["bill"]["subtotal_idr"] == 200


def test_duplicate_item_id_in_update_is_rejected():
    owner = db.new_identity("v69-owner-11")
    bill_id = _bill(owner, [{"name": "x", "price": 100}, {"name": "y", "price": 100}])
    items = _detail(bill_id)["items"]
    payload = {"title": "bad duplicate", "items": [{"id": items[0]["id"], "name": "x", "price": 100}, {"id": items[0]["id"], "name": "y", "price": 100}], "subtotal": 200, "tax": 0, "service": 0, "total": 200}
    response = client.put(f"/api/bills/{bill_id}", json=payload, headers=_headers(owner))
    assert response.status_code == 400
    assert [i["name"] for i in _detail(bill_id)["items"]] == ["x", "y"]


def test_old_database_migration_adds_quantity_and_is_idempotent():
    old_path = Path(tempfile.mkdtemp(prefix="bagiin-v69-old-")) / "old.db"
    conn = sqlite3.connect(old_path)
    conn.executescript("""
        CREATE TABLE identity (id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'guest', created_at TEXT NOT NULL DEFAULT (datetime('now')));
        CREATE TABLE bill (id TEXT PRIMARY KEY, creator_identity_id TEXT NOT NULL, title TEXT NOT NULL, photo_path TEXT, subtotal_idr INTEGER NOT NULL DEFAULT 0, tax_idr INTEGER NOT NULL DEFAULT 0, service_idr INTEGER NOT NULL DEFAULT 0, total_idr INTEGER NOT NULL DEFAULT 0, tax_mode TEXT NOT NULL DEFAULT 'proportional', status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL DEFAULT (datetime('now')));
        CREATE TABLE bill_participant (bill_id TEXT NOT NULL, name TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (bill_id, name));
        CREATE TABLE item (id INTEGER PRIMARY KEY AUTOINCREMENT, bill_id TEXT NOT NULL, name TEXT NOT NULL, price_idr INTEGER NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE selection (id INTEGER PRIMARY KEY AUTOINCREMENT, item_id INTEGER NOT NULL, identity_id TEXT NOT NULL, UNIQUE(item_id, identity_id));
        CREATE TABLE payment (id INTEGER PRIMARY KEY AUTOINCREMENT, bill_id TEXT NOT NULL, identity_id TEXT NOT NULL, amount_idr INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'unpaid', paid_at TEXT);
        CREATE TABLE payment_profile (id INTEGER PRIMARY KEY AUTOINCREMENT, identity_id TEXT NOT NULL, type TEXT NOT NULL, label TEXT NOT NULL, detail TEXT NOT NULL);
        CREATE TABLE payment_account (id INTEGER PRIMARY KEY AUTOINCREMENT, identity_id TEXT NOT NULL, brand TEXT NOT NULL, account_no TEXT NOT NULL, holder_name TEXT, sort_order INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE bill_invite (id INTEGER PRIMARY KEY AUTOINCREMENT, bill_id TEXT NOT NULL, identity_id TEXT NOT NULL, invited_by TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL DEFAULT (datetime('now')));
        CREATE TABLE bill_photo (id INTEGER PRIMARY KEY AUTOINCREMENT, bill_id TEXT NOT NULL, path TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0);
    """)
    conn.commit(); conn.close()
    original = db.DB_PATH
    try:
        db.DB_PATH = str(old_path)
        db.init_db()
        db.init_db()
        with sqlite3.connect(old_path) as check:
            item_columns = {row[1] for row in check.execute("PRAGMA table_info(item)")}
            selection_columns = {row[1] for row in check.execute("PRAGMA table_info(selection)")}
        assert "quantity" in item_columns
        assert "qty" in selection_columns
    finally:
        db.DB_PATH = original
