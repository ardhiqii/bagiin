"""Bagiin - SQLite database layer."""
import os
import re
import sqlite3
import secrets
from pathlib import Path

import calc

DB_PATH = Path(os.environ.get("BAGIIN_DB", Path(__file__).parent / "bagiin.db"))

# uploads are named secrets.token_hex(8)+'.jpg' — only ever unlink those
_PHOTO_NAME_RE = re.compile(r"^[0-9a-f]{16}\.jpg$")


def _unlink_photo(photo_path):
    """Remove an uploaded photo file if it's one of ours (hex.jpg). Safe-guard:
    never unlink arbitrary paths — the URL is public, so a hostile photo_path
    value must not be able to delete server files."""
    if not photo_path:
        return
    try:
        p = Path(photo_path)
        if _PHOTO_NAME_RE.match(p.name):
            p.unlink(missing_ok=True)
    except Exception:
        pass


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    conn = get_db()
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS identity (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'guest',
            identity_code_hash TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS bill (
            id TEXT PRIMARY KEY,                    -- 22-char token_urlsafe
            creator_identity_id TEXT NOT NULL REFERENCES identity(id),
            title TEXT NOT NULL,
            merchant TEXT,
            transacted_at TEXT,
            photo_path TEXT,
            paid_by_name TEXT,              -- display name of who paid (null = creator pays)
            paid_by_identity_id TEXT REFERENCES identity(id),  -- resolved once that person joins
            subtotal_idr INTEGER NOT NULL DEFAULT 0,
            tax_idr INTEGER NOT NULL DEFAULT 0,
            service_idr INTEGER NOT NULL DEFAULT 0,
            total_idr INTEGER NOT NULL DEFAULT 0,
            tax_mode TEXT NOT NULL DEFAULT 'proportional',
            participant_count INTEGER,   -- creator-declared headcount (nullable)
            status TEXT NOT NULL DEFAULT 'open',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            closed_at TEXT
        );

        CREATE TABLE IF NOT EXISTS bill_participant (
            bill_id TEXT NOT NULL REFERENCES bill(id),
            name TEXT NOT NULL,
            identity_id TEXT,           -- claimed by a real identity (nullable)
            sort_order INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (bill_id, name)
        );

        CREATE TABLE IF NOT EXISTS item (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            bill_id TEXT NOT NULL REFERENCES bill(id),
            name TEXT NOT NULL,
            price_idr INTEGER NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            mode TEXT NOT NULL DEFAULT 'free',      -- 'free' (bagi yang milih) | 'slot' (bagi N slot)
            slot_count INTEGER                       -- creator-set slot count (slot mode only)
        );

        CREATE TABLE IF NOT EXISTS selection (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            item_id INTEGER NOT NULL REFERENCES item(id),
            identity_id TEXT NOT NULL REFERENCES identity(id),
            qty INTEGER NOT NULL DEFAULT 1,
            UNIQUE (item_id, identity_id)
        );

        CREATE TABLE IF NOT EXISTS payment (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            bill_id TEXT NOT NULL REFERENCES bill(id),
            identity_id TEXT NOT NULL REFERENCES identity(id),
            amount_idr INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'unpaid',
            paid_at TEXT,
            UNIQUE (bill_id, identity_id)
        );

        CREATE TABLE IF NOT EXISTS payment_profile (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            identity_id TEXT NOT NULL REFERENCES identity(id),
            type TEXT NOT NULL,
            label TEXT NOT NULL,
            detail TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS payment_account (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            identity_id TEXT NOT NULL REFERENCES identity(id),
            brand TEXT NOT NULL,
            account_no TEXT NOT NULL,
            holder_name TEXT,
            sort_order INTEGER NOT NULL DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_item_bill ON item(bill_id);
        CREATE INDEX IF NOT EXISTS idx_selection_item ON selection(item_id);
        CREATE INDEX IF NOT EXISTS idx_selection_identity ON selection(identity_id);
        CREATE INDEX IF NOT EXISTS idx_payacct_identity ON payment_account(identity_id);
        """
    )
    # migration: add merchant/transacted_at to existing bills table
    cols = {r[1] for r in conn.execute("PRAGMA table_info(bill)").fetchall()}
    if "merchant" not in cols:
        conn.execute("ALTER TABLE bill ADD COLUMN merchant TEXT")
    if "transacted_at" not in cols:
        conn.execute("ALTER TABLE bill ADD COLUMN transacted_at TEXT")
    # migration: participant claiming (identity_id on bill_participant)
    pcols = {r[1] for r in conn.execute("PRAGMA table_info(bill_participant)").fetchall()}
    if "identity_id" not in pcols:
        conn.execute("ALTER TABLE bill_participant ADD COLUMN identity_id TEXT")
    # migration: participant_count on bill
    bcols = {r[1] for r in conn.execute("PRAGMA table_info(bill)").fetchall()}
    if "participant_count" not in bcols:
        conn.execute("ALTER TABLE bill ADD COLUMN participant_count INTEGER")
    # migration: paid_by (who paid the bill — null means creator pays)
    if "paid_by_name" not in bcols:
        conn.execute("ALTER TABLE bill ADD COLUMN paid_by_name TEXT")
    if "paid_by_identity_id" not in bcols:
        conn.execute("ALTER TABLE bill ADD COLUMN paid_by_identity_id TEXT")
    # migration: item slot mode (v27) — 'free' vs 'slot N' splitting
    icols = {r[1] for r in conn.execute("PRAGMA table_info(item)").fetchall()}
    if "mode" not in icols:
        conn.execute("ALTER TABLE item ADD COLUMN mode TEXT NOT NULL DEFAULT 'free'")
    if "slot_count" not in icols:
        conn.execute("ALTER TABLE item ADD COLUMN slot_count INTEGER")
    if "discount_idr" not in icols:
        conn.execute("ALTER TABLE item ADD COLUMN discount_idr INTEGER NOT NULL DEFAULT 0")
    # migration: bill tax-included flag (v33) — item prices already include tax
    bcols = {r[1] for r in conn.execute("PRAGMA table_info(bill)").fetchall()}
    if "tax_included" not in bcols:
        conn.execute("ALTER TABLE bill ADD COLUMN tax_included INTEGER NOT NULL DEFAULT 0")
    # migration: selection qty (v27) — how many slots a person took
    scols = {r[1] for r in conn.execute("PRAGMA table_info(selection)").fetchall()}
    if "qty" not in scols:
        conn.execute("ALTER TABLE selection ADD COLUMN qty INTEGER NOT NULL DEFAULT 1")
    # migration: identity secret (v51) — the id alone used to be the credential,
    # but every bill payload hands out ids, so anyone with the share link could
    # replay the creator's id and rename them / add their own payment account /
    # set a recovery code (bug: full account takeover from a WhatsApp link).
    # The id stays the public reference; the secret is what authenticates.
    idcols = {r[1] for r in conn.execute("PRAGMA table_info(identity)").fetchall()}
    if "secret" not in idcols:
        conn.execute("ALTER TABLE identity ADD COLUMN secret TEXT")
    # migration: payer confirmation (v51) — a payer resolved by NAME must not
    # inherit management powers, or anyone who joins with the right name owns
    # the bill (bug: "paid_by_name: Budi" + a guest called budi = bill deleted).
    bcols = {r[1] for r in conn.execute("PRAGMA table_info(bill)").fetchall()}
    if "paid_by_confirmed" not in bcols:
        conn.execute(
            "ALTER TABLE bill ADD COLUMN paid_by_confirmed INTEGER NOT NULL DEFAULT 0")
        # existing bills: an id set by the creator was confirmed by definition
        conn.execute(
            "UPDATE bill SET paid_by_confirmed = 1 WHERE paid_by_identity_id IS NOT NULL")
    conn.commit()
    conn.close()


def new_id() -> str:
    return secrets.token_urlsafe(16)


def hash_code(code: str) -> str:
    import hashlib
    return hashlib.sha256(("bagiin:" + code).encode()).hexdigest()


def new_identity(name: str, role: str = "guest") -> dict:
    conn = get_db()
    ident_id = new_id()
    conn.execute(
        "INSERT INTO identity (id, name, role, secret) VALUES (?, ?, ?, ?)",
        (ident_id, name, role, new_id()),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM identity WHERE id = ?", (ident_id,)).fetchone()
    conn.close()
    return dict(row)


def get_identity(ident_id: str):
    conn = get_db()
    row = conn.execute("SELECT * FROM identity WHERE id = ?", (ident_id,)).fetchone()
    conn.close()
    return dict(row) if row else None


def bind_secret(ident_id: str) -> str | None:
    """Give a pre-v51 identity a secret, once, and hand it back.

    Trust-on-first-use migration: identities created before the secret column
    existed have none, and their owner's browser only holds the id. The first
    caller presenting such an id gets a secret minted and bound; every later
    request must present it. Returns None if the identity already has one.
    """
    conn = get_db()
    try:
        cur = conn.execute(
            "UPDATE identity SET secret = ? WHERE id = ? AND secret IS NULL",
            (new_id(), ident_id),
        )
        conn.commit()
        if cur.rowcount == 0:
            return None
        row = conn.execute(
            "SELECT secret FROM identity WHERE id = ?", (ident_id,)).fetchone()
        return row["secret"] if row else None
    finally:
        conn.close()


def restore_identity(code: str):
    """Restore identity by code. Returns (identity, code_matches) or None."""
    h = hash_code(code)
    conn = get_db()
    row = conn.execute(
        "SELECT * FROM identity WHERE identity_code_hash = ?", (h,)
    ).fetchone()
    conn.close()
    return dict(row) if row else None


def set_identity_code(ident_id: str, code: str):
    conn = get_db()
    conn.execute(
        "UPDATE identity SET identity_code_hash = ? WHERE id = ?",
        (hash_code(code), ident_id),
    )
    conn.commit()
    conn.close()


def update_identity_name(ident_id: str, name: str):
    conn = get_db()
    conn.execute("UPDATE identity SET name = ? WHERE id = ?", (name, ident_id))
    conn.commit()
    conn.close()


# ---------- payment accounts ----------

def get_accounts(identity_id: str) -> list[dict]:
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM payment_account WHERE identity_id = ? ORDER BY sort_order, id",
        (identity_id,),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def add_account(identity_id: str, brand: str, account_no: str,
                holder_name: str | None = None) -> dict:
    conn = get_db()
    cur = conn.execute(
        "INSERT INTO payment_account (identity_id, brand, account_no, holder_name) VALUES (?, ?, ?, ?)",
        (identity_id, brand, account_no, holder_name),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM payment_account WHERE id = ?", (cur.lastrowid,)).fetchone()
    conn.close()
    return dict(row)


def update_account(account_id: int, identity_id: str, brand: str, account_no: str,
                   holder_name: str | None = None) -> dict | None:
    conn = get_db()
    cur = conn.execute(
        "UPDATE payment_account SET brand = ?, account_no = ?, holder_name = ? WHERE id = ? AND identity_id = ?",
        (brand, account_no, holder_name, account_id, identity_id),
    )
    conn.commit()
    if cur.rowcount == 0:
        conn.close()
        return None
    row = conn.execute("SELECT * FROM payment_account WHERE id = ?", (account_id,)).fetchone()
    conn.close()
    return dict(row)


def delete_account(account_id: int, identity_id: str) -> bool:
    conn = get_db()
    cur = conn.execute(
        "DELETE FROM payment_account WHERE id = ? AND identity_id = ?",
        (account_id, identity_id),
    )
    conn.commit()
    conn.close()
    return cur.rowcount > 0


def create_bill(creator_id: str, title: str, tax_mode: str,
                subtotal: int, tax: int, service: int, total: int,
                items: list[dict], participants: list[str],
                participant_count: int | None = None,
                photo_path: str | None = None,
                merchant: str | None = None,
                transacted_at: str | None = None,
                paid_by_name: str | None = None,
                tax_included: int = 0) -> dict:
    conn = get_db()
    try:
        bill_id = new_id()
        conn.execute(
            """INSERT INTO bill (id, creator_identity_id, title, merchant, transacted_at,
               photo_path, paid_by_name, subtotal_idr, tax_idr, service_idr, total_idr, tax_mode, participant_count, tax_included)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (bill_id, creator_id, title, merchant, transacted_at, photo_path,
             paid_by_name, subtotal, tax, service, total, tax_mode, participant_count,
             1 if tax_included else 0),
        )
        for i, p in enumerate(participants):
            conn.execute(
                "INSERT INTO bill_participant (bill_id, name, sort_order) VALUES (?, ?, ?)",
                (bill_id, p.strip(), i),
            )
        for i, item in enumerate(items):
            mode = item.get("mode", "free")
            slot_count = item.get("slot_count")
            if mode == "slot":
                slot_count = max(1, int(slot_count or 1))
            else:
                slot_count = None
            conn.execute(
                "INSERT INTO item (bill_id, name, price_idr, sort_order, mode, slot_count, discount_idr) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (bill_id, item["name"], int(item["price"]), i, mode, slot_count,
                 int(item.get("discount", 0) or 0)),
            )
        conn.commit()
        return {"id": bill_id}
    finally:
        conn.close()


def get_bill(bill_id: str):
    conn = get_db()
    bill = conn.execute("SELECT * FROM bill WHERE id = ?", (bill_id,)).fetchone()
    if not bill:
        conn.close()
        return None
    items = conn.execute(
        "SELECT * FROM item WHERE bill_id = ? ORDER BY sort_order, id", (bill_id,)
    ).fetchall()
    participants = conn.execute(
        "SELECT name, identity_id FROM bill_participant WHERE bill_id = ? ORDER BY sort_order",
        (bill_id,),
    ).fetchall()
    selections = conn.execute(
        """SELECT s.item_id, s.identity_id, s.qty, i.name AS item_name, i.price_idr,
                  idn.name AS identity_name
           FROM selection s
           JOIN item i ON i.id = s.item_id
           JOIN identity idn ON idn.id = s.identity_id
           WHERE s.item_id IN (SELECT id FROM item WHERE bill_id = ?)""",
        (bill_id,),
    ).fetchall()
    payments = conn.execute(
        "SELECT * FROM payment WHERE bill_id = ?", (bill_id,)
    ).fetchall()
    conn.close()
    return {
        "bill": dict(bill),
        "items": [dict(i) for i in items],
        "participants": [dict(p) for p in participants],
        "selections": [dict(s) for s in selections],
        "payments": [dict(p) for p in payments],
    }


def update_bill_photo(bill_id: str, photo_path: str | None):
    conn = get_db()
    old = conn.execute("SELECT photo_path FROM bill WHERE id = ?", (bill_id,)).fetchone()
    conn.execute("UPDATE bill SET photo_path = ? WHERE id = ?", (photo_path, bill_id))
    conn.commit()
    conn.close()
    # orphaned by the overwrite — clean up (bug: re-upload leaked files forever)
    if old and old["photo_path"] != photo_path:
        _unlink_photo(old["photo_path"])


UNCHANGED = object()  # "this field was not in the request" (vs. explicitly null)


def update_bill(bill_id: str, title: str, merchant: str | None,
                transacted_at: str | None, participants: list[str] | None,
                items: list[dict], subtotal: int, tax: int, service: int, total: int,
                participant_count=UNCHANGED,
                tax_included: int = 0):
    """Full bill update with item diffing.

    - Items that keep their id -> updated in place, selections preserved.
    - Items with no id -> inserted as new.
    - Items no longer present -> deleted together with their selections.
    - `participants=None` / `participant_count=UNCHANGED` leave those alone.
      They used to be overwritten unconditionally, so every edit of an
      API-created bill silently wiped its roster (bug: the typed names that
      hadn't joined yet disappeared from the "Yang bayar" picker).
    """
    conn = get_db()
    if participant_count is UNCHANGED:
        conn.execute(
            """UPDATE bill SET title = ?, merchant = ?, transacted_at = ?,
               subtotal_idr = ?, tax_idr = ?, service_idr = ?, total_idr = ?, tax_included = ?
               WHERE id = ?""",
            (title, merchant, transacted_at, subtotal, tax, service, total,
             1 if tax_included else 0, bill_id),
        )
    else:
        conn.execute(
            """UPDATE bill SET title = ?, merchant = ?, transacted_at = ?,
               subtotal_idr = ?, tax_idr = ?, service_idr = ?, total_idr = ?, participant_count = ?, tax_included = ?
               WHERE id = ?""",
            (title, merchant, transacted_at, subtotal, tax, service, total, participant_count,
             1 if tax_included else 0, bill_id),
        )
    # participants (simple replace, but keep identity_id claims for same names)
    if participants is not None:
        claims = {r["name"]: r["identity_id"] for r in conn.execute(
            "SELECT name, identity_id FROM bill_participant WHERE bill_id = ? AND identity_id IS NOT NULL",
            (bill_id,)).fetchall()}
        conn.execute("DELETE FROM bill_participant WHERE bill_id = ?", (bill_id,))
        for i, p in enumerate(participants):
            name = p.strip()
            conn.execute(
                "INSERT INTO bill_participant (bill_id, name, identity_id, sort_order) VALUES (?, ?, ?, ?)",
                (bill_id, name, claims.get(name), i),
            )
    # items diff
    existing = {r["id"] for r in conn.execute(
        "SELECT id FROM item WHERE bill_id = ?", (bill_id,))}
    kept = set()
    for i, item in enumerate(items):
        iid = item.get("id")
        mode = item.get("mode", "free")
        slot_count = item.get("slot_count")
        if mode == "slot":
            slot_count = max(1, int(slot_count or 1))
        else:
            slot_count = None
        if iid:
            # verify the id belongs to THIS bill before updating; a stale or
            # foreign id must never clobber/delete a real item (data-loss bug)
            owns = conn.execute(
                "SELECT id FROM item WHERE id = ? AND bill_id = ?", (iid, bill_id)
            ).fetchone()
            if owns:
                # if this item is switching from slot -> free, drop multi-slot qty
                cur_mode = conn.execute(
                    "SELECT mode FROM item WHERE id = ? AND bill_id = ?", (iid, bill_id)
                ).fetchone()
                if cur_mode and cur_mode["mode"] == "slot" and mode != "slot":
                    conn.execute(
                        "UPDATE selection SET qty = 1 WHERE item_id = ? AND qty > 1", (iid,)
                    )
                conn.execute(
                    "UPDATE item SET name = ?, price_idr = ?, sort_order = ?, mode = ?, slot_count = ?, discount_idr = ? WHERE id = ? AND bill_id = ?",
                    (item["name"], int(item["price"]), i, mode, slot_count,
                     int(item.get("discount", 0) or 0), iid, bill_id),
                )
                kept.add(int(iid))
                continue
        # no id, or a stale/foreign id -> insert as a brand-new item (never
        # delete a real item because of an id we don't own)
        cur = conn.execute(
            "INSERT INTO item (bill_id, name, price_idr, sort_order, mode, slot_count, discount_idr) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (bill_id, item["name"], int(item["price"]), i, mode, slot_count,
             int(item.get("discount", 0) or 0)),
        )
        kept.add(cur.lastrowid)
    removed = existing - kept
    if removed:
        ph = ",".join("?" * len(removed))
        conn.execute(f"DELETE FROM selection WHERE item_id IN ({ph})", tuple(removed))
        conn.execute(f"DELETE FROM item WHERE id IN ({ph})", tuple(removed))
    conn.commit()
    conn.close()


