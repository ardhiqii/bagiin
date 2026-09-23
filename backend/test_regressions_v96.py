"""Regression coverage for the v96 create-verify contact-picker contract.

The user-visible bug was frontend (the React verify screen lost the "Yang
ikut" contact picker), but the picker is only provable if the two backend
endpoints it depends on keep behaving exactly as the legacy client needs:

1. ``GET /api/identities/{id}/contacts`` -- "kontak terbukti". A contact must
   appear when the two identities have shared a bill in EITHER direction:

     (a) the contact created the bill and the caller joined it, and
     (b) the caller created the bill and the contact joined it.

   Direction (a) is the load-bearing one and its mechanism is measured, not
   assumed: the alternative shape ``db.get_contacts`` warns about in its own
   comment -- a ``LEFT JOIN payment`` with
   ``COALESCE(p.identity_id, b.creator_identity_id)`` -- was run against this
   exact fixture and returned an EMPTY contact list, because once the caller
   holds a payment row on the contact's bill the join only ever emits payer
   rows, so the person who CREATED the shared bill vanishes. That is the
   documented one-directional contacts bug ("Budi saw Aufa's bill but not Aufa
   as a contact"): the picker offered nobody. Direction (b) is asserted too,
   because a future change that fixes one direction by breaking the other
   still breaks the picker.

   Note on provenance: ``get_contacts`` has carried its ``UNION ALL`` since the
   revision that introduced it (37f6c2a), so direction (a) does not reproduce a
   committed regression -- it guards the query against regressing to the
   COALESCE shape above, and it is the assertion that discriminates between the
   two shapes on this fixture.

   The endpoint also must never return the caller themselves, must reject a
   caller who cannot authenticate, must reject a path id that is not the
   authenticated id, and a rejection must not leak the contact list.

2. ``POST /api/bills/{bill_id}/invite`` -- how a PICKED proven contact is put
   on a bill. auto_accept ON joins immediately; OFF leaves a pending invite
   row and no payment row; a stranger is refused; a double invite is refused;
   a non-manager is refused. Every rejection asserts the PRE-EXISTING STATE
   SURVIVED (a bare status-code assertion would also pass on a tree that
   wiped the bill on the way to the 400).

3. ``POST /api/bills`` with ``participants: [name]`` must keep creating
   placeholder rows with ``identity_id IS NULL`` and must NOT mint an
   identity. That separation is what keeps the picker honest: a picked
   proven contact goes through ``/invite`` after the bill exists, a
   free-typed name goes through ``participants``.

Every case reads state back through the real HTTP path (``GET /api/bills/{id}``)
plus the raw membership rows the service mutates, never through the response
body alone.

Run:
  cd backend && venv/bin/python -B -m pytest test_regressions_v96.py -q
"""
import os
import sys
import tempfile
from pathlib import Path

_TEST_ROOT = Path(tempfile.mkdtemp(prefix="bagiin-v96-"))
os.environ["BAGIIN_DB"] = str(_TEST_ROOT / "test_v96.db")
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
        "title": "v96 bill",
        "merchant": "Warung v96",
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


def _join(bill_id: str, who: dict):
    return client.post(f"/api/bills/{bill_id}/join", headers=_headers(who))


def _contacts(who: dict, path_id: str | None = None, headers: dict | None = None):
    return client.get(
        f"/api/identities/{path_id or who['id']}/contacts",
        headers=_headers(who) if headers is None else headers,
    )


def _contact_ids(who: dict) -> list:
    response = _contacts(who)
    assert response.status_code == 200, response.text
    return sorted(c["id"] for c in response.json())


def _invite(bill_id: str, who: dict, target: dict):
    return client.post(
        f"/api/bills/{bill_id}/invite",
        headers=_headers(who),
        json={"identity_id": target["id"]},
    )


def _payment_rows(bill_id: str) -> list:
    """Raw payment rows: the membership store /invite and /join mutate."""
    bill_data = db.get_bill(bill_id)
    assert bill_data is not None
    return sorted((p["identity_id"], p["status"]) for p in bill_data["payments"])


def _invite_rows(bill_id: str) -> list:
    """Raw invite rows: (identity_id, status) for the whole bill."""
    return sorted((r["identity_id"], r["status"]) for r in db.get_invites_for_bill(bill_id))


def _roster(bill_id: str, as_viewer: dict) -> list:
    return sorted(p["identity_id"] for p in _detail(bill_id, as_viewer)["people"])


def _set_auto_accept(who: dict, value: bool) -> None:
    """The public toggle: only the identity itself may flip it."""
    response = client.post(
        f"/api/identities/{who['id']}/auto_accept",
        headers=_headers(who),
        json={"auto_accept": value},
    )
    assert response.status_code == 200, response.text


# ---------- 1. contacts: both sharing directions ----------

