# Frontend stack — Bagiin

Status: usulan, belum dieksekusi. Target: branch `react`.

## Kondisi sekarang

| Hal | Sekarang |
|---|---|
| Build | Vite 7 + React 19 + TS 5.9 (`tsc -b`) |
| Styling | CSS tulisan tangan, ~1000 baris token + komponen, tanpa framework |
| Ikon | `@phosphor-icons/react` + 4 ikon nav yang ditulis sendiri |
| Router | tidak ada — satu layar, state di `main.tsx` |
| Data | tidak ada — `model.ts` ngitung sendiri, total hardcode |
| Test | tidak ada |
| Backend | FastAPI, 43 endpoint, `GET /openapi.json` tersedia |

Yang perlu diputuskan bukan "framework apa yang hype", tapi: bagaimana 43 endpoint
FastAPI itu masuk ke React tanpa drift, dan bagaimana layar yang sudah didesain
tetap utuh.

## Keputusan

| # | Pilih | Alasan | Yang ditolak |
|---|---|---|---|
| 1 | **Vite + React 19 + TS strict** (tetap) | Sudah jalan, build 5 detik, tidak butuh SSR | Next.js — backend sudah FastAPI terpisah, SSR cuma nambah deployment tanpa manfaat |
| 2 | **Tailwind v4** via `@tailwindcss/vite`, CSS-first `@theme` | Token yang sudah ada jadi sumber tunggal; Tailwind dipakai untuk layout, bukan mendikte warna | Tailwind v3 (`tailwind.config.js` terpisah dari token), CSS-in-JS (runtime cost, token jadi tak terlihat) |
| 3 | **shadcn/ui** untuk primitive aksesibilitas saja | Sheet/Dialog/Popover butuh focus trap, escape, scroll lock, aria — sekarang di-hand-roll dan rawan. shadcn = kode di repo, bukan dependency, jadi bisa di-restyle total ke token kita | MUI/Chakra (bawa bahasa visual sendiri, tabrakan), Radix mentah tanpa lapisan gaya (lebih banyak kerja) |
| 4 | **TanStack Router** | Param terketik (`/b/$billId`, `/join/$token`), search param divalidasi zod, loader jadi first-class — cocok untuk app share-link yang route-nya banyak | React Router v7 (lebih matang, tapi type safety param lebih lemah; framework mode-nya untuk SSR yang tidak kita pakai) |
| 5 | **TanStack Query v5** | Server state = cache, retry, refetch on focus, optimistic update. Tap item harus kerasa instan tanpa nunggu round-trip | Redux Toolkit (boilerplate untuk masalah yang bukan state global), Zustand untuk data server |
| 6 | **openapi-typescript + openapi-fetch** | 43 endpoint FastAPI → `types/api.d.ts` digenerate dari `/openapi.json`. Frontend tidak bisa drift dari backend. 6 KB, tanpa runtime | Tulis tipe manual (pasti basi), axios (tidak tiped dari schema) |
| 7 | **zod** di boundary + **react-hook-form** untuk form | Response divalidasi saat masuk; form input manual bill punya baris dinamis, RHF yang paling hemat re-render | Validasi manual if-else, Formik |
| 8 | **Vitest + RTL + MSW**, **Playwright** untuk flow uang | Logic uang harus diuji properti, bukan sample. Playwright di viewport 390px untuk flow share → tap → lunas | Jest (lebih lambat, config ESM ribet), Cypress |
| 9 | **ESLint flat config + Prettier + `tsc --noEmit`** di CI | Satu gate, bukan tiga opini | Biome (bagus, tapi ekosistem plugin React/a11y masih lebih sempit) |

## Yang paling penting: uang

Ini bukan soal framework. Ini satu keputusan yang lebih mahal dari semua di atas.

```ts
// jumlah uang selalu integer rupiah, tidak pernah float
export type Rupiah = number & { readonly __brand: 'Rupiah' }

export const rp = (n: number): Rupiah => n as Rupiah
export const add = (a: Rupiah, b: Rupiah): Rupiah => rp(a + b)
// pembagian SELALU lewat helper, tidak pernah `a / b` di komponen
```

