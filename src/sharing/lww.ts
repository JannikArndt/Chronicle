// Last-writer-wins merge over the HLC — plans/sharing-feature-design.md §D4.
//
// Chronicle's records are small and flat, so an LWW-Element-Set converges
// without a CRDT library. The two things that make it correct rather than
// merely plausible are here: a total order (the HLC embeds the writer's account
// id, so distinct writers can never tie) and tombstones (without them a delete
// that arrives before a concurrent edit gets resurrected by that edit).

import { compareHlc } from "./hlc";
import { keyOf } from "./records";
import type { SyncRecord } from "./records";

export function pickWinner(a: SyncRecord, b: SyncRecord): SyncRecord {
  const byClock = compareHlc(a.clock, b.clock);
  if (byClock !== 0) return byClock > 0 ? a : b;
  // Identical clocks mean the same writer in the same millisecond with a
  // saturated counter — vanishingly rare, and a sign something upstream is
  // wrong. Let the delete win: losing an edit is recoverable, and resurrecting
  // something the user deleted is the failure that matters here.
  if (a.deleted !== b.deleted) return a.deleted ? a : b;
  return a;
}

// Fold `incoming` into `base`, newest-wins per record.
export function mergeRecords(base: SyncRecord[], incoming: SyncRecord[]): SyncRecord[] {
  const merged = new Map(base.map((record) => [keyOf(record), record]));
  for (const record of incoming) {
    const key = keyOf(record);
    const existing = merged.get(key);
    merged.set(key, existing === undefined ? record : pickWinner(existing, record));
  }
  return [...merged.values()];
}
