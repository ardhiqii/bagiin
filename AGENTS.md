# AGENTS.md — Bagiin 1.0

This file governs work on the **`react` branch only** — that branch is **versi 1.0**.
`main` is **versi 0.9**, the live vanilla app (`bagiin.ardhiqi.com`), and must not
be touched from here.

## Dua jalur, satu repo

| Versi | Branch | Isi |
| --- | --- | --- |
| **0.9** | `main` | Vanilla JS (`frontend/static/*.js`), FastAPI menyajikan HTML, produksi di bagiin.ardhiqi.com. Hanya perbaikan, tanpa fitur baru |
| **1.0** | `react` | React 19 + TypeScript + Vite, design system Seimbang/Saldo, FastAPI terpisah, akun berlapis + kontak ber-alias. Semua pengembangan terjadi di sini |


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

## Struktur versi 1

Branch `react` adalah **versi 1** dan berisi aplikasi utuh:

- `frontend/` — React + TypeScript + Vite (satu-satunya frontend; versi vanilla
  sudah dihapus dari branch ini, dan tetap hidup di branch `main` sebagai versi 0.9)
- `backend/` — FastAPI (akun, sesi perangkat, alias kontak, split bill)

`prototype/` sudah dihapus: itu lab desain versi lama, dan membawa dua sumber
token visual justru membuat orang menyalin nilai dari tempat yang salah.

## Commands

```bash
cd frontend
npm install
npm run dev            # http://localhost:5199
npm run build          # tsc -b && vite build  -> frontend/dist
npx playwright test    # e2e (butuh API di 8090)
```

Backend:

```bash
cd backend
# Worktree ini tidak punya venv sendiri; venv dipakai bersama dari worktree 0.9
/opt/projects/bagiin/backend/venv/bin/python -m pytest -q
```

Nomor versi disimpan di `frontend/package.json` (1.0.0) dan di README bagian
**Versi**. Kalau menyebut versi di commit atau dokumen, pakai `0.9` (vanilla,
branch `main`) atau `1.0` (React, branch `react`).

Live: https://bagiin-react.ardhiqi.com menyajikan `frontend/dist` (root
`/var/www/bagiin-react`), dengan `/api/` diteruskan nginx ke instance v1 di port
8090 (`bagiin-react-api.service`, DB salinan `/var/lib/bagiin-sandbox/bagiin.db`).
Redeploy = `npm run build` lalu salin `dist/.` ke root itu dan reload nginx.

## Conventions

- UI copy, error messages, and OCR prompts are casual Indonesian. Match it.
- Comments in this codebase explain bugs that happened; keep them when refactoring.
- Backend schema changes go through idempotent `ALTER TABLE` at the bottom of
  `db.init_db()`. Never rewrite the base `CREATE TABLE`.
- Never `parseInt` a rupiah input value — inputs hold dot-formatted text.
- No native `confirm()`; use the project's sheet components.
