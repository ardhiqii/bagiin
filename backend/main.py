"""Bagiin - FastAPI backend."""
import io
import json
import os
import secrets
import time
import logging
from datetime import datetime, timezone
from pathlib import Path

# load .env from backend dir (GEMINI_API_KEY etc.)
_env_path = Path(__file__).resolve().parent / ".env"
if _env_path.exists():
    for line in _env_path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())

from fastapi import FastAPI, Request, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

import db
import calc
from ocr import ocr_receipt

app = FastAPI(title="Bagiin")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s: %(message)s")

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = Path(os.environ.get("BAGIIN_UPLOAD_DIR", "/var/www/bagiin-uploads"))
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"

db.init_db()


# ---------- helpers ----------

def _identity_from_request(request: Request):
    ident_id = request.headers.get("X-Identity-Id", "")
    if not ident_id:
        raise HTTPException(400, "Missing X-Identity-Id header")
    ident = db.get_identity(ident_id)
    if not ident:
        raise HTTPException(404, "Identity not found")
    return ident


def _bill_or_404(bill_id: str):
    data = db.get_bill(bill_id)
    if not data:
        raise HTTPException(404, "Bill not found")
    return data


def _owner_id(bill_data: dict) -> str:
    """Effective bill owner: the resolved payer, else the creator.

    The person who paid fronted the money, so they get the owner powers
    (edit, close, mark paid, delete...). Until a payer is resolved (either
    paid_by_identity_id set, or the placeholder name matches someone who
    joined/claimed), the creator stays in control.
    """
    bill = bill_data["bill"]
    pid = bill.get("paid_by_identity_id")
    if pid:
        return pid
    pname = (bill.get("paid_by_name") or "").strip().lower()
    if pname:
        for p in bill_data.get("payments", []):
            ident = db.get_identity(p["identity_id"])
            if ident and ident["name"].strip().lower() == pname:
                return ident["id"]
        for p in bill_data.get("participants", []):
            pident = p.get("identity_id")
            if pident:
                ident = db.get_identity(pident)
                if ident and ident["name"].strip().lower() == pname:
                    return ident["id"]
    return bill["creator_identity_id"]


def _names_for_identities(ident_ids: list[str]) -> dict[str, str]:
    out = {}
    for iid in ident_ids:
        ident = db.get_identity(iid)
        out[iid] = ident["name"] if ident else "?"
    return out


def _to_int(value, field: str, default=None, *, minv=None, maxv=None):
    """Parse an int from user input; 400 on malformed values instead of 500."""
    if value is None or value == "":
        if default is not None:
            return default
        raise HTTPException(400, f"{field} wajib angka")
    try:
        n = int(value)
    except (TypeError, ValueError):
        raise HTTPException(400, f"{field} wajib angka")
    if minv is not None and n < minv:
        raise HTTPException(400, f"{field} minimal {minv}")
    if maxv is not None and n > maxv:
        raise HTTPException(400, f"{field} maksimal {maxv}")
    return n


def generate_readable_code() -> str:
    """12-char code in 3 groups of 4, unambiguous alphabet (no 0/O/1/I/L)."""
    alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
    parts = ["".join(secrets.choice(alphabet) for _ in range(4)) for _ in range(3)]
    return "-".join(parts)


