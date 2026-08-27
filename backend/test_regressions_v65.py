"""Regression tests for the v65 audit pass.

Each test here pins a behaviour that was WRONG in v64 and is now fixed. They
are grouped by what the user would have seen.

Run:
  cd backend && venv/bin/python -m pytest test_regressions_v65.py -q
"""
import os
import sys
import tempfile
from pathlib import Path

_tmp = Path(tempfile.mkdtemp()) / "test65.db"
os.environ["BAGIIN_DB"] = str(_tmp)
os.environ.setdefault("BAGIIN_UPLOAD_DIR", str(Path(tempfile.mkdtemp()) / "uploads"))

sys.path.insert(0, str(Path(__file__).resolve().parent))

import db
db.init_db()

from fastapi.testclient import TestClient
from main import app

c = TestClient(app)


def _H(who):
    ident = who if isinstance(who, dict) else db.get_identity(who)
    h = {"X-Identity-Id": ident["id"]}
    if ident.get("secret"):
        h["X-Identity-Secret"] = ident["secret"]
    return h


def _mk_bill(creator, **kw):
    payload = {
        "title": kw.get("title", "Bill"),
        "items": kw.get("items", [{"name": "A", "price": 100000}]),
        "subtotal": kw.get("subtotal", 100000),
        "tax": kw.get("tax", 0),
        "service": kw.get("service", 0),
        "total": kw.get("total", 100000),
    }
    for k in ("paid_by_name", "participants"):
        if k in kw:
            payload[k] = kw[k]
    r = c.post("/api/bills", json=payload, headers=_H(creator))
    assert r.status_code == 200, r.text
    return r.json()["id"]


# ---------- 1. the name path must never hand the bill over ----------

def test_stranger_cannot_take_the_bill_by_matching_the_payer_name():
    """The v51 takeover, re-entered through the v62 name path.

    A bill says "dibayar Budi". Anyone with the share link renames themselves
    to "budi" and joins — that resolves them as the display payer, which is
    fine. What must NOT happen: the manager tapping "Pakai Nama Ini" (which
    sends {name}, and looks like a no-op) confirming them as the sole owner.
    """
    aufa = db.new_identity("Aufa65", role="creator")
    mallory = db.new_identity("Mallory65")
    bid = _mk_bill(aufa, paid_by_name="Budi65")

    c.post(f"/api/identities/{mallory['id']}/name", json={"name": "budi65"}, headers=_H(mallory))
    c.post(f"/api/bills/{bid}/join", headers=_H(mallory))

    r = c.put(f"/api/bills/{bid}/paid_by", json={"name": "Budi65"}, headers=_H(aufa))
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["paid_by_id"] == mallory["id"], "still resolved for display"
    assert data["owner_id"] == aufa["id"], "but the creator still holds the bill"
    assert data["bill"]["paid_by_confirmed"] == 0

    # ...and none of the owner powers came with it
    assert c.delete(f"/api/bills/{bid}", headers=_H(mallory)).status_code == 403
    assert c.post(f"/api/bills/{bid}/close", headers=_H(mallory)).status_code == 403
    assert c.get(f"/api/bills/{bid}", headers=_H(mallory)).json()["can_manage"] is False


def test_explicit_identity_still_hands_the_bill_over():
    """The deliberate path (the v62 confirm banner sends identity_id) is the
    one that transfers ownership — that must keep working."""
    aufa = db.new_identity("Aufa65b", role="creator")
    amel = db.new_identity("Amel65b")
    bid = _mk_bill(aufa)
    c.post(f"/api/bills/{bid}/join", headers=_H(amel))

    r = c.put(f"/api/bills/{bid}/paid_by", json={"identity_id": amel["id"]}, headers=_H(aufa))
    assert r.status_code == 200, r.text
    assert r.json()["owner_id"] == amel["id"]
    assert c.get(f"/api/bills/{bid}", headers=_H(amel)).json()["can_manage"] is True


# ---------- 2. photos belong to their bill ----------

def test_photo_delete_is_scoped_to_the_bill_in_the_url():
    """Photo ids are a global autoincrement and every reader of a bill payload
    sees them, so an unscoped id let anyone delete someone else's photo through
    a bill they legitimately manage."""
    victim = db.new_identity("Victim65", role="creator")
    mallory = db.new_identity("Mallory65b", role="creator")
    vbill = _mk_bill(victim)
    mbill = _mk_bill(mallory)
    photo_id = db.add_bill_photo(vbill, "/tmp/victim65.jpg")

    r = c.delete(f"/api/bills/{mbill}/photos/{photo_id}", headers=_H(mallory))
    assert r.status_code == 404, r.text
    assert [p["id"] for p in db.get_bill(vbill)["photos"]] == [photo_id]

    # the real owner can still delete it
    assert c.delete(f"/api/bills/{vbill}/photos/{photo_id}", headers=_H(victim)).status_code == 200
    assert db.get_bill(vbill)["photos"] == []


