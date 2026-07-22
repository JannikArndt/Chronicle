// Exclusive-row insert planning (ENGINEERING_PROMPT.md §2 notes, §6):
// appending after the row's chronologically last entry auto-closes that
// entry at the new start (with a visible note). Any other overlap —
// backfilling, mid-timeline insert, spanning several entries — blocks the
// save with a conflict naming the overlapping entry.

import type { FuzzyDate, TimelineDataset, TimelineEntry } from "./types";

export type InsertPlan =
  | { kind: "ok" }
  | { kind: "autoClose"; previousEntry: TimelineEntry; closeAt: FuzzyDate; note: string }
  | { kind: "conflict"; conflictingEntry: TimelineEntry; message: string };

function endMs(entry: TimelineEntry): number {
  return entry.end?.ms ?? Number.POSITIVE_INFINITY;
}

function overlaps(a: TimelineEntry, b: TimelineEntry): boolean {
  return a.start.ms < endMs(b) && b.start.ms < endMs(a);
}

export function planEntryInsert(dataset: TimelineDataset, draft: TimelineEntry): InsertPlan {
  const row = dataset.rows.find((r) => r.id === draft.rowId);
  const category = dataset.categories.find((c) => c.id === row?.categoryId);
  const concurrency = draft.concurrencyOverride ?? category?.concurrency ?? "concurrent";
  if (concurrency === "concurrent") return { kind: "ok" };

  const siblings = dataset.entries.filter((entry) => entry.rowId === draft.rowId && entry.id !== draft.id);
  const overlapping = siblings.filter(
    (entry) => (entry.concurrencyOverride ?? "exclusive") === "exclusive" && overlaps(entry, draft),
  );
  if (overlapping.length === 0) return { kind: "ok" };

  const last = siblings.reduce((a, b) => (b.start.ms > a.start.ms ? b : a));
  const othersExtendPastDraftStart = siblings.some((entry) => entry !== last && endMs(entry) > draft.start.ms);
  const isPlainAppend =
    overlapping.length === 1 &&
    overlapping[0] === last &&
    draft.start.ms > last.start.ms &&
    !othersExtendPastDraftStart;

  if (isPlainAppend) {
    const closeAt: FuzzyDate = { ms: draft.start.ms, precision: draft.start.precision };
    return {
      kind: "autoClose",
      previousEntry: last,
      closeAt,
      note: `Saving will close “${last.title}” on this entry's start date.`,
    };
  }

  const conflicting = overlapping[0];
  return {
    kind: "conflict",
    conflictingEntry: conflicting,
    message:
      `Overlaps “${conflicting.title}” on this exclusive row. ` +
      `Adjust that entry's dates first, or mark one of the two as concurrent.`,
  };
}
