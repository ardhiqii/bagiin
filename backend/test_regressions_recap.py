"""Regression coverage for the v72 identity-scoped Rekap Patungan API."""
import os
import sys
import tempfile
from pathlib import Path

_tmp = Path(tempfile.mkdtemp()) / "recap.db"
os.environ["BAGIIN_DB"] = str(_tmp)
os.environ.setdefault("BAGIIN_UPLOAD_DIR", str(Path(tempfile.mkdtemp()) / "uploads"))

sys.path.insert(0, str(Path(__file__).resolve().parent))

import db

db.init_db()

from fastapi.testclient import TestClient
import main

main.limiter.enabled = False
c = TestClient(main.app)


def _H(who):
    ident = who if isinstance(who, dict) else db.get_identity(who)
    headers = {"X-Identity-Id": ident["id"]}
    if ident.get("secret"):
        headers["X-Identity-Secret"] = ident["secret"]
    return headers


def _mk_bill(creator, **kw):
    items = kw.get("items", [{"name": "Makan", "price": kw.get("total", 100000)}])
    subtotal = kw.get("subtotal", sum(i["price"] - i.get("discount", 0) for i in items))
    payload = {
        "title": kw.get("title", "Bill Rekap"),
        "items": items,
        "subtotal": subtotal,
        "tax": kw.get("tax", 0),
        "service": kw.get("service", 0),
        "total": kw.get("total", subtotal),
    }
    for key in ("participants", "paid_by_name", "tax_included", "tax_mode"):
        if key in kw:
            payload[key] = kw[key]
    response = c.post("/api/bills", json=payload, headers=_H(creator))
    assert response.status_code == 200, response.text
    return response.json()["id"]


def _item_ids(bill_id):
    return [item["id"] for item in db.get_bill(bill_id)["items"]]


def _join_and_pick(bill_id, identity, item_ids):
    response = c.post(f"/api/bills/{bill_id}/join", headers=_H(identity))
    assert response.status_code == 200, response.text
    response = c.post(
        f"/api/bills/{bill_id}/selections",
        headers=_H(identity),
        json={"picks": [{"item_id": item_id, "qty": 1} for item_id in item_ids]},
    )
    assert response.status_code == 200, response.text


def _recap(identity):
    response = c.get(
        f"/api/identities/{identity['id']}/recap",
        headers=_H(identity),
    )
    assert response.status_code == 200, response.text
    return response.json()


def _action(data, section, kind, bill_id):
    return next(
        action
        for action in data["actions"][section]
        if action["kind"] == kind and action["bill_id"] == bill_id
    )


def test_reciprocal_final_bills_net_by_real_identity_with_drilldown():
    alice = db.new_identity("Alice Recip", role="creator")
    bob = db.new_identity("Bob Recip")

    receive_bill = _mk_bill(alice, title="Alice Bayar", total=100000)
    _join_and_pick(receive_bill, bob, _item_ids(receive_bill))
    assert c.post(f"/api/bills/{receive_bill}/close", headers=_H(alice)).status_code == 200

    pay_bill = _mk_bill(bob, title="Bob Bayar", total=80000)
    _join_and_pick(pay_bill, alice, _item_ids(pay_bill))
    assert c.post(f"/api/bills/{pay_bill}/close", headers=_H(bob)).status_code == 200

    recap = _recap(alice)
    assert recap["final"]["payable_idr"] == 80000
    assert recap["final"]["receivable_idr"] == 100000
    assert recap["final"]["net_idr"] == 20000
    assert recap["final"]["bill_count"] == 2

    assert len(recap["final"]["counterparties"]) == 1
    counterparty = recap["final"]["counterparties"][0]
    assert counterparty["identity_id"] == bob["id"]
    assert counterparty["net_idr"] == 20000
    assert counterparty["direction"] == "receive"
    assert counterparty["amount_idr"] == 20000
    assert {
        (bill["bill_id"], bill["amount_idr"], bill["direction"], bill["status"])
        for bill in counterparty["bills"]
    } == {
        (receive_bill, 100000, "receive", "closed"),
        (pay_bill, 80000, "pay", "closed"),
    }