def _compute_response(bill_data: dict):
    """Compute split and return enriched payload for UI."""
    bill = bill_data["bill"]
    result = calc.compute(
        bill=bill,
        items=bill_data["items"],
        selections=bill_data["selections"],
        participants=bill_data["participants"],
        creator_id=bill["creator_identity_id"],
    )
    # attach names
    # merge joined-but-unselected people (payment rows) into the roster, so the
    # creator sees everyone who joined even before they pick items
    joined_ids = {p["identity_id"] for p in bill_data["payments"]}
    known_ids = {p["identity_id"] for p in result["people"]}
    for jid in joined_ids - known_ids:
        result["people"].append({
            "identity_id": jid, "subtotal_idr": 0, "tax_idr": 0, "total_idr": 0,
        })
    # creator is always part of the bill (visible in the split even before picking)
    if bill["creator_identity_id"] not in {p["identity_id"] for p in result["people"]}:
        result["people"].append({
            "identity_id": bill["creator_identity_id"], "subtotal_idr": 0, "tax_idr": 0, "total_idr": 0,
        })
    result["people"].sort(key=lambda p: -p["total_idr"])
    all_ids = [p["identity_id"] for p in result["people"]]
    names = _names_for_identities(all_ids)
    # claimed participants -> canonical display name (creator-typed casing, e.g. "Amel")
    claimed = {p["identity_id"]: p["name"] for p in bill_data["participants"]
               if p.get("identity_id")}
    for p in result["people"]:
        p["name"] = claimed.get(p["identity_id"]) or names.get(p["identity_id"], "?")
    # creator name
    creator = db.get_identity(bill["creator_identity_id"])
    creator_name = creator["name"] if creator else "?"
    # who paid? default = creator. paid_by_identity_id wins (unambiguous);
    # otherwise try matching paid_by_name against joined identities / claimed
    # participants. If still unresolved (placeholder name, person hasn't
    # joined), paid_by_id stays None -> nobody is auto-marked paid and the
    # bill can't be "settled" until the real payer joins and is resolved.
    paid_by_id = bill.get("paid_by_identity_id")
    paid_by_name = bill.get("paid_by_name") or ""
    if not paid_by_id and paid_by_name:
        target = paid_by_name.strip().lower()
        for p in bill_data["payments"]:
            ident = db.get_identity(p["identity_id"])
            if ident and ident["name"].strip().lower() == target:
                paid_by_id = p["identity_id"]
                break
        if not paid_by_id:
            for p in bill_data["participants"]:
                pid = p.get("identity_id")
                if pid:
                    ident = db.get_identity(pid)
                    if ident and ident["name"].strip().lower() == target:
                        paid_by_id = pid
                        break
    if not paid_by_id and not paid_by_name:
        paid_by_id = bill["creator_identity_id"]
        paid_by_name = creator_name
    elif paid_by_id:
        pb = db.get_identity(paid_by_id)
        if pb:
            paid_by_name = pb["name"]
    # payment status
    pay_status = {p["identity_id"]: p["status"] for p in bill_data["payments"]}
    for p in result["people"]:
        p["paid"] = pay_status.get(p["identity_id"], "unpaid")
        # payer already paid (they fronted the bill) -> always settled
        if p["identity_id"] == paid_by_id:
            p["paid"] = "paid"
    # item -> selectors for UI (list of {name, qty, id})
    sel_by_item = {}
    for s in bill_data["selections"]:
        sel_by_item.setdefault(s["item_id"], []).append({
            "name": s["identity_name"],
            "qty": int(s.get("qty", 1)),
            "id": s["identity_id"],
        })
    # settled: closed OR at least one item was actually picked AND everyone
    # with a share (total > 0) has paid, AND no empty slots remain. The
    # resolved payer counts as paid automatically. (A fresh bill with nothing
    # picked is NOT settled, even though unpicked items default to the creator.)
    sel_ids = {s["identity_id"] for s in bill_data["selections"]}
    owed_ids = {p["identity_id"] for p in result["people"] if p["total_idr"] > 0}
    paid_ids = {p["identity_id"] for p in bill_data["payments"] if p["status"] == "paid"}
    if paid_by_id:
        paid_ids.add(paid_by_id)
    settled = (
        bill["status"] == "closed"
        or (bool(sel_ids) and owed_ids <= paid_ids and result["uncovered_idr"] == 0)
    )
    return {
        "bill": bill,
        "owner_id": _owner_id(bill_data),
        "creator_name": creator_name,
        "creator_accounts": db.get_accounts(bill["creator_identity_id"]),
        "paid_by_id": paid_by_id,
        "paid_by_name": paid_by_name,
        "paid_by_accounts": db.get_accounts(paid_by_id),
        "items": bill_data["items"],
        "participants": [{"name": p["name"], "identity_id": p["identity_id"]} for p in bill_data["participants"]],
        "people": result["people"],
        "sel_by_item": sel_by_item,
        "warnings": result["warnings"],
        "total_ok": result["total_ok"],
        "remaining_to_creator": result["remaining_to_creator"],
        "unassigned_items": result["unassigned_items"],
        "uncovered_slots": result["uncovered_slots"],
        "uncovered_idr": result["uncovered_idr"],
        "settled": settled,
    }


