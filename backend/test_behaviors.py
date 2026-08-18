"""Comprehensive behaviour + edge-case tests for Bagiin (bill splitting).

Covers the full human lifecycle (create -> join -> pick -> pay -> close ->
reopen) plus the edge cases found in the v38 bug-fix pass. Run:
  cd backend && source venv/bin/activate && python -m pytest test_behaviors.py -q
"""
import os
import sys
import tempfile
from pathlib import Path

_tmp = Path(tempfile.mkdtemp()) / "test.db"
os.environ["BAGIIN_DB"] = str(_tmp)

sys.path.insert(0, str(Path(__file__).resolve().parent))

import db
db.init_db()

from fastapi.testclient import TestClient
from main import app, _compute_response

c = TestClient(app)



def _H(who):
    """Auth headers for a caller. Accepts an identity dict or a bare id.

    Since v51 the identity id is only a public reference — requests must also
    carry the identity's secret, so tests go through this helper.
    """
    ident = who if isinstance(who, dict) else db.get_identity(who)
    h = {"X-Identity-Id": ident["id"]}
    if ident.get("secret"):
        h["X-Identity-Secret"] = ident["secret"]
    return h

def _mk_bill(creator, title="Makan", subtotal=60000, tax=6000, service=0,
             total=66000, items=None, participants=None, tax_included=0,
             paid_by_name=None, participant_count=None):
    data = db.create_bill(
        creator_id=creator["id"], title=title, tax_mode="proportional",
        subtotal=subtotal, tax=tax, service=service, total=total,
        items=items or [{"name": "A", "price": 30000}, {"name": "B", "price": 30000}],
        participants=participants or ["Aufa", "Budi"],
        tax_included=tax_included, paid_by_name=paid_by_name,
        participant_count=participant_count,
    )
    return data["id"]


def _ids(bid):
    data = db.get_bill(bid)
    return {it["name"]: it["id"] for it in data["items"]}


# ---------- happy path ----------

def test_full_lifecycle_happy_path():
    """Create -> guest joins -> picks -> pays -> settled -> close -> reopen."""
    creator = db.new_identity("Aufa", role="creator")
    budi = db.new_identity("Budi")
    bid = _mk_bill(creator, items=[
        {"name": "Nasi Goreng", "price": 40000},
        {"name": "Es Teh", "price": 10000},
        {"name": "Mie", "price": 10000},
    ], subtotal=60000, tax=6000, total=66000)
    ids = _ids(bid)
    H = _H(creator["id"])
    Hb = _H(budi["id"])

    # creator default payer -> paid, but not settled (nothing picked)
    r = c.get(f"/api/bills/{bid}", headers=H)
    assert r.status_code == 200
    data = r.json()
    assert data["paid_by_id"] == creator["id"]
    assert data["settled"] is False

    # Budi joins and picks Nasi Goreng + Es Teh
    r = c.post(f"/api/bills/{bid}/join", headers=Hb)
    assert r.status_code == 200
    r = c.post(f"/api/bills/{bid}/selections", headers=Hb,
               json={"picks": [{"item_id": ids["Nasi Goreng"], "qty": 1},
                               {"item_id": ids["Es Teh"], "qty": 1}]})
    assert r.status_code == 200, r.text
    data = r.json()
    budi_p = next(p for p in data["people"] if p["identity_id"] == budi["id"])
    # Nasi 40k + Teh 10k = 50k subtotal; tax proportional 50000/60000*6000 = 5000
    assert budi_p["subtotal_idr"] == 50000, budi_p
    assert budi_p["tax_idr"] == 5000, budi_p
    # unpicked Mie defaults to creator (10k + 1k tax)
    creator_p = next(p for p in data["people"] if p["identity_id"] == creator["id"])
    assert creator_p["subtotal_idr"] == 10000, creator_p
    assert creator_p["tax_idr"] == 1000, creator_p
    assert data["settled"] is False

    # Budi pays -> creator is payer (auto-paid) -> settled
    r = c.post(f"/api/bills/{bid}/payments/{budi['id']}/paid", headers=Hb)
    assert r.status_code == 200
    assert r.json()["settled"] is True

    # close -> frozen
    r = c.post(f"/api/bills/{bid}/close", headers=H)
    assert r.status_code == 200
    r = c.get(f"/api/bills/{bid}", headers=H)
    assert r.json()["bill"]["status"] == "closed"

    # closed: can't edit items / selections / paid status
    assert c.put(f"/api/bills/{bid}", headers=H, json={
        "title": "X", "items": [{"name": "A", "price": 1}]}).status_code == 403
    assert c.post(f"/api/bills/{bid}/payments/{budi['id']}/unpaid", headers=Hb).status_code == 403
    assert c.post(f"/api/bills/{bid}/selections", headers=Hb,
                  json={"picks": []}).status_code == 403
    assert c.post(f"/api/bills/{bid}/join", headers=_H(db.new_identity("Caca")["id"])).status_code == 403

    # reopen -> editable again
    r = c.post(f"/api/bills/{bid}/reopen", headers=H)
    assert r.status_code == 200
    assert r.json()["bill"]["status"] == "open"
    r = c.post(f"/api/bills/{bid}/payments/{budi['id']}/unpaid", headers=Hb)
    assert r.status_code == 200
    assert r.json()["settled"] is False
    print("PASS full lifecycle: create/join/pick/pay/close/reopen")


