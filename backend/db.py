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
    value must not be able to delete server files.

    Second guard: skip files another bill still points at. Paths are visible to
    everyone who can read a bill, so submitting a stranger's path and deleting
    your own bill used to unlink their receipt (bug: v64 audit).
    """
    if not photo_path:
        return
    try:
        if _photo_in_use(photo_path):
            return
        p = Path(photo_path)
        if _PHOTO_NAME_RE.match(p.name):
            p.unlink(missing_ok=True)
    except Exception:
        pass


def _photo_in_use(photo_path) -> bool:
    """Is this file still referenced by any bill (new table or legacy column)?"""
    conn = get_db()
    try:
        row = conn.execute(
            "SELECT 1 FROM bill_photo WHERE path = ? "
            "UNION ALL SELECT 1 FROM bill WHERE photo_path = ? LIMIT 1",
            (photo_path, photo_path),
        ).fetchone()
        return row is not None
    finally:
        conn.close()


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

        CREATE TABLE IF NOT EXISTS bill_invite (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            bill_id TEXT NOT NULL REFERENCES bill(id),
            identity_id TEXT NOT NULL REFERENCES identity(id),
            invited_by TEXT NOT NULL REFERENCES identity(id),
            status TEXT NOT NULL DEFAULT 'pending',  -- pending | accepted | declined
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE (bill_id, identity_id)
        );

        CREATE TABLE IF NOT EXISTS bill_photo (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            bill_id TEXT NOT NULL REFERENCES bill(id),
            path TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_item_bill ON item(bill_id);
        CREATE INDEX IF NOT EXISTS idx_selection_item ON selection(item_id);
        CREATE INDEX IF NOT EXISTS idx_selection_identity ON selection(identity_id);
        CREATE INDEX IF NOT EXISTS idx_payacct_identity ON payment_account(identity_id);
        CREATE INDEX IF NOT EXISTS idx_billphoto_bill ON bill_photo(bill_id);
        CREATE INDEX IF NOT EXISTS idx_invite_identity ON bill_invite(identity_id, status);
        CREATE INDEX IF NOT EXISTS idx_invite_bill ON bill_invite(bill_id);
        """
    )
    # migration: identity.auto_accept (default ON) — idempotent for existing DBs
    icols2 = {r[1] for r in conn.execute("PRAGMA table_info(identity)").fetchall()}
    if "auto_accept" not in icols2:
        conn.execute("ALTER TABLE identity ADD COLUMN auto_accept INTEGER NOT NULL DEFAULT 1")
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
    # migration: creator left the bill (v58). Everyone else's membership is
    # derived from their payment/selection rows, so leaving just deletes those.
    # The creator has no such rows — they're added to the roster and to their
    # own history by id — so their exit needs a flag to exist at all.
    bcols = {r[1] for r in conn.execute("PRAGMA table_info(bill)").fetchall()}
    if "creator_left" not in bcols:
        conn.execute(
            "ALTER TABLE bill ADD COLUMN creator_left INTEGER NOT NULL DEFAULT 0")
    # migration: manual bill-level settle (v60). Auto-settled needs the bill to
    # have started (roster > 1), so a solo bill can never reach "Lunas" on its
    # own — but the owner may still want to declare the whole bill settled
    # (paid cash outside the app, or literally just one person). This flag is
    # the explicit override; `settled` becomes manual OR auto.
    bcols = {r[1] for r in conn.execute("PRAGMA table_info(bill)").fetchall()}
    if "settled_manual" not in bcols:
        conn.execute(
            "ALTER TABLE bill ADD COLUMN settled_manual INTEGER NOT NULL DEFAULT 0")
    # migration: multi-photo (v61). bill.photo_path (single, legacy) is
    # converted into bill_photo rows — one per existing photo — and the old
    # column is KEPT untouched (never dropped, never written again) so
    # nothing is lost and a rollback still reads it.
    legacy = conn.execute(
        "SELECT id, photo_path FROM bill WHERE photo_path IS NOT NULL AND photo_path != ''"
    ).fetchall()
    if legacy:
        existing = {
            (r["bill_id"], r["path"]) for r in conn.execute(
                "SELECT bill_id, path FROM bill_photo"
            ).fetchall()
        }
        for row in legacy:
            key = (row["id"], row["photo_path"])
            if key not in existing:
                conn.execute(
                    "INSERT INTO bill_photo (bill_id, path, sort_order) VALUES (?, ?, 0)",
                    (row["id"], row["photo_path"]),
                )
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


