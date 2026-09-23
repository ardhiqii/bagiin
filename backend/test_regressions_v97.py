"""Regression coverage for the v97 recap / Home bill-list universe alignment.

The user-visible bug this guards: the same identity saw two different sets of
bills depending on which screen they opened. ``backend/main.py:
_build_identity_recap`` has always unioned ``db.get_pending_invites(viewer_id)``
on top of ``db.get_bills_for_identity(viewer_id)``, so **Rekap Patungan** listed
a bill you had only been *invited* to, while **Home** (``GET /api/identities/
{id}/bills``) -- which read ``get_bills_for_identity`` alone -- did not. An
invite that only one of the two surfaces can see is an invite the invitee may
never find.

The fix keeps ONE universe: ``get_bills_for_identity`` now also selects bills
with a ``pending`` invite targeted at the requested identity, and every
consumer decides what to *do* with such a row from the private ``_is_member``
flag -- never from the row's mere presence. What the tests below pin down:

1. PARITY. The set of bills the list marks ``pending_invite`` equals the set of
   bills the recap emits an ``accept_invite`` action for, and the invited bill
   is a recap provisional entry. Both endpoints read through real HTTP.
2. ISOLATION. The invited bill is invisible to a stranger and to a different
   proven contact -- in the list, in the recap body, and in the raw repr (so a
   nested leak can't hide). No ``secret`` and no ``_``-prefixed private key ever
   reaches either response. A pending invite creates NO payment row: the
   invitee is not a member, ``can_manage`` stays False, and they must not be
   able to edit, delete, settle, or accept someone else's invite.
3. MEMBERSHIP IS THE DIVIDER. A bill the identity is actually on (payment row /
   selection / un-left creator) keeps its old row fields and owner permissions
   exactly; an invite-only row never inherits them. Accepting the invite is what
   converts one into the other.
4. LIVE RECALCULATION. The list row and the recap are computed from the same
   canonical ``get_bill()`` snapshot and ``calc.compute`` math, so a bill edit,
   a pick, a payment, a manual settle and a delete move both surfaces together.
   The list must never re-derive money in SQL.
5. REJECTED WRITES ARE NO-OPS. Every 4xx below asserts the pre-existing list
   AND recap state survived -- a bare status-code assertion would also pass on a
   tree that half-wrote the bill on its way to the 400.

Run:
  cd backend && venv/bin/python -B -m pytest test_regressions_v97.py -q
"""
import os
import sys
import tempfile
from pathlib import Path

_TEST_ROOT = Path(tempfile.mkdtemp(prefix="bagiin-v97-"))
os.environ["BAGIIN_DB"] = str(_TEST_ROOT / "test_v97.db")
# conftest.py owns the session upload sandbox; do not replace it during full-suite collection.
os.environ.setdefault("BAGIIN_UPLOAD_DIR", str(_TEST_ROOT / "uploads"))

sys.path.insert(0, str(Path(__file__).resolve().parent))

import db

db.init_db()

from fastapi.testclient import TestClient
import main

main.limiter.enabled = False
client = TestClient(main.app)

# Fields the Home list is allowed to publish. Anything starting with "_" is a
# private hand-off key between db.py and main.py and must never leave the app.
_PRIVATE_PREFIX = "_"


# ---------- helpers ----------

def _identity(name, creator=False):
    name = f"V97 {name}"
    return db.new_identity(name, role="creator" if creator else "guest")


def _headers(who):
    return {"X-Identity-Id": who["id"], "X-Identity-Secret": who["secret"]}


def _new_bill(creator, *, title="V97 bill", price=50000, quantity=1):
    response = client.post(
        "/api/bills",
        json={
            "title": title,
            "items": [{"name": "Makan", "price": price, "quantity": quantity}],
            "subtotal": price * quantity,
            "tax": 0,
            "service": 0,
            "total": price * quantity,
        },
        headers=_headers(creator),
    )
    assert response.status_code == 200, response.text
    return response.json()["id"]