def test_deleting_a_bill_never_unlinks_a_photo_another_bill_still_uses():
    """Paths are visible to everyone who can read a bill, so referencing a
    stranger's path and deleting your own bill used to delete their file."""
    updir = Path(os.environ["BAGIIN_UPLOAD_DIR"])
    updir.mkdir(parents=True, exist_ok=True)
    shared = updir / "abcdef0123456789.jpg"
    shared.write_bytes(b"jpeg")

    victim = db.new_identity("Victim65c", role="creator")
    mallory = db.new_identity("Mallory65c", role="creator")
    vbill = _mk_bill(victim)
    db.add_bill_photo(vbill, str(shared))
    mbill = _mk_bill(mallory)
    db.add_bill_photo(mbill, str(shared))

    assert c.delete(f"/api/bills/{mbill}", headers=_H(mallory)).status_code == 200
    assert shared.exists(), "the victim's receipt must survive"

    # once nobody references it, it goes
    assert c.delete(f"/api/bills/{vbill}", headers=_H(victim)).status_code == 200
    assert not shared.exists()


def test_deleted_photo_stays_deleted_across_a_restart():
    """init_db backfills legacy bill.photo_path into bill_photo on every boot,
    so deleting a photo without clearing the legacy column brought it back on
    the next `systemctl restart` — pointing at an unlinked file."""
    aufa = db.new_identity("Aufa65d", role="creator")
    bid = _mk_bill(aufa)
    conn = db.get_db()
    conn.execute("UPDATE bill SET photo_path = ? WHERE id = ?", ("/tmp/legacy65.jpg", bid))
    conn.commit()
    conn.close()
    pid = db.add_bill_photo(bid, "/tmp/legacy65.jpg")

    assert c.delete(f"/api/bills/{bid}/photos/{pid}", headers=_H(aufa)).status_code == 200
    db.init_db()   # = a service restart
    assert db.get_bill(bid)["photos"] == [], "deleted photo came back"


# ---------- 3. invites ----------

def test_declined_invite_can_be_sent_again():
    """A decline is "no thanks", not a permanent ban. create_invite returned
    the declined row, so the owner was told "undangan dikirim" for an invite
    the invitee could never see."""
    aufa = db.new_identity("Aufa65e", role="creator")
    rina = db.new_identity("Rina65e")
    bid = _mk_bill(aufa)
    shared = _mk_bill(aufa, title="Shared")
    c.post(f"/api/bills/{shared}/join", headers=_H(rina))     # kontak terbukti
    c.post(f"/api/identities/{rina['id']}/auto_accept", json={"auto_accept": False}, headers=_H(rina))

    r = c.post(f"/api/bills/{bid}/invite", json={"identity_id": rina["id"]}, headers=_H(aufa))
    assert r.json()["status"] == "pending", r.text
    inv = c.get(f"/api/identities/{rina['id']}/invites", headers=_H(rina)).json()[0]
    assert c.post(f"/api/bills/{bid}/invites/{inv['id']}/decline", headers=_H(rina)).status_code == 200

    r = c.post(f"/api/bills/{bid}/invite", json={"identity_id": rina["id"]}, headers=_H(aufa))
    assert r.json()["status"] == "pending", r.text
    again = c.get(f"/api/identities/{rina['id']}/invites", headers=_H(rina)).json()
    assert any(i["bill_id"] == bid for i in again), "the re-invite must be visible"


def test_contact_check_is_not_capped_at_the_pickers_page_size():
    """get_contacts caps at 50 for the picker; the invite endpoint tested
    membership against that same truncated list, so contact #51 was offered by
    search and then rejected with 'belum pernah share bill'."""
    aufa = db.new_identity("Aufa65f", role="creator")
    older = db.new_identity("Older65")
    old_bill = _mk_bill(aufa, title="Lama")
    c.post(f"/api/bills/{old_bill}/join", headers=_H(older))
    # bury them under more recent shared bills than the picker's page size
    for i in range(52):
        mate = db.new_identity(f"Mate65{i:03d}")
        b = _mk_bill(aufa, title=f"B{i}")
        c.post(f"/api/bills/{b}/join", headers=_H(mate))

    assert all(x["id"] != older["id"] for x in db.get_contacts(aufa["id"])), "past the page"
    assert db.is_contact(aufa["id"], older["id"]) is True

    target = _mk_bill(aufa, title="Undang")
    r = c.post(f"/api/bills/{target}/invite", json={"identity_id": older["id"]}, headers=_H(aufa))
    assert r.status_code == 200, r.text


