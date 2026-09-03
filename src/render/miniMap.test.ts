import { describe, expect, it } from "vitest";
import { computeLayout } from "./layout";
import {
  miniMapLanes,
  miniMapMetrics,
  miniMapTimeRange,
  stripXToMs,
  stripYToLayoutY,
  viewportWindow,
} from "./miniMap";
import type { TimelineDataset } from "../model/types";
import { hiddenIdsOf } from "../model/hidden";

const YEAR_MS = 365.25 * 86_400_000;
const NOW_MS = Date.UTC(2026, 0, 1);

function datasetWithRows(rowCount: number, entriesPerRow = 1): TimelineDataset {
  const rows = Array.from({ length: rowCount }, (_, index) => ({
    id: `row-${index}`,
    groupId: "group-1",
    label: `Row ${index}`,
    color: index % 2 === 0 ? "#b45309" : undefined,
  }));
  const entries = rows.flatMap((row, rowIndex) =>
    Array.from({ length: entriesPerRow }, (_, entryIndex) => ({
      id: `${row.id}-entry-${entryIndex}`,
      rowId: row.id,
      title: "Something",
      start: { ms: Date.UTC(2000 + rowIndex, 0, 1), precision: "year" as const },
      end: { ms: Date.UTC(2005 + rowIndex, 0, 1), precision: "year" as const },
    })),
  );
  return {
    schemaVersion: 5,
    groups: [{ id: "group-1", label: "Life", collapsed: false }],
    rows,
    entries,
    // The minimap is an overview of spans; events are a zoomed-in detail and
    // deliberately have no lane in it.
    events: [],
  };
}

function lanesFor(dataset: TimelineDataset, hiddenRowIds: string[] = []) {
  const layout = computeLayout(dataset, new Set(), hiddenIdsOf(hiddenRowIds, []));
  return miniMapLanes(layout, dataset, NOW_MS);
}

describe("miniMapLanes", () => {
  it("gives every visible row its own lane, in layout order", () => {
    const lanes = lanesFor(datasetWithRows(3));
    expect(lanes.map((lane) => lane.rowId)).toEqual(["row-0", "row-1", "row-2"]);
  });

  it("drops hidden rows so the strip re-fits", () => {
    const lanes = lanesFor(datasetWithRows(3), ["row-1"]);
    expect(lanes.map((lane) => lane.rowId)).toEqual(["row-0", "row-2"]);
  });

  it("falls back to the canvas's default colour for a row without one", () => {
    const lanes = lanesFor(datasetWithRows(2));
    expect(lanes[0].color).toBe("#b45309");
    expect(lanes[1].color).toBe("#888");
  });

  it("ends an ongoing entry at now rather than leaving it open", () => {
    const dataset = datasetWithRows(1);
    delete dataset.entries[0].end;
    expect(lanesFor(dataset)[0].spans[0].endMs).toBe(NOW_MS);
  });
});

describe("miniMapMetrics", () => {
  // 1, 8, 30 and 60 lanes: the last is where the design gives up, and this
  // pins down what "gives up" means.
  it("keeps a single lane at full pitch and the strip at its minimum height", () => {
    const metrics = miniMapMetrics(1);
    expect(metrics.pitch).toBe(6.5);
    expect(metrics.height).toBe(58);
  });

  it("still uses full pitch at the 8-lane limit", () => {
    expect(miniMapMetrics(8).pitch).toBe(6.5);
  });

  it("thins lanes and grows the strip at 30 lanes", () => {
    const metrics = miniMapMetrics(30);
    expect(metrics.pitch).toBeCloseTo(2.6, 5);
    expect(metrics.barHeight).toBeCloseTo(1.5, 5);
    expect(metrics.height).toBe(100);
  });

  it("bottoms out rather than vanishing at 60 lanes", () => {
    const metrics = miniMapMetrics(60);
    // The pitch floor wins over the budget here: 78/60 = 1.3 is below it.
    expect(metrics.pitch).toBe(2.2);
    expect(metrics.barHeight).toBe(1.4);
    // 60 × 2.2 + 22 overflows the cap, so the strip stops growing — the last
    // lanes are clipped rather than shrunk into nothing.
    expect(metrics.height).toBe(104);
  });

  it("treats zero lanes as one, so an empty dataset still has a strip", () => {
    expect(miniMapMetrics(0)).toEqual(miniMapMetrics(1));
  });
});