def test_a_contact_who_created_the_bill_appears_as_a_contact():
    """Direction (a): the contact created the bill, the caller joined it.

    THE discriminating case. The caller's join gives them a payment row on the
    contact's bill, and that is what makes the pre-UNION ``COALESCE`` shape
    stop emitting the creator, so the contact disappears from the picker.
    Asserted by value: run against that shape this test fails, run against
    ``get_contacts`` it passes.
    """
    caller = _identity("V96 caller dirA", creator=True)
    contact = _identity("V96 contact dirA")
    bill_id = _new_bill(contact)
    assert _join(bill_id, caller).status_code == 200
    # the caller really does hold a payment row on the contact's bill
    contact_bill = db.get_bill(bill_id)
    assert contact_bill is not None
    assert any(p["identity_id"] == caller["id"] for p in contact_bill["payments"])

    assert contact["id"] in _contact_ids(caller)


def test_b_a_contact_who_joined_the_callers_bill_appears_as_a_contact():
    """Direction (b): the caller created the bill, the contact joined it.

    The inverse of the case above: here the CONTACT is the payer and the
    caller is the creator, so this direction survived the old query too. Kept
    because a fix that restores one direction by breaking the other would
    still ship a one-directional picker."""
    caller = _identity("V96 caller dirB", creator=True)
    contact = _identity("V96 contact dirB")
    bill_id = _new_bill(caller)
    assert _join(bill_id, contact).status_code == 200

    ids = _contact_ids(caller)
    assert contact["id"] in ids, ids
    # and the same pair is mutual for the invite gate
    assert db.is_contact(caller["id"], contact["id"]) is True


def test_both_directions_together_stay_two_contacts():
    """The UNION ALL must not drop either branch when both exist at once."""
    caller = _identity("V96 caller both", creator=True)
    created_by_contact = _identity("V96 contact made bill")
    joined_by_contact = _identity("V96 contact joined bill")

    theirs = _new_bill(created_by_contact)
    assert _join(theirs, caller).status_code == 200

    mine = _new_bill(caller)
    assert _join(mine, joined_by_contact).status_code == 200

    ids = _contact_ids(caller)
    assert created_by_contact["id"] in ids, ids
    assert joined_by_contact["id"] in ids, ids


def test_contacts_never_include_the_caller_and_are_id_name_objects():
    caller = _identity("V96 caller self", creator=True)
    contact = _identity("V96 contact self")
    bill_id = _new_bill(caller)
    assert _join(bill_id, contact).status_code == 200

    response = _contacts(caller)
    assert response.status_code == 200, response.text
    rows = response.json()
    assert isinstance(rows, list) and rows, response.text
    for row in rows:
        assert {"id", "name"} <= row.keys(), row
    assert caller["id"] not in [r["id"] for r in rows]
    assert "secret" not in response.text


def test_contacts_carry_the_last_shared_timestamp_and_are_searchable():
    caller = _identity("V96 caller search", creator=True)
    contact = _identity("V96 UnikSearch contact")
    bill_id = _new_bill(caller)
    assert _join(bill_id, contact).status_code == 200

    response = _contacts(caller)
    row = next(r for r in response.json() if r["id"] == contact["id"])
    assert row["last_shared"], row

    hit = client.get(
        f"/api/identities/{caller['id']}/contacts",
        params={"q": "UnikSearch"},
        headers=_headers(caller),
    )
    assert hit.status_code == 200, hit.text
    assert [r["id"] for r in hit.json()] == [contact["id"]], hit.text

    miss = client.get(
        f"/api/identities/{caller['id']}/contacts",
        params={"q": "zzz-tidak-ada-96"},
        headers=_headers(caller),
    )
    assert miss.status_code == 200, miss.text
    assert miss.json() == []


# ---------- 2. contacts: auth + path scoping ----------

def test_contacts_reject_unauthenticated_callers_without_leaking_contacts():
    """Probed behaviour, not assumed: no X-Identity-Id -> 400, an unknown id
    -> 404, a wrong/empty secret -> 403. In every case the body carries no
    contact name, so a rejected caller learns nothing about the roster."""
    caller = _identity("V96 caller auth", creator=True)
    contact = _identity("V96 RahasiaKontak contact")
    bill_id = _new_bill(caller)
    assert _join(bill_id, contact).status_code == 200
    assert contact["id"] in _contact_ids(caller)  # the data really is there

    rejections = [
        ({}, 400),
        ({"X-Identity-Id": caller["id"]}, 403),
        ({"X-Identity-Id": caller["id"], "X-Identity-Secret": ""}, 403),
        ({"X-Identity-Id": caller["id"], "X-Identity-Secret": "bukan-secret-96"}, 403),
        ({"X-Identity-Id": "id-tidak-ada-96", "X-Identity-Secret": "x"}, 404),
    ]
    for headers, expected in rejections:
        response = _contacts(caller, headers=headers)
        assert response.status_code == expected, (headers, response.status_code, response.text)
        assert "RahasiaKontak" not in response.text, (headers, response.text)
        assert contact["id"] not in response.text, (headers, response.text)


