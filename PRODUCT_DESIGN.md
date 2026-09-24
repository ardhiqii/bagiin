# Bagiin Product, UX, and Architecture Foundation

Status: current product direction for the React + TypeScript + Vite runtime. This
document replaces the old visual/migration assumptions. Some folder moves and
foundation work remain planned; claims about shipped routes and API behavior must
be checked against the current source and `SPEC.md`'s endpoint inventory.

Related documents:

- `AGENTS.md` contains short project rules for future agents.
- `SPEC.md` contains business rules, API/data semantics, and the historical changelog.

---

## 1. Product direction

### Core product

Bagiin helps a group split one bill after eating together:

```text
photo/upload or manual entry
  -> verify the bill
  -> share one link
  -> people select their items
  -> server calculates each share
  -> payment status
  -> recap
```

The main promise is speed and trust. Nobody should need to manually recalculate item shares, tax, service, rounding, or who still needs to act.

### Extended product

Recap aggregates ongoing bills across the user's known bill history:

- **Perlu dibayar**: money the user needs to pay to someone else.
- **Akan diterima**: money other people owe the user because the user fronted the bill.
- **Provisional**: estimates that cannot be treated as final because a selection, invite, payer, or allocation step is unresolved.
- **Actions**: what the current user must do, or what the system is waiting for from others.
- **Settled history**: completed bills kept for history, excluded from ongoing totals.

A manual-settled bill is finished for ongoing recap. Allocation completeness and settlement are still separate backend concepts and must not be collapsed into one misleading UI status.

### Product boundaries

Bagiin is not currently a full Splitwise replacement. Do not expand the first rebuild into payment gateway, debt simplification, recurring expenses, group management, or a general finance dashboard.

### Retired assumptions

The following claims were true of the old plan and are now **retired**. Do not reintroduce them; if any document, comment, or commit message states one, that statement is stale.

- **"No build step, no framework, no npm. Vanilla JS."** Retired. React + TypeScript + Vite is the shipped and only frontend runtime; `npm` is part of the frontend workflow.
- **"`frontend/static/` is the fallback and rollback path."** Retired. The legacy runtime is frozen and scheduled for removal after React route parity and browser verification. It is not a fallback or a rollback path; `frontend/src` → `frontend/dist` is the only shipped path.
- **"Status: DRAFT (brainstorm). Belum ada kode."** Retired. Bagiin is live at `https://bagiin.ardhiqi.com/`; `SPEC.md` is now an active business reference and changelog, not a brainstorm.
- **"Folder-version cache-busting (`static/v51` → `static/v52`)."** Retired. That was a legacy workaround for a Cloudflare partial-cache incident. The current frontend serves hashed Vite output from `frontend/dist`; there are no version folders to bump.

---

## 2. Identity, account, and invite model

### Current identity model

- A user can enter with a name and a device identity.
- The share link is the main way an unknown guest enters a bill.
- An account/recovery code lets an identity move to another device.
- Google login is a future optional binding to an existing identity. It is not part of the current React foundation rebuild.

### Participant types

#### Known identity

A creator can choose a known identity that the system has seen through prior shared bills or the contact graph. That target can receive a direct pending invite and can accept, decline, leave, or otherwise act according to the bill lifecycle.

#### Name placeholder

A creator may type a friend's name when the friend does not have a known identity. That name is only a warning/expected-participant placeholder. It is not a credential, account, direct notification target, or permission grant. The friend enters through the shared bill link and becomes a real identity when they join.

This prevents a typed name from being treated as an account target for the wrong person.

### Participant states

One person on a bill is in exactly one of these states at a time. Home, Bill, and Recap must all read the same state; none of them may re-derive it.

| State | Meaning | Is on the bill? |
|---|---|---|
| `name-placeholder` | Name typed by the creator, no `identity_id`. Warning/expected-participant only. | Not as a member; appears in warnings |
| `known-identity-selected` | A proven contact is selected in the create draft but the bill has not been created yet, so no invite row exists. | No — draft only |
| `invite-pending` | An invite row exists with `status = 'pending'`. Only the target sees the card. | Not a member; no payment row, no owner action |
| `invite-accepted` | The target accepted, or auto-accept joined them. Kept as history. | Yes |
| `invite-declined` | The target tapped `Tolak`. The row is kept and reopens to pending on the next invite. | No |
| `member` | A real identity with payment/selection rows on the bill. | Yes |
| `left` | Was a member and left; their rows are deleted. | No, but they can rejoin via the share link |

