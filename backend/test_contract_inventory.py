"""Regression coverage for the currently shipped backend contract surface.

The route inventory mirrors the endpoint surface consumed by the React API
adapter and documented in the active backend behavior notes. Keeping it in one
focused test prevents an endpoint from disappearing during incremental route
extraction without asserting any new product behavior.
"""
import os
import tempfile
from pathlib import Path

_TEST_ROOT = Path(tempfile.mkdtemp(prefix="bagiin-contract-"))
os.environ["BAGIIN_DB"] = str(_TEST_ROOT / "contract.db")
os.environ.setdefault("BAGIIN_UPLOAD_DIR", str(_TEST_ROOT / "uploads"))

import db
from fastapi.testclient import TestClient
import main


db.init_db()
main.limiter.enabled = False
client = TestClient(main.app, raise_server_exceptions=False)


DOCUMENTED_API_ROUTES = {
    ("POST", "/api/identities"),
    ("POST", "/api/identities/restore"),
    ("POST", "/api/identities/{identity_id}/bind"),
    ("POST", "/api/identities/{identity_id}/code"),
    ("POST", "/api/identities/{identity_id}/code/generate"),
    ("POST", "/api/identities/{identity_id}/name"),
    ("GET", "/api/identities/{identity_id}/me"),
    ("GET", "/api/identities/{identity_id}/accounts"),
    ("GET", "/api/identities/{identity_id}/contacts"),
    ("POST", "/api/identities/{identity_id}/auto_accept"),
    ("POST", "/api/identities/{identity_id}/accounts"),
    ("PUT", "/api/accounts/{account_id}"),
    ("DELETE", "/api/accounts/{account_id}"),
    ("GET", "/api/identities/{identity_id}/bills"),
    ("GET", "/api/identities/{identity_id}/recap"),
    ("POST", "/api/bills"),
    ("GET", "/api/bills/{bill_id}"),
    ("PUT", "/api/bills/{bill_id}"),
    ("PUT", "/api/bills/{bill_id}/paid_by"),
    ("DELETE", "/api/bills/{bill_id}"),
    ("POST", "/api/bills/{bill_id}/close"),
    ("POST", "/api/bills/{bill_id}/join"),
    ("POST", "/api/bills/{bill_id}/invite"),
    ("POST", "/api/bills/{bill_id}/invites/{invite_id}/accept"),
    ("POST", "/api/bills/{bill_id}/invites/{invite_id}/decline"),
    ("GET", "/api/identities/{identity_id}/invites"),
    ("DELETE", "/api/bills/{bill_id}/invites/{invite_id}"),
    ("DELETE", "/api/bills/{bill_id}/people/{identity_id}"),
    ("POST", "/api/bills/{bill_id}/leave"),
    ("POST", "/api/bills/{bill_id}/selections"),
    ("PUT", "/api/bills/{bill_id}/items/{item_id}/slots"),
    ("DELETE", "/api/bills/{bill_id}/items/{item_id}/selections/{identity_id}"),
    ("POST", "/api/bills/{bill_id}/payments/{identity_id}/paid"),
    ("POST", "/api/bills/{bill_id}/payments/{identity_id}/unpaid"),
    ("POST", "/api/bills/{bill_id}/reopen"),
    ("POST", "/api/bills/{bill_id}/settle"),
    ("POST", "/api/bills/{bill_id}/unsettle"),
    ("POST", "/api/bills/{bill_id}/photo"),
    ("DELETE", "/api/bills/{bill_id}/photos/{photo_id}"),
    ("POST", "/api/photos"),
    ("DELETE", "/api/photos/{filename}"),
    ("POST", "/api/ocr"),
}


def _headers(identity):
    return {
        "X-Identity-Id": identity["id"],
        "X-Identity-Secret": identity["secret"],
    }


def test_documented_api_route_inventory_matches_fastapi_registration():
    actual = {
        (method, getattr(route, "path", ""))
        for route in main.app.routes
        if getattr(route, "path", "").startswith("/api/")
        for method in (getattr(route, "methods", None) or ())
    }

    assert actual == DOCUMENTED_API_ROUTES


def test_restore_contract_returns_identity_secret_without_secret_hash(monkeypatch):
    identity = db.new_identity("contract restore")
    code = "CONTRACT-RESTORE-123"
    db.set_identity_code(identity["id"], code)

    restored = client.post("/api/identities/restore", json={"code": code})

    assert restored.status_code == 200, restored.text
    payload = restored.json()
    assert payload["id"] == identity["id"]
    assert payload["name"] == identity["name"]
    assert payload["secret"] == identity["secret"]
    assert "identity_code_hash" not in payload

    # A valid code remains a read/restore operation for an already-bound
    # identity; it does not rotate the session secret or require a lockout rule.
    restored_again = client.post("/api/identities/restore", json={"code": code})
    assert restored_again.status_code == 200, restored_again.text
    assert restored_again.json()["secret"] == identity["secret"]


def test_ocr_provider_failure_keeps_manual_fallback_and_does_not_save_photo(
    monkeypatch, tmp_path
):
    identity = db.new_identity("contract OCR")
    upload_dir = tmp_path / "uploads"
    upload_dir.mkdir()
    monkeypatch.setattr(main, "UPLOAD_DIR", upload_dir)

    def failed_ocr(*args, **kwargs):
        raise RuntimeError("provider internals")

    monkeypatch.setattr(main, "ocr_receipt", failed_ocr)

    response = client.post(
        "/api/ocr",
        files={"file": ("receipt.jpg", b"\xff\xd8\xfffixture", "image/jpeg")},
        headers=_headers(identity),
    )

    assert response.status_code == 422, response.text
    assert "manual" in response.json()["detail"].lower()
    assert "provider internals" not in response.text
    assert list(upload_dir.iterdir()) == []


def test_upload_serving_only_exposes_supported_photo_files(tmp_path, monkeypatch):
    upload_dir = tmp_path / "uploads"
    upload_dir.mkdir()
    monkeypatch.setattr(main, "UPLOAD_DIR", upload_dir)
    photo = upload_dir / "contract-photo.jpg"
    photo.write_bytes(b"\xff\xd8\xfffixture")
    (upload_dir / "directory").mkdir()
    (upload_dir / "notes.txt").write_text("not a photo")

    served = client.get("/uploads/contract-photo.jpg")

    assert served.status_code == 200, served.text
    assert served.content == photo.read_bytes()
    assert served.headers["content-type"].startswith("image/jpeg")
    assert served.headers["cache-control"] == "private, max-age=31536000, immutable"
    assert served.headers["x-content-type-options"] == "nosniff"
    for path in ("directory", "notes.txt", "missing.jpg", "%2e%2e"):
        assert client.get(f"/uploads/{path}").status_code == 404
