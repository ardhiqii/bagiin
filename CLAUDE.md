# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Bagiin — a mobile-first bill-splitting web app for Indonesian receipts (photo → OCR →
share link → everyone taps their items → proportional tax). No accounts, no payment
gateway. Live at https://bagiin.ardhiqi.com. `docs/SPEC.md` is the product spec + changelog
(written in Indonesian); it is the record of *why* rules exist and is kept up to date
per release.

Sejak 2 Nov 2026 hanya ada **satu aplikasi**: React 19 + TypeScript + Vite di
`frontend/`, FastAPI di `backend/`, branch kerja `main`. Folder dan frontend vanilla
0.9 sudah tidak ada. Topologi (layanan, port, DB, deploy) ada di `docs/RUNBOOK-V1.md`.

UI copy, error messages (`HTTPException` details), and OCR prompts are all in casual
Indonesian. Match that when adding user-facing strings.

## Commands

```bash
cd backend
./venv/bin/python -m pytest -q                       # 422 kasus, ~25 dtk
./venv/bin/python -m pytest test_behaviors.py -q     # one file
./venv/bin/python -m pytest -q -k slot               # one test

# API sendiri tanpa layanan (UI tetap dari Vite)
BAGIIN_DB=/tmp/e2e.db BAGIIN_UPLOAD_DIR=/tmp/e2e-up \
  ./venv/bin/uvicorn main:app --port 8090
```

```bash
cd frontend
npm run dev        # http://localhost:5199, proxy /api -> 127.0.0.1:8090
npm run build      # tsc -b && vite build -> dist/
npx playwright test  # 33 berkas / 253 kasus; butuh bagiin-dev.service (8090) hidup
```

Layanan yang hidup: `bagiin-api` (produksi, 8096, DB `/var/lib/bagiin/bagiin.db`) dan
`bagiin-dev` (uji, 8090, DB `/var/lib/bagiin-dev/bagiin.db`). Deploy dan rollback hanya
lewat `scripts/deploy-web.sh` / `scripts/rollback-web.sh`; jangan `rsync` manual dan
jangan lupa `systemctl restart bagiin-api` kalau kode backend berubah.

Tests set `BAGIIN_DB` to a temp file at import time, so they never touch the live DB.
Any new test file must do the same **before** importing `db`. `backend/conftest.py`
does the same for `BAGIIN_UPLOAD_DIR` once for the whole session (main.py resolves and
`mkdir`s it at import, so the first file to import `main` binds it for every other
file) and disables the rate limiter, whose buckets are process-global.

Env (`backend/.env`, gitignored, loaded manually at the top of `main.py`):
`GEMINI_API_KEY` (OCR), optional `OPENROUTER_API_KEY` (OCR fallback), `BAGIIN_DB`,
`BAGIIN_UPLOAD_DIR`, `BAGIIN_OCR_MODEL`, `BAGIIN_GOOGLE_ORIGINS`.

## Frontend build and deploy

Ada build step sekarang. `npm run build` menghasilkan `dist/` berisi aset ber-hash
(`assets/index-<hash>.js`), lalu `scripts/deploy-web.sh` menyalinnya ke
`/var/www/bagiin`. `index.html` tidak lagi dirender server: berkas statis itu
memuat nama aset ber-hash, jadi deploy selalu utuh atau tidak sama sekali.

nginx memetakan MIME per-lokasi (`types { }` di dalam `location`), bukan global —
kalau tidak, `manifest.webmanifest` dan `og-cover.png` terkirim sebagai
`text/html`. Staging-nya ada di `scripts/nginx/bagiin.ardhiqi.com.v1.conf`;
jangan mengedit `/etc/nginx` tanpa menyalin balik perubahannya ke situ.

Konsekuensinya: **jangan pernah menguji perubahan UI di domain publik**. Pakai
`npm run dev` (5199) atau instance uji, lalu deploy. Skrip deploy menyimpan tarball
build lama + snapshot DB lebih dulu, lalu membuktikan `/`, `/manifest.webmanifest`,
`/favicon.svg`, `/og-cover.png`, `/api/auth/config`, `/recap` lewat HTTP — status
atau content-type salah berarti deploy dianggap gagal.

Kalau habis pindah branch atau merge besar, restart Vite sebelum e2e: module graph
basi membuat layar kosong dan tes gagal massal padahal aplikasinya sehat.

## Architecture

**Backend** (`backend/`, FastAPI + stdlib `sqlite3`, no ORM):

- `main.py` — all endpoints, authorization, request validation, and `_compute_response()`,
  which is the single payload builder every mutating endpoint returns (so the client always
  gets full recomputed bill state after any write).
