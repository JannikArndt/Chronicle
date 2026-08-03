// The life-strip: a second, much smaller canvas showing every timeline across
// the whole dataset, with the main canvas's current viewport drawn as a window.
// Dragging or tapping it flies the timeline there at the current zoom.
//
// All geometry lives in src/render/miniMap.ts; this file only paints and
// listens. Colours come from the engine's readThemeColors() — a colour table of
// its own would silently drift from the DOM theme (CLAUDE.md invariant).

import { useEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject, PointerEvent as ReactPointerEvent } from "react";
import { readThemeColors } from "../render/engine";
import type { ColorTable, EngineView, TimelineEngine } from "../render/engine";
import type { Layout } from "../render/layout";
import {
  miniMapLanes,
  miniMapMetrics,
  miniMapTimeRange,
  stripXToMs,
  stripYToLayoutY,
  viewportWindow,
} from "../render/miniMap";
import type { MiniMapLane, MiniMapRange } from "../render/miniMap";
import { mergedDataset, useAppState } from "../state/store";

// Keeps the outermost bars and the viewport window's stroke off the edges.
const SIDE_INSET_PX = 4;
const TOP_INSET_PX = 5;
// Height of the year-tick strip along the bottom.
const TICK_LANE_HEIGHT_PX = 14;
const BAR_OPACITY = 0.85;
const WINDOW_FILL_OPACITY = 0.1;
const MIN_WINDOW_WIDTH_PX = 8;
const MIN_WINDOW_HEIGHT_PX = 10;
const MIN_BAR_WIDTH_PX = 1.5;

// How far the finger must travel up or down before the drag starts moving the
// viewport window vertically as well as sideways.
const VERTICAL_ENGAGE_PX = 6;

// Round year gaps to choose between, coarse enough that labels never collide.
const YEAR_MS = 365.25 * 86_400_000;
const TICK_YEAR_STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500];
const MIN_TICK_SPACING_PX = 26;
const MIN_LABEL_SPACING_PX = 58;

interface MiniMapProps {
  layout: Layout;
  engineRef: MutableRefObject<TimelineEngine | null>;
  // The main canvas's visible window, fed by the engine's onViewChange.
  view: EngineView | null;
}

// The canvas is painted in JS, so it has to re-read the CSS custom properties
// itself when the OS theme flips — exactly what the engine does.
function useThemeColors(): ColorTable {
  const [colors, setColors] = useState(readThemeColors);
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const reread = () => setColors(readThemeColors());
    query.addEventListener("change", reread);
    return () => query.removeEventListener("change", reread);
  }, []);
  return colors;
}

function tickYearsFor(range: MiniMapRange, width: number): { step: number; labelStep: number } {
  const years = (range.endMs - range.startMs) / YEAR_MS;
  const pixelsPerYear = width / Math.max(years, 1);
  const step = TICK_YEAR_STEPS.find((candidate) => candidate * pixelsPerYear >= MIN_TICK_SPACING_PX);
  const labelStep = TICK_YEAR_STEPS.find((candidate) => candidate * pixelsPerYear >= MIN_LABEL_SPACING_PX);
  return {
    step: step ?? TICK_YEAR_STEPS[TICK_YEAR_STEPS.length - 1],
    labelStep: labelStep ?? TICK_YEAR_STEPS[TICK_YEAR_STEPS.length - 1],
  };
}

// The vertical extent the lanes occupy. It stands for the whole stack of
// timelines, so it is what the viewport window's height is measured against —
// not the strip's full height, which also carries the year ticks.
function laneBandHeight(laneCount: number, cssHeight: number): number {
  const available = cssHeight - TOP_INSET_PX - TICK_LANE_HEIGHT_PX;
  return Math.max(0, Math.min(laneCount * miniMapMetrics(laneCount).pitch, available));
}

