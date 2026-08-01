import { describe, expect, test } from "vitest";
import {
  barGeometry,
  gradientStops,
  labelAnchorX,
  labelLimitX,
  MIN_LABEL_WIDTH_PX,
  pickBarLabel,
  truncateToWidth,
} from "./bars";
import type { BarGeometry } from "./bars";
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

describe("pickBarLabel", () => {
  const geom = barGeometry(entry({ end: { ms: T0 + 100 * DAY_MS, precision: "day" } }), scale, NOW);

  test("uses the title when it fits", () => {
    expect(pickBarLabel({ title: "Short" }, geom, 10)).toBe("title");
  });

  test("uses the title when it overflows but there's no shortTitle", () => {
    expect(pickBarLabel({ title: "A very long title indeed" }, geom, 500)).toBe("title");
  });

  test("swaps to shortTitle when the title overflows and a shortTitle is set", () => {
    expect(pickBarLabel({ title: "A very long title indeed", shortTitle: "Long" }, geom, 500)).toBe("shortTitle");
  });
});

describe("labelLimitX", () => {
  // Three bars on one row: a long one, a short one nested inside it, and one
  // that starts before all of them.
  const bar = (visualStart: number, solidStart: number): BarGeometry =>
    ({ xVisualStart: visualStart, xSolidStart: solidStart, xSolidEnd: 0, xVisualEnd: 0 }) as BarGeometry;

  test("falls back to the viewport edge when nothing follows", () => {
    expect(labelLimitX(0, [bar(10, 20)], 800)).toBe(800);
  });

  test("stops at the nearest bar starting to the right", () => {
    const geometries = [bar(10, 20), bar(300, 310), bar(120, 130)];
    expect(labelLimitX(0, geometries, 800)).toBe(120);
  });

  test("a bar nested inside a longer one still clamps it", () => {
    // This is the reported bug: the short bar sits within the long bar's span,
    // and the long bar's label used to be drawn straight across it.
    const geometries = [bar(0, 0), bar(200, 200)];
    expect(labelLimitX(0, geometries, 800)).toBe(200);
  });

  test("ignores bars that start left of this label's anchor", () => {
    const geometries = [bar(400, 410), bar(50, 60)];
    expect(labelLimitX(0, geometries, 800)).toBe(800);
  });
});

describe("truncateToWidth", () => {
  // One unit per character keeps the arithmetic in the test obvious. Budgets
  // stay above MIN_LABEL_WIDTH_PX so they exercise the cut, not the guard.
  const measure = (text: string) => text.length;
  const LONG_TITLE = "Studied computer science at university";

  test("leaves a label that already fits alone", () => {
    expect(truncateToWidth("Berlin", 100, measure)).toBe("Berlin");
  });

  test("cuts to the available width and marks the cut", () => {
    const result = truncateToWidth("Studied computer science", 30, measure);
    expect(result).toBe("Studied computer science"); // 24 units — nothing to cut
    expect(truncateToWidth("Studied computer science", 40, measure)).toBe("Studied computer science");
  });

  test("keeps as much of the label as fits, plus the ellipsis", () => {
    // 29 characters and the ellipsis come to exactly 30 units.
    expect(truncateToWidth(LONG_TITLE, 30, measure)).toBe("Studied computer science at u…");
  });

  test("does not leave a dangling space before the ellipsis", () => {
    // The cut lands on the space after "science"; trimming it back makes the
    // label one unit shorter than the budget, which is fine — a floating "…"
    // is not.
    expect(truncateToWidth(LONG_TITLE, 25, measure)).toBe("Studied computer science…");
  });

  test("draws nothing rather than a lone ellipsis in a sliver of space", () => {
    expect(truncateToWidth("Berlin", MIN_LABEL_WIDTH_PX - 1, measure)).toBe("");
  });

  test("never returns a label wider than the space given", () => {
    for (let available = MIN_LABEL_WIDTH_PX; available < 60; available++) {
      expect(measure(truncateToWidth("A fairly long entry title here", available, measure))).toBeLessThanOrEqual(
        available,
      );
    }
  });
});
