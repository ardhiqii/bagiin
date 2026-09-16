"""Regression coverage for the v89 selections / roster contract change.

Two silent-success bugs, both fixed by turning "nothing happened" into a
status code the caller can act on:

1. ``POST /api/bills/{id}/selections`` treated a body with NO recognised key
   (``{}``, ``{"selections": [...]}``, ``{"foo": 1}``) as "clear my picks" and
   answered 200 -- so a client typo or version skew wiped everything the
   person had tapped and told them it worked. Clearing is now explicit:
   ``{"picks": []}`` or the legacy ``{"item_ids": []}``. A keyless body is a
   400 and the saved picks must still be on the bill afterwards (the survival
   assertion is the regression; the status code alone would not be enough).

2. ``DELETE /api/bills/{id}/people/{identity_id}`` for someone who was never
   on the bill answered 200 as a no-op, so a double-tap looked like it worked
   twice. Now 404.

Every case reads state back through the real HTTP path (``sel_by_item`` /
``people`` from ``GET /api/bills/{id}``), never through internal helpers only.

Run:
  cd backend && venv/bin/python -B -m pytest test_regressions_v89.py -q
"""
import os
import sys
import tempfile
from pathlib import Path

_TEST_ROOT = Path(tempfile.mkdtemp(prefix="bagiin-v89-"))
os.environ["BAGIIN_DB"] = str(_TEST_ROOT / "test_v89.db")
# conftest.py owns the session upload sandbox; do not replace it during full-suite collection.
os.environ.setdefault("BAGIIN_UPLOAD_DIR", str(_TEST_ROOT / "uploads"))

sys.path.insert(0, str(Path(__file__).resolve().parent))

import db

db.init_db()

from fastapi.testclient import TestClient
from main import app


client = TestClient(app, raise_server_exceptions=False)


# ---------- helpers (public API only) ----------

def _identity(name: str, creator: bool = False) -> dict:
    response = client.post("/api/identities", json={"name": name, "creator": creator})
    assert response.status_code == 200, response.text
    value = response.json()
    assert {"id", "name", "secret"} <= value.keys(), value
    return value


def _headers(who: dict) -> dict:
    return {"X-Identity-Id": who["id"], "X-Identity-Secret": who["secret"]}


def _new_bill(owner: dict, items=None, **over) -> str:
    items = items or [{"name": "A", "price": 100000}]
    subtotal = sum(int(i["price"]) for i in items)
    payload = {
        "title": "v89 bill",
        "merchant": "Warung v89",
        "items": items,
        "participants": [],
        "participant_count": 2,
        "subtotal": subtotal,
        "tax": 0,
        "service": 0,
        "total": subtotal,
    }
    payload.update(over)
    response = client.post("/api/bills", json=payload, headers=_headers(owner))
    assert response.status_code == 200, response.text
    return response.json()["id"]


def _detail(bill_id: str, who: dict | None = None) -> dict:
    response = client.get(
        f"/api/bills/{bill_id}", headers=_headers(who) if who else None
    )
    assert response.status_code == 200, response.text
    return response.json()


def _item_id(bill_id: str, name: str = "A") -> int:
    item = next(i for i in _detail(bill_id)["items"] if i["name"] == name)
    return int(item["id"])


def _picks_for(bill_id: str, item_id: int, who: dict, as_viewer: dict | None = None) -> list:
    """This person's picks on one item, read from the API payload."""
    data = _detail(bill_id, as_viewer or who)
    return sorted(
        (s["id"], int(s["qty"]))
        for s in data["sel_by_item"].get(str(item_id), [])
        if s["id"] == who["id"]
    )


def _roster(bill_id: str, as_viewer: dict) -> list:
    """Member identity ids from the API payload."""
    return sorted(p["identity_id"] for p in _detail(bill_id, as_viewer)["people"])


def _payment_rows(bill_id: str) -> list:
    """Raw payment rows: the membership store `remove_person` mutates."""
    bill_data = db.get_bill(bill_id)
    assert bill_data is not None
    return sorted(
        (p["identity_id"], p["status"])
        for p in bill_data["payments"]
    )


def _pick(bill_id: str, who: dict, item_id: int, qty: int = 1):
    return client.post(
        f"/api/bills/{bill_id}/selections",
        headers=_headers(who),
        json={"picks": [{"item_id": item_id, "qty": qty}]},
    )


# ---------- 1-3. keyless bodies are rejected AND the picks survive ----------

KEYLESS_BODIES = [
    {},                                # empty object
    {"selections": [{"item_id": 1}]},  # wrong key (the reproduced bug)
    {"foo": 1},                        # unknown key only
    {"picks_": []},                    # near-miss typo
]