def set_auto_accept(ident_id: str, value: bool):
    """Toggle whether direct invites to this identity join instantly (1) or
    land as pending invites the user accepts/declines (0)."""
    conn = get_db()
    conn.execute("UPDATE identity SET auto_accept = ? WHERE id = ?", (1 if value else 0, ident_id))
    conn.commit()
    conn.close()


def get_contacts(identity_id: str, q: str | None = None) -> list[dict]:
    """'Kontak terbukti' — identities who have shared a bill with me.

    Shared = someone is a participant (payment row) on any bill where I am
        the creator or a participant, and vice versa. Excludes myself. Ordered by
        most recent shared bill so the picker shows the people you actually split
        with recently first.
        """
    conn = get_db()
    query = """
        SELECT i.id, i.name, MAX(b.created_at) AS last_shared
        FROM identity i
        JOIN (
            -- people on a bill = creator OR anyone with a payment row there.
            -- UNION (not COALESCE): with a payment present the creator used to
            -- vanish, so contacts were one-directional (Budi saw Aufa's bill
            -- but not Aufa as a contact).
            SELECT b.id, b.created_at, b.creator_identity_id AS person_id
            FROM bill b
            UNION ALL
            SELECT b.id, b.created_at, p.identity_id AS person_id
            FROM payment p
            JOIN bill b ON b.id = p.bill_id
        ) b ON b.person_id = i.id
        WHERE b.id IN (
            SELECT b2.id FROM bill b2
            WHERE b2.creator_identity_id = ?
               OR b2.id IN (SELECT bill_id FROM payment WHERE identity_id = ?)
        )
        AND i.id != ?
    """
    params: list = [identity_id, identity_id, identity_id]
    if q:
        query += " AND i.name LIKE ?"
        params.append(f"%{q}%")
    query += " GROUP BY i.id, i.name ORDER BY last_shared DESC, i.name LIMIT 50"
    rows = conn.execute(query, params).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def is_contact(identity_id: str, other_id: str) -> bool:
    """Have these two ever shared a bill? Same rule as get_contacts, without
    its LIMIT 50 — the invite endpoint used to test membership against that
    truncated list, so the picker (which filters BEFORE the limit) happily
    offered contact #51 and the invite then answered "Bisa ngundang orang yang
    udah pernah share bill aja" (bug: v64 audit)."""
    if not other_id or other_id == identity_id:
        return False
    a, b = identity_id, other_id
    conn = get_db()
    try:
        row = conn.execute(
            """
            SELECT 1 FROM bill x
            WHERE (x.creator_identity_id = ?
                   OR x.id IN (SELECT bill_id FROM payment WHERE identity_id = ?))
              AND (x.creator_identity_id = ?
                   OR x.id IN (SELECT bill_id FROM payment WHERE identity_id = ?))
            LIMIT 1
            """,
            (a, a, b, b),
        ).fetchone()
        return row is not None
    finally:
        conn.close()


# ---------- direct invites (v64) ----------

def reopen_declined_invite(conn, bill_id: str, identity_id: str, invited_by: str) -> bool:
    """Turn a declined invite back into a pending one. Without this a decline
    was permanent: create_invite returned the declined row, the endpoint
    reported "pending", and the invitee never saw a card again (bug: v64
    audit)."""
    cur = conn.execute(
        "UPDATE bill_invite SET status = 'pending', invited_by = ?, created_at = datetime('now') "
        "WHERE bill_id = ? AND identity_id = ? AND status = 'declined'",
        (invited_by, bill_id, identity_id),
    )
    return cur.rowcount > 0