# ---------- identity ----------

async def _read_json(request: Request) -> dict:
    try:
        raw = await request.body()
    except Exception:
        raise HTTPException(400, "Body required")
    if not raw:
        raise HTTPException(400, "Body required")
    try:
        return json.loads(raw)
    except Exception:
        raise HTTPException(400, "Invalid JSON")


@app.post("/api/identities")
@limiter.limit("30/minute")
async def create_identity(request: Request):
    data = await _read_json(request)
    name = (data.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "Name required")
    ident = db.new_identity(name, role="creator" if data.get("creator") else "guest")
    return ident


@app.post("/api/identities/restore")
@limiter.limit("10/minute")
async def restore_identity(request: Request):
    data = await _read_json(request)
    code = (data.get("code") or "").strip()
    ident = db.restore_identity(code)
    if not ident:
        raise HTTPException(404, "Code tidak dikenal")
    return ident


@app.post("/api/identities/{identity_id}/code")
async def set_code(identity_id: str, request: Request):
    _identity_from_request(request)
    data = await _read_json(request)
    code = (data.get("code") or "").strip()
    if len(code) < 8:
        raise HTTPException(400, "Code minimal 8 karakter")
    db.set_identity_code(identity_id, code)
    return {"ok": True}


@app.post("/api/identities/{identity_id}/code/generate")
@limiter.limit("5/minute")
async def generate_code(identity_id: str, request: Request):
    """Auto-generate a recovery code. Regenerating replaces (kills) the old one."""
    _identity_from_request(request)
    code = generate_readable_code()
    db.set_identity_code(identity_id, code)
    return {"code": code}


@app.post("/api/identities/{identity_id}/name")
async def update_name(identity_id: str, request: Request):
    _identity_from_request(request)
    data = await _read_json(request)
    name = (data.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "Nama wajib diisi")
    db.update_identity_name(identity_id, name)
    return {"ok": True}


@app.get("/api/identities/{identity_id}/accounts")
def list_accounts(identity_id: str, request: Request):
    _identity_from_request(request)
    return db.get_accounts(identity_id)


@app.post("/api/identities/{identity_id}/accounts")
@limiter.limit("30/minute")
async def add_account(identity_id: str, request: Request):
    _identity_from_request(request)
    data = await _read_json(request)
    brand = (data.get("brand") or "").strip()
    account_no = (data.get("account_no") or "").strip()
    if not brand or not account_no:
        raise HTTPException(400, "Brand dan nomor wajib diisi")
    holder = (data.get("holder_name") or "").strip() or None
    return db.add_account(identity_id, brand, account_no, holder)


@app.put("/api/accounts/{account_id}")
@limiter.limit("30/minute")
async def update_account(account_id: int, request: Request):
    ident = _identity_from_request(request)
    body = await request.json()
    brand = str(body.get("brand") or "").strip()
    account_no = str(body.get("account_no") or "").strip()
    holder_name = body.get("holder_name")
    holder_name = str(holder_name).strip() if holder_name else None
    if not brand or not account_no:
        raise HTTPException(400, "brand dan account_no wajib")
    acc = db.update_account(account_id, ident["id"], brand, account_no, holder_name)
    if not acc:
        raise HTTPException(404, "Akun tidak ditemukan")
    return acc


@app.delete("/api/accounts/{account_id}")
def delete_account(account_id: int, request: Request):
    ident = _identity_from_request(request)
    if not db.delete_account(account_id, ident["id"]):
        raise HTTPException(404, "Akun tidak ditemukan")
    return {"ok": True}


@app.get("/api/identities/{identity_id}/bills")
def my_bills(identity_id: str, request: Request):
    _identity_from_request(request)
    rows = db.get_bills_for_identity(identity_id)
    # expose the effective owner (resolved payer, else creator) so the UI can
    # show owner-only actions (delete) — mirrors _owner_id, including the
    # placeholder-name resolution that paid_by_identity_id alone misses
    for row in rows:
        bill_data = db.get_bill(row["id"])
        row["owner_id"] = _owner_id(bill_data) if bill_data else (row["paid_by_identity_id"] or row["creator_identity_id"])
    return rows


