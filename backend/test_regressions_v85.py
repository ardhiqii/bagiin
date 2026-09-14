"""Regression coverage for the legacy identity recovery migration.

Legacy identities have a public id but no authentication secret.  The recovery
code must be the proof required to bind the first secret; possession of the id
alone is not proof because bill payloads intentionally expose those ids.
"""
import os
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

_TEST_ROOT = Path(tempfile.mkdtemp(prefix="bagiin-v85-"))
os.environ["BAGIIN_DB"] = str(_TEST_ROOT / "test_v85.db")
# conftest.py owns the session upload sandbox; do not replace it during full-suite collection.
os.environ.setdefault("BAGIIN_UPLOAD_DIR", str(_TEST_ROOT / "uploads"))

sys.path.insert(0, str(Path(__file__).resolve().parent))

import db

db.init_db()

from fastapi.testclient import TestClient
from main import app


client = TestClient(app, raise_server_exceptions=False)


def _legacy_identity(name: str, code: str) -> dict:
    ident = db.new_identity(name)
    conn = db.get_db()
    conn.execute("UPDATE identity SET secret = NULL WHERE id = ?", (ident["id"],))
    conn.commit()
    conn.close()
    db.set_identity_code(ident["id"], code)
    return db.get_identity(ident["id"])


def _assert_no_secret(value) -> None:
    if isinstance(value, dict):
        assert "secret" not in value
        for child in value.values():
            _assert_no_secret(child)
    elif isinstance(value, list):
        for child in value:
            _assert_no_secret(child)


def test_legacy_id_only_protected_write_is_rejected_before_bind():
    legacy = _legacy_identity("Legacy85-id-only", "LEGACY-85-ID")

    response = client.post(
        f"/api/identities/{legacy['id']}/name",
        json={"name": "attacker"},
        headers={"X-Identity-Id": legacy["id"]},
    )

    assert response.status_code == 403, response.text
    assert "pemulihan" in response.json()["detail"].lower()
    current = db.get_identity(legacy["id"])
    assert current["secret"] is None
    assert current["name"] == "Legacy85-id-only"


def test_bind_requires_matching_text_recovery_code_without_minting():
    code = "LEGACY-85-BIND"
    legacy = _legacy_identity("Legacy85-bind", code)
    endpoint = f"/api/identities/{legacy['id']}/bind"

    invalid_requests = [
        {},
        {"code": "WRONG-85-CODE"},
        {"code": 12345678},
        {"code": [code]},
    ]
    for payload in invalid_requests:
        response = client.post(endpoint, json=payload)
        assert 400 <= response.status_code < 500, response.text
        assert db.get_identity(legacy["id"])["secret"] is None

    response = client.post(endpoint, json={"code": code})
    assert response.status_code == 200, response.text
    body = response.json()
    assert set(body) == {"id", "name", "secret"}
    assert body["id"] == legacy["id"]
    assert body["secret"]
    assert db.get_identity(legacy["id"])["secret"] == body["secret"]


def test_valid_bind_authenticates_write_and_second_bind_cannot_disclose_secret():
    code = "LEGACY-85-ONCE"
    legacy = _legacy_identity("Legacy85-once", code)
    endpoint = f"/api/identities/{legacy['id']}/bind"

    bound = client.post(endpoint, json={"code": code})
    assert bound.status_code == 200, bound.text
    secret = bound.json()["secret"]

    write = client.post(
        f"/api/identities/{legacy['id']}/name",
        json={"name": "Legacy85-bound"},
        headers={"X-Identity-Id": legacy["id"], "X-Identity-Secret": secret},
    )
    assert write.status_code == 200, write.text
    assert db.get_identity(legacy["id"])["name"] == "Legacy85-bound"

    second = client.post(endpoint, json={"code": code})
    assert second.status_code == 403, second.text
    assert "secret" not in second.json()


def test_valid_legacy_restore_binds_secret_and_wrong_restore_does_not_mutate():
    restore_code = "LEGACY-85-RESTORE"
    legacy = _legacy_identity("Legacy85-restore", restore_code)

    restored = client.post(
        "/api/identities/restore",
        json={"code": restore_code},
    )
    assert restored.status_code == 200, restored.text
    restored_body = restored.json()
    assert restored_body["id"] == legacy["id"]
    assert restored_body["secret"]
    assert db.get_identity(legacy["id"])["secret"] == restored_body["secret"]

    write = client.post(
        f"/api/identities/{legacy['id']}/name",
        json={"name": "Legacy85-restored"},
        headers={
            "X-Identity-Id": legacy["id"],
            "X-Identity-Secret": restored_body["secret"],
        },
    )
    assert write.status_code == 200, write.text

    wrong_code = "LEGACY-85-WRONG"
    untouched = _legacy_identity("Legacy85-wrong-restore", wrong_code)
    before = db.get_identity(untouched["id"])
    rejected = client.post(
        "/api/identities/restore",
        json={"code": "NOT-THE-CODE"},
    )
    assert rejected.status_code == 404, rejected.text
    after = db.get_identity(untouched["id"])
    assert after["secret"] is None
    assert after["identity_code_hash"] == before["identity_code_hash"]


def test_concurrent_legacy_restores_return_the_same_bound_secret():
    code = "LEGACY-85-RACE"
    legacy = _legacy_identity("Legacy85-race", code)

    def restore_once():
        with TestClient(app, raise_server_exceptions=False) as thread_client:
            return thread_client.post("/api/identities/restore", json={"code": code})

    with ThreadPoolExecutor(max_workers=2) as executor:
        responses = list(executor.map(lambda _: restore_once(), range(2)))

    assert [response.status_code for response in responses] == [200, 200]
    secrets = {response.json()["secret"] for response in responses}
    assert len(secrets) == 1
    assert db.get_identity(legacy["id"])["secret"] in secrets


def test_existing_secret_identity_cannot_bind():
    ident = db.new_identity("Legacy85-already-bound")
    code = "LEGACY-85-EXISTING"
    db.set_identity_code(ident["id"], code)
    original_secret = ident["secret"]

    response = client.post(
        f"/api/identities/{ident['id']}/bind",
        json={"code": code},
    )

    assert response.status_code == 403, response.text
    assert "secret" not in response.json()
    assert db.get_identity(ident["id"])["secret"] == original_secret


def test_public_bill_read_works_without_auth_and_never_exposes_identity_secret():
    creator = db.new_identity("Legacy85-public")
    created = db.create_bill(
        creator_id=creator["id"],
        title="Public v85",
        tax_mode="proportional",
        subtotal=1000,
        tax=0,
        service=0,
        total=1000,
        items=[{"name": "A", "price": 1000}],
        participants=[],
    )

    response = client.get(f"/api/bills/{created['id']}")

    assert response.status_code == 200, response.text
    _assert_no_secret(response.json())