describe("miniMapTimeRange", () => {
  it("spans the data plus a margin at both ends", () => {
    const lanes = [{ rowId: "a", color: "#000", spans: [{ startMs: 0, endMs: 40 * YEAR_MS }] }];
    const range = miniMapTimeRange(lanes, 0);
    expect(range.startMs).toBeLessThan(0);
    expect(range.endMs).toBeGreaterThan(40 * YEAR_MS);
  });

  it("reaches up to now even when nothing recent is recorded", () => {
    const lanes = [{ rowId: "a", color: "#000", spans: [{ startMs: 0, endMs: YEAR_MS }] }];
    expect(miniMapTimeRange(lanes, 100 * YEAR_MS).endMs).toBeGreaterThan(100 * YEAR_MS);
  });

  it("gives an empty dataset a draggable range instead of a single instant", () => {
    const range = miniMapTimeRange([], NOW_MS);
    expect(range.endMs - range.startMs).toBeGreaterThan(YEAR_MS);
  });
});

describe("viewportWindow", () => {
  const range = { startMs: 0, endMs: 100 };
  const BAND = 60;
  // Rows taller than the canvas: the case where the vertical window is not the
  // whole band.
  const scrolled = { startMs: 25, endMs: 75, scrollY: 100, visibleHeight: 200, totalHeight: 600 };

  it("maps the visible time span onto the strip", () => {
    const window = viewportWindow(scrolled, range, 200, BAND);
    expect(window.x0).toBe(50);
    expect(window.x1).toBe(150);
  });

  it("clamps a view panned off the end of the data to the strip", () => {
    const window = viewportWindow({ ...scrolled, startMs: 500, endMs: 550 }, range, 200, BAND);
    expect(window.x0).toBe(200);
    expect(window.x1).toBe(200);
  });

  it("spans the whole lane band when every row is already on screen", () => {
    const everything = { ...scrolled, scrollY: 0, visibleHeight: 400, totalHeight: 300 };
    const window = viewportWindow(everything, range, 200, BAND);
    expect(window.y0).toBe(0);
    expect(window.y1).toBe(BAND);
  });

  it("shrinks and moves down as the canvas scrolls past rows below the fold", () => {
    const window = viewportWindow(scrolled, range, 200, BAND);
    expect(window.y0).toBe(10);
    expect(window.y1).toBe(30);
  });

  it("clamps the bottom edge to the band when scrolled past the last row", () => {
    const overscrolled = { ...scrolled, scrollY: 550 };
    const window = viewportWindow(overscrolled, range, 200, BAND);
    expect(window.y1).toBe(BAND);
    expect(window.y0).toBe(55);
  });

  it("survives a layout with no height at all — an empty dataset", () => {
    const empty = { ...scrolled, scrollY: 0, visibleHeight: 0, totalHeight: 0 };
    const window = viewportWindow(empty, range, 200, BAND);
    expect(window.y0).toBe(0);
    expect(window.y1).toBe(BAND);
  });
});

describe("stripYToLayoutY", () => {
  it("inverts the lane-band mapping", () => {
    expect(stripYToLayoutY(30, 60, 600)).toBe(300);
  });

  it("clamps a drag that leaves the band", () => {
    expect(stripYToLayoutY(-20, 60, 600)).toBe(0);
    expect(stripYToLayoutY(999, 60, 600)).toBe(600);
  });
});

describe("stripXToMs", () => {
  it("inverts the strip mapping", () => {
    expect(stripXToMs(100, { startMs: 0, endMs: 100 }, 200)).toBe(50);
  });

  it("clamps a drag that leaves the strip", () => {
    expect(stripXToMs(-40, { startMs: 0, endMs: 100 }, 200)).toBe(0);
    expect(stripXToMs(999, { startMs: 0, endMs: 100 }, 200)).toBe(100);
  });
});
