"""Regression tests for bugs found in the v47 audit pass (backend + OCR).

Covers:
- account takeover: identity endpoints must operate on the authenticated
  identity, not the path identity_id (set_code / name / accounts / my_bills)
- subtotal validation on create + update (subtotal != sum item eff -> 400)
- duplicate participant names deduped instead of 500
- participant_count >= 0
- mark_paid with unknown identity -> 404, and no SQLite lock wedge
- OCR normalize: float prices, tax_included string truthiness, non-list items,
  negative clamps, total/subtotal reconciliation

Run:
  cd backend && venv/bin/python -m pytest test_regressions_v47.py -q
"""
import os
import sys
import tempfile
import time
from pathlib import Path

_tmp = Path(tempfile.mkdtemp()) / "test47.db"
os.environ["BAGIIN_DB"] = str(_tmp)
os.environ["BAGIIN_UPLOAD_DIR"] = str(Path(tempfile.mkdtemp()) / "uploads")

sys.path.insert(0, str(Path(__file__).resolve().parent))

import db
db.init_db()

import ocr
from fastapi.testclient import TestClient
from main import app

app.state.limiter.enabled = False
c = TestClient(app, raise_server_exceptions=False)


def _mk_bill(creator, title="Makan", subtotal=0, tax=0, service=0, total=0,
             items=None, participants=None, tax_included=0, tax_mode="proportional",
             paid_by_name=None):
    data = db.create_bill(
        creator_id=creator["id"], title=title, tax_mode=tax_mode,
        subtotal=subtotal, tax=tax, service=service, total=total,
        items=items or [{"name": "A", "price": subtotal or 1}],
        participants=participants or ["Aufa", "Budi"],
        tax_included=tax_included, paid_by_name=paid_by_name,
    )
    return data["id"]


# ---------- account takeover ----------

def test_set_code_rejects_other_identity():
    alice = db.new_identity("Alice47")
    bob = db.new_identity("Bob47")
    r = c.post(f"/api/identities/{alice['id']}/code",
               json={"code": "pwned-12345678"}, headers={"X-Identity-Id": bob["id"]})
    assert r.status_code == 403, r.text


def test_generate_code_rejects_other_identity():
    alice = db.new_identity("Alice47b")
    bob = db.new_identity("Bob47b")
    r = c.post(f"/api/identities/{alice['id']}/code/generate",
               headers={"X-Identity-Id": bob["id"]})
    assert r.status_code == 403, r.text


def test_update_name_rejects_other_identity():
    alice = db.new_identity("Alice47c")
    bob = db.new_identity("Bob47c")
    r = c.post(f"/api/identities/{alice['id']}/name",
               json={"name": "Hacked"}, headers={"X-Identity-Id": bob["id"]})
    assert r.status_code == 403, r.text


def test_accounts_rejects_other_identity():
    alice = db.new_identity("Alice47d")
    bob = db.new_identity("Bob47d")
    r = c.get(f"/api/identities/{alice['id']}/accounts",
              headers={"X-Identity-Id": bob["id"]})
    assert r.status_code == 403, r.text
    r = c.post(f"/api/identities/{alice['id']}/accounts",
               json={"brand": "BCA", "account_no": "123"}, headers={"X-Identity-Id": bob["id"]})
    assert r.status_code == 403, r.text


def test_my_bills_rejects_other_identity():
    alice = db.new_identity("Alice47e")
    bob = db.new_identity("Bob47e")
    r = c.get(f"/api/identities/{alice['id']}/bills",
              headers={"X-Identity-Id": bob["id"]})
    assert r.status_code == 403, r.text


def test_own_identity_endpoints_still_work():
    alice = db.new_identity("Alice47f")
    H = {"X-Identity-Id": alice["id"]}
    assert c.post(f"/api/identities/{alice['id']}/code",
                  json={"code": "mysecret123"}, headers=H).status_code == 200
    assert c.post(f"/api/identities/{alice['id']}/name",
                  json={"name": "Alice Baru"}, headers=H).status_code == 200
    assert c.get(f"/api/identities/{alice['id']}/accounts", headers=H).status_code == 200
    assert c.get(f"/api/identities/{alice['id']}/bills", headers=H).status_code == 200


# ---------- subtotal validation ----------

def test_create_rejects_subtotal_mismatch():
    alice = db.new_identity("Alice47g")
    H = {"X-Identity-Id": alice["id"]}
    r = c.post("/api/bills", json={
        "title": "mismatch", "participants": ["Alice47g"], "participant_count": 1,
        "items": [{"name": "X", "price": 1000, "discount": 0, "mode": "free"}],
        "subtotal": 9000, "tax": 0, "service": 0, "total": 9000,
        "tax_mode": "proportional", "tax_included": False,
    }, headers=H)
    assert r.status_code == 400, r.text
    assert "Subtotal" in r.json()["detail"]


def test_create_accepts_matching_subtotal_with_discount():
    alice = db.new_identity("Alice47h")
    H = {"X-Identity-Id": alice["id"]}
    r = c.post("/api/bills", json={
        "title": "ok", "participants": ["Alice47h"], "participant_count": 1,
        "items": [{"name": "X", "price": 1000, "discount": 200, "mode": "free"}],
        "subtotal": 800, "tax": 100, "service": 0, "total": 900,
        "tax_mode": "proportional", "tax_included": False,
    }, headers=H)
    assert r.status_code == 200, r.text