An invite row is never a bill member: it gets no payment row, no owner action, and must not claim a marked-paid state or an owed amount. Only the invite target can see it.

### Invite lifecycle

- Auto-accept is **ON by default** (per identity, `auto_accept`). With it ON, a first-time direct invite joins the target immediately — no link, no tap.
- With auto-accept **OFF**, the target sees a pending card on Home with `Terima` / `Tolak`. Accept joins the bill like the share link does; decline records `invite-declined`.
- **After a decline, the next invite always lands as pending**, regardless of auto-accept. A decline is "no thanks", not a ban: re-inviting reopens the row as pending, and the target must accept on purpose. Without this, invite → decline → invite again silently forced the person onto the bill with no further consent.
- **Joining via the share link counts as accepting** and closes any pending invite for that pair.
- A manager can withdraw a still-pending invite (`DELETE /api/bills/{bill_id}/invites/{invite_id}`), which is the sender's only recourse when the wrong contact was invited or the target (auto-accept OFF) has not answered.
- A bill with a `pending` invite for an identity also appears in `GET /api/identities/{id}/bills`, so the Home row and the Recap action always agree on the same bill id.
- **Name comparison is normalized** (case + whitespace, one shared helper). A person is never recorded twice on one bill — once as a typed placeholder and once as an invited member. Selecting a contact removes a typed name with the same normalized name, and adding a typed name that collides with a selected contact is rejected.

---

## 3. Core user flows

### 3.1 Onboarding

- Ask for a name with direct Indonesian copy.
- Explain that the identity is saved on the device.
- Offer recovery code when a previous identity is detected or the user chooses recovery.
- Keep login language simple. Do not imply a full account system before Google binding exists.

### 3.2 Create bill

The first decision is the input mode. **Target copy — not shipped:** the labels below are the intended wording; the shipped React screen currently renders `Foto struk` and `Isi manual` for the same two choices (`frontend/src/routes/CreateRoute.tsx:473,488`), and the legacy-only strings `Scan struk otomatis` / `Isi manual tanpa scan` exist solely in the frozen runtime (`frontend/static/create.js`).

- `Scan struk otomatis`
- `Isi manual tanpa scan`

Align the shipped labels with this line or change this line when the create screen is rebuilt — the two must not stay divergent.

Do not expose every optional field at equal visual weight on the first render. Progressive disclosure is preferred.

The editor must support:

- Receipt photo(s).
- Merchant/title/date.
- Item name, price, discount, quantity, and mode.
- Subtotal, tax, service, order discount, cashback, and total.
- Payer selection.
- Known identity picker.
- Name-only participant placeholders.
- Server reconciliation warnings.
- A clear save/create action.

### 3.3 OCR state model

```text
idle
  -> selecting-photo
  -> uploading
  -> reading
  -> read-success
  -> retryable-failure
  -> manual-mode
  -> saving-bill
  -> saved
```

Rules:

- Fast OCR is the default.
- OCR failure never blocks bill creation.
- Keep the uploaded photo after failure.
- Show `Coba baca lagi` and `Isi manual`. **Target copy — not shipped anywhere yet:** `Coba baca lagi` does not exist in the codebase; it is proposed copy for the OCR failure state. The shipped React surface renders the shorter `Coba lagi` (`frontend/src/components/feedback.tsx:23`, `routes/RecapRoute.tsx:121`), and the OCR-specific backend errors today return `"Layanan AI gratis sedang penuh atau mengalami gangguan. Coba lagi beberapa menit kemudian atau isi secara manual."` (`backend/main.py:2487,2495`, `backend/ocr.py:273`) or `"Isi manual dulu ya."` (`backend/main.py:2485,2498`, `backend/ocr.py:234`). Align the shipped string with this line or change this line when the OCR states are rebuilt — the two must not stay divergent.
- Do not use raw 502/503/504 as the main user-facing headline.
- Manual entry uses the same editor and validation as OCR results.
- If the user edited OCR output and requests retry, show a confirmation before replacing current edits.
- Retry may use the same photo or a new photo/upload.
- A slower/more accurate mode may be offered after failure. If it times out, fall back to manual with the photo preserved.

