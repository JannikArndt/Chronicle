// What a tap on a collapsed group's summary bar selects. A bar stands in for a
// whole direct child — one timeline, or a sub-group's entire subtree — so the
// tap is resolved to the record under the finger: the narrowest entry whose
// span holds the tapped instant, else whichever entry or event lies nearest to
// it in time. A group made by breaking a timeline out holds one entry per
// child, so there each bar simply IS its entry.
//
// Pure, like the rest of the geometry here: the engine registers the bar's hit
// box and asks this which record that tap meant.

import type { TimelineDataset } from "../model/types";
import type { GroupSummaryBar } from "./layout";

export type SummaryPick = { kind: "entry"; id: string } | { kind: "event"; id: string };

export function pickInSummary(
  bar: Pick<GroupSummaryBar, "rowIds">,
  dataset: Pick<TimelineDataset, "entries" | "events">,
  tapMs: number,
  nowMs: number,
): SummaryPick | undefined {
  const rows = new Set(bar.rowIds);
  let containing: { id: string; span: number } | undefined;
  let nearest: { pick: SummaryPick; distance: number } | undefined;
  const consider = (pick: SummaryPick, distance: number) => {
    if (nearest === undefined || distance < nearest.distance) nearest = { pick, distance };
  };

  for (const entry of dataset.entries) {
    if (!rows.has(entry.rowId)) continue;
    const start = entry.start.ms;
    // An ongoing entry is drawn up to today, so that is where it can be hit.
    const end = entry.end?.ms ?? Math.max(nowMs, start);
    if (tapMs >= start && tapMs <= end) {
      // Narrowest wins, as on a row: a short entry inside a long one is
      // otherwise unreachable.
      if (containing === undefined || end - start < containing.span) containing = { id: entry.id, span: end - start };
    } else {
      consider({ kind: "entry", id: entry.id }, tapMs < start ? start - tapMs : tapMs - end);
    }
  }
  if (containing) return { kind: "entry", id: containing.id };

  for (const event of dataset.events) {
    if (!rows.has(event.rowId)) continue;
    consider({ kind: "event", id: event.id }, Math.abs(tapMs - event.date.ms));
  }
  return nearest?.pick;
}