def test_update_rejects_subtotal_mismatch():
    alice = db.new_identity("Alice47i")
    H = {"X-Identity-Id": alice["id"]}
    bid = _mk_bill(alice, subtotal=5000, total=5000,
                   items=[{"name": "A", "price": 5000}])
    r = c.put(f"/api/bills/{bid}", json={
        "title": "edit", "participants": ["Alice47i"], "participant_count": 1,
        "items": [{"name": "X", "price": 1000, "discount": 0, "mode": "free"}],
        "subtotal": 7000, "tax": 0, "service": 0, "total": 7000,
        "tax_mode": "proportional", "tax_included": False,
    }, headers=H)
    assert r.status_code == 400, r.text


# ---------- duplicate participants + count ----------

def test_duplicate_participants_deduped():
    alice = db.new_identity("Alice47j")
    H = {"X-Identity-Id": alice["id"]}
    r = c.post("/api/bills", json={
        "title": "dup", "participants": ["Alice47j", "ALICE47J", "  alice47j  "],
        "participant_count": 3,
        "items": [{"name": "X", "price": 100, "discount": 0, "mode": "free"}],
        "subtotal": 100, "tax": 0, "service": 0, "total": 100,
        "tax_mode": "proportional", "tax_included": False,
    }, headers=H)
    assert r.status_code == 200, r.text
    d = db.get_bill(r.json()["id"])
    assert len(d["participants"]) == 1, d["participants"]


def test_negative_participant_count_rejected():
    alice = db.new_identity("Alice47k")
    H = {"X-Identity-Id": alice["id"]}
    r = c.post("/api/bills", json={
        "title": "neg", "participants": ["Alice47k"], "participant_count": -3,
        "items": [{"name": "X", "price": 100, "discount": 0, "mode": "free"}],
        "subtotal": 100, "tax": 0, "service": 0, "total": 100,
        "tax_mode": "proportional", "tax_included": False,
    }, headers=H)
    assert r.status_code == 400, r.text


# ---------- mark_paid unknown identity ----------

def test_mark_paid_unknown_identity_404_no_lock_wedge():
    alice = db.new_identity("Alice47l")
    H = {"X-Identity-Id": alice["id"]}
    bid = _mk_bill(alice, subtotal=5000, total=5000,
                   items=[{"name": "A", "price": 5000}])
    r = c.post(f"/api/bills/{bid}/payments/nonexistent-zzz/paid", headers=H)
    assert r.status_code == 404, r.text
    # next write must NOT hang 5s / 500 (previously the open transaction
    # wedged the SQLite lock after the FK violation)
    t0 = time.time()
    r2 = c.post(f"/api/bills/{bid}/payments/{alice['id']}/paid", headers=H)
    dt = time.time() - t0
    assert r2.status_code == 200, r2.text
    assert dt < 3, f"write hung {dt:.1f}s (lock wedged?)"


# ---------- OCR normalize ----------

def test_ocr_to_int_float_no_10x():
    assert ocr._to_int("15000.0") == 15000
    assert ocr._to_int(15000.5) == 15000
    assert ocr._to_int(15000.7) == 15001
    assert ocr._to_int("Rp 15.000") == 15000
    assert ocr._to_int("15.000") == 15000
    assert ocr._to_int("15,5") == 16
    assert ocr._to_int(None) == 0
    assert ocr._to_int("abc") == 0


def test_ocr_tax_included_string_false_is_false():
    n = ocr._normalize({"tax_included": "false", "subtotal": 1000, "tax": 100, "total": 1100})
    assert n["tax_included"] is False, n
    assert n["tax"] == 100
    assert n["total"] == 1100
    n2 = ocr._normalize({"tax_included": "0", "subtotal": 1000, "tax": 100, "total": 1100})
    assert n2["tax_included"] is False, n2
    n3 = ocr._normalize({"tax_included": "true", "subtotal": 1000, "tax": 100, "total": 1100})
    assert n3["tax_included"] is True, n3


def test_ocr_items_non_list_and_negative_clamp():
    n = ocr._normalize({"items": None, "subtotal": -5000, "tax": -100, "total": -5100})
    assert n["items"] == []
    assert n["subtotal"] == 0
    assert n["tax"] == 0
    assert n["total"] == 0
    n2 = ocr._normalize({"items": {"0": {"name": "X", "price": 100}}, "subtotal": 0, "total": 0})
    assert n2["items"] == []
    n3 = ocr._normalize({"items": [{"name": "X", "price": -100}], "subtotal": 0, "total": 0})
    assert n3["items"] == []  # negative price item dropped


def test_ocr_reconciles_total_and_subtotal():
    # LLM total contradicting subtotal+tax+service -> reconciled (create would 400)
    n = ocr._normalize({"items": [{"name": "A", "price": 10000}],
                        "subtotal": 10000, "tax": 1000, "service": 0,
                        "total": 12345, "tax_included": False})
    assert n["total"] == 11000, n
    # LLM subtotal contradicting sum of items -> reconciled to item sum
    n2 = ocr._normalize({"items": [{"name": "A", "price": 10000}, {"name": "B", "price": 5000}],
                         "subtotal": 9000, "tax": 1000, "service": 0,
                         "total": 16000, "tax_included": False})
    assert n2["subtotal"] == 15000, n2
    assert n2["total"] == 16000, n2


# ---------- OCR endpoint auth ----------

def test_ocr_endpoint_requires_identity():
    r = c.post("/api/ocr", headers={},
               files={"file": ("x.jpg", b"not-an-image", "image/jpeg")})
    assert r.status_code in (400, 401, 403), r.text