### 3.4 Bill detail

Recommended hierarchy:

1. Receipt/photo context.
2. Title or merchant.
3. Total and bill status.
4. Payment method as a compact action that opens a sheet.
5. Item list and selection controls.
6. Contextual bottom action on mobile.

Creator actions:

- `Bagikan bill` is the default primary action.
- `Edit bill` is secondary/outline.
- If the bill has a blocking warning, the relevant correction action may become primary for that state.
- Share and edit must not look like two equal primary buttons by default.

Guest actions:

- Before selection: choose items.
- After selection: inspect their share.
- Once the amount is ready: mark payment.
- Payment method is available through a compact button/sheet, not a large permanent block.

### 3.5 Selection and payment

- The server is the source of truth for totals.
- Rapid selection writes must remain serialized.
- The UI must distinguish item selection, calculated share, payment method, and marked-paid state.
- Manual settlement is not the same as allocation finality.

### 3.6 Recap

Recap starts with ongoing coordination, not an archive wall:

1. Perlu dibayar.
2. Akan diterima.
3. Actions/blockers.
4. Provisional estimates.
5. Settled history.

Final money and provisional money must have separate sections, labels, and visual treatment. Provisional values must never look like confirmed totals.

---

## 4. React-only frontend architecture

### Runtime decision

React + TypeScript + Vite is the only shipped frontend runtime. The old vanilla
files are frozen and will be removed after parity verification:

- `frontend/static/app.js`
- `frontend/static/screens.js`
- `frontend/static/create.js`
- `frontend/static/bill.js`
- `frontend/static/recap.js`

`frontend/static/` may temporarily hold non-runtime assets such as favicon,
manifest, brand images, and OG assets. It is not a runtime fallback. FastAPI
serves `frontend/dist/index.html` and hashed `/assets/` output; if the build is
absent, `/` returns a visible 503 instead of selecting a second document/runtime.

### Target folder structure

```text
frontend/
├── src/
│   ├── app/
│   │   ├── App.tsx
│   │   ├── app-router.tsx
│   │   ├── providers.tsx
│   │   ├── route-guards.ts
│   │   └── route-types.ts
│   ├── components/
│   │   ├── ui/                    # customized shadcn primitives
│   │   ├── layout/                # AppShell, Topbar, nav, dock, container
│   │   └── shared/                # state-independent app patterns
│   ├── features/
│   │   ├── identity/
│   │   ├── home/
│   │   ├── create/
│   │   ├── bill/
│   │   ├── recap/
│   │   └── settings/
│   ├── lib/
│   │   ├── api/                   # client, schemas, error normalization
│   │   ├── domain/                 # canonical status and money mapping
│   │   ├── async/                 # request gates and serialized writes
│   │   └── routes.ts
│   ├── styles/
│   │   ├── tokens.css
│   │   ├── globals.css
│   │   └── utilities.css
│   └── main.tsx
├── tests/
│   ├── logic/
│   ├── components/
│   ├── flows/
│   └── visual/
├── public/
│   ├── brand/
│   ├── favicon.svg
│   ├── manifest.json
│   └── og-cover.png
├── components.json
└── package.json
```

Ownership rules:

- `components/ui` contains no bill/business logic.
- `components/layout` owns global navigation, page width, dock clearance, and responsive shell behavior.
- `features/*` owns screen behavior and composition.
- `lib/domain` owns shared status/state mapping so Home, Bill, and Recap cannot disagree.
- `lib/api` owns endpoint calls and response normalization.
- `styles/tokens.css` owns semantic visual values.
- Routes must not create private Button/Card/Alert/Dialog/Sheet/status implementations.

### Current tree vs target tree (migration step)

