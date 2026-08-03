// What to push — plans/sharing-feature-design.md §D4.
//
// Push works by diffing the current shareable subset against a snapshot of what
// was last sent, inside the debounced autosave that already exists. That is why
// none of the ~25 mutations in `state/actions.ts` had to change and why no
// `updatedAt` field entered the app schema: the sync layer notices changes
// rather than being told about them.

import { keyOf } from "./records";
import type { SyncRecord } from "./records";

export interface PushPlan {
  // Records to send: changed records restamped with the new clock, plus
  // tombstones for anything that left the subset.
  writes: SyncRecord[];
  // What to compare against next time. Unchanged records keep their ORIGINAL
  // clock — restamping them would claim an edit that never happened and would
  // beat a genuinely newer edit from another device.
  nextSnapshot: SyncRecord[];
}

export function planPush(lastPushed: SyncRecord[], current: SyncRecord[]): PushPlan {
  const previousByKey = new Map(lastPushed.map((record) => [keyOf(record), record]));
  const writes: SyncRecord[] = [];
  const nextSnapshot: SyncRecord[] = [];

  for (const record of current) {
    const previous = previousByKey.get(keyOf(record));
    previousByKey.delete(keyOf(record));
    if (previous === undefined || previous.deleted || contentChanged(previous, record)) {
      writes.push(record);
      nextSnapshot.push(record);
    } else {
      nextSnapshot.push(previous);
    }
  }

  // Anything left in the snapshot is gone from the subset — deleted outright,
  // un-published, or dropped because the sync mode narrowed. All three mean the
  // same thing on the wire, and all three must reach subscribers: an
  // un-publish that only stopped sending updates would leave the last version
  // visible forever.
  for (const orphan of previousByKey.values()) {
    if (orphan.deleted) continue; // already tombstoned and pushed; drop it, don't re-send
    const clock = current[0]?.clock ?? orphan.clock;
    const updatedBy = current[0]?.updatedBy ?? orphan.updatedBy;
    writes.push({ ...orphan, payload: null, deleted: true, clock, updatedBy });
  }

  return { writes, nextSnapshot };
}

function contentChanged(previous: SyncRecord, current: SyncRecord): boolean {
  return (
    previous.shared !== current.shared ||
    previous.parentId !== current.parentId ||
    stableStringify(previous.payload) !== stableStringify(current.payload)
  );
}

// Key order in a JS object follows insertion, and `Object.assign` patches in
// `actions.ts` append new keys rather than rebuilding the object — so two
// records with identical content can serialise differently. Sorting keys keeps
// that from reading as a change and pushing an edit nobody made.
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, nested]) => nested !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`).join(",")}}`;
}
