"""Regression tests for the v67 audit (H1-H6).

These fixes are already implemented and committed; this file is the missing
test coverage for them. One (or a few) test(s) per item, named after the
BEHAVIOUR a user would have seen, not the ticket.

Run:
  cd backend && venv/bin/python -m pytest test_regressions_v67.py -q
"""
import os
import sys
import tempfile
import time
from pathlib import Path

_tmp = Path(tempfile.mkdtemp()) / "test67.db"
os.environ["BAGIIN_DB"] = str(_tmp)
if "BAGIIN_UPLOAD_DIR" not in os.environ:
    os.environ["BAGIIN_UPLOAD_DIR"] = str(Path(tempfile.mkdtemp()) / "uploads")

sys.path.insert(0, str(Path(__file__).resolve().parent))

import db
db.init_db()

from fastapi.testclient import TestClient
import main
from main import app

c = TestClient(app)

# main.py resolves BAGIIN_UPLOAD_DIR at import time; when this file runs as
# part of the full suite some earlier test module has usually already
# imported main and bound UPLOAD_DIR to conftest.py's shared temp dir, so our
# own env var assignment above (a no-op via setdefault in that case) would be
# the wrong path to assert real files against. Always read the path main.py
# actually bound.
_UPLOAD_DIR = main.UPLOAD_DIR


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
    for k in ("paid_by_name", "participants", "tax_included", "photos", "photo_path",
              "merchant", "transacted_at"):
        if k in kw:
            payload[k] = kw[k]
    r = c.post("/api/bills", json=payload, headers=_H(creator))
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _ids(bid):
    data = c.get(f"/api/bills/{bid}").json()
    return {i["name"]: i["id"] for i in data["items"]}


def _upload(who):
    """Real upload via POST /api/photos -> filename, e.g. 'ab12...ef.jpg'."""
    r = c.post("/api/photos", files={"file": ("x.jpg", b"jpeg-bytes", "image/jpeg")},
                headers=_H(who))
    assert r.status_code == 200, r.text
    return r.json()


# ---------- H1: photo paths on POST /api/bills are validated ----------

def test_h1_junk_photo_path_rejected():
    """Before the fix, `photo_path` and `photos` entries were stored verbatim
    -- posting another bill's (or a made-up) file path attached that photo to
    your own bill and had it served to everyone on the share link. A junk
    path must 400, not save."""
    aufa = db.new_identity("Aufa67a", role="creator")
    r = c.post("/api/bills", json={
        "title": "Bill", "items": [{"name": "A", "price": 100000}],
        "subtotal": 100000, "tax": 0, "service": 0, "total": 100000,
        "photo_path": "/tmp/a.jpg",
    }, headers=_H(aufa))
    assert r.status_code == 400, r.text

    r2 = c.post("/api/bills", json={
        "title": "Bill", "items": [{"name": "A", "price": 100000}],
        "subtotal": 100000, "tax": 0, "service": 0, "total": 100000,
        "photos": ["/tmp/a.jpg"],
    }, headers=_H(aufa))
    assert r2.status_code == 400, r2.text


def test_h1_valid_photo_path_is_stored():
    """A path shaped like a real upload (server-generated hex.jpg) is
    accepted and comes back on the bill payload."""
    aufa = db.new_identity("Aufa67b", role="creator")
    up = _upload(aufa)
    bid = _mk_bill(aufa, photo_path=up["photo_path"], photos=[up["filename"]])
    data = c.get(f"/api/bills/{bid}", headers=_H(aufa)).json()
    assert data["bill"].get("photo_path") == up["photo_path"]
    assert data["bill"]["photo_path"].endswith(".jpg")


def test_h1_non_string_photo_path_is_400_not_500():
    """A non-string `photo_path` used to reach Path()/regex code with the
    wrong type -- assert it 400s cleanly instead of 500ing."""
    aufa = db.new_identity("Aufa67c", role="creator")
    r = c.post("/api/bills", json={
        "title": "Bill", "items": [{"name": "A", "price": 100000}],
        "subtotal": 100000, "tax": 0, "service": 0, "total": 100000,
        "photo_path": 12345,
    }, headers=_H(aufa))
    assert r.status_code == 400, r.text


