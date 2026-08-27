"""Live HTTP end-to-end coverage for the user/bill workflows.

This deliberately starts uvicorn in a subprocess; it does not use FastAPI's
TestClient or call the database layer directly.
"""
from __future__ import annotations

import os
import shutil
import signal
import subprocess
import time
from pathlib import Path

import httpx
import pytest


BASE = "http://127.0.0.1:8084"
DB = Path("/tmp/bagiin-e2e-k1.db")
UPLOADS = Path("/tmp/bagiin-e2e-up-k1")


@pytest.fixture(scope="module")
def api():
    DB.unlink(missing_ok=True)
    shutil.rmtree(UPLOADS, ignore_errors=True)
    UPLOADS.mkdir(parents=True)
    env = os.environ.copy()
    env.update({"BAGIIN_DB": str(DB), "BAGIIN_UPLOAD_DIR": str(UPLOADS)})
    proc = subprocess.Popen(
        ["/opt/projects/bagiin/backend/venv/bin/python", "-m", "uvicorn",
         "main:app", "--host", "127.0.0.1", "--port", "8084"],
        cwd="/opt/projects/bagiin/backend", env=env,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
    )
    client = httpx.Client(base_url=BASE, timeout=5.0)
    try:
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            if proc.poll() is not None:
                output = proc.stdout.read() if proc.stdout else ""
                raise RuntimeError(f"uvicorn exited {proc.returncode}: {output}")
            try:
                # A 404 is the expected response and proves routing is alive.
                if client.get("/api/bills/e2e-readiness-probe").status_code == 404:
                    break
            except httpx.HTTPError:
                pass
            time.sleep(0.05)
        else:
            raise RuntimeError("uvicorn did not become ready")
        yield client
    finally:
        client.close()
        if proc.poll() is None:
            proc.send_signal(signal.SIGTERM)
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait(timeout=5)
        DB.unlink(missing_ok=True)
        shutil.rmtree(UPLOADS, ignore_errors=True)


def body(response):
    assert response.headers.get("content-type", "").startswith("application/json"), response.text
    return response.json()


def create_identity(api, name, creator=False):
    r = api.post("/api/identities", json={"name": name, "creator": creator})
    assert r.status_code == 200, r.text
    value = body(r)
    assert {"id", "name", "secret"} <= value.keys()
    assert value["name"] == name
    return value


def headers(identity, secret=None):
    return {"X-Identity-Id": identity["id"], "X-Identity-Secret": identity["secret"] if secret is None else secret}


def create_bill(api, identity, **overrides):
    payload = {
        "title": "Dinner",
        "merchant": "Warung E2E",
        "items": [
            {"name": "Nasi", "price": 1001},
            {"name": "Mie", "price": 1000},
            {"name": "Kerupuk", "price": 7},
        ],
        "participants": ["Alice", "Charlie", "alice"],
        "participant_count": 3,
        "paid_by_name": "Bob",
        "subtotal": 2008,
        "tax": 101,
        "service": 0,
        "total": 2109,
        "tax_included": False,
    }
    payload.update(overrides)
    r = api.post("/api/bills", headers=headers(identity), json=payload)
    assert r.status_code == 200, r.text
    value = body(r)
    assert set(value) == {"id"}
    return value["id"]


def test_identity_auth_and_validation(api):
    alice = create_identity(api, "Alice", creator=True)
    duplicate = create_identity(api, "Alice")
    assert duplicate["id"] != alice["id"]  # names are not unique; IDs are identities

    r = api.get(f"/api/identities/{alice['id']}/me", headers=headers(alice, "wrong-secret"))
    assert r.status_code == 403
    r = api.get(f"/api/identities/{duplicate['id']}/me", headers=headers(alice))
    assert r.status_code == 403
    # A valid session on a different path identity is a path/header mismatch,
    # so the authentication guard intentionally returns 403 before lookup.
    r = api.get("/api/identities/does-not-exist/me", headers=headers(alice))
    assert r.status_code == 403
    r = api.get("/api/identities/does-not-exist/me",
                headers={"X-Identity-Id": "does-not-exist", "X-Identity-Secret": "x"})
    assert r.status_code == 404

    r = api.post("/api/bills", headers=headers(alice), json={"items": []})
    assert r.status_code == 400
    r = api.post("/api/bills", headers=headers(alice), json={
        "items": [{"name": "Free", "price": 0}], "subtotal": 0, "tax": 0,
        "service": 0, "total": 0,
    })
    # Zero-value bills are currently accepted by the API (there is no positive
    # total requirement); retain this assertion as the live contract.
    assert r.status_code == 200, r.text
    zero_id = body(r)["id"]
    assert api.get(f"/api/bills/{zero_id}").status_code == 200