def test_reopen_permissions():
    creator = db.new_identity("Aufa2", role="creator")
    budi = db.new_identity("Budi2")
    bid = _mk_bill(creator)
    c.post(f"/api/bills/{bid}/close", headers=_H(creator["id"]))
    # guest can't reopen
    assert c.post(f"/api/bills/{bid}/reopen", headers=_H(budi["id"])).status_code == 403
    # stranger can't reopen
    stranger = db.new_identity("X")
    assert c.post(f"/api/bills/{bid}/reopen", headers=_H(stranger["id"])).status_code == 403
    # reopen an open bill -> 400
    r = c.post(f"/api/bills/{bid}/reopen", headers=_H(creator["id"]))
    assert r.status_code == 200
    assert c.post(f"/api/bills/{bid}/reopen", headers=_H(creator["id"])).status_code == 400
    print("PASS reopen permissions")


# ---------- payer placeholder (the "Amel/Budi" bug) ----------

def test_payer_placeholder_does_not_mark_creator_paid():
    """Regression: payer set by NAME before that person joins must NOT mark
    the creator as the payer / auto-paid (bug: fallback to creator)."""
    creator = db.new_identity("Aufa3", role="creator")
    bid = _mk_bill(creator, paid_by_name="Budi", items=[{"name": "A", "price": 60000}],
                   subtotal=60000, tax=6000, total=66000)
    r = c.get(f"/api/bills/{bid}", headers=_H(creator["id"]))
    data = r.json()
    assert data["paid_by_name"] == "Budi"
    assert data["paid_by_id"] is None, data["paid_by_id"]
    creator_p = next(p for p in data["people"] if p["identity_id"] == creator["id"])
    assert creator_p["paid"] == "unpaid", creator_p
    print("PASS payer placeholder: creator NOT auto-marked paid")


def test_payer_placeholder_resolves_on_join():
    creator = db.new_identity("Aufa4", role="creator")
    budi = db.new_identity("Budi")
    bid = _mk_bill(creator, paid_by_name="Budi", items=[{"name": "A", "price": 60000}],
                   subtotal=60000, tax=6000, total=66000)
    ids = _ids(bid)
    # Budi joins + picks -> payer resolves to him, he's auto-paid, settled
    c.post(f"/api/bills/{bid}/join", headers=_H(budi["id"]))
    r = c.post(f"/api/bills/{bid}/selections", headers=_H(budi["id"]),
               json={"picks": [ids["A"]]})
    data = r.json()
    assert data["paid_by_id"] == budi["id"]
    assert data["paid_by_name"] == "Budi"
    budi_p = next(p for p in data["people"] if p["identity_id"] == budi["id"])
    assert budi_p["paid"] == "paid"
    assert data["settled"] is True
    print("PASS payer placeholder resolves on join + auto-paid")


def test_remove_person_clears_stale_payer():
    """Removing a name-matched payer (auto-resolved on join, never confirmed)
    clears paid_by back to the creator. A CONFIRMED payer is the sole owner —
    the creator can't remove them anymore (v57)."""
    creator = db.new_identity("Aufa5", role="creator")
    budi = db.new_identity("Budi5")
    bid = _mk_bill(creator, paid_by_name="Budi5")
    c.post(f"/api/bills/{bid}/join", headers=_H(budi["id"]))  # auto-resolves by name, NOT confirmed
    r = c.get(f"/api/bills/{bid}", headers=_H(creator["id"]))
    assert r.json()["paid_by_id"] == budi["id"]
    assert r.json()["can_manage"] is True  # name-match is display-only, creator stays owner
    # creator removes the display-only payer -> paid_by falls back to creator
    r = c.delete(f"/api/bills/{bid}/people/{budi['id']}", headers=_H(creator["id"]))
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["paid_by_id"] == creator["id"]  # falls back to creator
    assert all(p["identity_id"] != budi["id"] for p in data["people"])
    print("PASS remove_person clears stale name-matched payer (v57)")


# ---------- permissions ----------

