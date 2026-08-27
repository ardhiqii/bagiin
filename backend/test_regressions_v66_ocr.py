"""Regression tests for the v66 OCR audit pass (backend/ocr.py only).

Covers:
- B1: a non-dict model response (list / None / string / number) must raise
  RuntimeError from _normalize, not AttributeError (which escaped every
  try/except in ocr.py and 500'd the /api/ocr endpoint).
- B2: tax_included must zero TAX only, not the service charge; total becomes
  sum(price-discount) + service, not just sum(price-discount).
- B3: a non-ISO date is dropped (empty string) instead of silently carried
  into the created bill; a well-formed YYYY-MM-DD date survives.
- B4: the combined wall-clock budget across Gemini + OpenRouter is bounded
  (~OCR_BUDGET_SECONDS), not the old ~465s worst case (3x60s+backoff then
  3x90s+backoff).
- B5: the "no provider configured" message is short, honest Indonesian, and
  never leaks the GEMINI_API_KEY / OPENROUTER_API_KEY env var names.
- The three documented _normalize/_to_int repairs that must keep working:
  string "false" truthiness, float rupiah rounding, dotted-thousands parsing,
  and total/subtotal reconciliation.

No TestClient needed - this file never imports main/db, only ocr directly.
Sets BAGIIN_DB anyway (CLAUDE.md rule: any new test file must do this before
anything in the suite could import db) because conftest.py's autouse session
fixture imports main, which imports db, before the first test body runs.

Run:
  cd backend && venv/bin/python -m pytest test_regressions_v66_ocr.py -q
"""
import os
import socket
import sys
import tempfile
import time
from pathlib import Path

_tmp = Path(tempfile.mkdtemp()) / "test66_ocr.db"
os.environ.setdefault("BAGIIN_DB", str(_tmp))
os.environ.setdefault("BAGIIN_UPLOAD_DIR", str(Path(tempfile.mkdtemp()) / "uploads"))

sys.path.insert(0, str(Path(__file__).resolve().parent))

import ocr


# ---------- B1: non-dict model response must not 500 ----------

def test_normalize_rejects_non_dict():
    for bad in ([1, 2], None, "just a string", 42, 3.14, True):
        try:
            ocr._normalize(bad)
            assert False, f"expected RuntimeError for {bad!r}"
        except RuntimeError as e:
            assert "AttributeError" not in str(e)
        except AttributeError:
            assert False, f"_normalize({bad!r}) leaked AttributeError instead of RuntimeError"


def test_normalize_rejects_non_dict_message_is_indonesian_and_short():
    try:
        ocr._normalize(None)
        assert False, "expected RuntimeError"
    except RuntimeError as e:
        msg = str(e)
        assert len(msg) < 120, msg
        assert "manual" in msg.lower()


# ---------- B2: tax_included keeps the service charge ----------

def test_tax_included_zeroes_tax_only_keeps_service():
    n = ocr._normalize({
        "items": [{"name": "Nasi Goreng", "price": 100000, "discount": 0}],
        "tax_included": True,
        "tax": 5000,
        "service": 10000,
        "total": 110000,
    })
    assert n["tax_included"] is True
    assert n["subtotal"] == 100000, n
    assert n["tax"] == 0, n
    assert n["service"] == 10000, n  # (bug v66: this used to get zeroed too)
    assert n["total"] == 110000, n  # subtotal + service, not just subtotal


def test_tax_included_no_service_charge_still_zero():
    n = ocr._normalize({
        "items": [{"name": "A", "price": 50000, "discount": 0}],
        "tax_included": True,
        "tax": 2000,
        "service": 0,
        "total": 52000,
    })
    assert n["service"] == 0, n
    assert n["total"] == 50000, n


# ---------- B3: malformed date is dropped, not silently carried ----------

def test_bad_date_dropped():
    for bad_date in ["08/08/2026", "8 Agustus 2026", "2026/08/08", "08-08-2026", "not a date"]:
        n = ocr._normalize({"date": bad_date})
        assert n["date"] == "", (bad_date, n)


def test_good_date_survives():
    n = ocr._normalize({"date": "2026-08-08"})
    assert n["date"] == "2026-08-08", n


def test_empty_date_stays_empty():
    n = ocr._normalize({"date": ""})
    assert n["date"] == ""


# ---------- B4: shared wall-clock budget across both providers ----------