# ---------- bills ----------

@app.post("/api/bills")
@limiter.limit("10/minute")
async def create_bill(request: Request):
    data = await _read_json(request)
    ident = _identity_from_request(request)
    merchant = (data.get("merchant") or "").strip() or None
    transacted_at = (data.get("transacted_at") or "").strip() or None
    title = (data.get("title") or "").strip() or merchant or "Bill"
    items = data.get("items") or []
    if not isinstance(items, list) or not items:
        raise HTTPException(400, "Minimal 1 item")
    for i in items:
        if not isinstance(i, dict) or not str(i.get("name") or "").strip():
            raise HTTPException(400, "Nama item wajib diisi")
        price = _to_int(i.get("price"), f"Harga {i.get('name')}", minv=0)
        discount = _to_int(i.get("discount"), f"Diskon {i.get('name')}", 0, minv=0)
        if discount > price:
            raise HTTPException(400, f"Diskon {i['name']} gak bisa lebih besar dari harga")
    participants = [p.strip() for p in (data.get("participants") or []) if isinstance(p, str) and p.strip()]
    pc = data.get("participant_count")
    participant_count = _to_int(pc, "Jumlah orang") if pc not in (None, "") else None
    paid_by_name = (data.get("paid_by_name") or "").strip() or None
    subtotal = _to_int(data.get("subtotal"), "Subtotal", 0, minv=0)
    tax = _to_int(data.get("tax"), "Pajak", 0, minv=0)
    service = _to_int(data.get("service"), "Service", 0, minv=0)
    total = _to_int(data.get("total"), "Total", 0, minv=0)
    tax_included = 1 if data.get("tax_included") else 0
    # reject impossible combos instead of persisting a bill whose split can
    # never reconcile (bug: tax_included + tax>0 made sum(people) != total,
    # and an arbitrary total != subtotal+tax+service broke every invariant)
    if tax_included and tax > 0:
        raise HTTPException(400, "Kalau harga item sudah termasuk pajak, kolom Pajak harus 0")
    if total != subtotal + tax + service:
        raise HTTPException(400, "Total gak cocok sama subtotal + pajak + service")
    created = db.create_bill(
        creator_id=ident["id"],
        title=title,
        merchant=merchant,
        transacted_at=transacted_at,
        tax_mode=data.get("tax_mode", "proportional"),
        participant_count=participant_count,
        tax_included=tax_included,
        subtotal=subtotal,
        tax=tax,
        service=service,
        total=total,
        items=[{
            "name": i["name"],
            "price": _to_int(i["price"], f"Harga {i['name']}", minv=0),
            "mode": i.get("mode", "free"),
            "slot_count": _to_int(i.get("slot_count"), f"Slot {i['name']}", 1, minv=1) if i.get("mode") == "slot" else None,
            "discount": _to_int(i.get("discount"), f"Diskon {i['name']}", 0, minv=0),
        } for i in items],
        participants=participants,
        photo_path=data.get("photo_path"),
        paid_by_name=paid_by_name,
    )
    return created


@app.get("/api/bills/{bill_id}")
def get_bill(bill_id: str, request: Request):
    data = _bill_or_404(bill_id)
    return _compute_response(data)