def test_permissions_matrix():
    creator = db.new_identity("Aufa6", role="creator")
    budi = db.new_identity("Budi6")
    stranger = db.new_identity("Stranger")
    bid = _mk_bill(creator)
    ids = _ids(bid)
    H, Hb, Hs = (_H(x) for x in (creator["id"], budi["id"], stranger["id"]))

    # stranger: can't edit, can't close, can't set payer, can't mark paid, can't delete
    assert c.put(f"/api/bills/{bid}", headers=Hs, json={"title": "X", "items": [{"name": "A", "price": 1}]}).status_code == 403
    assert c.post(f"/api/bills/{bid}/close", headers=Hs).status_code == 403
    assert c.put(f"/api/bills/{bid}/paid_by", headers=Hs, json={"name": "Budi"}).status_code == 403
    assert c.post(f"/api/bills/{bid}/payments/{budi['id']}/paid", headers=Hs).status_code == 403
    assert c.delete(f"/api/bills/{bid}", headers=Hs).status_code == 403
    # guest can't mark someone else paid (only themselves)
    assert c.post(f"/api/bills/{bid}/payments/{creator['id']}/paid", headers=Hb).status_code == 403
    # guest can't delete / edit
    assert c.delete(f"/api/bills/{bid}", headers=Hb).status_code == 403
    assert c.put(f"/api/bills/{bid}", headers=Hb, json={"title": "X", "items": [{"name": "A", "price": 1}]}).status_code == 403
    # guest can pick, pay self
    assert c.post(f"/api/bills/{bid}/selections", headers=Hb, json={"picks": [ids["A"]]}).status_code == 200
    assert c.post(f"/api/bills/{bid}/payments/{budi['id']}/paid", headers=Hb).status_code == 200
    print("PASS permissions matrix")


# ---------- slot oversubscription race ----------

def test_slot_oversubscription_blocked():
    """Two guests grab the same last slot -> second request gets 400."""
    creator = db.new_identity("Aufa7", role="creator")
    amel = db.new_identity("Amel7")
    budi = db.new_identity("Budi7")
    bid = _mk_bill(creator, items=[{"name": "Teh", "price": 30000, "mode": "slot", "slot_count": 1}],
                   subtotal=30000, tax=0, total=30000, participants=["Aufa", "Amel", "Budi"])
    ids = _ids(bid)
    Ha = _H(amel["id"])
    Hb = _H(budi["id"])
    assert c.post(f"/api/bills/{bid}/selections", headers=Ha,
                  json={"picks": [{"item_id": ids["Teh"], "qty": 1}]}).status_code == 200
    # second person over the only slot -> 400
    r = c.post(f"/api/bills/{bid}/selections", headers=Hb,
               json={"picks": [{"item_id": ids["Teh"], "qty": 1}]})
    assert r.status_code == 400, (r.status_code, r.text)
    assert "tinggal" in r.json().get("detail", ""), r.text
    # also qty > slot_count alone -> 400
    r = c.post(f"/api/bills/{bid}/selections", headers=Ha,
               json={"picks": [{"item_id": ids["Teh"], "qty": 2}]})
    assert r.status_code == 400
    # release frees the slot
    assert c.delete(f"/api/bills/{bid}/items/{ids['Teh']}/selections/{amel['id']}", headers=Ha).status_code == 200
    assert c.post(f"/api/bills/{bid}/selections", headers=Hb,
                  json={"picks": [{"item_id": ids["Teh"], "qty": 1}]}).status_code == 200
    print("PASS slot oversubscription blocked + release")


# ---------- update_bill foreign id ----------

def test_update_bill_foreign_id_no_data_loss():
    """Regression: editing a bill with a stale/foreign item id must NOT delete
    a real item (old bug: kept.add on unmatched id)."""
    creator = db.new_identity("Aufa8", role="creator")
    bid = _mk_bill(creator, items=[{"name": "A", "price": 30000}, {"name": "B", "price": 30000}],
                   subtotal=60000, tax=6000, total=66000)
    ids = _ids(bid)
    other = db.new_identity("O")
    obid = _mk_bill(other, items=[{"name": "Foreign", "price": 1000}], subtotal=1000, tax=0, total=1000)
    oids = _ids(obid)
    # update with a foreign item id mixed in
    r = c.put(f"/api/bills/{bid}", headers=_H(creator["id"]), json={
        "title": "Makan",
        "items": [
            {"id": ids["A"], "name": "A2", "price": 31000},
            {"id": oids["Foreign"], "name": "Foreign", "price": 1000},  # foreign id
            {"name": "C", "price": 5000},
        ],
        "participants": ["Aufa", "Budi"],
        "subtotal": 37000, "tax": 0, "service": 0, "total": 37000,
    })
    assert r.status_code == 200, r.text
    data = r.json()
    names = sorted(i["name"] for i in data["items"])
    # A2 kept, C added, foreign id treated as new item, and B NOT deleted
    assert names == ["A2", "C", "Foreign"], names
    assert len(data["items"]) == 3
    print("PASS update_bill foreign id -> no data loss")