def test_bill_payer_join_pick_rounding_payment_and_settlement(api):
    alice = create_identity(api, "Alice", creator=True)
    bob = create_identity(api, "Bob")
    charlie = create_identity(api, "Charlie")
    bill_id = create_bill(api, alice)

    unknown = api.get("/api/bills/no-such-bill")
    assert unknown.status_code == 404
    detail = body(api.get(f"/api/bills/{bill_id}"))
    assert detail["bill"]["participant_count"] == 3
    assert detail["bill"]["tax_included"] == 0
    assert detail["paid_by_name"] == "Bob"
    assert detail["paid_by_id"] is None
    assert detail["settled"] is False
    item_ids = [item["id"] for item in detail["items"]]

    # Payer fronting: joining resolves the display payer, explicit identity
    # assignment confirms it and transfers management to that payer.
    joined = body(api.post(f"/api/bills/{bill_id}/join", headers=headers(bob)))
    assert joined["paid_by_id"] == bob["id"]
    assert joined["paid_by_confirmed"] is False
    confirmed = body(api.put(f"/api/bills/{bill_id}/paid_by", headers=headers(alice),
                             json={"identity_id": bob["id"]}))
    assert confirmed["owner_id"] == bob["id"]
    assert confirmed["paid_by_confirmed"] is True
    assert confirmed["can_manage"] is False

    assert api.post(f"/api/bills/{bill_id}/join", headers=headers(alice)).status_code == 200
    assert api.post(f"/api/bills/{bill_id}/join", headers=headers(charlie)).status_code == 200
    picked_a = body(api.post(f"/api/bills/{bill_id}/selections", headers=headers(alice),
                             json={"picks": [{"item_id": item_ids[0]}]}))
    assert picked_a["sel_by_item"][str(item_ids[0])][0]["id"] == alice["id"]
    picked_c = body(api.post(f"/api/bills/{bill_id}/selections", headers=headers(charlie),
                             json={"picks": [{"item_id": item_ids[1]}]}))
    assert picked_c["total_ok"] is True

    # Re-pick overwrites rather than accumulates this identity's selections.
    repick = body(api.post(f"/api/bills/{bill_id}/selections", headers=headers(alice),
                           json={"picks": [{"item_id": item_ids[1]}]}))
    assert [x["id"] for x in repick["sel_by_item"][str(item_ids[1])]] == [charlie["id"], alice["id"]]
    assert str(item_ids[0]) not in repick["sel_by_item"]
    # Restore the intended distinct picks for deterministic totals.
    body(api.post(f"/api/bills/{bill_id}/selections", headers=headers(alice),
                  json={"picks": [{"item_id": item_ids[0]}]}))

    current = body(api.get(f"/api/bills/{bill_id}", headers=headers(bob)))
    totals = {p["identity_id"]: p["total_idr"] for p in current["people"]}
    assert totals[alice["id"]] == 1051
    assert totals[charlie["id"]] == 1050
    assert totals[bob["id"]] == 8  # unassigned Kerupuk is charged to fronting payer
    assert sum(totals.values()) == 2109

    # Only a member can pay; self-mark is allowed, and a repeated mark is a
    # successful idempotent no-op.
    assert api.post(f"/api/bills/{bill_id}/payments/{alice['id']}/paid",
                    headers=headers(alice)).status_code == 200
    twice = body(api.post(f"/api/bills/{bill_id}/payments/{alice['id']}/paid",
                          headers=headers(alice)))
    assert twice["people"]
    assert next(p for p in twice["people"] if p["identity_id"] == alice["id"])["paid"] == "paid"
    undone = body(api.post(f"/api/bills/{bill_id}/payments/{alice['id']}/unpaid",
                           headers=headers(alice)))
    assert next(p for p in undone["people"] if p["identity_id"] == alice["id"])["paid"] == "unpaid"
    assert api.post(f"/api/bills/{bill_id}/payments/{alice['id']}/paid",
                    headers=headers(alice)).status_code == 200
    assert api.post(f"/api/bills/{bill_id}/payments/{charlie['id']}/paid",
                    headers=headers(charlie)).status_code == 200
    settled = body(api.get(f"/api/bills/{bill_id}"))
    assert settled["settled"] is True
    assert settled["all_paid"] is True

    # List payloads expose role-aware personal fields.
    alice_list = body(api.get(f"/api/identities/{alice['id']}/bills", headers=headers(alice)))
    bob_list = body(api.get(f"/api/identities/{bob['id']}/bills", headers=headers(bob)))
    arow = next(x for x in alice_list if x["id"] == bill_id)
    brow = next(x for x in bob_list if x["id"] == bill_id)
    assert arow["my_total_idr"] == 1051 and arow["my_paid"] is True and not arow["can_manage"]
    assert brow["my_total_idr"] == 8 and brow["i_am_payer"] is True and brow["can_manage"] is True

    # Non-owner cannot delete; owner can delete even after settlement.
    assert api.delete(f"/api/bills/{bill_id}", headers=headers(alice)).status_code == 403
    deleted = api.delete(f"/api/bills/{bill_id}", headers=headers(bob))
    assert deleted.status_code == 200 and body(deleted) == {"ok": True}
    assert api.get(f"/api/bills/{bill_id}").status_code == 404


