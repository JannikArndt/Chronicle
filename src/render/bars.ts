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