def test_h1_non_string_entry_in_photos_list_is_skipped_not_500():
    """A non-string entry inside the `photos` list is quietly dropped (same
    branch that skips empty strings), never reaching Path()/regex code with
    the wrong type -- so the create call still succeeds (200), just without
    that entry, rather than 500ing."""
    aufa = db.new_identity("Aufa67c2", role="creator")
    up = _upload(aufa)
    r = c.post("/api/bills", json={
        "title": "Bill", "items": [{"name": "A", "price": 100000}],
        "subtotal": 100000, "tax": 0, "service": 0, "total": 100000,
        "photos": [12345, up["filename"]],
    }, headers=_H(aufa))
    assert r.status_code == 200, r.text


# ---------- H2: an unattached upload can be released ----------

def test_h2_unattached_upload_can_be_deleted():
    """Upload via POST /api/photos then release it via DELETE
    /api/photos/{filename} -- the file must actually disappear from disk."""
    aufa = db.new_identity("Aufa67d", role="creator")
    up = _upload(aufa)
    fname = up["filename"]
    on_disk = _UPLOAD_DIR / fname
    assert on_disk.is_file()

    r = c.delete(f"/api/photos/{fname}", headers=_H(aufa))
    assert r.status_code == 200, r.text
    assert r.json()["deleted"] is True
    assert not on_disk.exists()


def test_h2_referenced_upload_delete_is_refused_and_file_survives():
    """A photo a bill still points at can't be yanked out from under it via
    this endpoint -- must 409 and leave the file on disk."""
    aufa = db.new_identity("Aufa67e", role="creator")
    up = _upload(aufa)
    bid = _mk_bill(aufa, photo_path=up["photo_path"])
    on_disk = _UPLOAD_DIR / up["filename"]
    assert on_disk.is_file()

    r = c.delete(f"/api/photos/{up['filename']}", headers=_H(aufa))
    assert r.status_code == 409, r.text
    assert on_disk.is_file(), "referenced file must survive a refused delete"


def test_h2_malformed_filename_refused_without_touching_disk():
    """A filename that doesn't match db._PHOTO_NAME_RE (path traversal shape,
    wrong extension, etc.) must be refused, and never reach the filesystem."""
    aufa = db.new_identity("Aufa67f", role="creator")
    # plant a file adjacent to the upload dir the malformed name might try to
    # reach, to prove a traversal-shaped name can't touch it
    outside = _UPLOAD_DIR.parent / "not-a-photo.txt"
    outside.write_text("still here")
    try:
        for bad in ["../not-a-photo.txt", "not-hex-name.jpg", "abc.jpg", "x.png"]:
            r = c.delete(f"/api/photos/{bad}", headers=_H(aufa))
            assert r.status_code == 404, (bad, r.text)
        assert outside.exists(), "malformed name must never touch the filesystem"
    finally:
        outside.unlink(missing_ok=True)


def test_h2_unauthenticated_delete_is_refused():
    """No X-Identity-Id header -> refused, not a free-for-all delete."""
    aufa = db.new_identity("Aufa67g", role="creator")
    up = _upload(aufa)
    r = c.delete(f"/api/photos/{up['filename']}")
    assert r.status_code in (400, 401, 403), r.text
    assert (_UPLOAD_DIR / up["filename"]).is_file()


# ---------- H3: db.sweep_orphaned_photos ----------

def test_h3_sweep_removes_old_orphan_keeps_young_orphan_and_referenced():
    """Three files in the upload dir: an old orphan (must go), a young orphan
    (must stay -- still mid-create-flow), and an old but referenced file
    (must stay -- a bill points at it). Uses os.utime instead of sleeping."""
    aufa = db.new_identity("Aufa67h", role="creator")
    old_orphan = _upload(aufa)
    young_orphan = _upload(aufa)
    old_referenced = _upload(aufa)
    bid = _mk_bill(aufa, photo_path=old_referenced["photo_path"])
    assert bid  # keep referenced

    old_ts = time.time() - 90000  # > default 86400s cutoff
    os.utime(_UPLOAD_DIR / old_orphan["filename"], (old_ts, old_ts))
    os.utime(_UPLOAD_DIR / old_referenced["filename"], (old_ts, old_ts))
    # young_orphan keeps its fresh mtime from upload

    removed = db.sweep_orphaned_photos(_UPLOAD_DIR)
    assert removed == 1, "exactly the old, unreferenced file should go"
    assert not (_UPLOAD_DIR / old_orphan["filename"]).exists()
    assert (_UPLOAD_DIR / young_orphan["filename"]).exists()
    assert (_UPLOAD_DIR / old_referenced["filename"]).exists()


