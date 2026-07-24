// Turns a FamousPerson into a namespaced, view-ready public dataset — the same
// shape the engine already renders for world-events public data, so adding a
// famous person needs zero renderer changes.
//
// The novel bit is "align to age": shifting every entry so the person's birth
// lands on the user's birth. After the shift, a bar that sat at the person's
// age 26 now sits at the calendar date when the *user* is 26 — which is what
// makes "what did Einstein do at my age?" line up on the shared axis.

import { namespaceDataset } from "../namespace";
import type { FuzzyDate, TimelineDataset } from "../../model/types";
import type { FamousPerson } from "./types";

export const ALIGNED_LABEL_SUFFIX = " · at your age";

// Public key used to namespace a person's ids. Kept distinct per alignment mode
// so the same person could, in principle, be shown both real and aligned at
// once without id collisions.
export function famousKey(personId: string, aligned: boolean): string {
  return aligned ? `famous-${personId}-aligned` : `famous-${personId}`;
}

// Inverse of famousKey, for the rail: given a rendered group's namespaced id
// (`pub:famous-<personId>[-aligned]:...`), recover the person and whether it's
// currently shown aligned. Returns null for any non-famous group.
export function parseFamousGroupId(groupId: string): { personId: string; aligned: boolean } | null {
  const match = /^pub:famous-(.+):[^:]+$/.exec(groupId);
  if (!match) return null;
  const aligned = match[1].endsWith("-aligned");
  const personId = aligned ? match[1].slice(0, -"-aligned".length) : match[1];
  return { personId, aligned };
}

// Same, for a namespaced row id, recovering the pre-namespacing base row id so
// a single famous timeline can be removed. `pub:famous-mozart:r-works` → base
// row key `r-works`.
export function parseFamousRowId(
  rowId: string,
): { personId: string; aligned: boolean; rowKey: string } | null {
  const match = /^pub:famous-(.+?):(.+)$/.exec(rowId);
  if (!match) return null;
  const aligned = match[1].endsWith("-aligned");
  const personId = aligned ? match[1].slice(0, -"-aligned".length) : match[1];
  return { personId, aligned, rowKey: match[2] };
}

function shiftFuzzyDate(date: FuzzyDate, offsetMs: number): FuzzyDate {
  return { ...date, ms: date.ms + offsetMs };
}

// Build the dataset for one famous person, ready to merge into the view.
// When `userBirthMs` is provided, the whole life is shifted so the person's
// birth aligns to the user's birth; otherwise the real calendar dates are used.
// `removedRowKeys` drops individual timelines (by their base row id) the user
// has taken away, along with their entries.
export function buildFamousDataset(
  person: FamousPerson,
  userBirthMs?: number,
  removedRowKeys: string[] = [],
): TimelineDataset {
  const aligned = userBirthMs !== undefined;
  const offsetMs = aligned ? userBirthMs - person.birthMs : 0;

  const keptRowIds = new Set(remainingRowKeys(person, removedRowKeys));
  const raw: TimelineDataset = {
    schemaVersion: 1,
    people: [],
    groups: person.biography.groups.map((group) => ({
      ...group,
      label: aligned ? `${group.label}${ALIGNED_LABEL_SUFFIX}` : group.label,
    })),
    categories: person.biography.categories,
    rows: person.biography.rows.filter((row) => keptRowIds.has(row.id)),
    entries: person.biography.entries
      .filter((entry) => keptRowIds.has(entry.rowId))
      .map((entry) => ({
        ...entry,
        start: shiftFuzzyDate(entry.start, offsetMs),
        end: entry.end ? shiftFuzzyDate(entry.end, offsetMs) : undefined,
      })),
  };

  return namespaceDataset(raw, famousKey(person.id, aligned));
}

// The base row ids that still remain for a person after removals. Removing a
// parent row cascades to its sub-rows (a sub-timeline can't outlive its parent).
export function remainingRowKeys(person: FamousPerson, removedRowKeys: string[]): string[] {
  const removed = new Set(removedRowKeys);
  const isRemoved = (row: { id: string; parentRowId?: string }): boolean =>
    removed.has(row.id) || (row.parentRowId !== undefined && removed.has(row.parentRowId));
  return person.biography.rows.filter((row) => !isRemoved(row)).map((row) => row.id);
}
