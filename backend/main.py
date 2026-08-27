"""Bagiin - FastAPI backend."""
import io
import json
import os
import re
import secrets
import time
import hashlib
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
from fastapi.responses import JSONResponse, FileResponse, Response
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
    """Resolve + AUTHENTICATE the caller.

    The id is public — every bill payload lists the ids of everyone on it, so
    anyone holding the share link knows the creator's id. Authentication is the
    `X-Identity-Secret` header, which only ever reaches the device that created
    (or restored) the identity. (bug: id-only auth meant a guest could replay
    the creator's id to rename them, attach their own bank account to the
    creator's profile, mint a recovery code and own the account for good.)

    Identities created before v51 have no secret; they keep working until the
    client calls /bind, which mints one (trust on first use).
    """
    ident_id = request.headers.get("X-Identity-Id", "")
    if not ident_id:
        raise HTTPException(400, "Header X-Identity-Id wajib diisi")
    ident = db.get_identity(ident_id)
    if not ident:
        raise HTTPException(404, "Identitas tidak ditemukan")
    stored = ident.get("secret")
    if stored:
        given = request.headers.get("X-Identity-Secret", "")
        if not given or not secrets.compare_digest(str(stored), given):
            raise HTTPException(403, "Sesi tidak valid, coba masuk ulang")
    return ident


def _viewer_id(request: Request) -> str | None:
    """Best-effort caller for read-only endpoints.

    The bill link alone grants read access, so a missing or stale identity
    header must not 4xx here — it only means the viewer gets no management
    flags in the payload.
    """
    try:
        return _identity_from_request(request)["id"]
    except HTTPException:
        return None


def _bill_or_404(bill_id: str):
    data = db.get_bill(bill_id)
    if not data:
        raise HTTPException(404, "Bill tidak ditemukan")
    return data


def _owner_id(bill_data: dict) -> str:
    """Effective bill owner: the CONFIRMED payer, else the creator.

    The person who fronted the money gets the owner powers (edit, close, mark
    paid, delete...), but only once a manager picked them on purpose. A payer
    that merely resolved by matching `paid_by_name` is a display convenience —
    granting it ownership let anyone who joined under that name take the bill
    over (bug: bill created "dibayar Budi", a guest named budi opens the link
    and can delete it).
    """
    bill = bill_data["bill"]
    pid = bill.get("paid_by_identity_id")
    if pid and bill.get("paid_by_confirmed"):
        return pid
    return bill["creator_identity_id"]


def _can_manage(bill_data: dict, ident_id: str) -> bool:
    """Management powers: the CONFIRMED payer is the sole manager (v57).

    The person who fronted the money holds the bill. Before any payer is
    confirmed the creator manages; once a manager explicitly confirms a
    payer, power moves to them completely. A payer matched only by name
    never manages (v51). (bug history: v48 made the payer sole owner and
    the creator could no longer fix their own bill — v49 added the creator
    as permanent co-owner; v57 removes that co-ownership again, now that
    the confirmed-payer distinction means name-matching can't hijack it.)
    """
    return _owner_id(bill_data) == ident_id


def _is_bill_member(bill_data: dict, ident_id: str) -> bool:
    """Is this identity actually on the bill: a payment row (joined), a
    selection (picked something), or the creator who hasn't left?

    Same membership test `leave_bill` uses to guard exits. `mark_paid` reuses
    it (v66) -- it used to only check "is this me", never "am I on this
    bill", so anyone holding the share link could call `/paid` with their own
    id and self-insert into the roster without ever calling `/join` (`db.
    mark_paid`'s `INSERT OR IGNORE` creates the payment row on its own). That
    is `/join` in every effect except one: it also flips `len(people) > 1`,
    one of the two guards that stop a solo bill from auto-settling (bug:
    v66 audit).
    """
    bill = bill_data["bill"]
    if ident_id == bill["creator_identity_id"] and not bill.get("creator_left"):
        return True
    if any(p["identity_id"] == ident_id for p in bill_data["payments"]):
        return True
    return any(s["identity_id"] == ident_id for s in bill_data["selections"])


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


def _to_str(value, field: str, *, maxlen: int | None = None) -> str:
    """Text from user input, 400 on anything that isn't text.

    A dict or a list here used to sail through `(x or "").strip()` (AttributeError)
    or straight into sqlite3 (InterfaceError) — either way a 500, and Cloudflare
    replaces 5xx bodies with its own error page, so the client saw HTML instead
    of a message (bug: v65 audit).
    """
    if value is None:
        return ""
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        value = str(value)
    if not isinstance(value, str):
        raise HTTPException(400, f"{field} harus teks")
    v = value.strip()
    if maxlen is not None and len(v) > maxlen:
        raise HTTPException(400, f"{field} maksimal {maxlen} karakter")
    return v


_MAX_IDR = 10**12  # a trillion rupiah -- comfortably above any real bill,
# comfortably below what sqlite3's INSERT can choke on. `_to_int` calls for
# money had `minv=0` but no `maxv`, so e.g. `1e20` reached sqlite3 and raised
# `OverflowError: Python int too large to convert to SQLite INTEGER` -> 500
# (bug: v66 audit, a 20-digit price in a create/update payload).

_ALLOWED_PHOTO_MIME = {"image/jpeg", "image/png", "image/webp"}


def _check_photo_mime(content_type: str | None):
    """Reject anything that isn't a real photo (400, casual Indonesian).

    `/api/ocr` already rejects `image/heic`; these two endpoints checked size
    only, so a HEIC or a plain text file sailed through as 200, got stored as
    `<hex>.jpg`, got a `bill_photo` row, and the uploader got a success toast
    plus a broken thumbnail (bug: v66 audit).
    """
    if (content_type or "") not in _ALLOWED_PHOTO_MIME:
        raise HTTPException(400, "Format foto tidak didukung, pilih JPEG/PNG/WEBP")


def generate_readable_code() -> str:
    """12-char code in 3 groups of 4, unambiguous alphabet (no 0/O/1/I/L)."""
    alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
    parts = ["".join(secrets.choice(alphabet) for _ in range(4)) for _ in range(3)]
    return "-".join(parts)


