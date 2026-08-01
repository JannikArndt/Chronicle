// The pure part of the "add a timeline" table: turning two typed years into an
// entry's dates.
//
// Kept out of the component for the same reason every other bit of date logic
// is — it is the part that can be wrong in a way a screenshot won't show.

import { parseDateInput } from "../model/parseDateInput";
import type { FuzzyDate } from "../model/types";

export interface EntryDates {
  start: FuzzyDate;
  // Absent means ongoing, which is what an empty "to" field says.
  end?: FuzzyDate;
}

// Null means "not enough to save yet" — a row with no usable start is not an
// entry, it is a half-typed thought.
export function entryDatesFromYearText(fromText: string, toText: string): EntryDates | null {
  const from = parseDateInput(fromText.trim());
  if (from.kind !== "date") return null;

  const to = parseDateInput(toText.trim());
  if (to.kind !== "date") return { start: { ms: from.ms, precision: from.precision } };

  // A backwards range is a typo, not an intention. Keeping the later of the two
  // as the end is the reading that loses no information.
  const endMs = Math.max(to.ms, from.ms);
  return {
    start: { ms: from.ms, precision: from.precision },
    end: { ms: endMs, precision: to.precision },
  };
}
