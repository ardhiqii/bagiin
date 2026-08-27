"""Black-box HTTP journeys against a real uvicorn process and SQLite file."""
from __future__ import annotations

import os
import shutil
import signal
import socket
import subprocess
import time
import uuid
from pathlib import Path

import httpx
import pytest

BASE = "http://127.0.0.1:8084"
BACKEND = Path(__file__).resolve().parent


@pytest.fixture(scope="module")
def api():
    token = uuid.uuid4().hex
    db = Path(f"/tmp/bagiin-e2e-{token}.db")
    uploads = Path(f"/tmp/bagiin-e2e-up-{token}")
    uploads.mkdir(parents=True)
    env = os.environ.copy()
    env.update(BAGIIN_DB=str(db), BAGIIN_UPLOAD_DIR=str(uploads))
    proc = subprocess.Popen(
        [str(BACKEND / "venv/bin/python"), "-m", "uvicorn", "main:app",
         "--host", "127.0.0.1", "--port", "8084"],
        cwd=BACKEND, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT,
    )
    client = httpx.Client(base_url=BASE, timeout=5.0)
    try:
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            if proc.poll() is not None:
                raise RuntimeError(f"uvicorn exited with {proc.returncode}")
            try:
                if client.get("/").status_code == 200:
                    break
            except httpx.HTTPError:
                pass
            time.sleep(0.1)
        else:
            raise RuntimeError("uvicorn did not become ready within 30 seconds")
        yield client
    finally:
        client.close()
        if proc.poll() is None:
            proc.send_signal(signal.SIGTERM)
            try:
                proc.wait(timeout=8)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait(timeout=5)
        # A failed teardown must not leave a server contaminating another run.
        with socket.socket() as sock:
            sock.settimeout(1)
            assert sock.connect_ex(("127.0.0.1", 8084)) != 0
        db.unlink(missing_ok=True)
        shutil.rmtree(uploads, ignore_errors=True)


def json_body(response):
    assert response.headers.get("content-type", "").startswith("application/json"), response.text
    return response.json()


def identity(api, name, creator=False):
    response = api.post("/api/identities", json={"name": name, "creator": creator})
    assert response.status_code == 200, response.text
    value = json_body(response)
    assert {"id", "name", "secret"} <= value.keys()
    return value


def auth(person, secret=None):
    return {
        "X-Identity-Id": person["id"],
        "X-Identity-Secret": person["secret"] if secret is None else secret,
    }


def make_bill(api, owner, **changes):
    payload = {
        "title": "HTTP journey",
        "merchant": "E2E cafe",
        "items": [{"name": "Nasi", "price": 1001}, {"name": "Mie", "price": 1000}],
        "participants": [],
        "participant_count": 2,
        "subtotal": 2001,
        "tax": 99,
        "service": 10,
        "total": 2110,
        "tax_included": False,
        "tax_mode": "proportional",
    }
    payload.update(changes)
    response = api.post("/api/bills", headers=auth(owner), json=payload)
    assert response.status_code == 200, response.text
    value = json_body(response)
    assert set(value) == {"id"}
    return value["id"]


def detail(api, bill_id, person=None):
    response = api.get(f"/api/bills/{bill_id}", headers=auth(person) if person else None)
    assert response.status_code == 200, response.text
    return json_body(response)


def people_map(value):
    return {p["identity_id"]: p for p in value["people"]}


def test_identity_bootstrap_and_bill_validation(api):
    creator = identity(api, "HTTP creator", creator=True)
    guest = identity(api, "HTTP guest")
    good = api.get(f"/api/identities/{creator['id']}/me", headers=auth(creator))
    assert good.status_code == 200
    assert api.get(f"/api/identities/{creator['id']}/me", headers=auth(creator, "bad")).status_code == 403
    # Missing identity headers are malformed authentication, while a supplied
    # but wrong secret is forbidden.
    assert api.get(f"/api/identities/{creator['id']}/me").status_code == 400
    assert api.get(f"/api/identities/{guest['id']}/me", headers=auth(creator)).status_code == 403

    base = {
        "items": [{"name": "A", "price": 100}], "subtotal": 100,
        "tax": 0, "service": 0, "total": 100,
    }
    for bad in (
        {**base, "subtotal": 99, "total": 99},
        {**base, "tax": 1, "total": 100},
        {**base, "tax": 1, "total": 101, "tax_included": True},
    ):
        response = api.post("/api/bills", headers=auth(creator), json=bad)
        assert response.status_code == 400, response.text
    assert api.post("/api/bills", headers=auth(creator), json={"items": []}).status_code == 400


