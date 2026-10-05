"""Regression tests for the v51 audit pass.

The big one: identity ids were bearer credentials AND public data. Every bill
payload lists the ids of everyone on it, so anyone the WhatsApp link reached
could replay the creator's id and rename them, attach their own bank account
to the creator's profile, mint a recovery code, or delete the bill. v51 splits
the two roles — the id stays the public reference, an unguessable secret does
the authenticating.

Also covered:
- a payer resolved by NAME is display-only and must not inherit ownership
- duplicate item ids in a bill edit must not desync the stored total
- `settled` must stop lying (closing a bill no longer settles it)
- `my_paid` / `settled` must agree between the bill list and the bill detail
- editing a bill must not wipe its participant roster
- fully-discounted empty slots must not be reported as "Rp 0 belum keambil"

Run:
  cd backend && venv/bin/python -m pytest test_regressions_v51.py -q
"""
import os
import sys
import tempfile
from pathlib import Path

_tmp = Path(tempfile.mkdtemp()) / "test51.db"
os.environ["BAGIIN_DB"] = str(_tmp)
os.environ["BAGIIN_UPLOAD_DIR"] = str(Path(tempfile.mkdtemp()) / "uploads")

sys.path.insert(0, str(Path(__file__).resolve().parent))

import db
db.init_db()

import calc
from fastapi.testclient import TestClient
from main import app, _owner_id, _can_manage

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
    for k in ("paid_by_name", "participants", "tax_included"):
        if k in kw:
            payload[k] = kw[k]
    r = c.post("/api/bills", json=payload, headers=_H(creator))
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _item_ids(bill_id):
    return [i["id"] for i in db.get_bill(bill_id)["items"]]


# ---------- 1. identity secret ----------

def test_bill_payload_leaks_ids_but_ids_are_not_credentials():
    """The share link still exposes everyone's id — that is fine now, because
    an id on its own authenticates nothing."""
    alice = db.new_identity("Alice51", role="creator")
    bob = db.new_identity("Bob51")
    bid = _mk_bill(alice)
    c.post(f"/api/bills/{bid}/join", headers=_H(bob))

    payload = c.get(f"/api/bills/{bid}", headers=_H(bob)).json()
    stolen = payload["bill"]["creator_identity_id"]
    assert stolen == alice["id"], "ids are still public in the payload"

    # Bob replays Alice's id without her secret
    forged = {"X-Identity-Id": stolen}
    assert c.post(f"/api/identities/{stolen}/name", json={"name": "pwned"},
                  headers=forged).status_code == 403
    assert c.get(f"/api/identities/{stolen}/accounts", headers=forged).status_code == 403
    assert c.post(f"/api/identities/{stolen}/accounts",
                  json={"brand": "BCA", "account_no": "666"},
                  headers=forged).status_code == 403
    assert c.post(f"/api/identities/{stolen}/code", json={"code": "attackercode"},
                  headers=forged).status_code == 403
    assert c.get(f"/api/identities/{stolen}/bills", headers=forged).status_code == 403
    assert c.delete(f"/api/bills/{bid}", headers=forged).status_code == 403

    # and Bob's own secret does not work for Alice's id either
    mixed = {"X-Identity-Id": stolen, "X-Identity-Secret": bob["secret"]}
    assert c.post(f"/api/identities/{stolen}/name", json={"name": "pwned"},
                  headers=mixed).status_code == 403
    assert db.get_identity(alice["id"])["name"] == "Alice51"
    assert db.get_accounts(alice["id"]) == []


def test_owner_with_secret_still_works():
    alice = db.new_identity("Alice51b", role="creator")
    assert c.post(f"/api/identities/{alice['id']}/name", json={"name": "Alice Baru"},
                  headers=_H(alice)).status_code == 200
    r = c.get(f"/api/identities/{alice['id']}/me", headers=_H(alice))
    assert r.status_code == 200, r.text
    assert r.json()["has_code"] is False
    c.post(f"/api/identities/{alice['id']}/code/generate", json={}, headers=_H(alice))
    assert c.get(f"/api/identities/{alice['id']}/me", headers=_H(alice)).json()["has_code"] is True


def test_legacy_identity_binds_secret_once():
    """Identities created before v51 have no secret; the first caller mints one
    and every later request must present it."""
    legacy = db.new_identity("Legacy51")
    conn = db.get_db()
    conn.execute("UPDATE identity SET secret = NULL WHERE id = ?", (legacy["id"],))
    conn.commit()
    conn.close()

    # works without a secret while unbound (old browsers keep running)
    assert c.post("/api/bills", json={
        "title": "L", "items": [{"name": "A", "price": 1000}],
        "subtotal": 1000, "tax": 0, "service": 0, "total": 1000,
    }, headers={"X-Identity-Id": legacy["id"]}).status_code == 200

    r = c.post(f"/api/identities/{legacy['id']}/bind", json={})
    assert r.status_code == 200, r.text
    secret = r.json()["secret"]
    assert secret

    # a second bind must not hand the secret to anyone else
    assert c.post(f"/api/identities/{legacy['id']}/bind", json={}).status_code == 403
    # and the bare id no longer authenticates
    assert c.post(f"/api/identities/{legacy['id']}/name", json={"name": "x"},
                  headers={"X-Identity-Id": legacy["id"]}).status_code == 403
    assert c.post(f"/api/identities/{legacy['id']}/name", json={"name": "Legacy Baru"},
                  headers={"X-Identity-Id": legacy["id"],
                           "X-Identity-Secret": secret}).status_code == 200