function paintStrip(
  canvas: HTMLCanvasElement,
  lanes: MiniMapLane[],
  range: MiniMapRange,
  view: EngineView | null,
  colors: ColorTable,
): void {
  const context = canvas.getContext("2d");
  if (!context) return;
  const cssWidth = canvas.clientWidth;
  const cssHeight = canvas.clientHeight;
  if (cssWidth === 0 || cssHeight === 0) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);
  context.setTransform(dpr, 0, 0, dpr, 0, 0);

  const drawableWidth = cssWidth - SIDE_INSET_PX * 2;
  const msToX = (ms: number) =>
    SIDE_INSET_PX + ((ms - range.startMs) / (range.endMs - range.startMs)) * drawableWidth;

  context.fillStyle = colors.axisBackground;
  context.fillRect(0, 0, cssWidth, cssHeight);

  // Year ticks along the bottom, so the strip reads as a time axis and not an
  // abstract bar chart.
  const { step, labelStep } = tickYearsFor(range, drawableWidth);
  const firstYear = new Date(range.startMs).getUTCFullYear();
  const lastYear = new Date(range.endMs).getUTCFullYear();
  context.strokeStyle = colors.gridlineCoarse;
  context.lineWidth = 1;
  context.fillStyle = colors.axisFineText;
  context.font = "600 8.5px -apple-system, system-ui, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "alphabetic";
  for (let year = Math.ceil(firstYear / step) * step; year <= lastYear; year += step) {
    const x = Math.round(msToX(Date.UTC(year, 0, 1))) + 0.5;
    context.beginPath();
    context.moveTo(x, cssHeight - 10);
    context.lineTo(x, cssHeight - 4);
    context.stroke();
    if (year % labelStep === 0) context.fillText(String(year), x, cssHeight - 12);
  }

  const metrics = miniMapMetrics(lanes.length);
  context.globalAlpha = BAR_OPACITY;
  let laneTop = TOP_INSET_PX;
  for (const lane of lanes) {
    context.fillStyle = lane.color;
    for (const span of lane.spans) {
      const x0 = msToX(span.startMs);
      const x1 = Math.max(msToX(span.endMs), x0 + MIN_BAR_WIDTH_PX);
      context.fillRect(x0, laneTop, x1 - x0, metrics.barHeight);
    }
    laneTop += metrics.pitch;
    if (laneTop > cssHeight - TICK_LANE_HEIGHT_PX) break;
  }
  context.globalAlpha = 1;

  if (!view) return;
  // The window is a window on both axes: with more timelines than fit on the
  // canvas it also shrinks vertically and rides up and down as you scroll.
  const band = laneBandHeight(lanes.length, cssHeight);
  const visible = viewportWindow(view, range, drawableWidth, band);
  const x0 = SIDE_INSET_PX + visible.x0;
  const width = Math.max(MIN_WINDOW_WIDTH_PX, visible.x1 - visible.x0);
  const y0 = TOP_INSET_PX + visible.y0 - 2;
  const height = Math.max(MIN_WINDOW_HEIGHT_PX, visible.y1 - visible.y0) + 4;
  context.globalAlpha = WINDOW_FILL_OPACITY;
  context.fillStyle = colors.guide;
  context.fillRect(x0, y0, width, height);
  context.globalAlpha = 1;
  context.strokeStyle = colors.guide;
  context.lineWidth = 2;
  context.strokeRect(x0, y0, width, height);
}

export function MiniMap({ layout, engineRef, view }: MiniMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const state = useAppState((s) => s);
  const colors = useThemeColors();

  const lanes = useMemo(
    () => miniMapLanes(layout, mergedDataset(state), Date.now()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layout, state.dataset, state.publicDatasets],
  );
  const range = useMemo(() => miniMapTimeRange(lanes, Date.now()), [lanes]);
  const height = miniMapMetrics(lanes.length).height;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    paintStrip(canvas, lanes, range, view, colors);
    // The strip is width-driven; a rotation or a sheet-induced relayout has to
    // repaint it even though none of the values above changed.
    const observer = new ResizeObserver(() => paintStrip(canvas, lanes, range, view, colors));
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [lanes, range, view, colors]);

  // The window moves on both axes, but not from the first pixel of vertical
  // movement. The strip is 60-odd pixels tall standing in for the whole stack of
  // timelines, so one wobbly pixel is worth tens of pixels of canvas: following
  // y unconditionally made a sideways scrub jerk up and down. Past the threshold
  // the gesture is deliberate, and from there y follows for the rest of it.
  const verticalEngagedRef = useRef(false);
  const pressClientYRef = useRef(0);

  const flyTo = (event: ReactPointerEvent<HTMLCanvasElement>, alsoVertical: boolean) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const drawableWidth = bounds.width - SIDE_INSET_PX * 2;
    const engine = engineRef.current;
    if (!engine) return;
    engine.centerOnMs(stripXToMs(event.clientX - bounds.left - SIDE_INSET_PX, range, drawableWidth));
    // Rows that all fit on screen make this a no-op — setScrollY clamps.
    if (alsoVertical && view) {
      const band = laneBandHeight(lanes.length, bounds.height);
      engine.centerOnLayoutY(
        stripYToLayoutY(event.clientY - bounds.top - TOP_INSET_PX, band, view.totalHeight),
      );
    }
  };

  return (
    <canvas
      ref={canvasRef}
      className="mobile-strip"
      style={{ height }}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        pressClientYRef.current = event.clientY;
        verticalEngagedRef.current = false;
        flyTo(event, true);
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        if (Math.abs(event.clientY - pressClientYRef.current) >= VERTICAL_ENGAGE_PX) {
          verticalEngagedRef.current = true;
        }
        flyTo(event, verticalEngagedRef.current);
      }}
    />
  );
}