def _item_ids(bill_id):
    return [item["id"] for item in db.get_bill(bill_id)["items"]]


def _join(bill_id, identity):
    return client.post(f"/api/bills/{bill_id}/join", headers=_headers(identity))


def _pick(bill_id, identity, item_ids):
    return client.post(
        f"/api/bills/{bill_id}/selections",
        headers=_headers(identity),
        json={"picks": [{"item_id": i, "qty": 1} for i in item_ids]},
    )


def _proven_contact(owner, contact):
    """Make `contact` a "kontak terbukti" of `owner` by sharing a bill.

    The invite endpoint refuses strangers by design (v64), so a real pending
    invite can only be produced between identities that have already shared a
    bill. Building that via HTTP keeps the fixture on the same code paths as
    production instead of inserting rows behind the API.
    """
    seed = _new_bill(owner, title="V97 seed")
    assert _join(seed, contact).status_code == 200
    return seed


def _invite(bill_id, owner, target):
    return client.post(
        f"/api/bills/{bill_id}/invite",
        json={"identity_id": target["id"]},
        headers=_headers(owner),
    )


def _list_rows(identity):
    response = client.get(
        f"/api/identities/{identity['id']}/bills", headers=_headers(identity)
    )
    assert response.status_code == 200, response.text
    rows = response.json()
    for row in rows:
        leaked = [key for key in row if key.startswith(_PRIVATE_PREFIX)]
        assert leaked == [], f"private keys reached the client: {leaked}"
    return rows


def _list_row(identity, bill_id):
    rows = [row for row in _list_rows(identity) if row["id"] == bill_id]
    assert len(rows) == 1, rows
    return rows[0]


def _list_ids(identity):
    return {row["id"] for row in _list_rows(identity)}


def _recap(identity):
    response = client.get(
        f"/api/identities/{identity['id']}/recap", headers=_headers(identity)
    )
    assert response.status_code == 200, response.text
    return response.json()


def _recap_accept_invite_bill_ids(recap):
    """The recap-side marker for "this identity can see the bill by invite"."""
    return {
        action["bill_id"]
        for action in recap["actions"]["current_user"]
        if action["kind"] == "accept_invite"
    }


def _recap_provisional_ids(recap):
    return {bill["bill_id"] for bill in recap["provisional"]["bills"]}


def _recap_all_bill_ids(recap):
    """Every bill id the recap exposes on any surface (drilldown, provisional,
    actions) -- used to prove a stranger's bill is nowhere in the payload."""
    ids = set(_recap_provisional_ids(recap))
    ids |= {
        bill["bill_id"]
        for counterparty in recap["final"]["counterparties"]
        for bill in counterparty["bills"]
    }
    ids |= {
        action["bill_id"]
        for section in recap["actions"].values()
        for action in section
    }
    return ids


def _action(recap, section, kind, bill_id):
    matches = [
        action
        for action in recap["actions"][section]
        if action["kind"] == kind and action["bill_id"] == bill_id
    ]
    assert len(matches) == 1, matches
    return matches[0]


def _list_signature(identity, bill_id):
    """The stable, public part of one list row (for before/after comparison)."""
    row = _list_row(identity, bill_id)
    return {
        key: row[key]
        for key in (
            "id", "title", "settled", "all_paid", "owner_id", "can_manage",
            "pending_invite", "pending_invite_id", "pending_invited_by_name",
            "i_am_payer", "my_paid", "my_total_idr", "total_unpaid",
            "uncovered_idr", "has_picks", "pending_names",
        )
    }


