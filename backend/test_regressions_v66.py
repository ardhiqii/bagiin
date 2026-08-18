"""Regression tests for the v66 backend audit (A1-A11).

Eleven bugs reproduced against a running server, each fixed with a minimal
change and a `(bug: ...)` comment at the fix site. One test per item here.

Run:
  cd backend && venv/bin/python -m pytest test_regressions_v66.py -q
"""
import os
import sys
import tempfile
from pathlib import Path

_tmp = Path(tempfile.mkdtemp()) / "test66.db"
os.environ["BAGIIN_DB"] = str(_tmp)
os.environ["BAGIIN_UPLOAD_DIR"] = str(Path(tempfile.mkdtemp()) / "uploads")

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
    for k in ("paid_by_name", "participants", "tax_included", "photos", "photo_path",
              "merchant", "transacted_at"):
        if k in kw:
            payload[k] = kw[k]
    r = c.post("/api/bills", json=payload, headers=_H(creator))
    assert r.status_code == 200, r.text
    return r.json()["id"]


# ---------- A1: creator who left can be invited back ----------

def test_a1_creator_can_be_reinvited_after_leaving():
    """Creator hands the payer role over, leaves, then the new owner tries to
    invite them back through the normal /invite flow. Before the fix,
    identity_on_bill counted the creator unconditionally, so this always
    answered 400 "Orang ini udah di bill" even though they were out of the
    roster and out of their own history -- un-re-invitable except by raw link."""
    alice = db.new_identity("Alice66a", role="creator")
    amel = db.new_identity("Amel66a")
    bid = _mk_bill(alice)
    c.post(f"/api/bills/{bid}/join", headers=_H(amel))
    c.put(f"/api/bills/{bid}/paid_by", json={"identity_id": amel["id"]}, headers=_H(alice))
    assert c.post(f"/api/bills/{bid}/leave", headers=_H(alice)).status_code == 200
    assert db.identity_on_bill(bid, alice["id"]) is False

    r = c.post(f"/api/bills/{bid}/invite", json={"identity_id": alice["id"]}, headers=_H(amel))
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "joined"
    data = c.get(f"/api/bills/{bid}", headers=_H(alice)).json()
    assert any(p["identity_id"] == alice["id"] for p in data["people"]), "alice must be back"


# ---------- A2: GET /uploads/{filename} 500s where it must 404 ----------

def test_a2_uploads_directory_is_404_not_500():
    """`path.exists()` is true for a directory too, and FileResponse raises
    RuntimeError on one -> 500. `/uploads/%2e%2e` decodes to `..`, which
    resolves to UPLOAD_DIR itself -- a live example of the same class of bug,
    reproduced here with an ordinary subdirectory."""
    updir = Path(os.environ["BAGIIN_UPLOAD_DIR"])
    (updir / "a66dir").mkdir(parents=True, exist_ok=True)
    r = c.get("/uploads/a66dir")
    assert r.status_code == 404, r.text


# ---------- A3: photo endpoints accept any bytes ----------

def test_a3_photo_endpoints_reject_non_image_content_type():
    """`/api/ocr` already rejects `image/heic`; the two upload endpoints
    checked size only. A HEIC (or a text file) used to sail through as 200,
    get stored as `<hex>.jpg` with a bill_photo row, and the uploader got a
    success toast plus a broken thumbnail."""
    aufa = db.new_identity("Aufa66c", role="creator")
    bid = _mk_bill(aufa)
    r = c.post(f"/api/bills/{bid}/photo",
               files={"file": ("x.heic", b"whatever", "image/heic")}, headers=_H(aufa))
    assert r.status_code == 400, r.text
    r2 = c.post("/api/photos",
                files={"file": ("x.txt", b"not a photo", "text/plain")}, headers=_H(aufa))
    assert r2.status_code == 400, r2.text
    # a real jpeg still works
    r3 = c.post(f"/api/bills/{bid}/photo",
               files={"file": ("x.jpg", b"jpeg-bytes", "image/jpeg")}, headers=_H(aufa))
    assert r3.status_code == 200, r3.text


# ---------- A4: photos on POST /api/bills is unbounded ----------