The tree above is the **target**, not what is on disk today. `frontend/src` currently holds:

```text
frontend/src/
├── App.tsx
├── main.tsx
├── components/
│   ├── AppShell.tsx  BrandLogo.tsx  BrandMark.tsx
│   ├── ReceiptPhotoGallery.tsx  feedback.tsx
│   └── ui/           button.tsx  primitives.tsx
├── lib/              # flat *.ts: api, types, routes, money, list-cache, async-state,
│                     # pending-invite, selection-queue, identity-storage, photos, …
├── routes/           HomeRoute.tsx  CreateRoute.tsx  BillRoute.tsx
│                     RecapRoute.tsx  SettingsRoute.tsx
└── styles/           globals.css
```

`routes/` → `features/`, flat `lib/*.ts` → `lib/api|domain|async/`, and `styles/globals.css` → `styles/{tokens,globals,utilities}.css` are **migration steps**, not already-done facts. When a route is rebuilt in Phase 3, move it to its `features/<name>` owner in the same change instead of adding another file under `routes/`. Do not start the rename before Phase 2 lands the token and primitive foundation, and do not create both `routes/X.tsx` and `features/X` for the same screen.

---

## 5. Customized shadcn design system

### Foundation

- Tailwind CSS v4 is the utility layer, provided by the checked-in `tailwindcss`
  and `@tailwindcss/vite` dev dependencies. v4 has no `tailwind.config.js`;
  theme values live in CSS (`@theme` / `@import "tailwindcss"`) in
  `src/styles/globals.css`. `components.json` intentionally leaves its config
  path empty for this v4 setup.
- shadcn/ui components are copied into the repository and customized, not consumed as an opaque runtime package.
- CSS variables are the theme source.
- `class-variance-authority` defines variants.
- Phosphor remains the single icon family.
- Do not mix legacy class vocabulary and new component vocabulary inside the same rebuilt surface.

### Shipped theme contract

The current React app exposes three Settings preferences: `system`, `light`, and
`dark`. The preference is stored in `localStorage` under `bagiin_theme` with a
safe `system` default. `system` resolves `(prefers-color-scheme: dark)` and
subscribes to media-query changes; explicit preferences do not follow later OS
changes. React writes the resolved value to
`document.documentElement.dataset.theme` and the selected preference to
`data-theme-preference`. `tokens.css` owns both semantic token maps and
`color-scheme`; its media-query block also gives an unmounted/system first-paint
fallback. Settings is the user-facing control; there is no separate theme
runtime or per-route token map.

### Visual direction: warm utility

- One orange accent.
- One warm-neutral family. Do not mix cool gray and warm beige arbitrarily.
- Light and dark themes use the same semantic token names.
- System preference is the initial theme. Manual theme control lives in Settings.
- Cards communicate hierarchy. Do not wrap every group in a card.
- Shadows are restrained and tinted. Dialogs/docks can be elevated; ordinary cards can use border plus surface.

### Shape and spacing

- Card radius: 16px.
- Input and regular button radius: 10px.
- Status and filter chip: pill.
- Icon button: circle.
- Mobile page gutter: 16px.
- Default card padding: 16px.
- Primary editor card padding: 20px when needed.
- Default component gap: 16px.
- Section gap: 24px.
- Touch target: at least 44px.

### Typography

- System sans.
- Screen heading: 28-32px, tight but readable line-height.
- Section heading: 18-20px.
- Body: 15-16px with relaxed line-height.
- Labels: 13px and clear.
- Helper copy: 12-13px, never the only place for a critical instruction.
- Rupiah uses tabular numerals.
- One strong anchor per row/card. Do not make title, amount, badge, and helper copy all heavy at once.

### Action variants

- Primary: one next action per screen/state.
- Secondary/outline: important alternatives.
- Ghost: navigation or low-emphasis actions.
- Destructive: delete, leave, decline.
- Success: actual completion semantics only.

Creator bill detail defaults to primary Share and secondary Edit. A warning state may promote Edit/correction, but the hierarchy must be intentional and state-based.

### Component contracts

Every shared component must define:

