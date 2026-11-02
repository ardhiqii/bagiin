"""Akun: password, sesi perangkat, tautan Google, dan nama kontak.

Kenapa modul terpisah, bukan menambah db.py: db.py sudah mengurus split math dan
riwayat migrasi bill. Di sini hanya identitas & sesi.

Aturan yang dipegang modul ini:

1. **Identitas tetap `identity.id`.** Username, handle, email Google, dan alias
   semuanya hanya penunjuk ke id itu — tidak ada satu pun jalur yang boleh
   menyimpulkan "orang yang sama" dari kesamaan nama/email.
2. **Rahasia tidak pernah disimpan apa adanya.** Password -> argon2id; token
   perangkat -> sha256.
3. **Kegagalan login tidak membocorkan apa pun.** Semua kegagalan jadi satu
   kalimat yang sama, dan pemeriksaan password tetap dijalankan walau username
   tidak ada (biar waktu jawabnya tidak membocorkan keberadaan username).
"""
from __future__ import annotations

import hashlib
import hmac
import secrets
import re

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError

import db

def init_accounts_schema(conn) -> None:
    """Skema akun & kontak. Dipanggil dari db.init_db(), idempoten.

    Kolom baru di identity ditambahkan lewat PRAGMA check, bukan CREATE TABLE
    ulang: DB yang sudah berisi 59 bill nyata tidak boleh disentuh lebih dari
    satu ALTER TABLE per kolom.
    """
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS device (
            id TEXT PRIMARY KEY,
            identity_id TEXT NOT NULL REFERENCES identity(id),
            token_hash TEXT NOT NULL UNIQUE,
            label TEXT NOT NULL DEFAULT 'Perangkat',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            last_seen_at TEXT,
            revoked_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_device_identity ON device(identity_id);

        CREATE TABLE IF NOT EXISTS oauth_account (
            provider TEXT NOT NULL,
            provider_id TEXT NOT NULL,
            identity_id TEXT NOT NULL REFERENCES identity(id),
            email TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (provider, provider_id)
        );
        CREATE INDEX IF NOT EXISTS idx_oauth_identity ON oauth_account(identity_id);

        CREATE TABLE IF NOT EXISTS contact_alias (
            owner_id TEXT NOT NULL REFERENCES identity(id),
            contact_id TEXT NOT NULL REFERENCES identity(id),
            alias TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (owner_id, contact_id)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_alias_unique
            ON contact_alias(owner_id, lower(alias));
        """
    )
    cols = {r[1] for r in conn.execute("PRAGMA table_info(identity)").fetchall()}
    for column, decl in (
        ("username", "TEXT"),
        ("username_lower", "TEXT"),
        ("password_hash", "TEXT"),
        ("handle", "TEXT"),  # diisi di bawah, hanya untuk pencarian
    ):
        if column not in cols:
            conn.execute(f"ALTER TABLE identity ADD COLUMN {column} {decl}")
    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_identity_username "
        "ON identity(username_lower) WHERE username_lower IS NOT NULL"
    )
    conn.commit()


def backfill_handles(conn) -> None:
    """Isi identity.handle untuk baris lama. Turunan id, jadi selalu sama."""
    rows = conn.execute(
        "SELECT id FROM identity WHERE handle IS NULL OR handle = ''"
    ).fetchall()
    for row in rows:
        conn.execute(
            "UPDATE identity SET handle = ? WHERE id = ?",
            (handle_for(row["id"]), row["id"]),
        )
    if rows:
        conn.commit()


# ---------------------------------------------------------------- password

_hasher = PasswordHasher(time_cost=2, memory_cost=65536, parallelism=2, hash_len=32)

# Dummy hash: dipakai saat username tidak ditemukan supaya waktu jawab login
# untuk "username tidak ada" dan "password salah" tidak bisa dibedakan.
_DUMMY_HASH = _hasher.hash("bagiin-dummy-password-not-a-real-one")


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(stored: str | None, password: str) -> bool:
    """Verifikasi dengan waktu yang tidak membocorkan keberadaan akun."""
    target = stored or _DUMMY_HASH
    try:
        _hasher.verify(target, password)
        return bool(stored)
    except (VerifyMismatchError, InvalidHashError, ValueError):
        return False


def password_problem(password: str) -> str | None:
    """Kalimat untuk user, bukan kode galat. Dipakai UI apa adanya."""
    if len(password) < 8:
        return "Password minimal 8 karakter"
    if len(password) > 200:
        return "Password kepanjangan"
    if password.strip() == "":
        return "Password tidak boleh kosong"
    return None


def set_password(identity_id: str, password: str) -> None:
    problem = password_problem(password)
    if problem:
        raise ValueError(problem)
    conn = db.get_db()
    try:
        conn.execute(
            "UPDATE identity SET password_hash = ? WHERE id = ?",
            (hash_password(password), identity_id),
        )
        conn.commit()
    finally:
        conn.close()


def authenticate(raw_username: str, password: str):
    """Username + password -> baris identity, atau None.

    Waktu jawab disamakan untuk "username tidak ada" dan "password salah":
    verify_password selalu menjalankan argon2, termasuk saat hash-nya kosong.
    """
    ident = find_by_username(raw_username)
    ok = verify_password(ident.get("password_hash") if ident else None, password or "")
    if not ident or not ok:
        return None
    return ident


def needs_rehash(stored: str | None) -> bool:
    if not stored:
        return False
    try:
        return _hasher.check_needs_rehash(stored)
    except (InvalidHashError, ValueError):
        return True


# ---------------------------------------------------------------- username

USERNAME_RE = re.compile(r"^[a-z0-9_]{3,20}$")

# Kata yang jangan sampai jadi username: dipakai UI/rute, atau terlalu gampang
# dipakai menyamar sebagai sistem.
RESERVED_USERNAMES = {
    "admin", "administrator", "bagiin", "support", "help", "root", "system",
    "me", "api", "auth", "masuk", "daftar", "kontak", "settings", "pengaturan",
    "recap", "rekap", "bill", "tagihan", "login", "logout", "null", "undefined",
}


def normalize_username(raw: str) -> str:
    return (raw or "").strip().lstrip("@").lower()


def username_problem(username: str) -> str | None:
    if not username:
        return "Username belum diisi"
    if len(username) < 3:
        return "Username minimal 3 karakter"
    if len(username) > 20:
        return "Username maksimal 20 karakter"
    if not USERNAME_RE.match(username):
        return "Pakai huruf kecil, angka, atau garis bawah (_) saja"
    if username in RESERVED_USERNAMES:
        return "Username ini dipakai sistem, pilih yang lain"
    return None


def set_username(identity_id: str, raw: str) -> str:
    """Simpan username unik. Melempar ValueError dengan kalimat siap tampil."""
    username = normalize_username(raw)
    problem = username_problem(username)
    if problem:
        raise ValueError(problem)
    conn = db.get_db()
    try:
        taken = conn.execute(
            "SELECT id FROM identity WHERE username_lower = ? AND id != ?",
            (username, identity_id),
        ).fetchone()
        if taken:
            raise ValueError("Username ini sudah dipakai orang lain")
        conn.execute(
            "UPDATE identity SET username = ?, username_lower = ? WHERE id = ?",
            (username, username, identity_id),
        )
        conn.commit()
    finally:
        conn.close()
    return username


def find_by_username(raw: str):
    username = normalize_username(raw)
    if not username:
        return None
    conn = db.get_db()
    try:
        row = conn.execute(
            "SELECT * FROM identity WHERE username_lower = ?", (username,)
        ).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


# ---------------------------------------------------------------- handle

# Tanpa I, L, O, 0, 1: gampang dibaca ulang dari layar HP dan tidak tertukar.
_HANDLE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # 24 huruf + 8 angka = 32


def handle_for(identity_id: str) -> str:
    """4 huruf stabil turunan id.

    Dipakai sebagai pembeda visual saat dua orang bernama sama dan belum punya
    username. Diturunkan (bukan disimpan) supaya identity lama langsung punya
    tanpa migrasi data, dan tetap sama selamanya karena id tidak berubah.
    """
    digest = hashlib.sha256(("bagiin-handle:" + identity_id).encode()).digest()
    return "".join(_HANDLE_ALPHABET[b % 32] for b in digest[:4])


# ---------------------------------------------------------------- devices

_DEVICE_PREFIX = "bagiin-dev:"


def _hash_token(token: str) -> str:
    return hashlib.sha256((_DEVICE_PREFIX + token).encode()).hexdigest()


def _device_label(user_agent: str | None) -> str:
    ua = (user_agent or "").lower()
    browser = "Browser"
    for needle, label in (
        ("edg/", "Edge"),
        ("opr/", "Opera"),
        ("chrome/", "Chrome"),
        ("safari/", "Safari"),
        ("firefox/", "Firefox"),
    ):
        if needle in ua:
            browser = label
            break
    if "android" in ua:
        os_name = "Android"
    elif "iphone" in ua or "ipad" in ua:
        os_name = "iOS"
    elif "mac os" in ua:
        os_name = "macOS"
    elif "windows" in ua:
        os_name = "Windows"
    elif "linux" in ua:
        os_name = "Linux"
    else:
        os_name = "Perangkat"
    return f"{browser} · {os_name}"


def create_device(identity_id: str, user_agent: str | None = None) -> str:
    """Buat sesi perangkat baru, kembalikan token mentah (sekali saja)."""
    token = secrets.token_urlsafe(32)
    conn = db.get_db()
    try:
        conn.execute(
            """INSERT INTO device (id, identity_id, token_hash, label, last_seen_at)
               VALUES (?, ?, ?, ?, datetime('now'))""",
            (db.new_id(), identity_id, _hash_token(token), _device_label(user_agent)),
        )
        conn.commit()
    finally:
        conn.close()
    return token


def resolve_device(token: str):
    """Token -> baris identity, atau None. Tidak menyentuh identity.secret."""
    if not token:
        return None
    conn = db.get_db()
    try:
        row = conn.execute(
            """SELECT i.* FROM device d
               JOIN identity i ON i.id = d.identity_id
               WHERE d.token_hash = ? AND d.revoked_at IS NULL""",
            (_hash_token(token),),
        ).fetchone()
        if not row:
            return None
        conn.execute(
            "UPDATE device SET last_seen_at = datetime('now') WHERE token_hash = ?",
            (_hash_token(token),),
        )
        conn.commit()
        return dict(row)
    finally:
        conn.close()


def list_devices(identity_id: str) -> list[dict]:
    conn = db.get_db()
    try:
        rows = conn.execute(
            """SELECT id, label, created_at, last_seen_at, revoked_at,
                      token_hash
               FROM device WHERE identity_id = ?
               ORDER BY COALESCE(last_seen_at, created_at) DESC""",
            (identity_id,),
        ).fetchall()
    finally:
        conn.close()
    return [
        {
            "id": r["id"],
            "label": r["label"],
            "created_at": r["created_at"],
            "last_seen_at": r["last_seen_at"],
            "revoked": bool(r["revoked_at"]),
            "token_hash": r["token_hash"],
        }
        for r in rows
    ]


def revoke_device(identity_id: str, device_id: str) -> bool:
    conn = db.get_db()
    try:
        cur = conn.execute(
            """UPDATE device SET revoked_at = datetime('now')
               WHERE id = ? AND identity_id = ? AND revoked_at IS NULL""",
            (device_id, identity_id),
        )
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def revoke_other_devices(identity_id: str, keep_token: str | None) -> int:
    """Cabut semua sesi perangkat kecuali yang sedang dipakai.

    Dipakai setelah password diganti: kalau sesi lama dibiarkan hidup, mengganti
    password gara-gara curiga tidak mengeluarkan siapa pun.
    """
    keep_hash = _hash_token(keep_token) if keep_token else None
    conn = db.get_db()
    try:
        if keep_hash:
            cur = conn.execute(
                """UPDATE device SET revoked_at = datetime('now')
                   WHERE identity_id = ? AND revoked_at IS NULL AND token_hash != ?""",
                (identity_id, keep_hash),
            )
        else:
            cur = conn.execute(
                """UPDATE device SET revoked_at = datetime('now')
                   WHERE identity_id = ? AND revoked_at IS NULL""",
                (identity_id,),
            )
        conn.commit()
        return cur.rowcount
    finally:
        conn.close()


def device_id_for_token(token: str) -> str | None:
    if not token:
        return None
    conn = db.get_db()
    try:
        row = conn.execute(
            "SELECT id FROM device WHERE token_hash = ? AND revoked_at IS NULL",
            (_hash_token(token),),
        ).fetchone()
        return row["id"] if row else None
    finally:
        conn.close()


# ---------------------------------------------------------------- google

def link_google(identity_id: str, sub: str, email: str | None) -> None:
    """Tautkan akun Google ke identitas. ValueError kalau sudah milik orang lain."""
    conn = db.get_db()
    try:
        row = conn.execute(
            "SELECT identity_id FROM oauth_account WHERE provider = 'google' AND provider_id = ?",
            (sub,),
        ).fetchone()
        if row and row["identity_id"] != identity_id:
            raise ValueError("Akun Google ini sudah tertaut ke identitas lain")
        conn.execute(
            """INSERT INTO oauth_account (provider, provider_id, identity_id, email)
               VALUES ('google', ?, ?, ?)
               ON CONFLICT(provider, provider_id)
               DO UPDATE SET identity_id = excluded.identity_id, email = excluded.email""",
            (sub, identity_id, email),
        )
        conn.commit()
    finally:
        conn.close()


def google_identity_id(sub: str) -> str | None:
    conn = db.get_db()
    try:
        row = conn.execute(
            "SELECT identity_id FROM oauth_account WHERE provider = 'google' AND provider_id = ?",
            (sub,),
        ).fetchone()
        return row["identity_id"] if row else None
    finally:
        conn.close()


def unlink_google(identity_id: str) -> bool:
    conn = db.get_db()
    try:
        cur = conn.execute(
            "DELETE FROM oauth_account WHERE provider = 'google' AND identity_id = ?",
            (identity_id,),
        )
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def google_email(identity_id: str) -> str | None:
    conn = db.get_db()
    try:
        row = conn.execute(
            "SELECT email FROM oauth_account WHERE provider = 'google' AND identity_id = ?",
            (identity_id,),
        ).fetchone()
        return row["email"] if row else None
    finally:
        conn.close()


# ---------------------------------------------------------------- alias

def alias_problem(alias: str) -> str | None:
    if len(alias) > 40:
        return "Nama pembeda maksimal 40 karakter"
    return None


def set_alias(owner_id: str, contact_id: str, alias: str) -> str:
    """Simpan nama yang SAYA beri untuk satu kontak. Satu arah, privat."""
    if owner_id == contact_id:
        raise ValueError("Nama untuk diri sendiri tidak bisa diubah di sini")
    clean = " ".join((alias or "").split())
    problem = alias_problem(clean)
    if problem:
        raise ValueError(problem)
    if not clean:
        raise ValueError("Nama pembeda belum diisi")
    conn = db.get_db()
    try:
        if not db.is_contact(owner_id, contact_id):
            raise ValueError("Orang ini belum pernah bareng bill sama kamu")
        clash = conn.execute(
            """SELECT contact_id FROM contact_alias
               WHERE owner_id = ? AND lower(alias) = lower(?) AND contact_id != ?""",
            (owner_id, clean, contact_id),
        ).fetchone()
        if clash:
            raise ValueError("Nama ini sudah kamu pakai untuk kontak lain")
        conn.execute(
            """INSERT INTO contact_alias (owner_id, contact_id, alias)
               VALUES (?, ?, ?)
               ON CONFLICT(owner_id, contact_id)
               DO UPDATE SET alias = excluded.alias, updated_at = datetime('now')""",
            (owner_id, contact_id, clean),
        )
        conn.commit()
    finally:
        conn.close()
    return clean


def clear_alias(owner_id: str, contact_id: str) -> None:
    conn = db.get_db()
    try:
        conn.execute(
            "DELETE FROM contact_alias WHERE owner_id = ? AND contact_id = ?",
            (owner_id, contact_id),
        )
        conn.commit()
    finally:
        conn.close()


def aliases_for(owner_id: str | None, contact_ids) -> dict[str, str]:
    """Peta contact_id -> alias milik penampil. Kosong kalau tidak ada penampil."""
    ids = [c for c in dict.fromkeys(contact_ids or []) if c and c != owner_id]
    if not owner_id or not ids:
        return {}
    marks = ",".join("?" for _ in ids)
    conn = db.get_db()
    try:
        rows = conn.execute(
            f"""SELECT contact_id, alias FROM contact_alias
                WHERE owner_id = ? AND contact_id IN ({marks})""",
            [owner_id, *ids],
        ).fetchall()
    finally:
        conn.close()
    return {r["contact_id"]: r["alias"] for r in rows}


# ---------------------------------------------------------------- public shape

def public_identity(row: dict, *, include_secret: bool = False) -> dict:
    """Bentuk identity yang aman dikirim ke klien.

    Tanpa ini, SELECT * ikut mengirim password_hash, hash kode pemulihan, dan
    rahasia lain ke browser — yang tidak dibutuhkan UI mana pun.
    """
    out = {
        "id": row.get("id"),
        "name": row.get("name"),
        "role": row.get("role"),
        "auto_accept": row.get("auto_accept"),
        "username": row.get("username"),
        "handle": handle_for(row["id"]) if row.get("id") else None,
        "has_password": bool(row.get("password_hash")),
    }
    if include_secret:
        out["secret"] = row.get("secret")
    return out


def account_state(identity_id: str, token: str | None = None) -> dict:
    """Ringkasan keamanan untuk layar Pengaturan -> Keamanan."""
    ident = db.get_identity(identity_id) or {}
    devices = list_devices(identity_id)
    current_hash = _hash_token(token) if token else None
    active = [d for d in devices if not d["revoked"]]
    return {
        "username": ident.get("username"),
        "handle": handle_for(identity_id),
        "has_password": bool(ident.get("password_hash")),
        "has_recovery_code": bool(ident.get("identity_code_hash")),
        "google": {
            "linked": google_identity_id_for_self(identity_id),
            "email": google_email(identity_id),
        },
        "devices": [
            {
                "id": d["id"],
                "label": d["label"],
                "last_seen_at": d["last_seen_at"],
                "current": bool(current_hash and hmac.compare_digest(d["token_hash"], current_hash)),
            }
            for d in active
        ],
    }


def google_identity_id_for_self(identity_id: str) -> bool:
    conn = db.get_db()
    try:
        row = conn.execute(
            "SELECT 1 FROM oauth_account WHERE provider = 'google' AND identity_id = ?",
            (identity_id,),
        ).fetchone()
        return row is not None
    finally:
        conn.close()