def test_keyless_bodies_are_rejected_and_picks_survive():
    """Case 1-3. The load-bearing assertion: a 400 alone is not the fix --
    the picks that were already saved must still be there."""
    creator = _identity("V89 owner keyless", creator=True)
    guest = _identity("V89 guest keyless")
    bill_id = _new_bill(creator)
    item_id = _item_id(bill_id)

    saved = _pick(bill_id, guest, item_id)
    assert saved.status_code == 200, saved.text
    assert _picks_for(bill_id, item_id, guest) == [(guest["id"], 1)]

    for body in KEYLESS_BODIES:
        response = client.post(
            f"/api/bills/{bill_id}/selections",
            headers=_headers(guest),
            json=body,
        )
        assert response.status_code == 400, (body, response.status_code, response.text)
        assert response.json()["detail"] == "Daftar pilihan wajib diisi", response.text
        # the whole point: nothing was destroyed
        assert _picks_for(bill_id, item_id, guest) == [(guest["id"], 1)], body


def test_body_with_no_bytes_is_still_rejected():
    response = client.post(
        f"/api/bills/{_new_bill(_identity('V89 owner empty', creator=True))}/selections",
        headers=_headers(_identity("V89 guest empty")),
    )
    assert response.status_code == 400, response.text


# ---------- 4-6. the explicit clears still clear ----------

def test_picks_empty_list_still_clears():
    creator = _identity("V89 owner clear", creator=True)
    guest = _identity("V89 guest clear")
    bill_id = _new_bill(creator)
    item_id = _item_id(bill_id)
    assert _pick(bill_id, guest, item_id).status_code == 200

    response = client.post(
        f"/api/bills/{bill_id}/selections",
        headers=_headers(guest),
        json={"picks": []},
    )
    assert response.status_code == 200, response.text
    assert _picks_for(bill_id, item_id, guest) == []


def test_legacy_item_ids_empty_list_still_clears():
    creator = _identity("V89 owner legacy clear", creator=True)
    guest = _identity("V89 guest legacy clear")
    bill_id = _new_bill(creator)
    item_id = _item_id(bill_id)
    assert _pick(bill_id, guest, item_id).status_code == 200

    response = client.post(
        f"/api/bills/{bill_id}/selections",
        headers=_headers(guest),
        json={"item_ids": []},
    )
    assert response.status_code == 200, response.text
    assert _picks_for(bill_id, item_id, guest) == []


def test_picks_null_still_clears():
    """Documented decision: the guard keys on KEY PRESENCE, not usefulness.
    `picks: null` carries the key, so it keeps its pre-v89 meaning (coerced to
    [] -> 200 + clear). Only a body that names neither key is a 400."""
    creator = _identity("V89 owner null", creator=True)
    guest = _identity("V89 guest null")
    bill_id = _new_bill(creator)
    item_id = _item_id(bill_id)
    assert _pick(bill_id, guest, item_id).status_code == 200

    response = client.post(
        f"/api/bills/{bill_id}/selections",
        headers=_headers(guest),
        json={"picks": None},
    )
    assert response.status_code == 200, response.text
    assert _picks_for(bill_id, item_id, guest) == []


# ---------- legacy bare item_ids path + merge ----------

def test_legacy_item_ids_list_path_and_merge_still_work():
    creator = _identity("V89 owner legacy path", creator=True)
    guest = _identity("V89 guest legacy path")
    bill_id = _new_bill(creator)
    item_id = _item_id(bill_id)

    response = client.post(
        f"/api/bills/{bill_id}/selections",
        headers=_headers(guest),
        json={"item_ids": [item_id]},
    )
    assert response.status_code == 200, response.text
    assert _picks_for(bill_id, item_id, guest) == [(guest["id"], 1)]

    # duplicate item ids merge into one row (qty summed), not two rows
    merged = client.post(
        f"/api/bills/{bill_id}/selections",
        headers=_headers(guest),
        json={"picks": [{"item_id": item_id, "qty": 2}, {"item_id": item_id, "qty": 1}]},
    )
    assert merged.status_code == 200, merged.text
    assert _picks_for(bill_id, item_id, guest) == [(guest["id"], 3)]

    # legacy fallback still converts an empty `picks` + item_ids to a real pick
    fallback = client.post(
        f"/api/bills/{bill_id}/selections",
        headers=_headers(guest),
        json={"picks": [], "item_ids": [item_id]},
    )
    assert fallback.status_code == 200, fallback.text
    assert _picks_for(bill_id, item_id, guest) == [(guest["id"], 1)]


# ---------- 7-8. the existing rejection cases still reject ----------

def test_unknown_item_id_is_rejected_and_picks_survive():
    creator = _identity("V89 owner unknown item", creator=True)
    guest = _identity("V89 guest unknown item")
    bill_id = _new_bill(creator)
    item_id = _item_id(bill_id)
    assert _pick(bill_id, guest, item_id).status_code == 200

    response = client.post(
        f"/api/bills/{bill_id}/selections",
        headers=_headers(guest),
        json={"picks": [{"item_id": 999999999, "qty": 1}]},
    )
    assert response.status_code == 400, response.text
    assert _picks_for(bill_id, item_id, guest) == [(guest["id"], 1)]