def _compute_response(bill_data: dict, viewer_id: str | None = None):
    """Compute split and return enriched payload for UI."""
    bill = bill_data["bill"]
    result = calc.compute(
        bill=bill,
        items=bill_data["items"],
        selections=bill_data["selections"],
        participants=bill_data["participants"],
        # money nobody claimed lands on whoever fronted it — the confirmed
        # payer if there is one, else the creator (v58)
        fallback_id=_owner_id(bill_data),
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
    # the creator is part of the bill while they're still in it: visible in the
    # split even before picking. Once they walk out (v58 — only possible when a
    # confirmed payer holds the bill) they stop being added back.
    creator_id = bill["creator_identity_id"]
    if not bill.get("creator_left") and creator_id not in {p["identity_id"] for p in result["people"]}:
        result["people"].append({
            "identity_id": creator_id, "subtotal_idr": 0, "tax_idr": 0, "total_idr": 0,
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
    # who paid? one shared resolver (db.resolve_payer) so the detail payload,
    # the settled flag and the bill list can never disagree again
    paid_by_id, paid_by_name = db.resolve_payer(bill_data)
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
    # settled = no money outstanding: at least one item was picked, the bill
    # has actually started (someone else joined the creator — a solo bill
    # where the creator picked everything used to resolve payer=creator,
    # auto-pay them, and wear a green "Lunas" chip before anyone else even
    # joined, bug: "blom ada yg join tp keterangannya lunas"), everyone with
    # a share (total > 0) has paid, and no empty slots remain. The resolved
    # payer counts as paid automatically (they fronted it).
    #
    # Closing a bill does NOT make it settled. It used to, so a bill closed
    # with Rp 75.000 of empty slots and an unpaid guest still showed a green
    # "Lunas" chip in history while the person's own row said "belum" (bug:
    # two contradicting statements one scroll apart).
    sel_ids = {s["identity_id"] for s in bill_data["selections"]}
    owed_ids = {p["identity_id"] for p in result["people"] if p["total_idr"] > 0}
    paid_ids = {p["identity_id"] for p in bill_data["payments"] if p["status"] == "paid"}
    if paid_by_id:
        paid_ids.add(paid_by_id)
    # v60: the owner can declare the WHOLE bill settled in one click (cash
    # settled outside the app, or a genuinely solo bill that can never
    # auto-settle). Manual override wins — it says "bill ini udah beres",
    # regardless of the roster/paid math below.
    settled_manual = bool(bill.get("settled_manual"))
    auto_all_paid = bool(sel_ids) and len(result["people"]) > 1 and owed_ids <= paid_ids
    all_paid = settled_manual or auto_all_paid
    settled = settled_manual or (auto_all_paid and result["uncovered_idr"] == 0)
    # who may edit/close/delete (v57): the CONFIRMED payer is the sole
    # manager. Before any payer is confirmed the creator manages; after
    # confirmation the creator is a regular participant like everyone else.
    can_manage_flag = bool(viewer_id) and _can_manage(bill_data, viewer_id)
    # pending invites (v66): manager-only, additive. Before this the sender
    # of an invite had no visibility into it at all -- no way to tell "Undang"
    # was already sent, and no way to take back a wrong one (recipient with
    # auto_accept OFF). Scoped to the manager the same way creator_accounts
    # etc. already are -- never surfaced to every holder of the share link
    # (bug found in the v66 audit).
    pending_invites = []
    if can_manage_flag:
        for inv in db.get_invites_for_bill(bill["id"]):
            if inv["status"] != "pending":
                continue
            target = db.get_identity(inv["identity_id"])
            pending_invites.append({
                "id": inv["id"],
                "identity_id": inv["identity_id"],
                "name": target["name"] if target else "?",
                "created_at": inv["created_at"],
            })
    return {
        "all_paid": all_paid,
        "settled_manual": settled_manual,
        "bill": bill,
        "owner_id": _owner_id(bill_data),
        "can_manage": can_manage_flag,
        "pending_invites": pending_invites,
        "creator_name": creator_name,
        "creator_accounts": db.get_accounts(bill["creator_identity_id"]),
        "paid_by_id": paid_by_id,
        "paid_by_name": paid_by_name,
        # raw confirmation state: a payer resolved by NAME (someone joined
        # matching the placeholder) has an identity but confirmed=0 — the
        # creator must confirm them before they inherit management powers
        # (v62). UI shows a banner until then.
        "paid_by_confirmed": bool(bill.get("paid_by_confirmed")),
        "paid_by_accounts": db.get_accounts(paid_by_id),
        "items": bill_data["items"],
        "photos": bill_data.get("photos", []),
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
        raise HTTPException(400, "Isi permintaan wajib diisi")
    if not raw:
        raise HTTPException(400, "Isi permintaan wajib diisi")
    try:
        parsed = json.loads(raw)
    except Exception:
        raise HTTPException(400, "Format JSON tidak valid")
    # a JSON array (or string/number) parses fine but every caller immediately
    # does data.get(...) on it -> AttributeError -> 500 (bug: `POST /api/bills`
    # with `[]` as the body). A non-object body is malformed input, not a
    # server error.
    if not isinstance(parsed, dict):
        raise HTTPException(400, "Isi permintaan harus berupa objek JSON")
    return parsed


@app.post("/api/identities")
@limiter.limit("30/minute")
async def create_identity(request: Request):
    data = await _read_json(request)
    name = _to_str(data.get("name"), "Nama", maxlen=60)
    if not name:
        raise HTTPException(400, "Nama wajib diisi")
    ident = db.new_identity(name, role="creator" if data.get("creator") else "guest")
    return ident


@app.post("/api/identities/restore")
@limiter.limit("10/minute")
async def restore_identity(request: Request):
    data = await _read_json(request)
    # unauthenticated endpoint (no identity/secret needed to restore) -- a
    # non-string code (list/dict) reached `.strip()` -> AttributeError -> 500,
    # reachable by anyone (bug: v66 audit, A12)
    code = _to_str(data.get("code"), "Code", maxlen=100)
    ident = db.restore_identity(code)
    if not ident:
        raise HTTPException(404, "Code tidak dikenal")
    return ident


@app.post("/api/identities/{identity_id}/bind")
@limiter.limit("20/minute")
def bind_identity_secret(identity_id: str, request: Request):
    """Mint the auth secret for an identity created before v51.

    Trust on first use: the browser that still holds only the old id calls
    this once and stores what it gets back. Identities that already have a
    secret return 403 — the secret is never re-issued.
    """
    ident = db.get_identity(identity_id)
    if not ident:
        raise HTTPException(404, "Identitas tidak ditemukan")
    secret = db.bind_secret(identity_id)
    if not secret:
        raise HTTPException(403, "Identitas ini sudah memiliki sesi")
    return {"id": identity_id, "name": ident["name"], "secret": secret}


@app.post("/api/identities/{identity_id}/code")
async def set_code(identity_id: str, request: Request):
    ident = _identity_from_request(request)
    if identity_id != ident["id"]:
        raise HTTPException(403, "Identitas tidak cocok")
    data = await _read_json(request)
    # same non-string-code crash as restore_identity, self-inflicted only
    # here since the caller is already authenticated (bug: v66 audit, A13)
    code = _to_str(data.get("code"), "Code", maxlen=100)
    if len(code) < 8:
        raise HTTPException(400, "Code minimal 8 karakter")
    db.set_identity_code(identity_id, code)
    return {"ok": True}


@app.post("/api/identities/{identity_id}/code/generate")
@limiter.limit("5/minute")
async def generate_code(identity_id: str, request: Request):
    """Auto-generate a recovery code. Regenerating replaces (kills) the old one."""
    ident = _identity_from_request(request)
    if identity_id != ident["id"]:
        raise HTTPException(403, "Identitas tidak cocok")
    code = generate_readable_code()
    db.set_identity_code(identity_id, code)
    return {"code": code}


@app.post("/api/identities/{identity_id}/name")
async def update_name(identity_id: str, request: Request):
    ident = _identity_from_request(request)
    if identity_id != ident["id"]:
        raise HTTPException(403, "Identitas tidak cocok")
    data = await _read_json(request)
    name = _to_str(data.get("name"), "Nama", maxlen=60)
    if not name:
        raise HTTPException(400, "Nama wajib diisi")
    db.update_identity_name(identity_id, name)
    return {"ok": True}


@app.get("/api/identities/{identity_id}/me")
def get_me(identity_id: str, request: Request):
    """Own profile. `has_code` drives the settings copy — the screen used to
    offer "Buat Kode" every visit, and tapping it silently killed the code the
    user had already written down."""
    ident = _identity_from_request(request)
    if identity_id != ident["id"]:
        raise HTTPException(403, "Identitas tidak cocok")
    return {
        "id": ident["id"],
        "name": ident["name"],
        "has_code": bool(ident.get("identity_code_hash")),
        "auto_accept": bool(ident.get("auto_accept", 1)),
    }


@app.get("/api/identities/{identity_id}/accounts")
def list_accounts(identity_id: str, request: Request):
    ident = _identity_from_request(request)
    if identity_id != ident["id"]:
        raise HTTPException(403, "Identitas tidak cocok")
    return db.get_accounts(identity_id)


@app.get("/api/identities/{identity_id}/contacts")
def list_contacts(identity_id: str, request: Request):
    """'Kontak terbukti' — identities who have shared a bill with me. Search
    box on the invite sheet hits this with ?q=, client filters already-on-bill
    people out using the bill payload."""
    ident = _identity_from_request(request)
    if identity_id != ident["id"]:
        raise HTTPException(403, "Identitas tidak cocok")
    q = (request.query_params.get("q") or "").strip()[:30] or None
    return db.get_contacts(identity_id, q)


@app.post("/api/identities/{identity_id}/auto_accept")
@limiter.limit("20/minute")
async def set_auto_accept(identity_id: str, request: Request):
    """Toggle direct-invite behavior: ON = invites join instantly (WA-style),
    OFF = invites land as pending cards the user accepts/declines."""
    ident = _identity_from_request(request)
    if identity_id != ident["id"]:
        raise HTTPException(403, "Identitas tidak cocok")
    data = await _read_json(request)
    raw = data.get("auto_accept")
    # strict boolean: bool("false") == True would silently flip ON for any
    # malformed client (bug found in v64 review)
    if isinstance(raw, bool):
        value = raw
    elif isinstance(raw, (int, float)) and raw in (0, 1):
        value = bool(raw)
    elif isinstance(raw, str) and raw.strip().lower() in ("true", "1"):
        value = True
    elif isinstance(raw, str) and raw.strip().lower() in ("false", "0", ""):
        value = False
    else:
        raise HTTPException(400, "auto_accept wajib bernilai true atau false")
    db.set_auto_accept(identity_id, value)
    return {"ok": True}


@app.post("/api/identities/{identity_id}/accounts")
@limiter.limit("30/minute")
async def add_account(identity_id: str, request: Request):
    ident = _identity_from_request(request)
    if identity_id != ident["id"]:
        raise HTTPException(403, "Identitas tidak cocok")
    data = await _read_json(request)
    brand = _to_str(data.get("brand"), "Brand", maxlen=40)
    account_no = _to_str(data.get("account_no"), "Nomor", maxlen=60)
    if not brand or not account_no:
        raise HTTPException(400, "Brand dan nomor wajib diisi")
    holder = _to_str(data.get("holder_name"), "Nama pemilik", maxlen=60) or None
    return db.add_account(identity_id, brand, account_no, holder)


@app.put("/api/accounts/{account_id}")
@limiter.limit("30/minute")
async def update_account(account_id: int, request: Request):
    ident = _identity_from_request(request)
    # `request.json()` raised on a malformed/empty body instead of a clean
    # 400, and bare str(x or "") silently persisted a dict value as
    # "{'a': 1}" instead of rejecting it -- both fixed to match add_account
    # (bug: v66 audit, A14)
    body = await _read_json(request)
    brand = _to_str(body.get("brand"), "Brand", maxlen=40)
    account_no = _to_str(body.get("account_no"), "Nomor", maxlen=60)
    holder_name = _to_str(body.get("holder_name"), "Nama pemilik", maxlen=60) or None
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


def _list_pick_state(bill_data: dict) -> tuple[list[str], int, list[dict]]:
    """Return pick-state summary and computed people for bill-list fields."""
    bill = bill_data["bill"]
    result = calc.compute(
        bill=bill, items=bill_data["items"], selections=bill_data["selections"],
        participants=bill_data["participants"], fallback_id=_owner_id(bill_data),
    )
    people = list(result["people"])
    joined_ids = {p["identity_id"] for p in bill_data["payments"]}
    known_ids = {p["identity_id"] for p in people}
    for jid in joined_ids - known_ids:
        people.append({"identity_id": jid, "subtotal_idr": 0, "total_idr": 0})
    creator_id = bill["creator_identity_id"]
    if not bill.get("creator_left") and creator_id not in {p["identity_id"] for p in people}:
        people.append({"identity_id": creator_id, "subtotal_idr": 0, "total_idr": 0})
    claimed = {p["identity_id"]: p["name"] for p in bill_data["participants"]
               if p.get("identity_id")}
    names = _names_for_identities([p["identity_id"] for p in people])
    for p in people:
        p["name"] = claimed.get(p["identity_id"]) or names.get(p["identity_id"], "?")
    paid_by_id, _ = db.resolve_payer(bill_data)
    selected_ids = {s["identity_id"] for s in bill_data["selections"]}
    paid_ids = {p["identity_id"] for p in bill_data["payments"] if p["status"] == "paid"}
    if paid_by_id:
        paid_ids.add(paid_by_id)
    pending = [p["name"] for p in people
               if p["identity_id"] != paid_by_id and p["identity_id"] not in selected_ids]
    total_unpaid = sum(max(0, p.get("total_idr", 0)) for p in people
                       if p.get("identity_id") not in paid_ids)
    return pending, total_unpaid, people


@app.get("/api/identities/{identity_id}/bills")
def my_bills(identity_id: str, request: Request):
    ident = _identity_from_request(request)
    if identity_id != ident["id"]:
        raise HTTPException(403, "Identitas tidak cocok")
    rows = db.get_bills_for_identity(identity_id)
    # expose the effective owner (resolved payer, else creator) so the UI can
    # show owner-only actions (delete) — mirrors _owner_id, including the
    # placeholder-name resolution that paid_by_identity_id alone misses
    #
    # private key `_bill_data` — get_bills_for_identity already loaded it once
    # (for the settled flag); re-fetching it here too meant every bill on this
    # list opened a fresh sqlite connection twice over, on top of what the list
    # query itself and _bill_settled used. Pop it so it never reaches the JSON
    # response — the existing summary fields remain unchanged while the
    # additive pick-state fields below are populated from the same snapshot.
    for row in rows:
        bill_data = row.pop("_bill_data", None)
        if bill_data:
            row["pending_names"], row["total_unpaid"], people = _list_pick_state(bill_data)
            row["owner_id"] = _owner_id(bill_data)
            row["can_manage"] = _can_manage(bill_data, identity_id)
            # personal payment state for THIS viewer: the resolved payer is
            # auto-paid (they fronted the money), otherwise check their payment
            # record. Must use the SAME resolver as the bill screen — deriving
            # it from _owner_id instead said "Kamu udah bayar" in history while
            # the bill itself showed the same person owing the full total.
            payer_id, _ = db.resolve_payer(bill_data)
            row["i_am_payer"] = payer_id == identity_id
            row["my_paid"] = (payer_id == identity_id) or any(
                p["identity_id"] == identity_id and p["status"] == "paid"
                for p in bill_data["payments"]
            )
            row["my_total_idr"] = next(
                (p.get("total_idr", 0) for p in people
                 if p.get("identity_id") == identity_id),
                0,
            )
            # a bill nobody has picked from is neither settled nor "unpaid" —
            # without this the list showed a red "Belum lunas" next to a green
            # "Kamu udah bayar" on a bill where nothing had happened yet
            row["has_picks"] = bool(bill_data["selections"])
        else:
            # defensive fallback (bill row exists but get_bill failed): mirror
            # _owner_id exactly -- confirmed payer, else creator. This branch
            # used to grant can_manage off paid_by_identity_id alone, without
            # paid_by_confirmed: a payer resolved only by matching
            # `paid_by_name` (display-only, per CLAUDE.md) got management
            # powers here even though the real _owner_id path never grants
            # them that (bug: v66 audit, `get_bills_for_identity` didn't even
            # select paid_by_confirmed, now added).
            pid = row["paid_by_identity_id"]
            owner_id = pid if (pid and row["paid_by_confirmed"]) else row["creator_identity_id"]
            row["owner_id"] = owner_id
            row["can_manage"] = owner_id == identity_id
            row["my_paid"] = False
            row["my_total_idr"] = 0
            row["i_am_payer"] = False
            row["has_picks"] = False
            row["pending_names"] = []
            row["total_unpaid"] = 0
    return rows


# ---------- bills ----------

@app.post("/api/bills")
@limiter.limit("10/minute")
async def create_bill(request: Request):
    data = await _read_json(request)
    ident = _identity_from_request(request)
    merchant = _to_str(data.get("merchant"), "Nama tempat", maxlen=120) or None
    transacted_at = _to_str(data.get("transacted_at"), "Tanggal", maxlen=40) or None
    title = _to_str(data.get("title"), "Judul bill", maxlen=120) or merchant or "Bill"
    items = data.get("items") or []
    if not isinstance(items, list) or not items:
        raise HTTPException(400, "Minimal 1 item")
    eff_sum = 0
    for i in items:
        if not isinstance(i, dict) or not _to_str(i.get("name"), "Nama item", maxlen=120):
            raise HTTPException(400, "Nama item wajib diisi")
        price = _to_int(i.get("price"), f"Harga {i.get('name')}", minv=0, maxv=_MAX_IDR)
        discount = _to_int(i.get("discount"), f"Diskon {i.get('name')}", 0, minv=0, maxv=_MAX_IDR)
        if discount > price:
            raise HTTPException(400, f"Diskon {i['name']} tidak boleh lebih besar dari harga")
        eff_sum += price - discount
    participants = []
    seen_participants = set()
    for p in (data.get("participants") or []):
        if isinstance(p, str) and p.strip():
            key = p.strip().lower()
            if key not in seen_participants:
                seen_participants.add(key)
                participants.append(p.strip())
    pc = data.get("participant_count")
    participant_count = _to_int(pc, "Jumlah orang", minv=0) if pc not in (None, "") else None
    paid_by_name = _to_str(data.get("paid_by_name"), "Nama pembayar", maxlen=60) or None
    subtotal = _to_int(data.get("subtotal"), "Subtotal", 0, minv=0, maxv=_MAX_IDR)
    tax = _to_int(data.get("tax"), "Pajak", 0, minv=0, maxv=_MAX_IDR)
    service = _to_int(data.get("service"), "Service", 0, minv=0, maxv=_MAX_IDR)
    total = _to_int(data.get("total"), "Total", 0, minv=0, maxv=_MAX_IDR)
    tax_included = 1 if data.get("tax_included") else 0
    # reject impossible combos instead of persisting a bill whose split can
    # never reconcile (bug: tax_included + tax>0 made sum(people) != total,
    # and an arbitrary total != subtotal+tax+service broke every invariant)
    if tax_included and tax > 0:
        raise HTTPException(400, "Kalau harga item sudah termasuk pajak, kolom Pajak harus 0")
    if total != subtotal + tax + service:
        raise HTTPException(400, "Total tidak sesuai dengan subtotal + pajak + service")
    if subtotal != eff_sum:
        raise HTTPException(400, f"Subtotal tidak sesuai dengan isi item (seharusnya Rp {eff_sum:,})")
    # a non-string here reached sqlite3 and raised InterfaceError -> 500, and
    # Cloudflare replaces 5xx bodies with its own error page (bug: v64 audit)
    #
    # capped at 10 (v66 audit): an unbounded list let one bad-faith create post
    # e.g. 2000 photos -> 2000 bill_photo rows -> every viewer of the share
    # link downloads a 2000-entry payload and renders 2000 <img> tags.
    #
    # each basename must also match db._PHOTO_NAME_RE (v67): every real photo
    # this server ever hands a client (via /api/photos, /api/ocr, or the
    # legacy OCR flow) is named `secrets.token_hex(8) + ".jpg"`. Paths are
    # handed back to every reader of a bill payload, so without this check a
    # client could post another bill's photo path (or any string) straight
    # into bill_photo and have it served to everyone with the share link.
    # db._unlink_photo already refuses to delete a file another bill still
    # references, but that only guards deletion -- this closes the intake
    # side.
    def _valid_photo_name(p) -> bool:
        return isinstance(p, str) and bool(p) and bool(db._PHOTO_NAME_RE.match(Path(p).name))

    photos_raw = data.get("photos")
    photos = None
    if isinstance(photos_raw, list):
        photos = []
        for p in photos_raw[:10]:
            if not isinstance(p, str) or not p:
                continue
            if not _valid_photo_name(p):
                raise HTTPException(400, "Path foto tidak valid")
            photos.append(p)
    photo_path = data.get("photo_path")
    if photo_path is not None:
        if not isinstance(photo_path, str):
            raise HTTPException(400, "photo_path harus berupa teks")
        if photo_path and not _valid_photo_name(photo_path):
            raise HTTPException(400, "Path foto tidak valid")
    created = db.create_bill(
        creator_id=ident["id"],
        title=title,
        merchant=merchant,
        transacted_at=transacted_at,
        tax_mode=_to_str(data.get("tax_mode"), "Cara bagi pajak", maxlen=20) or "proportional",
        participant_count=participant_count,
        tax_included=tax_included,
        subtotal=subtotal,
        tax=tax,
        service=service,
        total=total,
        items=[{
            "name": i["name"],
            "price": _to_int(i["price"], f"Harga {i['name']}", minv=0, maxv=_MAX_IDR),
            "mode": i.get("mode", "free"),
            "slot_count": _to_int(i.get("slot_count"), f"Slot {i['name']}", 1, minv=1) if i.get("mode") == "slot" else None,
            "discount": _to_int(i.get("discount"), f"Diskon {i['name']}", 0, minv=0, maxv=_MAX_IDR),
        } for i in items],
        participants=participants,
        photo_path=photo_path,
        photos=photos,
        paid_by_name=paid_by_name,
    )
    return created


@app.get("/api/bills/{bill_id}")
def get_bill(bill_id: str, request: Request):
    data = _bill_or_404(bill_id)
    return _compute_response(data, _viewer_id(request))


@app.put("/api/bills/{bill_id}")
async def update_bill(bill_id: str, request: Request):
    data = await _read_json(request)
    bill_data = _bill_or_404(bill_id)
    ident = _identity_from_request(request)
    if not _can_manage(bill_data, ident["id"]):
        raise HTTPException(403, "Hanya owner bill (yang bayar)")
    if bill_data["bill"]["status"] != "open":
        raise HTTPException(403, "Bill sudah ditutup, tidak dapat diedit")
    items = data.get("items") or []
    if not isinstance(items, list) or not items:
        raise HTTPException(400, "Minimal 1 item")
    eff_sum = 0
    for i in items:
        if not isinstance(i, dict) or not str(i.get("name") or "").strip():
            raise HTTPException(400, "Nama item wajib diisi")
        price = _to_int(i.get("price"), f"Harga {i.get('name')}", minv=0, maxv=_MAX_IDR)
        discount = _to_int(i.get("discount"), f"Diskon {i.get('name')}", 0, minv=0, maxv=_MAX_IDR)
        if discount > price:
            raise HTTPException(400, f"Diskon {i['name']} tidak boleh lebih besar dari harga")
        eff_sum += price - discount
    # the same item id twice would be validated twice but stored once, leaving
    # bill.total_idr permanently larger than the sum of its items (bug: 100k
    # charged to nobody, total_ok false, and no screen surfaces it)
    seen_ids = set()
    for i in items:
        iid = i.get("id")
        if iid in (None, ""):
            continue
        if iid in seen_ids:
            raise HTTPException(400, "Ada item dobel di daftar")
        seen_ids.add(iid)
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
                raise HTTPException(400, f"Slot {it['name']} minimal {taken} (sudah terisi {taken})")
        elif cur["mode"] == "slot":
            # switching to free: clamp qty to 1 (people stay selected once)
            db.clamp_selection_qty(bill_id, int(iid))
    # absent keys mean "leave as is" — the edit screen doesn't send these, and
    # overwriting them wiped the roster of every bill that had one (bug: typed
    # names that hadn't joined yet vanished from the "Yang bayar" picker)
    participants = None
    if "participants" in data:
        participants = []
        seen_participants = set()
        for p in (data.get("participants") or []):
            if isinstance(p, str) and p.strip():
                key = p.strip().lower()
                if key not in seen_participants:
                    seen_participants.add(key)
                    participants.append(p.strip())
    participant_count = db.UNCHANGED
    if "participant_count" in data:
        pc = data.get("participant_count")
        participant_count = _to_int(pc, "Jumlah orang", minv=0) if pc not in (None, "") else None
    # absent keys mean "leave as is", same reasoning as participants above --
    # merchant/transacted_at used to become NULL unconditionally, and
    # transacted_at drives the history list's ordering and its year/month
    # filter, so a partial-update client quietly moved the bill to another
    # month (bug: v66 audit). An explicit null/"" still nulls the column.
    merchant = db.UNCHANGED
    if "merchant" in data:
        merchant = _to_str(data.get("merchant"), "Nama tempat", maxlen=120) or None
    transacted_at = db.UNCHANGED
    if "transacted_at" in data:
        transacted_at = _to_str(data.get("transacted_at"), "Tanggal", maxlen=40) or None
    subtotal_v = _to_int(data.get("subtotal"), "Subtotal", 0, minv=0, maxv=_MAX_IDR)
    tax_v = _to_int(data.get("tax"), "Pajak", 0, minv=0, maxv=_MAX_IDR)
    service_v = _to_int(data.get("service"), "Service", 0, minv=0, maxv=_MAX_IDR)
    total_v = _to_int(data.get("total"), "Total", 0, minv=0, maxv=_MAX_IDR)
    # same impossible-combo guards as create
    if data.get("tax_included") and tax_v > 0:
        raise HTTPException(400, "Kalau harga item sudah termasuk pajak, kolom Pajak harus 0")
    if total_v != subtotal_v + tax_v + service_v:
        raise HTTPException(400, "Total tidak sesuai dengan subtotal + pajak + service")
    if subtotal_v != eff_sum:
        raise HTTPException(400, f"Subtotal tidak sesuai dengan isi item (seharusnya Rp {eff_sum:,})")
    db.update_bill(
        bill_id,
        title=_to_str(data.get("title"), "Judul bill", maxlen=120) or bill_data["bill"]["title"],
        merchant=merchant,
        transacted_at=transacted_at,
        participants=participants,
        participant_count=participant_count,
        items=[{
            "id": i.get("id"),
            "name": i["name"],
            "price": _to_int(i["price"], f"Harga {i['name']}", minv=0, maxv=_MAX_IDR),
            "mode": i.get("mode", "free"),
            "slot_count": _to_int(i.get("slot_count"), f"Slot {i['name']}", 1, minv=1) if i.get("mode") == "slot" else None,
            "discount": _to_int(i.get("discount"), f"Diskon {i['name']}", 0, minv=0, maxv=_MAX_IDR),
        } for i in items],
        subtotal=subtotal_v,
        tax=tax_v,
        service=service_v,
        total=total_v,
        tax_included=1 if data.get("tax_included") else 0,
    )
    return _compute_response(db.get_bill(bill_id), ident["id"])


@app.put("/api/bills/{bill_id}/paid_by")
async def set_paid_by(bill_id: str, request: Request):
    """Creator assigns who paid the bill. Body: {identity_id} or {name}.
    identity_id is preferred (unambiguous); name works as a placeholder for
    someone who hasn't joined yet (resolved on join)."""
    data = await _read_json(request)
    bill_data = _bill_or_404(bill_id)
    ident = _identity_from_request(request)
    if not _can_manage(bill_data, ident["id"]):
        raise HTTPException(403, "Hanya owner bill (yang bayar)")
    if bill_data["bill"]["status"] != "open":
        raise HTTPException(403, "Bill sudah ditutup, tidak dapat diubah")
    identity_id = _to_str(data.get("identity_id"), "Identity id", maxlen=64) or None
    name = _to_str(data.get("name"), "Nama", maxlen=60) or None
    if identity_id:
        # validate identity exists & is part of this bill (roster)
        target = db.get_identity(identity_id)
        if not target:
            raise HTTPException(404, "Orang tidak ditemukan")
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
            cand = db.get_identity(p["identity_id"])
            if cand and cand["name"].strip().lower() == target_l:
                identity_id = cand["id"]
                name = cand["name"]
                break
        if not identity_id:
            for p in bill_data["participants"]:
                pid = p.get("identity_id")
                if pid:
                    cand = db.get_identity(pid)
                    if cand and cand["name"].strip().lower() == target_l:
                        identity_id = cand["id"]
                        name = cand["name"]
                        break
    # `confirmed` is the difference between "display this name" and "hand this
    # person the bill" (v51/v57). Only an explicit identity_id is a deliberate
    # pick; a name that merely MATCHED someone who joined is display-only.
    # Confirming the name path re-opened the takeover v51 closed: a guest with
    # the share link renames themselves to the placeholder ("budi"), joins, and
    # the manager's harmless-looking "Pakai Nama Ini" tap makes them the sole
    # owner — the real creator then gets 403 on their own bill and the guest
    # can delete it (bug found in the v64 audit).
    db.set_paid_by(bill_id, identity_id, name, confirmed=bool(data.get("identity_id")))
    return _compute_response(db.get_bill(bill_id), ident["id"])


@app.delete("/api/bills/{bill_id}")
def delete_bill(bill_id: str, request: Request):
    bill_data = _bill_or_404(bill_id)
    ident = _identity_from_request(request)
    if not _can_manage(bill_data, ident["id"]):
        raise HTTPException(403, "Hanya owner bill (yang bayar)")
    if not db.delete_bill(bill_id, ident["id"]):
        raise HTTPException(404, "Bill tidak ditemukan")
    return {"ok": True}


@app.post("/api/bills/{bill_id}/close")
def close_bill(bill_id: str, request: Request):
    bill_data = _bill_or_404(bill_id)
    ident = _identity_from_request(request)
    if not _can_manage(bill_data, ident["id"]):
        raise HTTPException(403, "Hanya owner bill (yang bayar)")
    db.close_bill(bill_id)
    return {"ok": True}


@app.post("/api/bills/{bill_id}/join")
def join_bill_via_link(bill_id: str, request: Request):
    bill_data = _bill_or_404(bill_id)
    if bill_data["bill"]["status"] != "open":
        raise HTTPException(403, "Bill sudah ditutup")
    ident = _identity_from_request(request)
    db.join_bill(bill_id, ident["id"], ident["name"])
    # joining through the link is accepting — void any pending invite for this
    # pair so the home card doesn't keep saying "Gabung" for someone already in
    # (edge: invited person opens the bill link directly instead of the card)
    for inv in db.get_invites_for_bill(bill_id):
        if inv["identity_id"] == ident["id"] and inv["status"] == "pending":
            db.mark_invite_accepted(inv["id"])
    return _compute_response(db.get_bill(bill_id), ident["id"])


@app.post("/api/bills/{bill_id}/invite")
@limiter.limit("20/minute")
async def invite_to_bill(bill_id: str, request: Request):
    """Direct invite (v64): owner invites an identity who already has an
    account (kontak terbukti). If the target has auto_accept ON they join
    immediately — WA-style, no link, no click needed. If OFF, an invite row is
    created and the target sees a pending card on their home to accept."""
    bill_data = _bill_or_404(bill_id)
    ident = _identity_from_request(request)
    if not _can_manage(bill_data, ident["id"]):
        raise HTTPException(403, "Hanya owner bill (yang bayar)")
    if bill_data["bill"]["status"] != "open":
        raise HTTPException(403, "Bill sudah ditutup")
    data = await _read_json(request)
    target_id = _to_str(data.get("identity_id"), "Identity id", maxlen=64)
    if not target_id:
        raise HTTPException(400, "Identity id wajib diisi")
    target = db.get_identity(target_id)
    if not target:
        raise HTTPException(404, "Akun tidak ditemukan")
    if target_id == ident["id"]:
        raise HTTPException(400, "Tidak dapat mengundang diri sendiri")
    if db.identity_on_bill(bill_id, target_id):
        raise HTTPException(400, "Orang ini sudah ada di bill")
    # identity ids are public (every bill payload lists them) — scoping the
    # invite to "kontak terbukti" stops anyone force-joining strangers to
    # their own bills as a spam vector (bug found in v64 review)
    if not db.is_contact(ident["id"], target_id):
        raise HTTPException(400, "Hanya orang yang pernah berbagi bill yang dapat diundang")
    inv = db.create_invite(bill_id, target_id, ident["id"])
    if inv["status"] == "accepted":
        # stale-guard: an accepted row can outlive the person's membership
        # (e.g. they left and re-invite happens before remove_person cleanup);
        # report ground truth, not the cached row (bug found in v64 review)
        if not db.identity_on_bill(bill_id, target_id):
            db.join_bill(bill_id, target_id, target["name"])
        return {"status": "joined"}
    if inv.get("reopened_from_decline"):
        # they said no once — the next invite has to be accepted on purpose,
        # even with auto_accept ON. Without this, invite -> decline -> invite
        # again silently forced them onto the bill with no further consent
        # (bug: v67 audit). A first-time invite to an auto-accept contact
        # still joins instantly below.
        return {"status": "pending"}
    if bool(target.get("auto_accept", 1)):
        db.mark_invite_accepted(inv["id"])
        db.join_bill(bill_id, target_id, target["name"])
        return {"status": "joined"}
    return {"status": "pending"}


@app.post("/api/bills/{bill_id}/invites/{invite_id}/accept")
@limiter.limit("20/minute")
def accept_invite(bill_id: str, invite_id: int, request: Request):
    """Invitee accepts a pending invite: joins the bill like they clicked the
    link, without needing the link."""
    bill_data = _bill_or_404(bill_id)
    if bill_data["bill"]["status"] != "open":
        raise HTTPException(403, "Bill sudah ditutup")
    ident = _identity_from_request(request)
    inv = db.get_invite(invite_id)
    if not inv or inv["bill_id"] != bill_id or inv["identity_id"] != ident["id"]:
        raise HTTPException(404, "Undangan tidak ditemukan")
    if inv["status"] != "pending":
        raise HTTPException(400, "Undangan ini sudah diproses")
    db.mark_invite_accepted(invite_id)
    db.join_bill(bill_id, ident["id"], ident["name"])
    fresh = db.get_bill(bill_id)
    if not fresh:
        raise HTTPException(404, "Bill tidak ditemukan")
    return _compute_response(fresh, ident["id"])


@app.post("/api/bills/{bill_id}/invites/{invite_id}/decline")
@limiter.limit("20/minute")
def decline_invite(bill_id: str, invite_id: int, request: Request):
    ident = _identity_from_request(request)
    inv = db.get_invite(invite_id)
    if not inv or inv["bill_id"] != bill_id or inv["identity_id"] != ident["id"]:
        raise HTTPException(404, "Undangan tidak ditemukan")
    if not db.decline_invite(invite_id, ident["id"]):
        raise HTTPException(400, "Undangan ini sudah diproses")
    return {"ok": True}


@app.get("/api/identities/{identity_id}/invites")
def list_pending_invites(identity_id: str, request: Request):
    """Pending invites for the viewer — cards shown at the top of home."""
    ident = _identity_from_request(request)
    if identity_id != ident["id"]:
        raise HTTPException(403, "Identitas tidak cocok")
    return db.get_pending_invites(identity_id)


@app.delete("/api/bills/{bill_id}/invites/{invite_id}")
@limiter.limit("20/minute")
def cancel_bill_invite(bill_id: str, invite_id: int, request: Request):
    """Manager withdraws a pending invite (v66) -- the sender's only recourse
    when they invited the wrong contact, or the recipient (auto_accept OFF)
    just hasn't answered yet. Scoped to this bill and gated on _can_manage,
    same as every other roster mutation (bug found in the v66 audit: this
    endpoint didn't exist, so a mis-sent invite was permanent)."""
    bill_data = _bill_or_404(bill_id)
    ident = _identity_from_request(request)
    if not _can_manage(bill_data, ident["id"]):
        raise HTTPException(403, "Hanya owner bill (yang bayar)")
    if not db.cancel_invite(bill_id, invite_id):
        raise HTTPException(404, "Undangan tidak ditemukan")
    return _compute_response(db.get_bill(bill_id), ident["id"])


@app.delete("/api/bills/{bill_id}/people/{identity_id}")
def remove_person(bill_id: str, identity_id: str, request: Request):
    bill_data = _bill_or_404(bill_id)
    ident = _identity_from_request(request)
    if not _can_manage(bill_data, ident["id"]):
        raise HTTPException(403, "Hanya owner bill (yang bayar)")
    if bill_data["bill"]["status"] != "open":
        raise HTTPException(403, "Bill sudah ditutup")
    if identity_id == ident["id"]:
        raise HTTPException(400, "Tidak dapat menghapus diri sendiri (owner bill)")
    # the creator used to be unremovable. Since v57 they're a regular
    # participant once a confirmed payer holds the bill, and v58 lets them
    # leave — so the manager can drop them too, same as anyone else. While no
    # payer is confirmed the creator IS the owner, and the self-check above
    # already covers that case (only the owner gets here).
    db.remove_person(bill_id, identity_id)
    db.set_creator_left(bill_id, identity_id)
    return _compute_response(db.get_bill(bill_id), ident["id"])


@app.post("/api/bills/{bill_id}/leave")
@limiter.limit("20/minute")
def leave_bill(bill_id: str, request: Request):
    """A participant removes themselves from an open bill (v57).

    Escape hatch for people who joined but don't owe anything they want to
    keep tracking. Drops their selections, payment record, and participant
    claim — their share falls back to the owner / becomes uncovered slots
    (same primitive as the manager's remove_person). The owner can't leave:
    they hold the bill, so they delete it or hand the payer over instead.

    The creator can leave too (v58), but only while they are NOT the owner —
    i.e. once a confirmed payer took the bill over, which per v57 makes the
    creator a regular participant. Their exit is a flag on the bill
    (`creator_left`), because unlike everyone else their membership isn't
    stored as rows that leaving could delete.
    """
    bill_data = _bill_or_404(bill_id)
    bill = bill_data["bill"]
    if bill["status"] != "open":
        raise HTTPException(403, "Bill sudah ditutup")
    ident = _identity_from_request(request)
    if _can_manage(bill_data, ident["id"]):
        raise HTTPException(400, "Owner bill tidak dapat keluar — pindahkan pembayar atau hapus bill")
    # must actually be part of the bill (joined via payment row, or has picks).
    # The creator is in it by construction until they leave.
    is_creator = ident["id"] == bill["creator_identity_id"]
    joined_ids = {p["identity_id"] for p in bill_data["payments"]}
    picked = any(
        sel["identity_id"] == ident["id"]
        for it in bill_data["items"]
        for sel in (it.get("selections") or [])
    )
    if not (is_creator and not bill.get("creator_left")) and ident["id"] not in joined_ids and not picked:
        raise HTTPException(404, "Kamu tidak ada di bill ini")
    db.remove_person(bill_id, ident["id"])
    if is_creator:
        db.set_creator_left(bill_id, ident["id"])
    return _compute_response(db.get_bill(bill_id), ident["id"])


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
        raise HTTPException(400, "Item tidak valid")
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
                raise HTTPException(400, f"Slot {it['name']} hanya berjumlah {it['slot_count']}")
            if others.get(p["item_id"], 0) + p["qty"] > it["slot_count"]:
                left = it["slot_count"] - others.get(p["item_id"], 0)
                raise HTTPException(400, f"Slot {it['name']} tersisa {left}")
        elif p["qty"] > 99:
            raise HTTPException(400, f"{it['name']} maksimal 99 porsi")
    db.claim_participant(bill_id, ident["id"], ident["name"])
    try:
        db.set_selections(bill_id, ident["id"], picks)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return _compute_response(db.get_bill(bill_id), ident["id"])


@app.put("/api/bills/{bill_id}/items/{item_id}/slots")
async def set_item_slots(bill_id: str, item_id: int, request: Request):
    """Creator changes an item's slot count (must be >= slots already taken)."""
    data = await _read_json(request)
    bill_data = _bill_or_404(bill_id)
    ident = _identity_from_request(request)
    if not _can_manage(bill_data, ident["id"]):
        raise HTTPException(403, "Hanya owner bill (yang bayar)")
    if bill_data["bill"]["status"] != "open":
        raise HTTPException(403, "Bill sudah ditutup, tidak dapat diubah")
    item = next((i for i in bill_data["items"] if i["id"] == item_id), None)
    if not item:
        raise HTTPException(404, "Item tidak ditemukan")
    if item["mode"] != "slot":
        raise HTTPException(400, "Item ini bukan mode slot")
    try:
        slot_count = int(data.get("slot_count") or 0)
    except (TypeError, ValueError):
        raise HTTPException(400, "Jumlah slot tidak valid")
    if slot_count < 1:
        raise HTTPException(400, "Slot minimal 1")
    taken = sum(int(s.get("qty", 1)) for s in bill_data["selections"] if s["item_id"] == item_id)
    if slot_count < taken:
        raise HTTPException(400, f"Slot minimal {taken} (sudah terisi {taken})")
    if not db.set_item_slots(bill_id, item_id, slot_count):
        raise HTTPException(404, "Item tidak ditemukan")
    return _compute_response(db.get_bill(bill_id), ident["id"])


@app.delete("/api/bills/{bill_id}/items/{item_id}/selections/{identity_id}")
async def release_selection(bill_id: str, item_id: int, identity_id: str, request: Request):
    """Release a person's slot(s) on one item. Owner or creator can do it
    (e.g. mis-tap, or someone bailed and the creator frees their slots)."""
    bill_data = _bill_or_404(bill_id)
    ident = _identity_from_request(request)
    if bill_data["bill"]["status"] != "open":
        raise HTTPException(403, "Bill sudah ditutup")
    if ident["id"] != identity_id and not _can_manage(bill_data, ident["id"]):
        raise HTTPException(403, "Hanya pemilik slot atau pembuat bill yang dapat melepasnya")
    item = next((i for i in bill_data["items"] if i["id"] == item_id), None)
    if not item:
        raise HTTPException(404, "Item tidak ditemukan")
    if not db.get_selection(bill_id, item_id, identity_id):
        raise HTTPException(404, "Orang itu tidak memiliki slot pada item ini")
    db.set_selection_qty(bill_id, identity_id, item_id, 0)
    return _compute_response(db.get_bill(bill_id), ident["id"])


@app.post("/api/bills/{bill_id}/payments/{identity_id}/paid")
def mark_paid(bill_id: str, identity_id: str, request: Request):
    """Mark a person as paid. Only the person themselves or the bill creator
    can do it (e.g. someone transferred money but won't open the app)."""
    bill_data = _bill_or_404(bill_id)
    if bill_data["bill"]["status"] != "open":
        raise HTTPException(403, "Bill sudah ditutup, tidak dapat mengubah status pembayaran")
    ident = _identity_from_request(request)
    if ident["id"] != identity_id and not _can_manage(bill_data, ident["id"]):
        raise HTTPException(403, "Tidak dapat mengubah status pembayaran orang lain")
    # identity_id must exist — otherwise INSERT OR IGNORE violates the payment
    # FK and leaves an open write transaction wedging the SQLite lock
    # (bug: mark_paid of a random id -> 500, then every writer hung 5s -> 500)
    if not db.get_identity(identity_id):
        raise HTTPException(404, "Orang tidak dikenal")
    # the target must already be ON the bill — this used to be close to /join
    # in effect (see _is_bill_member's docstring), a roster-injection route
    # that never called /join and never got vetted by it (bug: v66 audit).
    if not _is_bill_member(bill_data, identity_id):
        raise HTTPException(404, "Orang itu belum join bill ini")
    db.claim_participant(bill_id, ident["id"], ident["name"])
    db.mark_paid(bill_id, identity_id)
    return _compute_response(db.get_bill(bill_id), ident["id"])


@app.post("/api/bills/{bill_id}/payments/{identity_id}/unpaid")
def mark_unpaid(bill_id: str, identity_id: str, request: Request):
    """Undo 'sudah bayar'. Only the payer or the bill creator can undo."""
    bill_data = _bill_or_404(bill_id)
    if bill_data["bill"]["status"] != "open":
        raise HTTPException(403, "Bill sudah ditutup, tidak dapat mengubah status pembayaran")
    ident = _identity_from_request(request)
    if ident["id"] != identity_id and not _can_manage(bill_data, ident["id"]):
        raise HTTPException(403, "Tidak dapat mengubah status pembayaran orang lain")
    db.mark_unpaid(bill_id, identity_id)
    return _compute_response(db.get_bill(bill_id), ident["id"])


@app.post("/api/bills/{bill_id}/reopen")
def reopen_bill(bill_id: str, request: Request):
    """Creator reopens a closed bill (mis-close / someone still needs to pay)."""
    bill_data = _bill_or_404(bill_id)
    ident = _identity_from_request(request)
    if not _can_manage(bill_data, ident["id"]):
        raise HTTPException(403, "Hanya owner bill (yang bayar)")
    if bill_data["bill"]["status"] != "closed":
        raise HTTPException(400, "Bill belum ditutup")
    db.reopen_bill(bill_id)
    return _compute_response(db.get_bill(bill_id), ident["id"])


@app.post("/api/bills/{bill_id}/settle")
def settle_bill(bill_id: str, request: Request):
    """Owner marks the WHOLE bill lunas in one click (v60).

    For cash settlements outside the app (no need to tap each person's
    Tandai Lunas one by one), or a genuinely solo bill that can never
    auto-settle because nobody else joined. Manual settle overrides the
    auto math, so this works on open AND closed bills.
    """
    bill_data = _bill_or_404(bill_id)
    ident = _identity_from_request(request)
    if not _can_manage(bill_data, ident["id"]):
        raise HTTPException(403, "Hanya owner bill (yang bayar)")
    db.set_settled_manual(bill_id, True)
    return _compute_response(db.get_bill(bill_id), ident["id"])


@app.post("/api/bills/{bill_id}/unsettle")
def unsettle_bill(bill_id: str, request: Request):
    """Undo a manual whole-bill settle (v60)."""
    bill_data = _bill_or_404(bill_id)
    ident = _identity_from_request(request)
    if not _can_manage(bill_data, ident["id"]):
        raise HTTPException(403, "Hanya owner bill (yang bayar)")
    db.set_settled_manual(bill_id, False)
    return _compute_response(db.get_bill(bill_id), ident["id"])


@app.post("/api/bills/{bill_id}/photo")
@limiter.limit("10/minute")
async def upload_photo(bill_id: str, request: Request, file: UploadFile = File(...)):
    """Attach another receipt photo (v61: multi-photo, no longer a single
    replace). Legacy URL kept; the payload no longer carries photo_path
    writes to the old column."""
    bill_data = _bill_or_404(bill_id)
    ident = _identity_from_request(request)
    if not _can_manage(bill_data, ident["id"]):
        raise HTTPException(403, "Hanya owner bill (yang bayar)")
    # a photo added while open then never removable once the bill closes (the
    # UI already hides both controls once closed; the API must too, like
    # every other mutation) (bug: v66 audit)
    if bill_data["bill"]["status"] != "open":
        raise HTTPException(403, "Bill sudah ditutup")
    _check_photo_mime(file.content_type)
    raw = await file.read()
    if len(raw) > 5 * 1024 * 1024:
        raise HTTPException(400, "Foto maksimal 5MB")
    filename = secrets.token_hex(8) + ".jpg"
    path = UPLOAD_DIR / filename
    path.write_bytes(raw)
    db.add_bill_photo(bill_id, str(path))
    return _compute_response(db.get_bill(bill_id), ident["id"])


@app.delete("/api/bills/{bill_id}/photos/{photo_id}")
def delete_photo(bill_id: str, photo_id: int, request: Request):
    """Remove one receipt photo (v61). Owner only, file unlinked."""
    bill_data = _bill_or_404(bill_id)
    ident = _identity_from_request(request)
    if not _can_manage(bill_data, ident["id"]):
        raise HTTPException(403, "Hanya owner bill (yang bayar)")
    if bill_data["bill"]["status"] != "open":
        raise HTTPException(403, "Bill sudah ditutup")
    # scope the delete to THIS bill: photo ids are a global autoincrement and
    # every reader of a bill payload sees them, so an unscoped id let anyone
    # delete any bill's photo from a bill they do manage (bug: v64 audit)
    path = db.delete_bill_photo(bill_data["bill"]["id"], photo_id)
    if path is None:
        raise HTTPException(404, "Foto tidak ditemukan")
    db._unlink_photo(path)
    return _compute_response(db.get_bill(bill_id), ident["id"])


@app.post("/api/photos")
@limiter.limit("10/minute")
async def upload_photo_standalone(request: Request, file: UploadFile = File(...)):
    """Upload a receipt photo WITHOUT scanning (v61) — for the manual create
    flow. Returns the saved path so the client can attach it to a bill."""
    _identity_from_request(request)
    _check_photo_mime(file.content_type)
    raw = await file.read()
    if len(raw) > 5 * 1024 * 1024:
        raise HTTPException(400, "Foto maksimal 5MB")
    filename = secrets.token_hex(8) + ".jpg"
    path = UPLOAD_DIR / filename
    path.write_bytes(raw)
    return {"photo_path": str(path), "filename": filename}


@app.delete("/api/photos/{filename}")
def delete_photo_standalone(filename: str, request: Request):
    """Release a photo the client never ended up attaching to a bill (v67).

    Two leaks this closes: (a) the verify/create screen only splices a
    removed photo out of the client-side array — the file /api/photos already
    wrote stays on disk; (b) starting a bill, uploading, then abandoning the
    flow leaves the file too. Nothing ever swept them, and production writes
    to /var/www/bagiin-uploads.

    `filename` is the bare name /api/photos handed back (not a path), scoped
    by db._PHOTO_NAME_RE the same way db._unlink_photo is — this can only
    ever unlink a file this server generated, never an arbitrary path.
    Refuses to touch anything db._photo_in_use says a bill still references,
    so an already-attached photo can't be yanked out from under a bill this
    way (delete it via DELETE /api/bills/{id}/photos/{id} instead).

    Any authenticated identity may call this — the file isn't attributed to
    whoever uploaded it, and the filename is an unguessable 16-hex token, so
    there's nothing to authorize beyond "you have a valid identity". Returns
    200 whether or not the file was still there (the client's goal —
    "make sure this is gone" — is met either way); 404 for a name that was
    never a real upload; 409 if a bill still points at it.
    """
    _identity_from_request(request)
    if not db._PHOTO_NAME_RE.match(filename):
        raise HTTPException(404, "Foto tidak ditemukan")
    path = UPLOAD_DIR / filename
    full_path = str(path)
    if db._photo_in_use(full_path):
        raise HTTPException(409, "Foto ini masih dipakai di bill")
    path.unlink(missing_ok=True)
    return {"deleted": True}


@app.post("/api/ocr")
@limiter.limit("10/minute")
async def ocr_upload(request: Request, file: UploadFile = File(...)):
    """OCR a receipt photo -> structured items (draft, belum disimpan)."""
    _identity_from_request(request)
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
    # path.exists() is also true for a directory, and FileResponse raises
    # RuntimeError ("... is not a file") on one -> 500 instead of 404. No
    # traversal is possible (the route regex blocks "/"), but `%2e%2e`
    # decodes to ".." -> UPLOAD_DIR itself, a directory (bug: v66 audit).
    if not path.is_file():
        raise HTTPException(404)
    return FileResponse(path, media_type="image/jpeg", headers={
        "Cache-Control": "private, max-age=31536000, immutable",
        # upload endpoints accept png/webp too (v66) but every file here is
        # served with a forced image/jpeg content type -- if the bytes and
        # the declared type disagree, don't let a browser sniff and decide
        # to run them as something else (v67).
        "X-Content-Type-Options": "nosniff",
    })


# ---------- static frontend ----------
#
# Cache strategy (industry-standard content hashing):
#   * index.html & manifest.json are rendered dynamically with asset URLs
#     like /static/app.js?v=<sha256[:12]>. The HTML itself is served
#     no-cache + ETag so browsers/CF revalidate it every load.
#   * Every other file under /static/ is served immutable, max-age=1y.
#     Content changes -> new hash -> new URL -> cache never goes stale.
#   * No more manual version bumps (v57 etc.) - the hash IS the version.

STATIC_DIR = FRONTEND_DIR / "static"
_HASH_RE = re.compile(rb"@HASH:([a-zA-Z0-9._-]+)@")


class ImmutableStaticFiles(StaticFiles):
    def file_response(self, *args, **kwargs):
        resp = super().file_response(*args, **kwargs)
        resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return resp


def _asset_hash(name: str) -> str:
    return hashlib.sha256((STATIC_DIR / name).read_bytes()).hexdigest()[:12]


def _render_template(path: Path) -> bytes:
    return _HASH_RE.sub(lambda m: _asset_hash(m.group(1).decode()).encode(), path.read_bytes())


def _no_cache_response(content: bytes, media_type: str, request: Request) -> Response:
    """Serve rendered HTML/manifest with revalidation semantics (ETag/304)."""
    etag = '"' + hashlib.sha256(content).hexdigest() + '"'
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304)
    return Response(content, media_type=media_type, headers={
        "Cache-Control": "no-cache, must-revalidate",
        "ETag": etag,
    })


@app.api_route("/static/manifest.json", methods=["GET", "HEAD"])
def manifest(request: Request):
    return _no_cache_response(
        _render_template(FRONTEND_DIR / "manifest.json"),
        "application/manifest+json", request,
    )


@app.api_route("/", methods=["GET", "HEAD"])
def index(request: Request):
    return _no_cache_response(
        _render_template(FRONTEND_DIR / "index.html"),
        "text/html; charset=utf-8", request,
    )


app.mount("/static", ImmutableStaticFiles(directory=str(STATIC_DIR)), name="static")
