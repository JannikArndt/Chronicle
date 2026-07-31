import { describe, expect, test } from "vitest";
import { dateLaneRange, laneFraction, laneFractionToMs } from "./dateLaneRange";

const YEAR_MS = 365.25 * 86_400_000;
const MONTH_MS = YEAR_MS / 12;

describe("dateLaneRange", () => {
  test("pads a multi-year entry generously on both sides", () => {
    const start = Date.UTC(2010, 0, 1);
    const end = Date.UTC(2020, 0, 1);
    const range = dateLaneRange(start, end);
    expect(range.startMs).toBeLessThan(start);
    expect(range.endMs).toBeGreaterThan(end);
    expect(end - start - (range.endMs - range.startMs)).toBeLessThan(0);
  });

  test("keeps a short entry's bar wide enough to separate its two handles", () => {
    const start = Date.UTC(2016, 0, 1);
    const range = dateLaneRange(start, start + MONTH_MS);
    const barFraction = laneFraction(start + MONTH_MS, range) - laneFraction(start, range);
    expect(barFraction).toBeGreaterThanOrEqual(0.17);
  });

  test("a zero-length entry still gets a lane rather than a point", () => {
    const start = Date.UTC(2016, 0, 1);
    const range = dateLaneRange(start, start);
    expect(range.endMs - range.startMs).toBeGreaterThan(YEAR_MS);
  });
});

describe("both handles stay inside the lane", () => {
  const inLane = (ms: number, range: { startMs: number; endMs: number }) => {
    const fraction = laneFraction(ms, range);
    return fraction >= 0 && fraction <= 1;
  };

  // The regression: toggling "still ongoing" moves the end to today. A lane
  // still framed on the old end left the end handle off-screen to the right.
  test("after switching to ongoing, the end handle is within [0, 1]", () => {
    const start = Date.UTC(2010, 0, 1);
    const nowMs = Date.UTC(2026, 6, 31);
    const range = dateLaneRange(start, nowMs);
    expect(inLane(start, range)).toBe(true);
    expect(inLane(nowMs, range)).toBe(true);
  });

  test("both handles are inside the lane for spans from a day to a lifetime", () => {
    const start = Date.UTC(1990, 0, 1);
    for (const span of [0, 86_400_000, MONTH_MS, YEAR_MS, 40 * YEAR_MS]) {
      const range = dateLaneRange(start, start + span);
      expect(inLane(start, range)).toBe(true);
      expect(inLane(start + span, range)).toBe(true);
    }
  });
});

describe("lane coordinates round-trip", () => {
  test("a fraction converts back to the instant it came from", () => {
    const range = dateLaneRange(Date.UTC(2000, 0, 1), Date.UTC(2010, 0, 1));
    const ms = Date.UTC(2005, 5, 15);
    expect(laneFractionToMs(laneFraction(ms, range), range)).toBeCloseTo(ms, 0);
  });
});