def claim_participant(bill_id: str, identity_id: str, name: str):
    """Link a real identity to a creator-typed participant slot.

    Matching is normalized (trimmed + case-insensitive) so "Amel" typed by the
    creator and "amel" typed by the guest resolve to the same person. Only
    unclaimed slots are taken; claiming is idempotent.
    """
    if not name or not name.strip():
        return
    conn = get_db()
    conn.execute(
        """UPDATE bill_participant SET identity_id = ?
           WHERE bill_id = ? AND identity_id IS NULL
             AND LOWER(TRIM(name)) = LOWER(TRIM(?))""",
        (identity_id, bill_id, name),
    )
    # resolve paid_by: if the bill says "paid by <name>" and this person just
    # claimed that slot, link them as the payer (unambiguous identity wins).
    # paid_by_confirmed stays 0 — a name match is a display convenience, not
    # proof, so it must never grant management powers (bug: any guest who
    # joined under the payer's name became the bill owner and could delete it).
    row = conn.execute(
        "SELECT paid_by_identity_id, paid_by_name FROM bill WHERE id = ?", (bill_id,)
    ).fetchone()
    if (
        row and row["paid_by_identity_id"] is None and row["paid_by_name"]
        and row["paid_by_name"].strip().lower() == name.strip().lower()
    ):
        conn.execute(
            "UPDATE bill SET paid_by_identity_id = ? WHERE id = ?",
            (identity_id, bill_id),
        )
    conn.commit()
    conn.close()