def _recap_signature(identity):
    recap = _recap(identity)
    return {
        "final": {
            "payable_idr": recap["final"]["payable_idr"],
            "receivable_idr": recap["final"]["receivable_idr"],
            "net_idr": recap["final"]["net_idr"],
            "bill_count": recap["final"]["bill_count"],
            "counterparties": [
                {
                    "identity_id": counterparty["identity_id"],
                    "net_idr": counterparty["net_idr"],
                    "amount_idr": counterparty["amount_idr"],
                    "direction": counterparty["direction"],
                    "bills": [
                        (bill["bill_id"], bill["amount_idr"], bill["direction"])
                        for bill in counterparty["bills"]
                    ],
                }
                for counterparty in recap["final"]["counterparties"]
            ],
        },
        "provisional": [
            (bill["bill_id"], bill["reason_codes"], bill["estimated_payable_idr"],
             bill["estimated_receivable_idr"])
            for bill in recap["provisional"]["bills"]
        ],
        "actions": {
            section: sorted(
                (action["kind"], action["bill_id"], action.get("identity_id") or "")
                for action in actions
            )
            for section, actions in recap["actions"].items()
        },
        "counts": recap["counts"],
    }


def _payment_rows(bill_id):
    return sorted(
        (p["identity_id"], p["status"]) for p in db.get_bill(bill_id)["payments"]
    )


# ---------- 1. parity: a pending invite is on BOTH surfaces ----------

def test_pending_invite_is_listed_on_home_and_in_the_recap_for_its_target():
    owner = _identity("parity owner", creator=True)
    invitee = _identity("parity invitee")
    _proven_contact(owner, invitee)
    db.set_auto_accept(invitee["id"], 0)

    bill_id = _new_bill(owner, title="V97 undangan parity")
    assert _invite(bill_id, owner, invitee).json() == {"status": "pending"}
    invite = db.get_pending_invites(invitee["id"])[0]

    # --- Home ---
    row = _list_row(invitee, bill_id)
    assert row["pending_invite"] is True, row
    assert row["pending_invite_id"] == invite["id"], row
    assert row["pending_invited_by_name"] == owner["name"], row
    assert row["title"] == "V97 undangan parity"
    assert row["owner_id"] == owner["id"], row
    assert row["can_manage"] is False, row

    # --- Rekap Patungan ---
    recap = _recap(invitee)
    assert bill_id in _recap_provisional_ids(recap), recap["provisional"]
    accept = _action(recap, "current_user", "accept_invite", bill_id)
    assert accept["invite_id"] == invite["id"], accept
    assert accept["invited_by"] == owner["id"], accept
    assert accept["invited_by_name"] == owner["name"], accept

    # The exact parity claim: the bills the list flags as invite-only are
    # exactly the bills the recap offers an accept-invite action for.
    list_invite_ids = {
        row["id"] for row in _list_rows(invitee) if row["pending_invite"]
    }
    assert list_invite_ids == _recap_accept_invite_bill_ids(recap)


def test_a_closed_bill_drops_out_of_both_surfaces_for_the_invitee():
    """`get_pending_invites` only surfaces invites on OPEN bills, so the list
    query must apply the same `b.status = 'open'` guard -- otherwise Home would
    keep advertising an invite the recap (and the accept endpoint) won't honour,
    and the two universes would drift apart again in the other direction."""
    owner = _identity("closed owner", creator=True)
    invitee = _identity("closed invitee")
    _proven_contact(owner, invitee)
    db.set_auto_accept(invitee["id"], 0)

    bill_id = _new_bill(owner, title="V97 undangan ditutup")
    assert _invite(bill_id, owner, invitee).json() == {"status": "pending"}
    assert bill_id in _list_ids(invitee)
    assert bill_id in _recap_accept_invite_bill_ids(_recap(invitee))

    closed = client.post(f"/api/bills/{bill_id}/close", headers=_headers(owner))
    assert closed.status_code == 200, closed.text

    assert bill_id not in _list_ids(invitee)
    invitee_recap = _recap(invitee)
    assert bill_id not in _recap_accept_invite_bill_ids(invitee_recap)
    assert bill_id not in _recap_provisional_ids(invitee_recap)
    # ... while the owner (a real member) still sees their closed bill.
    assert bill_id in _list_ids(owner)


# ---------- 2. isolation ----------

