/**
 * One-slot, identity-scoped cache for a screen's read payload.
 *
 * The Home bill list is the app's most-repeated read: every navigation back to
 * Home remounts HomeRoute and used to re-fetch, even a second after the last
 * one. The cache is deliberately ONE slot — bounded by construction, not by an
 * eviction policy — and it is keyed by the identity it was fetched FOR, so:
 *
 *   - a hit is only ever served to the identity that asked for it. A cached
 *     list can never be handed to a different viewer, because a hit requires
 *     `entry.identityId === identityId`; a load for another identity replaces
 *     the slot instead of reading it (no cross-identity leakage).
 *   - simultaneous mounts of the same identity share one in-flight request
 *     (promise dedupe), so two fast route changes cannot double-fetch.
 *   - `invalidate()` bumps a generation and drops the slot. A response already
 *     in flight when the generation moved is DISCARDED rather than written
 *     back, which is the bug class this exists to prevent: a slow pre-mutation
 *     response repopulating post-mutation state with the old list.
 *
 * Invalidation is GLOBAL for the cache's lifetime. `createIdentityCache`
 * subscribes to the app's mutation signal itself, at construction time — see
 * the `subscribe` parameter — rather than letting a screen wire it up in a
 * component effect. The screen that mutates is rarely the screen that owns the
 * cache: a bill created on #/create or settled on #/b/<id> happens while Home
 * is unmounted, so an effect-scoped listener vanished exactly when it was
 * needed and the slot then served pre-mutation rows after Home remounted
 * (bug: v91 — create a bill, tap Home, see the list from before the create).
 *
 * Errors are never cached. A failed load clears the slot, so the next mount
 * really retries instead of replaying the failure for the rest of the TTL.
 */

export const IDENTITY_CACHE_TTL_MS = 30_000;

/**
 * The app's write signal: a source that calls `listener` after every
 * successful mutation, and keeps doing so until the app ends. Passed in rather
 * than imported so this module stays a pure, dependency-free data structure —
 * the caller supplies the real event bus (`onMutation` from `./api`).
 */
export type MutationSubscription = (listener: () => void) => unknown;

export type IdentityCache<T> = {
  /** Cached value within TTL, or a shared in-flight promise, or a fresh load. */
  load(identityId: string): Promise<T>;
  /** Drop the slot and fence off every response still in flight. */
  invalidate(): void;
};

export function createIdentityCache<T>(
  fetchValue: (identityId: string) => Promise<T>,
  ttlMs: number = IDENTITY_CACHE_TTL_MS,
  subscribe?: MutationSubscription,
): IdentityCache<T> {
  type Entry = {
    identityId: string;
    generation: number;
    fetchedAt: number;
    data?: T;
    promise?: Promise<T>;
  };
  let entry: Entry | null = null;
  let generation = 0;

  const invalidate = (): void => {
    generation += 1;
    entry = null;
  };

  /* Subscribed once, here, for the whole life of the cache — never from a
     component effect. The unsubscribe handle is deliberately dropped: the cache
     lives as long as the module that created it, so the subscription is bounded
     by construction and outlives every screen that reads from it. */
  subscribe?.(invalidate);

  return {
    load(identityId: string): Promise<T> {
      const now = Date.now();
      if (entry && entry.identityId === identityId) {
        if (entry.promise) return entry.promise;
        if (entry.data !== undefined && now - entry.fetchedAt < ttlMs) {
          return Promise.resolve(entry.data);
        }
      }

      const next: Entry = { identityId, generation, fetchedAt: 0 };
      next.promise = fetchValue(identityId).then(
        value => {
          // Only the live entry may be filled, and only if nothing invalidated
          // it while the request was in flight. A response that lost the race
          // still resolves for its own caller; it just never reaches the slot.
          if (entry === next && generation === next.generation) {
            next.data = value;
            next.fetchedAt = Date.now();
            next.promise = undefined;
          }
          return value;
        },
        error => {
          if (entry === next) entry = null;
          throw error;
        },
      );
      entry = next;
      return next.promise;
    },

    invalidate,
  };
}