def resolve_payer(bill_data: dict) -> tuple[str | None, str]:
    """Who fronted the money, as (identity_id, display_name).

    SINGLE SOURCE OF TRUTH for payer resolution — the detail payload, the
    settled flag and the bill list all call this. They used to each re-derive
    it and disagreed (bug: history said "Kamu udah bayar" while the bill
    itself said the same person still owed the full total).

    An explicit paid_by_identity_id wins. Otherwise a paid_by_name is matched
    against people who joined / claimed a slot. If nothing is declared at all,
    the creator is the payer.
    """
    bill = bill_data["bill"]
    creator_id = bill["creator_identity_id"]
    paid_by_id = bill.get("paid_by_identity_id")
    paid_by_name = bill.get("paid_by_name") or ""

    if paid_by_id:
        ident = get_identity(paid_by_id)
        return paid_by_id, (ident["name"] if ident else paid_by_name)

    if paid_by_name:
        target = paid_by_name.strip().lower()
        candidates = [p["identity_id"] for p in bill_data.get("payments", [])]
        candidates += [p["identity_id"] for p in bill_data.get("participants", [])
                       if p.get("identity_id")]
        for cid in candidates:
            ident = get_identity(cid)
            if ident and ident["name"].strip().lower() == target:
                return cid, ident["name"]
        # declared but not joined yet: nobody is auto-paid, bill can't settle
        return None, paid_by_name

    creator = get_identity(creator_id)
    return creator_id, (creator["name"] if creator else "?")


