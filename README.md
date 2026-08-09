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

- 📷 **Receipt OCR** via Google Gemini free tier — items, prices, merchant, date
- 🔗 **Link sharing, no accounts** — identity is just a name on the device
- 🔑 **Recovery/transfer code** — move your identity to another browser with a
  generated code (regenerating kills the old code)
- ✏️ **Edit bills** while open — item diff preserves existing selections
- 🖐️ **Creator can pick items too** (not just guests)
- 🏦 **Payment profiles** — 33 Indonesian banks, digital banks & e-wallets with
  brand-colored chips, shown in the pay sheet with one-tap copy
- 🧮 **Fair split math** — shared items divided evenly, proportional tax, rupiah
  rounding invariants covered by tests
- 📱 **Mobile-first**, dark/light mode, no build step (vanilla JS)

## Tech stack

| Layer | Choice |
|---|---|
| Backend | FastAPI + SQLite (stdlib `sqlite3`) |
| Frontend | Vanilla JS SPA (no framework, no build step) |
| OCR | Google Gemini (`gemini-3.5-flash`, free tier) |
| Deploy | nginx + Let's Encrypt, Cloudflare DNS, systemd |
| Tests | Python stdlib scripts (`test_calc_regression.py`, `test_features.py`) |

## Project structure

```
kasbareng/
├── backend/
│   ├── main.py      # FastAPI app & endpoints
│   ├── db.py        # SQLite schema + queries
│   ├── calc.py      # split calculation engine
│   ├── ocr.py       # Gemini OCR wrapper
│   ├── test_calc_regression.py
│   └── test_features.py
├── frontend/
│   ├── index.html   # shell + inline CSS
│   └── static/v10/  # app.js (router/state), screens.js, bill.js
└── SPEC.md          # product spec & changelog
```

## Local development

```bash
cd backend
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt   # fastapi, uvicorn, slowapi, google-genai (or as installed)
export GEMINI_API_KEY=...          # required for OCR; other features work without it
uvicorn main:app --reload --port 8082
```

Open http://localhost:8082

> Static frontend is served from `frontend/static/`; `index.html` references
> `static/vNN/` versioned folders (bump the folder when changing frontend code —
> Cloudflare caches by path).

## Tests

```bash
cd backend
venv/bin/python test_calc_regression.py   # split math invariants
BAGIIN_DB=/tmp/bagiin_test.db venv/bin/python test_features.py  # edit diff, accounts, codes
```

## License

MIT © 2026 Aufa Fauqi Ardhiqi