- default, hover, active, focus-visible, disabled, and loading states;
- light and dark token behavior;
- accessible labels/roles;
- mobile behavior;
- error/empty behavior when relevant;
- no route-specific hardcoded color/radius/spacing overrides.

Required shared patterns:

- AppShell, PageContainer, Topbar, MobileNav, BottomDock.
- Button, IconButton, Card, CardHeader, CardBody.
- TextField, MoneyField, DateField, Select, Checkbox, Switch.
- Badge, StatusBadge, Alert.
- Sheet, Dialog, ConfirmAction.
- LoadingState, Skeleton, EmptyState, ErrorState.
- ReceiptPhotoBlock, BillSummary, ItemSelectionList, MoneyBreakdown, ActionList.

---

## 6. Backend architecture boundaries

The backend remains FastAPI + SQLite. It is not rewritten as part of the visual foundation, but its ownership boundaries are explicit.

```text
backend/
├── main.py                         # current composition root and compatibility entrypoint
├── api/routes/                     # future route extraction
├── domain/
│   ├── calc.py                     # pure split calculation
│   ├── bill_state.py
│   ├── invite_state.py
│   └── recap.py
├── services/
│   ├── bill_service.py
│   ├── identity_service.py
│   ├── invite_service.py
│   ├── recap_service.py
│   └── ocr_service.py
├── persistence/
│   └── db.py                       # future incremental extraction
├── workers/
│   └── ocr_worker.py               # future local OCR process
├── db.py                            # current persistence compatibility module
├── calc.py                          # current pure calculation module
└── ocr.py                           # current provider adapter
```

Rules:

- Keep server-computed money authoritative and reconciled.
- Keep allocation state separate from payment/settlement state.
- Keep auth derived from authenticated headers, never path identity alone.
- Keep identity secrets private. Never return a secret to any identity other than the one that owns it.
- Keep migrations additive and idempotent.
- Local OCR must be benchmarked and run outside the request handler before integration.
- API response builders must remain canonical. Do not make each screen invent its own interpretation of the same state.

### Ownership and payer rules

These rules came from real takeover bugs. Restoring them here so the file agents read first states them explicitly; the authoritative wording is in `SPEC.md` (v51, v57, v58, v65).

- **The confirmed payer is the sole manager; before any payer is confirmed, the creator manages.** `_owner_id()` / `_can_manage()` in `main.py` encode this: `_can_manage` = `_owner_id` (confirmed payer, else creator). Once a manager explicitly confirms a payer, power moves to them completely and the creator becomes a regular participant (can pick items, mark their own paid, view methods — cannot edit/close/delete/set-payer/mark others paid). Co-ownership of the creator is gone.
- **Only an explicit `identity_id` on `PUT /paid_by` sets `paid_by_confirmed`.** Passing a `name` resolves the identity **for display only** and must never confirm. Doing otherwise was a real takeover bug: anyone holding the link could rename themselves to the placeholder name, join, and be confirmed as the sole owner — locking the creator out of their own bill with a 403. A payer matched only by name is display-only and never manages.
- **`can_manage` is computed per viewer and returned in the payload.** The frontend gates on `can_manage`, never on `owner_id`. `owner_id` appears in every bill payload (so anyone with the share link knows it) and is therefore not a permission signal.
- **Creator exit is the `bill.creator_left` flag, not a deleted row.** Everyone else's membership is derived from their payment/selection rows, so leaving just deletes those; the creator has no such rows. Rejoining via the link, or the bill falling back to them as owner, clears the flag. **The owner cannot leave** — they hold the bill.
- **`_compute_response()` in `main.py` is the single canonical bill payload builder.** The bill read and every bill write that needs full state go through it: `GET /bills/{id}`, `PUT /bills/{id}`, `PUT /bills/{id}/paid_by`, `POST /bills/{id}/join`, `POST /bills/{id}/invites/{id}/accept`, `DELETE /bills/{id}/invites/{id}`, `DELETE /bills/{id}/people/{identity_id}`, `POST /bills/{id}/leave`, `POST /bills/{id}/selections`, `PUT /bills/{id}/items/{item_id}/slots`, `DELETE /bills/{id}/items/{item_id}/selections/{identity_id}`, `POST /bills/{id}/payments/{identity_id}/paid`, `POST /bills/{id}/payments/{identity_id}/unpaid`, `POST /bills/{id}/reopen`, `POST /bills/{id}/settle`, `POST /bills/{id}/unsettle`, `POST /bills/{id}/photo`, and `DELETE /bills/{id}/photos/{photo_id}`. Do not make a screen (or a new endpoint) invent its own interpretation of the same state.
- **Exception — these five bill endpoints return a minimal acknowledgment instead of the full payload:** `POST /bills` (creation; `db.create_bill()` returns only `{"id": ...}`), `POST /bills/{id}/close` (`{"ok": True}`), `DELETE /bills/{id}` (`{"ok": True}` — the bill is gone), `POST /bills/{id}/invites/{id}/decline` (`{"ok": True}`), and `POST /bills/{id}/invite` (`{"status": "joined"|"pending"}`). A client must not expect full bill state from these; re-fetch or wait for the next full-state response.

