# Bagiin project rules

This file is the project rules source for Hermes and coding agents. Read it before changing Bagiin. The current product, architecture, and design direction lives in `PRODUCT_DESIGN.md`. Business rules and the historical changelog live in `SPEC.md`.

## Project

Bagiin is a mobile-first Indonesian bill-splitting web app:

`receipt photo or manual entry -> verify -> share one bill link -> people select items -> server calculates shares -> payment status -> recap`

Live production: `https://bagiin.ardhiqi.com/`

Repository: `/opt/projects/bagiin`

## Runtime ownership

- React + TypeScript + Vite is the target and only frontend runtime.
- `frontend/static/app.js`, `screens.js`, `create.js`, `bill.js`, and `recap.js` are frozen legacy runtime code. Do not add features there.
- The legacy runtime is scheduled for removal after React route parity and browser verification. Do not preserve old visual behavior just because it exists.
- `frontend/src/` owns the React application.
- The backend serves the built React app from `frontend/dist` in production. Do not introduce a second frontend runtime or a new fallback path without an explicit migration decision.
- `frontend/static/` may remain temporarily for non-runtime assets such as favicon, manifest, brand assets, and OG images during migration.

## Frontend foundation

- Use customized shadcn/ui components owned by this repository, with Tailwind CSS as the utility layer and semantic CSS variables as the token source.
- Use one component family, one icon family, one spacing scale, one radius scale, and one light/dark theme token map.
- Phosphor is the current icon family. Do not introduce another icon family without a written decision in `PRODUCT_DESIGN.md`.
- Product feature code belongs under `frontend/src/features/<feature>`.
- Shared primitives belong under `frontend/src/components/ui`.
- Layout primitives belong under `frontend/src/components/layout`.
- Shared domain/state mapping belongs under `frontend/src/lib/domain`.
- Routes must not create private copies of Button, Card, Alert, Dialog, Sheet, BottomDock, status mapping, or money formatting.
- Mobile is primary. Test the bottom dock, safe-area spacing, keyboard-open forms, and touch targets.
- Every async surface must define loading, success, empty, retryable error, validation error, and disabled/busy behavior where applicable.

## Product rules

- Creator and guest are both first-class users.
- Guest mode uses a name plus device identity. Account/recovery code remains the current way to move an identity to another device.
- Google login is a future optional binding to an existing identity. Do not implement Google auth as part of a visual-only change.
- A known identity can receive a direct pending invite. A name-only participant is a placeholder for warnings and is not a credential or direct invite target.
- Share links remain the way a person without an identity enters a bill.
- OCR failure must never block bill creation. Keep the photo, offer retry and manual entry, and do not expose raw 502/503/504 as the main user-facing copy.
- Retrying OCR after manual edits requires explicit confirmation before replacing edits.
- Manual entry is a normal flow, not an emergency screen.
- Recap separates final ongoing amounts, provisional estimates, blockers, and settled history. Manual-settled bills are excluded from ongoing totals.
- Keep allocation state separate from payment/settlement state.
- Server-calculated money is authoritative. Preserve integer rupiah and reconciliation invariants.

## Backend rules

- Backend: FastAPI + stdlib SQLite.
- `backend/main.py` is currently the composition root and endpoint owner. Extract boundaries incrementally; do not perform an untested big-bang rewrite.
- `backend/calc.py` is pure split logic. It must not gain HTTP, filesystem, or UI dependencies.
- `backend/db.py` owns schema and persistence. Add migrations idempotently and do not rewrite the base schema casually.
- `backend/ocr.py` owns the current provider adapter. A future local OCR implementation must run in a separate worker/process and must be benchmarked before replacing the current path.
- Authentication is real: derive the acting identity from authenticated headers, never from a path identity alone. Never expose identity secrets to another identity.
- Do not change API contracts, business invariants, auth, settlement, invite, or money behavior during a design-system-only task without a separate acceptance criterion and regression tests.

## Tests and commands

Backend:

```bash
cd backend
venv/bin/python -m pytest -q
```

Frontend:

```bash
npm --prefix frontend run test:logic
npm --prefix frontend run typecheck
npm --prefix frontend run build
```

Browser smoke requires a Chrome CDP session. Use the project scripts in `tools/` and an isolated `BAGIIN_DB` plus `BAGIIN_UPLOAD_DIR`. Never use production data for smoke tests.

For stateful UI changes, verify API response, persistence, reload/navigation, error/empty/loading states, and real browser behavior. A green unit suite alone is not enough.

## Git and deployment

- Work on `feat/<name>` branches.
- Integration target is `main`. Use a PR; never push feature work directly to `main`.
- Commit messages are lowercase English prefixes such as `feat:`, `fix:`, `docs:`, and `refactor:`.
- Do not leave uncommitted feature work in the repository.
- Production restart is `sudo systemctl restart bagiin.service`, but it requires explicit user approval for that task. Do not deploy automatically from a docs, planning, or design-system task.
- Before production delivery, run the relevant backend/frontend/browser checks, review the actual diff, merge the current branch, restart only with approval, and verify the public URL and deployed assets.

## Documentation ownership

- `AGENTS.md`: short rules for future agents.
- `PRODUCT_DESIGN.md`: current product, UX, architecture, React-only migration, design tokens, component contracts, and execution phases.
- `SPEC.md`: business rules, API/data semantics, and historical changelog. It is not the place for current agent workflow or duplicate design-system prose.
- Do not create competing product-direction markdown files in the repository. Temporary plans belong under `.hermes/plans/` and must be removed or clearly archived after their decisions are incorporated into the canonical docs.

## Safety

- Never print or commit secrets, credentials, tokens, connection strings, or production data.
- Never run destructive database operations or production actions without explicit approval.
- If a requirement is ambiguous and changes product semantics, stop and record the decision instead of silently guessing.
