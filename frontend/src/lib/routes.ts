export type Route =
  | { kind: "home" }
  | { kind: "settings" }
  | { kind: "recap" }
  | { kind: "create" }
  | { kind: "verify" }
  | { kind: "bill"; billId: string }
  | { kind: "unknown" };

export type ParsedHash = {
  parts: string[];
  route: Route;
  valid: boolean;
};

function decodePart(value: string): string | null {
  try {
    const decoded = decodeURIComponent(value);
    return decoded ? decoded : null;
  } catch {
    // A malformed public hash must not make the router throw during startup.
    return null;
  }
}

export function parseHash(hash = typeof window === "undefined" ? "#/" : window.location.hash): ParsedHash {
  const raw = String(hash || "").replace(/^#\/?/, "");
  const rawParts = raw ? raw.split("/") : [];
  const parts = rawParts.map(decodePart);
  if (parts.some(part => part === null)) return { parts: rawParts, route: { kind: "unknown" }, valid: false };
  const decoded = parts as string[];
  if (!decoded.length) return { parts: decoded, route: { kind: "home" }, valid: true };
  if (decoded.length === 1 && decoded[0] === "history") return { parts: decoded, route: { kind: "home" }, valid: true };
  if (decoded.length === 1 && decoded[0] === "settings") return { parts: decoded, route: { kind: "settings" }, valid: true };
  if (decoded.length === 1 && decoded[0] === "recap") return { parts: decoded, route: { kind: "recap" }, valid: true };
  if (decoded.length === 1 && decoded[0] === "create") return { parts: decoded, route: { kind: "create" }, valid: true };
  if (decoded.length === 2 && decoded[0] === "create" && decoded[1] === "verify") return { parts: decoded, route: { kind: "verify" }, valid: true };
  if (decoded.length === 2 && decoded[0] === "b" && Boolean(decoded[1])) return { parts: decoded, route: { kind: "bill", billId: decoded[1] }, valid: true };
  return { parts: decoded, route: { kind: "unknown" }, valid: true };
}

export function isKnownHashRoute(parts: string[]): boolean {
  if (!parts.length) return true;
  if (parts.length === 1) return ["history", "recap", "settings", "create"].includes(parts[0]);
  return parts.length === 2 && ((parts[0] === "create" && parts[1] === "verify") || (parts[0] === "b" && Boolean(parts[1])));
}

export function routeHash(route: Route): string {
  switch (route.kind) {
    case "home": return "#/";
    case "settings": return "#/settings";
    case "recap": return "#/recap";
    case "create": return "#/create";
    case "verify": return "#/create/verify";
    case "bill": return `#/b/${encodeURIComponent(route.billId)}`;
    default: return "#/";
  }
}

export function navigate(route: Route, replace = false): void {
  if (typeof window === "undefined") return;
  const hash = routeHash(route);
  if (replace) window.history.replaceState(null, "", hash);
  else if (window.location.hash !== hash) window.location.hash = hash;
}