def test_join_selection_and_exact_integer_invariant(api):
    creator = identity(api, "Invariant owner", creator=True)
    guest = identity(api, "Invariant guest")
    bill = make_bill(api, creator, items=[
        {"name": "odd", "price": 1001}, {"name": "shared", "price": 1000},
        {"name": "unclaimed", "price": 7}], subtotal=2008, tax=101, total=2109,
        participant_count=3, service=0)
    assert api.post(f"/api/bills/{bill}/join", headers=auth(guest)).status_code == 200
    item_ids = [x["id"] for x in detail(api, bill)["items"]]
    selected = api.post(f"/api/bills/{bill}/selections", headers=auth(guest),
                        json={"picks": [{"item_id": item_ids[0]}]})
    assert selected.status_code == 200, selected.text
    current = detail(api, bill, guest)
    assert current["total_ok"] is True
    assert sum(p["total_idr"] for p in current["people"]) + current["uncovered_idr"] + current["remaining_to_creator"] == current["bill"]["total_idr"]
    assert current["uncovered_idr"] == 0
    assert people_map(current)[guest["id"]]["subtotal_idr"] == 1001


def test_tax_modes_and_manual_floor_math(api):
    owner = identity(api, "Tax owner", creator=True)
    guest = identity(api, "Tax guest")
    common = {"items": [{"name": "A", "price": 3}, {"name": "B", "price": 7}],
              "subtotal": 10, "tax": 5, "service": 0, "total": 15, "participant_count": 2}
    bill = make_bill(api, owner, **common)
    for person, item in ((owner, 0), (guest, 1)):
        assert api.post(f"/api/bills/{bill}/join", headers=auth(person)).status_code == 200
    ids = [x["id"] for x in detail(api, bill)["items"]]
    assert api.post(f"/api/bills/{bill}/selections", headers=auth(owner), json={"picks": [{"item_id": ids[0]}]}).status_code == 200
    got = api.post(f"/api/bills/{bill}/selections", headers=auth(guest), json={"picks": [{"item_id": ids[1]}]})
    assert got.status_code == 200
    pm = people_map(json_body(got))
    # Each share is floored, then the one-rupiah remainder goes to the owner.
    assert pm[owner["id"]]["tax_idr"] == 2  # floor(3*5/10) + remainder
    assert pm[guest["id"]]["tax_idr"] == 3  # floor(7*5/10)
    assert sum(p["total_idr"] for p in pm.values()) == 15

    included = make_bill(api, owner, items=[{"name": "meal", "price": 300}], subtotal=300,
                         tax=0, service=30, total=330, tax_included=True)
    included_data = detail(api, included, owner)
    assert included_data["bill"]["tax_included"] == 1
    assert included_data["people"][0]["total_idr"] == 330
    # tax_included + tax=0 is also the service-only variant: the service charge
    # remains allocated even though the item's tax is already in its price.
    assert included_data["people"][0]["tax_idr"] == 30


def test_slot_capacity_uncovered_and_slot_resize(api):
    owner = identity(api, "Slot owner", creator=True)
    first = identity(api, "Slot first")
    second = identity(api, "Slot second")
    bill = make_bill(api, owner, items=[{"name": "pizza", "price": 100, "mode": "slot", "slot_count": 2}],
                     subtotal=100, tax=0, service=0, total=100, participant_count=3)
    for person in (first, second):
        assert api.post(f"/api/bills/{bill}/join", headers=auth(person)).status_code == 200
    iid = detail(api, bill)["items"][0]["id"]
    assert api.post(f"/api/bills/{bill}/selections", headers=auth(first), json={"picks": [{"item_id": iid, "qty": 1}]}).status_code == 200
    over = api.post(f"/api/bills/{bill}/selections", headers=auth(second), json={"picks": [{"item_id": iid, "qty": 2}]})
    assert over.status_code == 400 and "Slot" in over.text
    state = detail(api, bill)
    assert state["uncovered_idr"] == 50 and state["total_ok"] is True
    shrink = api.put(f"/api/bills/{bill}/items/{iid}/slots", headers=auth(owner), json={"slot_count": 0})
    assert shrink.status_code == 400
    grow = api.put(f"/api/bills/{bill}/items/{iid}/slots", headers=auth(owner), json={"slot_count": 3})
    assert grow.status_code == 200