def test_final_counterparty_reports_pending_actions_for_same_person():
    owner = db.new_identity("Owner Pending Card", role="creator")
    guest = db.new_identity("Guest Pending Card")

    final_bill = _mk_bill(owner, title="Sudah Final", total=100000)
    _join_and_pick(final_bill, guest, _item_ids(final_bill))
    assert c.post(f"/api/bills/{final_bill}/close", headers=_H(owner)).status_code == 200

    pending_bill = _mk_bill(owner, title="Masih Pilih", total=30000)
    response = c.post(f"/api/bills/{pending_bill}/join", headers=_H(guest))
    assert response.status_code == 200, response.text

    recap = _recap(owner)
    counterparty = next(
        row for row in recap["final"]["counterparties"]
        if row["identity_id"] == guest["id"]
    )
    assert counterparty["net_idr"] == 100000
    assert counterparty["pending"] == {
        "count": 1,
        "current_user": 0,
        "waiting_other": 1,
        "bill_ids": [pending_bill],
    }
    wait = _action(recap, "waiting_other", "wait_selection", pending_bill)
    assert wait["counterparty_id"] == guest["id"]


def test_final_pending_uncovered_and_manual_settle_are_separate():
    owner = db.new_identity("Owner Separation", role="creator")
    guest = db.new_identity("Guest Separation")

    final_bill = _mk_bill(owner, title="Final Unpaid", total=100000)
    _join_and_pick(final_bill, guest, _item_ids(final_bill))
    assert c.post(f"/api/bills/{final_bill}/close", headers=_H(owner)).status_code == 200

    pending_bill = _mk_bill(owner, title="Masih Menunggu", total=60000)
    response = c.post(f"/api/bills/{pending_bill}/join", headers=_H(guest))
    assert response.status_code == 200, response.text
    assert c.post(f"/api/bills/{pending_bill}/close", headers=_H(owner)).status_code == 200

    uncovered_bill = _mk_bill(
        owner,
        title="Slot Kosong",
        items=[{"name": "Tiket", "price": 100000, "mode": "slot", "slot_count": 2}],
        total=100000,
    )
    _join_and_pick(uncovered_bill, guest, _item_ids(uncovered_bill))
    assert c.post(f"/api/bills/{uncovered_bill}/close", headers=_H(owner)).status_code == 200

    manual_bill = _mk_bill(owner, title="Bayar Tunai", total=40000)
    assert c.post(f"/api/bills/{manual_bill}/settle", headers=_H(owner)).status_code == 200

    recap = _recap(owner)
    assert recap["final"]["bill_count"] == 2
    assert recap["final"]["receivable_idr"] == 100000
    assert recap["final"]["payable_idr"] == 0
    assert recap["provisional"]["bill_count"] == 2
    assert {bill["bill_id"] for bill in recap["provisional"]["bills"]} == {
        pending_bill,
        uncovered_bill,
    }
    reasons = {
        bill["bill_id"]: set(bill["reason_codes"])
        for bill in recap["provisional"]["bills"]
    }
    assert {"pending_selection"} <= reasons[pending_bill]
    assert {"uncovered_slots"} <= reasons[uncovered_bill]
    assert manual_bill not in {bill["bill_id"] for bill in recap["provisional"]["bills"]}


def test_actions_separate_current_work_from_waiting_other_and_invites():
    owner = db.new_identity("Owner Actions", role="creator")
    picker = db.new_identity("Picker Actions")
    invitee = db.new_identity("Invitee Actions")

    bill_id = _mk_bill(owner, title="Action Bill", total=90000)
    response = c.post(f"/api/bills/{bill_id}/join", headers=_H(picker))
    assert response.status_code == 200, response.text

    # Directly create the same pending state the invite endpoint persists. This
    # keeps the test focused on recap shaping and avoids its contact precondition.
    invite = db.create_invite(bill_id, invitee["id"], owner["id"])
    assert invite["status"] == "pending"

    owner_recap = _recap(owner)
    owner_wait = owner_recap["actions"]["waiting_other"]
    wait_selection = _action(owner_recap, "waiting_other", "wait_selection", bill_id)
    assert wait_selection["owner"] == "other"
    assert wait_selection["counterparty_id"] == picker["id"]
    wait_invite = _action(owner_recap, "waiting_other", "wait_invite", bill_id)
    assert wait_invite["owner"] == "other"
    assert wait_invite["invite_id"] == invite["id"]
    assert wait_invite["identity_id"] == invitee["id"]
    assert wait_invite["counterparty_id"] == invitee["id"]
    assert [action["identity_id"] for action in owner_wait] == sorted(
        action["identity_id"] for action in owner_wait
    )

    picker_recap = _recap(picker)
    select = _action(picker_recap, "current_user", "select_items", bill_id)
    assert select["owner"] == "current_user"
    assert select["identity_id"] == picker["id"]
    assert select["counterparty_id"] == owner["id"]
    assert select["amount_idr"] == 0
    assert select["provisional"] is True
    assert select["href"] == f"#/b/{bill_id}"

    invitee_recap = _recap(invitee)
    accept = _action(invitee_recap, "current_user", "accept_invite", bill_id)
    assert accept["owner"] == "current_user"
    assert accept["invite_id"] == invite["id"]
    assert accept["invited_by"] == owner["id"]
    assert accept["invited_by_name"] == owner["name"]
    assert accept["counterparty_id"] == owner["id"]
    assert accept["href"] == f"#/b/{bill_id}"