def test_a4_create_bill_photos_list_is_capped():
    """An unbounded photos[] list let one bad-faith create post e.g. 2000
    rows -> every viewer of the share link downloads a 2000-entry payload and
    renders 2000 <img> tags. Capped at 10.

    NOT enforced here: requiring each entry's basename to match
    db._PHOTO_NAME_RE (also asked for in the work order). That regex is
    `^[0-9a-f]{16}\\.jpg$` -- the shape of a path THIS server generates via
    secrets.token_hex(8). test_regressions_v61.py pins arbitrary
    caller-supplied paths through this same endpoint on purpose
    (test_create_with_photos_list posts photos=["/tmp/a.jpg", "/tmp/b.jpg"]
    and asserts they're stored verbatim). Enforcing the regex would 400 that
    pinned test, so per the work order ("if you cannot satisfy both, stop and
    report") only the cap is implemented -- see the final report.
    """
    aufa = db.new_identity("Aufa66d", role="creator")
    many = [f"/tmp/v66-{i}.jpg" for i in range(50)]
    bid = _mk_bill(aufa, photos=many)
    assert len(db.get_bill(bid)["photos"]) == 10


# ---------- A5: my_bills grants can_manage to an unconfirmed payer ----------

def test_a5_my_bills_fallback_respects_paid_by_confirmed():
    """The `db.get_bill() -> None` defensive branch in my_bills derived
    can_manage from paid_by_identity_id alone, without paid_by_confirmed --
    a payer resolved only by matching paid_by_name (display-only, per
    CLAUDE.md) got management powers here even though the real _owner_id
    path never grants them that. Forces the branch by monkeypatching
    db.get_bill to return None for this one bill, same as the defensive
    comment describes ("bill row exists but get_bill failed")."""
    alice = db.new_identity("Alice66e", role="creator")
    amel = db.new_identity("Amel66e")
    bid = _mk_bill(alice, paid_by_name="Amel66e")
    # amel joins under the matching name -> claim_participant links her as
    # paid_by_identity_id, but paid_by_confirmed stays 0 (name match only)
    c.post(f"/api/bills/{bid}/join", headers=_H(amel))
    live = db.get_bill(bid)
    assert live["bill"]["paid_by_identity_id"] == amel["id"]
    assert not live["bill"]["paid_by_confirmed"]

    orig_get_bill = db.get_bill
    def _patched(bill_id):
        return None if bill_id == bid else orig_get_bill(bill_id)
    db.get_bill = _patched
    try:
        rows = c.get(f"/api/identities/{amel['id']}/bills", headers=_H(amel)).json()
    finally:
        db.get_bill = orig_get_bill
    row = next(r for r in rows if r["id"] == bid)
    assert row["owner_id"] == alice["id"], row
    assert row["can_manage"] is False, row


# ---------- A6: PUT /api/bills/{id} nulls merchant/transacted_at ----------

def test_a6_update_bill_absent_merchant_and_date_stay_unchanged():
    """Absent keys became NULL, unlike participants/participant_count which
    use the UNCHANGED sentinel. transacted_at now drives history's ordering
    and its year/month filter, so a partial-update client quietly moved a
    bill to another month. An explicit null/"" must still clear the field."""
    alice = db.new_identity("Alice66f", role="creator")
    bid = _mk_bill(alice, merchant="Warung Bu Tuti", transacted_at="2026-08-01")

    r = c.put(f"/api/bills/{bid}", json={
        "title": "Bill Edited", "items": [{"name": "A", "price": 100000}],
        "subtotal": 100000, "tax": 0, "service": 0, "total": 100000,
    }, headers=_H(alice))
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["bill"]["merchant"] == "Warung Bu Tuti", data["bill"]
    assert data["bill"]["transacted_at"] == "2026-08-01", data["bill"]

    r2 = c.put(f"/api/bills/{bid}", json={
        "title": "Bill Edited", "merchant": None, "transacted_at": None,
        "items": [{"name": "A", "price": 100000}],
        "subtotal": 100000, "tax": 0, "service": 0, "total": 100000,
    }, headers=_H(alice))
    assert r2.status_code == 200, r2.text
    data2 = r2.json()
    assert data2["bill"]["merchant"] is None, data2["bill"]
    assert data2["bill"]["transacted_at"] is None, data2["bill"]


# ---------- A7: anyone can insert themselves via /paid ----------