def test_contacts_path_id_must_match_the_authenticated_identity():
    """The path id is not a credential: asking for someone else's contacts
    with my own valid headers must not hand me their roster."""
    caller = _identity("V96 caller scope", creator=True)
    other = _identity("V96 other scope")
    theirs = _identity("V96 RahasiaOther contact")
    bill_id = _new_bill(other)
    assert _join(bill_id, theirs).status_code == 200

    response = _contacts(caller, path_id=other["id"])
    assert response.status_code == 403, response.text
    assert response.json()["detail"] == "Identitas tidak cocok", response.text
    assert theirs["id"] not in response.text
    assert "RahasiaOther" not in response.text

    # the caller's own contacts still work untouched afterwards
    assert _contacts(caller).status_code == 200
    # and the other identity still sees their own contact
    assert theirs["id"] in _contact_ids(other)


# ---------- 3. invite: the proved contact joins ----------

def test_invite_proven_contact_with_auto_accept_joins_for_real():
    """auto_accept is ON by default. The response alone is not evidence:
    the person must actually be a payment row / roster member afterwards."""
    caller = _identity("V96 caller join", creator=True)
    contact = _identity("V96 contact join")
    seed = _new_bill(caller)
    assert _join(seed, contact).status_code == 200  # proven contact
    assert db.get_identity(contact["id"])["auto_accept"] == 1

    bill_id = _new_bill(caller)
    before = _payment_rows(bill_id)
    assert contact["id"] not in _roster(bill_id, caller)

    response = _invite(bill_id, caller, contact)
    assert response.status_code == 200, response.text
    assert response.json() == {"status": "joined"}, response.text

    after = _payment_rows(bill_id)
    assert (contact["id"], "unpaid") in after, after
    assert after != before
    assert contact["id"] in _roster(bill_id, caller)
    assert [r for r in _invite_rows(bill_id) if r[0] == contact["id"]] == [
        (contact["id"], "accepted")
    ]


# ---------- 4. invite: auto_accept OFF -> pending, no membership ----------

def test_invite_proven_contact_with_auto_accept_off_is_pending_and_not_a_member():
    caller = _identity("V96 caller pending", creator=True)
    contact = _identity("V96 contact pending")
    seed = _new_bill(caller)
    assert _join(seed, contact).status_code == 200  # proven contact
    _set_auto_accept(contact, False)
    assert db.get_identity(contact["id"])["auto_accept"] == 0

    bill_id = _new_bill(caller)
    before_payments = _payment_rows(bill_id)

    response = _invite(bill_id, caller, contact)
    assert response.status_code == 200, response.text
    assert response.json() == {"status": "pending"}, response.text

    # NOT a member yet ...
    assert _payment_rows(bill_id) == before_payments
    assert contact["id"] not in _roster(bill_id, caller)
    # ... but a pending invite row does exist, and the manager can see it
    rows = [r for r in _invite_rows(bill_id) if r[0] == contact["id"]]
    assert rows == [(contact["id"], "pending")], rows
    assert [i["identity_id"] for i in _detail(bill_id, caller)["pending_invites"]] == [
        contact["id"]
    ]


def test_accepting_the_pending_invite_is_what_creates_membership():
    """Complement of the case above: the pending state must be reversible by
    the invitee, otherwise "pending" would just be a lost invite."""
    caller = _identity("V96 caller accept", creator=True)
    contact = _identity("V96 contact accept")
    seed = _new_bill(caller)
    assert _join(seed, contact).status_code == 200
    _set_auto_accept(contact, False)

    bill_id = _new_bill(caller)
    assert _invite(bill_id, caller, contact).json() == {"status": "pending"}
    invite_id = db.get_invites_for_bill(bill_id)[0]["id"]

    accepted = client.post(
        f"/api/bills/{bill_id}/invites/{invite_id}/accept", headers=_headers(contact)
    )
    assert accepted.status_code == 200, accepted.text
    assert (contact["id"], "unpaid") in _payment_rows(bill_id)
    assert contact["id"] in _roster(bill_id, caller)


# ---------- 5. invite: every rejection leaves the bill untouched ----------

def test_invite_stranger_is_rejected_and_the_stranger_stays_off_the_bill():
    caller = _identity("V96 caller stranger", creator=True)
    stranger = _identity("V96 stranger")
    bill_id = _new_bill(caller)
    before_payments = _payment_rows(bill_id)
    before_roster = _roster(bill_id, caller)
    before_invites = _invite_rows(bill_id)

    response = _invite(bill_id, caller, stranger)
    assert response.status_code == 400, response.text
    assert (
        response.json()["detail"]
        == "Hanya orang yang pernah berbagi bill yang dapat diundang"
    ), response.text

    assert _payment_rows(bill_id) == before_payments
    assert _roster(bill_id, caller) == before_roster
    assert _invite_rows(bill_id) == before_invites
    assert stranger["id"] not in _roster(bill_id, caller)


