"""Session-wide test guards.

pytest imports conftest before any test module, which is the only point early
enough to keep the suite off the PRODUCTION upload directory: main.py resolves
BAGIIN_UPLOAD_DIR at import time and mkdir()s it, so whichever test file
imports main first binds that path for the whole session. Every test file sets
BAGIIN_DB itself (CLAUDE.md rule) but uploads were missed, so `pytest -q`
pointed at /var/www/bagiin-uploads — a PermissionError here, and test JPEGs
written into the live directory on the VPS.
"""
import os
import tempfile
from pathlib import Path

import pytest

os.environ.setdefault(
    "BAGIIN_UPLOAD_DIR",
    str(Path(tempfile.mkdtemp(prefix="bagiin-test-uploads-"))),
)


@pytest.fixture(autouse=True, scope="session")
def _disable_rate_limit():
    """slowapi's buckets are per-IP and process-global, so a suite that uploads
    more than 10 photos in a minute starts 429-ing itself regardless of which
    test did the uploading."""
    import main
    main.limiter.enabled = False
    yield
