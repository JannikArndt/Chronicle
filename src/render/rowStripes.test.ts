import { describe, expect, test } from "vitest";
import { ROW_STRIPES, rowStripes } from "./rowStripes";
import type { RowStripeSettings } from "./rowStripes";
import { ROW_GAP, ROW_HEIGHT } from "./layout";
import type { LayoutItem } from "./layout";

function row(id: string, y: number, depth = 0): LayoutItem {
  return { kind: "row", id, y, height: ROW_HEIGHT, depth };
}

function expandedGroup(id: string, y: number, depth = 0): LayoutItem {
  return { kind: "group", id, y, height: 32, depth, subtreeEndY: y + 200 };
}

function collapsedGroup(id: string, y: number, depth = 0): LayoutItem {
  return { kind: "group", id, y, height: ROW_HEIGHT, depth, summaries: [] };
}

// Every case that asserts a raw `y` pins `includeGaps: false`, so the numbers
// below are the row's own box and the gap padding is tested on its own.
const settings = (patch: Partial<RowStripeSettings>): RowStripeSettings => ({
  ...ROW_STRIPES,
  includeGaps: false,
  ...patch,
});

describe("rowStripes", () => {
  test("stripes every other timeline", () => {
    const items = [row("r1", 0), row("r2", 50), row("r3", 100), row("r4", 150)];
    expect(rowStripes(items, settings({ scope: "all" })).map((s) => s.y)).toEqual([0, 100]);
  });

  test("offset 1 inverts which rows are painted", () => {
    const items = [row("r1", 0), row("r2", 50), row("r3", 100)];
    expect(rowStripes(items, settings({ scope: "all", offset: 1 })).map((s) => s.y)).toEqual([50]);
  });

  // The header is counted like everything else. Skipped, it used to leave two
  // unstriped items next to each other — their bands merged, and the timeline
  // above the group ended up visibly off-centre in the result.
  test("an expanded group's header takes a slot of its own, like every other item", () => {
    const items = [expandedGroup("g1", 0), row("r1", 40, 1), collapsedGroup("g2", 100)];
    expect(rowStripes(items, settings({ scope: "all" })).map((s) => s.y)).toEqual([0, 100]);
  });

  test("scope 'all' alternates strictly, so no two adjacent items share a band", () => {
    const items = [row("top1", 0), expandedGroup("g1", 50), row("in1", 100, 1), row("in2", 150, 1)];
    expect(rowStripes(items, settings({ scope: "all" })).map((s) => s.y)).toEqual([0, 100]);
  });

  test("scope 'group' restarts the count inside each group and resumes outside it", () => {
    const items = [
      row("top1", 0), // depth 0, index 0 → striped
      expandedGroup("g1", 50), // depth 0, index 1
      row("in1", 100, 1), // depth 1, index 0 → striped
      row("in2", 150, 1), // depth 1, index 1
      row("top2", 200), // depth 0, index 2 → striped, the root count carried on
    ];
    expect(rowStripes(items, settings({ scope: "group" })).map((s) => s.y)).toEqual([0, 100, 200]);
  });

  test("includeGaps grows each stripe by half the row gap on both sides", () => {
    const [stripe] = rowStripes([row("r1", 100)], settings({ scope: "all", includeGaps: true }));
    expect(stripe).toEqual({ y: 100 - ROW_GAP / 2, height: ROW_HEIGHT + ROW_GAP });
  });

  // What the whole shape is for: with one gap between every pair of items and
  // half of it on each side of a band, every item has the same amount of air
  // above and below it before the background changes.
  test("consecutive bands meet exactly halfway between two items", () => {
    const items = [row("r1", 5), row("r2", 55), row("r3", 105)];
    const [first, second] = rowStripes(items, settings({ scope: "all", includeGaps: true }));
    expect(first.y + first.height).toBe(50); // halfway down the r1→r2 gap
    expect(second.y).toBe(100); // halfway down the r2→r3 gap
    // r2, the unstriped one, is centred in the band left between them.
    expect(items[1].y - (first.y + first.height)).toBe(ROW_GAP / 2);
    expect(second.y - (items[1].y + items[1].height)).toBe(ROW_GAP / 2);
  });

  test("nothing is painted when striping is off or turned all the way down", () => {
    const items = [row("r1", 0), row("r2", 50)];
    expect(rowStripes(items, settings({ enabled: false }))).toEqual([]);
    expect(rowStripes(items, settings({ strength: 0 }))).toEqual([]);
  });
});