# ---------- split correctness ----------

def test_unassigned_items_go_to_creator():
    """Warning says unpicked items 'masuk ke yang nalangin' -> split must match.

    No confirmed payer here, so the one who fronted it is the creator."""
    creator = db.new_identity("Aufa9", role="creator")
    budi = db.new_identity("Budi9")
    bid = _mk_bill(creator, items=[
        {"name": "Nasi", "price": 30000},
        {"name": "Ayam", "price": 30000},
    ], subtotal=60000, tax=0, total=60000)
    ids = _ids(bid)
    c.post(f"/api/bills/{bid}/selections", headers=_H(budi["id"]),
           json={"picks": [ids["Nasi"]]})
    data = _compute_response(db.get_bill(bid))
    by = {p["identity_id"]: p for p in data["people"]}
    assert by[budi["id"]]["subtotal_idr"] == 30000
    assert by[creator["id"]]["subtotal_idr"] == 30000  # Ayam unpicked -> creator
    assert data["total_ok"] is True
    assert data["remaining_to_creator"] == 0
    assert any("masuk ke yang nalangin" in w for w in data["warnings"])
    print("PASS unpicked items default to creator + warning matches split")


def test_tax_included_keeps_service():
    """tax_included drops PPN but still splits a separate service charge.
    Item prices already include PPN, so total = subtotal + service only."""
    creator = db.new_identity("Aufa10", role="creator")
    budi = db.new_identity("Budi10")
    # 100000 subtotal ALREADY includes 11000 PPN; +5000 service -> 105000
    bid = _mk_bill(creator, items=[{"name": "Nasi", "price": 50000}, {"name": "Ayam", "price": 50000}],
                   subtotal=100000, tax=11000, service=5000, total=105000, tax_included=1)
    ids = _ids(bid)
    c.post(f"/api/bills/{bid}/selections", headers=_H(budi["id"]),
           json={"picks": [ids["Nasi"]]})
    data = _compute_response(db.get_bill(bid))
    by = {p["identity_id"]: p for p in data["people"]}
    # tax (11000) dropped, service (5000) split proportionally 50/50
    assert by[budi["id"]]["tax_idr"] == 2500, by[budi["id"]]
    assert by[creator["id"]]["tax_idr"] == 2500, by[creator["id"]]
    total = sum(p["total_idr"] for p in data["people"])
    assert total == 105000, total
    assert data["total_ok"] is True
    print("PASS tax_included: PPN dropped, service still split")


def test_discount_split():
    creator = db.new_identity("Aufa11", role="creator")
    amel = db.new_identity("Amel11")
    budi = db.new_identity("Budi11")
    bid = _mk_bill(creator, items=[
        {"name": "DiskonItem", "price": 20000, "discount": 5000},
        {"name": "Normal", "price": 10000},
    ], subtotal=30000, tax=3000, total=33000)
    ids = _ids(bid)
    Ha = _H(amel["id"])
    Hb = _H(budi["id"])
    # shared discounted item: effective 15000 split between two
    c.post(f"/api/bills/{bid}/selections", headers=Ha, json={"picks": [ids["DiskonItem"]]})
    c.post(f"/api/bills/{bid}/selections", headers=Hb,
           json={"picks": [ids["DiskonItem"], ids["Normal"]]})
    data = _compute_response(db.get_bill(bid))
    by = {p["identity_id"]: p for p in data["people"]}
    assert by[amel["id"]]["subtotal_idr"] == 7500, by[amel["id"]]
    assert by[budi["id"]]["subtotal_idr"] == 7500 + 10000, by[budi["id"]]
    print("PASS discount: effective price split correctly")


def test_free_qty_portions():
    creator = db.new_identity("Aufa12", role="creator")
    amel = db.new_identity("Amel12")
    budi = db.new_identity("Budi12")
    bid = _mk_bill(creator, items=[{"name": "Teh", "price": 30000}], subtotal=30000, tax=0, total=30000)
    ids = _ids(bid)
    c.post(f"/api/bills/{bid}/selections", headers=_H(amel["id"]),
           json={"picks": [{"item_id": ids["Teh"], "qty": 2}]})
    c.post(f"/api/bills/{bid}/selections", headers=_H(budi["id"]),
           json={"picks": [{"item_id": ids["Teh"], "qty": 1}]})
    data = _compute_response(db.get_bill(bid))
    by = {p["identity_id"]: p for p in data["people"]}
    assert by[amel["id"]]["subtotal_idr"] == 20000, by[amel["id"]]
    assert by[budi["id"]]["subtotal_idr"] == 10000, by[budi["id"]]
    print("PASS free qty portions split proportionally")