def test_action_counterparties_stay_real_across_final_and_open_bills():
    owner = db.new_identity("Owner Mixed Actions", role="creator")
    guest = db.new_identity("Guest Mixed Actions")

    final_bill = _mk_bill(owner, title="Final Mixed", total=70000)
    _join_and_pick(final_bill, guest, _item_ids(final_bill))
    assert c.post(f"/api/bills/{final_bill}/close", headers=_H(owner)).status_code == 200

    open_bill = _mk_bill(owner, title="Open Mixed", total=50000)
    joined = c.post(f"/api/bills/{open_bill}/join", headers=_H(guest))
    assert joined.status_code == 200, joined.text

    owner_recap = _recap(owner)
    waiting = _action(owner_recap, "waiting_other", "wait_selection", open_bill)
    assert waiting["identity_id"] == guest["id"]
    assert waiting["counterparty_id"] == guest["id"]
    assert owner_recap["final"]["counterparties"][0]["identity_id"] == guest["id"]

    guest_recap = _recap(guest)
    pay = _action(guest_recap, "current_user", "pay_share", final_bill)
    select = _action(guest_recap, "current_user", "select_items", open_bill)
    assert pay["counterparty_id"] == owner["id"]
    assert select["counterparty_id"] == owner["id"]


def test_unpaid_final_share_gets_pay_action_and_paid_row_disappears():
    owner = db.new_identity("Owner Paid", role="creator")
    guest = db.new_identity("Guest Paid")
    bill_id = _mk_bill(owner, title="Bayar Share", total=70000)
    _join_and_pick(bill_id, guest, _item_ids(bill_id))
    assert c.post(f"/api/bills/{bill_id}/close", headers=_H(owner)).status_code == 200

    # A closed bill is final allocation; the positive unpaid share remains an
    # explicit pay action so the recap does not hide work still outstanding.
    recap = _recap(guest)
    assert recap["final"]["payable_idr"] == 70000
    pay_action = _action(recap, "current_user", "pay_share", bill_id)
    assert pay_action["amount_idr"] == 70000
    assert pay_action["counterparty_id"] == owner["id"]
    assert pay_action["provisional"] is False

    # Reopen, mark paid, and close again: no final edge remains.
    assert c.post(f"/api/bills/{bill_id}/reopen", headers=_H(owner)).status_code == 200
    paid = c.post(
        f"/api/bills/{bill_id}/payments/{guest['id']}/paid",
        headers=_H(guest),
    )
    assert paid.status_code == 200, paid.text
    assert c.post(f"/api/bills/{bill_id}/close", headers=_H(owner)).status_code == 200
    recap = _recap(owner)
    assert recap["final"]["payable_idr"] == 0
    assert recap["final"]["receivable_idr"] == 0
    assert recap["final"]["counterparties"] == []


def test_name_only_payer_does_not_become_ledger_owner():
    creator = db.new_identity("Creator Name Payer", role="creator")
    named_payer = db.new_identity("Named Payer")
    debtor = db.new_identity("Real Debtor")
    bill_id = _mk_bill(
        creator,
        title="Nama Saja",
        items=[
            {"name": "Payer Share", "price": 50000},
            {"name": "Debtor Share", "price": 50000},
        ],
        subtotal=100000,
        total=100000,
        participants=[creator["name"], named_payer["name"], debtor["name"]],
        paid_by_name=named_payer["name"],
    )
    _join_and_pick(bill_id, named_payer, [_item_ids(bill_id)[0]])
    _join_and_pick(bill_id, debtor, [_item_ids(bill_id)[1]])
    assert c.post(f"/api/bills/{bill_id}/close", headers=_H(creator)).status_code == 200

    recap = _recap(creator)
    assert recap["final"]["receivable_idr"] == 50000
    assert recap["final"]["counterparties"][0]["identity_id"] == debtor["id"]
    assert named_payer["id"] not in {
        counterparty["identity_id"]
        for counterparty in recap["final"]["counterparties"]
    }


