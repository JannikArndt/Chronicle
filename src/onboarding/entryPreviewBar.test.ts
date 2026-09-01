import { describe, expect, test } from "vitest";
import { previewBar, previewPin } from "./entryPreviewBar";
import type { TimelineEntry } from "../model/types";

const NOW_MS = Date.UTC(2026, 6, 31);
const RANGE = { startMs: Date.UTC(1990, 0, 1), endMs: Date.UTC(2027, 0, 1) };

function entry(overrides: Partial<TimelineEntry>): TimelineEntry {
  return {
    id: "e1",
    rowId: "r1",
    title: "Test",
    start: { ms: Date.UTC(2010, 6, 1), precision: "year" },
    ...overrides,
  };
}

describe("previewBar", () => {
  test("an ended entry sits inside the lane and is marked not ongoing", () => {
    const bar = previewBar(
      entry({ end: { ms: Date.UTC(2015, 6, 1), precision: "year" } }),
      RANGE,
      NOW_MS,
    );
    expect(bar.ongoing).toBe(false);
    expect(bar.leftPercent).toBeGreaterThan(0);
    expect(bar.leftPercent + bar.widthPercent).toBeLessThan(100);
  });

  test("an ongoing entry runs to now", () => {
    const bar = previewBar(entry({}), RANGE, NOW_MS);
    expect(bar.ongoing).toBe(true);
    // `now` is very near the right edge of this lane.
    expect(bar.leftPercent + bar.widthPercent).toBeGreaterThan(95);
  });

  // The visible payoff of the fuzz pills: a vaguer answer has a longer ramp
  // before the bar reaches full colour.
  test("a fuzzier start pushes the solid stop further into the bar", () => {
    const ended = { end: { ms: Date.UTC(2020, 6, 1), precision: "year" as const } };
    const sharp = previewBar(entry(ended), RANGE, NOW_MS);
    const vague = previewBar(
      entry({ ...ended, start: { ms: Date.UTC(2010, 6, 1), precision: "circa", fuzzDays: 730 } }),
      RANGE,
      NOW_MS,
    );
    expect(vague.solidStartPercent).toBeGreaterThan(sharp.solidStartPercent);
    expect(vague.leftPercent).toBeLessThan(sharp.leftPercent);
  });

  test("gradient stops stay within the bar, and the bar within the lane", () => {
    const bar = previewBar(
      entry({
        start: { ms: Date.UTC(1990, 0, 1), precision: "circa", fuzzDays: 3650 },
        end: { ms: Date.UTC(2026, 6, 1), precision: "circa", fuzzDays: 3650 },
      }),
      RANGE,
      NOW_MS,
    );
    for (const value of [bar.leftPercent, bar.widthPercent, bar.solidStartPercent, bar.solidEndPercent]) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
  });

  test("a same-day entry still gets a visible width", () => {
    const sameDay = Date.UTC(2012, 3, 5);
    const bar = previewBar(
      entry({ start: { ms: sameDay, precision: "day" }, end: { ms: sameDay, precision: "day" } }),
      RANGE,
      NOW_MS,
    );
    expect(bar.widthPercent).toBeGreaterThan(0);
  });
});

describe("previewPin", () => {
  test("stands at its own instant, in the middle of its band", () => {
    const pin = previewPin({ ms: Date.UTC(2010, 6, 1), precision: "year" }, RANGE);
    expect(pin.bandLeftPercent).toBeLessThan(pin.leftPercent);
    expect(pin.bandLeftPercent + pin.bandWidthPercent).toBeGreaterThan(pin.leftPercent);
  });

  test("a day-precise moment has no band — nothing to be vague about", () => {
    const pin = previewPin({ ms: Date.UTC(2010, 6, 1), precision: "day" }, RANGE);
    expect(pin.bandWidthPercent).toBe(0);
  });

  test("the vaguer the date, the wider the band", () => {
    const around = previewPin({ ms: Date.UTC(2010, 6, 1), precision: "circa" }, RANGE);
    const vague = previewPin({ ms: Date.UTC(2010, 6, 1), precision: "circa", fuzzDays: 730 }, RANGE);
    expect(vague.bandWidthPercent).toBeGreaterThan(around.bandWidthPercent);
  });
});
