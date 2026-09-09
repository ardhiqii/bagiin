"""Regression coverage for v83 post-merge upload safety repairs.

A failed bill-photo FK insert must release SQLite before the next writer, and a
relative upload-root configuration must produce paths accepted by bill APIs.
"""
from __future__ import annotations

import os
import subprocess
import sys
import textwrap
from pathlib import Path

BACKEND = Path(__file__).resolve().parent


def _run_isolated(tmp_path: Path, script: str, **variables: str) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env.update(variables)
    env["PYTHONPATH"] = str(BACKEND)
    return subprocess.run(
        [sys.executable, "-c", textwrap.dedent(script)],
        cwd=tmp_path,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )


def test_bill_photo_fk_failure_does_not_lock_followup_write(tmp_path):
    """An FK failure must roll back before the next write opens SQLite."""
    result = _run_isolated(
        tmp_path,
        """
        import sqlite3

        import db

        db.init_db()
        try:
            db.add_bill_photo("v83-missing-bill", "/tmp/v83-missing-photo.jpg")
        except sqlite3.IntegrityError:
            pass
        else:
            raise AssertionError("missing bill insert unexpectedly succeeded")

        identity = db.new_identity("v83-after-photo-failure")
        assert identity["name"] == "v83-after-photo-failure"
        """,
        BAGIIN_DB=str(tmp_path / "fk-failure.db"),
        BAGIIN_UPLOAD_DIR=str(tmp_path / "uploads"),
    )
    assert result.returncode == 0, (
        "FK failure subprocess failed "
        f"({result.returncode}):\nstdout={result.stdout}\nstderr={result.stderr}"
    )


def test_relative_upload_root_returns_bill_acceptable_absolute_path(tmp_path):
    """A relative upload setting must work across upload and bill creation."""
    result = _run_isolated(
        tmp_path,
        """
        from pathlib import Path

        import db
        import main
        from fastapi.testclient import TestClient

        db.init_db()
        main.app.state.limiter.enabled = False
        owner = db.new_identity("v83-relative-upload-owner")
        headers = {
            "X-Identity-Id": owner["id"],
            "X-Identity-Secret": owner["secret"],
        }
        client = TestClient(main.app, raise_server_exceptions=False)
        assert main.UPLOAD_DIR.is_absolute()

        uploaded = client.post(
            "/api/photos",
            headers=headers,
            files={"file": ("receipt.jpg", b"\\xff\\xd8\\xffreceipt", "image/jpeg")},
        )
        assert uploaded.status_code == 200, uploaded.text
        photo_path = uploaded.json()["photo_path"]
        assert Path(photo_path).is_absolute()
        assert Path(photo_path).is_file()

        created = client.post(
            "/api/bills",
            headers=headers,
            json={
                "title": "Relative upload",
                "items": [{"name": "Meal", "price": 100}],
                "subtotal": 100,
                "tax": 0,
                "service": 0,
                "total": 100,
                "photos": [photo_path],
            },
        )
        assert created.status_code == 200, created.text
        """,
        BAGIIN_DB=str(tmp_path / "relative-upload.db"),
        BAGIIN_UPLOAD_DIR="relative-upload-root",
    )
    assert result.returncode == 0, (
        "relative upload subprocess failed "
        f"({result.returncode}):\nstdout={result.stdout}\nstderr={result.stderr}"
    )