def test_a7_mark_paid_requires_membership_first():
    """/paid checked "is this me" but never "am I on this bill" -- a
    stranger holding the share link could call it with their own id and
    self-insert into the roster without ever calling /join (db.mark_paid's
    INSERT OR IGNORE creates the payment row on its own). The legitimate
    flow (join, then the pay sheet marks paid) must keep working."""
    alice = db.new_identity("Alice66g", role="creator")
    mallory = db.new_identity("Mallory66g")
    bid = _mk_bill(alice)

    r = c.post(f"/api/bills/{bid}/payments/{mallory['id']}/paid", headers=_H(mallory))
    assert r.status_code == 404, r.text
    still = c.get(f"/api/bills/{bid}", headers=_H(alice)).json()
    assert all(p["identity_id"] != mallory["id"] for p in still["people"]), "no self-insert"

    assert c.post(f"/api/bills/{bid}/join", headers=_H(mallory)).status_code == 200
    r2 = c.post(f"/api/bills/{bid}/payments/{mallory['id']}/paid", headers=_H(mallory))
    assert r2.status_code == 200, r2.text


# ---------- A8: pending invite invisible/uncancellable to its sender ----------

def test_a8_pending_invite_visible_and_cancellable_by_manager_only():
    """get_invites_for_bill existed but nothing surfaced it, and there was no
    cancel endpoint -- inviting the wrong contact (auto_accept OFF) had no
    recourse, and the sender was offered "Undang" again with no hint one was
    already outstanding."""
    aufa = db.new_identity("Aufa66h", role="creator")
    rina = db.new_identity("Rina66h")
    stranger = db.new_identity("Stranger66h")
    shared = _mk_bill(aufa, title="Shared")
    c.post(f"/api/bills/{shared}/join", headers=_H(rina))  # kontak terbukti
    c.post(f"/api/identities/{rina['id']}/auto_accept", json={"auto_accept": False}, headers=_H(rina))

    bid = _mk_bill(aufa)
    r = c.post(f"/api/bills/{bid}/invite", json={"identity_id": rina["id"]}, headers=_H(aufa))
    assert r.json()["status"] == "pending", r.text

    data = c.get(f"/api/bills/{bid}", headers=_H(aufa)).json()
    assert any(iv["identity_id"] == rina["id"] for iv in data["pending_invites"]), data.get("pending_invites")
    invite_id = data["pending_invites"][0]["id"]

    # never surfaced to every holder of the share link
    assert c.get(f"/api/bills/{bid}", headers=_H(rina)).json()["pending_invites"] == []
    assert c.get(f"/api/bills/{bid}", headers=_H(stranger)).json()["pending_invites"] == []

    # only the manager can cancel it
    assert c.delete(f"/api/bills/{bid}/invites/{invite_id}", headers=_H(rina)).status_code == 403
    r2 = c.delete(f"/api/bills/{bid}/invites/{invite_id}", headers=_H(aufa))
    assert r2.status_code == 200, r2.text
    assert r2.json()["pending_invites"] == []
    assert not any(i["bill_id"] == bid for i in
                   c.get(f"/api/identities/{rina['id']}/invites", headers=_H(rina)).json())


# ---------- A9: a non-object JSON body 500s ----------

def test_a9_non_object_body_is_400_not_500():
    """POST /api/bills with `[]` (or a bare number) reaches `data.get` on a
    non-dict -> AttributeError -> 500."""
    aufa = db.new_identity("Aufa66i", role="creator")
    r = c.post("/api/bills", json=[], headers=_H(aufa))
    assert r.status_code == 400, r.text
    r2 = c.post("/api/bills", json=123, headers=_H(aufa))
    assert r2.status_code == 400, r2.text


# ---------- A10: a 20-digit price 500s ----------

def test_a10_huge_price_is_400_not_500():
    """Money `_to_int` calls had minv=0 but no maxv, so `1e20`-scale input
    reached sqlite3 and raised `OverflowError: Python int too large`."""
    aufa = db.new_identity("Aufa66j", role="creator")
    huge = 10**20
    r = c.post("/api/bills", json={
        "title": "Bill", "items": [{"name": "A", "price": huge}],
        "subtotal": huge, "tax": 0, "service": 0, "total": huge,
    }, headers=_H(aufa))
    assert r.status_code == 400, r.text

    bid = _mk_bill(aufa)
    r2 = c.put(f"/api/bills/{bid}", json={
        "title": "Bill", "items": [{"name": "A", "price": huge}],
        "subtotal": huge, "tax": 0, "service": 0, "total": huge,
    }, headers=_H(aufa))
    assert r2.status_code == 400, r2.text


