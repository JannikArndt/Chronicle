// Moving the canvas to an entry, on both axes.
//
// Two places need this and they must agree: the entry pane's "Show on timeline"
// button, and the add flow's "Done". A second copy would drift.

import type { TimelineEngine } from "../render/engine";
import type { Layout } from "../render/layout";
import type { TimelineEntry } from "../model/types";

export function centerOnEntry(
  engine: TimelineEngine | null,
  layout: Layout,
  entry: TimelineEntry,
  nowMs: number,
): void {
  if (!engine) return;
  // The middle of the bar, so a long entry is framed rather than pinned to one
  // of its edges. An ongoing entry runs to today.
  engine.centerOnMs((entry.start.ms + (entry.end?.ms ?? nowMs)) / 2);
  // A row that isn't in the layout yet (just created) simply keeps the current
  // vertical position — better than scrolling somewhere arbitrary.
  const item = layout.items.find((candidate) => candidate.id === entry.rowId);
  if (item) engine.centerOnLayoutY(item.y + item.height / 2);
}
