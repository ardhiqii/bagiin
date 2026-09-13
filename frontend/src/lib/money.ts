const IDR_FORMAT = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });

/** Format a server-owned integer amount for labels and totals. */
export function rupiahFmt(value: number | string | null | undefined): string {
  const parsed = rupiahParse(value);
  return `Rp ${IDR_FORMAT.format(parsed ?? 0)}`;
}

/**
 * Parse the dot-grouped display value used by money inputs.
 *
 * This deliberately accepts only integer rupiah with optional `Rp` and
 * Indonesian grouping separators. Keeping this conversion at one boundary
 * prevents `parseInt("12.500")` from silently turning a displayed amount into
 * 12.
 */
export function rupiahParse(value: string | number | null | undefined): number | null {
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0 ? value : null;
  const text = String(value ?? "").trim();
  if (!text) return 0;
  const withoutPrefix = text.replace(/^Rp\s*/i, "");
  if (!/^\d[\d.\s]*$/.test(withoutPrefix)) return null;
  const digits = withoutPrefix.replace(/[.\s]/g, "");
  if (!digits) return null;
  const result = Number(digits);
  return Number.isSafeInteger(result) && result >= 0 ? result : null;
}

/** Value for an editable input. It has no `Rp` prefix, but keeps dot groups. */
export function inputMoney(value: number | null | undefined): string {
  if (value == null) return "";
  const parsed = rupiahParse(value);
  return parsed == null ? "" : IDR_FORMAT.format(parsed);
}

/** Alias that makes the display-vs-payload boundary explicit at call sites. */
export const formatRupiahInput = inputMoney;

/**
 * Bind a plain input to the same safe formatter used by React money fields.
 * Returns an unsubscribe function so legacy-compatible DOM callers can clean
 * up on route changes without leaking listeners.
 */
export function bindRupiahInput(
  input: HTMLInputElement,
  onValue: (value: number | null) => void,
): () => void {
  const onInput = () => {
    const parsed = rupiahParse(input.value);
    if (parsed == null) {
      onValue(null);
      return;
    }
    const previousLength = input.value.length;
    const cursor = input.selectionStart ?? previousLength;
    input.value = inputMoney(parsed);
    const delta = input.value.length - previousLength;
    const nextCursor = Math.max(0, Math.min(input.value.length, cursor + delta));
    try {
      input.setSelectionRange(nextCursor, nextCursor);
    } catch {
      // Some input types/browsers do not expose a text selection range.
    }
    onValue(parsed);
  };
  input.addEventListener("input", onInput);
  return () => input.removeEventListener("input", onInput);
}

export function shortDate(value?: string | null): string {
  if (!value) return "";
  try {
    const text = String(value).trim();
    const date = /^\d{4}-\d{2}-\d{2}$/.test(text)
      ? new Date(`${text}T12:00:00`)
      : new Date(`${text.replace(" ", "T")}Z`);
    if (Number.isNaN(date.getTime())) return text;
    return date.toLocaleDateString("id-ID", { day: "numeric", month: "short" });
  } catch {
    return String(value);
  }
}

export function localYearMonth(value?: string | null): { y: string; m: string } | null {
  if (!value) return null;
  const text = String(value).trim();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(text)
    ? new Date(`${text}T12:00:00`)
    : new Date(`${text.replace(" ", "T")}Z`);
  if (Number.isNaN(date.getTime())) return null;
  return { y: String(date.getFullYear()), m: String(date.getMonth() + 1).padStart(2, "0") };
}

export function monthLabel(value?: string | null): string {
  if (!value) return "";
  const ym = localYearMonth(value);
  if (!ym) return "";
  return new Date(Number(ym.y), Number(ym.m) - 1, 1).toLocaleDateString("id-ID", { month: "long", year: "numeric" });
}
