# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Bagiin — a mobile-first bill-splitting web app for Indonesian receipts (photo → OCR →
share link → everyone taps their items → proportional tax). No accounts, no payment
gateway. Live at https://bagiin.ardhiqi.com. `SPEC.md` is the product spec + changelog
(written in Indonesian); it is the record of *why* rules exist and is kept up to date
per release.

UI copy, error messages (`HTTPException` details), and OCR prompts are all in casual
Indonesian. Match that when adding user-facing strings.

## Commands

```bash
cd backend
source venv/bin/activate                 # venv is committed-adjacent but gitignored
uvicorn main:app --reload --port 8082    # serves API + frontend at http://localhost:8082

venv/bin/python -m pytest -q                       # full suite (68 tests, ~3s)
venv/bin/python -m pytest test_behaviors.py -q     # one file
venv/bin/python -m pytest test_behaviors.py -q -k slot   # one test
venv/bin/python test_calc_regression.py            # test files also run standalone (__main__)
```

Tests set `BAGIIN_DB` to a temp file at import time, so they never touch `backend/bagiin.db`
(the live DB, gitignored). Any new test file must do the same **before** importing `db`.

Production: `sudo systemctl restart bagiin.service` (systemd + nginx + Let's Encrypt on the
VPS; uploads live in `/var/www/bagiin-uploads`).

Env (`backend/.env`, gitignored, loaded manually at the top of `main.py`):
`GEMINI_API_KEY` (OCR), optional `OPENROUTER_API_KEY` (OCR fallback), `BAGIIN_DB`,
`BAGIIN_UPLOAD_DIR`, `BAGIIN_OCR_MODEL`.

## Frontend versioning — read before touching `frontend/`

Assets live flat in `frontend/static/` (no version folders). `index.html` and
`manifest.json` are **server-rendered templates** (see "static frontend" block at the
bottom of `backend/main.py`): asset URLs carry a content hash
(`/static/app.js?v=<sha256[:12]>`), computed at request time from the file bytes.

Cache semantics:
- `index.html` + `/static/manifest.json` → `Cache-Control: no-cache, must-revalidate`
  + `ETag` (304 revalidation). Cloudflare treats them as DYNAMIC — always fetched fresh.
- Everything else under `/static/` → `Cache-Control: public, max-age=31536000, immutable`.
  Content changes ⇒ new hash ⇒ new URL ⇒ no stale reads ever.

**Deploying a frontend change is just pushing the file** — no version bump, no folder
copy, nothing to remember. The hash IS the version. There is no "current version".

Still never hit the live domain with partial files mid-write, and verify edits against
`localhost:8082` BEFORE loading the public URL (CF may cache a half-written asset under
its hash URL once; it is orphaned the moment the file completes, but verify anyway).

No build step, no framework, no npm. Vanilla JS with global functions loaded via three
`<script>` tags; all CSS is inline in `index.html`. JS budget: < 50KB gz.

**Design system** lives entirely in the `<style>` block of `index.html`: warm-neutral tokens
plus one accent, a fixed radius scale, tinted shadows, and a dark-mode token swap. Prefer the
existing classes over inline styles. Two layout rules matter: screens wrap their markup in
`shell(main, side)`, and the primary action lives in a `.dock` — a fixed bottom bar on
phones, a sticky right rail at ≥1040px. Call `watchDock()` after rendering a screen that has
one, so the page reserves the dock's real height instead of a guessed constant.

`app.js` carries the shared UI vocabulary the screens are built from: `ic()` (inline SVG icon
set — no icon library, since there is no package manager), `openSheet()` / `confirmSheet()`
(never use native `confirm()`), `withBusy()` (locks a button for the duration of an async
action), `skeletonRows()`, and `esc()`.

## Architecture

**Backend** (`backend/`, FastAPI + stdlib `sqlite3`, no ORM):

- `main.py` — all endpoints, authorization, request validation, and `_compute_response()`,
  which is the single payload builder every mutating endpoint returns (so the client always
  gets full recomputed bill state after any write).
- `db.py` — schema in `init_db()` plus idempotent `ALTER TABLE` migrations appended at the
  bottom of it. Add new columns that way; never rewrite the base `CREATE TABLE`.
- `calc.py` — pure split engine. No I/O, no DB.
- `ocr.py` — Gemini (`gemini-3.5-flash`) primary, OpenRouter free vision fallback,
  plus `_normalize()` which repairs LLM output (string `"false"`, float rupiah, hallucinated
  totals) so it passes the strict bill-create validation.

