// Pure geometry for event markers — everything the engine needs to draw the
// moments on a row, kept out of the canvas code so it can be unit-tested.
//
// Two rules make this file:
//
//  1. **Events appear only when zoomed in far enough.** A point in time is a
//     claim about a day; drawn across a whole life it is a speck sitting on a
//     year it cannot possibly resolve, and twenty of them are one smudge. The
//     threshold is expressed in ms-per-pixel — the zoom level itself — rather
//     than in "years on screen", so a phone and a wide monitor agree on what
//     "zoomed in" means, and there is a ramp rather than a hard switch so the
//     markers fade in as you come closer.
//  2. **A label is drawn only where it fits before the next marker.** Bars
//     clamp their labels to the neighbouring bar (see bars.ts); markers do the
//     same against the next marker on the same row, and drop the label
//     entirely when what is left is too narrow to say anything.

import { DAY_MS, fuzzMs } from "../model/fuzzyDate";
import { truncateToWidth } from "./bars";
import type { TimelineEvent } from "../model/types";
import type { TimeScale } from "./timeScale";
import { msToX } from "./timeScale";

// Zoomed out past this, events are not drawn at all: one day is worth less than
// half a pixel, so a marker would be a claim the picture cannot support.
export const EVENT_HIDDEN_ABOVE_MS_PER_PX = 2 * DAY_MS;
// Zoomed in to this — one day per pixel or finer — they are fully opaque.
export const EVENT_SOLID_BELOW_MS_PER_PX = DAY_MS;

// How wide the pin's head is, and how much room its label needs beside it.
export const EVENT_PIN_RADIUS_PX = 4;
export const EVENT_LABEL_GAP_PX = 5;
// Breathing room before the next marker, so two labels never touch.
export const EVENT_LABEL_CLEARANCE_PX = 8;

// Fully outside the viewport by more than this and the marker is skipped. The
// label extends to the right of the pin, so only the pin's own position decides
// — a pin off the left edge takes its label with it.
const CULL_MARGIN_PX = 12;

// 0 when the view is too coarse for events to mean anything, 1 when it is fine
// enough, and a linear ramp between — so zooming in fades them in instead of
// popping a row full of pins into existence in one frame.
export function eventMarkerOpacity(scale: TimeScale): number {
  const span = EVENT_HIDDEN_ABOVE_MS_PER_PX - EVENT_SOLID_BELOW_MS_PER_PX;
  const ramp = (EVENT_HIDDEN_ABOVE_MS_PER_PX - scale.msPerPx) / span;
  return Math.min(1, Math.max(0, ramp));
}

export function eventsVisible(scale: TimeScale): boolean {
  return eventMarkerOpacity(scale) > 0;
}

export interface EventMarker {
  event: TimelineEvent;
  x: number; // the pin, at the event's own instant
  // The precision band: an event known only to the year is drawn with a wide
  // soft band around the pin, one known to the day with none. Same idea as a
  // bar's fuzzy edge, and the same source of truth (`fuzzMs`).
  xFuzzStart: number;
  xFuzzEnd: number;
  // "" when there is no room for an honest label — the pin stays, so the moment
  // is still there to be tapped, it just doesn't shout over its neighbour.
  label: string;
  labelX: number;
  labelWidth: number;
}

// Where every marker on one row goes, in event order, with each label clamped
// to the next marker along. `measure` is the caller's `ctx.measureText`, which
// is what keeps this pure and testable — the canvas is the only thing that
// knows how wide a string actually is.
export function layoutEventMarkers(
  events: TimelineEvent[],
  scale: TimeScale,
  viewportWidth: number,
  measure: (text: string) => number,
): EventMarker[] {
  const ordered = [...events].sort((a, b) => a.date.ms - b.date.ms);
  const xs = ordered.map((event) => msToX(scale, event.date.ms));

  const markers: EventMarker[] = [];
  ordered.forEach((event, index) => {
    const x = xs[index];
    if (x < -CULL_MARGIN_PX || x > viewportWidth + CULL_MARGIN_PX) return;

    const fuzz = fuzzMs(event.date) / scale.msPerPx;
    const labelX = x + EVENT_PIN_RADIUS_PX + EVENT_LABEL_GAP_PX;
    // The next marker along, whatever it is — including one culled off the
    // right edge, which still has to stop this label running under it.
    const nextX = index + 1 < xs.length ? xs[index + 1] : Number.POSITIVE_INFINITY;
    const limit = Math.min(nextX - EVENT_LABEL_CLEARANCE_PX, viewportWidth - EVENT_LABEL_GAP_PX);
    const text = eventLabelText(event);
    const label = truncateToWidth(text, limit - labelX, measure);

    markers.push({
      event,
      x,
      xFuzzStart: x - fuzz,
      xFuzzEnd: x + fuzz,
      label,
      labelX,
      labelWidth: label === "" ? 0 : measure(label),
    });
  });
  return markers;
}

// The icon rides in front of the title rather than replacing the pin: the pin
// is what says "a moment happened here" at any zoom, and an emoji at 11px is
// not readable as a position marker.
export function eventLabelText(event: TimelineEvent): string {
  return event.icon ? `${event.icon} ${event.title}` : event.title;
}