def test_pending_invite_is_invisible_to_strangers_and_other_identities():
    owner = _identity("isolation owner", creator=True)
    invitee = _identity("isolation invitee")
    other_contact = _identity("isolation other contact")
    stranger = _identity("isolation stranger")
    _proven_contact(owner, invitee)
    _proven_contact(owner, other_contact)
    db.set_auto_accept(invitee["id"], 0)
    db.set_auto_accept(other_contact["id"], 0)

    bill_id = _new_bill(owner, title="V97 undangan rahasia")
    assert _invite(bill_id, owner, invitee).json() == {"status": "pending"}

    for outsider in (stranger, other_contact):
        assert bill_id not in _list_ids(outsider), outsider["name"]
        recap = _recap(outsider)
        assert bill_id not in _recap_all_bill_ids(recap), outsider["name"]
        assert "V97 undangan rahasia" not in repr(recap), outsider["name"]
        assert invitee["id"] not in repr(recap), outsider["name"]
        assert "secret" not in repr(recap).lower(), outsider["name"]

    # The invitee's own payload must not leak secrets or private keys either.
    assert "secret" not in repr(_recap(invitee)).lower()
    assert invitee["secret"] not in repr(_list_rows(invitee))
    assert "secret" not in repr(_list_rows(invitee)).lower()


def test_list_and_recap_reject_a_path_id_that_is_not_the_authenticated_identity():
    alice = _identity("auth alice", creator=True)
    bob = _identity("auth bob")
    _proven_contact(alice, bob)
    bill_id = _new_bill(alice, title="V97 auth")
    db.set_auto_accept(bob["id"], 0)
    assert _invite(bill_id, alice, bob).json() == {"status": "pending"}

    for path in (
        f"/api/identities/{alice['id']}/bills",
        f"/api/identities/{alice['id']}/recap",
    ):
        # path id of a DIFFERENT identity, authenticated as bob
        assert client.get(path, headers=_headers(bob)).status_code == 403
        # correct path id, wrong secret
        forged = _headers(alice)
        forged["X-Identity-Secret"] = "not-the-secret"
        assert client.get(
            f"/api/identities/{alice['id']}{path.rsplit(alice['id'], 1)[1]}",
            headers=forged,
        ).status_code == 403
        # no identity headers at all
        assert client.get(path).status_code == 400

    # A 403 must not have leaked any of the target's bills back.
    denied = client.get(
        f"/api/identities/{alice['id']}/bills", headers=_headers(bob)
    )
    assert bill_id not in denied.text


# ---------- 3. an invite is not a membership ----------