Aturan:

1. **Tidak ada `number` telanjang** untuk uang. Type `Rupiah` memaksa semua tempat lewat helper.
2. **Pembagian pajak/service tidak boleh ditulis ulang di frontend.** Backend `calc.py` adalah sumber kebenaran; frontend menampilkan angka yang dikirim, tidak menghitung.
3. **Setiap helper pembagian diuji properti** (`fast-check`): untuk 10.000 kombinasi acak, `sum(parts) + uncovered + remaining === total` dan tidak ada `NaN`.
4. **Format hanya lewat satu fungsi** `formatRp()` pakai `Intl.NumberFormat('id-ID')`. Tidak ada `.toLocaleString()` liar di komponen.

Invariant yang harus dijaga UI, bukan cuma backend:

```
sum(totals) + uncovered + remaining === total_idr
```

Kalau frontend menampilkan angka yang melanggar ini, itu bug UI, bukan bug data.

## Token: satu sumber, dua konsumen

`src/styles/tokens.css` jadi satu-satunya tempat warna/radius/spacing didefinisikan.

```css
/* tokens.css — sumber tunggal */
:root {
  --ds-navy: #142f3a;
  --ds-teal: #087665;
  --ds-mint: #e2f5ef;
  --ds-bg: #f2f6f6;
  --ds-surface: #ffffff;
  --ds-muted: #536d78;
  --ds-border: #dce7e7;
  --ds-radius-card: 20px;
}

/* tailwind.css */
@import 'tailwindcss';
@import './tokens.css';

@theme {
  --color-navy: var(--ds-navy);
  --color-teal: var(--ds-teal);
  --color-mint: var(--ds-mint);
  --radius-card: var(--ds-radius-card);
}
```

Konsekuensi: `bg-navy` di Tailwind dan `var(--ds-navy)` di CSS menghasilkan warna
yang sama persis. Tidak ada dua daftar warna yang bisa berbeda diam-diam.

Aturan tegas: **warna mentah hanya boleh muncul di `tokens.css`.** Komponen pakai
`bg-surface`, `text-muted`, `border-border`. Kalau ada `#087665` di dalam komponen,
itu yang bikin desain melenceng perlahan.

## Struktur folder

```
src/
  routes/            # TanStack Router, file-based
    __root.tsx
    index.tsx        # beranda
    bills.$billId.tsx
    join.$token.tsx
    recap.tsx
  features/
    bill/            # komponen + hook khusus bill
    split/           # tap item, assignment
    recap/
  ds/                # design system: primitives, icons, tokens
  lib/
    api.ts           # openapi-fetch client + query wrapper
    money.ts         # Rupiah, formatRp, split helpers
    identity.ts      # guest id + secret di localStorage
  types/
    api.d.ts         # DIGENERATE, jangan diedit
  styles/
    tokens.css
    tailwind.css
```

Aturan yang bikin konsisten:

- `routes/` boleh impor `features/` dan `ds/`. `features/` tidak boleh impor `routes/`.
- `ds/` tidak tahu apa-apa soal bill atau uang. Kalau butuh, itu bukan primitive.
- `lib/api.ts` satu-satunya yang boleh `fetch`. Komponen memanggil hook.

## Setup, urutannya penting

```bash
# 1. Tailwind v4 + Vite plugin
npm i -D tailwindcss @tailwindcss/vite
npm i clsx tailwind-merge

# 2. Router + Query
npm i @tanstack/react-router @tanstack/react-query
npm i -D @tanstack/router-plugin @tanstack/react-query-devtools

# 3. API bertipe dari FastAPI
npm i -D openapi-typescript
npm i openapi-fetch
npm run api:types   # openapi-typescript http://localhost:8100/openapi.json -o src/types/api.d.ts

# 4. Form + validasi
npm i zod react-hook-form @hookform/resolvers

# 5. Primitive aksesibel (kode masuk ke repo)
npx shadcn@latest init
npx shadcn@latest add sheet dialog tabs sonner popover switch

# 6. Test
npm i -D vitest @vitest/coverage-v8 @testing-library/react @testing-library/user-event \
         jsdom msw fast-check @playwright/test
```

