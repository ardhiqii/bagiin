"""Regression coverage for the React build and legacy static contracts.

The React build is intentionally ignored by git. Run ``npm run build`` from
``frontend`` before this file so the tests exercise the same generated output
that the service serves in production.
"""
import os
import sys
import tempfile
from pathlib import Path

_tmp = Path(tempfile.mkdtemp()) / "static.db"
os.environ["BAGIIN_DB"] = str(_tmp)
os.environ.setdefault(
    "BAGIIN_UPLOAD_DIR",
    str(Path(tempfile.mkdtemp()) / "uploads"),
)

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fastapi.testclient import TestClient

import main


main.app.state.limiter.enabled = False
client = TestClient(main.app, raise_server_exceptions=False)
DIST_DIR = Path(main.FRONTEND_DIR) / "dist"
DIST_ASSETS_DIR = DIST_DIR / "assets"


def _built_asset(suffix: str) -> Path:
    assets = sorted(DIST_ASSETS_DIR.glob(f"*{suffix}"))
    assert assets, f"frontend build is missing a {suffix} asset"
    return assets[0]


def test_root_serves_built_react_index_with_revalidation_headers():
    response = client.get("/")

    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("text/html")
    assert response.headers["cache-control"] == "no-cache, must-revalidate"
    assert "/assets/" in response.text
    assert "/static/favicon.svg" in response.text
    assert "/static/manifest.json" in response.text
    assert "@HASH:" not in response.text

    etag = response.headers.get("etag")
    assert etag
    not_modified = client.get("/", headers={"If-None-Match": etag})
    assert not_modified.status_code == 304
    assert not_modified.headers["cache-control"] == "no-cache, must-revalidate"
    assert not_modified.headers["etag"] == etag


def test_manifest_keeps_legacy_no_cache_contract_and_resolves_hashes():
    response = client.get("/static/manifest.json")

    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("application/manifest+json")
    assert response.headers["cache-control"] == "no-cache, must-revalidate"
    assert "@HASH:" not in response.text

    etag = response.headers["etag"]
    not_modified = client.get(
        "/static/manifest.json",
        headers={"If-None-Match": etag},
    )
    assert not_modified.status_code == 304
    assert not_modified.headers["etag"] == etag


def test_built_js_and_css_are_immutable_with_expected_content_types():
    js = client.get(f"/assets/{_built_asset('.js').name}")
    css = client.get(f"/assets/{_built_asset('.css').name}")

    assert js.status_code == 200, js.text
    assert js.headers["content-type"].startswith(("text/javascript", "application/javascript"))
    assert js.headers["cache-control"] == "public, max-age=31536000, immutable"
    assert css.status_code == 200, css.text
    assert css.headers["content-type"].startswith("text/css")
    assert css.headers["cache-control"] == "public, max-age=31536000, immutable"


def test_built_asset_missing_and_traversal_paths_are_404():
    missing = client.get("/assets/not-a-real-content-hash.js")
    traversal = client.get("/assets/%2e%2e/index.html")

    assert missing.status_code == 404
    assert traversal.status_code == 404


def test_legacy_favicon_and_api_routes_remain_available():
    favicon = client.get("/static/favicon.svg")
    api_response = client.get("/api/bills/not-a-real-bill")

    assert favicon.status_code == 200, favicon.text
    assert favicon.headers["content-type"].startswith("image/svg+xml")
    assert favicon.headers["cache-control"] == "public, max-age=31536000, immutable"
    assert api_response.status_code == 404
    assert api_response.headers["content-type"].startswith("application/json")
    assert api_response.json()["detail"] == "Bill tidak ditemukan"