def test_duplicate_picks_merged():
    creator = db.new_identity("Aufa13", role="creator")
    amel = db.new_identity("Amel13")
    bid = _mk_bill(creator, items=[{"name": "A", "price": 10000}], subtotal=10000, tax=0, total=10000)
    ids = _ids(bid)
    r = c.post(f"/api/bills/{bid}/selections", headers=_H(amel["id"]),
               json={"picks": [{"item_id": ids["A"], "qty": 1}, {"item_id": ids["A"], "qty": 2}]})
    assert r.status_code == 200
    # duplicate item ids merged into qty (1+2=3 portions of a 10000 item =
    # the whole item to Amel)
    data = _compute_response(db.get_bill(bid))
    by = {p["identity_id"]: p for p in data["people"]}
    assert by[amel["id"]]["subtotal_idr"] == 10000, by[amel["id"]]
    print("PASS duplicate picks merged")


def test_invalid_inputs():
    creator = db.new_identity("Aufa14", role="creator")
    amel = db.new_identity("Amel14")
    bid = _mk_bill(creator, items=[{"name": "A", "price": 10000}], subtotal=10000, tax=0, total=10000)
    Ha = _H(amel["id"])
    # unknown item id
    r = c.post(f"/api/bills/{bid}/selections", headers=Ha, json={"picks": [{"item_id": 999999, "qty": 1}]})
    assert r.status_code == 400
    # discount > price
    r = c.put(f"/api/bills/{bid}", headers=_H(creator["id"]), json={
        "title": "X", "items": [{"name": "A", "price": 10000, "discount": 15000}],
        "participants": ["Aufa", "Budi"], "subtotal": -5000, "tax": 0, "service": 0, "total": -5000})
    assert r.status_code == 400
    # empty items on create
    r = c.post("/api/bills", headers=_H(creator["id"]), json={
        "title": "X", "items": [], "participants": [], "subtotal": 0, "tax": 0, "service": 0, "total": 0})
    assert r.status_code == 400
    # GET is public by design (guests open bills via link without identity)
    assert c.get(f"/api/bills/{bid}").status_code == 200
    print("PASS invalid inputs rejected")


def test_settled_list_matches_detail():
    """Detail-view settled (payer auto-paid) matches the list flag."""
    creator = db.new_identity("Aufa15", role="creator")
    budi = db.new_identity("Budi15")
    bid = _mk_bill(creator, items=[{"name": "A", "price": 30000}, {"name": "B", "price": 30000}],
                   subtotal=60000, tax=0, total=60000)
    ids = _ids(bid)
    c.post(f"/api/bills/{bid}/join", headers=_H(budi["id"]))
    c.post(f"/api/bills/{bid}/selections", headers=_H(budi["id"]), json={"picks": [ids["A"]]})
    # creator is default payer -> auto-paid; Budi paid -> settled in both views
    c.post(f"/api/bills/{bid}/payments/{budi['id']}/paid", headers=_H(budi["id"]))
    detail = _compute_response(db.get_bill(bid))
    bills = db.get_bills_for_identity(creator["id"])
    row = next(b for b in bills if b["id"] == bid)
    assert detail["settled"] is True, detail["settled"]
    assert row["settled"] is True, row
    # unpay Budi -> both unsettled
    c.post(f"/api/bills/{bid}/payments/{budi['id']}/unpaid", headers=_H(creator["id"]))
    detail = _compute_response(db.get_bill(bid))
    bills = db.get_bills_for_identity(creator["id"])
    row = next(b for b in bills if b["id"] == bid)
    assert detail["settled"] is False
    assert row["settled"] is False, row
    print("PASS settled detail == list")


# ---------- owner = payer model ----------

