"""Bagiin - SQLite database layer."""
import os
import sqlite3
import secrets
from pathlib import Path

DB_PATH = Path(os.environ.get("BAGIIN_DB", Path(__file__).parent / "bagiin.db"))


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
        "INSERT INTO identity (id, name, role) VALUES (?, ?, ?)",
        (ident_id, name, role),
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
    conn.execute("UPDATE bill SET photo_path = ? WHERE id = ?", (photo_path, bill_id))
    conn.commit()
    conn.close()


def update_bill(bill_id: str, title: str, merchant: str | None,
                transacted_at: str | None, participants: list[str],
                items: list[dict], subtotal: int, tax: int, service: int, total: int,
                participant_count: int | None = None,
                tax_included: int = 0):
    """Full bill update with item diffing.

    - Items that keep their id -> updated in place, selections preserved.
    - Items with no id -> inserted as new.
    - Items no longer present -> deleted together with their selections.
    """
    conn = get_db()
    conn.execute(
        """UPDATE bill SET title = ?, merchant = ?, transacted_at = ?,
           subtotal_idr = ?, tax_idr = ?, service_idr = ?, total_idr = ?, participant_count = ?, tax_included = ?
           WHERE id = ?""",
        (title, merchant, transacted_at, subtotal, tax, service, total, participant_count,
         1 if tax_included else 0, bill_id),
    )
    # participants (simple replace, but keep identity_id claims for same names)
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
    # claimed that slot, link them as the payer (unambiguous identity wins)
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


