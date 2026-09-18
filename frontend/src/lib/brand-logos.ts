/**
 * Payment brand logos.
 *
 * Ported from the legacy `brandLogoHtml` / `brandChipHtml` / `brandInfo` trio in
 * frontend/static/{app.js,screens.js}. The React port dropped this entirely and
 * rendered a generic wallet glyph for every method, so GoPay, OVO and a plain
 * bank all looked identical.
 *
 * Design notes carried over from legacy on purpose:
 *  - The manifest is fetched once at runtime from /static/assets/brands/manifest.json
 *    and cached in localStorage, so the first paint after a reload does not wait
 *    on the network.
 *  - An unknown brand still renders a coloured chip with its name, and a logo
 *    that fails to load falls back to that same chip, so a row never ends up
 *    with an empty box where a logo should be.
 *  - Brand names are matched case-insensitively: accounts saved by an older
 *    build or by the paste parser carry values like "bca".
 */

export type BrandLogo = { code: string; file: string };

export const BRAND_LOGOS_STORAGE_KEY = "bagiin_brand_logos";

/** Canonical brand names plus the chip colour used when no logo exists. Ported
 *  verbatim from the legacy BRANDS list so a logo and its chip never disagree. */
const BRANDS: ReadonlyArray<{ code: string; hex: string }> = [
  { code: "BCA", hex: "#0060AF" }, { code: "BNI", hex: "#F15A23" }, { code: "BRI", hex: "#00529C" },
  { code: "Mandiri", hex: "#003A70" }, { code: "BTN", hex: "#0069AB" }, { code: "CIMB", hex: "#790008" },
  { code: "Permata", hex: "#007592" }, { code: "BSI", hex: "#00A39D" }, { code: "Danamon", hex: "#046148" },
  { code: "Maybank", hex: "#231F20" }, { code: "Panin", hex: "#007DC5" }, { code: "Mega", hex: "#FFCA08" },
  { code: "OCBC", hex: "#D10A10" }, { code: "BTPN", hex: "#EF7D00" }, { code: "UOB", hex: "#F5333F" },
  { code: "Jatim", hex: "#E5252A" }, { code: "DKI", hex: "#E62129" }, { code: "BJB", hex: "#1B517E" },
  { code: "Sinarmas", hex: "#ED1D24" }, { code: "Jago", hex: "#FDAF27" }, { code: "Jenius", hex: "#00A4DE" },
  { code: "SeaBank", hex: "#EA5F00" }, { code: "BNC", hex: "#FFBE00" }, { code: "Superbank", hex: "#AFEE01" },
  { code: "Allo", hex: "#FFBC25" }, { code: "Blu", hex: "#33CDCF" }, { code: "Krom", hex: "#6936D3" },
  { code: "LINE", hex: "#00D200" }, { code: "GoPay", hex: "#00AED6" }, { code: "OVO", hex: "#5827D4" },
  { code: "DANA", hex: "#008CEB" }, { code: "ShopeePay", hex: "#E8451E" }, { code: "LinkAja", hex: "#E82529" },
  { code: "Lainnya", hex: "#6B6259" },
];

export function brandList(): ReadonlyArray<{ code: string; hex: string }> { return BRANDS; }

function brandInfo(code: string): { code: string; hex: string } | null {
  const key = String(code || "").toLowerCase();
  return BRANDS.find(brand => brand.code.toLowerCase() === key) || null;
}

/** Display name for a stored brand: canonical casing when known ("bca" -> "BCA",
 *  "gopay" -> "GoPay"), the raw value otherwise. */
export function brandLabel(code: string): string {
  const brand = brandInfo(code);
  return brand ? brand.code : String(code || "");
}

export function brandColor(code: string): string {
  const brand = brandInfo(code);
  return brand ? brand.hex : "#6B6259";
}

/** Readable ink for a chip background: light fills get dark text. */
export function chipTextColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) > 165 ? "#18181B" : "#fff";
}

let cachedLogos: Record<string, string> | null = null;

function readStoredLogos(): Record<string, string> | null {
  try {
    const raw = window.localStorage.getItem(BRAND_LOGOS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed as Record<string, string> : null;
  } catch { return null; }
}

export function brandLogoMap(): Record<string, string> | null {
  return cachedLogos || readStoredLogos();
}

/** Load the manifest once. Resolves to the code -> filename map. */
export async function loadBrandLogos(): Promise<Record<string, string> | null> {
  if (cachedLogos) return cachedLogos;
  const stored = readStoredLogos();
  if (stored) cachedLogos = stored;
  try {
    const response = await fetch("/static/assets/brands/manifest.json");
    if (!response.ok) return cachedLogos;
    const manifest = await response.json();
    if (manifest && Array.isArray(manifest.logos)) {
      cachedLogos = Object.fromEntries(
        manifest.logos.map((logo: BrandLogo) => [logo.code, logo.file]),
      );
      try { window.localStorage.setItem(BRAND_LOGOS_STORAGE_KEY, JSON.stringify(cachedLogos)); } catch { /* private mode */ }
    }
  } catch { /* stay on the cached copy, chips still render */ }
  return cachedLogos;
}

/** Filename for a brand code, matched case-insensitively like legacy did. */
export function brandLogoFile(code: string): string | null {
  const map = brandLogoMap();
  if (!map) return null;
  if (Object.prototype.hasOwnProperty.call(map, code)) return map[code];
  const normalized = String(code == null ? "" : code).trim().toLowerCase();
  if (!normalized) return null;
  const key = Object.keys(map).find(candidate => String(candidate).trim().toLowerCase() === normalized);
  return key ? map[key] || null : null;
}

export function brandLogoUrl(code: string): string | null {
  const file = brandLogoFile(code);
  return file ? `/static/assets/brands/${file}` : null;
}
