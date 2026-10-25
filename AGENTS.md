# AGENTS.md — Bagiin React line

This file governs work on the **`react` branch only**. `main` is the live vanilla
app (`bagiin.ardhiqi.com`) and must not be touched from here.

## Two lines, one repo

| Line | Branch | What it is |
| --- | --- | --- |
| Live | `main` | Vanilla JS frontend (`frontend/static/*.js`), FastAPI backend, production at bagiin.ardhiqi.com |
| Rebuild | `react` | React 19 + TypeScript + Vite rebuild. Product/UX decisions first, prototype second |

Rules:

- All React work happens on `react`. Never commit React work to `main`, never
  merge `react` into `main` without an explicit owner decision.
- `main` is deployed live. A stray merge or push there ships to real users.
- The backend on this branch is still the vanilla backend and stays untouched
  unless a task explicitly says otherwise.

## Source of truth, in order

1. `PRODUCT.md` — product and business rules decided by the owner (Indonesian).
   When it disagrees with the old code, PRODUCT.md wins and the difference is
   discussed before changing behaviour.
2. `DESIGN_SYSTEM.md` — the chosen visual direction (Seimbang layout, Saldo
   palette), tokens, components, status vocabulary.
3. `UX_RESEARCH.md` — research record; distinguishes published third-party
   behaviour from recommendations for Bagiin.
4. `CLAUDE.md` — how the existing backend/vanilla app actually works.
5. `SPEC.md` — historical implementation changelog.

## Money rules (non-negotiable)

- Final money always comes from the server (`backend/calc.py` + `_compute_response()`).
  A client that re-derives the split is the single most expensive bug class in this
  project — it once told a guest to transfer the wrong amount.
- Prototype code may mock amounts, but any production React code must render the
  server payload, not recompute it.
- All rupiah are integers. Keep the invariant
  `sum(people totals) + uncovered_idr + remaining_to_creator == bill.total_idr`.

## Commands

Prototype (the React design lab):

```bash
cd prototype
npm install
npm run dev            # http://localhost:5173
npm run build          # tsc -b && vite build  -> prototype/dist
```

Backend (unchanged from vanilla):

```bash
cd backend
venv/bin/python -m pytest -q          # ~140 tests
```

Public preview: https://react.bagiin.ardhiqi.com serves `prototype/dist`,
installed to `/var/www/bagiin-react`. Redeploy = `npm run build`, copy `dist/.`
to that root, reload nginx. It is a preview, not production; it reads no real data
and has no backend.

## Conventions

- UI copy, error messages, and OCR prompts are casual Indonesian. Match it.
- Comments in this codebase explain bugs that happened; keep them when refactoring.
- Backend schema changes go through idempotent `ALTER TABLE` at the bottom of
  `db.init_db()`. Never rewrite the base `CREATE TABLE`.
- Never `parseInt` a rupiah input value — inputs hold dot-formatted text.
- No native `confirm()`; use the project's sheet components.