def set_paid_by(bill_id: str, identity_id: str | None, name: str | None = None,
                confirmed: bool = True):
    """Assign who paid the bill (null identity + null name = creator pays).

    identity_id is preferred (unambiguous); name is kept as a display/resolve
    fallback for people who haven't joined yet. `confirmed` records that a
    manager picked this person on purpose — only a confirmed payer inherits
    management powers (see main._owner_id).
    """
    conn = get_db()
    conn.execute(
        "UPDATE bill SET paid_by_identity_id = ?, paid_by_name = ?, paid_by_confirmed = ? "
        "WHERE id = ?",
        (identity_id, name, 1 if (identity_id and confirmed) else 0, bill_id),
    )
    conn.commit()
    conn.close()


def ensure_payment(bill_id: str, identity_id: str):
    """Record that an identity is part of a bill (join). Idempotent."""
    conn = get_db()
    conn.execute(
        "INSERT OR IGNORE INTO payment (bill_id, identity_id, amount_idr) VALUES (?, ?, 0)",
        (bill_id, identity_id),
    )
    conn.commit()
    conn.close()


def join_bill(bill_id: str, identity_id: str, name: str):
    """Guest joins a bill: recorded as a participant (roster = who joined)."""
    ensure_payment(bill_id, identity_id)
    claim_participant(bill_id, identity_id, name)  # legacy typed-name claim, harmless


