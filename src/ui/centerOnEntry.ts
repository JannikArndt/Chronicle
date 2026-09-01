// Moving the canvas to a record, on both axes.
//
// Several places need this and they must agree: the entry pane's "Show on
// timeline" button, the event pane's, and the add flow's "Done". A second copy
// would drift.

import { DAY_MS, fuzzMs } from "../model/fuzzyDate";
import { eventsVisible } from "../render/events";
import type { TimelineEngine } from "../render/engine";
import type { Layout } from "../render/layout";
import type { TimelineEntry, TimelineEvent } from "../model/types";

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

// The narrowest window worth zooming to for a moment: wide enough that the pin
// is not the only thing on screen, and always fine enough for events to be
// drawn at all.
const EVENT_FRAME_MIN_SPAN_MS = 90 * DAY_MS;

export function centerOnEvent(engine: TimelineEngine | null, layout: Layout, event: TimelineEvent): void {
  if (!engine) return;
  // Centring alone is not enough here: events are hidden when zoomed out, so
  // "show me this" from a whole-life view would scroll to an empty stretch of
  // row. Zoom only when it is actually needed — someone already looking at one
  // week keeps their zoom.
  if (eventsVisible(engine.scale)) {
    engine.centerOnMs(event.date.ms);
  } else {
    // A vague date gets a wider frame, so "sometime in 1998" is not framed as
    // if it were a Tuesday.
    const span = Math.max(fuzzMs(event.date) * 4, EVENT_FRAME_MIN_SPAN_MS);
    engine.zoomToRange(event.date.ms - span / 2, event.date.ms + span / 2);
  }
  const item = layout.items.find((candidate) => candidate.id === event.rowId);
  if (item) engine.centerOnLayoutY(item.y + item.height / 2);
}
