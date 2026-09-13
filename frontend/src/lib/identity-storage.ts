import type { Identity } from "./types";

export const STORAGE_KEYS = {
  identity: "bagiin_identity",
  name: "bagiin_name",
  listSort: "bagiin_list_sort",
  recapAliases: "bagiin_recap_aliases",
} as const;

function read<T>(key: string, fallback: T): T {
  try {
    const value = window.localStorage.getItem(key);
    return value === null ? fallback : (JSON.parse(value) as T);
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private browsing is a supported degraded mode.
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function getStoredIdentity(): Identity | null {
  const value = read<unknown>(STORAGE_KEYS.identity, null);
  if (!isRecord(value) || typeof value.id !== "string" || !value.id.trim() || typeof value.name !== "string" || !value.name.trim()) return null;
  const identity: Identity = { id: value.id.trim(), name: value.name.trim() };
  if (typeof value.secret === "string" && value.secret.length <= 256) identity.secret = value.secret;
  if (typeof value.has_code === "boolean") identity.has_code = value.has_code;
  if (typeof value.auto_accept === "boolean") identity.auto_accept = value.auto_accept;
  return identity;
}

export function setStoredIdentity(identity: Identity | null): void {
  if (!identity) {
    try { window.localStorage.removeItem(STORAGE_KEYS.identity); } catch { /* noop */ }
    return;
  }
  write(STORAGE_KEYS.identity, {
    id: identity.id,
    name: identity.name,
    ...(typeof identity.secret === "string" && identity.secret ? { secret: identity.secret } : {}),
    ...(typeof identity.has_code === "boolean" ? { has_code: identity.has_code } : {}),
    ...(typeof identity.auto_accept === "boolean" ? { auto_accept: identity.auto_accept } : {}),
  });
}

export function getStoredName(): string {
  const value = read<unknown>(STORAGE_KEYS.name, "");
  return typeof value === "string" ? value.slice(0, 60) : "";
}

export function setStoredName(name: string): void { write(STORAGE_KEYS.name, name.slice(0, 60)); }
export function getListSort<T>(fallback: T): T { return read<T>(STORAGE_KEYS.listSort, fallback); }
export function setListSort<T>(value: T): void { write(STORAGE_KEYS.listSort, value); }

export function getAliases(): Record<string, string> {
  return safeAliases(read<unknown>(STORAGE_KEYS.recapAliases, {}));
}

export function setAliases(value: Record<string, string>): void {
  write(STORAGE_KEYS.recapAliases, safeAliases(value));
}

function safeAliases(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.entries(value).reduce<Record<string, string>>((safe, [key, alias]) => {
    const cleanAlias = typeof alias === "string" ? alias.trim().slice(0, 40) : "";
    if (key.trim() && key.length <= 128 && cleanAlias) safe[key] = cleanAlias;
    return safe;
  }, {});
}