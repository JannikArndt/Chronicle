// How much time the date editor's lane shows around the entry being edited.
//
// Pure, because getting this wrong parks a handle off-screen: toggling "still
// ongoing" moves the end to today, and a lane still framed on a 2016 entry left
// the end handle somewhere off to the right, unreachable. Hence the tests.

const YEAR_MS = 365.25 * 86_400_000;

// Enough context that a short entry doesn't float in a featureless lane.
const MIN_PADDING_MS = 2.5 * YEAR_MS;
const PADDING_SPAN_FRACTION = 1.1;

// The entry's bar must occupy at least this much of the lane, or its two
// handles end up under a single fingertip.
const MIN_SPAN_FRACTION_OF_LANE = 0.18;

export interface LaneRange {
  startMs: number;
  endMs: number;
}

export function dateLaneRange(entryStartMs: number, entryEndMs: number): LaneRange {
  const span = Math.max(entryEndMs - entryStartMs, 0);
  let padding = Math.max(MIN_PADDING_MS, span * PADDING_SPAN_FRACTION);

  // For a short entry the generous padding above would swamp the bar, so cap it
  // at whatever still leaves the bar filling MIN_SPAN_FRACTION_OF_LANE. A
  // zero-length entry has no span to preserve and keeps the full padding.
  if (span > 0) {
    const paddingThatKeepsBarVisible = (span / MIN_SPAN_FRACTION_OF_LANE - span) / 2;
    padding = Math.min(padding, paddingThatKeepsBarVisible);
  }

  return { startMs: entryStartMs - padding, endMs: entryEndMs + padding };
}

// Where an instant sits in the lane, 0 at its left edge and 1 at its right.
export function laneFraction(ms: number, range: LaneRange): number {
  const span = range.endMs - range.startMs;
  return span === 0 ? 0 : (ms - range.startMs) / span;
}

export function laneFractionToMs(fraction: number, range: LaneRange): number {
  return range.startMs + fraction * (range.endMs - range.startMs);
}