def create_invite(bill_id: str, identity_id: str, invited_by: str) -> dict:
    """Record an invite. Idempotent-ish: an existing pending invite for the
    pair is returned as-is; a fresh invite starts 'pending' (the caller flips
    it to 'accepted' when auto-accept fires)."""
    conn = get_db()
    try:
        existing = conn.execute(
            "SELECT * FROM bill_invite WHERE bill_id = ? AND identity_id = ?",
            (bill_id, identity_id),
        ).fetchone()
        if existing:
            # a declined invite is a "no thanks", not a permanent ban — asking
            # again is a normal thing to do, and returning the declined row
            # made the owner see "undangan dikirim" for an invite that could
            # never appear (bug: v64 audit)
            if existing["status"] == "declined" and reopen_declined_invite(
                    conn, bill_id, identity_id, invited_by):
                conn.commit()
                existing = conn.execute(
                    "SELECT * FROM bill_invite WHERE bill_id = ? AND identity_id = ?",
                    (bill_id, identity_id),
                ).fetchone()
            return dict(existing)
        conn.execute(
            "INSERT INTO bill_invite (bill_id, identity_id, invited_by, status) VALUES (?, ?, ?, 'pending')",
            (bill_id, identity_id, invited_by),
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM bill_invite WHERE bill_id = ? AND identity_id = ?",
            (bill_id, identity_id),
        ).fetchone()
        return dict(row)
    finally:
        conn.close()


def mark_invite_accepted(invite_id: int):
    conn = get_db()
    conn.execute("UPDATE bill_invite SET status = 'accepted' WHERE id = ?", (invite_id,))
    conn.commit()
    conn.close()


def cancel_invite(bill_id: str, invite_id: int) -> bool:
    """Manager withdraws a still-pending invite (v66).

    Before this the sender of an invite to someone with `auto_accept` OFF had
    no way back: the invite sat pending forever, the card kept saying
    "Undang" with no hint one was already outstanding, and a wrong invite
    (fat-fingered contact) could never be taken back (bug found in the v66
    audit). Deletes the row outright rather than flipping a status -- unlike
    a decline there's no state worth keeping, so a later re-invite starts
    fresh through create_invite's normal insert path instead of the
    reopen-declined detour.
    """
    conn = get_db()
    cur = conn.execute(
        "DELETE FROM bill_invite WHERE id = ? AND bill_id = ? AND status = 'pending'",
        (invite_id, bill_id),
    )
    conn.commit()
    ok = cur.rowcount > 0
    conn.close()
    return ok


def get_invite(invite_id: int):
    conn = get_db()
    row = conn.execute("SELECT * FROM bill_invite WHERE id = ?", (invite_id,)).fetchone()
    conn.close()
    return dict(row) if row else None