def test_confirm_payer_action_counterparty_is_the_payer_identity():
    creator = db.new_identity("Creator Confirm Action", role="creator")
    payer = db.new_identity("Payer Confirm Action")
    bill_id = _mk_bill(creator, title="Confirm Action", paid_by_name=payer["name"])
    _join_and_pick(bill_id, payer, _item_ids(bill_id))

    recap = _recap(creator)
    confirm = _action(recap, "current_user", "confirm_payer", bill_id)
    assert confirm["identity_id"] == payer["id"]
    assert confirm["counterparty_id"] == payer["id"]


def test_accept_invite_action_counterparty_is_actual_inviter():
    owner = db.new_identity("Owner Invite Counterparty", role="creator")
    inviter = db.new_identity("Inviter Invite Counterparty")
    invitee = db.new_identity("Invitee Invite Counterparty")
    bill_id = _mk_bill(owner, title="Invite Counterparty")
    invite = db.create_invite(bill_id, invitee["id"], inviter["id"])

    recap = _recap(invitee)
    accept = _action(recap, "current_user", "accept_invite", bill_id)
    assert accept["invite_id"] == invite["id"]
    assert accept["invited_by"] == inviter["id"]
    assert accept["counterparty_id"] == inviter["id"]


def test_empty_recap_has_stable_zero_shape_and_no_secret():
    identity = db.new_identity("Empty Recap")
    recap = _recap(identity)
    assert recap == {
        "identity": {"id": identity["id"], "name": identity["name"]},
        "final": {
            "payable_idr": 0,
            "receivable_idr": 0,
            "net_idr": 0,
            "counterparties": [],
            "bill_count": 0,
        },
        "provisional": {
            "bill_count": 0,
            "payable_idr": 0,
            "receivable_idr": 0,
            "bills": [],
        },
        "actions": {"current_user": [], "waiting_other": []},
        "counts": {"current_user": 0, "waiting_other": 0, "provisional_bills": 0},
    }
    assert "secret" not in repr(recap)


def test_recap_requires_matching_authenticated_path_identity():
    alice = db.new_identity("Alice Auth", role="creator")
    bob = db.new_identity("Bob Auth")
    response = c.get(
        f"/api/identities/{bob['id']}/recap",
        headers=_H(alice),
    )
    assert response.status_code == 403, response.text

    wrong_secret = _H(alice)
    wrong_secret["X-Identity-Secret"] = "not-the-secret"
    response = c.get(
        f"/api/identities/{alice['id']}/recap",
        headers=wrong_secret,
    )
    assert response.status_code == 403, response.text


def test_stranger_bill_and_invite_data_never_leaks_into_recap():
    alice = db.new_identity("Alice Private", role="creator")
    stranger = db.new_identity("Stranger Private", role="creator")
    alice_bill = _mk_bill(alice, title="Alice Visible", total=30000)
    stranger_bill = _mk_bill(stranger, title="Secret Stranger Bill", total=99000)
    db.add_account(stranger["id"], "Bank Rahasia", "999999")
    recap = _recap(alice)
    encoded = repr(recap)
    assert alice_bill in encoded
    assert stranger_bill not in encoded
    assert "Secret Stranger Bill" not in encoded
    assert stranger["id"] not in encoded
    assert "Bank Rahasia" not in encoded
    assert "999999" not in encoded
    assert "secret" not in encoded.lower()

    # A pending invite is scoped to the recipient, not visible to a stranger.
    invitee = db.new_identity("Invitee Private")
    db.create_invite(stranger_bill, invitee["id"], stranger["id"])
    recap = _recap(alice)
    assert "Invitee Private" not in repr(recap)
    assert all(action["bill_id"] != stranger_bill for action in recap["actions"]["current_user"])
    assert all(action["bill_id"] != stranger_bill for action in recap["actions"]["waiting_other"])