def set_paid_by(bill_id: str, identity_id: str | None, name: str | None = None):
    """Assign who paid the bill (null identity + null name = creator pays).

    identity_id is preferred (unambiguous); name is kept as a display/resolve
    fallback for people who haven't joined yet.
    """
    conn = get_db()
    conn.execute(
        "UPDATE bill SET paid_by_identity_id = ?, paid_by_name = ? WHERE id = ?",
        (identity_id, name, bill_id),
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
        "UPDATE bill SET paid_by_identity_id = NULL, paid_by_name = NULL "
        "WHERE id = ? AND paid_by_identity_id = ?",
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
    """Owner (resolved payer, else creator) deletes a bill + everything.

    Mirrors _owner_id in main.py: the payer may be a placeholder name that
    resolves against joined identities (hand-off by name before this fix left
    paid_by_identity_id NULL -> bill undeletable by anyone).
    """
    conn = get_db()
    row = conn.execute(
        "SELECT creator_identity_id, paid_by_identity_id, paid_by_name FROM bill WHERE id = ?", (bill_id,)
    ).fetchone()
    if not row:
        conn.close()
        return False
    owner = row["paid_by_identity_id"] or row["creator_identity_id"]
    if not row["paid_by_identity_id"] and row["paid_by_name"]:
        target = row["paid_by_name"].strip().lower()
        hit = conn.execute(
            """SELECT p.identity_id FROM payment p
               JOIN identity idn ON idn.id = p.identity_id
               WHERE p.bill_id = ? AND LOWER(TRIM(idn.name)) = ? LIMIT 1""",
            (bill_id, target),
        ).fetchone()
        if not hit:
            hit = conn.execute(
                """SELECT bp.identity_id FROM bill_participant bp
                   JOIN identity idn ON idn.id = bp.identity_id
                   WHERE bp.bill_id = ? AND bp.identity_id IS NOT NULL
                     AND LOWER(TRIM(idn.name)) = ? LIMIT 1""",
                (bill_id, target),
            ).fetchone()
        if hit and hit["identity_id"]:
            owner = hit["identity_id"]
    if owner != owner_id:
        conn.close()
        return False
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
    return True


def _bill_settled(conn, bill_id: str, status: str) -> bool:
    """True when the bill is closed OR everyone with a share has paid AND
    all slot items are fully taken. Mirrors the detail-view logic:

    - no payer set -> creator is the default payer (auto-paid)
    - resolved payer counts as paid
    - only items with price > 0 create an obligation (price-0 picks don't)
    - unpicked free items default to the creator (owed unless creator is
      the payer or already paid)
    - tax_mode='creator' puts the whole tax/service on the creator too
    """
    if status == "closed":
        return True
    bill = conn.execute(
        """SELECT paid_by_identity_id, paid_by_name, creator_identity_id,
                  tax_mode, tax_idr, service_idr, tax_included
           FROM bill WHERE id = ?""",
        (bill_id,),
    ).fetchone()
    if not bill:
        return False
    paid_by_id = bill["paid_by_identity_id"] if bill else None
    paid_by_name = (bill["paid_by_name"] or "") if bill else ""
    creator_id = bill["creator_identity_id"] if bill else None
    tax_mode = bill["tax_mode"] if bill else "proportional"
    # people with a real share: selectors on items with price > 0
    sel_ids = [r["identity_id"] for r in conn.execute(
        """SELECT DISTINCT s.identity_id FROM selection s
           JOIN item i ON i.id = s.item_id
           WHERE i.bill_id = ? AND i.price_idr > 0""",
        (bill_id,),
    ).fetchall()]
    if not sel_ids:
        return False
    paid = {r["identity_id"] for r in conn.execute(
        "SELECT identity_id FROM payment WHERE bill_id = ? AND status = 'paid'",
        (bill_id,),
    ).fetchall()}
    if paid_by_id:
        paid.add(paid_by_id)
    elif not paid_by_name:
        # no payer declared -> creator is the default payer (mirrors detail)
        paid.add(creator_id)
    if not all(s in paid for s in sel_ids):
        return False
    # unpicked free items -> creator's share; if the creator isn't the payer
    # (or payer is an unresolved placeholder), they're still owed
    is_creator_payer = paid_by_id == creator_id or (not paid_by_id and not paid_by_name)
    if not is_creator_payer:
        unpicked = conn.execute(
            """SELECT COUNT(*) AS c FROM item i
               WHERE i.bill_id = ? AND i.mode != 'slot' AND i.price_idr > 0
                 AND NOT EXISTS (SELECT 1 FROM selection s WHERE s.item_id = i.id)""",
            (bill_id,),
        ).fetchone()
        if unpicked and unpicked["c"] > 0:
            creator_paid = conn.execute(
                "SELECT 1 FROM payment WHERE bill_id = ? AND identity_id = ? AND status = 'paid'",
                (bill_id, creator_id),
            ).fetchone()
            if not creator_paid:
                return False
    # tax_mode='creator' puts the whole tax/service on the creator: they owe
    # even if they never picked an item (mirrors calc.py)
    if not is_creator_payer and tax_mode == "creator":
        tax_service = bill["tax_idr"] + bill["service_idr"]
        if bill["tax_included"]:
            tax_service = bill["service_idr"]
        if tax_service > 0:
            creator_paid = conn.execute(
                "SELECT 1 FROM payment WHERE bill_id = ? AND identity_id = ? AND status = 'paid'",
                (bill_id, creator_id),
            ).fetchone()
            if not creator_paid:
                return False
    # empty slots on slot-mode items mean the bill is not fully covered
    empty = conn.execute(
        """SELECT i.id FROM item i
           LEFT JOIN (SELECT item_id, SUM(qty) AS t FROM selection
                      WHERE item_id IN (SELECT id FROM item WHERE bill_id = ?)
                      GROUP BY item_id) s ON s.item_id = i.id
           WHERE i.bill_id = ? AND i.mode = 'slot' AND i.slot_count IS NOT NULL
             AND COALESCE(s.t, 0) < i.slot_count""",
        (bill_id, bill_id),
    ).fetchall()
    return len(empty) == 0


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
          ORDER BY b.created_at DESC""",
        (identity_id, identity_id),
    ).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["settled"] = _bill_settled(conn, d["id"], d["status"])
        out.append(d)
    conn.close()
    return out