# ---------- A11: photos can be added/deleted on a closed bill ----------

def test_a11_photo_endpoints_blocked_once_bill_closed():
    """Both photo endpoints gated on _can_manage only, while the UI hides
    both controls once the bill is closed -- a photo attached to a bill that
    later closes could never be removed through the app."""
    aufa = db.new_identity("Aufa66k", role="creator")
    bid = _mk_bill(aufa)
    pid = db.add_bill_photo(bid, "/tmp/v66-before-close.jpg")
    assert c.post(f"/api/bills/{bid}/close", headers=_H(aufa)).status_code == 200

    r = c.post(f"/api/bills/{bid}/photo",
               files={"file": ("x.jpg", b"data", "image/jpeg")}, headers=_H(aufa))
    assert r.status_code == 403, r.text
    r2 = c.delete(f"/api/bills/{bid}/photos/{pid}", headers=_H(aufa))
    assert r2.status_code == 403, r2.text
    assert [p["id"] for p in db.get_bill(bid)["photos"]] == [pid], "photo must survive"


# ---------- A12: POST /api/identities/restore 500s on non-string code ----------

def test_a12_restore_identity_rejects_non_string_code():
    """Unauthenticated endpoint (no identity, no secret needed at all) --
    `(data.get("code") or "").strip()` raised AttributeError -> 500 on a
    non-string code (list/dict), reachable by anyone."""
    r = c.post("/api/identities/restore", json={"code": [1, 2, 3]})
    assert r.status_code == 400, r.text
    r2 = c.post("/api/identities/restore", json={"code": {"x": 1}})
    assert r2.status_code == 400, r2.text
    # an ordinary miss still 404s cleanly
    r3 = c.post("/api/identities/restore", json={"code": "NOPE-0000-0000"})
    assert r3.status_code == 404, r3.text


# ---------- A13: POST /api/identities/{id}/code 500s on non-string code ----------

def test_a13_set_code_rejects_non_string_code():
    """Identical `.strip()`-on-a-list crash as restore_identity, self-
    inflicted only here since the caller must already be authenticated as
    the identity in question."""
    alice = db.new_identity("Alice66l", role="creator")
    r = c.post(f"/api/identities/{alice['id']}/code", json={"code": [1, 2, 3]}, headers=_H(alice))
    assert r.status_code == 400, r.text
    r2 = c.post(f"/api/identities/{alice['id']}/code", json={"code": "validcode123"}, headers=_H(alice))
    assert r2.status_code == 200, r2.text


# ---------- A14: PUT /api/accounts/{id} bypasses _read_json / _to_str ----------

def test_a14_update_account_rejects_malformed_body_and_dict_fields():
    """This handler called `request.json()` directly instead of the
    `_read_json` helper every sibling uses, so a malformed/empty body raised
    instead of returning a clean 400. It also built brand/account_no/
    holder_name with bare `str(x or "")`, so a dict value was silently
    persisted as "{'a': 1}" instead of being rejected like add_account
    rejects it."""
    alice = db.new_identity("Alice66m", role="creator")
    acc = db.add_account(alice["id"], "BCA", "1234567890", "Alice")

    r = c.put(f"/api/accounts/{acc['id']}",
              headers={**_H(alice), "Content-Type": "application/json"}, content=b"")
    assert r.status_code == 400, r.text

    r2 = c.put(f"/api/accounts/{acc['id']}",
               json={"brand": {"a": 1}, "account_no": "999", "holder_name": "Alice"},
               headers=_H(alice))
    assert r2.status_code == 400, r2.text
    assert db.get_accounts(alice["id"])[0]["brand"] == "BCA", "dict value must not persist"

    r3 = c.put(f"/api/accounts/{acc['id']}",
               json={"brand": "Mandiri", "account_no": "555", "holder_name": "Alice B"},
               headers=_H(alice))
    assert r3.status_code == 200, r3.text
    assert r3.json()["brand"] == "Mandiri"


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print("PASS", name)
    print("\nALL PASS")