def test_h3_sweep_returns_count_removed():
    """Return value is the number of files actually removed, across a mix of
    old orphans and non-matching junk that must be left alone."""
    aufa = db.new_identity("Aufa67i", role="creator")
    a = _upload(aufa)
    b = _upload(aufa)
    old_ts = time.time() - 90000
    os.utime(_UPLOAD_DIR / a["filename"], (old_ts, old_ts))
    os.utime(_UPLOAD_DIR / b["filename"], (old_ts, old_ts))
    junk = _UPLOAD_DIR / "not-a-real-upload.jpg"
    junk.write_bytes(b"junk")
    os.utime(junk, (old_ts, old_ts))
    try:
        removed = db.sweep_orphaned_photos(_UPLOAD_DIR)
        assert removed == 2
        assert junk.exists(), "non-matching filename must never be swept"
    finally:
        junk.unlink(missing_ok=True)


# ---------- H4: re-invite after a decline is pending, never instant ----------

def test_h4_first_invite_to_auto_accept_contact_joins_instantly():
    """Baseline: plain path still works -- a first-time invite to a contact
    with auto_accept ON joins them immediately."""
    aufa = db.new_identity("Aufa67j", role="creator")
    rina = db.new_identity("Rina67j")
    shared = _mk_bill(aufa, title="Shared")
    c.post(f"/api/bills/{shared}/join", headers=_H(rina))  # kontak terbukti

    bid = _mk_bill(aufa)
    r = c.post(f"/api/bills/{bid}/invite", json={"identity_id": rina["id"]}, headers=_H(aufa))
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "joined"
    data = c.get(f"/api/bills/{bid}", headers=_H(rina)).json()
    assert any(p["identity_id"] == rina["id"] for p in data["people"])


def test_h4_reinvite_after_decline_is_pending_not_instant_join():
    """auto_accept ON, but the target already said no once via decline. The
    next invite must NOT silently re-join them -- it must come back pending
    and show up in their invites list, requiring a fresh explicit accept.
    Before the fix, `reopened_from_decline` wasn't checked before the
    auto_accept branch, so re-inviting after a decline put them straight back
    on the bill with no further consent."""
    aufa = db.new_identity("Aufa67k", role="creator")
    rina = db.new_identity("Rina67k")
    shared = _mk_bill(aufa, title="Shared")
    c.post(f"/api/bills/{shared}/join", headers=_H(rina))  # kontak terbukti

    # To reach a real 'declined' row (the state this test is about), the
    # invite has to be pending in the first place -- so start with
    # auto_accept OFF, decline it, then flip auto_accept ON and re-invite.
    c.post(f"/api/identities/{rina['id']}/auto_accept", json={"auto_accept": False}, headers=_H(rina))
    bid3 = _mk_bill(aufa, title="Third")
    r3 = c.post(f"/api/bills/{bid3}/invite", json={"identity_id": rina["id"]}, headers=_H(aufa))
    assert r3.status_code == 200, r3.text
    assert r3.json()["status"] == "pending", r3.text
    pending = c.get(f"/api/identities/{rina['id']}/invites", headers=_H(rina)).json()
    inv3 = next(iv for iv in pending if iv["bill_id"] == bid3)
    dec = c.post(f"/api/bills/{bid3}/invites/{inv3['id']}/decline", headers=_H(rina))
    assert dec.status_code == 200, dec.text

    c.post(f"/api/identities/{rina['id']}/auto_accept", json={"auto_accept": True}, headers=_H(rina))
    r4 = c.post(f"/api/bills/{bid3}/invite", json={"identity_id": rina["id"]}, headers=_H(aufa))
    assert r4.status_code == 200, r4.text
    assert r4.json()["status"] == "pending", (
        "a re-invite after a decline must stay pending even with auto_accept "
        "ON -- got %r instead" % r4.json()
    )
    data3 = c.get(f"/api/bills/{bid3}", headers=_H(rina)).json()
    assert not any(p["identity_id"] == rina["id"] for p in data3["people"]), (
        "rina must NOT be on the bill from an unconsented re-invite"
    )
    invites_now = c.get(f"/api/identities/{rina['id']}/invites", headers=_H(rina)).json()
    assert any(iv["bill_id"] == bid3 for iv in invites_now), (
        "the reopened invite must be visible via GET /api/identities/{id}/invites"
    )