`api:types` dijalankan di CI dan **gagal kalau `src/types/api.d.ts` beda** dengan
hasil generate. Itu yang mencegah backend dan frontend berpisah diam-diam.

### Sudah dibuktikan, bukan diasumsikan

Dijalankan terhadap backend yang hidup di `127.0.0.1:8082`:

```
npx openapi-typescript http://127.0.0.1:8082/openapi.json -o /tmp/api.d.ts
→ 215 ms, 66 KB, 2294 baris, 38 path, 143 schema
```

Artinya tipe untuk seluruh 43 deklarasi route (38 path unik) tersedia dalam
seperlima detik, tanpa menulis satu baris manual. Kalau backend berubah, tipe
berubah, dan `tsc` yang memberi tahu — bukan tester di hari rilis.

## Rencana eksekusi

### P0 — Fondasi, nol perubahan visual (½ hari)

- `tokens.css` + `tailwind.css` + alias `@/*` + TS strict
- ESLint flat + Prettier + `npm run check` (tsc + eslint + prettier --check)
- CI: `npm run check` + `npm run build`

**Selesai kalau:** `?view=system` render identik (screenshot sebelum/sesudah sama),
`npm run check` hijau, bundle tidak naik lebih dari 5 KB.

### P1 — Router + data nyata (1–2 hari)

- TanStack Router dengan 4 route; `?view=system` pindah ke `/design`
- `api.ts` dari OpenAPI, TanStack Query, MSW mock untuk dev tanpa backend
- ganti `model.ts` hardcode dengan data dari API

**Selesai kalau:** buka `/b/<id>` langsung (deep link) tidak blank, refresh aman,
dan dev bisa jalan tanpa backend hidup (MSW).

### P2 — Interaksi (2–3 hari)

- Sheet/Dialog → Radix lewat shadcn, hapus implementasi scroll-lock sendiri
- Form bill → RHF + zod; input rupiah tanpa `parseInt`
- Tap item → optimistic update, rollback kalau gagal, dengan indikator

**Selesai kalau:** tap item terasa instan (< 16ms), gagal jaringan mengembalikan
state dengan pesan yang benar, dan fokus keyboard tidak keluar dari sheet.

### P3 — Bukti (1–2 hari)

- Playwright: buat bill → share → tap → tandai lunas, di 390×844
- fast-check untuk semua helper pembagian
- axe-core di 3 layar utama

**Selesai kalau:** flow uang end-to-end hijau di CI, dan tidak ada pelanggaran axe
level serious.

## Yang sengaja tidak dipakai

| Jangan | Kenapa |
|---|---|
| Next.js | Tidak ada SSR/SEO yang dibutuh; backend FastAPI terpisah. Menambah server kedua tanpa manfaat |
| Redux / Redux Toolkit | Tidak ada state global yang rumit; server state sudah diurus Query |
| Zustand untuk data server | Dua sumber cache = bug sinkronisasi |
| MUI / Chakra / Ant | Bawa bahasa visual sendiri, tabrakan dengan design system yang sudah jadi |
| CSS-in-JS (styled-components, emotion) | Runtime cost di HP murah, dan token jadi tak terlihat oleh Tailwind |
| axios | `openapi-fetch` sudah tiped dari schema dan lebih kecil |
| moment.js | `Intl` sudah cukup, dan moment sudah deprecated |

## Satu risiko yang harus disebut

Tailwind dan CSS tulisan tangan bisa hidup bersama, tapi **bisa juga jadi dua
sistem yang bertengkar**. Yang mencegahnya cuma satu aturan: warna dan radius
hanya dari token, dan tidak ada nilai heksadesimal di komponen. Kalau aturan itu
dilanggar sekali, dalam sebulan akan ada dua palet.

Kalau nanti terasa merepotkan, alternatif jujurnya: buang Tailwind, tetap CSS
tulisan tangan + CSS Modules. Yang tidak boleh dibuang: `tokens.css` sebagai
sumber tunggal, API bertipe dari OpenAPI, dan test properti untuk uang.