def test_payer_is_owner_privileges():
    """Confirmed payer is the SOLE manager (v57): close, edit, mark others
    paid, reopen, delete, set payer, remove person, set slots. Once the
    creator confirms a payer, the creator is a regular participant — 403 on
    everything. Handing the payer back restores creator powers."""
    creator = db.new_identity("Aufa20", role="creator")
    amel = db.new_identity("Amel20")
    stranger = db.new_identity("Stranger20")
    bid = _mk_bill(creator, items=[
        {"name": "Nasi", "price": 30000},
        {"name": "Ayam", "price": 30000},
    ], subtotal=60000, tax=0, total=60000, participants=["Aufa", "Amel"])
    ids = _ids(bid)
    # Amel joins, creator confirms her as payer -> power moves to her
    c.post(f"/api/bills/{bid}/join", headers=_H(amel["id"]))
    r = c.put(f"/api/bills/{bid}/paid_by", headers=_H(creator["id"]),
              json={"identity_id": amel["id"]})
    assert r.status_code == 200
    assert r.json()["owner_id"] == amel["id"]
    Hc = _H(creator["id"])
    Ha = _H(amel["id"])
    Hs = _H(stranger["id"])

    # creator is now a plain participant: 403 on every manage action (v57)
    assert c.get(f"/api/bills/{bid}", headers=Hc).json()["can_manage"] is False
    assert c.post(f"/api/bills/{bid}/close", headers=Hc).status_code == 403
    assert c.put(f"/api/bills/{bid}", headers=Hc, json={
        "title": "X", "items": [{"name": "A", "price": 1}],
        "participants": ["Aufa", "Amel"], "subtotal": 1, "tax": 0, "service": 0, "total": 1}).status_code == 403
    assert c.post(f"/api/bills/{bid}/payments/{amel['id']}/paid", headers=Hc).status_code == 403
    assert c.put(f"/api/bills/{bid}/paid_by", headers=Hc,
                 json={"identity_id": creator["id"]}).status_code == 403
    assert c.delete(f"/api/bills/{bid}", headers=Hc).status_code == 403

    # payer (owner) can do everything
    assert c.post(f"/api/bills/{bid}/close", headers=Ha).status_code == 200
    assert c.post(f"/api/bills/{bid}/reopen", headers=Ha).status_code == 200
    r = c.put(f"/api/bills/{bid}", headers=Ha, json={
        "title": "Makan Edit", "items": [{"name": "Nasi", "price": 31000}, {"name": "Ayam", "price": 30000}],
        "participants": ["Aufa", "Amel"], "subtotal": 61000, "tax": 0, "service": 0, "total": 61000})
    assert r.status_code == 200, r.text
    assert c.post(f"/api/bills/{bid}/payments/{creator['id']}/paid", headers=Ha).status_code == 200
    # stranger can't
    assert c.post(f"/api/bills/{bid}/reopen", headers=Hs).status_code == 403

    # payer hands ownership back to creator -> creator regains full powers
    r = c.put(f"/api/bills/{bid}/paid_by", headers=Ha, json={"identity_id": creator["id"]})
    assert r.status_code == 200
    assert r.json()["owner_id"] == creator["id"]
    assert c.get(f"/api/bills/{bid}", headers=Hc).json()["can_manage"] is True
    assert c.post(f"/api/bills/{bid}/close", headers=Hc).status_code == 200
    assert c.delete(f"/api/bills/{bid}", headers=Hc).status_code == 200
    print("PASS payer = sole owner: full powers, creator locked out until hand-off back")


def test_owner_id_in_list_and_detail():
    """A payer resolved by NAME is display-only: they get the auto-paid status
    but ownership stays with the creator until a manager confirms them."""
    creator = db.new_identity("Aufa21", role="creator")
    amel = db.new_identity("Amel21")
    bid = _mk_bill(creator, paid_by_name="Amel21", items=[{"name": "A", "price": 30000}],
                   subtotal=30000, tax=0, total=30000)
    c.post(f"/api/bills/{bid}/join", headers=_H(amel["id"]))
    detail = _compute_response(db.get_bill(bid), creator["id"])
    assert detail["paid_by_id"] == amel["id"], detail["paid_by_id"]
    assert detail["owner_id"] == creator["id"], detail["owner_id"]
    assert detail["can_manage"] is True
    rows = c.get(f"/api/identities/{creator['id']}/bills", headers=_H(creator)).json()
    row = next(b for b in rows if b["id"] == bid)
    assert row["owner_id"] == creator["id"], row
    assert row["can_manage"] is True, row
    # ...and the name match alone does not let Amel manage the bill
    assert _compute_response(db.get_bill(bid), amel["id"])["can_manage"] is False
    print("PASS name-resolved payer is display-only, creator keeps ownership")


def test_creator_keeps_owner_until_payer_resolves():
    """Placeholder payer (name, hasn't joined) -> creator stays owner."""
    creator = db.new_identity("Aufa22", role="creator")
    bid = _mk_bill(creator, paid_by_name="Budi22", items=[{"name": "A", "price": 30000}],
                   subtotal=30000, tax=0, total=30000)
    Hc = _H(creator["id"])
    data = c.get(f"/api/bills/{bid}", headers=Hc).json()
    assert data["owner_id"] == creator["id"], data["owner_id"]
    assert data["paid_by_id"] is None
    # creator can still close while payer unresolved
    assert c.post(f"/api/bills/{bid}/close", headers=Hc).status_code == 200
    print("PASS creator keeps owner until payer resolves")


# ---------- bug-hunt fixes (v41) ----------

