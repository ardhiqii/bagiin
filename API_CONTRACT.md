# Bagiin — API & Behaviour Contract (backend truth)

Source of truth: `backend/main.py` (routes, validation, `_compute_response`, recap),
`backend/calc.py` (`compute`), `backend/db.py` (SQL, row shapes), and the legacy client
(`frontend/static/app.js`, `create.js`, `bill.js`, `recap.js`, `screens.js`).

Every response shape below is copied from the source, and spot-verified against the live
backend at `http://127.0.0.1:8082` (read-only GETs against the real SQLite DB). Where the
source is ambiguous or the behaviour is surprising, it says so instead of guessing.

**Endpoint surface size:** `/openapi.json` exposes **41 paths / 47 operations**; excluding the
static shell (`GET|HEAD /`, `GET|HEAD /static/manifest.json`) that is **43 operations under `/api`**,
plus `GET /uploads/{filename}` = **44 application operations**. This document gives a section to
**43 of them**, covering every path in the requested list (six of which exist under a different
HTTP method — see §0.3).

---

## 0. Conventions

### 0.1 Base URL, CORS

- Base URL: same origin as the app (`/api/...`). No `/v1` prefix, no API version header.
- CORS: `allow_origins=["*"]`, `allow_methods=["*"]`, `allow_headers=["*"]`. Any origin works.
- `Content-Type: application/json` for JSON bodies; `multipart/form-data` for uploads.
- No CSRF tokens, no cookies, no sessions. Auth is header-only.

### 0.2 Authentication — every request carries two headers

`main._identity_from_request()` (main.py:60):

| Header | Meaning |
|---|---|
| `X-Identity-Id` | Public identity id. **Required** on authenticated routes. |
| `X-Identity-Secret` | The credential. Required once the identity has a secret stored. |

Resolution order:

1. Missing `X-Identity-Id` → **400** `{"detail":"Header X-Identity-Id wajib diisi"}`
2. Unknown id → **404** `{"detail":"Identitas tidak ditemukan"}`
3. Identity has a stored `secret` and the header is missing or mismatched (compared with
   `secrets.compare_digest`) → **403** `{"detail":"Sesi tidak valid, coba masuk ulang"}`
4. Identity has **no** stored secret (pre-v51 rows) → request is allowed with the id alone
   (trust-on-first-use; the client is expected to `POST /api/identities/{id}/bind`).

There is **no query-param auth** and **no bearer token**. The legacy client sends both headers
on *every* request, including GETs (`app.js` `api()`, lines ~363-376):

```js
headers["X-Identity-Id"] = state.identity.id;
if (state.identity.secret) headers["X-Identity-Secret"] = state.identity.secret;
```

Two deliberate exceptions:

- `GET /api/bills/{bill_id}` uses `_viewer_id()`, which swallows any auth failure and passes
  `viewer_id = null`. A share link alone grants read access; a missing/stale identity just
  means `can_manage=false` and `pending_invites=[]`.
- `POST /api/identities/{id}/bind` does **not** authenticate at all (see §2.3).

Routes with `{identity_id}` in the path call `_identity_from_request` **and then** compare the
path id to the authenticated id → **403** `{"detail":"Identitas tidak cocok"}` on mismatch.
Path ids are never trusted as credentials.

### 0.3 Requested list vs. actual methods (six corrections)

The task list names several endpoints with a method the server does not implement. The real
route is documented in the referenced section; sending the listed method returns **405**.