# ---------- H5: /uploads/{filename} sends X-Content-Type-Options: nosniff ----------

def test_h5_uploaded_file_response_has_nosniff_header():
    """Serving a real uploaded photo must set X-Content-Type-Options: nosniff
    -- every upload endpoint accepts png/webp too but forces an image/jpeg
    content type, so a browser must not be left to sniff and run mismatched
    bytes as something else."""
    aufa = db.new_identity("Aufa67l", role="creator")
    up = _upload(aufa)
    r = c.get(f"/uploads/{up['filename']}")
    assert r.status_code == 200, r.text
    assert r.headers.get("x-content-type-options") == "nosniff"


# ---------- H6: bill list and bill detail never disagree on `settled` ----------

def test_h6_list_and_detail_settled_agree_across_states():
    """The list endpoint (GET /api/identities/{id}/bills) was refactored to
    load each bill once instead of twice (db._bill_settled now takes the
    already-loaded bill_data via the private `_bill_data` row key). Two
    things must hold for every state below: (1) `_bill_data` never reaches
    the client, and (2) the list's `settled` matches the detail screen's
    `settled` for the same bill. This is the "list and detail disagree" bug
    class that has shipped three times in this codebase."""
    aufa = db.new_identity("Aufa67m", role="creator")
    budi = db.new_identity("Budi67m")

    def _settled_via_list(bid):
        rows = c.get(f"/api/identities/{aufa['id']}/bills", headers=_H(aufa)).json()
        row = next(rw for rw in rows if rw["id"] == bid)
        assert "_bill_data" not in row, "_bill_data must never reach the client"
        return row["settled"]

    def _settled_via_detail(bid):
        return c.get(f"/api/bills/{bid}", headers=_H(aufa)).json()["settled"]

    # 1. fresh bill: nobody picked anything yet
    bid_fresh = _mk_bill(aufa, title="Fresh")
    assert _settled_via_detail(bid_fresh) is False
    assert _settled_via_list(bid_fresh) is False

    # 2. a bill with an unpaid guest
    bid_unpaid = _mk_bill(aufa, title="Unpaid", items=[{"name": "A", "price": 100000}],
                           subtotal=100000, total=100000)
    c.post(f"/api/bills/{bid_unpaid}/join", headers=_H(budi))
    item_id = _ids(bid_unpaid)["A"]
    c.post(f"/api/bills/{bid_unpaid}/selections", headers=_H(budi),
           json={"picks": [{"item_id": item_id, "qty": 1}]})
    assert _settled_via_detail(bid_unpaid) is False
    assert _settled_via_list(bid_unpaid) is False

    # 3. fully paid bill
    bid_paid = _mk_bill(aufa, title="Paid", items=[{"name": "A", "price": 100000}],
                         subtotal=100000, total=100000)
    c.post(f"/api/bills/{bid_paid}/join", headers=_H(budi))
    item_id2 = _ids(bid_paid)["A"]
    c.post(f"/api/bills/{bid_paid}/selections", headers=_H(budi),
           json={"picks": [{"item_id": item_id2, "qty": 1}]})
    c.post(f"/api/bills/{bid_paid}/payments/{budi['id']}/paid", headers=_H(budi))
    assert _settled_via_detail(bid_paid) is True
    assert _settled_via_list(bid_paid) is True

    # 4. a hand-settled solo bill (settled_manual, v60)
    bid_solo = _mk_bill(aufa, title="Solo")
    c.post(f"/api/bills/{bid_solo}/settle", headers=_H(aufa))
    assert _settled_via_detail(bid_solo) is True
    assert _settled_via_list(bid_solo) is True

    # 5. closed bill with an empty slot / unpaid guest -- closing must NOT
    # settle it
    bid_closed = _mk_bill(aufa, title="Closed", items=[{"name": "A", "price": 100000}],
                           subtotal=100000, total=100000)
    c.post(f"/api/bills/{bid_closed}/join", headers=_H(budi))
    item_id3 = _ids(bid_closed)["A"]
    c.post(f"/api/bills/{bid_closed}/selections", headers=_H(budi),
           json={"picks": [{"item_id": item_id3, "qty": 1}]})
    c.post(f"/api/bills/{bid_closed}/close", headers=_H(aufa))
    assert _settled_via_detail(bid_closed) is False
    assert _settled_via_list(bid_closed) is False


if __name__ == "__main__":
    import pytest
    raise SystemExit(pytest.main([__file__, "-q"]))
