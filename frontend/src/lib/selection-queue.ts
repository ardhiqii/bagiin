import type { SelectionPick } from "./types";

/**
 * Serialize the local picker state into the request shape accepted by
 * POST /api/bills/{id}/selections. Empty quantities are omitted and item ids
 * are sorted so rapid UI updates produce deterministic payloads.
 */
export function serializeSelections(quantities: Readonly<Record<number, number>>): SelectionPick[] {
  return Object.entries(quantities)
    .map(([itemId, qty]) => ({ item_id: Number(itemId), qty: Number(qty) }))
    .filter(({ item_id, qty }) => Number.isInteger(item_id) && item_id > 0 && Number.isInteger(qty) && qty >= 1 && qty <= 99)
    .sort((left, right) => left.item_id - right.item_id);
}

/**
 * A failed save must not poison the queue. The next tap still runs, while the
 * caller keeps the rejected promise so it can show an error for that save.
 */
export class SelectionSaveQueue {
  private tail: Promise<void> = Promise.resolve();

  enqueue<T>(save: () => Promise<T>): Promise<T> {
    const result = this.tail.then(save);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }
}

export function createSelectionSaveQueue(): SelectionSaveQueue {
  return new SelectionSaveQueue();
}