def test_name_handoff_resolves_identity_but_does_not_hand_over_the_bill():
    """Hand-off payer by NAME resolves the identity for display (bug:
    paid_by_identity_id stayed NULL -> _owner_id saw Budi but db.delete_bill
    saw creator -> undeletable) — but it must NOT confirm them.

    Confirming on the name path re-opened the v51 takeover from the other side:
    a guest with the share link renames themselves to the placeholder, joins,
    and the manager's "Pakai Nama Ini" tap makes them the sole owner. Handing
    the bill over is the explicit identity_id path (the v62 banner), and only
    that one."""
    creator = db.new_identity("Aufa30", role="creator")
    budi = db.new_identity("Budi30")
    bid = _mk_bill(creator)
    c.post(f"/api/bills/{bid}/join", headers=_H(budi["id"]))
    r = c.put(f"/api/bills/{bid}/paid_by", headers=_H(creator["id"]),
              json={"name": "Budi30"})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["paid_by_id"] == budi["id"], data["paid_by_id"]  # resolved now
    assert data["paid_by_name"] == "Budi30"
    assert data["owner_id"] == creator["id"], "name alone never hands over"
    assert c.delete(f"/api/bills/{bid}", headers=_H(budi["id"])).status_code == 403
    # the creator still holds it, and can still hand it over on purpose
    r = c.put(f"/api/bills/{bid}/paid_by", headers=_H(creator["id"]),
              json={"identity_id": budi["id"]})
    assert r.status_code == 200, r.text
    assert r.json()["owner_id"] == budi["id"]
    assert c.delete(f"/api/bills/{bid}", headers=_H(budi["id"])).status_code == 200
    print("PASS name hand-off resolves identity but never confirms")


def test_creator_removable_once_a_payer_holds_the_bill():
    """v58: unpicked items default to the OWNER, not the creator, so removing
    a creator who no longer holds the bill can't strand any money. The split
    must still reconcile afterwards."""
    creator = db.new_identity("Aufa31", role="creator")
    budi = db.new_identity("Budi31")
    bid = _mk_bill(creator, items=[{"name": "A", "price": 30000}, {"name": "B", "price": 30000}],
                   subtotal=60000, tax=0, total=60000)
    c.post(f"/api/bills/{bid}/join", headers=_H(budi["id"]))
    c.put(f"/api/bills/{bid}/paid_by", headers=_H(creator["id"]),
          json={"identity_id": budi["id"]})
    r = c.delete(f"/api/bills/{bid}/people/{creator['id']}", headers=_H(budi["id"]))
    assert r.status_code == 200, (r.status_code, r.text)
    data = r.json()
    assert all(p["identity_id"] != creator["id"] for p in data["people"])
    assert data["total_ok"] is True
    # removing a regular guest still works
    amel = db.new_identity("Amel31")
    c.post(f"/api/bills/{bid}/join", headers=_H(amel["id"]))
    r = c.delete(f"/api/bills/{bid}/people/{amel['id']}", headers=_H(budi["id"]))
    assert r.status_code == 200
    print("PASS creator removable once the payer holds it; guest removal ok")


def test_slot_remainder_distributed_per_slot():
    """One person holding qty>1 slots must get the full rounding remainder
    (old loop capped at number of distinct holders -> lost rupiah)."""
    creator = db.new_identity("Aufa32", role="creator")
    bid = _mk_bill(creator, items=[{"name": "S", "price": 10004, "mode": "slot", "slot_count": 5}],
                   subtotal=10004, tax=0, total=10004, participants=["Aufa", "Budi"])
    ids = _ids(bid)
    c.post(f"/api/bills/{bid}/selections", headers=_H(creator["id"]),
           json={"picks": [{"item_id": ids["S"], "qty": 5}]})
    data = _compute_response(db.get_bill(bid))
    sub = sum(p["subtotal_idr"] for p in data["people"])
    assert sub == 10004, sub
    assert data["total_ok"] is True
    print("PASS slot remainder distributed per slot")


def test_tax_not_lost_when_no_one_has_share():
    """Bill with only slot items nobody picked: tax must still land somewhere
    (creator), keeping the invariant sum+uncovered == total."""
    creator = db.new_identity("Aufa33", role="creator")
    bid = _mk_bill(creator, items=[{"name": "Teh", "price": 30000, "mode": "slot", "slot_count": 1}],
                   subtotal=30000, tax=3000, total=33000, participants=["Aufa", "Budi"])
    data = _compute_response(db.get_bill(bid))
    assert data["total_ok"] is True, (data["total_ok"], data["warnings"])
    assert data["remaining_to_creator"] == 0, data["remaining_to_creator"]
    creator_p = next(p for p in data["people"] if p["identity_id"] == creator["id"])
    assert creator_p["tax_idr"] == 3000, creator_p
    print("PASS tax lands on creator when nobody has a share yet")


