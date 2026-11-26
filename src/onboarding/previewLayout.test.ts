import { describe, expect, test } from "vitest";
import { layoutPreview, previewLanes, PREVIEW_TOP } from "./previewLayout";
import type { PreviewLane } from "./previewLayout";
import type { Sequence, SequenceItem } from "./sequence";

function item(label: string, at: number, gap = false): SequenceItem {
  return { key: label + at, label, fallback: "", at, gap };
}

const EMPTY: Sequence = { items: [], end: null };
type RowLane = Extract<PreviewLane, { kind: "row" }>;
const row = (bars: RowLane["bars"]): PreviewLane => ({
  kind: "row",
  icon: "🏠",
  color: "#8ba66f",
  indent: 0,
  bars,
});

describe("previewLanes", () => {
  test("places always, other topics once they have something, gaps never", () => {
    const lanes = previewLanes(
      [
        { icon: "🏠", color: "a", sequence: EMPTY, always: true },
        { icon: "🎓", color: "b", sequence: { items: [item("Bachelor", 19), item("", 22, true), item("Master", 31)], end: 33 } },
        { icon: "💼", color: "c", sequence: EMPTY },
      ],
      { kids: [], grandkids: [] },
      1986,
      "k",
    );
    expect(lanes.map((lane) => lane.icon)).toEqual(["🏠", "🎓"]);
    const education = lanes[1] as RowLane;
    expect(education.bars).toEqual([
      { from: 19, to: 22, label: "Bachelor" },
      { from: 31, to: 33, label: "Master" },
    ]);
  });

  test("a Family band, each kid indented, grandkids under their parent", () => {
    const lanes = previewLanes(
      [],
      {
        kids: [
          { key: "a", name: "Mia", year: 2012 },
          { key: "b", name: "", year: 2015 },
        ],
        grandkids: [{ key: "g", parentKey: "a", name: "", year: 2030 }],
      },
      1986,
      "k",
    );
    expect(lanes.map((lane) => (lane.kind === "header" ? lane.label : lane.bars[0].label))).toEqual([
      "Family",
      "Mia · 2012",
      "Grandchild · 2030",
      "Child 2 · 2015",
    ]);
    expect(lanes.map((lane) => (lane.kind === "row" ? lane.indent : 0))).toEqual([0, 10, 16, 10]);
  });
});

describe("layoutPreview", () => {
  const base = { width: 340, maxHeight: 400, span: 40.75, birthYear: 1986 };

  test("bars run from their start to their end, an ongoing one to the right edge", () => {
    const layout = layoutPreview({ ...base, lanes: [row([{ from: 0, to: 20, label: "Hamburg" }, { from: 20, to: null, label: "Berlin" }])] });
    const [hamburg, berlin] = layout.lanes[0].bars;
    expect(hamburg.x).toBe(layout.x0);
    expect(berlin.x + berlin.width).toBeCloseTo(layout.x1 - 1.5);
    expect(berlin.alt).toBe(true);
  });

  test("tick labels never sit closer than 40px, and none crowd the right edge", () => {
    const layout = layoutPreview({ ...base, width: 200, span: 80.75, birthYear: 1946, lanes: [] });
    const labelled = layout.ticks.filter((tick) => tick.labelX !== null).map((tick) => tick.labelX!);
    labelled.slice(1).forEach((labelX, index) => expect(labelX - labelled[index]).toBeGreaterThanOrEqual(40));
    layout.ticks.forEach((tick) => {
      if (tick.labelX !== null) expect(layout.x1 - tick.x).toBeGreaterThanOrEqual(14);
    });
  });

  test("lanes get thinner before the preview outgrows its height, and lose labels when too thin", () => {
    const many = Array.from({ length: 30 }, () => row([{ from: 0, to: null, label: "Something long" }]));
    const roomy = layoutPreview({ ...base, lanes: many.slice(0, 3) });
    expect(roomy.lanes[0].height).toBe(15);
    const tight = layoutPreview({ ...base, maxHeight: 200, lanes: many.slice(0, 12) });
    expect(tight.lanes[0].height).toBeLessThan(15);
    expect(tight.height).toBeLessThanOrEqual(200);
    const crowded = layoutPreview({ ...base, maxHeight: 200, lanes: many });
    expect(crowded.lanes[0].height).toBe(8);
    expect(crowded.lanes[0].bars[0].label).toBeNull();
  });

  test("the first lane starts under the tick labels", () => {
    expect(layoutPreview({ ...base, lanes: [row([])] }).lanes[0].y).toBe(PREVIEW_TOP);
  });

  test("a bar is never thinner than 3px, so a one-year span still shows", () => {
    const layout = layoutPreview({ ...base, span: 100, lanes: [row([{ from: 50, to: 50, label: "" }])] });
    expect(layout.lanes[0].bars[0].width).toBeGreaterThanOrEqual(3);
  });
});