def test_bill_with_invites_can_be_deleted():
    """bill_invite references bill(id) and foreign_keys is ON, so a bill that
    had ever been invited to could not be deleted at all: IntegrityError -> 500
    (Cloudflare swallows the body) and the failed transaction stayed open, so
    the next writes ANYWHERE failed with "database is locked"."""
    aufa = db.new_identity("Aufa65i", role="creator")
    rina = db.new_identity("Rina65i")
    shared = _mk_bill(aufa, title="Shared")
    c.post(f"/api/bills/{shared}/join", headers=_H(rina))     # kontak terbukti

    for auto_accept in (True, False):
        c.post(f"/api/identities/{rina['id']}/auto_accept",
               json={"auto_accept": auto_accept}, headers=_H(rina))
        bid = _mk_bill(aufa, title=f"Undang {auto_accept}")
        assert c.post(f"/api/bills/{bid}/invite", json={"identity_id": rina["id"]},
                      headers=_H(aufa)).status_code == 200
        assert c.delete(f"/api/bills/{bid}", headers=_H(aufa)).status_code == 200
        # the invite rows go with it, and nothing is left holding the write lock
        assert db.get_bill(bid) is None
        assert c.get(f"/api/identities/{aufa['id']}/bills", headers=_H(aufa)).status_code == 200
        assert c.post(f"/api/bills/{shared}/close", headers=_H(aufa)).status_code == 200
        assert c.post(f"/api/bills/{shared}/reopen", headers=_H(aufa)).status_code == 200


# ---------- 4. bad input is 4xx, never 5xx ----------

def test_malformed_fields_are_400_not_500():
    """Cloudflare replaces 5xx bodies with its own HTML error page, so a 500
    reaches the user as "something went wrong" with no message. Anything a
    client can send has to be rejected as 4xx."""
    aufa = db.new_identity("Aufa65h", role="creator")
    H = _H(aufa)
    base = {"items": [{"name": "A", "price": 1000}], "subtotal": 1000,
            "tax": 0, "service": 0, "total": 1000}

    for field, value in [("title", {"x": 1}), ("merchant", ["a"]),
                         ("transacted_at", {"y": 2}), ("tax_mode", {"z": 3}),
                         ("paid_by_name", ["b"]), ("photo_path", {"p": 1})]:
        r = c.post("/api/bills", json={**base, field: value}, headers=H)
        assert r.status_code == 400, (field, r.status_code, r.text)

    r = c.post("/api/bills", json={**base, "items": [{"name": {"n": 1}, "price": 1000}]}, headers=H)
    assert r.status_code == 400, r.text
    r = c.post("/api/bills", json={**base, "photos": [{"p": 1}]}, headers=H)
    assert r.status_code in (200, 400), r.text   # must not explode in sqlite
    if r.status_code == 200:
        assert db.get_bill(r.json()["id"])["photos"] == []

    bid = _mk_bill(aufa)
    assert c.put(f"/api/bills/{bid}/paid_by", json={"identity_id": {"a": 1}}, headers=H).status_code == 400
    assert c.put(f"/api/bills/{bid}/paid_by", json={"name": ["a"]}, headers=H).status_code == 400
    assert c.post(f"/api/bills/{bid}/invite", json={"identity_id": {"a": 1}}, headers=H).status_code == 400
    assert c.post("/api/identities", json={"name": {"a": 1}}).status_code == 400
    assert c.post(f"/api/identities/{aufa['id']}/name", json={"name": ["a"]}, headers=H).status_code == 400
    assert c.post(f"/api/identities/{aufa['id']}/accounts",
                  json={"brand": {"a": 1}, "account_no": "1"}, headers=H).status_code == 400


# ---------- 5. status agrees between the list and the bill ----------

def test_manually_settled_solo_bill_is_settled_in_the_list_too():
    """"Tandai Lunas" exists for bills that can never auto-settle. The list
    endpoint bailed out on "nobody picked anything" before it ever looked at
    the manual flag, so the bill read Lunas on its own screen and "Belum ada
    yang milih" one screen up."""
    aufa = db.new_identity("Aufa65g", role="creator")
    bid = _mk_bill(aufa)
    assert c.post(f"/api/bills/{bid}/settle", headers=_H(aufa)).status_code == 200

    detail = c.get(f"/api/bills/{bid}", headers=_H(aufa)).json()
    row = next(b for b in c.get(f"/api/identities/{aufa['id']}/bills", headers=_H(aufa)).json()
               if b["id"] == bid)
    assert detail["settled"] is True
    assert row["settled"] is True, "list must agree with the bill screen"
