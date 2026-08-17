"""Regression tests for v62: name-resolved payer confirmation banner.

A payer picked by NAME at creation is a placeholder until someone joins
under that name. The join links their identity (paid_by_identity_id) but
keeps paid_by_confirmed=0 — display convenience, not proof (anti-hijack,
v51). The creator must explicitly confirm before the payer inherits
management powers. v62 exposes paid_by_confirmed in the detail payload so
the UI can show a "confirm this payer" banner to the creator.

Covered:
- create with paid_by_name -> placeholder, confirmed=0, creator manages
- guest joins matching the name -> identity linked, still confirmed=0
- detail payload exposes paid_by_confirmed=false for the creator
- guest (the payer) has can_manage=false until confirmed
- creator PUTs /paid_by {identity_id} -> confirmed, payer now manages
- after confirm: creator is no longer manager (sole manager = payer)
- confirm via name also resolves and confirms

Run:
  cd backend && venv/bin/python -m pytest test_regressions_v62.py -q
"""
import os
import sys
import tempfile
from pathlib import Path

_tmp = Path(tempfile.mkdtemp()) / "test62.db"
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
    if kw.get("paid_by_name"):
        payload["paid_by_name"] = kw["paid_by_name"]
    r = c.post("/api/bills", json=payload, headers=_H(creator))
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _detail(bid, viewer):
    r = c.get(f"/api/bills/{bid}", headers=_H(viewer))
    assert r.status_code == 200, r.text
    return r.json()


def test_placeholder_payer_unconfirmed():
    """paid_by_name at creation = placeholder: confirmed=0, creator manages."""
    amel = db.new_identity("Amel62a", role="creator")
    aufa = db.new_identity("Aufa")
    bid = _mk_bill(amel, paid_by_name="Aufa")

    d = _detail(bid, amel)
    assert d["paid_by_name"] == "Aufa"
    # placeholder: no identity linked yet, name only
    assert d["paid_by_id"] is None
    assert d["paid_by_confirmed"] is False
    assert d["can_manage"] is True, "creator manages before any payer confirmed"


def test_join_links_identity_but_stays_unconfirmed():
    """Joining under the placeholder name links the identity, confirmed stays 0."""
    amel = db.new_identity("Amel62b", role="creator")
    aufa = db.new_identity("Aufa")
    bid = _mk_bill(amel, paid_by_name="Aufa")

    r = c.post(f"/api/bills/{bid}/join", headers=_H(aufa))
    assert r.status_code == 200, r.text

    d = _detail(bid, amel)
    assert d["paid_by_id"] == aufa["id"], "join resolved the name to the identity"
    assert d["paid_by_confirmed"] is False, "name match is NOT confirmation"
    assert d["can_manage"] is True, "creator still manages"
    # the guest who joined under the payer's name does NOT get powers
    dg = _detail(bid, aufa)
    assert dg["can_manage"] is False, "unconfirmed payer must not manage"


def test_confirm_grants_management():
    """Creator confirms via PUT /paid_by {identity_id} -> payer manages."""
    amel = db.new_identity("Amel62c", role="creator")
    aufa = db.new_identity("Aufa")
    bid = _mk_bill(amel, paid_by_name="Aufa")
    c.post(f"/api/bills/{bid}/join", headers=_H(aufa))

    r = c.put(
        f"/api/bills/{bid}/paid_by",
        json={"identity_id": aufa["id"]},
        headers=_H(amel),
    )
    assert r.status_code == 200, r.text

    d = _detail(bid, amel)
    assert d["paid_by_confirmed"] is True
    assert d["can_manage"] is False, "creator loses management once payer confirmed"
    da = _detail(bid, aufa)
    assert da["can_manage"] is True, "confirmed payer is the sole manager"


def test_confirm_by_name_resolves_and_confirms():
    """PUT /paid_by {name} for a joined person confirms them too."""
    amel = db.new_identity("Amel62d", role="creator")
    aufa = db.new_identity("Aufa")
    bid = _mk_bill(amel, paid_by_name="Aufa")
    c.post(f"/api/bills/{bid}/join", headers=_H(aufa))

    r = c.put(
        f"/api/bills/{bid}/paid_by",
        json={"name": "Aufa"},
        headers=_H(amel),
    )
    assert r.status_code == 200, r.text
    d = _detail(bid, aufa)
    assert d["paid_by_confirmed"] is True
    assert d["can_manage"] is True


def test_guest_cannot_confirm():
    """Only the current manager may confirm a payer -> 403 for the payer."""
    amel = db.new_identity("Amel62e", role="creator")
    aufa = db.new_identity("Aufa")
    bid = _mk_bill(amel, paid_by_name="Aufa")
    c.post(f"/api/bills/{bid}/join", headers=_H(aufa))

    r = c.put(
        f"/api/bills/{bid}/paid_by",
        json={"identity_id": aufa["id"]},
        headers=_H(aufa),
    )
    assert r.status_code == 403, r.text


if __name__ == "__main__":
    test_placeholder_payer_unconfirmed()
    test_join_links_identity_but_stays_unconfirmed()
    test_confirm_grants_management()
    test_confirm_by_name_resolves_and_confirms()
    test_guest_cannot_confirm()
    print("PASS v62 payer-confirm tests")
