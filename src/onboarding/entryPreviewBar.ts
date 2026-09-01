// Geometry for the add flow's preview: the same fuzz the canvas paints,
// expressed as percentages so a DOM element can show it while the thing doesn't
// exist yet. It reuses `rampBounds`/`fuzzMs` rather than re-deriving fuzz — a
// second definition of "how blurry is this edge" would drift from the renderer.

import { fuzzMs, rampBounds } from "../model/fuzzyDate";
import type { FuzzyDate, TimelineEntry } from "../model/types";

export interface PreviewLaneRange {
  startMs: number;
  endMs: number;
}

export interface PreviewBar {
  leftPercent: number;
  widthPercent: number;
  // Where the bar reaches full opacity and where it starts fading again, as
  // percentages *of the bar itself* — i.e. gradient stops.
  solidStartPercent: number;
  solidEndPercent: number;
  ongoing: boolean;
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

export function previewBar(entry: TimelineEntry, range: PreviewLaneRange, nowMs: number): PreviewBar {
  const span = Math.max(range.endMs - range.startMs, 1);
  const percentOf = (ms: number) => clampPercent(((ms - range.startMs) / span) * 100);
  const bounds = rampBounds(entry, nowMs);

  const leftPercent = percentOf(bounds.visualStart);
  // A bar thinner than a hairline reads as "nothing happened"; a same-day entry
  // still deserves a visible mark.
  const widthPercent = Math.max(percentOf(bounds.visualEnd) - leftPercent, 1.5);

  const withinBar = (ms: number) => clampPercent(((percentOf(ms) - leftPercent) / widthPercent) * 100);
  return {
    leftPercent,
    widthPercent,
    solidStartPercent: withinBar(bounds.solidStart),
    solidEndPercent: withinBar(bounds.solidEnd),
    ongoing: bounds.ongoing,
  };
}

// The moment's counterpart to `previewBar`: where the pin stands, and how wide
// the band around it is. A day-precise moment has no band at all, which is the
// visible difference between "the 14th" and "sometime that year".
export interface PreviewPin {
  leftPercent: number;
  bandLeftPercent: number;
  bandWidthPercent: number;
}

export function previewPin(date: FuzzyDate, range: PreviewLaneRange): PreviewPin {
  const span = Math.max(range.endMs - range.startMs, 1);
  const percentOf = (ms: number) => clampPercent(((ms - range.startMs) / span) * 100);
  const fuzz = fuzzMs(date);
  const bandLeftPercent = percentOf(date.ms - fuzz);
  return {
    leftPercent: percentOf(date.ms),
    bandLeftPercent,
    bandWidthPercent: percentOf(date.ms + fuzz) - bandLeftPercent,
  };
}