@app.put("/api/bills/{bill_id}")
async def update_bill(bill_id: str, request: Request):
    data = await _read_json(request)
    bill_data = _bill_or_404(bill_id)
    ident = _identity_from_request(request)
    if _owner_id(bill_data) != ident["id"]:
        raise HTTPException(403, "Hanya owner bill (yang bayar)")
    if bill_data["bill"]["status"] != "open":
        raise HTTPException(403, "Bill sudah ditutup, gak bisa diedit")
    items = data.get("items") or []
    if not isinstance(items, list) or not items:
        raise HTTPException(400, "Minimal 1 item")
    for i in items:
        if not isinstance(i, dict) or not str(i.get("name") or "").strip():
            raise HTTPException(400, "Nama item wajib diisi")
        price = _to_int(i.get("price"), f"Harga {i.get('name')}", minv=0)
        discount = _to_int(i.get("discount"), f"Diskon {i.get('name')}", 0, minv=0)
        if discount > price:
            raise HTTPException(400, f"Diskon {i['name']} gak bisa lebih besar dari harga")
    # slot-mode guards for edited items: slot_count >= taken, and switching a
    # slot item to free clamps everyone's qty to 1
    cur_items = {i["id"]: i for i in bill_data["items"]}
    taken_by_item: dict[int, int] = {}
    for s in bill_data["selections"]:
        taken_by_item[s["item_id"]] = taken_by_item.get(s["item_id"], 0) + int(s.get("qty", 1))
    for it in items:
        iid = it.get("id")
        mode = it.get("mode", "free")
        if not iid:
            continue
        cur = cur_items.get(int(iid))
        if not cur:
            continue
        if mode == "slot":
            sc = it.get("slot_count")
            try:
                sc = max(1, int(sc or 1))
            except (TypeError, ValueError):
                sc = 1
            taken = taken_by_item.get(int(iid), 0)
            if sc < taken:
                raise HTTPException(400, f"Slot {it['name']} minimal {taken} (sudah keambil {taken})")
        elif cur["mode"] == "slot":
            # switching to free: clamp qty to 1 (people stay selected once)
            db.clamp_selection_qty(bill_id, int(iid))
    participants = [p.strip() for p in (data.get("participants") or []) if isinstance(p, str) and p.strip()]
    pc = data.get("participant_count")
    participant_count = _to_int(pc, "Jumlah orang") if pc not in (None, "") else None
    subtotal_v = _to_int(data.get("subtotal"), "Subtotal", 0, minv=0)
    tax_v = _to_int(data.get("tax"), "Pajak", 0, minv=0)
    service_v = _to_int(data.get("service"), "Service", 0, minv=0)
    total_v = _to_int(data.get("total"), "Total", 0, minv=0)
    # same impossible-combo guards as create
    if data.get("tax_included") and tax_v > 0:
        raise HTTPException(400, "Kalau harga item sudah termasuk pajak, kolom Pajak harus 0")
    if total_v != subtotal_v + tax_v + service_v:
        raise HTTPException(400, "Total gak cocok sama subtotal + pajak + service")
    db.update_bill(
        bill_id,
        title=(data.get("title") or "").strip() or bill_data["bill"]["title"],
        merchant=(data.get("merchant") or "").strip() or None,
        transacted_at=(data.get("transacted_at") or "").strip() or None,
        participants=participants,
        participant_count=participant_count,
        items=[{
            "id": i.get("id"),
            "name": i["name"],
            "price": _to_int(i["price"], f"Harga {i['name']}", minv=0),
            "mode": i.get("mode", "free"),
            "slot_count": _to_int(i.get("slot_count"), f"Slot {i['name']}", 1, minv=1) if i.get("mode") == "slot" else None,
            "discount": _to_int(i.get("discount"), f"Diskon {i['name']}", 0, minv=0),
        } for i in items],
        subtotal=subtotal_v,
        tax=tax_v,
        service=service_v,
        total=total_v,
        tax_included=1 if data.get("tax_included") else 0,
    )
    return _compute_response(db.get_bill(bill_id))


@app.put("/api/bills/{bill_id}/paid_by")
async def set_paid_by(bill_id: str, request: Request):
    """Creator assigns who paid the bill. Body: {identity_id} or {name}.
    identity_id is preferred (unambiguous); name works as a placeholder for
    someone who hasn't joined yet (resolved on join)."""
    data = await _read_json(request)
    bill_data = _bill_or_404(bill_id)
    ident = _identity_from_request(request)
    if _owner_id(bill_data) != ident["id"]:
        raise HTTPException(403, "Hanya owner bill (yang bayar)")
    if bill_data["bill"]["status"] != "open":
        raise HTTPException(403, "Bill sudah ditutup, gak bisa diubah")
    identity_id = data.get("identity_id")
    name = (data.get("name") or "").strip() or None
    if identity_id:
        # validate identity exists & is part of this bill (roster)
        target = db.get_identity(identity_id)
        if not target:
            raise HTTPException(404, "Orang gak ditemukan")
        roster_ids = {p["identity_id"] for p in bill_data["payments"]}
        roster_ids.add(bill_data["bill"]["creator_identity_id"])
        if identity_id not in roster_ids:
            raise HTTPException(400, "Orang itu belum join bill ini")
        name = target["name"]
    elif name:
        # name placeholder: resolve immediately against people already joined /
        # claimed, so paid_by_identity_id is set and owner checks stay
        # consistent (bug: hand-off by name to someone already joined left the
        # column NULL -> owner mismatch -> bill undeletable by anyone)
        target_l = name.strip().lower()
        for p in bill_data["payments"]:
            ident = db.get_identity(p["identity_id"])
            if ident and ident["name"].strip().lower() == target_l:
                identity_id = ident["id"]
                name = ident["name"]
                break
        if not identity_id:
            for p in bill_data["participants"]:
                pid = p.get("identity_id")
                if pid:
                    ident = db.get_identity(pid)
                    if ident and ident["name"].strip().lower() == target_l:
                        identity_id = ident["id"]
                        name = ident["name"]
                        break
    db.set_paid_by(bill_id, identity_id, name)
    return _compute_response(db.get_bill(bill_id))