def test_payer_transfer_name_safety_close_and_payment_lifecycle(api):
    creator = identity(api, "Payer creator", creator=True)
    payer = identity(api, "Payer guest")
    stranger = identity(api, "Payer stranger")
    bill = make_bill(api, creator, items=[{"name": "meal", "price": 100}], subtotal=100,
                     tax=0, service=0, total=100, paid_by_name=payer["name"])
    assert api.post(f"/api/bills/{bill}/join", headers=auth(payer)).status_code == 200
    by_name = api.put(f"/api/bills/{bill}/paid_by", headers=auth(creator), json={"name": payer["name"]})
    assert by_name.status_code == 200 and json_body(by_name)["paid_by_confirmed"] is False
    assert api.post(f"/api/bills/{bill}/close", headers=auth(payer)).status_code == 403
    explicit = api.put(f"/api/bills/{bill}/paid_by", headers=auth(creator), json={"identity_id": payer["id"]})
    assert explicit.status_code == 200
    assert json_body(explicit)["owner_id"] == payer["id"]
    assert api.post(f"/api/bills/{bill}/close", headers=auth(creator)).status_code == 403
    assert api.post(f"/api/bills/{bill}/payments/{creator['id']}/paid", headers=auth(creator)).status_code == 200
    assert api.post(f"/api/bills/{bill}/payments/{creator['id']}/unpaid", headers=auth(stranger)).status_code == 403
    assert api.post(f"/api/bills/{bill}/payments/{creator['id']}/unpaid", headers=auth(creator)).status_code == 200
    assert api.post(f"/api/bills/{bill}/payments/{creator['id']}/paid", headers=auth(creator)).status_code == 200
    assert api.post(f"/api/bills/{bill}/close", headers=auth(payer)).status_code == 200
    assert api.post(f"/api/bills/{bill}/payments/{creator['id']}/unpaid", headers=auth(creator)).status_code == 403


def test_leave_rejoin_list_detail_and_remove_person(api):
    creator = identity(api, "Leave creator", creator=True)
    payer = identity(api, "Leave payer")
    guest = identity(api, "Leave guest")
    bill = make_bill(api, creator, items=[{"name": "A", "price": 100}], subtotal=100,
                     tax=0, service=0, total=100, paid_by_name=payer["name"])
    for person in (payer, guest):
        assert api.post(f"/api/bills/{bill}/join", headers=auth(person)).status_code == 200
    assert api.put(f"/api/bills/{bill}/paid_by", headers=auth(creator), json={"identity_id": payer["id"]}).status_code == 200
    left = api.post(f"/api/bills/{bill}/leave", headers=auth(creator))
    assert left.status_code == 200 and json_body(left)["bill"]["creator_left"] == 1
    rejoined = api.post(f"/api/bills/{bill}/join", headers=auth(creator))
    assert rejoined.status_code == 200 and json_body(rejoined)["bill"]["creator_left"] == 0
    assert api.post(f"/api/bills/{bill}/leave", headers=auth(payer)).status_code == 400
    listed = json_body(api.get(f"/api/identities/{creator['id']}/bills", headers=auth(creator)))
    row = next(x for x in listed if x["id"] == bill)
    state = detail(api, bill, creator)
    assert row["owner_id"] == state["owner_id"] and row["settled"] == state["settled"]
    # Removing a guest removes their membership and payment/pick state.
    removed = api.delete(f"/api/bills/{bill}/people/{guest['id']}", headers=auth(payer))
    assert removed.status_code == 200
    assert all(p["identity_id"] != guest["id"] for p in json_body(removed)["people"])
    # Current v57 contract permits the manager to remove the original creator;
    # this is intentionally asserted as the live closest behavior to the brief.
    creator_removed = api.delete(f"/api/bills/{bill}/people/{creator['id']}", headers=auth(payer))
    assert creator_removed.status_code == 200