| Listed as | Actually | Section |
|---|---|---|
| `POST /api/bills/[bill_id]/people/[identity_id]` | **DELETE** same path (removes a person) | §4.9 |
| `POST /api/bills/[bill_id]/paid_by` | **PUT** same path | §4.11 |
| `GET /api/bills/[bill_id]/selections` | no GET route — selections ship inside `GET /api/bills/{id}` as `sel_by_item` + `people` | §3.1 |
| `POST /api/bills/[bill_id]/items/[item_id]/slots` | **PUT** same path | §4.15 |
| `PUT /api/bills/[bill_id]/items/[item_id]/selections/[identity_id]` | **DELETE** same path (release one person's slots) | §4.16 |
| `POST /api/bills/[bill_id]/photos/[photo_id]` | **DELETE** same path | §4.20 |
| `GET /api/photos/[filename]` | no such GET — images are served by **`GET /uploads/[filename]`**; `DELETE /api/photos/[filename]` exists | §5.3, §5.4 |

Also present but absent from the requested list, documented here for completeness: `DELETE /api/bills/{bill_id}` (§4.3).

### 0.4 Error envelope

| Case | Status | Body |
|---|---|---|
| `HTTPException` (all hand-written errors) | 400/403/404/409/422 | `{"detail": "<string>"}` |
| Missing/invalid multipart field (`file`) | 422 | `{"detail":[{"type":"missing","loc":["body","file"],"msg":"Field required","input":null}]}` — standard FastAPI validation list |
| Body is not JSON / not an object | 400 | `{"detail":"Isi permintaan wajib diisi"}` / `"Format JSON tidak valid"` / `"Isi permintaan harus berupa objek JSON"` |
| Rate limit exceeded (slowapi) | 429 | `{"error":"Rate limit exceeded: <n> per 1 minute"}` — from slowapi's default handler. **Not probed live** (all limited routes are writes); shape is library-derived |

Legacy client handling to mirror (`app.js` `api()`): read `detail` when it's a string, join
`detail[].msg` when it's an array, and show a fixed Indonesian string for 429 / network failure.

### 0.5 Rate limits (slowapi, per client IP)

5/min: `POST /api/identities/{id}/code/generate`.

Angka di bawah adalah **bawaan**; semuanya dihitung per IP, jadi orang-orang di satu
Wi-Fi/NAT berbagi jatah yang sama. Empat yang paling mungkin perlu dituning bisa
diubah lewat env tanpa menyentuh kode:

| Env | Bawaan | Untuk |
|---|---|---|
| `BAGIIN_RL_BILL` | `10/minute` | `POST /api/bills` |
| `BAGIIN_RL_ACCOUNT` | `10/minute` | restore, set password, set username, unlink Google |
| `BAGIIN_RL_UPLOAD` | `10/minute` | `POST /api/bills/{id}/photo`, `POST /api/photos`, `POST /api/ocr` |
| `BAGIIN_RL_REGISTER` / `BAGIIN_RL_LOGIN` / `BAGIIN_RL_GOOGLE` | `10` / `10` / `20` per minute | daftar, masuk, Google |

20/min: `POST /api/identities/{id}/bind`, `POST /api/identities/{id}/auto_accept`, `POST /api/bills/{id}/invite`, accept, decline, `DELETE .../invites/{id}`, `POST .../leave`.
30/min: `POST /api/identities`, `POST /api/identities/{id}/accounts`, `PUT /api/accounts/{id}`.

Instance uji memakai `60/minute` untuk tiga env pertama: suite e2e membuat lebih dari
10 bill dalam satu menit, dan 429-nya dulu terbaca sebagai "tombol tidak berfungsi".

All other routes are unlimited.

### 0.6 Id and value formats

| Thing | Format |
|---|---|
| `identity.id`, `bill.id`, `identity.secret` | `secrets.token_urlsafe(16)` → **22 chars**, URL-safe, may contain `-` and `_`. Treat as opaque. |
| `item.id`, `payment_account.id`, `bill_photo.id` | SQLite `INTEGER` autoincrement, **global** across bills (photo ids are not bill-scoped in the id space; the endpoint is) |
| `bill_invite.id` | `INTEGER` autoincrement |
| Recovery code (generated) | `"ABCD-EFGH-JKLM"` — 3 groups of 4 from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (no 0/O/1/I/L) |
| Recovery code (manual) | any string ≥ 8 chars, ≤ 100; stored as `sha256("bagiin:" + code)` |
| All timestamps | `"YYYY-MM-DD HH:MM:SS"` — **space separator, no `T`, no timezone suffix**, UTC (`datetime('now')`) |
| Money | `INTEGER` rupiah. Never floats, never strings. Max accepted value `1_000_000_000_000` (1e12) |

Idempotency: there are no `Idempotency-Key` semantics. Mutations are individually idempotent
where noted.

---

## 1. Identity lifecycle (legacy client) — what to replicate

### 1.1 localStorage keys (`app.js` `LS_KEYS`)

| Key | Stored value |
|---|---|
| `bagiin_identity` | **JSON object** — the whole identity row as the server returned it: `{id, name, role, identity_code_hash, created_at, secret, auto_accept}`. This is the credential store: `id` + `secret`. |
| `bagiin_name` | JSON string — the display name the user typed at creation/restore (used for greeting/fallbacks). |
| `bagiin_list_sort` | JSON string — home-list sort preference (UI only). |
| `bagiin_recap_aliases` | JSON object — recap contact alias map (UI only). |
| `bagiin_brand_logos` | JSON object — cached payment-brand logo data URLs (UI only; `app.js:285`) |

Reads are `JSON.parse(localStorage.getItem(key))` with a `null` fallback; writes are wrapped in
try/catch (private mode is tolerated silently).

### 1.2 Creation

`ensureIdentity(name)` (`app.js:436`):

1. If `state.identity` is null → `POST /api/identities` with `{name}`.
2. Store the **entire response** in `state.identity` and `localStorage["bagiin_identity"]`.
3. Store `{name}` in `localStorage["bagiin_name"]`.

The response includes `secret`; that is the only time a client learns it from creation (the
server also returns it from `/restore` and `/bind`).

### 1.3 Secret binding for pre-secret identities

`ensureSecret()` (`app.js:447`): if the cached identity has no `secret`, call
`POST /api/identities/{id}/bind` once and persist `secret` back into `bagiin_identity`.
Failures are swallowed — subsequent requests simply 403 with `"Sesi tidak valid, coba masuk ulang"`.

### 1.4 Restore

Settings screen "Pulihkan Akun" (`screens.js:95`): user pastes the recovery code →
`POST /api/identities/restore` with `{code}` → response is the full identity row (including
`secret`, and including `identity_code_hash`) → replace `bagiin_identity` + `bagiin_name`,
re-render. Because restore is unauthenticated, it is the only way back onto a device that lost
its localStorage.

### 1.5 Logout

Deletes `bagiin_identity` and `bagiin_name` only. The identity still exists server-side and is
recoverable **only** with the recovery code (if one was ever generated).

### 1.6 Guest-on-a-share-link flow (`bill.js:405-435`, `500-540`)

1. Deep link `#/b/<bill_id>` → `GET /api/bills/{id}` (no auth needed) renders read-only.
2. If a cached identity exists but is not in `people[]` → `POST /api/bills/{id}/join`.
3. If there is no identity at all → name prompt → `POST /api/identities` → `POST /api/bills/{id}/join`.
4. If join fails (closed bill → 403), the guest still sees the final split. **Join failure is a
   normal path, not an error screen.**

---

## 2. Identity endpoints

### 2.1 `POST /api/identities` — create identity

- **Caller:** boot / first-run name prompt (`app.js` `ensureIdentity`), guest name prompt on a share link (`bill.js`).
- **Auth:** none (this is how you get an id).
- **Rate limit:** 30/min.

```ts
interface CreateIdentityRequest {
  name: string;        // required, trimmed, non-empty, ≤ 60 chars
  creator?: boolean;   // any truthy value → role "creator", else "guest"
}

interface IdentityRow {           // ← response (also /restore and /bind's id+name+secret subset)
  id: string;                     // 22-char token_urlsafe
  name: string;
  role: "guest" | "creator";
  identity_code_hash: string | null;  // sha256 hex; null on a fresh identity. NEVER display.
  created_at: string;                 // "YYYY-MM-DD HH:MM:SS"
  secret: string;                     // credential — persist this
  auto_accept: 0 | 1;                 // int here (raw DB row); boolean under GET /me
}
```

- **Errors:** 400 `"Nama wajib diisi"` (missing/empty/whitespace); 400 `"Nama maksimal 60 karakter"`;
  400 `"Nama harus teks"` (non-string, non-number); 400 body errors (§0.4); 429.
- **Side effects:** one `identity` row inserted with a freshly minted `secret` and `auto_accept=1`.
  No bill, no payment row, no contact relationship.
- **Note:** the legacy client always omits `creator`, so every identity created through the UI is
  `role="guest"` — including the one that creates bills. `role` is never used for authorization.

### 2.2 `POST /api/identities/restore` — restore by recovery code

- **Caller:** settings "Pulihkan Akun" (`screens.js:101`).
- **Auth:** none. Rate limit 10/min.

```ts
interface RestoreRequest { code: string }   // trimmed, ≤ 100 chars
// response: IdentityRow (identical shape to §2.1, including secret AND identity_code_hash)
```

- **Errors:** 404 `"Code tidak dikenal"` (also returned for an empty code — no separate message);
  400 `"Code maksimal 100 karakter"`; 400 `"Code harus teks"`; 400 body errors; 429.
- **Side effects:** **none.** POST is used only because the code travels in the body.
- **Gotcha:** the matcher is `sha256("bagiin:" + code)` compared against `identity_code_hash` with
  no normalization — codes are **case-sensitive** and whitespace inside the string matters
  (the client trims). A user who typed a generated code in lowercase cannot restore.

### 2.3 `POST /api/identities/{identity_id}/bind` — mint a secret (trust on first use)

- **Caller:** `ensureSecret()` (`app.js:450`) once per legacy identity.
- **Auth:** **none** (by design: the browser only holds the id at that point). Rate limit 20/min.
- **Request body:** not read. `{}` is fine; an empty body is fine.

```ts
interface BindResponse { id: string; name: string; secret: string }
```

- **Errors:** 404 `"Identitas tidak ditemukan"`; 403 `"Identitas ini sudah memiliki sesi"` if a
  secret already exists (it is never re-issued or rotated); 429.
- **Side effects:** sets `identity.secret` **only if NULL**.
- **Security note (be explicit in the rewrite):** because bind is unauthenticated, any party who
  knows an identity id that has no secret yet can claim it. The server accepts this trade-off
  for pre-v51 rows. A new frontend should call bind exactly once, immediately after boot, and
  never expose the id of an unbound identity.

### 2.4 `POST /api/identities/{identity_id}/code` — set a manual recovery code

- **Caller:** **nobody in the legacy client** — no call site exists in `app.js`/`screens.js`/etc.
  (settings only generates). Documented for completeness.
- **Auth:** required, and path id must equal caller id. No rate limit.

```ts
interface SetCodeRequest { code: string }   // trimmed, 8 ≤ len ≤ 100
interface OkResponse { ok: true }
```

- **Errors:** 403 `"Identitas tidak cocok"`; 400 `"Code minimal 8 karakter"`; 400 `"Code maksimal 100 karakter"`;
  400 `"Code harus teks"`; 400/403/404 auth errors (§0.2).
- **Side effects:** overwrites `identity_code_hash`, **invalidating any previous code immediately**.

### 2.5 `POST /api/identities/{identity_id}/code/generate` — generate a recovery code

- **Caller:** settings "Buat Kode" (`screens.js:941`). Rate limit 5/min.
- **Auth:** required + path-id match. Body not read.

```ts
interface GenerateCodeResponse { code: string }   // "ABCD-EFGH-JKLM"
```

- **Errors:** 403 `"Identitas tidak cocok"`; auth errors; 429.
- **Side effects:** overwrites `identity_code_hash`. The plaintext code is returned **once** and is
  never retrievable again (only its hash is stored). Regenerating kills the old code silently —
  the legacy UI guards this with `has_code` (see §2.7) because users lost codes they had written down.

### 2.6 `POST /api/identities/{identity_id}/name` — rename self

- **Caller:** settings "Ubah nama" (`screens.js:908`). Auth required, path id must equal the caller.
- **Rate limit:** none.

```ts
interface UpdateNameRequest { name: string }  // trimmed, non-empty, ≤ 60
// response
{ ok: true }
```

- **Errors:** 403 `"Identitas tidak cocok"`; 400 `"Nama wajib diisi"`; 400 `"Nama maksimal 60 karakter"`;
  400 `"Nama harus teks"`; auth errors (§0.2).
- **Side effects:** `identity.name` updated — and this is **not** cosmetic. The new name is what
  every bill renders in `people[].name` for that identity (unless a creator-typed participant
  placeholder was claimed, which wins), and it is what `paid_by_name` matching and
  `db.claim_participant` compare against. Renaming yourself to a bill's payer placeholder is
  exactly the sequence `paid_by_confirmed` exists to defuse (§6.4).

### 2.7 `GET /api/identities/{identity_id}/me` — own profile

- **Caller:** settings screen (`screens.js:977`). Auth + path-id match.

```ts
interface MeResponse {
  id: string;
  name: string;
  has_code: boolean;      // true if a recovery code is set
  auto_accept: boolean;   // boolean here, 0|1 in the raw identity row
}
```

- **Errors:** 403 `"Identitas tidak cocok"`; auth errors. No side effects.

### 2.8 `GET /api/identities/{identity_id}/accounts` — list my payment accounts

- **Caller:** settings accounts list + paste-account sheet (`screens.js:1025`, `1268`). Auth + path-id match.

```ts
interface PaymentAccount {
  id: number;
  identity_id: string;
  brand: string;
  account_no: string;
  holder_name: string | null;
  sort_order: number;
}
// response: PaymentAccount[]  — ordered by (sort_order, id); [] when none
```

- **Errors:** 403 `"Identitas tidak cocok"`; auth errors.
- **Note:** this endpoint is **self-only**. To show *someone else's* accounts (the payer's, the
  creator's) use `creator_accounts` / `paid_by_accounts` inside the bill payload (§3.1) — do not
  call this route with another id, it 403s.

### 2.9 `POST /api/identities/{identity_id}/accounts` — add a payment account

- **Caller:** settings (`screens.js:1082`), paste-account bulk add (`screens.js:1348`). Rate limit 30/min.

```ts
interface AddAccountRequest {
  brand: string;              // required, ≤ 40
  account_no: string;         // required, ≤ 60  (digits kept as text — leading zeros matter)
  holder_name?: string | null;// ≤ 60; "" / null / omitted → stored as NULL
}
// response: PaymentAccount (the created row, with its new id)
```

- **Errors:** 400 `"Brand dan nomor wajib diisi"` (either missing); 400 `"Brand maksimal 40 karakter"`;
  400 `"Nomor maksimal 60 karakter"`; 400 `"Nama pemilik maksimal 60 karakter"`; 403/400/404 auth; 429.
- **Side effects:** inserts one row (`sort_order=0`). No dedupe — the same account can be added twice.

### 2.10 `PUT /api/accounts/{account_id}` — edit a payment account

- **Caller:** settings account edit (`screens.js:1417`). Rate limit 30/min.
- **Auth:** required. **No path identity check** — ownership is enforced in SQL
  (`WHERE id = ? AND identity_id = ?`), so someone else's account id yields 404, not 403.

```ts
interface UpdateAccountRequest {
  brand: string;               // required, ≤ 40
  account_no: string;          // required, ≤ 60
  holder_name?: string | null; // ≤ 60; "" / null / omitted → NULL
}
// response: PaymentAccount (updated)
```

- **Errors:** 400 `"brand dan account_no wajib"`; 404 `"Akun tidak ditemukan"` (missing **or** not yours);
  auth errors; 429.
- **Side effects:** full replace of `brand`, `account_no`, `holder_name`. `sort_order` untouched.

### 2.11 `DELETE /api/accounts/{account_id}` — delete a payment account

- **Caller:** settings (`screens.js:1055`). Auth required, no rate limit, SQL-scoped ownership.

```ts
// response
{ ok: true }
```

- **Errors:** 404 `"Akun tidak ditemukan"` (missing **or** not yours); auth errors.
- **Side effects:** deletes the row. Any bill payload that embedded it stops showing it.

### 2.12 `GET /api/identities/{identity_id}/contacts` — "kontak terbukti"

- **Caller:** invite sheet search + participant picker (`bill.js:2018`, `create.js:1356`). Auth + path-id match.
- **Query:** `?q=<search>` — trimmed, truncated to 30 chars, `LIKE %q%` on name. Empty/absent = no filter.

```ts
interface Contact {
  id: string;            // the other identity's id
  name: string;
  last_shared: string;   // "YYYY-MM-DD HH:MM:SS" of the most recent shared bill
}
// response: Contact[] — max 50, ordered by last_shared DESC, then name; excludes yourself
```

- **Semantics:** "shared" = you are creator **or** have a payment row on a bill where they are
  creator or have a payment row. Selection-only participants without a payment row do not count
  (in practice `set_selections` always creates one, so this rarely matters).
- **Errors:** 403 `"Identitas tidak cocok"`; auth errors.
- **Gotcha:** the response is capped at 50 **before** any client-side filtering, but the invite
  endpoint tests contact-ness with a separate uncapped query (`db.is_contact`). A contact can
  therefore be inviteable yet invisible in this list. Filter *after* fetching, and never assume
  "not in contacts ⇒ cannot invite".

### 2.13 `POST /api/identities/{identity_id}/auto_accept` — invite behaviour toggle

- **Caller:** settings switch (`screens.js:999`). Auth + path-id match. Rate limit 20/min.

```ts
interface AutoAcceptRequest { auto_accept: boolean }  // strict: true/false, 1/0, "true"/"false"/"1"/"0"/"" 
// response
{ ok: true }
```

- **Errors:** 403 `"Identitas tidak cocok"`; 400 `"auto_accept wajib bernilai true atau false"`
  (null/missing/other strings — there is **no default**); auth errors; 429.
- **Side effects:** `identity.auto_accept = 0|1`. Changes what `POST /api/bills/{id}/invite` does
  for this person (instant join vs. pending card, §6).

### 2.14 `GET /api/identities/{identity_id}/bills` — home/history list

- **Caller:** home list (`screens.js:654`). Auth + path-id match. No rate limit.

```ts
interface BillListRow {
  id: string;
  title: string;
  merchant: string | null;
  transacted_at: string | null;
  total_idr: number;
  order_discount_idr: number;
  cashback_idr: number;
  status: "open" | "closed";
  created_at: string;
  closed_at: string | null;
  creator_identity_id: string;
  paid_by_identity_id: string | null;
  paid_by_confirmed: 0 | 1;      // INT here (raw column). Boolean in the bill detail payload.
  settled: boolean;
  pending_names: string[];       // non-payer people on the roster who have picked nothing yet
  total_unpaid: number;          // sum of positive totals of people not marked paid (payer excluded)
  uncovered_idr: number;         // empty-slot money after discounts/cashback
  all_paid: boolean;
  owner_id: string;              // confirmed payer, else creator
  can_manage: boolean;
  i_am_payer: boolean;
  my_paid: boolean;              // true if I am the resolved payer, or my payment row is 'paid'
  my_total_idr: number;          // my computed total for this bill (0 if not in people[])
  has_picks: boolean;            // any selection exists on the bill at all
}
// response: BillListRow[]
```

- **Ordering:** `COALESCE(transacted_at, created_at) DESC, created_at DESC`.
- **Membership filter:** bills where I am the creator (and `creator_left = 0`) **or** I have a
  payment row. A creator who left (§4.10) disappears from their own history until they rejoin.
- **Errors:** 403 `"Identitas tidak cocok"`; auth errors.
- **Note:** `settled` here is computed by `db._bill_settled`, a mirror of the detail logic. It
  can disagree with the detail payload only in the "manual settle" corner (list checks
  `settled_manual` first and returns true). Treat `settled` as authoritative for list badges and
  `GET /api/bills/{id}.settled` as authoritative for the bill screen; they are designed to agree.
- **Non-member bills are not listed** — pending invites appear only via §2.16 and §2.15 (`provisional`).

### 2.15 `GET /api/identities/{identity_id}/recap` — balance recap

- **Caller:** recap screen (`recap.js:536`). Auth + path-id match. No rate limit.

```ts
type Direction = "pay" | "receive";

interface RecapCounterpartyBill {
  bill_id: string;
  title: string;
  amount_idr: number;
  direction: Direction;
  status: "open" | "closed";
}

interface RecapCounterparty {
  identity_id: string;
  name: string;
  net_idr: number;                 // receivable - payable for this counterparty
  direction: Direction;            // "receive" when net_idr > 0, else "pay"
  amount_idr: number;              // abs(net_idr)
  bills: RecapCounterpartyBill[];
  pending: {
    count: number;
    current_user: number;          // how many of the pending actions are mine
    waiting_other: number;
    bill_ids: string[];            // sorted
  };
}

type ProvisionalReason =
  | "pending_selection" | "uncovered_slots" | "open_bill"
  | "payer_unresolved" | "pending_workflow";

interface ProvisionalBill {
  bill_id: string;
  title: string;
  status: "open" | "closed";
  reason_codes: ProvisionalReason[];   // stable order as listed above
  estimated_payable_idr: number;
  estimated_receivable_idr: number;
  current_user: {
    total_idr: number;                 // my computed total on this bill
    paid: boolean;
    direction: Direction | "none";
  };
}

type RecapActionKind =
  | "select_items" | "pay_share" | "confirm_payer"
  | "wait_selection" | "wait_payment" | "wait_invite" | "accept_invite";

interface RecapAction {
  kind: RecapActionKind;
  owner: "current_user" | "other";
  bill_id: string;
  title: string;
  identity_id: string;         // the subject of the action (may be me)
  name: string;
  amount_idr: number;
  provisional: boolean;
  href: string;                // always "#/b/<bill_id>"
  counterparty_id: string | null;  // always present; null when there is no "other side"
  invite_id?: number;          // present only for "wait_invite" and "accept_invite"
  invited_by?: string;         // present only for "accept_invite"
  invited_by_name?: string;    // present only for "accept_invite"
}

interface RecapResponse {
  identity: { id: string; name: string };
  final: {
    payable_idr: number;
    receivable_idr: number;
    net_idr: number;                 // receivable - payable
    counterparties: RecapCounterparty[];  // excludes net 0; sorted by |net| desc, name, id
    bill_count: number;
  };
  provisional: {
    bill_count: number;
    payable_idr: number;             // sum of estimated payables
    receivable_idr: number;
    bills: ProvisionalBill[];        // chronological
  };
  actions: {
    current_user: RecapAction[];     // sorted by (bill date, bill id), identity_id, kind, invite_id
    waiting_other: RecapAction[];
  };
  counts: {
    current_user: number;
    waiting_other: number;
    provisional_bills: number;
  };
}
```

- **What "final" means** (`_recap_is_final`): `settled` is true, OR — for a bill that is not
  invite-only-with-pending-workflow — `total_ok`, `uncovered_idr == 0`, no pending picker, no
  unresolved payer, and (if the bill is open) at least one real selection exists. Final bills
  contribute directed money edges; provisional ones contribute estimates + `reason_codes`.
- **Edge semantics:** a person with a positive unpaid `total_idr` who is not the owner creates an
  edge **to the owner** (`_owner_id`, i.e. confirmed payer else creator). Settled bills create no edges.
- **Pending-invite bills** are included as `final=false` / `invite_only` entries even though the
  viewer has no payment row, which is how the recap can show a bill you were invited to but never opened.
- **Errors:** 403 `"Identitas tidak cocok"`; auth errors.
- **Gotcha:** `current_user.direction` for provisional bills is `"none"` when there is no money
  edge, which happens on bills where my share is 0. Do not read `"none"` as an error.
- **Gotcha:** `actions[].provisional` is not the same as the bill being provisional — for
  `pay_share` on a final bill it is `!final`, i.e. `false`.

### 2.16 `GET /api/identities/{identity_id}/invites` — pending invite cards

- **Caller:** home invite card block (`screens.js:194`). Auth + path-id match. No rate limit.

```ts
interface PendingInviteRow {
  id: number;               // bill_invite.id — needed for accept/decline
  bill_id: string;
  invited_by: string;       // inviter identity id
  created_at: string;
  status: "pending";
  bill_title: string;
  bill_total: number;       // bill.total_idr at read time
  invited_by_name: string;
}
// response: PendingInviteRow[] — DESC created_at; only status='pending' AND bill.status='open'
```

- **Errors:** 403 `"Identitas tidak cocok"`; auth errors.
- **Note:** invites to closed bills are **silently hidden** by this query while the rows stay in
  the table. Accepting one still 403s (`"Bill sudah ditutup"`).

---

## 3. Bill payload (the single most important shape)

### 3.1 `GET /api/bills/{bill_id}` — computed bill

- **Caller:** bill detail screen (`bill.js`), share-link deep link, and the reference for every
  mutation that returns a bill.
- **Auth:** optional. Invalid/missing identity header → no 4xx, `can_manage=false`,
  `pending_invites=[]`.
- **Response:** `BillResponse` below.

```ts
interface BillRow {
  id: string;
  creator_identity_id: string;
  title: string;
  photo_path: string | null;   // LEGACY single-photo column; null for every bill created by current code
  subtotal_idr: number;        // server-computed Σ (price - discount) × quantity — never client input
  tax_idr: number;
  service_idr: number;
  order_discount_idr: number;
  cashback_idr: number;
  total_idr: number;
  tax_mode: string;            // "proportional" | "equal" | "creator" (unguarded string; see §7)
  status: "open" | "closed";
  created_at: string;
  closed_at: string | null;
  merchant: string | null;
  transacted_at: string | null;
  participant_count: number | null;   // creator-declared headcount, display only
  paid_by_name: string | null;        // declared display name (may be a placeholder who never joined)
  paid_by_identity_id: string | null; // resolved/picked payer id
  tax_included: 0 | 1;
  paid_by_confirmed: 0 | 1;           // 1 = a manager picked this payer on purpose (owns the bill)
  creator_left: 0 | 1;                // 1 = creator walked out (only possible once a payer is confirmed)
  settled_manual: 0 | 1;              // owner pressed "Tandai Lunas" on the whole bill
}

interface ItemRow {
  id: number;
  bill_id: string;
  name: string;
  price_idr: number;        // unit price, before item discount
  sort_order: number;
  mode: "free" | "slot";
  slot_count: number | null; // null for free items
  discount_idr: number;      // per-unit discount (not line total)
  quantity: number;          // purchased units, 1..99 — line total = (price_idr - discount_idr) * quantity
}

interface ParticipantRef { name: string; identity_id: string | null }  // creator-declared roster

interface BillPhoto { id: number; path: string }   // ABSOLUTE server path, e.g. "/var/www/bagiin-uploads/<hex>.jpg"

interface SelectorRef { name: string; qty: number; id: string }  // id = identity_id of the picker

interface PersonTotal {
  identity_id: string;
  item_subtotal_idr: number;   // gross item share, before order discount
  order_discount_idr: number;  // this person's share of the checkout discount
  subtotal_idr: number;        // net item share = item_subtotal - order_discount
  tax_idr: number;             // share of tax + service (0 when tax_included and no service)
  cashback_idr: number;        // this person's share of the payment-method cashback
  total_idr: number;           // subtotal_idr + tax_idr - cashback_idr
  name: string;                // claimed participant name, else identity name, else "?"
  paid: "paid" | "unpaid";     // resolved payer is ALWAYS reported "paid"
}

interface UncoveredSlot {
  item_id: number;
  name: string;
  per_slot: number;    // line_total // slot_count (original rate; order discount is not an item discount)
  empty: number;       // unclaimed slots remaining
  amount_idr: number;  // money still unclaimed in this item, after order-discount/cashback shares
}

interface BillResponse {
  all_paid: boolean;             // manual settle OR (picked + roster>1 + all owed paid + every non-payer picked)
  settled_manual: boolean;
  bill: BillRow;
  owner_id: string;              // confirmed payer, else creator — the ONLY identity with management powers
  can_manage: boolean;           // owner_id === authenticated viewer (false when unauthenticated)
  pending_invites: PendingInviteSummary[];  // manager-only; ALWAYS [] for non-managers
  creator_name: string;          // "?" if the identity row is gone
  creator_accounts: PaymentAccount[];
  paid_by_id: string | null;     // null when paid_by_name is declared but nobody has resolved yet
  paid_by_name: string;          // display string, never null
  paid_by_confirmed: boolean;    // boolean here (0|1 int inside bill[])
  paid_by_accounts: PaymentAccount[];
  items: ItemRow[];
  photos: BillPhoto[];
  participants: ParticipantRef[];
  people: PersonTotal[];         // sorted by total_idr DESC
  sel_by_item: Record<string, SelectorRef[]>;  // KEYS ARE STRINGS (see §8)
  warnings: string[];
  total_ok: boolean;             // allocation reconciles: Σ people + uncovered == bill.total_idr
  remaining_to_creator: number;  // bill.total_idr - Σ people - uncovered_idr (0 on healthy bills)
  unassigned_items: ItemRow[];   // free items nobody picked (charged to the owner)
  uncovered_slots: UncoveredSlot[];
  uncovered_idr: number;         // Σ amount_idr of uncovered_slots
  settled: boolean;              // manual OR (auto_all_paid AND uncovered_idr === 0)
}

interface PendingInviteSummary {
  id: number;
  identity_id: string;
  name: string;
  created_at: string;
}
```

**How `people[]` is built** (this is why it is not just "identities with a selection"):

1. `calc.compute` returns one entry per identity with a share (selected items, tax, or fallback).
2. Every identity with a **payment row** not already present is appended with all-zero amounts
   (joined but picked nothing).
3. The **creator** is appended with all zeros if `creator_left = 0` and not already present.
4. `name` = claimed `bill_participant.name` for that identity, else `identity.name`, else `"?"`.
5. `paid` = payment row status (`"paid"`/`"unpaid"`, default `"unpaid"`), then forced to `"paid"`
   for the resolved payer.
6. Sorted by `total_idr` descending (stable: the pre-sort order from `calc.compute`).

So a solo bill always has one person row (the creator) with total 0 until items are picked, and
a bill can show people with `total_idr: 0` who permanently owe nothing.

**Errors:** 404 `{"detail":"Bill tidak ditemukan"}`. Nothing else — no auth errors.

---

## 4. Bill endpoints

### 4.1 `POST /api/bills` — create a bill

- **Caller:** create/verify screen (`create.js:1901`). Auth required. Rate limit 10/min.

```ts
interface CreateBillRequest {
  title?: string;              // ≤ 120; falls back to merchant, then "Bill"
  merchant?: string | null;    // ≤ 120
  transacted_at?: string | null; // ≤ 40, free-form string; client sends "YYYY-MM-DD"
  tax_mode?: string;           // ≤ 20; default "proportional". NOT validated as an enum (see §7)
  subtotal?: number;           // RANGE-VALIDATED ONLY — never persisted. Ignored for the real subtotal.
  tax?: number;                // ≥ 0
  service?: number;            // ≥ 0
  order_discount?: number;     // ≥ 0, ≤ subtotal
  cashback?: number;           // ≥ 0, ≤ total after order discount
  total: number;               // ≥ 0; MUST equal subtotal + tax + service - order_discount - cashback
  tax_included?: boolean | 0 | 1;  // if true, tax must be 0
  items: CreateItem[];         // required, non-empty array
  participants?: string[];     // creator-typed placeholder names; non-strings and blanks are dropped,
                               // case-insensitively deduped, order preserved
  participant_count?: number | null; // 0..10000, display only
  paid_by_name?: string | null;      // ≤ 60; "who paid" placeoldname; resolved when that person joins
  photo_path?: string | null;        // legacy single photo; must be a real file in the upload dir
  photos?: string[] | null;          // up to 10 real upload paths; extra entries IGNORED silently
}

interface CreateItem {
  name: string;            // required, ≤ 120, non-empty after trim
  price: number;           // ≥ 0, ≤ 1e12
  discount?: number;       // ≥ 0, ≤ price  (per unit)
  quantity?: number;       // STRICT int 1..99; numeric strings and null are rejected; omitted → 1
  mode?: "free" | "slot";  // default "free"
  slot_count?: number;     // required-ish for slot mode: ≥ 1, default 1 when omitted/invalid-ish
}
```

**Response** — *not* the computed payload:

```ts
interface CreateBillResponse { id: string }
```

The client must immediately `GET /api/bills/{id}` (legacy navigates to `#/b/{id}` which does that).

- **Errors** (status 400 unless noted): see the money table in §7 for the ordering rules, plus
  `"Minimal 1 item"`, `"Item harus berupa objek"`, `"Nama item wajib diisi"`,
  `"Nama item maksimal 120 karakter"`, `"Mode <name> harus free atau slot"`,
  `"Jumlah <name> harus bilangan bulat"`, `"Subtotal terlalu besar"`, `"Path foto tidak valid"`,
  `"photo_path harus berupa teks"`, `"Daftar peserta harus berupa array"`.
  Auth errors per §0.2. 429 at 10/min.
- **Side effects:** inserts 1 `bill` row, N `item` rows, M `bill_participant` rows (unclaimed,
  `identity_id = NULL`), and one `bill_photo` row per attached photo (`photo_path` is folded into
  `photos`, deduped). **The creator gets no payment row** — their membership is implicit by
  `creator_identity_id`. No invite is created; direct invites are separate calls (§4.5).

### 4.2 `PUT /api/bills/{bill_id}` — edit a bill

- **Caller:** bill edit sheet (`bill.js:2788`). Auth required.
- **Preconditions:** caller must be `owner_id` → else 403 `"Hanya owner bill (yang bayar)"`;
  `bill.status` must be `"open"` → else 403 `"Bill sudah ditutup, tidak dapat diedit"`;
  bill must not be settled → 409 `"Bill udah lunas semua. Buka tanda lunas dulu kalau mau ubah."`

```ts
interface UpdateBillRequest {
  title?: string;                  // ≤ 120; missing/empty keeps the current title
  merchant?: string | null;        // ABSENT = unchanged; present null/"" = nulled
  transacted_at?: string | null;   // ABSENT = unchanged; present null/"" = nulled
  tax_mode?: string;               // ACCEPTED BUT IGNORED — db.update_bill never writes tax_mode
  subtotal?: number;               // range-validated, ignored for persistence
  tax?: number;                    // default 0 if absent (whole money block is rewritten)
  service?: number;                // default 0
  order_discount?: number;         // default 0
  cashback?: number;               // default 0
  total: number;                   // required in practice; default 0 → will fail the equation
  tax_included?: boolean | 0 | 1;  // default false
  items: UpdateItem[];             // required non-empty; this is the FULL desired item list
  participants?: string[];         // ABSENT = keep existing roster; present = full replace
  participant_count?: number | null; // ABSENT = unchanged; present null/"" = nulled
}

interface UpdateItem extends CreateItem {
  id?: number;   // existing item id → update in place; omitted → insert as new item
}
```

**Response:** `BillResponse` (§3.1), computed as the caller.

**Semantics that the UI must respect:**

- `items` is a **diff**, not a patch: ids present are updated in place (selections preserved),
  items without an id are inserted, and **every existing item whose id is absent is deleted along
  with its selections**. Always send the complete list.
- Duplicate ids in one payload → 400 `"Ada item dobel di daftar"`.
- An id belonging to another bill is silently treated as "new item" (never clobbers, never deletes).
- Slot → free on an existing item clamps every selector's `qty` to 1.
- Reduces `slot_count` below slots already taken → 400 `"Slot <name> minimal <taken> (sudah terisi <taken>)"`.
- `paid_by_name` / `paid_by_identity_id` are **not writable here** — use §4.11.
- `items`/money errors are the same table as create (§7).

### 4.3 `DELETE /api/bills/{bill_id}` — delete a bill

- **Caller:** bill detail owner menu (`bill.js:2140`). Auth required.
- **Preconditions:** caller must be `owner_id` → 403 `"Hanya owner bill (yang bayar)"`. **No status
  check** — a closed bill can be deleted.
- **Response:** `{ ok: true }`
- **Errors:** 403 as above; 404 `"Bill tidak ditemukan"` (missing bill or delete refused).
- **Side effects:** deletes the bill and all its `item`, `selection`, `payment`, `bill_participant`,
  `bill_photo`, `bill_invite` rows, then unlinks every photo file. Irreversible.

### 4.4 `POST /api/bills/{bill_id}/join` — join via share link

- **Caller:** bill deep link, guest name prompt (`bill.js:414`, `526`). Auth required.
- **Request body:** not read (`{}` is fine).
- **Preconditions:** `bill.status == "open"` → else 403 `"Bill sudah ditutup"`; not settled → 409
  `"Bill udah lunas semua. Buka tanda lunas dulu kalau mau ubah."`
- **Response:** `BillResponse` as the joining viewer.

- **Side effects:** inserts a `payment` row (`INSERT OR IGNORE`, so **idempotent** — joining twice is
  200), claims a matching creator-typed participant placeholder (case-insensitive), clears
  `creator_left` if the caller is the creator, and marks the caller's own pending invite for this
  bill as `accepted` (opening the link counts as accepting).
- **Errors:** 403 closed / 409 settled; auth errors.
- **Note:** joining does **not** pick items and does **not** make the person owe anything; it only
  puts them on the roster (a zero-total `people[]` row).

### 4.5 `POST /api/bills/{bill_id}/invite` — direct invite (WA-style)

- **Caller:** invite sheet after bill creation and from bill detail (`create.js:1919`, `bill.js:1150`). Rate limit 20/min.

```ts
interface InviteRequest { identity_id: string }   // ≤ 64; required
```

- **Preconditions / errors (400 unless noted):**
  - not `owner_id` → 403 `"Hanya owner bill (yang bayar)"`
  - `bill.status != "open"` → 403 `"Bill sudah ditutup"`
  - settled → 409 `"Bill udah lunas semua. Buka tanda lunas dulu kalau mau ubah."`
  - missing/empty `identity_id` → 400 `"Identity id wajib diisi"`
  - unknown target → 404 `"Akun tidak ditemukan"`
  - self → 400 `"Tidak dapat mengundang diri sendiri"`
  - already on the bill (creator-not-left or payment row) → 400 `"Orang ini sudah ada di bill"`
  - not a proven contact → 400 `"Hanya orang yang pernah berbagi bill yang dapat diundang"`
  - 429 at 20/min
- **Response — NOT a bill payload:**

```ts
interface InviteResponse { status: "joined" | "pending" }
```

- **Decision table** (order matters):

| Situation | Result |
|---|---|
| Existing invite row is `accepted` | status is corrected against ground truth: re-joins if the person is no longer on the bill; returns `{status:"joined"}` |
| Existing row was `declined` and is being reopened | returns `{status:"pending"}` **even if auto_accept is ON** — a previous "no" always requires an explicit accept |
| Target `auto_accept = 1` (default) | invite marked `accepted`, person joined → `{status:"joined"}` |
| Target `auto_accept = 0` | invite stays `pending` → `{status:"pending"}` |

- **Side effects:** upserts a `bill_invite` row; on `joined` also inserts the target's payment row
  and claims their participant placeholder. **No bill payload is returned — refetch.**

### 4.6 `POST /api/bills/{bill_id}/invites/{invite_id}/accept` — accept a pending invite

- **Caller:** home invite card (`screens.js:228`). Auth required. Rate limit 20/min.
- **Request body:** not read.
- **Preconditions:** bill open (403 `"Bill sudah ditutup"`), not settled (409); the invite must
  exist, belong to this bill **and** to the caller → else 404 `"Undangan tidak ditemukan"`;
  status must be `pending` → else 400 `"Undangan ini sudah diproses"`.
- **Response:** `BillResponse` as the accepter.
- **Side effects:** invite → `accepted`, payment row inserted, participant placeholder claimed.

### 4.7 `POST /api/bills/{bill_id}/invites/{invite_id}/decline` — decline an invite

- **Caller:** home invite card ✕ button (`screens.js:262`). Auth required. Rate limit 20/min.
- **Preconditions:** invite exists, on this bill, for the caller → else 404 `"Undangan tidak ditemukan"`;
  must still be `pending` → else 400 `"Undangan ini sudah diproses"`.
  **No bill-status and no settled check** — you can decline a closed or settled bill's invite.
- **Response:** `{ ok: true }`
- **Side effects:** `status = 'declined'` (row kept; a later re-invite reopens it as `pending`).

### 4.8 `DELETE /api/bills/{bill_id}/invites/{invite_id}` — withdraw a pending invite

- **Caller:** bill detail manager invite list (`bill.js` — pending invites block). Rate limit 20/min.
- **Preconditions:** caller must be `owner_id` → 403 `"Hanya owner bill (yang bayar)"`; the row must
  exist, belong to this bill and still be `pending` → else 404 `"Undangan tidak ditemukan"`.
- **Response:** `BillResponse`.
- **Side effects:** row deleted outright. A later invite starts fresh (no decline-reopen detour).

### 4.9 `DELETE /api/bills/{bill_id}/people/{identity_id}` — remove a person (manager)

- **Caller:** bill detail roster menu (`bill.js:1935`-ish). Auth required.
- **Preconditions:** caller must be `owner_id` → 403 `"Hanya owner bill (yang bayar)"`; bill open →
  403 `"Bill sudah ditutup"`; not settled → 409; cannot target yourself → 400
  `"Tidak dapat menghapus diri sendiri (owner bill)"`.
- **Response:** `BillResponse`.
- **Side effects:** deletes the target's selections, payment row, participant claim and invite rows;
  if they were the assigned payer, the payer block is cleared (owner falls back to the creator).
  If the target is the creator, also sets `creator_left = 1`. Removing a non-member is a silent
  no-op with a 200 — do not rely on this to validate membership.

### 4.10 `POST /api/bills/{bill_id}/leave` — leave a bill (self)

- **Caller:** guest view "Keluar" (`bill.js:1470`-ish). Rate limit 20/min.
- **Preconditions:** bill open → 403 `"Bill sudah ditutup"`; not settled → 409; caller must **not**
  be the owner → 400 `"Owner bill tidak dapat keluar — pindahkan pembayar atau hapus bill"`;
  caller must actually be on the bill → 404 `"Kamu tidak ada di bill ini"`.
- **Response:** `BillResponse`.
- **Side effects:** same removal as §4.9 for the caller (selections, payment row, participant claim,
  invite rows). Creator leaves by setting `creator_left = 1` instead of deleting rows.
- **Gotcha:** the membership test inspects `items[].selections` on the bill snapshot, a key
  `db.get_bill()` does **not** produce (`get_bill` returns a separate `selections` array). In
  practice the "picked anything" half is dead code and membership really means "creator not left
  OR has a payment row". Documented as-is; do not emulate the intent.

### 4.11 `PUT /api/bills/{bill_id}/paid_by` — assign who paid

- **Caller:** "Yang bayar" sheet (`bill.js:1836`, `2082`).
- **Preconditions:** caller must be `owner_id` → 403 `"Hanya owner bill (yang bayar)"`; bill open →
  403 `"Bill sudah ditutup, tidak dapat diubah"`. No settled check.

```ts
interface SetPaidByRequest {
  identity_id?: string | null;  // ≤ 64 — preferred, unambiguous
  name?: string | null;         // ≤ 60 — placeholder for someone who has not joined
}
```

Exactly one branch runs:

| Body | Behaviour |
|---|---|
| `identity_id` present | must exist (404 `"Orang tidak ditemukan"`) and be on the bill — payments roster **or** creator (400 `"Orang itu belum join bill ini"`). `paid_by_identity_id` set, `paid_by_confirmed = 1` → **this person becomes the owner**. `paid_by_name` overwritten with their current name. |
| `name` only | matched case-insensitively against joined payment people, then claimed participants. If matched → `paid_by_identity_id` set but `paid_by_confirmed = 0` (`display only`, no management powers). If unmatched → both fields’ names set, id stays null. |
| neither | `paid_by_identity_id = NULL`, `paid_by_name = NULL` → the **creator** is the payer/owner again. |

- **Response:** `BillResponse` (viewer = caller).
- **Side effects:** writes `paid_by_identity_id`, `paid_by_name`, `paid_by_confirmed`; may clear
  `creator_left` (an owner who is not on their own bill is impossible). If the paid person is the
  creator, `creator_left` is reset.
- **Errors:** also 400 `"Nama maksimal 60 karakter"`, 400 `"Identity id maksimal 64 karakter"`.

### 4.12 `POST /api/bills/{bill_id}/close` — close a bill

- **Caller:** owner menu. Auth required. Precondition: caller is `owner_id` → 403 `"Hanya owner bill (yang bayar)"`.
- **Response:** `{ ok: true }`  ← **not** a bill payload; refetch.
- **Side effects:** `status = 'closed'`, `closed_at = now`. Idempotent (closing twice is 200).
  Closing does **not** settle the bill (§3.1 `settled` stays false unless the money math says otherwise).

### 4.13 `POST /api/bills/{bill_id}/reopen` — reopen a closed bill

- **Caller:** owner menu (`bill.js:1591`). Precondition: caller is `owner_id` → 403; status must be
  `"closed"` → else 400 `"Bill belum ditutup"`.
- **Response:** `BillResponse`.
- **Side effects:** `status = 'open'`, `closed_at = NULL`.

### 4.14 `POST /api/bills/{bill_id}/settle` — mark the whole bill lunas (manual override)

- **Caller:** owner "Tandai Lunas" (`bill.js`). Precondition: caller is `owner_id` → 403.
  No status and no settled precondition — works on **open and closed** bills, idempotent.
- **Response:** `BillResponse`.
- **Side effects:** `settled_manual = 1`. Payment rows are untouched (they can still read `unpaid`).
  This freezes the bill: most mutations then return 409 `"Bill udah lunas semua. Buka tanda lunas dulu kalau mau ubah."`

### 4.15 `POST /api/bills/{bill_id}/unsettle` — clear the manual settle

- **Caller:** owner. Precondition: caller is `owner_id` → 403. No other guards; idempotent.
- **Response:** `BillResponse`.
- **Side effects:** `settled_manual = 0`. Auto-settled math still applies afterwards.

### 4.16 `POST /api/bills/{bill_id}/selections` — set MY picks (full replace)

- **Caller:** guest/creator pick UI (`bill.js:1188`-ish). Auth required.
- **Preconditions:** bill open → 403 `"Bill sudah ditutup"`; not settled → 409.

```ts
interface SetSelectionsRequest {
  picks?: Array<{ item_id: number; qty?: number } | number>;  // preferred form
  item_ids?: number[];   // legacy fallback (qty 1 each) — used only when `picks` is absent or empty
}
// response: BillResponse
```

Parsing rules (all from source, all worth pre-empting in the UI):

- `picks` present and `null` → treated as `[]`.
- `picks` present, non-array → 400 `"Daftar pilihan harus berupa array"`.
- `picks` absent → legacy `item_ids` used; `item_ids` non-array → 400 `"Daftar item harus berupa array"`.
- Each entry may be an object `{item_id, qty}` (qty default 1, range 1..99) **or** a bare number (qty 1).
- Duplicate item ids in one call are **summed**, not replaced (`[{a,2},{a,3}]` → qty 5).
- Any id not belonging to this bill → 400 `"Item tidak valid"`.
- Slot item: `qty > slot_count` → 400 `"Slot <name> hanya berjumlah <n>"`; overbooking against
  other people's qty → 400 `"Slot <name> tersisa <left>"`; the DB re-checks inside a
  `BEGIN IMMEDIATE` transaction and can return 400 `"Slot tersisa <left>"` on a race.
- Free item: `qty > 99` → 400 `"<name> maksimal 99 porsi"`.

**Side effects:** deletes **all** of the caller's selections on this bill, inserts the new set,
`INSERT OR IGNORE`s a payment row (so picking enrols you), and claims a matching participant
placeholder. Sending `[]` clears all picks but **keeps you on the roster**.

### 4.17 `PUT /api/bills/{bill_id}/items/{item_id}/slots` — change an item's slot count

- **Caller:** bill edit sheet slot control (`bill.js:1931`). Auth required.
- **Preconditions:** `owner_id` → 403 `"Hanya owner bill (yang bayar)"`; bill open → 403
  `"Bill sudah ditutup, tidak dapat diubah"`; not settled → 409; item must exist **on this bill** →
  404 `"Item tidak ditemukan"`; item must be `mode == "slot"` → else 400 `"Item ini bukan mode slot"`.

```ts
interface SetSlotsRequest { slot_count: number }   // int ≥ 1, and ≥ slots already taken
// response: BillResponse
```

- **Errors:** 400 `"Jumlah slot tidak valid"` (non-numeric), 400 `"Slot minimal 1"`,
  400 `"Slot minimal <taken> (sudah terisi <taken>)"`.
- **Side effects:** `item.slot_count` updated. Shares of everyone holding slots change immediately.

### 4.18 `DELETE /api/bills/{bill_id}/items/{item_id}/selections/{identity_id}` — release a person's slots

- **Caller:** bill detail slot release button (`bill.js:1949`). Auth required.
- **Preconditions:** bill open → 403 `"Bill sudah ditutup"`; not settled → 409; caller must be that
  identity **or** the owner → else 403 `"Hanya pemilik slot atau pembuat bill yang dapat melepasnya"`;
  item must exist → 404 `"Item tidak ditemukan"`; that person must hold a selection → 404
  `"Orang itu tidak memiliki slot pada item ini"`.
- **Response:** `BillResponse`.
- **Side effects:** deletes that selection row (qty → 0) and re-ensures the person's payment row.
  Their money falls back to the owner / becomes an uncovered slot.

### 4.19 `POST /api/bills/{bill_id}/payments/{identity_id}/paid` — mark someone as paid

- **Caller:** bill detail payment row (`bill.js:1720`-ish). Auth required.
- **Preconditions:** bill open → 403 `"Bill sudah ditutup, tidak dapat mengubah status pembayaran"`;
  caller must be that identity **or** the owner → 403 `"Tidak dapat mengubah status pembayaran orang lain"`;
  target identity must exist → 404 `"Orang tidak dikenal"`; target must be on the bill (creator-not-left,
  payment row, or selection) → 404 `"Orang itu belum join bill ini"`. **No settled check** — marking
  paid is allowed on a manually settled bill.
- **Response:** `BillResponse`.
- **Side effects:** upserts the payment row (`status='paid'`, `paid_at=now`), and claims the caller's
  participant placeholder if any.

### 4.20 `POST /api/bills/{bill_id}/payments/{identity_id}/unpaid` — undo "paid"

- Same preconditions and responses as §4.19, except the member check message is identical
  (`"Orang itu belum join bill ini"`, triggered by either "unknown identity" or "not on bill").
- **Side effects:** `status='unpaid'`, `paid_at=NULL`. This is the intended way to undo an accidental
  settle-driven state; it never touches `settled_manual`.

### 4.21 `POST /api/bills/{bill_id}/photo` — attach a receipt photo

- **Caller:** bill detail add-photo (`bill.js:130`-ish). Rate limit 10/min. Auth required.
- **Request:** `multipart/form-data` with field **`file`** (single).
- **Preconditions:** `owner_id` → 403; bill open → 403 `"Bill sudah ditutup"`.
- **Validation:** MIME must be `image/jpeg|png|webp` → 400
  `"Format foto tidak didukung, pilih JPEG/PNG/WEBP"`; magic bytes must match the declared type →
  400 `"Isi file tidak cocok dengan format foto"`; ≤ 5 MB → 400 `"Foto maksimal 5MB"`.
- **Response:** `BillResponse` (with the new `photos[]` entry).
- **Side effects:** writes `<16-hex><.jpg|.png|.webp>` into the upload dir and inserts a `bill_photo`
  row. The file is unlinked if the DB insert fails. Not a "replace" — photos accumulate.

### 4.22 `DELETE /api/bills/{bill_id}/photos/{photo_id}` — remove one photo

- **Caller:** bill detail photo delete (`bill.js:140`). Auth required.
- **Preconditions:** `owner_id` → 403; bill open → 403 `"Bill sudah ditutup"`; photo must belong to
  **this** bill → else 404 `"Foto tidak ditemukan"`.
- **Response:** `BillResponse`.
- **Side effects:** deletes the `bill_photo` row; unlinks the file unless another bill still
  references the same path.

---

## 5. Photo & OCR endpoints

### 5.1 `POST /api/photos` — upload a photo without scanning

- **Caller:** create flow manual attach (`create.js:282`, `352`). Auth required. Rate limit 10/min.
- **Request:** multipart, field `file` (single). Same MIME/magic-byte/5 MB validation as §4.21.
- **Response:**

```ts
interface UploadPhotoResponse {
  photo_path: string;   // absolute server path, e.g. "/var/www/bagiin-uploads/588a80e6ab9b45f4.jpg"
  filename: string;     // bare "<hex>.jpg" — what DELETE /api/photos/{filename} expects
}
```

- **Errors:** 400 MIME/magic/size as above; auth errors; 429.
- **Side effects:** file written to disk. **No DB row** until it is attached via create/put bill.
  Abandoned uploads must be cleaned up with §5.3.

### 5.2 `POST /api/ocr` — scan 1–2 receipt photos

- **Caller:** create flow (`create.js:446`). Auth required. Rate limit 10/min.
- **Request:** multipart with the key **`file` repeated** (1 or 2 files). One file is still valid
  (backwards compatible with the pre-batch client).
- **Errors (400):** `"Minimal satu foto diperlukan"`, `"Maksimal 2 foto struk dalam satu pembacaan"`,
  `"Foto maksimal 5MB"` (per file), `"Total foto maksimal 10MB"`, `"Format HEIC belum didukung, pilih foto JPEG/PNG"`,
  `"Format foto tidak didukung, pilih JPEG/PNG/WEBP"`, `"Isi file tidak cocok dengan format foto"`.
  **422** for provider failures with one of a fixed set of Indonesian messages (quota, provider busy,
  unreadable result, OCR not configured) — all 422 so Cloudflare cannot replace them with HTML.
  **500** `"Foto hasil pembacaan gagal disimpan"` if the files cannot be written after a successful read.
- **Response (draft only — nothing is persisted to the DB):**

```ts
interface OcrItem { name: string; price: number; discount: number; quantity: number }

interface OcrDraft {
  merchant: string;          // "" when unreadable
  date: string;              // "YYYY-MM-DD" or ""
  items: OcrItem[];
  subtotal: number;
  order_discount: number;
  tax: number;
  service: number;
  total: number;
  tax_included: boolean;
  photos: string[];          // ADDED by the endpoint: absolute paths, 1 or 2 entries, upload order
  photo_path: string;        // ADDED by the endpoint: photos[0] — legacy single-photo field
}
```

- **Side effects:** the uploaded images are written to disk **only after** OCR succeeds. This draft
  is then posted (usually edited) to `POST /api/bills` / `PUT /api/bills/{id}`.
- **Gotcha:** `cashback` is **never** produced by OCR — it is a payment-method rebate the user types.
  The legacy create screen explicitly zeroes it unless the value was set by hand.
- **Gotcha:** OCR `items[]` carry no `mode`/`slot_count`; the client must add `mode:"free"`.

### 5.3 `DELETE /api/photos/{filename}` — release an unattached upload

- **Caller:** create flow when a photo is removed from the draft (`create.js:415`). Auth required
  (any valid identity — the file is not attributed to an uploader).
- **Path param:** the **bare** filename (`<16 hex>.jpg`), not a path.
- **Response:** `{ deleted: true }`
- **Errors:** 404 `"Foto tidak ditemukan"` if the name does not match the generated-name regex;
  409 `"Foto ini masih dipakai di bill"` if any `bill_photo` row (or legacy `bill.photo_path`)
  references it. A file that is already gone returns **200** (goal is "make sure it's gone").
- **Side effects:** unlinks the file when safe. Never touches DB rows.

### 5.4 `GET /uploads/{filename}` — serve an uploaded image

- **Caller:** every `<img>` for `photos[]` / OCR previews. **Auth: none.** Not rate limited.
- **Response:** the image bytes, `Content-Type: image/jpeg|png|webp`,
  `Cache-Control: private, max-age=31536000, immutable`, `X-Content-Type-Options: nosniff`.
- **Errors:** 404 for a missing file, a directory, or an extension other than jpg/png/webp.
- **Client contract:** `BillPhoto.path` is an **absolute server filesystem path**. The URL is
  `/uploads/` + the basename:

```ts
const photoUrl = (p: { path: string }) => "/uploads/" + p.path.split("/").pop();
```

---

## 6. Join / invite flows (what differs)

### 6.1 Share link

Built by the client, not the server (`bill.js:1812`):

```
${location.origin}/#/b/${bill.id}
```

No token, no query string. The bill id **is** the capability. Consequences:

- Anyone with the link can `GET /api/bills/{id}` without an identity (full money split included).
- `POST /join` requires an identity; the guest is prompted for a name, the identity is created,
  then joined.
- The link cannot be revoked short of deleting the bill.

### 6.2 Join by link vs. accept an invite

| | Join by link (`POST /bills/{id}/join`) | Accept invite (`POST /bills/{id}/invites/{invite_id}/accept`) |
|---|---|---|
| Needs the bill id | yes (it's the URL) | yes (from the invite card payload) |
| Needs `invite_id` | no | yes |
| Requires being a proven contact | no | no (the inviter needed contact status) |
| Who can do it | any identity | only the invitee the row belongs to |
| Requires an existing invite row | no | yes, `status='pending'` |
| Side effect on invites | marks **your own** pending invite `accepted` | marks **that** invite `accepted` |
| Same preconditions | open + not settled | open + not settled |
| Returns | `BillResponse` | `BillResponse` |

In short: both end in `db.join_bill`. `join` is the link path and is idempotent; `accept` is the
card path and needs a pending row addressed to you.

### 6.3 Direct invite (no link at all)

Owner invites a **proven contact** by identity id. With `auto_accept` ON the person is on the bill
immediately (`{status:"joined"}`); with it OFF they get a pending card on home
(`GET /api/identities/{id}/invites`). A previous decline forces the pending path even when
`auto_accept` is ON. The invite endpoint returns only `{"status": ...}` — the client must refetch
the bill (`create.js` navigates to the bill route, which fetches; `bill.js` reloads the view).

### 6.4 Payer resolution (affects owner powers)

`db.resolve_payer` returns `(identity_id | null, display_name)`:

1. `paid_by_identity_id` set → `(that id, that identity's current name)`.
2. else `paid_by_name` set → first joined payment person, then claimed participant, whose name
   matches case-insensitively → `(their id, name)`; if nobody matches → `(None, the declared name)`.
3. else → `(creator_id, creator's name)`.

`_owner_id` = `paid_by_identity_id` **only when `paid_by_confirmed = 1`**, else `creator_identity_id`.
Only a payer set via `identity_id` is confirmed. A name match is display-only: it makes that person
appear paid, but never gives them management powers and never lets them delete the bill.

---

## 7. Money rules enforced by the backend

These all run **before** any write. The UI should pre-empt every row, because the messages are
shown verbatim to users.

`subtotal` in the equation is **always server-derived**: `Σ (item.price − item.discount) × item.quantity`.
A client-sent `subtotal` is range-checked and then thrown away.

| # | Rule | Status | Exact `detail` |
|---|---|---|---|
| 1 | Items array must be a non-empty list | 400 | `Minimal 1 item` |
| 2 | Each item must be an object | 400 | `Item harus berupa objek` |
| 3 | Item name required | 400 | `Nama item wajib diisi` |
| 4 | Item name length | 400 | `Nama item maksimal 120 karakter` |
| 5 | Item price is a rupiah integer `0..1e12` | 400 | `Harga <name> wajib angka` / `Harga <name> minimal 0` / `Harga <name> maksimal 1000000000000` |
| 6 | Item discount ≤ item price | 400 | `Diskon <name> tidak boleh lebih besar dari harga` |
| 7 | Item mode enum | 400 | `Mode <name> harus free atau slot` |
| 8 | Slot count ≥ 1 | 400 | `Slot <name> minimal 1` |
| 9 | Item quantity is a **strict integer** 1..99 (no numeric strings, no null) | 400 | `Jumlah <name> harus bilangan bulat` / `Jumlah <name> minimal 1` / `Jumlah <name> maksimal 99` |
| 10 | Effective subtotal cannot overflow 1e12 | 400 | `Subtotal terlalu besar` |
| 11 | `tax_included = true` forbids a tax column | 400 | `Kalau harga item sudah termasuk pajak, kolom Pajak harus 0` |
| 12 | Order discount ≤ subtotal | 400 | `Diskon pesanan tidak boleh lebih besar dari subtotal` |
| 13 | Cashback ≤ (subtotal + tax + service − order_discount) | 400 | `Cashback tidak boleh lebih besar dari total setelah diskon pesanan` |
| 14 | Resulting total must not be negative | 400 | `Total tidak boleh negatif setelah cashback` (when cashback > 0) / `Total tidak boleh negatif setelah diskon pesanan` |
| 15 | **Total must equal the equation** | 400 | `Total tidak sesuai dengan subtotal + pajak + service - diskon pesanan - cashback` (or the 4-term form without `- cashback` when cashback is 0) |
| 16 | All money fields are integers in `0..1e12` | 400 | `<field> wajib angka` / `<field> wajib bilangan bulat` / `<field> minimal 0` / `<field> maksimal 1000000000000` — `<field>` ∈ {`Subtotal`, `Pajak`, `Service`, `Diskon pesanan`, `Cashback`, `Total`, `Jumlah orang`} |
| 17 | Money fields reject booleans | 400 | `<field> wajib angka` |
| 18 | Duplicate item ids in an update | 400 | `Ada item dobel di daftar` |
| 19 | Slot count cannot drop below slots already taken (update / slots endpoint) | 400 | `Slot <name> minimal <taken> (sudah terisi <taken>)` |
| 20 | Slot capacity on picking | 400 | `Slot <name> hanya berjumlah <n>` / `Slot <name> tersisa <left>` / (DB race) `Slot tersisa <left>` |
| 21 | Free-item portions cap | 400 | `<name> maksimal 99 porsi` |
| 22 | `participant_count` range | 400 | `Jumlah orang minimal 0` / `Jumlah orang maksimal 10000` |
| 23 | Participant list must be an array | 400 | `Daftar peserta harus berupa array` |
| 24 | Photo path must be a real, server-generated upload in the upload dir | 400 | `Path foto tidak valid` |
| 25 | Photo MIME / size | 400 | `Format foto tidak didukung, pilih JPEG/PNG/WEBP` / `Isi file tidak cocok dengan format foto` / `Foto maksimal 5MB` |

**The equation, precisely:**

```
post_order      = subtotal + tax + service − order_discount
expected_total  = post_order − cashback
```
with `subtotal = Σ (price − discount) × quantity` over all items, `tax` forced to 0 when
`tax_included` is true, and `total` (client-sent) required to equal `expected_total` exactly.

**Tax modes** (`bill.tax_mode`, read by `calc.compute`, default `"proportional"`):
`"proportional"` (share by net subtotal, rounding remainder to the owner), `"equal"` (split evenly
across people with a positive share, leftover rupiah to the first payers), `"creator"` (the owner
pays all tax + service). Any other string falls through to the proportional branch — `POST /api/bills`
does **not** validate the enum, and `PUT` ignores the field entirely, so a typo is silently
proportional-only for creation and then permanent.

**Freeze rules** (not money, but they gate money edits):

- Settled bill (`settled` true, including manual settle) → **409** `"Bill udah lunas semua. Buka tanda lunas dulu kalau mau ubah."`
  on: PUT bill, join, invite, accept, remove-person, leave, selections, slots, release-selection.
- Closed bill (`status = "closed"`) → **403** on: PUT bill (different message), join, invite, accept,
  remove-person, leave, selections, slots, release-selection, paid, unpaid, photo upload/delete.
- Never frozen: `settle`, `unsettle`, `close`, `reopen`, `delete bill`, `decline invite`,
  `DELETE invite`, `paid_by`.

---

## 8. Gotchas

1. **`sel_by_item` keys are strings.** `item.id` is an int in `items[]`, but the map is keyed by the
   Python int coerced by `json.dumps` → `{"409": [...]}`. Look up `String(item.id)`.
2. **`sel_by_item` omits items nobody picked.** Absent key, not `[]`. Same for `people[]`: rows
   exist only if they were computed, joined, or are the creator.
3. **`photos[].path` is an absolute server path**, not a URL. Serve it as `/uploads/<basename>`
   (§5.4). `bill.photo_path` is a kept-for-rollback legacy column and is `null` on every bill the
   current code creates — never read it.
4. **Two different boolean encodings for the same field.** `bill.paid_by_confirmed`,
   `bill.tax_included`, `bill.creator_left`, `bill.settled_manual` are `0|1` ints; the sibling
   top-level `paid_by_confirmed` / `settled_manual` are real booleans. In `BillListRow`,
   `paid_by_confirmed` is an **int** while `settled` is a boolean. Never use `=== true` on a `0|1`.
5. **`create` returns only `{id}`.** `join`, `PUT`, `settle`, selections, photos etc. return the full
   computed payload; `close`, `decline`, `create`, account endpoints and `code` return `{ok:true}`-style
   objects. `POST /invite` returns `{status}`. Do not assume one shape across mutations.
6. **Money is always integer rupiah.** Never send floats (a non-integral float is rejected as
   `<field> wajib bilangan bulat`), never send formatted strings (`"15.000"` → `wajib angka`).
7. **Item `quantity` is stricter than every other number.** `_item_quantity` accepts only a real
   JSON int; `"2"` or `2.0` → 400. Omitted or `mode`-less is fine, `null` is not.
8. **`discount_idr` is per unit.** Line total = `(price_idr − discount_idr) × quantity`. The order
   discount is a separate checkout-level amount (`bill.order_discount_idr`), and cashback
   (`bill.cashback_idr`) is a third.
9. **Cashback lowers `total_idr`.** Both create validation and `calc` treat it as a rebate spread
   proportionally across people and uncovered slots. A bill with cashback has a smaller total than
   subtotal + tax + service − discount, by exactly the cashback.
10. **`people[].paid` is a string** `"paid"`/`"unpaid"`; the resolved payer is forced to `"paid"`
    even when their payment row says `unpaid`. `settled_manual` never touches those rows, so a
    manually settled bill still lists people as `"unpaid"` — the bill-level `settled` wins in the UI.
11. **`people[]` contains zero-total rows** (joined non-pickers and the creator). Filter on
    `total_idr > 0` before summing, and never treat `people.length` as "number of payers".
12. **Ordering is by `total_idr` desc**, not by join order or name; equal totals keep the pre-sort
    order from `calc.compute` (not alphabetical — do not assume).
13. **`owner_id` ≠ `can_manage`.** `owner_id` is the effective owner (confirmed payer else creator);
    `can_manage` is "owner_id === me" and is `false` for anonymous readers. Gate all mutation UI on
    `can_manage`, never on `owner_id` alone.
14. **`paid_by_id` can be `null` while `paid_by_name` is set** — the declared payer hasn't joined yet.
    The UI must show a "confirm who paid" affordance in that state (`paid_by_confirmed: false`).
15. **`paid_by_accounts` is `[]`** when `paid_by_id` is null (they resolve to no identity).
16. **`GET /api/bills/{id}` never 4xx's on bad auth.** A stale secret just strips management flags.
    Only a missing bill is 404. Do not surface "session expired" from this route.
17. **Identity endpoints are self-only**, and mismatch is a distinct **403** `"Identitas tidak cocok"`
    (not 404). Account endpoints have **no** id check and answer **404** for someone else's row.
    Different statuses for the same class of "not yours" mistake.
18. **`POST /api/identities/{id}/bind` is unauthenticated** and 403s if a secret already exists.
    Call it once, right after loading a cached identity that has no `secret`.
19. **`/restore` and `/identities` return `identity_code_hash`** (a sha256 hex) alongside the
    `secret`. Do not render, log, or persist the hash beyond the identity record you already store.
20. **`bill.status` has exactly two values** (`open`, `closed`). There is no `settled` status value —
    settlement is computed (`settled`, `all_paid`, `settled_manual`). A "Lunas" badge therefore
    needs `settled`, not a status check.
21. **`settled` requires the bill to have started.** A solo bill (only the creator) is never
    auto-settled, even if the creator picked everything and the payer resolved to them. Only
    `settled_manual` can settle a solo bill.
22. **Closed ≠ settled.** `close` freezes edits but leaves money open; the list can legitimately show
    `status:"closed"` with `settled:false` and a positive `total_unpaid`.
23. **Mutations the UI must not batch:** accepting an invite twice returns 400
    `"Undangan ini sudah diproses"`; concurrent slot picks can each succeed then fail on the DB
    re-check. Keep a per-row busy lock (the legacy code has three comments about double-tap bugs).
24. **Timestamps are naive UTC strings with a space separator.** `new Date("2026-10-21 11:36:25")`
    is implementation-dependent in JS (Safari rejects it). Parse manually or replace the space with `T`
    and append `Z` before formatting for users in WIB.
25. **`transacted_at` is a free-form string** (≤ 40 chars), not validated as a date, and it drives the
    home list ordering and its date filters. Send `"YYYY-MM-DD"`; anything else sorts lexicographically.
26. **`PUT /api/bills` silently ignores `tax_mode`,** and treats an absent `merchant`/`transacted_at`/
    `participants`/`participant_count` as "leave unchanged" while an explicit `null` clears them.
    Two different meanings for "not sent".
27. **`PUT /api/bills` deletes any item you omit.** It is a full-list replace with id-based diffing,
    not a patch. A partial items array silently destroys items and their selections.
28. **`POST /join` is idempotent and also clears `creator_left`.** A creator who left can come back
    by opening the link again; nothing distinguishes "rejoin" from "first join" in the response.
29. **`POST /selections` with `[]` removes your picks but keeps your payment row** — you stay on the
    roster with `total_idr: 0` until you leave (§4.10).
30. **`decline` does not check bill status or settlement**, so a decline can succeed on a bill where
    `accept` would 403/409. Mirror that: show the decline action even on closed/settled bills.
31. **`DELETE /api/bills/{id}/people/{id}` is a silent no-op for non-members** (200, unchanged
    payload). Do not use it to test membership.
32. **Photo ids are globally unique**, but every photo endpoint is scoped by `bill_id`; a valid photo
    id from another bill answers 404, not 403.
33. **`GET /api/photos/{filename}` does not exist.** It is `GET /uploads/{filename}` for reads and
    `DELETE /api/photos/{filename}` for cleanup. A React `<img src="/api/photos/...">` will 405.
34. **`POST /api/ocr` writes files even though nothing is persisted.** A cancelled create flow must
    call `DELETE /api/photos/{filename}` for each `photos[]` entry or the upload dir leaks.
35. **Contact list is capped at 50 and filtered before the cap**; invite eligibility uses an uncapped
    query. "Not in contacts" does not mean "cannot invite".
36. **`auto_accept` has no default on the endpoint** — omitting the field is a 400, not "leave as is".
37. **Rate limits are per IP and shared across the whole app**, including `POST /api/bills` at
    10/min. A recap-driven "create many bills" batch will 429; surface it as retryable.
38. **No pagination anywhere.** `GET /identities/{id}/bills` returns every bill (56 rows in the live
    DB for one identity), and recap loads every bill and recomputes the full split for each one. Plan virtualisation, not
    paging — there is no `limit`/`offset` to pass.

---

## 9. Quick reference (method, path, auth, returns)

| Method | Path | Auth | Returns |
|---|---|---|---|
| POST | `/api/identities` | – | `IdentityRow` |
| POST | `/api/identities/restore` | – | `IdentityRow` |
| POST | `/api/identities/{id}/bind` | – | `{id,name,secret}` |
| POST | `/api/identities/{id}/code` | self | `{ok:true}` |
| POST | `/api/identities/{id}/code/generate` | self | `{code}` |
| POST | `/api/identities/{id}/name` | self | `{ok:true}` |
| GET | `/api/identities/{id}/me` | self | `MeResponse` |
| GET | `/api/identities/{id}/accounts` | self | `PaymentAccount[]` |
| POST | `/api/identities/{id}/accounts` | self | `PaymentAccount` |
| PUT | `/api/accounts/{account_id}` | owner | `PaymentAccount` |
| DELETE | `/api/accounts/{account_id}` | owner | `{ok:true}` |
| GET | `/api/identities/{id}/contacts` | self | `Contact[]` |
| POST | `/api/identities/{id}/auto_accept` | self | `{ok:true}` |
| GET | `/api/identities/{id}/bills` | self | `BillListRow[]` |
| GET | `/api/identities/{id}/recap` | self | `RecapResponse` |
| GET | `/api/identities/{id}/invites` | self | `PendingInviteRow[]` |
| POST | `/api/bills` | any | `{id}` |
| GET | `/api/bills/{bill_id}` | optional | `BillResponse` |
| PUT | `/api/bills/{bill_id}` | owner | `BillResponse` |
| DELETE | `/api/bills/{bill_id}` | owner | `{ok:true}` |
| POST | `/api/bills/{bill_id}/join` | any | `BillResponse` |
| POST | `/api/bills/{bill_id}/invite` | owner | `{status}` |
| POST | `/api/bills/{bill_id}/invites/{invite_id}/accept` | invitee | `BillResponse` |
| POST | `/api/bills/{bill_id}/invites/{invite_id}/decline` | invitee | `{ok:true}` |
| DELETE | `/api/bills/{bill_id}/invites/{invite_id}` | owner | `BillResponse` |
| DELETE | `/api/bills/{bill_id}/people/{identity_id}` | owner | `BillResponse` |
| POST | `/api/bills/{bill_id}/leave` | member | `BillResponse` |
| PUT | `/api/bills/{bill_id}/paid_by` | owner | `BillResponse` |
| POST | `/api/bills/{bill_id}/close` | owner | `{ok:true}` |
| POST | `/api/bills/{bill_id}/reopen` | owner | `BillResponse` |
| POST | `/api/bills/{bill_id}/settle` | owner | `BillResponse` |
| POST | `/api/bills/{bill_id}/unsettle` | owner | `BillResponse` |
| POST | `/api/bills/{bill_id}/selections` | any | `BillResponse` |
| PUT | `/api/bills/{bill_id}/items/{item_id}/slots` | owner | `BillResponse` |
| DELETE | `/api/bills/{bill_id}/items/{item_id}/selections/{identity_id}` | self/owner | `BillResponse` |
| POST | `/api/bills/{bill_id}/payments/{identity_id}/paid` | self/owner | `BillResponse` |
| POST | `/api/bills/{bill_id}/payments/{identity_id}/unpaid` | self/owner | `BillResponse` |
| POST | `/api/bills/{bill_id}/photo` | owner | `BillResponse` |
| DELETE | `/api/bills/{bill_id}/photos/{photo_id}` | owner | `BillResponse` |
| POST | `/api/photos` | any | `{photo_path,filename}` |
| DELETE | `/api/photos/{filename}` | any | `{deleted:true}` |
| GET | `/uploads/{filename}` | – | image bytes |
| POST | `/api/ocr` | any | `OcrDraft` |

"self" = authenticated identity must equal the id in the path (403 `"Identitas tidak cocok"` otherwise).
"owner" = must equal `owner_id` (403 `"Hanya owner bill (yang bayar)"`).
"any" = any valid identity, no path id.