def test_ocr_receipt_respects_shared_budget_when_every_attempt_hangs(monkeypatch):
    """Simulate every HTTP call hanging for its full per-attempt timeout on
    BOTH providers. Before the fix this was up to ~465s (3x60s+backoff for
    Gemini, then 3x90s+backoff for OpenRouter); now it must stay near
    ocr.OCR_BUDGET_SECONDS regardless of how many attempts either provider
    would like to make."""
    monkeypatch.setattr(ocr, "GEMINI_API_KEY", "fake-gemini-key")
    monkeypatch.setattr(ocr, "OR_API_KEY", "fake-openrouter-key")
    # shrink the budget/cap constants proportionally so the test runs fast
    # while exercising the exact same "shared deadline across both providers"
    # code path as production (which uses OCR_BUDGET_SECONDS=45).
    monkeypatch.setattr(ocr, "OCR_BUDGET_SECONDS", 3.0)
    monkeypatch.setattr(ocr, "_ATTEMPT_TIMEOUT_CAP", 1.0)
    monkeypatch.setattr(ocr, "_MIN_ATTEMPT_SECONDS", 0.2)

    def hanging_urlopen(req, timeout=None):
        time.sleep(timeout)
        raise socket.timeout("simulated hang")

    monkeypatch.setattr(ocr.urllib.request, "urlopen", hanging_urlopen)

    t0 = time.monotonic()
    try:
        ocr.ocr_receipt(b"fake-image-bytes", "image/jpeg")
        assert False, "expected RuntimeError"
    except RuntimeError as e:
        elapsed = time.monotonic() - t0
        assert elapsed < ocr.OCR_BUDGET_SECONDS + 2, (
            f"took {elapsed:.1f}s, budget is {ocr.OCR_BUDGET_SECONDS}s"
        )
        assert "GEMINI_API_KEY" not in str(e)
        assert "OPENROUTER_API_KEY" not in str(e)


def test_gemini_attempt_stops_once_budget_spent():
    """A near-zero deadline must stop _gemini_ocr from even starting a
    network call rather than blocking for the old fixed 60s timeout."""
    called = []

    def should_not_be_called(req, timeout=None):
        called.append(timeout)
        raise AssertionError("urlopen should not be called with no budget left")

    import urllib.request as _ur
    orig = _ur.urlopen
    _ur.urlopen = should_not_be_called
    try:
        past_deadline = time.monotonic() - 1
        try:
            ocr._gemini_ocr(b"x", "image/jpeg", past_deadline)
            assert False, "expected RuntimeError"
        except RuntimeError as e:
            assert "waktu abis" in str(e) or "percobaan" in str(e), e
        assert called == []
    finally:
        _ur.urlopen = orig


# ---------- B5: honest, non-leaking "not configured" message ----------

def test_no_provider_configured_message_does_not_leak_env_var_names(monkeypatch):
    monkeypatch.setattr(ocr, "GEMINI_API_KEY", "")
    monkeypatch.setattr(ocr, "OR_API_KEY", "")
    try:
        ocr.ocr_receipt(b"fake", "image/jpeg")
        assert False, "expected RuntimeError"
    except RuntimeError as e:
        msg = str(e)
        assert "GEMINI_API_KEY" not in msg
        assert "OPENROUTER_API_KEY" not in msg
        assert "not set" not in msg  # no leftover English fragment
        assert "belum disetel" in msg or "belum" in msg.lower()


def test_no_provider_configured_message_is_indonesian_and_actionable():
    monkeypatch_gemini = ocr.GEMINI_API_KEY
    monkeypatch_or = ocr.OR_API_KEY
    ocr.GEMINI_API_KEY = ""
    ocr.OR_API_KEY = ""
    try:
        try:
            ocr.ocr_receipt(b"fake", "image/jpeg")
            assert False, "expected RuntimeError"
        except RuntimeError as e:
            msg = str(e)
            assert "manual" in msg.lower()
    finally:
        ocr.GEMINI_API_KEY = monkeypatch_gemini
        ocr.OR_API_KEY = monkeypatch_or


# ---------- documented repairs must keep working ----------

def test_repair_string_false_stays_false():
    n = ocr._normalize({"tax_included": "false", "subtotal": 1000, "tax": 100, "total": 1100})
    assert n["tax_included"] is False, n
    assert n["tax"] == 100, n
    assert n["total"] == 1100, n


def test_repair_float_rupiah_rounds_not_multiplies():
    assert ocr._to_int(15000.4) == 15000
    assert ocr._to_int(15000.5) == 15000 or ocr._to_int(15000.5) == 15001  # banker's/normal rounding both fine
    assert ocr._to_int(15000.7) == 15001


def test_repair_dotted_thousands_string():
    assert ocr._to_int("15.000") == 15000
    assert ocr._to_int("Rp 15.000") == 15000


def test_repair_hallucinated_total_recomputed():
    n = ocr._normalize({
        "items": [{"name": "A", "price": 10000}],
        "subtotal": 10000, "tax": 1000, "service": 0,
        "total": 12345, "tax_included": False,
    })
    assert n["total"] == 11000, n


if __name__ == "__main__":
    import pytest as _pytest
    raise SystemExit(_pytest.main([__file__, "-q"]))