def remove_person(bill_id: str, identity_id: str):
    """Creator removes a person from a bill: drops their selections, payment
    record, and any legacy participant claim. If the removed person was the
    assigned payer, the payer falls back to the creator."""
    conn = get_db()
    conn.execute(
        """DELETE FROM selection WHERE identity_id = ? AND item_id IN
           (SELECT id FROM item WHERE bill_id = ?)""",
        (identity_id, bill_id),
    )
    conn.execute(
        "DELETE FROM payment WHERE bill_id = ? AND identity_id = ?",
        (bill_id, identity_id),
    )
    conn.execute(
        "UPDATE bill_participant SET identity_id = NULL WHERE bill_id = ? AND identity_id = ?",
        (bill_id, identity_id),
    )
    conn.execute(
        "UPDATE bill SET paid_by_identity_id = NULL, paid_by_name = NULL, "
        "paid_by_confirmed = 0 WHERE id = ? AND paid_by_identity_id = ?",
        (bill_id, identity_id),
    )
    conn.commit()
    conn.close()


def set_selections(bill_id: str, identity_id: str, picks) -> None:
    """Replace a person's selections for a bill. Auto-ensure identity in payments.

    picks: list of {item_id, qty} (qty = how many portions/slots, default 1).
    Both free-mode and slot-mode items allow qty > 1 (free = portions,
    slot = slots).

    Slot capacity is enforced INSIDE the write transaction (BEGIN IMMEDIATE)
    so two guests tapping the same slot at once can't oversubscribe an item.
    Raises ValueError with a friendly message when a slot item would be
    overbooked.
    """
    # normalize: accept legacy bare item_ids list too
    norm = []
    for p in picks:
        if isinstance(p, dict):
            norm.append((int(p["item_id"]), int(p.get("qty", 1))))
        else:
            norm.append((int(p), 1))
    conn = get_db()
    conn.execute("BEGIN IMMEDIATE")
    try:
        # authoritative re-check against the live DB (not a stale snapshot)
        for item_id, qty in norm:
            it = conn.execute(
                "SELECT id, mode, slot_count FROM item WHERE id = ? AND bill_id = ?",
                (item_id, bill_id),
            ).fetchone()
            if not it:
                raise ValueError("Item invalid")
            if it["mode"] == "slot" and it["slot_count"]:
                taken = conn.execute(
                    "SELECT COALESCE(SUM(qty), 0) AS t FROM selection "
                    "WHERE item_id = ? AND identity_id != ?",
                    (item_id, identity_id),
                ).fetchone()["t"]
                if taken + qty > it["slot_count"]:
                    left = it["slot_count"] - taken
                    raise ValueError(f"Slot tinggal {left}")
        conn.execute(
            """DELETE FROM selection WHERE identity_id = ? AND item_id IN
               (SELECT id FROM item WHERE bill_id = ?)""",
            (identity_id, bill_id),
        )
        for item_id, qty in norm:
            conn.execute(
                "INSERT OR IGNORE INTO selection (item_id, identity_id, qty) VALUES (?, ?, ?)",
                (item_id, identity_id, qty),
            )
        conn.execute(
            "INSERT OR IGNORE INTO payment (bill_id, identity_id, amount_idr) VALUES (?, ?, 0)",
            (bill_id, identity_id),
        )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def set_selection_qty(bill_id: str, identity_id: str, item_id: int, qty: int) -> bool:
    """Set a single person's slot qty on one item (0/absent = remove)."""
    conn = get_db()
    conn.execute(
        "DELETE FROM selection WHERE item_id = ? AND identity_id = ?",
        (item_id, identity_id),
    )
    if qty > 0:
        conn.execute(
            "INSERT OR IGNORE INTO selection (item_id, identity_id, qty) VALUES (?, ?, ?)",
            (item_id, identity_id, qty),
        )
    conn.execute(
        "INSERT OR IGNORE INTO payment (bill_id, identity_id, amount_idr) VALUES (?, ?, 0)",
        (bill_id, identity_id),
    )
    conn.commit()
    conn.close()
    return True