def test_a_pending_invite_creates_no_payment_row_and_no_owner_powers():
    owner = _identity("nomember owner", creator=True)
    invitee = _identity("nomember invitee")
    stranger = _identity("nomember stranger")
    _proven_contact(owner, invitee)
    db.set_auto_accept(invitee["id"], 0)

    bill_id = _new_bill(owner, title="V97 bukan member", price=90000)
    assert _payment_rows(bill_id) == []
    detail_before = client.get(
        f"/api/bills/{bill_id}", headers=_headers(owner)
    ).json()

    assert _invite(bill_id, owner, invitee).json() == {"status": "pending"}

    # no membership side effect whatsoever
    assert _payment_rows(bill_id) == []
    detail_after = client.get(f"/api/bills/{bill_id}", headers=_headers(owner)).json()
    assert [p["identity_id"] for p in detail_after["people"]] == [
        p["identity_id"] for p in detail_before["people"]
    ]
    assert detail_after["can_manage"] is True  # the owner still manages
    assert invitee["id"] not in {
        p["identity_id"] for p in detail_after["people"]
    }

    # the invitee's own row: present, but explicitly NOT a member
    row = _list_row(invitee, bill_id)
    assert row["pending_invite"] is True
    assert row["can_manage"] is False
    assert row["i_am_payer"] is False
    assert row["my_paid"] is False
    assert row["my_total_idr"] == 0
    assert row["has_picks"] is False
    assert row["all_paid"] is False
    assert row["settled"] is False
    # the roster-derived fields still describe the REAL bill, not the invitee
    assert row["owner_id"] == owner["id"]

    # the recap classifies it as a pending workflow, never as a member entry.
    # `pending_workflow` must be present (that is what marks the invite); the
    # untouched open bill also carries `open_bill`, which is the same reason a
    # non-invited stranger would see — reason_codes is a contract-ordered list,
    # asserted by membership so a new adjacent reason cannot hide the marker.
    recap = _recap(invitee)
    provisional = next(
        bill for bill in recap["provisional"]["bills"] if bill["bill_id"] == bill_id
    )
    assert "pending_workflow" in provisional["reason_codes"], provisional
    assert provisional["estimated_payable_idr"] == 0
    assert provisional["estimated_receivable_idr"] == 0
    assert recap["final"]["bill_count"] == 0
    assert recap["final"]["counterparties"] == []

    # and the invitee cannot act like a manager on it
    for method, path, body in (
        ("put", f"/api/bills/{bill_id}", {"title": "hijack"}),
        ("delete", f"/api/bills/{bill_id}", None),
        ("post", f"/api/bills/{bill_id}/settle", None),
        ("post", f"/api/bills/{bill_id}/close", None),
    ):
        call = getattr(client, method)
        response = call(path, headers=_headers(invitee)) if body is None else call(
            path, json=body, headers=_headers(invitee)
        )
        assert response.status_code == 403, (method, path, response.text)

    # a stranger cannot accept the invitee's invite either
    invite_id = db.get_pending_invites(invitee["id"])[0]["id"]
    hijack = client.post(
        f"/api/bills/{bill_id}/invites/{invite_id}/accept", headers=_headers(stranger)
    )
    assert hijack.status_code == 404, hijack.text
    assert db.get_pending_invites(invitee["id"]), "invite must still be pending"


def test_accepting_the_invite_is_what_turns_the_row_into_a_membership():
    owner = _identity("accept owner", creator=True)
    invitee = _identity("accept invitee")
    _proven_contact(owner, invitee)
    db.set_auto_accept(invitee["id"], 0)

    bill_id = _new_bill(owner, title="V97 accept", price=60000)
    assert _invite(bill_id, owner, invitee).json() == {"status": "pending"}
    invite_id = db.get_pending_invites(invitee["id"])[0]["id"]

    before = _list_row(invitee, bill_id)
    assert before["pending_invite"] is True and before["can_manage"] is False

    accepted = client.post(
        f"/api/bills/{bill_id}/invites/{invite_id}/accept", headers=_headers(invitee)
    )
    assert accepted.status_code == 200, accepted.text

    after = _list_row(invitee, bill_id)
    assert after["pending_invite"] is False, after
    assert after["pending_invite_id"] is None, after
    assert after["pending_invited_by_name"] is None, after
    assert after["my_paid"] is False  # joined, not paid
    assert after["i_am_payer"] is False
    assert ("%s" % invitee["id"], "unpaid") in _payment_rows(bill_id)

    # the recap no longer offers the accept action; it now judges the bill as
    # a member would (an untouched open bill is provisional for a different
    # reason, and the invite marker must have MOVED off, not just been
    # accompanied by another reason).
    recap = _recap(invitee)
    assert bill_id not in _recap_accept_invite_bill_ids(recap)
    provisional = next(
        bill for bill in recap["provisional"]["bills"] if bill["bill_id"] == bill_id
    )
    assert "pending_workflow" not in provisional["reason_codes"], provisional
    assert "pending_selection" in provisional["reason_codes"], provisional

    # picking items moves it to a real, final receivable for the owner
    assert _pick(bill_id, invitee, _item_ids(bill_id)).status_code == 200
    owner_recap = _recap(owner)
    assert owner_recap["final"]["bill_count"] == 1
    assert owner_recap["final"]["receivable_idr"] == 60000


# ---------- 4. both surfaces recalculate together ----------