def test_inviting_the_same_person_twice_is_rejected_and_adds_no_duplicate_row():
    caller = _identity("V96 caller twice", creator=True)
    contact = _identity("V96 contact twice")
    seed = _new_bill(caller)
    assert _join(seed, contact).status_code == 200

    bill_id = _new_bill(caller)
    first = _invite(bill_id, caller, contact)
    assert first.status_code == 200, first.text
    assert first.json() == {"status": "joined"}, first.text
    before_payments = _payment_rows(bill_id)
    before_roster = _roster(bill_id, caller)
    assert before_payments.count((contact["id"], "unpaid")) == 1

    second = _invite(bill_id, caller, contact)
    assert second.status_code == 400, second.text
    assert second.json()["detail"] == "Orang ini sudah ada di bill", second.text

    assert _payment_rows(bill_id) == before_payments
    assert _roster(bill_id, caller) == before_roster
    assert _payment_rows(bill_id).count((contact["id"], "unpaid")) == 1
    assert len([r for r in _invite_rows(bill_id) if r[0] == contact["id"]]) == 1


def test_invite_from_a_non_manager_is_403_and_changes_nothing():
    """Only the manager (confirmed payer, else creator) may invite. A plain
    member holding the share link must not be able to grow a bill."""
    caller = _identity("V96 caller nonmgr", creator=True)
    member = _identity("V96 member nonmgr")
    contact = _identity("V96 contact nonmgr")
    seed = _new_bill(caller)
    assert _join(seed, contact).status_code == 200  # contact is proven for caller
    bill_id = _new_bill(caller)
    assert _join(bill_id, member).status_code == 200

    before_payments = _payment_rows(bill_id)
    before_roster = _roster(bill_id, caller)
    before_invites = _invite_rows(bill_id)

    response = _invite(bill_id, member, contact)
    assert response.status_code == 403, response.text
    assert response.json()["detail"] == "Hanya owner bill (yang bayar)", response.text

    assert _payment_rows(bill_id) == before_payments
    assert _roster(bill_id, caller) == before_roster
    assert _invite_rows(bill_id) == before_invites
    assert contact["id"] not in _roster(bill_id, caller)
    # the manager can still invite afterwards (the 403 did not poison the bill)
    assert _invite(bill_id, caller, contact).status_code == 200


# ---------- 6. create with `participants` stays placeholders ----------

def test_create_bill_participants_create_placeholder_rows_and_no_identity():
    """The separation the picker relies on: a free-typed name is a placeholder
    (identity_id IS NULL), never a new identity. A picked proven contact must
    therefore go through /invite instead."""
    caller = _identity("V96 caller tempat", creator=True)
    conn = db.get_db()
    identities_before = conn.execute("SELECT COUNT(*) FROM identity").fetchone()[0]
    conn.close()

    free_names = ["Tamu Bebas 96", "Tamu Bebas 96b"]
    bill_id = _new_bill(caller, participants=free_names)

    conn = db.get_db()
    identities_after = conn.execute("SELECT COUNT(*) FROM identity").fetchone()[0]
    conn.close()
    assert identities_after == identities_before

    payload = _detail(bill_id, caller)
    assert [p["name"] for p in payload["participants"]] == free_names
    assert all(p["identity_id"] is None for p in payload["participants"])

    # placeholders are NOT members: no payment row, no invite row
    assert _payment_rows(bill_id) == []
    assert _invite_rows(bill_id) == []
    assert _roster(bill_id, caller) == [caller["id"]]

    # and db.get_bill agrees (the raw store, not just the computed payload)
    raw = db.get_bill(bill_id)
    assert [p["name"] for p in raw["participants"]] == free_names
    assert all(p["identity_id"] is None for p in raw["participants"])


def test_a_picked_contact_does_not_become_a_placeholder():
    """Same bill body, but the picked contact goes through /invite: the
    participants array stays empty and the contact is a real identity row."""
    caller = _identity("V96 caller picked", creator=True)
    contact = _identity("V96 contact picked")
    seed = _new_bill(caller)
    assert _join(seed, contact).status_code == 200

    bill_id = _new_bill(caller, participants=[])
    assert _invite(bill_id, caller, contact).json() == {"status": "joined"}

    payload = _detail(bill_id, caller)
    assert payload["participants"] == []
    assert contact["id"] in _roster(bill_id, caller)
    assert contact["id"] not in [p["identity_id"] for p in payload["participants"]]