def get_selection(bill_id: str, item_id: int, identity_id: str) -> dict | None:
    conn = get_db()
    row = conn.execute(
        "SELECT * FROM selection WHERE item_id = ? AND identity_id = ?",
        (item_id, identity_id),
    ).fetchone()
    conn.close()
    return dict(row) if row else None


def set_item_slots(bill_id: str, item_id: int, slot_count: int) -> bool:
    """Creator updates an item's slot count. slot_count must be >= taken slots
    (validated by caller); items that are free stay free (slot_count NULL)."""
    conn = get_db()
    cur = conn.execute(
        "UPDATE item SET slot_count = ? WHERE id = ? AND bill_id = ? AND mode = 'slot'",
        (slot_count, item_id, bill_id),
    )
    conn.commit()
    conn.close()
    return cur.rowcount > 0


def clamp_selection_qty(bill_id: str, item_id: int) -> None:
    """After an item switches from slot to free, clamp everyone's qty to 1."""
    conn = get_db()
    conn.execute(
        "UPDATE selection SET qty = 1 WHERE item_id = ? AND qty > 1",
        (item_id,),
    )
    conn.commit()
    conn.close()


def mark_paid(bill_id: str, identity_id: str):
    conn = get_db()
    try:
        # ensure a payment row exists (owner marking someone whose row was dropped
        # by remove_person — otherwise the UPDATE is a silent no-op and the bill
        # can never settle)
        conn.execute(
            "INSERT OR IGNORE INTO payment (bill_id, identity_id, amount_idr) VALUES (?, ?, 0)",
            (bill_id, identity_id),
        )
        conn.execute(
            """UPDATE payment SET status = 'paid', paid_at = datetime('now')
               WHERE bill_id = ? AND identity_id = ?""",
            (bill_id, identity_id),
        )
        conn.commit()
    finally:
        # always release the write lock — an unhandled error here (e.g. FK
        # violation on INSERT) used to leak the open transaction and wedge
        # every concurrent writer with "database is locked" (bug)
        conn.close()


