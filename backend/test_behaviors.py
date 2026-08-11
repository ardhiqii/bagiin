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
    H = {"X-Identity-Id": creator["id"]}
    Hb = {"X-Identity-Id": budi["id"]}

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
    assert c.post(f"/api/bills/{bid}/join", headers={"X-Identity-Id": db.new_identity("Caca")["id"]}).status_code == 403

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
    c.post(f"/api/bills/{bid}/close", headers={"X-Identity-Id": creator["id"]})
    # guest can't reopen
    assert c.post(f"/api/bills/{bid}/reopen", headers={"X-Identity-Id": budi["id"]}).status_code == 403
    # stranger can't reopen
    stranger = db.new_identity("X")
    assert c.post(f"/api/bills/{bid}/reopen", headers={"X-Identity-Id": stranger["id"]}).status_code == 403
    # reopen an open bill -> 400
    r = c.post(f"/api/bills/{bid}/reopen", headers={"X-Identity-Id": creator["id"]})
    assert r.status_code == 200
    assert c.post(f"/api/bills/{bid}/reopen", headers={"X-Identity-Id": creator["id"]}).status_code == 400
    print("PASS reopen permissions")


# ---------- payer placeholder (the "Amel/Budi" bug) ----------

def test_payer_placeholder_does_not_mark_creator_paid():
    """Regression: payer set by NAME before that person joins must NOT mark
    the creator as the payer / auto-paid (bug: fallback to creator)."""
    creator = db.new_identity("Aufa3", role="creator")
    bid = _mk_bill(creator, paid_by_name="Budi", items=[{"name": "A", "price": 60000}],
                   subtotal=60000, tax=6000, total=66000)
    r = c.get(f"/api/bills/{bid}", headers={"X-Identity-Id": creator["id"]})
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
    c.post(f"/api/bills/{bid}/join", headers={"X-Identity-Id": budi["id"]})
    r = c.post(f"/api/bills/{bid}/selections", headers={"X-Identity-Id": budi["id"]},
               json={"picks": [ids["A"]]})
    data = r.json()
    assert data["paid_by_id"] == budi["id"]
    assert data["paid_by_name"] == "Budi"
    budi_p = next(p for p in data["people"] if p["identity_id"] == budi["id"])
    assert budi_p["paid"] == "paid"
    assert data["settled"] is True
    print("PASS payer placeholder resolves on join + auto-paid")


def test_remove_person_clears_stale_payer():
    """Regression: removing the assigned payer must reset paid_by, not leave a ghost."""
    creator = db.new_identity("Aufa5", role="creator")
    budi = db.new_identity("Budi5")
    bid = _mk_bill(creator)
    c.post(f"/api/bills/{bid}/join", headers={"X-Identity-Id": budi["id"]})
    c.put(f"/api/bills/{bid}/paid_by", headers={"X-Identity-Id": creator["id"]},
          json={"identity_id": budi["id"]})
    r = c.get(f"/api/bills/{bid}", headers={"X-Identity-Id": creator["id"]})
    assert r.json()["paid_by_id"] == budi["id"]
    r = c.delete(f"/api/bills/{bid}/people/{budi['id']}", headers={"X-Identity-Id": creator["id"]})
    assert r.status_code == 200
    data = r.json()
    assert data["paid_by_id"] == creator["id"]  # falls back to creator
    assert all(p["identity_id"] != budi["id"] for p in data["people"])
    print("PASS remove_person clears stale payer")


# ---------- permissions ----------

def test_permissions_matrix():
    creator = db.new_identity("Aufa6", role="creator")
    budi = db.new_identity("Budi6")
    stranger = db.new_identity("Stranger")
    bid = _mk_bill(creator)
    ids = _ids(bid)
    H, Hb, Hs = ({"X-Identity-Id": x} for x in (creator["id"], budi["id"], stranger["id"]))

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
    Ha = {"X-Identity-Id": amel["id"]}
    Hb = {"X-Identity-Id": budi["id"]}
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
    r = c.put(f"/api/bills/{bid}", headers={"X-Identity-Id": creator["id"]}, json={
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
    """Warning says unpicked items 'masuk ke pembuat bill' -> split must match."""
    creator = db.new_identity("Aufa9", role="creator")
    budi = db.new_identity("Budi9")
    bid = _mk_bill(creator, items=[
        {"name": "Nasi", "price": 30000},
        {"name": "Ayam", "price": 30000},
    ], subtotal=60000, tax=0, total=60000)
    ids = _ids(bid)
    c.post(f"/api/bills/{bid}/selections", headers={"X-Identity-Id": budi["id"]},
           json={"picks": [ids["Nasi"]]})
    data = _compute_response(db.get_bill(bid))
    by = {p["identity_id"]: p for p in data["people"]}
    assert by[budi["id"]]["subtotal_idr"] == 30000
    assert by[creator["id"]]["subtotal_idr"] == 30000  # Ayam unpicked -> creator
    assert data["total_ok"] is True
    assert data["remaining_to_creator"] == 0
    assert any("masuk ke pembuat bill" in w for w in data["warnings"])
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
    c.post(f"/api/bills/{bid}/selections", headers={"X-Identity-Id": budi["id"]},
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
    Ha = {"X-Identity-Id": amel["id"]}
    Hb = {"X-Identity-Id": budi["id"]}
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
    c.post(f"/api/bills/{bid}/selections", headers={"X-Identity-Id": amel["id"]},
           json={"picks": [{"item_id": ids["Teh"], "qty": 2}]})
    c.post(f"/api/bills/{bid}/selections", headers={"X-Identity-Id": budi["id"]},
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
    r = c.post(f"/api/bills/{bid}/selections", headers={"X-Identity-Id": amel["id"]},
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
    Ha = {"X-Identity-Id": amel["id"]}
    # unknown item id
    r = c.post(f"/api/bills/{bid}/selections", headers=Ha, json={"picks": [{"item_id": 999999, "qty": 1}]})
    assert r.status_code == 400
    # discount > price
    r = c.put(f"/api/bills/{bid}", headers={"X-Identity-Id": creator["id"]}, json={
        "title": "X", "items": [{"name": "A", "price": 10000, "discount": 15000}],
        "participants": ["Aufa", "Budi"], "subtotal": -5000, "tax": 0, "service": 0, "total": -5000})
    assert r.status_code == 400
    # empty items on create
    r = c.post("/api/bills", headers={"X-Identity-Id": creator["id"]}, json={
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
    c.post(f"/api/bills/{bid}/join", headers={"X-Identity-Id": budi["id"]})
    c.post(f"/api/bills/{bid}/selections", headers={"X-Identity-Id": budi["id"]}, json={"picks": [ids["A"]]})
    # creator is default payer -> auto-paid; Budi paid -> settled in both views
    c.post(f"/api/bills/{bid}/payments/{budi['id']}/paid", headers={"X-Identity-Id": budi["id"]})
    detail = _compute_response(db.get_bill(bid))
    bills = db.get_bills_for_identity(creator["id"])
    row = next(b for b in bills if b["id"] == bid)
    assert detail["settled"] is True, detail["settled"]
    assert row["settled"] is True, row
    # unpay Budi -> both unsettled
    c.post(f"/api/bills/{bid}/payments/{budi['id']}/unpaid", headers={"X-Identity-Id": creator["id"]})
    detail = _compute_response(db.get_bill(bid))
    bills = db.get_bills_for_identity(creator["id"])
    row = next(b for b in bills if b["id"] == bid)
    assert detail["settled"] is False
    assert row["settled"] is False, row
    print("PASS settled detail == list")


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
    print("\nALL PASS")
