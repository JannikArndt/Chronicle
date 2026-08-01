// Where a new entry added to an existing timeline most likely starts.
//
// Timelines are usually told in order — the next band you played in starts
// after the last one ended — so the add flow opens there rather than at today
// or at the epoch. It is only a starting guess; the date editor overrides it.

import type { TimelineEntry } from "../model/types";

export function nextEntryStartMs(entries: TimelineEntry[], nowMs: number): number {
  if (entries.length === 0) return nowMs;
  // An entry with no end is still running, so there is no "after it" but now.
  if (entries.some((entry) => entry.end === undefined)) return nowMs;
  // Deliberately not clamped forward to today: a timeline whose last entry
  // ended in 1998 is usually being filled in from 1998 onwards, not from now.
  return Math.max(...entries.map((entry) => entry.end!.ms));
}
