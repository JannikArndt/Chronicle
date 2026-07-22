import { describe, expect, test } from "vitest";
import { computeTicks, snapForScale } from "./timeAxis";
import { DAY_MS } from "../model/fuzzyDate";

const T0 = Date.UTC(2020, 5, 15);
const WIDTH = 1000;

describe("computeTicks", () => {
  test("always yields both a fine and a coarse level", () => {
    const scales = [
      60_000, // minute-per-px (deepest allowed region)
      3_600_000, // hour
      DAY_MS / 20, // deep day zoom
      DAY_MS, // day-per-px
      30 * DAY_MS, // month-ish
      365 * DAY_MS, // year-per-px
      2e10, // maximum zoom-out
    ];
    for (const msPerPx of scales) {
      const { fine, coarse } = computeTicks({ startMs: T0, msPerPx }, WIDTH);
      expect(fine.length, `fine empty at ${msPerPx}`).toBeGreaterThan(0);
      expect(coarse.length, `coarse empty at ${msPerPx}`).toBeGreaterThan(0);
      for (const tick of [...fine, ...coarse]) expect(tick.label).not.toBe("");
    }
  });

  test("day-per-px zoom shows month/day fine ticks under year-level coarse ticks", () => {
    const { fine, coarse } = computeTicks({ startMs: T0, msPerPx: 4 * DAY_MS }, WIDTH);
    // ~11 years visible: coarse should be years, fine months.
    expect(coarse.some((t) => /^\d{4}$/.test(t.label))).toBe(true);
    expect(fine.length).toBeGreaterThan(10);
  });

  test("deep zoom shows day-level fine ticks", () => {
    const { fine } = computeTicks({ startMs: T0, msPerPx: DAY_MS / 30 }, WIDTH);
    expect(fine.length).toBeGreaterThanOrEqual(2);
  });
});

describe("snapForScale", () => {
  test("snaps to day at deep zoom and to year when zoomed far out", () => {
    const deep = snapForScale({ startMs: T0, msPerPx: DAY_MS / 30 }, T0 + 3.7 * DAY_MS);
    expect(deep.precision).toBe("day");
    expect(deep.ms % DAY_MS).toBe(0);

    const wide = snapForScale({ startMs: T0, msPerPx: 400 * DAY_MS }, T0);
    expect(wide.precision).toBe("year");
  });
});