@app.delete("/api/bills/{bill_id}")
def delete_bill(bill_id: str, request: Request):
    bill_data = _bill_or_404(bill_id)
    ident = _identity_from_request(request)
    if _owner_id(bill_data) != ident["id"]:
        raise HTTPException(403, "Hanya owner bill (yang bayar)")
    if not db.delete_bill(bill_id, ident["id"]):
        raise HTTPException(404, "Bill tidak ditemukan")
    return {"ok": True}


@app.post("/api/bills/{bill_id}/close")
def close_bill(bill_id: str, request: Request):
    bill_data = _bill_or_404(bill_id)
    ident = _identity_from_request(request)
    if _owner_id(bill_data) != ident["id"]:
        raise HTTPException(403, "Hanya owner bill (yang bayar)")
    db.close_bill(bill_id)
    return {"ok": True}


@app.post("/api/bills/{bill_id}/join")
def join_bill(bill_id: str, request: Request):
    bill_data = _bill_or_404(bill_id)
    if bill_data["bill"]["status"] != "open":
        raise HTTPException(403, "Bill sudah ditutup")
    ident = _identity_from_request(request)
    db.join_bill(bill_id, ident["id"], ident["name"])
    return _compute_response(db.get_bill(bill_id))


@app.delete("/api/bills/{bill_id}/people/{identity_id}")
def remove_person(bill_id: str, identity_id: str, request: Request):
    bill_data = _bill_or_404(bill_id)
    ident = _identity_from_request(request)
    if _owner_id(bill_data) != ident["id"]:
        raise HTTPException(403, "Hanya owner bill (yang bayar)")
    if bill_data["bill"]["status"] != "open":
        raise HTTPException(403, "Bill sudah ditutup")
    if identity_id == ident["id"]:
        raise HTTPException(400, "Gak bisa hapus diri sendiri (owner bill)")
    if identity_id == bill_data["bill"]["creator_identity_id"]:
        raise HTTPException(400, "Pembuat bill gak bisa dihapus")
    db.remove_person(bill_id, identity_id)
    return _compute_response(db.get_bill(bill_id))