def test_ownership_handover_leave_and_invite_keep_list_and_detail_agreeing():
    """The trickiest ownership transition must leave Home and the bill screen
    saying the same thing. Reachable sequence: creator hands the bill to a
    confirmed payer, the creator (now a regular participant) leaves, the new
    owner invites the departed creator back, and the payer is then cleared.

    ``db.set_paid_by`` deliberately undoes ``creator_left`` whenever the bill
    falls back to the creator (db.py — "an owner who isn't in their own bill
    can't happen"), so at the end the creator is a member AND the owner again.
    The list row must therefore agree with the detail payload, and with the
    endpoint ``can_manage`` actually gates (DELETE). This is the invariant the
    v66/v67 "list and detail disagree" bugs kept breaking.
    """
    creator = _identity("edge creator", creator=True)
    payer = _identity("edge payer")
    db.set_auto_accept(payer["id"], 0)
    db.set_auto_accept(creator["id"], 0)
    bill_id = _new_bill(creator, title="V97 edge", price=20000)
    assert _join(bill_id, payer).status_code == 200
    handed = client.put(
        f"/api/bills/{bill_id}/paid_by",
        json={"identity_id": payer["id"]},
        headers=_headers(creator),
    )
    assert handed.status_code == 200, handed.text
    assert handed.json()["owner_id"] == payer["id"]
    # the creator is a regular participant now: not an owner, no owner actions
    assert _list_row(creator, bill_id)["can_manage"] is False

    # the creator leaves the bill entirely
    assert client.post(
        f"/api/bills/{bill_id}/leave", headers=_headers(creator)
    ).status_code == 200
    assert db.get_bill(bill_id)["bill"]["creator_left"] == 1
    assert bill_id not in _list_ids(creator)

    # the new owner invites the departed creator back
    assert _invite(bill_id, payer, creator).json() == {"status": "pending"}
    invited = _list_row(creator, bill_id)
    assert invited["pending_invite"] is True, invited
    assert invited["can_manage"] is False, invited  # still not their bill

    # clearing the payer hands ownership back to the creator, and the bill
    # falls back to them as a member (creator_left is undone on purpose)
    cleared = client.put(
        f"/api/bills/{bill_id}/paid_by",
        json={"name": "Somebody Not On The Bill"},
        headers=_headers(payer),
    )
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["owner_id"] == creator["id"]
    assert db.get_bill(bill_id)["bill"]["creator_left"] == 0

    row = _list_row(creator, bill_id)
    detail = client.get(f"/api/bills/{bill_id}", headers=_headers(creator)).json()
    assert row["owner_id"] == detail["owner_id"], row
    assert row["can_manage"] == detail["can_manage"] is True, row
    assert row["pending_invite"] is False, row
    # and the endpoint the flag gates on agrees
    assert client.delete(
        f"/api/bills/{bill_id}", headers=_headers(creator)
    ).status_code == 200


def test_bill_edit_moves_the_list_row_and_the_recap_together():
    owner = _identity("edit owner", creator=True)
    guest = _identity("edit guest")
    bill_id = _new_bill(owner, title="V97 edit", price=50000)
    assert _join(bill_id, guest).status_code == 200
    item_id = _item_ids(bill_id)[0]
    assert _pick(bill_id, guest, [item_id]).status_code == 200

    row = _list_row(guest, bill_id)
    recap = _recap(guest)
    assert row["my_total_idr"] == 50000, row
    assert recap["final"]["payable_idr"] == 50000, recap["final"]

    updated = client.put(
        f"/api/bills/{bill_id}",
        json={
            "title": "V97 edit",
            "items": [{"name": "Makan", "price": 80000, "id": item_id}],
            "subtotal": 80000,
            "tax": 0,
            "service": 0,
            "total": 80000,
        },
        headers=_headers(owner),
    )
    assert updated.status_code == 200, updated.text

    assert _list_row(guest, bill_id)["my_total_idr"] == 80000
    assert _list_row(owner, bill_id)["my_total_idr"] == 0
    guest_recap = _recap(guest)
    assert guest_recap["final"]["payable_idr"] == 80000, guest_recap["final"]
    assert [
        bill["amount_idr"]
        for counterparty in guest_recap["final"]["counterparties"]
        for bill in counterparty["bills"]
    ] == [80000]
    owner_recap = _recap(owner)
    assert owner_recap["final"]["receivable_idr"] == 80000
    assert _list_row(owner, bill_id)["total_unpaid"] == 80000