def mark_unpaid(bill_id: str, identity_id: str):
    """Undo a 'sudah bayar' (e.g. mis-tap). Also clears paid_at."""
    conn = get_db()
    conn.execute(
        """UPDATE payment SET status = 'unpaid', paid_at = NULL
           WHERE bill_id = ? AND identity_id = ?""",
        (bill_id, identity_id),
    )
    conn.commit()
    conn.close()


def close_bill(bill_id: str):
    conn = get_db()
    conn.execute(
        "UPDATE bill SET status = 'closed', closed_at = datetime('now') WHERE id = ?",
        (bill_id,),
    )
    conn.commit()
    conn.close()


def reopen_bill(bill_id: str):
    """Reopen a closed bill (creator mis-close / someone still needs to pay)."""
    conn = get_db()
    conn.execute(
        "UPDATE bill SET status = 'open', closed_at = NULL WHERE id = ?",
        (bill_id,),
    )
    conn.commit()
    conn.close()


def delete_bill(bill_id: str, owner_id: str) -> bool:
    """Owner (CONFIRMED payer, else creator) deletes a bill + everything.

    Mirrors _owner_id in main.py (v57): a payer matched only by name is
    display-only and must NOT be able to delete; the creator keeps the key
    only while no payer is confirmed.
    """
    conn = get_db()
    row = conn.execute(
        "SELECT creator_identity_id, paid_by_identity_id, paid_by_name, paid_by_confirmed FROM bill WHERE id = ?",
        (bill_id,),
    ).fetchone()
    if not row:
        conn.close()
        return False
    owner = (
        row["paid_by_identity_id"]
        if (row["paid_by_identity_id"] and row["paid_by_confirmed"])
        else row["creator_identity_id"]
    )
    if owner != owner_id:
        conn.close()
        return False
    photo_path = conn.execute(
        "SELECT photo_path FROM bill WHERE id = ?", (bill_id,)
    ).fetchone()
    conn.execute(
        "DELETE FROM selection WHERE item_id IN (SELECT id FROM item WHERE bill_id = ?)",
        (bill_id,),
    )
    conn.execute("DELETE FROM item WHERE bill_id = ?", (bill_id,))
    conn.execute("DELETE FROM payment WHERE bill_id = ?", (bill_id,))
    conn.execute("DELETE FROM bill_participant WHERE bill_id = ?", (bill_id,))
    conn.execute("DELETE FROM bill WHERE id = ?", (bill_id,))
    conn.commit()
    conn.close()
    if photo_path:
        _unlink_photo(photo_path["photo_path"])
    return True