- `db.py` — schema in `init_db()` plus idempotent `ALTER TABLE` migrations appended at the
  bottom of it. Add new columns that way; never rewrite the base `CREATE TABLE`.
- `calc.py` — pure split engine. No I/O, no DB.
- `ocr.py` — Gemini primary, OpenRouter free vision fallback,
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
the CONFIRMED payer is the sole manager (v57). Only an explicit `identity_id`
on `PUT /paid_by` confirms; passing a `name` resolves the identity for display
and must never set `paid_by_confirmed` (v65 — doing so let anyone with the link
rename themselves to the placeholder and take the bill over). Before any payer is confirmed
the creator manages; once a manager explicitly confirms a payer (`paid_by`
with an `identity_id`), power moves to them completely and the creator becomes
a regular participant. A payer matched only by name is display-only and never
manages (v51). `can_manage` is computed per viewer and returned in the payload;
the frontend gates on that, never on `owner_id`. Anyone who isn't the owner can
leave an open bill via `POST /api/bills/{id}/leave` — including the creator once
a confirmed payer holds it (v58). The owner can't leave (they hold the bill).
Everyone else's membership is derived from their payment/selection rows, so
leaving just deletes those; the creator has no such rows, so their exit is the
`bill.creator_left` flag (rejoining, or the bill falling back to them as owner,
clears it).

**Split rules** (`calc.py`) — per-person totals are never stored, always recomputed:

- *free* items: split by servings taken across everyone who picked; unpicked free items fall
  to the bill **owner** (`calc.compute(fallback_id=...)` — the confirmed payer, else the
  creator), who is the one actually out of pocket.
- *slot* items: creator declares N slots at `price // N`; unclaimed slots stay `uncovered_idr`
  and are surfaced as warnings rather than auto-assigned.
- Tax/service: proportional to each person's subtotal by default (`equal` / `creator` modes
  exist); `tax_included` bills drop the tax portion but still split service. Unpicked free
  items land on the owner and therefore stay in the tax base — a client that re-derives
  the split must include them or it overstates everyone else's tax.
- All money is integer rupiah. Rounding leftovers go to the owner.
- **Invariant:** `sum(people totals) + uncovered_idr + remaining_to_creator == bill.total_idr`.
  Any change to `calc.py` must keep `total_ok` true — that's what the regression tests assert.
- `settled` means *no money outstanding* (`all_paid` and no empty slots). Closing a bill does
  **not** settle it; a closed bill with uncovered slots stays unsettled on purpose.

Bill create/update validate hard (`subtotal == sum(price - discount)`, `total == subtotal +
tax + service`, `tax_included` implies `tax == 0`) and 400 rather than persist a bill whose
split can never reconcile. `discountIdr > subtotal` is rejected; the UI disables the save
button and explains it in the discount field rather than showing a negative total.
`db.update_bill()` diffs items by id so existing selections survive an edit; ids not
belonging to the bill are inserted as new rather than clobbering rows.

**Frontend** (`frontend/src/`):

- `router.tsx` — rute nyata (TanStack Router, path Indonesia): `/` (beranda), `/bills`,
  `/create`, `/b/$billId`, `/b/$billId/edit`, `/recap`, `/kontak`, `/masuk`, `/settings`.
  Tidak ada hash router, dan rute rekap adalah `/recap` — bukan `/rekap`.
- `screens/` — satu berkas per layar; `BillDetail.tsx` menangani pemilih tamu, tampilan
  pembuat, dan aksi bayar. `Create.tsx` / `EditBill.tsx` memegang OCR + editor item.
- `lib/api.ts` — fetch wrapper yang menyisipkan `X-Identity-Id`/`X-Identity-Secret`;
  `lib/session.ts` menyimpan identitas di `localStorage` (selalu dibungkus try/catch —
  private mode tidak boleh mematikan aplikasi); `lib/money.ts` memformat rupiah.
- `design-system.css` — token warna/jarak/radius + komponen (`ds-*`). Perubahan visual
  lewat token, bukan nilai ad hoc, supaya layar tetap konsisten.
- Selection writes diserialkan supaya POST paralel tidak saling mendahului dan menelan tap.

## Conventions worth keeping

- Comments in this codebase explain *bugs that happened* (`(bug: ...)`). They are load-bearing
  history — don't delete them when refactoring nearby code.
- Every bug-fix pass ships regression tests in `backend/test_regressions_vNN.py` named after
  the frontend version, and a `docs/SPEC.md` changelog entry. End-to-end behaviour lives in
  `frontend/tests/*.spec.ts` (Playwright, mobile viewport).
- Errors returned to the client are 4xx even for upstream OCR failures (5xx bodies get
  swallowed by Cloudflare and replaced with an HTML error page).
