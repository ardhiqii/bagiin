"""Regression tests for v61: multi-photo receipts.

Before: bill.photo_path held a SINGLE photo; uploading replaced it. Now a
bill_photo table holds many, the legacy column is migrated into it (and kept
untouched), and create_bill folds photo_path + photos together.

Covered:
- create with photos list -> all attached in order
- legacy create with photo_path -> folded into bill_photo
- upload_photo adds (does NOT replace) -> two photos on one bill
- delete_photo removes one + unlinks the file
- migration converts existing bill.photo_path into a bill_photo row
- non-owner cannot add/delete -> 403
- deleting the bill removes all photos

Run:
  cd backend && venv/bin/python -m pytest test_regressions_v61.py -q
"""
import os
import secrets
import sys
import tempfile
from pathlib import Path

_tmp = Path(tempfile.mkdtemp()) / "test61.db"
os.environ["BAGIIN_DB"] = str(_tmp)
os.environ["BAGIIN_UPLOAD_DIR"] = str(Path(tempfile.mkdtemp()) / "uploads")

sys.path.insert(0, str(Path(__file__).resolve().parent))

import db
db.init_db()

from fastapi.testclient import TestClient
from main import app

c = TestClient(app, raise_server_exceptions=False)


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
    for k in ("photos", "photo_path"):
        if k in kw:
            payload[k] = kw[k]
    r = c.post("/api/bills", json=payload, headers=_H(creator))
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _photos(bid):
    return [p["path"] for p in db.get_bill(bid)["photos"]]


def _fake_photo():
    """An upload-shaped path (v67: create_bill now 400s on anything whose
    basename doesn't match db._PHOTO_NAME_RE, since a bare string used to be
    accepted verbatim — including another bill's real photo path). This
    stands in for a path a client would legitimately hand back from a prior
    /api/photos or /api/ocr call, without actually writing the file."""
    return str(Path(os.environ["BAGIIN_UPLOAD_DIR"]) / (secrets.token_hex(8) + ".jpg"))


def _upload(bid, ident, data=b"jpg-bytes"):
    return c.post(
        f"/api/bills/{bid}/photo",
        files={"file": ("f.jpg", data, "image/jpeg")},
        headers=_H(ident),
    )


def test_create_with_photos_list():
    """photos[] attaches every path, in order."""
    aufa = db.new_identity("Aufa61", role="creator")
    p1, p2 = _fake_photo(), _fake_photo()
    bid = _mk_bill(aufa, photos=[p1, p2])
    assert _photos(bid) == [p1, p2]


def test_legacy_photo_path_folds_in():
    """create_bill(photo_path=...) still lands in bill_photo (OCR path)."""
    aufa = db.new_identity("Aufa61b", role="creator")
    p = _fake_photo()
    bid = _mk_bill(aufa, photo_path=p)
    assert _photos(bid) == [p]
    # the legacy column still holds the value (kept, not dropped)
    row = db.get_bill(bid)
    assert row["bill"]["photo_path"] == p


def test_upload_adds_not_replaces():
    """POST /photo now ADDS — a second upload keeps both photos."""
    aufa = db.new_identity("Aufa61c", role="creator")
    p = _fake_photo()
    bid = _mk_bill(aufa, photos=[p])
    r = _upload(bid, aufa)
    assert r.status_code == 200, r.text
    assert len(_photos(bid)) == 2, _photos(bid)
    assert p in _photos(bid)


def test_delete_photo_removes_and_unlinks():
    """DELETE /photos/{id} removes the row AND unlinks the file."""
    aufa = db.new_identity("Aufa61d", role="creator")
    bid = _mk_bill(aufa)
    r = _upload(bid, aufa)
    assert r.status_code == 200, r.text
    photos = db.get_bill(bid)["photos"]
    assert len(photos) == 1
    pid = photos[0]["id"]
    path = photos[0]["path"]
    assert Path(path).exists()

    r = c.delete(f"/api/bills/{bid}/photos/{pid}", headers=_H(aufa))
    assert r.status_code == 200, r.text
    assert _photos(bid) == []
    assert not Path(path).exists(), "file must be unlinked"


def test_migration_converts_legacy_photo():
    """A bill whose photo_path predates v61 gets a bill_photo row."""
    # simulate a legacy bill: insert photo_path directly, no bill_photo row
    aufa = db.new_identity("Aufa61e", role="creator")
    conn = db.get_db()
    conn.execute(
        """INSERT INTO bill (id, creator_identity_id, title, photo_path, subtotal_idr, tax_idr, service_idr, total_idr)
           VALUES ('legacy61', ?, 'Lama', '/tmp/old.jpg', 0, 0, 0, 0)""",
        (aufa["id"],),
    )
    conn.commit()
    conn.close()
    db.init_db()  # runs the migration
    assert _photos("legacy61") == ["/tmp/old.jpg"]
    row = db.get_bill("legacy61")
    assert row["bill"]["photo_path"] == "/tmp/old.jpg", "legacy column kept"


def test_non_owner_cannot_add_or_delete():
    """Guest cannot attach or remove photos -> 403."""
    aufa = db.new_identity("Aufa61f", role="creator")
    amel = db.new_identity("Amel61f")
    bid = _mk_bill(aufa)
    c.post(f"/api/bills/{bid}/join", headers=_H(amel))
    assert _upload(bid, amel).status_code == 403
    assert c.delete(f"/api/bills/{bid}/photos/1", headers=_H(amel)).status_code == 403


def test_delete_bill_removes_all_photos():
    """Deleting the bill deletes every photo row + file."""
    aufa = db.new_identity("Aufa61g", role="creator")
    bid = _mk_bill(aufa)
    r1 = _upload(bid, aufa, b"one")
    r2 = _upload(bid, aufa, b"two")
    assert r1.status_code == 200 and r2.status_code == 200
    paths = [p["path"] for p in db.get_bill(bid)["photos"]]
    assert len(paths) == 2
    assert all(Path(p).exists() for p in paths)

    assert c.delete(f"/api/bills/{bid}", headers=_H(aufa)).status_code == 200
    assert all(not Path(p).exists() for p in paths), "all photo files unlinked"


def test_standalone_photo_upload():
    """POST /api/photos saves a file without scanning (manual attach flow)."""
    aufa = db.new_identity("Aufa61h", role="creator")
    r = c.post(
        "/api/photos",
        files={"file": ("f.jpg", b"raw", "image/jpeg")},
        headers=_H(aufa),
    )
    assert r.status_code == 200, r.text
    p = r.json()["photo_path"]
    assert Path(p).exists()
    Path(p).unlink(missing_ok=True)


if __name__ == "__main__":
    test_create_with_photos_list()
    test_legacy_photo_path_folds_in()
    test_upload_adds_not_replaces()
    test_delete_photo_removes_and_unlinks()
    test_migration_converts_legacy_photo()
    test_non_owner_cannot_add_or_delete()
    test_delete_bill_removes_all_photos()
    test_standalone_photo_upload()
    print("PASS multi-photo tests")