def get_invites_for_bill(bill_id: str) -> list[dict]:
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM bill_invite WHERE bill_id = ? ORDER BY id", (bill_id,)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_pending_invites(identity_id: str) -> list[dict]:
    """Pending invites for an identity, enriched with bill + inviter names."""
    conn = get_db()
    rows = conn.execute(
        """SELECT v.id, v.bill_id, v.invited_by, v.created_at, v.status,
                  b.title AS bill_title, b.total_idr AS bill_total,
                  inviter.name AS invited_by_name
           FROM bill_invite v
           JOIN bill b ON b.id = v.bill_id
           JOIN identity inviter ON inviter.id = v.invited_by
           WHERE v.identity_id = ? AND v.status = 'pending'
             AND b.status = 'open'
           ORDER BY v.created_at DESC""",
        (identity_id,),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def decline_invite(invite_id: int, identity_id: str) -> bool:
    conn = get_db()
    cur = conn.execute(
        "UPDATE bill_invite SET status = 'declined' WHERE id = ? AND identity_id = ? AND status = 'pending'",
        (invite_id, identity_id),
    )
    conn.commit()
    ok = cur.rowcount > 0
    conn.close()
    return ok


def identity_on_bill(bill_id: str, identity_id: str) -> bool:
    """True if identity is already a participant (payment row) or the creator
    who hasn't walked out.

    (bug: the creator branch counted them unconditionally, so a creator who
    left once a confirmed payer took the bill over (v58, `creator_left=1`)
    could never be invited back -- /invite always answered "Orang ini udah di
    bill" even though they were gone from the roster and their own history.
    `join_bill` already clears the flag on rejoin, so this just has to agree
    that a left creator isn't on the bill.)
    """
    conn = get_db()
    row = conn.execute(
        """SELECT 1 FROM bill b
           WHERE b.id = ?
             AND ((b.creator_identity_id = ? AND b.creator_left = 0)
                  OR EXISTS (SELECT 1 FROM payment p WHERE p.bill_id = b.id AND p.identity_id = ?))""",
        (bill_id, identity_id, identity_id),
    ).fetchone()
    conn.close()
    return row is not None


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
                tax_included: int = 0,
                photos: list[str] | None = None) -> dict:
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
        # multi-photo (v61): every attached photo becomes a bill_photo row.
        # The legacy single photo_path is folded in too so OCR-created bills
        # (which still carry photo_path) get their photo migrated correctly.
        photo_rows = list(photos or [])
        if photo_path and photo_path not in photo_rows:
            photo_rows.insert(0, photo_path)
        for i, path in enumerate(photo_rows):
            conn.execute(
                "INSERT INTO bill_photo (bill_id, path, sort_order) VALUES (?, ?, ?)",
                (bill_id, path, i),
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
    photos = conn.execute(
        "SELECT id, path FROM bill_photo WHERE bill_id = ? ORDER BY sort_order, id",
        (bill_id,),
    ).fetchall()
    conn.close()
    return {
        "bill": dict(bill),
        "items": [dict(i) for i in items],
        "participants": [dict(p) for p in participants],
        "selections": [dict(s) for s in selections],
        "payments": [dict(p) for p in payments],
        "photos": [dict(p) for p in photos],
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


def add_bill_photo(bill_id: str, photo_path: str) -> int:
    """Attach another receipt photo (v61). Returns the new row id."""
    conn = get_db()
    cur = conn.execute(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM bill_photo WHERE bill_id = ?",
        (bill_id,),
    ).fetchone()
    next_order = cur[0]
    c = conn.execute(
        "INSERT INTO bill_photo (bill_id, path, sort_order) VALUES (?, ?, ?)",
        (bill_id, photo_path, next_order),
    )
    conn.commit()
    new_id = c.lastrowid or 0
    conn.close()
    return new_id


def delete_bill_photo(bill_id: str, photo_id: int) -> str | None:
    """Remove one photo FROM THIS BILL; returns its path for unlink (or None).

    Scoped by bill_id on purpose: photo ids are a global autoincrement and every
    reader of a bill payload gets them, so looking a photo up by id alone let
    someone delete another bill's photo through a bill they do manage (bug:
    found in the v64 audit).
    """
    conn = get_db()
    row = conn.execute(
        "SELECT path FROM bill_photo WHERE id = ? AND bill_id = ?",
        (photo_id, bill_id),
    ).fetchone()
    if not row:
        conn.close()
        return None
    conn.execute("DELETE FROM bill_photo WHERE id = ? AND bill_id = ?", (photo_id, bill_id))
    # the legacy single-photo column is what the init_db backfill reads. Leaving
    # it set meant every restart re-created the row the user just deleted, now
    # pointing at an unlinked file (bug: deleted receipts came back).
    conn.execute(
        "UPDATE bill SET photo_path = NULL WHERE id = ? AND photo_path = ?",
        (bill_id, row["path"]),
    )
    conn.commit()
    conn.close()
    return row["path"]


UNCHANGED = object()  # "this field was not in the request" (vs. explicitly null)


def update_bill(bill_id: str, title: str, merchant=UNCHANGED,
                transacted_at=UNCHANGED, participants: list[str] | None = None,
                items: list[dict] = None, subtotal: int = 0, tax: int = 0,
                service: int = 0, total: int = 0,
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
    - `merchant`/`transacted_at`=UNCHANGED (v66) leave those columns alone
      too. Absent keys used to fall through to `None` -> NULL, and
      `transacted_at` now drives the history list's ordering and its
      year/month filter, so a partial-update client quietly moved a bill to
      another month (bug: v66 audit). An explicit `null`/`""` still nulls the
      column -- only a genuinely absent key means "don't touch this".
    """
    conn = get_db()
    set_cols = ["title = ?", "subtotal_idr = ?", "tax_idr = ?", "service_idr = ?",
                "total_idr = ?", "tax_included = ?"]
    params = [title, subtotal, tax, service, total, 1 if tax_included else 0]
    if merchant is not UNCHANGED:
        set_cols.append("merchant = ?")
        params.append(merchant)
    if transacted_at is not UNCHANGED:
        set_cols.append("transacted_at = ?")
        params.append(transacted_at)
    if participant_count is not UNCHANGED:
        set_cols.append("participant_count = ?")
        params.append(participant_count)
    params.append(bill_id)
    conn.execute(f"UPDATE bill SET {', '.join(set_cols)} WHERE id = ?", params)
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

    # nothing declared -> the creator fronted it. Safe even after v58's
    # creator_left: leaving requires a confirmed payer, which is handled above.
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
    if identity_id is None or not confirmed:
        # the bill falls back to the creator as owner — an owner who isn't in
        # their own bill can't happen, so undo their exit (v58)
        conn.execute(
            "UPDATE bill SET creator_left = 0 WHERE id = ?", (bill_id,))
    else:
        conn.execute(
            "UPDATE bill SET creator_left = 0 WHERE id = ? AND creator_identity_id = ?",
            (bill_id, identity_id),
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
    set_creator_left(bill_id, identity_id, left=False)


def set_creator_left(bill_id: str, identity_id: str, left: bool = True):
    """Flag/unflag the creator as having walked out of their own bill (v58).

    No-op unless identity_id really is the creator, so callers can hand it any
    leaver/joiner. Leaving hides them from the roster and from their own bill
    list; rejoining through the link puts them back.
    """
    conn = get_db()
    conn.execute(
        "UPDATE bill SET creator_left = ? WHERE id = ? AND creator_identity_id = ?",
        (1 if left else 0, bill_id, identity_id),
    )
    conn.commit()
    conn.close()


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
    # drop any invite rows too — an 'accepted' invite surviving the removal is
    # a lie (re-invite would report "joined" while the person never re-joined)
    conn.execute(
        "DELETE FROM bill_invite WHERE bill_id = ? AND identity_id = ?",
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


def set_settled_manual(bill_id: str, value: bool):
    """Owner-declared bill-level settle (v60): mark the whole bill lunas in one
    click — for cash settlements outside the app, or a genuinely solo bill
    that can never auto-settle (auto-settled requires roster > 1)."""
    conn = get_db()
    conn.execute(
        "UPDATE bill SET settled_manual = ? WHERE id = ?",
        (1 if value else 0, bill_id),
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
    photo_paths = [
        r[0] for r in conn.execute(
            "SELECT path FROM bill_photo WHERE bill_id = ?", (bill_id,)
        ).fetchall()
    ]
    try:
        conn.execute(
            "DELETE FROM selection WHERE item_id IN (SELECT id FROM item WHERE bill_id = ?)",
            (bill_id,),
        )
        conn.execute("DELETE FROM item WHERE bill_id = ?", (bill_id,))
        conn.execute("DELETE FROM payment WHERE bill_id = ?", (bill_id,))
        conn.execute("DELETE FROM bill_participant WHERE bill_id = ?", (bill_id,))
        conn.execute("DELETE FROM bill_photo WHERE bill_id = ?", (bill_id,))
        # invites reference the bill too (v64). Missing this row meant every
        # bill that had ever been invited to was UNDELETABLE: the FK check
        # (foreign_keys is ON for every connection) raised IntegrityError, the
        # 500 body got replaced by Cloudflare's error page, and — because the
        # exception left this connection holding an open write transaction —
        # the next writes anywhere in the app failed with "database is locked"
        # until it was garbage-collected (bug: v65 audit).
        conn.execute("DELETE FROM bill_invite WHERE bill_id = ?", (bill_id,))
        conn.execute("DELETE FROM bill WHERE id = ?", (bill_id,))
        conn.commit()
    except Exception:
        # never leave the write transaction open: one failed delete used to
        # take unrelated requests down with it
        conn.rollback()
        raise
    finally:
        conn.close()
    for p in photo_paths:
        _unlink_photo(p)
    if photo_path:
        _unlink_photo(photo_path["photo_path"])
    return True


def _bill_settled(conn, bill_id: str, status: str) -> bool:
    """True when nobody owes anything: everyone with a real share has paid and
    no slot is left empty.

    SINGLE SOURCE OF TRUTH: mirrors main._compute_response's settled logic
    exactly (same calc.compute, same owed definition = total_idr > 0, same
    resolve_payer, same roster = people + joined payments + creator). The list
    endpoint used to re-implement this with SQL and drifted from the detail
    view (price-0 picks, tax landing on the creator) — bug: settled flag
    contradicted itself between endpoints.

    A solo bill (nobody joined the creator yet) is NOT settled — it used to
    resolve payer=creator, auto-pay them, and wear a green "Lunas" chip
    before anyone else even joined (bug: "blom ada yg join tp keterangannya
    lunas").

    Closing a bill does NOT settle it. It used to, so a bill closed with empty
    slots and an unpaid guest still showed a green "Lunas" in history.
    """
    data = get_bill(bill_id)
    if not data:
        return False
    bill = data["bill"]
    if bill.get("settled_manual"):
        # the manual override has to be checked BEFORE the "nobody picked
        # anything" shortcut, or a solo bill marked lunas by hand reads
        # "Lunas" on its own screen and "Belum ada yang milih" in the list —
        # and a solo bill is exactly what the button is for (bug: v64 audit)
        return True
    sel_ids = {s["identity_id"] for s in data["selections"]}
    if not sel_ids:
        return False
    # same effective owner as main._owner_id: the CONFIRMED payer, else creator
    pid = bill.get("paid_by_identity_id")
    fallback_id = pid if (pid and bill.get("paid_by_confirmed")) else bill["creator_identity_id"]
    result = calc.compute(
        bill, data["items"], data["selections"],
        data["participants"], fallback_id,
    )
    # same roster as main._compute_response: people + joined-but-unselected
    # payments + creator (until they walk out)
    roster_ids = {p["identity_id"] for p in result["people"]}
    roster_ids |= {p["identity_id"] for p in data["payments"]}
    if not bill.get("creator_left"):
        roster_ids.add(bill["creator_identity_id"])
    owed_ids = {p["identity_id"] for p in result["people"] if p["total_idr"] > 0}
    paid_ids = {p["identity_id"] for p in data["payments"] if p["status"] == "paid"}
    payer_id, _ = resolve_payer(data)
    if payer_id:
        paid_ids.add(payer_id)
    # v60: owner-declared manual settle overrides the auto math (solo bills
    # can never auto-settle — nobody joined — but the owner may still declare
    # it done)
    if bill.get("settled_manual"):
        return True
    return (
        len(roster_ids) > 1
        and owed_ids <= paid_ids
        and result["uncovered_idr"] == 0
    )


def get_bills_for_identity(identity_id: str):
    """Bills where identity is creator OR has selections/payments.

    A creator who left the bill (v58) drops out of it like anyone else: the
    bill stops showing up here unless they rejoin (which gives them a payment
    row, so the join below picks it up again).
    """
    conn = get_db()
    rows = conn.execute(
        """SELECT DISTINCT b.id, b.title, b.merchant, b.transacted_at,
                  b.total_idr, b.status, b.created_at, b.closed_at,
                  b.creator_identity_id, b.paid_by_identity_id, b.paid_by_confirmed
          FROM bill b
          LEFT JOIN payment p ON p.bill_id = b.id AND p.identity_id = ?
          WHERE (b.creator_identity_id = ? AND b.creator_left = 0) OR p.id IS NOT NULL
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
