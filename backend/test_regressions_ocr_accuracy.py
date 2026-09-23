"""Deterministic regressions for free-provider OCR receipt accuracy.

These tests exercise request construction and normalization only. They never call
Gemini or OpenRouter.
"""
import base64
from email.message import Message
import io
import json
import os
import socket
import sys
import tempfile
import time
import urllib.error
from pathlib import Path

import pytest

os.environ.setdefault("BAGIIN_DB", str(Path(tempfile.mkdtemp()) / "ocr-accuracy.db"))
os.environ.setdefault("BAGIIN_UPLOAD_DIR", str(Path(tempfile.mkdtemp()) / "uploads"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import ocr


class _Response:
    def __init__(self, payload):
        self._payload = json.dumps(payload).encode()

    def read(self):
        return self._payload


class _RawResponse:
    def __init__(self, payload):
        self._payload = payload

    def read(self):
        return self._payload


def _gemini_response(parts):
    return _Response({
        "candidates": [{"content": {"parts": parts}}],
    })


def _provider_response():
    return _Response({
        "choices": [{
            "message": {
                "content": json.dumps({
                    "items": [{"name": "Item", "price": 100}],
                    "subtotal": 100,
                    "tax": 0,
                    "service": 0,
                    "total": 100,
                    "tax_included": False,
                }),
            },
        }],
    })


def _request_payload(request):
    return json.loads(request.data.decode())


def _model_from_request(request):
    return _request_payload(request)["model"]


def test_gemini_ignores_thought_part_when_answer_text_is_present(monkeypatch):
    thought = {
        "thought": True,
        "text": json.dumps({
            "merchant": "Thought only",
            "items": [],
            "subtotal": 0,
            "tax": 0,
            "service": 0,
            "total": 0,
            "tax_included": False,
        }),
    }
    answer = {
        "text": json.dumps({
            "merchant": "Warung Nyata",
            "items": [{"name": "Nasi Goreng", "price": 25000}],
            "subtotal": 25000,
            "tax": 0,
            "service": 0,
            "total": 25000,
            "tax_included": False,
        }),
    }
    monkeypatch.setattr(ocr, "GEMINI_API_KEY", "fake-gemini-key")
    monkeypatch.setattr(
        ocr.urllib.request,
        "urlopen",
        lambda request, timeout=None: _gemini_response([thought, answer]),
    )

    result = ocr._gemini_ocr(b"image", "image/jpeg", time.monotonic() + 5)

    assert result["merchant"] == "Warung Nyata"
    assert result["items"] == [{"name": "Nasi Goreng", "price": 25000, "discount": 0, "quantity": 1}]


def test_gemini_keeps_single_text_part_compatibility(monkeypatch):
    answer = {
        "text": json.dumps({
            "merchant": "Satu Bagian",
            "items": [{"name": "Teh", "price": 5000}],
            "subtotal": 5000,
            "tax": 0,
            "service": 0,
            "total": 5000,
            "tax_included": False,
        }),
    }
    monkeypatch.setattr(ocr, "GEMINI_API_KEY", "fake-gemini-key")
    monkeypatch.setattr(
        ocr.urllib.request,
        "urlopen",
        lambda request, timeout=None: _gemini_response([answer]),
    )

    result = ocr._gemini_ocr(b"image", "image/jpeg", time.monotonic() + 5)

    assert result["merchant"] == "Satu Bagian"
    assert result["total"] == 5000


def test_system_prompt_explains_unit_price_quantity_discount_and_line_total():
    prompt = ocr.SYSTEM_PROMPT.lower()

    assert "harga satuan" in prompt
    assert "unit price" in prompt
    assert "quantity" in prompt
    assert "diskon" in prompt
    assert "line total" in prompt
    assert "total baris" in prompt
    assert "35000" in prompt
    assert "70000" in prompt
    assert "salin persis" in prompt
    assert "jangan menerjemahkan" in prompt
    assert "meragukan" in prompt
    assert "jangan menggabungkan" in prompt or "terpisah" in prompt


def test_openrouter_data_url_uses_jpeg_for_transformed_bytes(monkeypatch):
    requests = []
    monkeypatch.setattr(ocr, "_downscale", lambda image: b"transformed-jpeg")

    def fake_urlopen(request, timeout=None):
        requests.append(request)
        return _provider_response()

    monkeypatch.setattr(ocr.urllib.request, "urlopen", fake_urlopen)
    ocr._openrouter_ocr(
        b"original-png",
        time.monotonic() + 5,
        mime_type="image/png",
    )

    payload = _request_payload(requests[0])
    image_url = payload["messages"][0]["content"][1]["image_url"]["url"]
    assert image_url.startswith("data:image/jpeg;base64,")
    assert base64.b64decode(image_url.split(",", 1)[1]) == b"transformed-jpeg"


def test_openrouter_data_url_preserves_mime_when_bytes_are_not_transformed(monkeypatch):
    requests = []
    original = b"original-webp"
    monkeypatch.setattr(ocr, "_downscale", lambda image: image)

    def fake_urlopen(request, timeout=None):
        requests.append(request)
        return _provider_response()

    monkeypatch.setattr(ocr.urllib.request, "urlopen", fake_urlopen)
    ocr._openrouter_ocr(
        original,
        time.monotonic() + 5,
        mime_type="image/webp",
    )

    payload = _request_payload(requests[0])
    image_url = payload["messages"][0]["content"][1]["image_url"]["url"]
    assert image_url.startswith("data:image/webp;base64,")
    assert base64.b64decode(image_url.split(",", 1)[1]) == original


def test_openrouter_requests_json_object_response_format(monkeypatch):
    requests = []
    monkeypatch.setattr(ocr, "_downscale", lambda image: image)

    def fake_urlopen(request, timeout=None):
        requests.append(request)
        return _provider_response()

    monkeypatch.setattr(ocr.urllib.request, "urlopen", fake_urlopen)
    ocr._openrouter_ocr(b"image", time.monotonic() + 5)

    payload = _request_payload(requests[0])
    assert payload["response_format"] == {"type": "json_object"}


def test_openrouter_retries_without_json_option_when_provider_rejects_it(monkeypatch):
    requests = []
    monkeypatch.setattr(ocr, "_downscale", lambda image: image)

    def fake_urlopen(request, timeout=None):
        requests.append(request)
        if len(requests) == 1:
            raise urllib_http_error(request, b"response_format is unsupported")
        return _provider_response()

    monkeypatch.setattr(ocr.urllib.request, "urlopen", fake_urlopen)
    result = ocr._openrouter_ocr(b"image", time.monotonic() + 5)

    assert len(requests) == 2
    first_payload = _request_payload(requests[0])
    fallback_payload = _request_payload(requests[1])
    assert first_payload["response_format"] == {"type": "json_object"}
    assert "response_format" not in fallback_payload
    assert result["items"] == [{"name": "Item", "price": 100, "discount": 0, "quantity": 1}]


def test_openrouter_model_config_preserves_order_and_legacy_override():
    assert ocr._parse_openrouter_models(
        " second:free, first:free, second:free, paid/model",
        "legacy:free",
    ) == ("second:free", "first:free")
    assert ocr._parse_openrouter_models("", "legacy:free") == ("legacy:free",)
    assert ocr._parse_openrouter_models("paid/model", "legacy:free") == ocr.DEFAULT_OPENROUTER_OCR_MODELS
    assert ocr.DEFAULT_OPENROUTER_OCR_MODELS[0] == "google/gemma-4-26b-a4b-it:free"
    assert ocr.DEFAULT_OPENROUTER_OCR_MODELS[-1] == "openrouter/free"
    assert all(ocr._is_free_openrouter_model(model) for model in ocr.DEFAULT_OPENROUTER_OCR_MODELS)


# ---- v98: default chain contains no known-dead vision routes ----


def test_default_chain_excludes_known_403_routes():
    """(bug v98) production journal 2026-09-23 20:41/21:41 shows both Inkling
    routes answering HTTP 403 on every attempt, after the only working free
    routes had already been consumed by 429/timeout."""
    for dead in (
        "thinkingmachines/inkling-small:free",
        "thinkingmachines/inkling:free",
    ):
        assert dead not in ocr.DEFAULT_OPENROUTER_OCR_MODELS
        assert not ocr._is_supported_openrouter_vision_model(dead)


def test_unsupported_routes_are_dropped_from_env_override_too():
    """The production systemd override still names the 403 routes; filtering must
    happen at parse time so no config change is needed to stop paying for them."""
    parsed = ocr._parse_openrouter_models(
        "google/gemma-4-26b-a4b-it:free,thinkingmachines/inkling-small:free,"
        "thinkingmachines/inkling:free,dots-studio/dots-3-note-preview:free",
        "",
    )
    assert parsed == (
        "google/gemma-4-26b-a4b-it:free",
        "dots-studio/dots-3-note-preview:free",
    )
    # An override made ONLY of dead routes still falls back to a usable chain.
    assert ocr._parse_openrouter_models(
        "thinkingmachines/inkling:free", ""
    ) == ocr.DEFAULT_OPENROUTER_OCR_MODELS


def test_active_models_drops_injected_unsupported_route(monkeypatch):
    monkeypatch.setattr(
        ocr,
        "OR_MODELS",
        ("ok:free", "thinkingmachines/inkling:free"),
    )
    monkeypatch.setattr(ocr, "OR_MODEL", "ok:free")
    assert ocr._active_openrouter_models() == ("ok:free",)


def test_default_chain_still_only_offers_free_routes():
    assert ocr.DEFAULT_OPENROUTER_OCR_MODELS == (
        "google/gemma-4-26b-a4b-it:free",
        "google/gemma-4-31b-it:free",
        "dots-studio/dots-3-note-preview:free",
        "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
        "openrouter/free",
    )


# ---- v98: hard budget safely below the edge proxy read timeout ----


def test_hard_budget_is_below_edge_proxy_timeout_with_margin():
    """(bug v98) the bagiin nginx vhost sets no proxy_read_timeout, so the 60s
    nginx default is the real boundary; a budget at/above it turns a later 200
    into a client-visible 504."""
    assert ocr.OCR_BUDGET_SECONDS < ocr._EDGE_PROXY_TIMEOUT_SECONDS
    # Budget + setup overhead + the measured per-request overshoot must all fit.
    assert (
        ocr.OCR_BUDGET_SECONDS
        + ocr._BUDGET_OVERHEAD_SECONDS
        + ocr._BUDGET_OVERSHOOT_ALLOWANCE_SECONDS
    ) <= ocr._EDGE_PROXY_TIMEOUT_SECONDS
    assert ocr._hard_budget_seconds() == ocr.OCR_BUDGET_SECONDS


# Scheduling assertions compare float arithmetic against exact constants;
# allow a hair of representation error at the boundaries.
_SCHEDULE_EPS = 1e-6


def _budget_plus_allowances(budget: float) -> float:
    return (
        budget
        + ocr._BUDGET_OVERHEAD_SECONDS
        + ocr._BUDGET_OVERSHOOT_ALLOWANCE_SECONDS
    )


def _legacy_ceiling() -> float:
    """The pre-review ceiling: allowances only, no safety value (review F2)."""
    return (
        ocr._EDGE_PROXY_TIMEOUT_SECONDS
        - ocr._BUDGET_OVERHEAD_SECONDS
        - ocr._BUDGET_OVERSHOOT_ALLOWANCE_SECONDS
    )


def test_hard_budget_clamps_an_overlarge_configured_value():
    assert ocr._hard_budget_seconds(10_000.0) == (
        ocr._EDGE_PROXY_TIMEOUT_SECONDS
        - ocr._BUDGET_OVERHEAD_SECONDS
        - ocr._BUDGET_OVERSHOOT_ALLOWANCE_SECONDS
        - ocr._BUDGET_SAFETY_MARGIN_SECONDS
    )
    assert ocr._hard_budget_seconds(12.5) == 12.5
    assert ocr._hard_budget_seconds(0) == 0.0
    # Defensive: a malformed override must not blow the deadline open.
    assert ocr._hard_budget_seconds("not-a-number") == ocr.OCR_BUDGET_SECONDS


def test_hard_budget_invariant_holds_at_the_clamp_value(monkeypatch):
    """(review F2) the clamp must be closed under its own ceiling.

    The margin invariant used to be asserted only for the shipped
    OCR_BUDGET_SECONDS (40). But the ceiling was exactly 60 - 5 - 7 = 48, and
    48 + 5 + 7 = 60 is the boundary itself - so ANY configured value at or above
    the clamp re-opened the gap the whole constant exists to close, and the
    docstring's "a config/constant mistake cannot re-open that gap" was false
    for the one value most likely to be produced by a mistake.

    This asserts the strict invariant at the clamp value itself, which is the
    largest number _hard_budget_seconds() can ever return.
    """
    clamp = ocr._hard_budget_seconds(10_000.0)
    assert clamp > ocr.OCR_BUDGET_SECONDS, (
        "the clamp must be the worst case, not the default"
    )
    # The actual requirement: even the clamp leaves real margin under the edge.
    assert _budget_plus_allowances(clamp) < ocr._EDGE_PROXY_TIMEOUT_SECONDS
    # And it is still a genuine safety margin, not a rounding crumb.
    assert ocr._EDGE_PROXY_TIMEOUT_SECONDS - _budget_plus_allowances(clamp) >= 1.0

    # The invariant must hold for every value the function can return, not just
    # the clamp and the default.
    for requested in (0, 1, 12.5, ocr.OCR_BUDGET_SECONDS, clamp, 10_000.0):
        asserted = ocr._hard_budget_seconds(requested)
        assert asserted <= clamp
        assert _budget_plus_allowances(asserted) < ocr._EDGE_PROXY_TIMEOUT_SECONDS


def test_hard_budget_invariant_is_non_vacuous_against_the_old_ceiling():
    """(review F2) proof the previous assertion above can fail.

    The same strict invariant, evaluated at the OLD ceiling computation (no
    safety value), sits exactly ON the boundary: 48 + 5 + 7 == 60. Without the
    safety margin the assertion is a real, failing check - which is what makes
    the fixed version meaningful rather than tautological.
    """
    legacy_clamp = _legacy_ceiling()
    assert _budget_plus_allowances(legacy_clamp) == ocr._EDGE_PROXY_TIMEOUT_SECONDS
    assert not (_budget_plus_allowances(legacy_clamp) < ocr._EDGE_PROXY_TIMEOUT_SECONDS)

    # And the shipped version is strictly better, not merely different.
    fixed_clamp = ocr._hard_budget_seconds(10_000.0)
    assert fixed_clamp < legacy_clamp


def test_whole_chain_deadline_uses_the_clamped_budget(monkeypatch):
    """A huge OCR_BUDGET_SECONDS constant must not push the chain past the edge."""
    monkeypatch.setattr(ocr, "GEMINI_API_KEY", "fake-gemini-key")
    monkeypatch.setattr(ocr, "OR_API_KEY", "fake-openrouter-key")
    monkeypatch.setattr(ocr, "OCR_BUDGET_SECONDS", 10_000.0)
    observed = {}
    clock_start = time.monotonic()

    def slow_gemini(image_bytes, mime_type, deadline):
        observed["primary_deadline"] = deadline
        raise RuntimeError("simulated primary failure")

    def fallback(image_bytes, deadline, mime_type="image/jpeg"):
        observed["fallback_deadline"] = deadline
        return {
            "merchant": "",
            "date": "",
            "items": [],
            "subtotal": 0,
            "order_discount": 0,
            "tax": 0,
            "service": 0,
            "total": 0,
            "tax_included": False,
        }

    monkeypatch.setattr(ocr, "_gemini_ocr", slow_gemini)
    monkeypatch.setattr(ocr, "_openrouter_ocr", fallback)

    ocr.ocr_receipt(b"image", "image/jpeg")

    ceiling = ocr._EDGE_PROXY_TIMEOUT_SECONDS - ocr._BUDGET_OVERHEAD_SECONDS
    whole_call = observed["fallback_deadline"] - clock_start
    assert 0 < whole_call <= ceiling + 0.5
    # The primary hop must also stay inside the same single budget.
    assert observed["primary_deadline"] <= observed["fallback_deadline"]


def test_gemini_does_not_retry_a_retryable_status(monkeypatch):
    """(bug v98) a 429/5xx from Gemini used to be retried with a growing backoff
    before the fallback started, which is pure amplification inside one budget."""
    monkeypatch.setattr(ocr, "GEMINI_API_KEY", "fake-gemini-key")
    calls = []

    def fake_urlopen(request, timeout=None):
        calls.append(timeout)
        raise urllib_http_error(request, b'{"error":"rate limited"}', code=429)

    monkeypatch.setattr(ocr.urllib.request, "urlopen", fake_urlopen)

    with pytest.raises(RuntimeError):
        ocr._gemini_ocr(b"image", "image/jpeg", time.monotonic() + 30)

    assert len(calls) == 1


class _FrozenClock:
    """Deterministic clock for the scheduling arithmetic tests."""

    def __init__(self, now=100.0):
        self.now = now

    def monotonic(self):
        return self.now


def _freeze_ocr_clock(monkeypatch, now=100.0) -> _FrozenClock:
    clock = _FrozenClock(now)
    monkeypatch.setattr(ocr, "time", clock)
    return clock


def _openrouter_window() -> float:
    """Reproduce the window ocr_receipt() hands to the OpenRouter chain.

    ocr_receipt() reserves `min(_OPENROUTER_FALLBACK_MAX_SECONDS, budget *
    _OPENROUTER_FALLBACK_RATIO)` for the fallback and gives the primary the rest;
    a hanging primary burns its whole slice, so the free chain sees exactly that
    reservation (26.67s of the 40s budget). Asserting against the full budget
    would be degenerate because the per-attempt cap would mask everything.
    """
    budget = ocr._hard_budget_seconds()
    return min(
        ocr._OPENROUTER_FALLBACK_MAX_SECONDS,
        max(0.0, budget * ocr._OPENROUTER_FALLBACK_RATIO),
    )


def test_openrouter_head_cannot_consume_the_whole_chain_budget(monkeypatch):
    """A hanging first model must leave a usable slice for the models behind it.

    (bug v98) The previous version handed the head the entire per-attempt cap, so
    one hanging free route could eat the budget the working route needed.
    """
    clock = _freeze_ocr_clock(monkeypatch)
    window = _openrouter_window()
    deadline = clock.now + window
    slots = len(ocr.DEFAULT_OPENROUTER_OCR_MODELS)
    head = ocr._openrouter_model_deadline(deadline, slots)
    head_slice = head - clock.now
    left_for_tail = deadline - head
    later_models = slots - 1

    assert head_slice <= ocr._ATTEMPT_TIMEOUT_CAP + _SCHEDULE_EPS
    # Every model still queued keeps its floor of real wall-clock, but the total
    # reserve is now capped by _RESERVE_MAX_FRACTION (review F4: it used to grow
    # linearly with chain length and starve the head). The guaranteed tail slice
    # is therefore the smaller of the two, not the linear one alone.
    assert left_for_tail + _SCHEDULE_EPS >= min(
        ocr._MIN_LATER_MODEL_SECONDS * later_models,
        window * ocr._RESERVE_MAX_FRACTION,
    )
    # The last model gets the whole remaining window, capped by the per-attempt
    # limit, and never anything past the shared hard deadline.
    last = ocr._openrouter_model_deadline(deadline, 1)
    last_slice = last - clock.now
    assert 0 < last_slice <= min(ocr._ATTEMPT_TIMEOUT_CAP, window)
    assert last <= deadline


def test_openrouter_head_keeps_a_real_slice_on_a_long_chain(monkeypatch):
    """(review F4) the per-model tail floor must not scale the head down forever.

    The reserve was `_MIN_LATER_MODEL_SECONDS * (queued - 1)`, linear in chain
    length: with 5 free routes queued the FIRST candidate got only 6.67s of a
    26.67s window while the routes behind it - which answer 429 in ~0.2s and
    therefore spend none of that reservation - held back 20s between them. A
    vision read of a receipt can need longer than 6.67s, so the head was cut off
    mid-read with budget unspent.

    The reserve is now also capped at `_RESERVE_MAX_FRACTION` of the remaining
    window, so the head keeps at least `1 - fraction` of it no matter how many
    routes are queued, and every queued route still gets a usable slice.
    """
    clock = _freeze_ocr_clock(monkeypatch)
    window = _openrouter_window()
    deadline = clock.now + window
    routes = len(ocr.DEFAULT_OPENROUTER_OCR_MODELS)
    head = ocr._openrouter_model_deadline(deadline, routes)
    head_slice = head - clock.now
    guarantee = window * (1 - ocr._RESERVE_MAX_FRACTION)

    # The pre-fix reserve, kept here to prove this is not a tautology: the old
    # formula handed the 5-route chain a head slice of only 6.67s.
    legacy_reserve = min(
        window, ocr._MIN_LATER_MODEL_SECONDS * (routes - 1)
    )
    legacy_head_slice = window - legacy_reserve
    assert legacy_head_slice + _SCHEDULE_EPS < guarantee, (
        "the old formula must actually violate the new guarantee"
    )

    # Before the fix this was 6.67s; the cap guarantees at least half the window.
    assert head_slice + _SCHEDULE_EPS >= guarantee
    # Non-vacuous: the fix strictly beats the old linear reserve.
    assert head_slice > legacy_head_slice + ocr._MIN_ATTEMPT_SECONDS
    # Still bounded by the per-attempt cap and never past the hard deadline.
    assert head_slice <= ocr._ATTEMPT_TIMEOUT_CAP + _SCHEDULE_EPS
    assert head <= deadline

    # The reserve cannot grow with chain length: a much longer chain does not
    # shrink the head below the same guarantee (it used to hit the 3s floor).
    long_chain = ocr._openrouter_model_deadline(deadline, 40)
    assert long_chain - clock.now + _SCHEDULE_EPS >= guarantee

    # And the tail is still protected: the queued models keep real wall-clock.
    assert deadline - head + _SCHEDULE_EPS >= window * ocr._RESERVE_MAX_FRACTION


def test_openrouter_403_advances_to_next_model(monkeypatch):
    """403 is the exact production failure for the removed Inkling routes."""
    requests = []
    monkeypatch.setattr(ocr, "OR_MODELS", ("dead:free", "live:free"))
    monkeypatch.setattr(ocr, "_downscale", lambda image: image)

    def fake_urlopen(request, timeout=None):
        requests.append(request)
        if _model_from_request(request) == "dead:free":
            raise urllib_http_error(request, b'{"error":"forbidden"}', code=403)
        return _provider_response()

    monkeypatch.setattr(ocr.urllib.request, "urlopen", fake_urlopen)

    result = ocr._openrouter_ocr(b"image", time.monotonic() + 10)

    assert result["total"] == 100
    assert [_model_from_request(request) for request in requests] == ["dead:free", "live:free"]


def test_openrouter_429_advances_to_next_model(monkeypatch):
    requests = []
    monkeypatch.setattr(ocr, "OR_MODELS", ("busy:free", "live:free"))
    monkeypatch.setattr(ocr, "_downscale", lambda image: image)

    def fake_urlopen(request, timeout=None):
        requests.append(request)
        if _model_from_request(request) == "busy:free":
            raise urllib_http_error(request, b'{"error":"quota"}', code=429)
        return _provider_response()

    monkeypatch.setattr(ocr.urllib.request, "urlopen", fake_urlopen)

    result = ocr._openrouter_ocr(b"image", time.monotonic() + 10)

    assert result["total"] == 100
    assert [_model_from_request(request) for request in requests] == ["busy:free", "live:free"]


def test_openrouter_chain_completes_within_one_hard_budget(monkeypatch):
    """Every model fails fast; the whole chain must still fit one budget and must
    never sleep its way past the deadline."""
    monkeypatch.setattr(ocr, "OR_MODELS", ("a:free", "b:free", "c:free"))
    monkeypatch.setattr(ocr, "_downscale", lambda image: image)
    monkeypatch.setattr(
        ocr.urllib.request,
        "urlopen",
        lambda request, timeout=None: (_ for _ in ()).throw(
            urllib_http_error(request, b'{"error":"nope"}', code=403)
        ),
    )

    started = time.monotonic()
    with pytest.raises(RuntimeError):
        ocr._openrouter_ocr(b"image", time.monotonic() + 3)

    assert time.monotonic() - started < 5


def test_request_returns_below_the_edge_proxy_boundary(monkeypatch):
    """(bug v98) The real requirement, stated as elapsed wall-clock.

    urllib's timeout bounds individual socket operations, not the total response
    read, so a provider that trickles its body can overshoot the deadline the
    loop enforces between attempts (a live probe measured 49.7s against a 45s
    budget). The budget therefore carries an explicit overshoot allowance. This
    test makes every provider consume its full per-attempt slice AND adds a
    synthetic trickle overrun on top, then asserts the whole call still returns
    before the 60s edge boundary - the boundary that nginx enforces because the
    bagiin vhost sets no proxy_read_timeout.

    NOTE: this asserts a bounded RETURN, not strict cancellation - ocr.py does
    not (and does not claim to) kill an in-flight socket mid-read.
    """
    def slow_trickling_urlopen(request, timeout=None):
        # Burn the whole granted slice, then overrun it the way a trickling body
        # does: urllib only notices at the next socket operation.
        time.sleep((timeout or 0) + 2)
        raise urllib_http_error(request, b'{"error":"slow"}', code=504)

    monkeypatch.setattr(ocr.urllib.request, "urlopen", slow_trickling_urlopen)
    monkeypatch.setattr(ocr, "_downscale", lambda image: image)

    # Primary + fallback both hang/trickle, so the overshoot can happen twice.
    monkeypatch.setattr(ocr, "GEMINI_API_KEY", "fake-gemini-key")
    monkeypatch.setattr(ocr, "OR_API_KEY", "fake-openrouter-key")

    # Scale every timing constant - INCLUDING the edge boundary - by the same
    # factor. The test therefore asserts the exact production relationship
    # (whole call returns inside the boundary even with a trickle overrun on
    # every hop) without waiting the real ~50s.
    scale = 0.2
    for name in (
        "OCR_BUDGET_SECONDS",
        "_ATTEMPT_TIMEOUT_CAP",
        "_MIN_LATER_MODEL_SECONDS",
        "_BUDGET_OVERHEAD_SECONDS",
        "_BUDGET_OVERSHOOT_ALLOWANCE_SECONDS",
        "_BUDGET_SAFETY_MARGIN_SECONDS",
        "_EDGE_PROXY_TIMEOUT_SECONDS",
    ):
        monkeypatch.setattr(ocr, name, getattr(ocr, name) * scale)
    monkeypatch.setattr(ocr, "_MIN_ATTEMPT_SECONDS", 0.2)

    started = time.monotonic()
    with pytest.raises(RuntimeError):
        ocr.ocr_receipt(b"image", "image/jpeg")
    elapsed = time.monotonic() - started

    boundary = ocr._EDGE_PROXY_TIMEOUT_SECONDS
    assert elapsed < boundary, (
        f"whole request took {elapsed:.2f}s, edge boundary is {boundary:.2f}s "
        f"-> this is exactly the client-visible 504 from bug v98"
    )


def test_budget_plus_overhead_plus_overshoot_fits_the_edge(monkeypatch):
    """The three allowances must never sum past the boundary at production size."""
    assert (
        ocr.OCR_BUDGET_SECONDS
        + ocr._BUDGET_OVERHEAD_SECONDS
        + ocr._BUDGET_OVERSHOOT_ALLOWANCE_SECONDS
    ) < ocr._EDGE_PROXY_TIMEOUT_SECONDS


def test_openrouter_passes_selected_model_in_each_payload(monkeypatch):
    requests = []
    monkeypatch.setattr(ocr, "OR_MODELS", ("first:free", "second:free"))
    monkeypatch.setattr(ocr, "_downscale", lambda image: image)

    def fake_urlopen(request, timeout=None):
        requests.append(request)
        return _provider_response()

    monkeypatch.setattr(ocr.urllib.request, "urlopen", fake_urlopen)
    ocr._openrouter_ocr(b"image", time.monotonic() + 5)

    assert [_model_from_request(request) for request in requests] == ["first:free"]


def test_ocr_receipt_keeps_time_for_a_slow_later_free_model(monkeypatch):
    """A real later candidate must survive fast 429s from earlier models."""
    class _Clock:
        def __init__(self):
            self.now = 100.0

        def monotonic(self):
            return self.now

    clock = _Clock()
    started = clock.now
    monkeypatch.setattr(ocr, "time", clock)
    monkeypatch.setattr(ocr, "GEMINI_API_KEY", "fake-gemini-key")
    monkeypatch.setattr(ocr, "OR_API_KEY", "fake-openrouter-key")
    models = ("first:free", "second:free", "slow-success:free")
    monkeypatch.setattr(ocr, "OR_MODELS", models)
    monkeypatch.setattr(ocr, "_downscale", lambda image: image)
    seen = []

    def slow_gemini(image_bytes, mime_type, deadline):
        clock.now = deadline
        raise RuntimeError("simulated primary timeout")

    def fake_model(image_b64, image_mime, model, deadline):
        seen.append((model, deadline - clock.now))
        if model != models[-1]:
            clock.now += 0.1
            raise ocr._OpenRouterFailure("rate_limited", status=429)
        # (bug v98: this used to assert >= 30.0, which was only reachable with the
        # 90s budget that made the backend outlive the edge proxy and surface as a
        # 504. The requirement is that a later candidate is not STARVED - it gets
        # its whole per-attempt window, not the ~5s share-based slice.)
        remaining = ocr._hard_budget_seconds() - (clock.now - started)
        assert deadline - clock.now == min(ocr._ATTEMPT_TIMEOUT_CAP, remaining)
        assert deadline - clock.now >= ocr._MIN_ATTEMPT_SECONDS
        return {
            "merchant": "",
            "date": "",
            "items": [{"name": "Item", "price": 100, "discount": 0, "quantity": 1}],
            "subtotal": 100,
            "order_discount": 0,
            "tax": 0,
            "service": 0,
            "total": 100,
            "tax_included": False,
        }

    monkeypatch.setattr(ocr, "_gemini_ocr", slow_gemini)
    monkeypatch.setattr(ocr, "_openrouter_model_ocr", fake_model)

    result = ocr.ocr_receipt(b"image", "image/jpeg")

    assert result["total"] == 100
    assert [model for model, _ in seen] == list(models)


def test_openrouter_status_failures_advance_in_order_to_next_model(monkeypatch):
    requests = []
    models = ("first:free", "second:free", "third:free")
    monkeypatch.setattr(ocr, "OR_MODELS", models)
    monkeypatch.setattr(ocr, "_downscale", lambda image: image)

    def fake_urlopen(request, timeout=None):
        requests.append(request)
        model = _model_from_request(request)
        if model == "first:free":
            raise urllib_http_error(request, b'{"error":"quota receipt fields"}', code=429)
        if model == "second:free":
            raise urllib_http_error(request, b'{"error":"model unavailable"}', code=404)
        return _provider_response()

    monkeypatch.setattr(ocr.urllib.request, "urlopen", fake_urlopen)
    result = ocr._openrouter_ocr(b"image", time.monotonic() + 5)

    assert result["total"] == 100
    assert [_model_from_request(request) for request in requests] == list(models)


def test_openrouter_timeout_advances_to_next_model(monkeypatch):
    requests = []
    monkeypatch.setattr(ocr, "OR_MODELS", ("first:free", "second:free"))
    monkeypatch.setattr(ocr, "_downscale", lambda image: image)

    def fake_urlopen(request, timeout=None):
        requests.append((request, timeout))
        if len(requests) == 1:
            raise socket.timeout("provider timeout")
        return _provider_response()

    monkeypatch.setattr(ocr.urllib.request, "urlopen", fake_urlopen)
    result = ocr._openrouter_ocr(b"image", time.monotonic() + 5)

    assert result["total"] == 100
    assert [_model_from_request(request) for request, _ in requests] == ["first:free", "second:free"]
    assert all(timeout > 0 for _, timeout in requests)


def test_openrouter_malformed_output_advances_to_next_model(monkeypatch):
    requests = []
    monkeypatch.setattr(ocr, "OR_MODELS", ("first:free", "second:free"))
    monkeypatch.setattr(ocr, "_downscale", lambda image: image)

    def fake_urlopen(request, timeout=None):
        requests.append(request)
        if len(requests) == 1:
            return _RawResponse(b"not json at all")
        return _provider_response()

    monkeypatch.setattr(ocr.urllib.request, "urlopen", fake_urlopen)
    result = ocr._openrouter_ocr(b"image", time.monotonic() + 5)

    assert result["total"] == 100
    assert [_model_from_request(request) for request in requests] == ["first:free", "second:free"]


def test_openrouter_exhausted_chain_raises_short_runtime_error(monkeypatch, caplog):
    requests = []
    models = ("first:free", "second:free")
    monkeypatch.setattr(ocr, "OR_MODELS", models)
    monkeypatch.setattr(ocr, "_downscale", lambda image: image)

    def fake_urlopen(request, timeout=None):
        requests.append(request)
        raise urllib_http_error(request, b'{"private":"receipt data"}', code=500)

    monkeypatch.setattr(ocr.urllib.request, "urlopen", fake_urlopen)
    with pytest.raises(RuntimeError, match="Kegagalan setelah beberapa percobaan"):
        ocr._openrouter_ocr(b"image", time.monotonic() + 5)

    assert [_model_from_request(request) for request in requests] == list(models)
    assert "receipt data" not in caplog.text
    assert "first:free" in caplog.text
    assert "status=500" in caplog.text


def urllib_http_error(request, body, code=400):
    """Build a provider-like 400 without putting a credential in the fixture."""
    return urllib.error.HTTPError(
        request.full_url,
        code,
        "bad request",
        Message(),
        io.BytesIO(body),
    )


def test_normalize_reconciles_discounted_quantity_line_totals_without_new_fields():
    normalized = ocr._normalize({
        "merchant": "Ayam Aroma",
        "date": "2026-08-08",
        "items": [
            {
                "name": "Ayam Bakar",
                "price": 35000,
                "discount": 5000,
                "quantity": 2,
                "line_total": 999999,
            },
            {"name": "Es Teh", "price": 7000, "discount": 0, "quantity": 1},
        ],
        "subtotal": 1,
        "tax": 7700,
        "service": 3000,
        "total": 2,
        "tax_included": False,
    })

    assert normalized["subtotal"] == 67000
    assert normalized["total"] == 77700
    assert normalized["items"] == [
        {"name": "Ayam Bakar", "price": 35000, "discount": 5000, "quantity": 2},
        {"name": "Es Teh", "price": 7000, "discount": 0, "quantity": 1},
    ]
    assert all("line_total" not in item for item in normalized["items"])


def test_normalize_preserves_duplicate_rows_and_does_not_infer_quantity():
    normalized = ocr._normalize({
        "items": [
            {"name": "AYAM GORENG", "price": 35000},
            {"name": "AYAM GORENG", "price": 35000},
            {"name": "AYAM GORENG", "price": 35000, "quantity": "2"},
        ],
        "subtotal": 105000,
        "tax": 0,
        "service": 0,
        "total": 105000,
        "tax_included": False,
    })

    assert len(normalized["items"]) == 3
    assert [item["quantity"] for item in normalized["items"]] == [1, 1, 1]
    assert normalized["subtotal"] == 105000


def test_supplied_ayam_aroma_receipt_shape_keeps_public_item_contract():
    normalized = ocr._normalize({
        "merchant": "Ayam Aroma",
        "date": "2026-09-06",
        "items": [
            {"name": "Bebek Goreng Dada", "price": 35000, "quantity": 1, "discount": 0},
            {"name": "Bebek Goreng Paha", "price": 35000, "quantity": 2, "discount": 0},
            {"name": "Sate Paru", "price": 7000, "quantity": 1, "discount": 0},
            {"name": "Nasi Putih", "price": 7000, "quantity": 2, "discount": 0},
            {"name": "Teh Manis Es", "price": 8000, "quantity": 2, "discount": 0},
        ],
        "subtotal": 142000,
        "tax": 0,
        "service": 0,
        "total": 142000,
        "tax_included": False,
    })

    assert normalized["merchant"] == "Ayam Aroma"
    assert normalized["date"] == "2026-09-06"
    assert normalized["subtotal"] == 142000
    assert normalized["total"] == 142000
    assert [(item["name"], item["quantity"], item["price"]) for item in normalized["items"]] == [
        ("Bebek Goreng Dada", 1, 35000),
        ("Bebek Goreng Paha", 2, 35000),
        ("Sate Paru", 1, 7000),
        ("Nasi Putih", 2, 7000),
        ("Teh Manis Es", 2, 8000),
    ]
    assert all(set(item) == {"name", "price", "discount", "quantity"} for item in normalized["items"])


def test_unrelated_bad_request_does_not_trigger_json_fallback():
    assert not ocr._structured_response_rejected(400, "invalid image data")
    assert not ocr._structured_response_rejected(422, "missing image")
    assert ocr._structured_response_rejected(400, "response_format is unsupported")


if __name__ == "__main__":
    import pytest

    raise SystemExit(pytest.main([__file__, "-q"]))
