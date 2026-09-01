import { describe, expect, test } from "vitest";
import { MIN_GAP_FOR_PLUS_PX, plusSpots } from "./plusSpots";
import { DAY_MS } from "../model/fuzzyDate";
import type { TimelineEntry } from "../model/types";

const T0 = Date.UTC(2020, 0, 1);
const scale = { startMs: T0, msPerPx: DAY_MS }; // 1px = 1 day
const NOW = T0 + 1000 * DAY_MS;

function entry(id: string, startMs: number, endMs?: number): TimelineEntry {
  return {
    id,
    rowId: "r1",
    title: id,
    start: { ms: startMs, precision: "day" },
    ...(endMs !== undefined ? { end: { ms: endMs, precision: "day" } } : {}),
  };
}

describe("plusSpots", () => {
  test("a remembered click always wins, even on a row with entries", () => {
    const entries = [entry("a", T0, T0 + 10 * DAY_MS), entry("b", T0 + 20 * DAY_MS, T0 + 30 * DAY_MS)];
    const clickedMs = T0 + 5000 * DAY_MS;
    const spots = plusSpots({ entries, scale, width: 800, nowMs: NOW, clickedMs });
    expect(spots).toEqual([{ x: (clickedMs - T0) / DAY_MS, startMs: clickedMs }]);
  });

  test("a remembered click wins on an empty row too", () => {
    const clickedMs = T0 + 42 * DAY_MS;
    const spots = plusSpots({ entries: [], scale, width: 800, nowMs: NOW, clickedMs });
    expect(spots).toEqual([{ x: 42, startMs: clickedMs }]);
  });

  test("empty row with no click falls back to the horizontal centre", () => {
    const spots = plusSpots({ entries: [], scale, width: 800, nowMs: NOW, clickedMs: null });
    expect(spots).toHaveLength(1);
    expect(spots[0].x).toBe(400);
    expect(spots[0].startMs).toBe(T0 + 400 * DAY_MS);
  });

  test("leading spot appears 30px before the first bar when there's room", () => {
    const entries = [entry("a", T0 + 100 * DAY_MS, T0 + 110 * DAY_MS)];
    const spots = plusSpots({ entries, scale, width: 800, nowMs: NOW, clickedMs: null });
    expect(spots[0]).toEqual({ x: 100 - 30, startMs: xToMsHelper(100 - 30) });
  });

  test("no leading spot when the first bar is too close to the left edge", () => {
    const entries = [entry("a", T0 + 1 * DAY_MS, T0 + 10 * DAY_MS)];
    const spots = plusSpots({ entries, scale, width: 800, nowMs: NOW, clickedMs: null });
    // firstX = 1, which is not > PLUS_RADIUS * 3 (33) — no leading spot.
    expect(spots.find((s) => s.x === 1 - 30)).toBeUndefined();
  });

  test("gap spot appears at the midpoint of a wide-enough gap, keyed to the earlier entry's end", () => {
    const gapWidthDays = MIN_GAP_FOR_PLUS_PX + 10; // comfortably >= threshold
    const entries = [
      entry("a", T0 + 100 * DAY_MS, T0 + 110 * DAY_MS),
      entry("b", T0 + (110 + gapWidthDays) * DAY_MS, T0 + (200 + gapWidthDays) * DAY_MS),
    ];
    const spots = plusSpots({ entries, scale, width: 800, nowMs: NOW, clickedMs: null });
    const gapEndMs = entries[0].end!.ms;
    const gapSpot = spots.find((s) => s.startMs === gapEndMs);
    expect(gapSpot).toBeDefined();
    const gapStartX = 110;
    const gapEndX = 110 + gapWidthDays;
    expect(gapSpot!.x).toBe((gapStartX + gapEndX) / 2);
  });

  test("no gap spot when the gap is narrower than the minimum", () => {
    const gapWidthDays = MIN_GAP_FOR_PLUS_PX - 5;
    const entries = [
      entry("a", T0 + 100 * DAY_MS, T0 + 110 * DAY_MS),
      entry("b", T0 + (110 + gapWidthDays) * DAY_MS, T0 + (200 + gapWidthDays) * DAY_MS),
    ];
    const spots = plusSpots({ entries, scale, width: 800, nowMs: NOW, clickedMs: null });
    const gapEndMs = entries[0].end!.ms;
    expect(spots.find((s) => s.startMs === gapEndMs)).toBeUndefined();
  });

  test("an ongoing entry's gap/trailing math uses nowMs, not a missing end", () => {
    const entries = [entry("a", T0 + 100 * DAY_MS)]; // no end -> ongoing
    const spots = plusSpots({ entries, scale, width: 800, nowMs: NOW, clickedMs: null });
    const lastX = (NOW - T0) / DAY_MS;
    expect(spots).toContainEqual({ x: lastX + 30, startMs: NOW });
  });

  test("ongoing entry followed by another entry: gap measured from now", () => {
    const nowMs = T0 + 100 * DAY_MS;
    const entries = [
      entry("a", T0, undefined), // ongoing, would end "now" for gap purposes
      entry("b", nowMs + (MIN_GAP_FOR_PLUS_PX + 20) * DAY_MS, nowMs + (MIN_GAP_FOR_PLUS_PX + 30) * DAY_MS),
    ];
    const spots = plusSpots({ entries, scale, width: 1000, nowMs, clickedMs: null });
    const gapSpot = spots.find((s) => s.startMs === nowMs);
    expect(gapSpot).toBeDefined();
  });

  test("trailing spot appears 30px after the last entry's end", () => {
    const entries = [entry("a", T0, T0 + 50 * DAY_MS)];
    const spots = plusSpots({ entries, scale, width: 800, nowMs: NOW, clickedMs: null });
    expect(spots).toContainEqual({ x: 50 + 30, startMs: T0 + 50 * DAY_MS });
  });

  function xToMsHelper(x: number): number {
    return T0 + x * DAY_MS;
  }
});