def _bill_settled(conn, bill_id: str, status: str) -> bool:
    """True when nobody owes anything: everyone with a real share has paid and
    no slot is left empty.

    SINGLE SOURCE OF TRUTH: mirrors main._compute_response's settled logic
    exactly (same calc.compute, same owed definition = total_idr > 0, same
    resolve_payer). The list endpoint used to re-implement this with SQL and
    drifted from the detail view (price-0 picks, tax landing on the creator) —
    bug: settled flag contradicted itself between endpoints.

    Closing a bill does NOT settle it. It used to, so a bill closed with empty
    slots and an unpaid guest still showed a green "Lunas" in history.
    """
    data = get_bill(bill_id)
    if not data:
        return False
    sel_ids = {s["identity_id"] for s in data["selections"]}
    if not sel_ids:
        return False
    result = calc.compute(
        data["bill"], data["items"], data["selections"],
        data["participants"], data["bill"]["creator_identity_id"],
    )
    owed_ids = {p["identity_id"] for p in result["people"] if p["total_idr"] > 0}
    paid_ids = {p["identity_id"] for p in data["payments"] if p["status"] == "paid"}
    payer_id, _ = resolve_payer(data)
    if payer_id:
        paid_ids.add(payer_id)
    return owed_ids <= paid_ids and result["uncovered_idr"] == 0


def get_bills_for_identity(identity_id: str):
    """Bills where identity is creator OR has selections/payments."""
    conn = get_db()
    rows = conn.execute(
        """SELECT DISTINCT b.id, b.title, b.merchant, b.transacted_at,
                  b.total_idr, b.status, b.created_at, b.closed_at,
                  b.creator_identity_id, b.paid_by_identity_id
          FROM bill b
          LEFT JOIN payment p ON p.bill_id = b.id AND p.identity_id = ?
          WHERE b.creator_identity_id = ? OR p.id IS NOT NULL
          ORDER BY COALESCE(b.transacted_at, b.created_at) DESC, b.created_at DESC""",
        (identity_id, identity_id),
    ).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["settled"] = _bill_settled(conn, d["id"], d["status"])
        out.append(d)
    conn.close()
    return out
