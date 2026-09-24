# Bagiin 🤝

Bagi bill bareng jadi gak ribet. Split bills with friends — no accounts, no payment
gateway, just a link.

**Live:** https://bagiin.ardhiqi.com

## How it works

1. **Creator** takes a photo of the receipt → OCR reads the items, total, and even
   the merchant name + transaction date.
2. A share link is created (no accounts — guests just type their name).
3. **Everyone taps the items they're responsible for.** An item picked by 2 people
   is split evenly between them.
4. Tax & service are split **proportionally** to what each person picked (rounding
   leftover goes to the creator).
5. Each person sees their total, the creator's **payment profiles** (bank/e-wallet
   with brand chips + copy button), and confirms when they've paid.

## Features

- 📷 **Receipt OCR** via Gemini with an optional bounded OpenRouter free-model
  fallback — items, prices, merchant, date
- 🔗 **Link sharing, no accounts** — identity is just a name on the device
- 🔑 **Recovery/transfer code** — move your identity to another browser with a
  generated code (regenerating kills the old code)
- ✏️ **Edit bills** while open — item diff preserves existing selections
- 🖐️ **Creator can pick items too** (not just guests)
- 🏦 **Payment profiles** — 33 Indonesian banks, digital banks & e-wallets with
  brand-colored chips, shown in the pay sheet with one-tap copy
- 🧮 **Fair split math** — shared items divided evenly, proportional tax, rupiah
  rounding invariants covered by tests
- 📱 **Mobile-first**, dark/light mode, React + TypeScript build; the legacy static runtime is frozen and scheduled for removal (see `PRODUCT_DESIGN.md`)

## Tech stack

| Layer | Choice |
|---|---|
| Backend | FastAPI + SQLite (stdlib `sqlite3`) |
| Frontend | TypeScript + React 18 + Vite, project-owned shadcn-style primitives |
| OCR | Gemini (`gemini-3.5-flash`) with optional OpenRouter `:free` fallback |
| Deploy | nginx + Let's Encrypt, Cloudflare DNS, systemd |
| Tests | Python pytest + Node frontend logic/browser E2E |

## Project structure

```
bagiin/
├── backend/
│   ├── main.py      # FastAPI app & endpoints
│   ├── db.py        # SQLite schema + queries
│   ├── calc.py      # split calculation engine
│   ├── ocr.py       # Gemini OCR wrapper
│   ├── test_calc_regression.py
│   └── test_features.py
├── frontend/
│   ├── src/          # React + TypeScript routes, API adapters, primitives
│   ├── package.json  # Vite build and frontend checks
│   └── static/       # frozen legacy runtime, scheduled for removal; asset-only in the meantime
├── AGENTS.md        # project rules for agents
├── PRODUCT_DESIGN.md # current product, UX, architecture, design direction
└── SPEC.md          # business rules & changelog
```

## Local development

```bash
cd frontend
npm ci --no-audit --no-fund
npm run typecheck
npm run build

cd ../backend
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt   # fastapi, uvicorn, slowapi, google-genai (or as installed)
# Set the OCR provider credential in your local environment; other features work without OCR.
uvicorn main:app --reload --port 8082
```

Open http://localhost:8082

> FastAPI serves the Vite output from `frontend/dist/` at `/` and `/assets/`.
> `frontend/dist/` is generated and ignored, so rebuild before restarting the
> service. The legacy `frontend/static/` runtime is frozen and scheduled for
> removal after React route parity and browser verification; until then it is
> kept only as a source of non-runtime assets. There is no second runtime path.

### Identity recovery

Identity IDs are public references, not credentials. New and recovered sessions
use both `X-Identity-Id` and `X-Identity-Secret`. Legacy identities from before
secret binding must be restored with their recovery code, or explicitly bound
with `POST /api/identities/{id}/bind` and `{ "code": "..." }`; an id-only request
never mints a secret. Public bill links remain readable without a session, while
identity-scoped writes require an authenticated secret.

### Bundle accounting

The formal `<50 KB gzip` budget applies to source-owned application assets.
Vendor React and icon runtime are reported separately, and the full delivered
asset size is reported alongside them. A prior split baseline recorded 44.03 KB
gzip (43.00 KiB) for app-owned assets, 59.75 KB gzip (58.35 KiB) for vendor and
icon runtime, and 103.78 KB gzip (101.35 KiB) for all generated assets. The
latest local `npm run build` output reported 133.13 KB gzip total (130.01 KiB),
including the 45.48 KB gzip React chunk; this is a measured local baseline, not
a release claim. Re-run the build after dependency or bundling changes.

## Tests

```bash
cd backend
venv/bin/python -B -m pytest -q

cd ../frontend
npm run typecheck
npm run build
npm run test:logic

cd ..
node tools/e2e_create.mjs <base-url> <cdp-url>
node tools/e2e_smoke.mjs <base-url> <cdp-url>
node tools/e2e_settled.mjs <base-url> <cdp-url>
node tools/e2e_recap.mjs <base-url> <cdp-url>
node tools/e2e_guest_route_guard.mjs <base-url> <cdp-url>
node tools/e2e_rounding.mjs <base-url> <cdp-url>
node tools/e2e_uiux_responsive.mjs <base-url> <cdp-url>
```

## License

MIT © 2026 Aufa Fauqi Ardhiqi
