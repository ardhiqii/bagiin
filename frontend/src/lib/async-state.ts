/**
 * Monotonic guard for effects that may finish after the user has changed
 * routes or identities. A response may still be useful to the network caller,
 * but only the current token may update mounted screen state.
 */
export function createRequestGate() {
  let current = 0;
  return {
    begin(): number {
      current += 1;
      return current;
    },
    isCurrent(token: number): boolean {
      return token === current;
    },
    invalidate(): void {
      current += 1;
    },
  };
}

export function isAbortError(error: unknown): boolean {
  return typeof DOMException !== "undefined"
    && error instanceof DOMException
    && error.name === "AbortError";
}