def test_malformed_inputs_return_400():
    """Malformed create/update/selections payloads must be 400, not 500."""
    creator = db.new_identity("Aufa34", role="creator")
    Hc = _H(creator["id"])
    cases = [
        ("/api/bills", {"title": "X", "items": [{"name": "A", "price": "abc"}], "subtotal": 0, "tax": 0, "service": 0, "total": 0}),
        ("/api/bills", {"title": "X", "items": [{"price": 1000}], "subtotal": 0, "tax": 0, "service": 0, "total": 0}),
        ("/api/bills", {"title": "X", "items": [{"name": "A", "price": 1000}], "participant_count": "abc", "subtotal": 0, "tax": 0, "service": 0, "total": 0}),
        ("/api/bills", {"title": "X", "items": [{"name": "A", "price": 1000}], "subtotal": "abc", "tax": 0, "service": 0, "total": 0}),
        ("/api/bills", {"title": "X", "items": "nope", "subtotal": 0, "tax": 0, "service": 0, "total": 0}),
    ]
    for url, body in cases:
        r = c.post(url, headers=Hc, json=body)
        assert r.status_code == 400, (url, body, r.status_code, r.text)
    # qty 0 / negative -> 400 (was silently clamped to 1 portion)
    bid = _mk_bill(creator, items=[{"name": "A", "price": 10000}], subtotal=10000, tax=0, total=10000)
    ids = _ids(bid)
    r = c.post(f"/api/bills/{bid}/selections", headers=Hc,
               json={"picks": [{"item_id": ids["A"], "qty": 0}]})
    assert r.status_code == 400, (r.status_code, r.text)
    r = c.post(f"/api/bills/{bid}/selections", headers=Hc,
               json={"picks": [{"item_id": ids["A"], "qty": -3}]})
    assert r.status_code == 400, (r.status_code, r.text)
    # qty > 99 -> 400
    r = c.post(f"/api/bills/{bid}/selections", headers=Hc,
               json={"picks": [{"item_id": ids["A"], "qty": 100}]})
    assert r.status_code == 400, (r.status_code, r.text)
    print("PASS malformed inputs -> 400, qty bounds enforced")


def test_settled_creator_default_payer_list_matches():
    """Creator is the default payer when no payer declared: list settled flag
    must match detail (both True once everyone with a share has paid)."""
    creator = db.new_identity("Aufa35", role="creator")
    budi = db.new_identity("Budi35")
    bid = _mk_bill(creator, items=[{"name": "A", "price": 30000}, {"name": "B", "price": 30000}],
                   subtotal=60000, tax=0, total=60000)
    ids = _ids(bid)
    c.post(f"/api/bills/{bid}/join", headers=_H(budi["id"]))
    c.post(f"/api/bills/{bid}/selections", headers=_H(creator["id"]),
           json={"picks": [ids["A"]]})
    c.post(f"/api/bills/{bid}/selections", headers=_H(budi["id"]),
           json={"picks": [ids["B"]]})
    c.post(f"/api/bills/{bid}/payments/{budi['id']}/paid", headers=_H(budi["id"]))
    detail = _compute_response(db.get_bill(bid))
    rows = db.get_bills_for_identity(creator["id"])
    row = next(b for b in rows if b["id"] == bid)
    assert detail["settled"] is True, detail["settled"]
    assert row["settled"] is True, row
    print("PASS creator-default-payer settled flag consistent list vs detail")


if __name__ == "__main__":
    test_full_lifecycle_happy_path()
    test_reopen_permissions()
    test_payer_placeholder_does_not_mark_creator_paid()
    test_payer_placeholder_resolves_on_join()
    test_remove_person_clears_stale_payer()
    test_permissions_matrix()
    test_slot_oversubscription_blocked()
    test_update_bill_foreign_id_no_data_loss()
    test_unassigned_items_go_to_creator()
    test_tax_included_keeps_service()
    test_discount_split()
    test_free_qty_portions()
    test_duplicate_picks_merged()
    test_invalid_inputs()
    test_settled_list_matches_detail()
    test_payer_is_owner_privileges()
    test_owner_id_in_list_and_detail()
    test_creator_keeps_owner_until_payer_resolves()
    test_name_handoff_resolves_identity_but_does_not_hand_over_the_bill()
    test_creator_removable_once_a_payer_holds_the_bill()
    test_slot_remainder_distributed_per_slot()
    test_tax_not_lost_when_no_one_has_share()
    test_malformed_inputs_return_400()
    test_settled_creator_default_payer_list_matches()
    print("\nALL PASS")
