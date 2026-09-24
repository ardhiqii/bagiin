export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = Exclude<ThemePreference, "system">;

export const THEME_STORAGE_KEY = "bagiin_theme";

function storageOrNull(storage?: Storage | null): Storage | null {
  if (storage !== undefined) return storage;
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

export function getStoredTheme(storage?: Storage | null): ThemePreference {
  const value = storageOrNull(storage)?.getItem(THEME_STORAGE_KEY);
  return isThemePreference(value) ? value : "system";
}

export function setStoredTheme(preference: ThemePreference, storage?: Storage | null): void {
  storageOrNull(storage)?.setItem(THEME_STORAGE_KEY, preference);
}

export function resolveTheme(preference: ThemePreference, systemDark: boolean): ResolvedTheme {
  return preference === "system" ? (systemDark ? "dark" : "light") : preference;
}

type ThemeDocument = Pick<Document, "documentElement">;
type MediaQuery = {
  matches: boolean;
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
};

export function applyTheme(
  preference: ThemePreference,
  documentRef: ThemeDocument = document,
  matchMedia: (query: string) => MediaQuery = query => window.matchMedia(query),
): () => void {
  const media = matchMedia("(prefers-color-scheme: dark)");
  const sync = () => {
    const resolved = resolveTheme(preference, media.matches);
    documentRef.documentElement.dataset.theme = resolved;
    documentRef.documentElement.dataset.themePreference = preference;
  };
  sync();
  if (preference === "system") media.addEventListener("change", sync);
  return () => media.removeEventListener("change", sync);
}
