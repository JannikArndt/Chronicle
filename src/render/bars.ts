// Pure bar geometry — everything the engine needs to draw an entry, kept out
// of the canvas code so it can be unit-tested.

import { rampBounds } from "../model/fuzzyDate";
import type { TimelineEntry } from "../model/types";
import type { TimeScale } from "./timeScale";
import { msToX } from "./timeScale";

export interface BarGeometry {
  xVisualStart: number;
  xSolidStart: number;
  xSolidEnd: number;
  xVisualEnd: number;
  ongoing: boolean;
}

export function barGeometry(entry: TimelineEntry, scale: TimeScale, nowMs: number): BarGeometry {
  const bounds = rampBounds(entry, nowMs);
  return {
    xVisualStart: msToX(scale, bounds.visualStart),
    xSolidStart: msToX(scale, bounds.solidStart),
    xSolidEnd: msToX(scale, bounds.solidEnd),
    xVisualEnd: msToX(scale, bounds.visualEnd),
    ongoing: bounds.ongoing,
  };
}

export interface GradientStop {
  offset: number; // 0..1 across [xVisualStart, xVisualEnd]
  alpha: number;
}

// ONE continuous gradient per bar (§5): fuzz and fade share a single alpha
// ramp — never a solid rect butted against a gradient rect (the seam between
// separately drawn regions was a visible defect in the prototype).
export function gradientStops(geom: BarGeometry): GradientStop[] {
  const width = geom.xVisualEnd - geom.xVisualStart;
  if (width <= 0) return [{ offset: 0, alpha: 1 }, { offset: 1, alpha: 1 }];
  const at = (x: number) => Math.min(1, Math.max(0, (x - geom.xVisualStart) / width));

  const stops: GradientStop[] = [];
  const solidStartOffset = at(geom.xSolidStart);
  const solidEndOffset = at(geom.xSolidEnd);
  stops.push({ offset: 0, alpha: solidStartOffset > 0 ? 0 : 1 });
  if (solidStartOffset > 0) stops.push({ offset: solidStartOffset, alpha: 1 });
  if (solidEndOffset < 1) stops.push({ offset: solidEndOffset, alpha: 1 });
  stops.push({ offset: 1, alpha: solidEndOffset < 1 ? 0 : 1 });
  return stops;
}

// The label must stay legible wherever the alpha is low (§5): anchor it at the
// start of the near-opaque span, clamped into the visible viewport.
export function labelAnchorX(geom: BarGeometry, textWidth: number, viewportWidth: number): number {
  const padding = 6;
  let x = geom.xSolidStart + padding;
  // Keep the label on-screen while the solid span allows it.
  x = Math.max(x, padding);
  x = Math.min(x, Math.max(geom.xSolidStart + padding, geom.xSolidEnd - textWidth - padding));
  x = Math.min(x, viewportWidth - textWidth - padding);
  return Math.max(x, Math.max(geom.xSolidStart + padding, 0 + padding));
}

// The x a label must stop before: where the next bar on this row begins. Rows
// are concurrent, so "next" is not simply the following array element — a short
// bar frequently sits wholly inside a long one, and it is precisely that case
// the label must not be drawn across.
//
// Only bars starting to the right of this label's anchor can clamp it; one that
// starts further left is already behind this bar's own label position.
export function labelLimitX(index: number, geometries: BarGeometry[], viewportWidth: number): number {
  const own = geometries[index];
  let limit = viewportWidth;
  for (let i = 0; i < geometries.length; i++) {
    if (i === index) continue;
    const other = geometries[i];
    if (other.xVisualStart > own.xSolidStart && other.xVisualStart < limit) limit = other.xVisualStart;
  }
  return limit;
}

// Shortens a label to fit, with an ellipsis. `measure` is the caller's
// ctx.measureText, which keeps this function pure and unit-testable — the
// canvas is the only thing that knows how wide a string actually is.
//
// Below MIN_LABEL_WIDTH_PX there is no honest label left to draw, so nothing is
// drawn: "…" on its own tells the reader less than the bar's colour does.
export const MIN_LABEL_WIDTH_PX = 24;

export function truncateToWidth(
  text: string,
  available: number,
  measure: (candidate: string) => number,
): string {
  if (available < MIN_LABEL_WIDTH_PX) return "";
  if (measure(text) <= available) return text;

  let fits = 0;
  let tooLong = text.length;
  while (fits < tooLong) {
    const middle = Math.ceil((fits + tooLong) / 2);
    if (measure(`${text.slice(0, middle).trimEnd()}…`) <= available) fits = middle;
    else tooLong = middle - 1;
  }
  return fits === 0 ? "" : `${text.slice(0, fits).trimEnd()}…`;
}

// Falls back to shortTitle only when the full title actually overflows the
// bar's near-opaque span — never swaps just because a shortTitle exists.
export function pickBarLabel(
  entry: { title: string; shortTitle?: string },
  geom: BarGeometry,
  measuredTitleWidth: number,
  padding = 6,
): "title" | "shortTitle" {
  if (!entry.shortTitle) return "title";
  const available = geom.xSolidEnd - geom.xSolidStart - padding * 2;
  return measuredTitleWidth > available ? "shortTitle" : "title";
}