# ---------- 2. payer resolved by name is not the owner ----------

def test_name_matched_payer_cannot_take_over_the_bill():
    alice = db.new_identity("Alice51c", role="creator")
    mallory = db.new_identity("budi")          # same name as the declared payer
    bid = _mk_bill(alice, paid_by_name="Budi")

    r = c.post(f"/api/bills/{bid}/join", headers=_H(mallory))
    assert r.status_code == 200, r.text

    data = db.get_bill(bid)
    # resolves for display + auto-paid...
    assert db.resolve_payer(data)[0] == mallory["id"]
    # ...but ownership stays put
    assert _owner_id(data) == alice["id"]
    assert not _can_manage(data, mallory["id"])

    assert c.delete(f"/api/bills/{bid}", headers=_H(mallory)).status_code == 403
    assert c.post(f"/api/bills/{bid}/close", headers=_H(mallory)).status_code == 403
    assert c.put(f"/api/bills/{bid}/paid_by", json={"identity_id": mallory["id"]},
                 headers=_H(mallory)).status_code == 403
    detail = c.get(f"/api/bills/{bid}", headers=_H(mallory)).json()
    assert detail["can_manage"] is False
    assert c.get(f"/api/bills/{bid}", headers=_H(alice)).json()["can_manage"] is True


def test_creator_confirming_payer_transfers_ownership():
    alice = db.new_identity("Alice51d", role="creator")
    budi = db.new_identity("Budi51d")
    bid = _mk_bill(alice)
    c.post(f"/api/bills/{bid}/join", headers=_H(budi))

    r = c.put(f"/api/bills/{bid}/paid_by", json={"identity_id": budi["id"]}, headers=_H(alice))
    assert r.status_code == 200, r.text
    data = db.get_bill(bid)
    assert _owner_id(data) == budi["id"], "an explicit choice does transfer ownership"
    # v57: the confirmed payer is the SOLE manager — the creator is locked out
    assert not _can_manage(data, alice["id"]), "creator loses powers once payer confirmed"
    assert c.get(f"/api/bills/{bid}", headers=_H(alice)).json()["can_manage"] is False


# ---------- 3. duplicate item ids ----------

def test_duplicate_item_ids_rejected():
    alice = db.new_identity("Alice51e", role="creator")
    bid = _mk_bill(alice, items=[{"name": "A", "price": 100000}],
                   subtotal=100000, tax=10000, total=110000)
    iid = _item_ids(bid)[0]
    r = c.put(f"/api/bills/{bid}", json={
        "title": "dup",
        "items": [{"id": iid, "name": "A", "price": 100000},
                  {"id": iid, "name": "A", "price": 100000}],
        "subtotal": 200000, "tax": 10000, "service": 0, "total": 210000,
    }, headers=_H(alice))
    assert r.status_code == 400, r.text
    assert "dobel" in r.json()["detail"].lower()
    # the bill is untouched and still balances
    detail = c.get(f"/api/bills/{bid}", headers=_H(alice)).json()
    assert detail["bill"]["total_idr"] == 110000
    assert detail["total_ok"] is True


# ---------- 4. settled must not lie ----------

def test_closing_a_bill_does_not_settle_it():
    alice = db.new_identity("Alice51f", role="creator")
    bob = db.new_identity("Bob51f")
    bid = _mk_bill(alice, items=[{"name": "Pizza", "price": 100000, "mode": "slot",
                                  "slot_count": 4}],
                   subtotal=100000, tax=0, total=100000)
    c.post(f"/api/bills/{bid}/join", headers=_H(bob))
    iid = _item_ids(bid)[0]
    c.post(f"/api/bills/{bid}/selections", json={"picks": [{"item_id": iid, "qty": 1}]},
           headers=_H(bob))

    before = c.get(f"/api/bills/{bid}", headers=_H(alice)).json()
    assert before["uncovered_idr"] == 75000
    assert before["settled"] is False

    assert c.post(f"/api/bills/{bid}/close", headers=_H(alice)).status_code == 200
    after = c.get(f"/api/bills/{bid}", headers=_H(alice)).json()
    assert after["bill"]["status"] == "closed"
    assert after["uncovered_idr"] == 75000
    assert after["settled"] is False, "closing must not paper over unassigned money"
    assert after["all_paid"] is False

    rows = c.get(f"/api/identities/{alice['id']}/bills", headers=_H(alice)).json()
    row = next(b for b in rows if b["id"] == bid)
    assert row["settled"] is False, "history must agree with the bill screen"