@app.post("/api/bills/{bill_id}/selections")
async def set_selections(bill_id: str, request: Request):
    data = await _read_json(request)
    bill_data = _bill_or_404(bill_id)
    if bill_data["bill"]["status"] != "open":
        raise HTTPException(403, "Bill sudah ditutup")
    ident = _identity_from_request(request)
    raw_picks = data.get("picks") or []
    # legacy: bare item_ids list (qty 1 each)
    if not raw_picks and data.get("item_ids"):
        raw_picks = [{"item_id": i} for i in data.get("item_ids")]
    picks = []
    for p in raw_picks:
        if isinstance(p, dict):
            iid = _to_int(p.get("item_id"), "Item", minv=1)
            qty = _to_int(p.get("qty"), "Jumlah", 1, minv=1, maxv=99)
            picks.append({"item_id": iid, "qty": qty})
        else:
            # legacy bare item_id (qty 1)
            picks.append({"item_id": _to_int(p, "Item", minv=1), "qty": 1})
    valid = {i["id"]: i for i in bill_data["items"]}
    if any(p["item_id"] not in valid for p in picks):
        raise HTTPException(400, "Item invalid")
    # merge duplicate item ids
    merged: dict[int, int] = {}
    for p in picks:
        merged[p["item_id"]] = merged.get(p["item_id"], 0) + p["qty"]
    picks = [{"item_id": k, "qty": v} for k, v in merged.items()]
    # slot capacity check: per item, sum of other people's qty + mine <= slot_count
    others: dict[int, int] = {}
    for s in bill_data["selections"]:
        if s["identity_id"] == ident["id"]:
            continue
        others[s["item_id"]] = others.get(s["item_id"], 0) + int(s.get("qty", 1))
    for p in picks:
        it = valid[p["item_id"]]
        if it["mode"] == "slot" and it["slot_count"]:
            if p["qty"] > it["slot_count"]:
                raise HTTPException(400, f"Slot {it['name']} cuma {it['slot_count']}")
            if others.get(p["item_id"], 0) + p["qty"] > it["slot_count"]:
                left = it["slot_count"] - others.get(p["item_id"], 0)
                raise HTTPException(400, f"Slot {it['name']} tinggal {left}")
        elif p["qty"] > 99:
            raise HTTPException(400, f"{it['name']} maksimal 99 porsi")
    db.claim_participant(bill_id, ident["id"], ident["name"])
    try:
        db.set_selections(bill_id, ident["id"], picks)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return _compute_response(db.get_bill(bill_id))


@app.put("/api/bills/{bill_id}/items/{item_id}/slots")
async def set_item_slots(bill_id: str, item_id: int, request: Request):
    """Creator changes an item's slot count (must be >= slots already taken)."""
    data = await _read_json(request)
    bill_data = _bill_or_404(bill_id)
    ident = _identity_from_request(request)
    if _owner_id(bill_data) != ident["id"]:
        raise HTTPException(403, "Hanya owner bill (yang bayar)")
    if bill_data["bill"]["status"] != "open":
        raise HTTPException(403, "Bill sudah ditutup, gak bisa diubah")
    item = next((i for i in bill_data["items"] if i["id"] == item_id), None)
    if not item:
        raise HTTPException(404, "Item tidak ditemukan")
    if item["mode"] != "slot":
        raise HTTPException(400, "Item ini bukan mode slot")
    try:
        slot_count = int(data.get("slot_count") or 0)
    except (TypeError, ValueError):
        raise HTTPException(400, "slot_count invalid")
    if slot_count < 1:
        raise HTTPException(400, "Slot minimal 1")
    taken = sum(int(s.get("qty", 1)) for s in bill_data["selections"] if s["item_id"] == item_id)
    if slot_count < taken:
        raise HTTPException(400, f"Slot minimal {taken} (sudah keambil {taken})")
    if not db.set_item_slots(bill_id, item_id, slot_count):
        raise HTTPException(404, "Item tidak ditemukan")
    return _compute_response(db.get_bill(bill_id))


@app.delete("/api/bills/{bill_id}/items/{item_id}/selections/{identity_id}")
async def release_selection(bill_id: str, item_id: int, identity_id: str, request: Request):
    """Release a person's slot(s) on one item. Owner or creator can do it
    (e.g. mis-tap, or someone bailed and the creator frees their slots)."""
    bill_data = _bill_or_404(bill_id)
    ident = _identity_from_request(request)
    if bill_data["bill"]["status"] != "open":
        raise HTTPException(403, "Bill sudah ditutup")
    if ident["id"] != identity_id and _owner_id(bill_data) != ident["id"]:
        raise HTTPException(403, "Cuma pemilik slot atau pembuat bill yang bisa lepas")
    item = next((i for i in bill_data["items"] if i["id"] == item_id), None)
    if not item:
        raise HTTPException(404, "Item tidak ditemukan")
    if not db.get_selection(bill_id, item_id, identity_id):
        raise HTTPException(404, "Orang itu gak punya slot di item ini")
    db.set_selection_qty(bill_id, identity_id, item_id, 0)
    return _compute_response(db.get_bill(bill_id))