def test_tax_included_variant_and_closed_settle_delete(api):
    owner = create_identity(api, "Owner", creator=True)
    bill_id = create_bill(api, owner, title="Included", items=[{"name": "Meal", "price": 300}],
                          participants=[], participant_count=2, paid_by_name="Owner",
                          subtotal=300, tax=0, service=30, total=330, tax_included=True)
    d = body(api.get(f"/api/bills/{bill_id}", headers=headers(owner)))
    assert d["bill"]["tax_included"] == 1
    assert d["bill"]["total_idr"] == 330
    assert d["total_ok"] is True
    assert d["settled"] is False  # a solo bill needs explicit settlement
    settled = body(api.post(f"/api/bills/{bill_id}/settle", headers=headers(owner)))
    assert settled["settled"] is True and settled["settled_manual"] is True
    assert api.delete(f"/api/bills/{bill_id}", headers=headers(owner)).status_code == 200
    assert api.get(f"/api/bills/{bill_id}").status_code == 404


def test_settled_bill_freeze_and_reopen_via_unmark(api):
    """v68 freeze contract: once settled, money is final.

    Auto-settle is computed (status stays "open"), which let picks/joins/
    invites silently change amounts under a settled banner. Mutations now
    409; the reopen path is unmarking a payment (or unsettle for manual).
    """
    owner = create_identity(api, "SettleOwner", creator=True)
    guest = create_identity(api, "SettleGuest")
    bill_id = create_bill(api, owner, items=[{"name": "Only", "price": 10}],
                          participants=[], participant_count=2, paid_by_name=None,
                          subtotal=10, tax=0, service=0, total=10)
    assert api.post(f"/api/bills/{bill_id}/join", headers=headers(guest)).status_code == 200
    item_id = body(api.get(f"/api/bills/{bill_id}"))["items"][0]["id"]
    assert api.post(f"/api/bills/{bill_id}/selections", headers=headers(guest),
                    json={"picks": [{"item_id": item_id}]}).status_code == 200
    assert api.post(f"/api/bills/{bill_id}/payments/{guest['id']}/paid",
                    headers=headers(guest)).status_code == 200
    before = body(api.get(f"/api/bills/{bill_id}"))
    assert before["settled"] is True

    # --- frozen: every money-mutating route must 409 ---
    assert api.post(f"/api/bills/{bill_id}/selections", headers=headers(owner),
                    json={"picks": []}).status_code == 409
    late = create_identity(api, "SettleLate")
    assert api.post(f"/api/bills/{bill_id}/join", headers=headers(late)).status_code == 409
    assert api.post(f"/api/bills/{bill_id}/invite", headers=headers(owner),
                    json={"identity_id": late["id"]}).status_code == 409
    assert api.post(f"/api/bills/{bill_id}/leave", headers=headers(guest)).status_code == 409
    # idempotent: re-marking an already-paid guest changes nothing
    assert api.post(f"/api/bills/{bill_id}/payments/{guest['id']}/paid",
                    headers=headers(owner)).status_code == 200
    after = body(api.get(f"/api/bills/{bill_id}"))
    assert after["settled"] is True
    assert [p["total_idr"] for p in after["people"]] == [p["total_idr"] for p in before["people"]]

    # --- reopen via unmark, fix, settle again ---
    assert api.post(f"/api/bills/{bill_id}/payments/{guest['id']}/unpaid",
                    headers=headers(guest)).status_code == 200
    assert body(api.get(f"/api/bills/{bill_id}"))["settled"] is False
    # picks survive the unmark — re-marking closes the bill again
    assert api.post(f"/api/bills/{bill_id}/payments/{guest['id']}/paid",
                    headers=headers(guest)).status_code == 200
    assert body(api.get(f"/api/bills/{bill_id}"))["settled"] is True
