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

// The span-driven ladder. Each case names the span it is describing, because
// the scale that produces it is not readable on its own.
describe("the axis ladder below five years", () => {
  const forSpan = (spanDays: number, width = WIDTH) =>
    computeTicks({ startMs: T0, msPerPx: (spanDays * DAY_MS) / width }, width);

  const PHONE_WIDTH = 390;

  test("under five years: years over quarters", () => {
    const { fine, coarse } = forSpan(4 * 365);
    expect(coarse.every((t) => /^\d{4}$/.test(t.label))).toBe(true);
    expect(fine.every((t) => /^Q[1-4]$/.test(t.label))).toBe(true);
  });

  test("under six quarters: years over months", () => {
    const { fine, coarse } = forSpan(400, PHONE_WIDTH);
    expect(coarse.every((t) => /^\d{4}$/.test(t.label))).toBe(true);
    expect(fine.every((t) => /^[JFMASOND]$/.test(t.label))).toBe(true);
  });

  test("month names grow as the zoom gives them room", () => {
    // One span, three widths: the spelling follows the pixels each month gets,
    // which is why it is not a function of the span alone.
    expect(forSpan(400, PHONE_WIDTH).fine.every((t) => /^[JFMASOND]$/.test(t.label))).toBe(true);
    expect(forSpan(400, 700).fine.every((t) => /^[A-Z][a-z]{2}$/.test(t.label))).toBe(true);
    expect(forSpan(400, 1100).fine.every((t) => /^[A-Z][a-z]{2,8}$/.test(t.label))).toBe(true);
  });

  test("under two months: month-and-year over the date each week starts on", () => {
    const { fine, coarse } = forSpan(50);
    expect(coarse.every((t) => /^[A-Z][a-z]+ '\d{2}$/.test(t.label))).toBe(true);
    expect(fine.every((t) => /^\d{1,2}$/.test(t.label))).toBe(true);
  });

  test("under two weeks: month-and-year over days", () => {
    const { fine, coarse } = forSpan(10);
    expect(coarse.every((t) => /^[A-Z][a-z]+ '\d{2}$/.test(t.label))).toBe(true);
    expect(fine.length).toBeGreaterThanOrEqual(10);
  });

  // The bug this ladder exists to make unreachable: a decade title above
  // quarter subtitles tells you it is Q1 of *some* year in the 2010s.
  test("quarters are never paired with anything coarser than a year", () => {
    for (let spanDays = 20; spanDays < 5 * 365; spanDays += 7) {
      const { fine, coarse } = forSpan(spanDays);
      if (!fine.some((t) => /^Q[1-4]$/.test(t.label))) continue;
      expect(coarse.every((t) => /^\d{4}$/.test(t.label)), `span ${spanDays}d`).toBe(true);
    }
  });
});

describe("snapForScale", () => {
  test("snaps to day at deep zoom and to year when zoomed far out", () => {
    const deep = snapForScale({ startMs: T0, msPerPx: DAY_MS / 30 }, T0 + 3.7 * DAY_MS, WIDTH);
    expect(deep.precision).toBe("day");
    expect(deep.ms % DAY_MS).toBe(0);

    const wide = snapForScale({ startMs: T0, msPerPx: 400 * DAY_MS }, T0, WIDTH);
    expect(wide.precision).toBe("year");
  });
});
