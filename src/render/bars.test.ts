import { describe, expect, test } from "vitest";
import { barGeometry, gradientStops, labelAnchorX } from "./bars";
import { DAY_MS } from "../model/fuzzyDate";
import type { TimelineEntry } from "../model/types";

const T0 = Date.UTC(2020, 0, 1);
const NOW = T0 + 1000 * DAY_MS;
const scale = { startMs: T0, msPerPx: DAY_MS }; // 1px = 1 day

function entry(overrides: Partial<TimelineEntry>): TimelineEntry {
  return {
    id: "e1",
    rowId: "r1",
    title: "t",
    start: { ms: T0, precision: "day" },
    linkedEntityIds: [],
    visibility: "private",
    ...overrides,
  };
}

describe("barGeometry", () => {
  test("maps ramp bounds into pixel space", () => {
    const geom = barGeometry(
      entry({ start: { ms: T0, precision: "month" }, fadeInDays: 10, end: { ms: T0 + 100 * DAY_MS, precision: "day" } }),
      scale,
      NOW,
    );
    expect(geom.xVisualStart).toBe(-15);
    expect(geom.xSolidStart).toBe(25); // fuzz 15 + fade 10
    expect(geom.xSolidEnd).toBe(100);
    expect(geom.xVisualEnd).toBe(100);
    expect(geom.ongoing).toBe(false);
  });

  test("ongoing entries end at now", () => {
    const geom = barGeometry(entry({}), scale, T0 + 50 * DAY_MS);
    expect(geom.ongoing).toBe(true);
    expect(geom.xVisualEnd).toBe(50);
  });
});

describe("gradientStops", () => {
  test("hard-edged bar has full alpha end to end", () => {
    const stops = gradientStops(barGeometry(entry({ end: { ms: T0 + 10 * DAY_MS, precision: "day" } }), scale, NOW));
    expect(stops[0]).toEqual({ offset: 0, alpha: 1 });
    expect(stops[stops.length - 1]).toEqual({ offset: 1, alpha: 1 });
  });

  test("fuzzy edges ramp from 0 to 1 and back inside one gradient", () => {
    const stops = gradientStops(
      barGeometry(
        entry({ start: { ms: T0, precision: "month" }, end: { ms: T0 + 100 * DAY_MS, precision: "month" } }),
        scale,
        NOW,
      ),
    );
    expect(stops[0].alpha).toBe(0);
    expect(stops[stops.length - 1].alpha).toBe(0);
    expect(Math.max(...stops.map((s) => s.alpha))).toBe(1);
    // offsets strictly non-decreasing within [0, 1]
    for (let i = 1; i < stops.length; i++) expect(stops[i].offset).toBeGreaterThanOrEqual(stops[i - 1].offset);
    expect(stops[0].offset).toBe(0);
    expect(stops[stops.length - 1].offset).toBe(1);
  });
});

describe("labelAnchorX", () => {
  test("anchors inside the solid span, not at the fuzzy nominal edge", () => {
    const geom = barGeometry(
      entry({ start: { ms: T0, precision: "circa" }, end: { ms: T0 + 900 * DAY_MS, precision: "day" } }),
      scale,
      NOW,
    );
    const x = labelAnchorX(geom, 50, 1000);
    expect(x).toBeGreaterThanOrEqual(geom.xSolidStart);
  });

  test("clamps into the viewport when the solid span starts off-screen", () => {
    const shifted = { startMs: T0 - 500 * DAY_MS, msPerPx: DAY_MS };
    const geom = barGeometry(entry({ end: { ms: T0 + 900 * DAY_MS, precision: "day" } }), shifted, NOW);
    // solid span starts at x=500... viewport shows it; move scale so bar starts left of 0
    const geomOff = barGeometry(entry({ start: { ms: T0 - 600 * DAY_MS, precision: "day" }, end: { ms: T0 + 900 * DAY_MS, precision: "day" } }), shifted, NOW);
    expect(geomOff.xSolidStart).toBeLessThan(0);
    expect(labelAnchorX(geomOff, 50, 1000)).toBeGreaterThanOrEqual(0);
    expect(labelAnchorX(geom, 50, 1000)).toBeGreaterThanOrEqual(geom.xSolidStart);
  });
});