---

## 7. Migration sequence

### Phase 0: documentation and ownership

- This document becomes product/design/architecture source of truth.
- `AGENTS.md` becomes project rules source of truth.
- `SPEC.md` remains business rules plus changelog.
- `CLAUDE.md` and duplicate stale planning documents are removed.

### Phase 1: freeze legacy

- No new features in legacy JS.
- Inventory legacy globals, routes, selectors, API calls, and browser-test dependencies.
- Map each legacy surface to a React feature owner.

### Phase 2: foundation

- Tailwind v4 and the customized shadcn foundation are present; complete the
  remaining primitive/state coverage and visual checks without introducing a
  second token or icon system.
- Move semantic tokens into `src/styles/tokens.css`.
- Rebuild layout and shared primitives.
- Add component state tests and light/dark visual checks.

### Phase 3: screen rebuild

Rebuild in this order:

1. Identity/onboarding/recovery.
2. Home and pending invites.
3. Create mode choice.
4. Verify editor and OCR/manual states.
5. Bill detail creator.
6. Bill detail guest/item picker.
7. Payment method sheet and payment action.
8. Recap ongoing/provisional/history.
9. Settings and theme controls.

### Phase 4: React-only cutover

- React build already owns the application entry.
- Backend already serves built React assets in production and returns 503 when
  the build is absent rather than selecting a legacy document.
- Legacy runtime scripts are removed after the remaining parity verification.
- Legacy inline runtime style is removed after token parity is verified.
- Remaining static files are classified as asset-only or deleted.

### Phase 5: separate product features

- Google binding to existing identity.
- Better account-code lifecycle.
- Local OCR benchmark and optional worker.
- Async OCR only if provider latency justifies queue complexity.

---

## 8. Verification gates

### Build and tests

```bash
cd backend && venv/bin/python -m pytest -q
npm --prefix frontend run test:logic
npm --prefix frontend run typecheck
npm --prefix frontend run build
git diff --check
```

### Browser flows

Verify with an isolated database/upload directory:

- onboarding and recovery;
- Home empty/loading/error/list states;
- manual create;
- OCR success;
- OCR failure to manual fallback;
- OCR retry with same/new photo;
- retry confirmation after manual edits;
- create and share;
- known identity invite;
- name placeholder;
- guest item selection and server total;
- creator Share/Edit hierarchy;
- payment method sheet;
- recap final/provisional/action/settled history;
- reload/navigation during async work.

### Visual matrix

Widths: 320, 360, 375, 390, 412, 480, 768, 1040, 1280.

Modes: light, dark, system preference, keyboard-open mobile forms, safe-area bottom dock.

Blocking UI failures:

- horizontal overflow;
- hidden or ambiguous primary action;
- error without recovery;
- material light/dark hierarchy divergence;
- equivalent components with different spacing/radius/typography;
- console error;
- wrong persisted identity/invite/selection/payment state;
- inaccessible label, focus, contrast, or touch target.

No production deploy is implied by this document. Production requires explicit user approval after branch review, full verification, merge, restart, and public validation.