def test_selection_payment_and_settle_transitions_reclassify_the_recap():
    owner = _identity("flow owner", creator=True)
    guest = _identity("flow guest")
    bill_id = _new_bill(owner, title="V97 alur", price=70000)
    assert _join(bill_id, guest).status_code == 200

    # 1. joined but not picked: provisional, owner waits on a selection
    assert _list_row(owner, bill_id)["has_picks"] is False
    owner_recap = _recap(owner)
    assert bill_id in _recap_provisional_ids(owner_recap)
    provisional = next(
        b for b in owner_recap["provisional"]["bills"] if b["bill_id"] == bill_id
    )
    assert "pending_selection" in provisional["reason_codes"], provisional
    wait = _action(owner_recap, "waiting_other", "wait_selection", bill_id)
    assert wait["identity_id"] == guest["id"]

    # 2. picked: allocation complete -> final, real edges both ways
    assert _pick(bill_id, guest, _item_ids(bill_id)).status_code == 200
    assert _list_row(owner, bill_id)["has_picks"] is True
    owner_recap = _recap(owner)
    assert bill_id not in _recap_provisional_ids(owner_recap)
    assert owner_recap["final"]["receivable_idr"] == 70000
    assert _action(owner_recap, "waiting_other", "wait_payment", bill_id)[
        "amount_idr"
    ] == 70000
    assert _action(_recap(guest), "current_user", "pay_share", bill_id)[
        "amount_idr"
    ] == 70000

    # 3. paid: settled, every edge and action disappears
    paid = client.post(
        f"/api/bills/{bill_id}/payments/{guest['id']}/paid", headers=_headers(guest)
    )
    assert paid.status_code == 200, paid.text
    assert _list_row(owner, bill_id)["settled"] is True
    assert _list_row(owner, bill_id)["all_paid"] is True
    owner_recap = _recap(owner)
    assert owner_recap["final"]["receivable_idr"] == 0
    assert owner_recap["final"]["payable_idr"] == 0
    assert owner_recap["final"]["counterparties"] == []
    assert all(
        action["bill_id"] != bill_id
        for section in owner_recap["actions"].values()
        for action in section
    )

    # 4. a manual settle is the same story on a bill that can never auto-settle
    solo = _new_bill(owner, title="V97 solo", price=30000)
    assert client.post(f"/api/bills/{solo}/settle", headers=_headers(owner)).status_code == 200
    assert _list_row(owner, solo)["settled"] is True
    assert client.post(f"/api/bills/{solo}/unsettle", headers=_headers(owner)).status_code == 200
    assert _list_row(owner, solo)["settled"] is False


def test_delete_removes_the_bill_from_the_list_and_the_recap():
    owner = _identity("delete owner", creator=True)
    guest = _identity("delete guest")
    invitee = _identity("delete invitee")
    _proven_contact(owner, invitee)
    db.set_auto_accept(invitee["id"], 0)

    bill_id = _new_bill(owner, title="V97 hapus", price=40000)
    assert _join(bill_id, guest).status_code == 200
    assert _pick(bill_id, guest, _item_ids(bill_id)).status_code == 200
    assert _invite(bill_id, owner, invitee).json() == {"status": "pending"}

    for who in (owner, guest, invitee):
        assert bill_id in _list_ids(who), who["name"]
        assert bill_id in _recap_all_bill_ids(_recap(who)), who["name"]

    deleted = client.delete(f"/api/bills/{bill_id}", headers=_headers(owner))
    assert deleted.status_code == 200, deleted.text

    for who in (owner, guest, invitee):
        assert bill_id not in _list_ids(who), who["name"]
        assert bill_id not in _recap_all_bill_ids(_recap(who)), who["name"]
        assert "V97 hapus" not in repr(_recap(who)), who["name"]
    # the invite row went with the bill, so no invite card can outlive it
    assert db.get_pending_invites(invitee["id"]) == []


