"""Regression tests for Gemini-first OCR provider routing and diagnostics."""
import io
import json
import os
import sys
import tempfile
import threading
import time
import urllib.error
from email.message import Message
from pathlib import Path

import pytest

os.environ.setdefault("BAGIIN_DB", str(Path(tempfile.mkdtemp()) / "gemini-first.db"))
os.environ.setdefault("BAGIIN_UPLOAD_DIR", str(Path(tempfile.mkdtemp()) / "uploads"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import ocr


class _Response:
    def __init__(self, payload):
        self._payload = json.dumps(payload).encode()

    def read(self):
        return self._payload


def _openrouter_response():
    return _Response({
        "choices": [{
            "message": {
                "content": json.dumps({
                    "merchant": "Fallback Warung",
                    "items": [{"name": "Nasi", "price": 12000}],
                    "subtotal": 12000,
                    "tax": 0,
                    "service": 0,
                    "total": 12000,
                    "tax_included": False,
                }),
            },
        }],
    })


def _openrouter_content_response(content):
    return _Response({
        "choices": [{"message": {"content": content}}],
    })


def _http_error(request, body: bytes, code: int):
    return urllib.error.HTTPError(
        request.full_url,
        code,
        "provider failure",
        Message(),
        io.BytesIO(body),
    )


def test_gemini_default_is_explicit_tested_model_and_rejects_provider_ids():
    assert ocr.DEFAULT_GEMINI_MODEL == "gemini-3.5-flash"
    assert ocr._select_gemini_model("") == ocr.DEFAULT_GEMINI_MODEL
    assert ocr._select_gemini_model("google/gemma-4-26b-a4b-it:free") == ocr.DEFAULT_GEMINI_MODEL
    assert ocr._select_gemini_model("gemini-3.1-flash-lite") == "gemini-3.1-flash-lite"
    assert ocr._configured_gemini_model(
        "gemini-3.1-flash-lite", "google/gemma-4-26b-a4b-it:free"
    ) == "gemini-3.1-flash-lite"
    assert ocr._configured_gemini_model(
        "", "gemini-3.1-flash-lite"
    ) == "gemini-3.1-flash-lite"
    assert ocr._configured_gemini_model(
        "", "google/gemma-4-26b-a4b-it:free"
    ) == ocr.DEFAULT_GEMINI_MODEL


def test_gemini_success_does_not_call_openrouter(monkeypatch):
    result = {
        "merchant": "Gemini Warung",
        "date": "",
        "items": [{"name": "Nasi", "price": 10000, "discount": 0, "quantity": 1}],
        "subtotal": 10000,
        "order_discount": 0,
        "tax": 0,
        "service": 0,
        "total": 10000,
        "tax_included": False,
    }
    calls = []
    monkeypatch.setattr(ocr, "GEMINI_API_KEY", "test-gemini-key")
    monkeypatch.setattr(ocr, "OR_API_KEY", "test-openrouter-key")

    def gemini(image_bytes, mime_type, deadline):
        calls.append("gemini")
        return result

    def unexpected_openrouter(*args, **kwargs):
        calls.append("openrouter")
        raise AssertionError("OpenRouter must not run after Gemini succeeds")

    monkeypatch.setattr(ocr, "_gemini_ocr", gemini)
    monkeypatch.setattr(ocr, "_openrouter_ocr", unexpected_openrouter)

    assert ocr.ocr_receipt(b"image", "image/jpeg") is result
    assert calls == ["gemini"]


def test_gemini_failure_reaches_openrouter_with_sanitized_classification(monkeypatch, caplog):
    requests = []
    monkeypatch.setattr(ocr, "GEMINI_API_KEY", "test-gemini-key")
    monkeypatch.setattr(ocr, "OR_API_KEY", "test-openrouter-key")
    caplog.set_level("WARNING", logger="bagiin.ocr")

    def urlopen(request, timeout=None):
        requests.append(request.full_url)
        if "generativelanguage.googleapis.com" in request.full_url:
            raise _http_error(
                request,
                b'{"error":{"message":"private provider body"}}',
                429,
            )
        return _openrouter_response()

    monkeypatch.setattr(ocr.urllib.request, "urlopen", urlopen)

    result = ocr.ocr_receipt(b"image", "image/jpeg")

    assert result["merchant"] == "Fallback Warung"
    assert f"/models/{ocr.DEFAULT_GEMINI_MODEL}:generateContent" in requests[0]
    assert "generativelanguage.googleapis.com" in requests[0]
    assert "openrouter.ai/api/v1/chat/completions" in requests[1]
    assert "failure=rate_limited status=429" in caplog.text
    assert "private provider body" not in caplog.text
    assert "test-gemini-key" not in caplog.text
    assert "test-openrouter-key" not in caplog.text


def test_openrouter_ignores_thought_parts_and_keeps_answer():
    thought = {
        "type": "text",
        "thought": True,
        "text": '{"merchant":"thought-only","items":[]}',
    }
    answer = {
        "type": "text",
        "text": '{"merchant":"answer","items":[],"total":0}',
    }

    result = ocr._normalize_openrouter_response(
        {"choices": [{"message": {"content": [thought, answer]}}]}
    )

    assert result["merchant"] == "answer"


def test_openrouter_rejects_thought_only_content():
    with pytest.raises(ocr._OpenRouterFailure) as raised:
        ocr._normalize_openrouter_response({
            "choices": [{"message": {"content": [{
                "type": "text",
                "thought": True,
                "text": '{"merchant":"must-not-be-used","items":[]}',
            }]}}]
        })

    assert raised.value.kind == "invalid_response"


def test_openrouter_extracts_json_with_markdown_and_trailing_prose():
    content = (
        "Berikut hasil pembacaan:\n"
        "```json\n"
        '{"merchant":"Warung","items":[],"total":0}'
        "\n```\n"
        "Semoga membantu."
    )

    result = ocr._normalize_openrouter_response(
        {"choices": [{"message": {"content": content}}]}
    )

    assert result["merchant"] == "Warung"


def test_openrouter_retries_invalid_200_without_json_option(monkeypatch):
    requests = []

    def urlopen(request, timeout=None):
        requests.append(request)
        if len(requests) == 1:
            return _openrouter_content_response("not JSON")
        return _openrouter_response()

    monkeypatch.setattr(ocr.urllib.request, "urlopen", urlopen)
    result = ocr._openrouter_model_ocr(
        "aW1hZ2U=", "image/jpeg", "test-model:free", time.monotonic() + 5
    )

    assert result["merchant"] == "Fallback Warung"
    assert len(requests) == 2
    assert json.loads(requests[0].data.decode())["response_format"] == {"type": "json_object"}
    assert "response_format" not in json.loads(requests[1].data.decode())


def test_openrouter_response_read_deadline_is_classified_as_timeout(monkeypatch):
    class _BlockingResponse:
        def __init__(self):
            self.release = threading.Event()
            self.closed = False

        def read(self):
            self.release.wait()
            return b"{}"

        def close(self):
            self.closed = True
            self.release.set()

    response = _BlockingResponse()
    monkeypatch.setattr(ocr.urllib.request, "urlopen", lambda request, timeout=None: response)

    with pytest.raises(ocr._OpenRouterFailure) as raised:
        ocr._openrouter_model_ocr(
            "aW1hZ2U=", "image/jpeg", "slow-model:free", time.monotonic() + 0.03
        )

    assert raised.value.kind == "timeout"
    assert response.closed is True
