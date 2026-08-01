// The life-strip minimap: the whole dataset squeezed into one band at the top
// of the mobile shell, with the canvas's current viewport drawn over it.
//
// Pure geometry only — MiniMap.tsx paints it. One lane per visible timeline,
// deliberately: a group roll-up was built during the prototype and rejected,
// because rows keep their own colour and the ungrouped version already reads as
// coloured bands per group (see plans/mobile-shell.md).

import type { TimelineDataset } from "../model/types";
import type { Layout } from "./layout";

// Matches the canvas engine's fallback for a row with no colour of its own.
const DEFAULT_LANE_COLOR = "#888";

// A lane never gets thinner than this: below it the strip is noise, not texture.
const MIN_PITCH_PX = 2.2;
const MAX_PITCH_PX = 6.5;
// Lanes stay at full pitch up to this many, then share a fixed budget.
const FULL_PITCH_LANE_LIMIT = 8;
const PITCH_BUDGET_PX = 78;

// Room above and below the lanes for the year ticks and the viewport window.
const STRIP_CHROME_PX = 22;
const MIN_STRIP_HEIGHT_PX = 58;
const MAX_STRIP_HEIGHT_PX = 104;

const MIN_BAR_HEIGHT_PX = 1.4;
const MAX_BAR_HEIGHT_PX = 4;
// How much of a lane's pitch is the gap between it and the next one.
const BAR_PITCH_INSET_PX = 1.1;

// A strip covering only a single instant is undraggable, so an empty or
// point-like dataset is padded out to this.
const MIN_RANGE_MS = 10 * 365.25 * 86_400_000;
const RANGE_PADDING_FRACTION = 0.04;

export interface MiniMapSpan {
  startMs: number;
  endMs: number;
}

export interface MiniMapLane {
  rowId: string;
  color: string;
  spans: MiniMapSpan[];
}

export interface MiniMapMetrics {
  // Vertical distance from one lane's top to the next one's.
  pitch: number;
  barHeight: number;
  height: number;
}

export interface MiniMapRange {
  startMs: number;
  endMs: number;
}

export interface ViewportWindow {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

// The canvas's vertical position, as the minimap needs it: how far down the
// laid-out rows the view sits, and how much of them it covers.
export interface VerticalView {
  scrollY: number;
  visibleHeight: number;
  totalHeight: number;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

// One lane per row the canvas is currently drawing, in the same order, so the
// strip reads top-to-bottom like the timeline it summarises.
export function miniMapLanes(layout: Layout, dataset: TimelineDataset, nowMs: number): MiniMapLane[] {
  const lanes: MiniMapLane[] = [];
  for (const item of layout.items) {
    if (item.kind !== "row" || item.hidden || !item.row) continue;
    const row = item.row;
    lanes.push({
      rowId: row.id,
      color: row.color ?? DEFAULT_LANE_COLOR,
      spans: dataset.entries
        .filter((entry) => entry.rowId === row.id)
        .map((entry) => ({ startMs: entry.start.ms, endMs: entry.end?.ms ?? nowMs })),
    });
  }
  return lanes;
}

// Lanes thin out as they multiply and the strip grows to meet them halfway —
// neither alone survives 30 timelines.
export function miniMapMetrics(laneCount: number): MiniMapMetrics {
  const lanes = Math.max(1, laneCount);
  const pitch =
    lanes <= FULL_PITCH_LANE_LIMIT ? MAX_PITCH_PX : clamp(PITCH_BUDGET_PX / lanes, MIN_PITCH_PX, MAX_PITCH_PX);
  const height = Math.round(
    clamp(lanes * pitch + STRIP_CHROME_PX, MIN_STRIP_HEIGHT_PX, MAX_STRIP_HEIGHT_PX),
  );
  const barHeight = clamp(pitch - BAR_PITCH_INSET_PX, MIN_BAR_HEIGHT_PX, MAX_BAR_HEIGHT_PX);
  return { pitch, barHeight, height };
}

// The span the strip covers: everything that exists, plus a margin so the
// earliest and latest bars aren't flush against the edges.
export function miniMapTimeRange(lanes: MiniMapLane[], nowMs: number): MiniMapRange {
  let startMs = Infinity;
  let endMs = -Infinity;
  for (const lane of lanes) {
    for (const span of lane.spans) {
      startMs = Math.min(startMs, span.startMs);
      endMs = Math.max(endMs, span.endMs);
    }
  }
  if (!Number.isFinite(startMs)) return { startMs: nowMs - MIN_RANGE_MS, endMs: nowMs };
  endMs = Math.max(endMs, nowMs);
  if (endMs - startMs < MIN_RANGE_MS) endMs = startMs + MIN_RANGE_MS;
  const padding = (endMs - startMs) * RANGE_PADDING_FRACTION;
  return { startMs: startMs - padding, endMs: endMs + padding };
}

// Where the canvas's current view falls on the strip. Clamped to the strip, so
// panning far outside the data still leaves a grabbable window on screen. Takes
// the span rather than a TimeScale, because that is what the engine reports
// through onViewChange.
export function viewportWindow(
  view: MiniMapRange,
  range: MiniMapRange,
  stripWidth: number,
  vertical: VerticalView | null,
  laneBandHeight: number,
): ViewportWindow {
  const msToStripX = (ms: number) =>
    ((ms - range.startMs) / (range.endMs - range.startMs)) * stripWidth;
  return {
    x0: clamp(msToStripX(view.startMs), 0, stripWidth),
    x1: clamp(msToStripX(view.endMs), 0, stripWidth),
    ...verticalWindow(vertical, laneBandHeight),
  };
}

// The lanes occupy `laneBandHeight` px of strip and stand for `totalHeight` px
// of canvas, so the visible slice maps across as a plain proportion. A canvas
// that shows everything gets the full band — never a window smaller than the
// thing it is a window onto.
function verticalWindow(vertical: VerticalView | null, laneBandHeight: number): { y0: number; y1: number } {
  if (!vertical || vertical.totalHeight <= 0 || vertical.visibleHeight >= vertical.totalHeight) {
    return { y0: 0, y1: laneBandHeight };
  }
  const scale = laneBandHeight / vertical.totalHeight;
  const y0 = clamp(vertical.scrollY * scale, 0, laneBandHeight);
  const y1 = clamp((vertical.scrollY + vertical.visibleHeight) * scale, y0, laneBandHeight);
  return { y0, y1 };
}

// The instant a tap or drag at `x` on the strip points at.
export function stripXToMs(x: number, range: MiniMapRange, stripWidth: number): number {
  const fraction = stripWidth === 0 ? 0 : clamp(x / stripWidth, 0, 1);
  return range.startMs + fraction * (range.endMs - range.startMs);
}

// The layout row a tap or drag at `y` within the lane band points at — the
// vertical counterpart of stripXToMs.
export function stripYToLayoutY(y: number, laneBandHeight: number, totalHeight: number): number {
  const fraction = laneBandHeight === 0 ? 0 : clamp(y / laneBandHeight, 0, 1);
  return fraction * totalHeight;
}