**Auth model:** lightweight, but it *is* auth. An identity has a public `id` and a private
`secret` (both `token_urlsafe(16)`); the client sends `X-Identity-Id` **and**
`X-Identity-Secret`. The id alone is not a credential — it appears in every bill payload, so
anyone with the share link knows it. `_identity_from_request()` resolves *and* authenticates
the caller; `_viewer_id()` is the best-effort variant for public reads. Two rules that both
came from real takeover bugs (`test_regressions_v47.py`, `test_regressions_v51.py`):
**always derive the acting identity from the headers, never from a path `identity_id`**, and
never return a secret to anyone but the identity's own device. Pre-v51 identities have
`secret IS NULL` and authenticate on the id alone until `POST /api/identities/{id}/bind`
mints one (trust on first use). Bill id is a 22-char `token_urlsafe(16)`; possessing it
grants read access. Rate limiting via slowapi per IP.

**Ownership:** `_owner_id()` / `_can_manage()` in `main.py` encode the rule —
the CONFIRMED payer is the sole manager (v57). Before any payer is confirmed
the creator manages; once a manager explicitly confirms a payer (`paid_by`
with an `identity_id`), power moves to them completely and the creator becomes
a regular participant. A payer matched only by name is display-only and never
manages (v51). `can_manage` is computed per viewer and returned in the payload;
the frontend gates on that, never on `owner_id`. Participants (non-owner,
non-creator) can leave an open bill via `POST /api/bills/{id}/leave`; the owner
can't leave (they hold the bill) and the creator can't leave (structural).

**Split rules** (`calc.py`) — per-person totals are never stored, always recomputed:

- *free* items: split by servings taken across everyone who picked; unpicked free items fall
  to the creator.
- *slot* items: creator declares N slots at `price // N`; unclaimed slots stay `uncovered_idr`
  and are surfaced as warnings rather than auto-assigned.
- Tax/service: proportional to each person's subtotal by default (`equal` / `creator` modes
  exist); `tax_included` bills drop the tax portion but still split service. Unpicked free
  items land on the creator and therefore stay in the tax base — a client that re-derives
  the split must include them or it overstates everyone else's tax.
- All money is integer rupiah. Rounding leftovers go to the creator.
- **Invariant:** `sum(people totals) + uncovered_idr + remaining_to_creator == bill.total_idr`.
  Any change to `calc.py` must keep `total_ok` true — that's what the regression tests assert.
- `settled` means *no money outstanding* (`all_paid` and no empty slots). Closing a bill does
  **not** settle it; a closed bill with uncovered slots stays unsettled on purpose.

Bill create/update validate hard (`subtotal == sum(price - discount)`, `total == subtotal +
tax + service`, `tax_included` implies `tax == 0`) and 400 rather than persist a bill whose
split can never reconcile. `db.update_bill()` diffs items by id so existing selections survive
an edit; ids not belonging to the bill are inserted as new rather than clobbering rows.

**Frontend** (`frontend/static/vNN/`):

- `app.js` — state, `localStorage` helpers (all wrapped in try/catch — private mode must not
  break the app), the `api()` fetch wrapper that injects `X-Identity-Id`, and a hash router
  (`#/b/<bill_id>`, `#/history`, `#/settings`, `#/create`).
- `screens.js` — onboarding, home, history, settings/payment accounts, create + OCR verify
  editor, and the rupiah input helpers (`rupiahFmt`/`rupiahParse`/`bindRupiahInput` — inputs
  hold dot-formatted text, so **never `parseInt` an input value directly**).
- `bill.js` — the bill screens: guest picker, creator view, edit bill, pay sheet, slot manager.

Selection writes are serialized through a promise chain (`saveSelectionsViaChain`) because
parallel POSTs could land out of order and lose taps.

## Conventions worth keeping

- Comments in this codebase explain *bugs that happened* (`(bug: ...)`). They are load-bearing
  history — don't delete them when refactoring nearby code.
- Every bug-fix pass ships regression tests in a `test_regressions_vNN.py` named after the
  frontend version, and a `SPEC.md` changelog entry.
- Errors returned to the client are 4xx even for upstream OCR failures (5xx bodies get
  swallowed by Cloudflare and replaced with an HTML error page).
