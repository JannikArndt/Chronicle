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
import type { ColorTable, TimelineEngine } from "../render/engine";
import type { Layout } from "../render/layout";
import {
  miniMapLanes,
  miniMapMetrics,
  miniMapTimeRange,
  stripXToMs,
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
const MIN_BAR_WIDTH_PX = 1.5;

// Round year gaps to choose between, coarse enough that labels never collide.
const YEAR_MS = 365.25 * 86_400_000;
const TICK_YEAR_STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500];
const MIN_TICK_SPACING_PX = 26;
const MIN_LABEL_SPACING_PX = 58;

interface MiniMapProps {
  layout: Layout;
  engineRef: MutableRefObject<TimelineEngine | null>;
  // The main canvas's visible span, fed by the engine's onViewChange.
  view: { startMs: number; endMs: number } | null;
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

function paintStrip(
  canvas: HTMLCanvasElement,
  lanes: MiniMapLane[],
  range: MiniMapRange,
  view: { startMs: number; endMs: number } | null,
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
  const visible = viewportWindow(view, range, drawableWidth);
  const x0 = SIDE_INSET_PX + visible.x0;
  const width = Math.max(MIN_WINDOW_WIDTH_PX, visible.x1 - visible.x0);
  context.globalAlpha = WINDOW_FILL_OPACITY;
  context.fillStyle = colors.guide;
  context.fillRect(x0, 2, width, cssHeight - 4);
  context.globalAlpha = 1;
  context.strokeStyle = colors.guide;
  context.lineWidth = 2;
  context.strokeRect(x0, 2, width, cssHeight - 4);
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

  const flyTo = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget;
    const bounds = canvas.getBoundingClientRect();
    const drawableWidth = bounds.width - SIDE_INSET_PX * 2;
    engineRef.current?.centerOnMs(
      stripXToMs(event.clientX - bounds.left - SIDE_INSET_PX, range, drawableWidth),
    );
  };

  return (
    <canvas
      ref={canvasRef}
      className="mobile-strip"
      style={{ height }}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        flyTo(event);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) flyTo(event);
      }}
    />
  );
}
