# Bagiin 🤝

Bagi bill bareng jadi gak ribet. Split bills with friends — no accounts, no payment
gateway, just a link.

**Versi 1.0** · **Live:** https://bagiin.ardhiqi.com

Sejak 2 Nov 2026 hanya ada **satu** aplikasi, **satu** folder, **satu** DB, dan
**satu** nama versi: versi 1. Tidak ada lagi jalur "React" terpisah — React
adalah cara aplikasi ini dibangun, bukan nama rilis. Versi vanilla (0.9) hanya
tinggal di riwayat git. Domain lama sudah dihapus, bukan dialihkan.

## Struktur

```
/opt/projects/bagiin          # satu-satunya checkout, branch main (versi 1)
├── backend/                  # FastAPI + SQLite (venv lokal di backend/venv)
├── frontend/                 # React 19 + TypeScript + Vite
├── scripts/                  # deploy, rollback, salinan konfigurasi nginx
├── docs/                     # semua dokumen: produk, spec, desain, API, uji, runbook
└── README.md + AGENTS.md + CLAUDE.md   # pintu masuk & aturan kerja agen

/var/www/bagiin               # hasil build (dilayani nginx)
/var/www/bagiin-uploads       # foto struk produksi
/var/lib/bagiin/bagiin.db     # DB produksi (di luar repo, sengaja)
/var/lib/bagiin-dev/          # DB + uploads instance uji e2e
```

Layanan: `bagiin-api.service` (produksi, 8096) dan `bagiin-dev.service`
(uji e2e, 8090). Detail, cara deploy, dan cara membatalkan deploy ada di
`docs/RUNBOOK-V1.md`.

## Dokumen

Semua ada di `docs/`, daftarnya di `docs/README.md`. Yang paling sering dibuka:

- `docs/PRODUCT.md` — aturan produk dan bisnis; kalau berbeda dengan kode, ini menang.
- `docs/DESIGN_SYSTEM.md` — arah visual, token, dan aturan tata letak.
- `docs/API_CONTRACT.md` — bentuk endpoint yang sebenarnya.
- `docs/RUNBOOK-V1.md` — topologi, deploy, rollback, keadaan darurat.
- `docs/TEST-MATRIX.md` — kasus uji kotak hitam dan hasil putaran terakhir.

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

- 📷 **Receipt OCR** — item, harga, merchant, tanggal; beberapa penyedia dengan cadangan
- 🔗 **Link sharing, no accounts** — identity is just a name on the device
- 🔑 **Akun berlapis** — kode pemulihan, username/password, atau Google; pindah HP tanpa kehilangan bill
- ✏️ **Edit bills** while open — item diff preserves existing selections
- 🖐️ **Creator can pick items too** (not just guests)
- 🏦 **Payment profiles** — bank/e-wallet dengan chip merek dan tombol salin
- 🧮 **Fair split math** — shared items divided evenly, proportional tax, rupiah
  rounding invariants covered by tests
- 📱 **Mobile-first**, terang/gelap, PWA (manifest, ikon, layar penuh)

## Tech stack

| Layer | Choice |
|---|---|
| Backend | FastAPI + SQLite (stdlib `sqlite3`) |
| Frontend | React 19 + TypeScript + Vite, design system Seimbang/Saldo |
| OCR | penyedia visi berantai (Gemini/OpenRouter) dengan batas ukuran gambar |
| Deploy | nginx + Let's Encrypt, Cloudflare DNS, systemd |
| Tests | pytest (422 kasus backend) + Playwright (253 kasus e2e) |

## Development

```bash
cd backend
python3 -m venv venv && ./venv/bin/pip install -r requirements.txt -r requirements-dev.txt
./venv/bin/python -m pytest -q          # 422 kasus

cd ../frontend
npm install
npm run dev                             # http://localhost:5199, /api -> 8090
npx playwright test                     # e2e, butuh bagiin-dev.service hidup
```

Instance uji memakai DB sendiri (`/var/lib/bagiin-dev/bagiin.db`), jadi
menjalankan e2e tidak menyentuh data produksi.

## Deploy

```bash
bash scripts/deploy-web.sh     # build, salin, restart API, lalu buktikan lewat HTTP
bash scripts/rollback-web.sh   # kembalikan tampilan ke build sebelumnya
```

Skrip deploy menyimpan salinan build dan DB sebelum menimpa apa pun; tanpa
salinan itu rollback cuma jadi niat. Penjelasan lengkap: `docs/RUNBOOK-V1.md`.

## License

MIT © 2026 Aufa Fauqi Ardhiqi