@app.post("/api/bills/{bill_id}/payments/{identity_id}/paid")
def mark_paid(bill_id: str, identity_id: str, request: Request):
    """Mark a person as paid. Only the person themselves or the bill creator
    can do it (e.g. someone transferred money but won't open the app)."""
    bill_data = _bill_or_404(bill_id)
    if bill_data["bill"]["status"] != "open":
        raise HTTPException(403, "Bill sudah ditutup, gak bisa ubah status bayar")
    ident = _identity_from_request(request)
    if ident["id"] != identity_id and _owner_id(bill_data) != ident["id"]:
        raise HTTPException(403, "Gak bisa ubah status bayar orang lain")
    db.claim_participant(bill_id, ident["id"], ident["name"])
    db.mark_paid(bill_id, identity_id)
    return _compute_response(db.get_bill(bill_id))


@app.post("/api/bills/{bill_id}/payments/{identity_id}/unpaid")
def mark_unpaid(bill_id: str, identity_id: str, request: Request):
    """Undo 'sudah bayar'. Only the payer or the bill creator can undo."""
    bill_data = _bill_or_404(bill_id)
    if bill_data["bill"]["status"] != "open":
        raise HTTPException(403, "Bill sudah ditutup, gak bisa ubah status bayar")
    ident = _identity_from_request(request)
    if ident["id"] != identity_id and _owner_id(bill_data) != ident["id"]:
        raise HTTPException(403, "Gak bisa ubah status bayar orang lain")
    db.mark_unpaid(bill_id, identity_id)
    return _compute_response(db.get_bill(bill_id))


@app.post("/api/bills/{bill_id}/reopen")
def reopen_bill(bill_id: str, request: Request):
    """Creator reopens a closed bill (mis-close / someone still needs to pay)."""
    bill_data = _bill_or_404(bill_id)
    ident = _identity_from_request(request)
    if _owner_id(bill_data) != ident["id"]:
        raise HTTPException(403, "Hanya owner bill (yang bayar)")
    if bill_data["bill"]["status"] != "closed":
        raise HTTPException(400, "Bill belum ditutup")
    db.reopen_bill(bill_id)
    return _compute_response(db.get_bill(bill_id))


@app.post("/api/bills/{bill_id}/photo")
@limiter.limit("10/minute")
async def upload_photo(bill_id: str, request: Request, file: UploadFile = File(...)):
    bill_data = _bill_or_404(bill_id)
    ident = _identity_from_request(request)
    if _owner_id(bill_data) != ident["id"]:
        raise HTTPException(403, "Hanya owner bill (yang bayar)")
    raw = await file.read()
    if len(raw) > 5 * 1024 * 1024:
        raise HTTPException(400, "Foto maksimal 5MB")
    filename = secrets.token_hex(8) + ".jpg"
    path = UPLOAD_DIR / filename
    path.write_bytes(raw)
    db.update_bill_photo(bill_id, str(path))
    return {"photo_path": str(path), "filename": filename}


@app.post("/api/ocr")
@limiter.limit("10/minute")
async def ocr_upload(request: Request, file: UploadFile = File(...)):
    """OCR a receipt photo -> structured items (draft, belum disimpan)."""
    raw = await file.read()
    if len(raw) > 5 * 1024 * 1024:
        raise HTTPException(400, "Foto maksimal 5MB")
    mime = file.content_type or "image/jpeg"
    if mime == "image/heic":
        raise HTTPException(400, "Format HEIC belum didukung, pilih foto JPEG/PNG")
    try:
        result = ocr_receipt(raw, mime_type=mime)
    except RuntimeError as e:
        # 4xx supaya Cloudflare gak nelen body-nya (5xx diubah CF jadi HTML error page)
        raise HTTPException(422, str(e))
    # keep photo for bill creation
    filename = secrets.token_hex(8) + ".jpg"
    path = UPLOAD_DIR / filename
    path.write_bytes(raw)
    result["photo_path"] = str(path)
    return result


@app.get("/uploads/{filename}")
def serve_photo(filename: str):
    path = UPLOAD_DIR / filename
    if not path.exists():
        raise HTTPException(404)
    return FileResponse(path, media_type="image/jpeg", headers={
        "Cache-Control": "private, max-age=31536000, immutable",
    })


# ---------- static frontend ----------

app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR / "static")), name="static")


@app.get("/")
def index():
    return FileResponse(str(FRONTEND_DIR / "index.html"))