# ---------- 5. rejected writes leave both surfaces untouched ----------

def test_rejected_writes_preserve_the_preexisting_list_and_recap_state():
    owner = _identity("reject owner", creator=True)
    guest = _identity("reject guest")
    invitee = _identity("reject invitee")
    stranger = _identity("reject stranger")
    _proven_contact(owner, invitee)
    db.set_auto_accept(invitee["id"], 0)

    bill_id = _new_bill(owner, title="V97 tolak", price=25000)
    assert _join(bill_id, guest).status_code == 200
    item_id = _item_ids(bill_id)[0]
    assert _pick(bill_id, guest, [item_id]).status_code == 200
    assert _invite(bill_id, owner, invitee).json() == {"status": "pending"}
    invite_id = db.get_pending_invites(invitee["id"])[0]["id"]

    list_before = {who["id"]: _list_signature(who, bill_id) for who in (owner, guest, invitee)}
    recap_before = {who["id"]: _recap_signature(who) for who in (owner, guest, invitee)}
    payments_before = _payment_rows(bill_id)

    # (a) the invitee is not a manager: edit / delete / settle all 403
    assert client.put(
        f"/api/bills/{bill_id}", json={"title": "hijack"}, headers=_headers(invitee)
    ).status_code == 403
    assert client.delete(
        f"/api/bills/{bill_id}", headers=_headers(invitee)
    ).status_code == 403
    assert client.post(
        f"/api/bills/{bill_id}/settle", headers=_headers(invitee)
    ).status_code == 403

    # (b) a stranger cannot be invited onto the bill (not a proven contact)
    rejected_invite = _invite(bill_id, owner, stranger)
    assert rejected_invite.status_code == 400, rejected_invite.text
    assert (
        rejected_invite.json()["detail"]
        == "Hanya orang yang pernah berbagi bill yang dapat diundang"
    ), rejected_invite.text

    # (c) a non-manager cannot invite either
    assert _invite(bill_id, guest, stranger).status_code == 403

    # (d) the owner cannot persist a bill whose money equation cannot balance
    bad_total = client.put(
        f"/api/bills/{bill_id}",
        json={
            "title": "V97 tolak",
            "items": [{"name": "Makan", "price": 25000, "id": item_id}],
            "subtotal": 25000,
            "tax": 0,
            "service": 0,
            "total": 99999,
        },
        headers=_headers(owner),
    )
    assert bad_total.status_code == 400, bad_total.text

    # (e) a re-invite for an already-pending invite is idempotent: it answers
    # 200 'pending' again (create_invite returns the existing row) but must not
    # mint a second invite row and must not sneak the person onto the bill.
    repeat_invite = _invite(bill_id, owner, invitee)
    assert repeat_invite.status_code == 200, repeat_invite.text
    assert repeat_invite.json() == {"status": "pending"}, repeat_invite.text
    assert len(db.get_invites_for_bill(bill_id)) == 1
    assert not any(
        p["identity_id"] == invitee["id"] for p in db.get_bill(bill_id)["payments"]
    )

    # (f) accepting with the wrong identity is a 404, not a silent join
    assert client.post(
        f"/api/bills/{bill_id}/invites/{invite_id}/accept", headers=_headers(stranger)
    ).status_code == 404

    for who in (owner, guest, invitee):
        assert _list_signature(who, bill_id) == list_before[who["id"]], who["name"]
        assert _recap_signature(who) == recap_before[who["id"]], who["name"]
    assert _payment_rows(bill_id) == payments_before
    assert db.get_pending_invites(invitee["id"]), "the invite survived the rejections"
    assert [r[0] for r in _payment_rows(bill_id)] == [guest["id"]]