def test_all_paid_is_separate_from_settled():
    """Everyone paid, but slots are still empty: all_paid true, settled false."""
    alice = db.new_identity("Alice51g", role="creator")
    bob = db.new_identity("Bob51g")
    bid = _mk_bill(alice, items=[{"name": "Pizza", "price": 100000, "mode": "slot",
                                  "slot_count": 4}],
                   subtotal=100000, tax=0, total=100000)
    c.post(f"/api/bills/{bid}/join", headers=_H(bob))
    iid = _item_ids(bid)[0]
    c.post(f"/api/bills/{bid}/selections", json={"picks": [{"item_id": iid, "qty": 1}]},
           headers=_H(bob))
    c.post(f"/api/bills/{bid}/payments/{bob['id']}/paid", headers=_H(bob))

    d = c.get(f"/api/bills/{bid}", headers=_H(alice)).json()
    assert d["all_paid"] is True
    assert d["settled"] is False
    assert d["uncovered_idr"] == 75000


# ---------- 5. list vs detail agreement ----------

def test_my_paid_matches_detail_when_payer_never_joined():
    """Payer declared as a name that never joins: nobody is auto-paid, so the
    creator who owes money must not be told "kamu udah bayar" in history."""
    alice = db.new_identity("Alice51h", role="creator")
    bid = _mk_bill(alice, paid_by_name="SiapaPunTakJoin")
    iid = _item_ids(bid)[0]
    c.post(f"/api/bills/{bid}/selections", json={"picks": [{"item_id": iid, "qty": 1}]},
           headers=_H(alice))

    detail = c.get(f"/api/bills/{bid}", headers=_H(alice)).json()
    assert detail["paid_by_id"] is None
    me = next(p for p in detail["people"] if p["identity_id"] == alice["id"])
    assert me["paid"] == "unpaid" and me["total_idr"] == 100000

    rows = c.get(f"/api/identities/{alice['id']}/bills", headers=_H(alice)).json()
    row = next(b for b in rows if b["id"] == bid)
    assert row["my_paid"] is False, "history contradicted the bill screen"
    assert row["settled"] is False


def test_settled_matches_after_payer_renames_into_the_name():
    alice = db.new_identity("Alice51i", role="creator")
    bobby = db.new_identity("Bobby51")
    bid = _mk_bill(alice, paid_by_name="Budi51i")
    c.post(f"/api/bills/{bid}/join", headers=_H(bobby))
    iid = _item_ids(bid)[0]
    c.post(f"/api/bills/{bid}/selections", json={"picks": [{"item_id": iid, "qty": 1}]},
           headers=_H(bobby))
    # he renames himself into the declared payer name
    c.post(f"/api/identities/{bobby['id']}/name", json={"name": "Budi51i"}, headers=_H(bobby))

    detail = c.get(f"/api/bills/{bid}", headers=_H(alice)).json()
    rows = c.get(f"/api/identities/{alice['id']}/bills", headers=_H(alice)).json()
    row = next(b for b in rows if b["id"] == bid)
    assert detail["settled"] == row["settled"], (detail["settled"], row["settled"])


# ---------- 6. editing must not wipe the roster ----------

def test_edit_without_participants_key_keeps_roster():
    alice = db.new_identity("Alice51j", role="creator")
    bid = _mk_bill(alice, participants=["Budi", "Cici"])
    assert len(db.get_bill(bid)["participants"]) == 2

    iid = _item_ids(bid)[0]
    r = c.put(f"/api/bills/{bid}", json={
        "title": "Judul Baru",
        "items": [{"id": iid, "name": "A", "price": 100000}],
        "subtotal": 100000, "tax": 0, "service": 0, "total": 100000,
    }, headers=_H(alice))
    assert r.status_code == 200, r.text
    assert len(db.get_bill(bid)["participants"]) == 2, "the edit screen wiped the roster"

    # explicitly sending the key still replaces it
    r = c.put(f"/api/bills/{bid}", json={
        "title": "Judul Baru", "participants": ["Budi"],
        "items": [{"id": iid, "name": "A", "price": 100000}],
        "subtotal": 100000, "tax": 0, "service": 0, "total": 100000,
    }, headers=_H(alice))
    assert r.status_code == 200, r.text
    assert [p["name"] for p in db.get_bill(bid)["participants"]] == ["Budi"]


# ---------- 7. worthless uncovered slots ----------

def test_fully_discounted_empty_slots_not_reported():
    result = calc.compute(
        bill={"subtotal_idr": 0, "tax_idr": 0, "service_idr": 0, "total_idr": 0,
              "tax_mode": "proportional"},
        items=[{"id": 1, "name": "Gratisan", "price_idr": 50000, "discount_idr": 50000,
                "mode": "slot", "slot_count": 3}],
        selections=[], participants=[], fallback_id="c",
    )
    assert result["uncovered_idr"] == 0
    assert result["uncovered_slots"] == [], "\"3 bagian kosong = Rp 0\" is not actionable"
    assert result["total_ok"] is True


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print("PASS", name)
    print("\nALL PASS")
