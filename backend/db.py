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
            subtotal_idr INTEGER NOT NULL DEFAULT 0,
            tax_idr INTEGER NOT NULL DEFAULT 0,
            service_idr INTEGER NOT NULL DEFAULT 0,
            total_idr INTEGER NOT NULL DEFAULT 0,
            tax_mode TEXT NOT NULL DEFAULT 'proportional',
            status TEXT NOT NULL DEFAULT 'open',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            closed_at TEXT
        );

        CREATE TABLE IF NOT EXISTS bill_participant (
            bill_id TEXT NOT NULL REFERENCES bill(id),
            name TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (bill_id, name)
        );

        CREATE TABLE IF NOT EXISTS item (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            bill_id TEXT NOT NULL REFERENCES bill(id),
            name TEXT NOT NULL,
            price_idr INTEGER NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS selection (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            item_id INTEGER NOT NULL REFERENCES item(id),
            identity_id TEXT NOT NULL REFERENCES identity(id),
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
                photo_path: str | None = None,
                merchant: str | None = None,
                transacted_at: str | None = None) -> dict:
    conn = get_db()
    bill_id = new_id()
    conn.execute(
        """INSERT INTO bill (id, creator_identity_id, title, merchant, transacted_at,
           photo_path, subtotal_idr, tax_idr, service_idr, total_idr, tax_mode)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (bill_id, creator_id, title, merchant, transacted_at, photo_path,
         subtotal, tax, service, total, tax_mode),
    )
    for i, p in enumerate(participants):
        conn.execute(
            "INSERT INTO bill_participant (bill_id, name, sort_order) VALUES (?, ?, ?)",
            (bill_id, p.strip(), i),
        )
    for i, item in enumerate(items):
        conn.execute(
            "INSERT INTO item (bill_id, name, price_idr, sort_order) VALUES (?, ?, ?, ?)",
            (bill_id, item["name"], int(item["price"]), i),
        )
    conn.commit()
    conn.close()
    return {"id": bill_id}


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
        "SELECT name FROM bill_participant WHERE bill_id = ? ORDER BY sort_order",
        (bill_id,),
    ).fetchall()
    selections = conn.execute(
        """SELECT s.item_id, s.identity_id, i.name AS item_name, i.price_idr,
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


def update_bill(bill_id: str, title: str, merchant: str | None,
                transacted_at: str | None, participants: list[str],
                items: list[dict], subtotal: int, tax: int, service: int, total: int):
    """Full bill update with item diffing.

    - Items that keep their id -> updated in place, selections preserved.
    - Items with no id -> inserted as new.
    - Items no longer present -> deleted together with their selections.
    """
    conn = get_db()
    conn.execute(
        """UPDATE bill SET title = ?, merchant = ?, transacted_at = ?,
           subtotal_idr = ?, tax_idr = ?, service_idr = ?, total_idr = ?
           WHERE id = ?""",
        (title, merchant, transacted_at, subtotal, tax, service, total, bill_id),
    )
    # participants (simple replace)
    conn.execute("DELETE FROM bill_participant WHERE bill_id = ?", (bill_id,))
    for i, p in enumerate(participants):
        conn.execute(
            "INSERT INTO bill_participant (bill_id, name, sort_order) VALUES (?, ?, ?)",
            (bill_id, p.strip(), i),
        )
    # items diff
    existing = {r["id"] for r in conn.execute(
        "SELECT id FROM item WHERE bill_id = ?", (bill_id,))}
    kept = set()
    for i, item in enumerate(items):
        iid = item.get("id")
        if iid:
            conn.execute(
                "UPDATE item SET name = ?, price_idr = ?, sort_order = ? WHERE id = ? AND bill_id = ?",
                (item["name"], int(item["price"]), i, iid, bill_id),
            )
            kept.add(int(iid))
        else:
            cur = conn.execute(
                "INSERT INTO item (bill_id, name, price_idr, sort_order) VALUES (?, ?, ?, ?)",
                (bill_id, item["name"], int(item["price"]), i),
            )
            kept.add(cur.lastrowid)
    removed = existing - kept
    if removed:
        ph = ",".join("?" * len(removed))
        conn.execute(f"DELETE FROM selection WHERE item_id IN ({ph})", tuple(removed))
        conn.execute(f"DELETE FROM item WHERE id IN ({ph})", tuple(removed))
    conn.commit()
    conn.close()


def set_selections(bill_id: str, identity_id: str, item_ids: list[int]):
    """Replace a person's selections for a bill. Auto-ensure identity in payments."""
    conn = get_db()
    conn.execute(
        """DELETE FROM selection WHERE identity_id = ? AND item_id IN
           (SELECT id FROM item WHERE bill_id = ?)""",
        (identity_id, bill_id),
    )
    for item_id in item_ids:
        conn.execute(
            "INSERT OR IGNORE INTO selection (item_id, identity_id) VALUES (?, ?)",
            (item_id, identity_id),
        )
    # ensure payment row exists for this identity (amount computed later)
    conn.execute(
        "INSERT OR IGNORE INTO payment (bill_id, identity_id, amount_idr) VALUES (?, ?, 0)",
        (bill_id, identity_id),
    )
    conn.commit()
    conn.close()


def mark_paid(bill_id: str, identity_id: str):
    conn = get_db()
    conn.execute(
        """UPDATE payment SET status = 'paid', paid_at = datetime('now')
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


def get_bills_for_identity(identity_id: str):
    """Bills where identity is creator OR has selections/payments."""
    conn = get_db()
    rows = conn.execute(
        """SELECT DISTINCT b.id, b.title, b.merchant, b.transacted_at,
                  b.total_idr, b.status, b.created_at, b.closed_at
          FROM bill b
          LEFT JOIN payment p ON p.bill_id = b.id AND p.identity_id = ?
          WHERE b.creator_identity_id = ? OR p.id IS NOT NULL
          ORDER BY b.created_at DESC""",
        (identity_id, identity_id),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]