def test_malformed_shapes_still_rejected_and_picks_survive():
    creator = _identity("V89 owner malformed", creator=True)
    guest = _identity("V89 guest malformed")
    bill_id = _new_bill(creator)
    item_id = _item_id(bill_id)
    assert _pick(bill_id, guest, item_id).status_code == 200

    bad_bodies = [
        {"picks": {}},                                       # non-list picks
        {"picks": "x"},                                      # non-list picks
        {"item_ids": "x"},                                   # non-list item_ids
        {"picks": [{"item_id": "x", "qty": 1}]},             # non-numeric item id
        {"picks": [{"item_id": item_id, "qty": 0}]},         # qty floor
        {"picks": [{"item_id": item_id, "qty": -3}]},        # negative qty
        {"picks": [{"item_id": item_id, "qty": 100}]},       # qty ceiling
    ]
    for body in bad_bodies:
        response = client.post(
            f"/api/bills/{bill_id}/selections",
            headers=_headers(guest),
            json=body,
        )
        assert response.status_code == 400, (body, response.status_code, response.text)
        assert _picks_for(bill_id, item_id, guest) == [(guest["id"], 1)], body


def test_slot_capacity_still_rejects_over_capacity_picks():
    creator = _identity("V89 owner slot", creator=True)
    first = _identity("V89 guest slot one")
    second = _identity("V89 guest slot two")
    bill_id = _new_bill(
        creator,
        items=[{"name": "pizza", "price": 30000, "mode": "slot", "slot_count": 2}],
        participant_count=3,
    )
    item_id = _item_id(bill_id, "pizza")
    assert _pick(bill_id, first, item_id).status_code == 200

    left = client.post(
        f"/api/bills/{bill_id}/selections",
        headers=_headers(second),
        json={"picks": [{"item_id": item_id, "qty": 2}]},
    )
    assert left.status_code == 400, left.text
    assert "Slot pizza tersisa 1" in left.json()["detail"], left.text

    over = client.post(
        f"/api/bills/{bill_id}/selections",
        headers=_headers(first),
        json={"picks": [{"item_id": item_id, "qty": 5}]},
    )
    assert over.status_code == 400, over.text
    assert "Slot pizza hanya berjumlah 2" in over.json()["detail"], over.text
    # nothing changed for either caller
    assert _picks_for(bill_id, item_id, first) == [(first["id"], 1)]
    assert _picks_for(bill_id, item_id, second) == []


# ---------- 9-11. remove-person: 404 / 403 / 400 with no mutation ----------

def test_remove_unknown_member_is_404_and_membership_unchanged():
    creator = _identity("V89 owner remove", creator=True)
    member = _identity("V89 member remove")
    stranger = _identity("V89 never joined")
    bill_id = _new_bill(creator)
    assert client.post(
        f"/api/bills/{bill_id}/join", headers=_headers(member)
    ).status_code == 200

    before_roster = _roster(bill_id, creator)
    before_payments = _payment_rows(bill_id)
    assert member["id"] in before_roster and stranger["id"] not in before_roster

    for target in (stranger["id"], "id-yang-tidak-ada-89"):
        response = client.delete(
            f"/api/bills/{bill_id}/people/{target}", headers=_headers(creator)
        )
        assert response.status_code == 404, (target, response.status_code, response.text)
        assert response.json()["detail"] == "Orang ini tidak ada di bill", response.text
        assert _roster(bill_id, creator) == before_roster
        assert _payment_rows(bill_id) == before_payments

    # the real member is still removable afterwards (the 404 didn't poison it)
    removed = client.delete(
        f"/api/bills/{bill_id}/people/{member['id']}", headers=_headers(creator)
    )
    assert removed.status_code == 200, removed.text
    assert member["id"] not in _roster(bill_id, creator)


def test_remove_member_by_non_manager_is_403_and_membership_unchanged():
    creator = _identity("V89 owner nonmgr", creator=True)
    member = _identity("V89 member nonmgr")
    bill_id = _new_bill(creator)
    assert client.post(
        f"/api/bills/{bill_id}/join", headers=_headers(member)
    ).status_code == 200

    before_roster = _roster(bill_id, creator)
    before_payments = _payment_rows(bill_id)

    response = client.delete(
        f"/api/bills/{bill_id}/people/{creator['id']}", headers=_headers(member)
    )
    assert response.status_code == 403, response.text
    assert _roster(bill_id, creator) == before_roster
    assert _payment_rows(bill_id) == before_payments


def test_owner_removing_themselves_is_400_and_membership_unchanged():
    creator = _identity("V89 owner self", creator=True)
    member = _identity("V89 member self")
    bill_id = _new_bill(creator)
    assert client.post(
        f"/api/bills/{bill_id}/join", headers=_headers(member)
    ).status_code == 200

    before_roster = _roster(bill_id, creator)
    before_payments = _payment_rows(bill_id)

    response = client.delete(
        f"/api/bills/{bill_id}/people/{creator['id']}", headers=_headers(creator)
    )
    assert response.status_code == 400, response.text
    assert _roster(bill_id, creator) == before_roster
    assert _payment_rows(bill_id) == before_payments
