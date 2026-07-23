import { describe, expect, test } from "vitest";
import {
  DAY_MS,
  DEFAULT_FUZZ_DAYS,
  addDays,
  formatFuzzyDate,
  fuzzMs,
  parseDateInput,
  rampBounds,
  utcDayStart,
} from "./fuzzyDate";
import type { TimelineEntry } from "./types";

const T0 = Date.UTC(2020, 4, 14); // 2020-05-14T00:00:00Z

function entry(overrides: Partial<TimelineEntry>): TimelineEntry {
  return {
    id: "e1",
    rowId: "r1",
    title: "t",
    start: { ms: T0, precision: "day" },
    visibility: "private",
    ...overrides,
  };
}

describe("fuzz defaults", () => {
  test("per-precision default days match the spec", () => {
    expect(DEFAULT_FUZZ_DAYS).toEqual({ exact: 0, day: 0, month: 15, year: 182, circa: 365 });
  });

  test("fuzzDays overrides the precision default", () => {
    expect(fuzzMs({ ms: T0, precision: "circa", fuzzDays: 10 })).toBe(10 * DAY_MS);
    expect(fuzzMs({ ms: T0, precision: "month" })).toBe(15 * DAY_MS);
  });
});

describe("rampBounds", () => {
  test("day precision without fades is a hard-edged bar", () => {
    const b = rampBounds(entry({ end: { ms: T0 + 30 * DAY_MS, precision: "day" } }), T0 + 900 * DAY_MS);
    expect(b).toEqual({
      visualStart: T0,
      solidStart: T0,
      solidEnd: T0 + 30 * DAY_MS,
      visualEnd: T0 + 30 * DAY_MS,
      ongoing: false,
    });
  });

  test("precision fuzz and fadeIn combine into one continuous left edge", () => {
    const b = rampBounds(
      entry({
        start: { ms: T0, precision: "month" }, // 15 days fuzz
        fadeInDays: 30,
        end: { ms: T0 + 300 * DAY_MS, precision: "day" },
      }),
      T0 + 900 * DAY_MS,
    );
    expect(b.visualStart).toBe(T0 - 15 * DAY_MS);
    expect(b.solidStart).toBe(T0 + 15 * DAY_MS + 30 * DAY_MS);
  });

  test("right edge combines fadeOut and end fuzz", () => {
    const end = T0 + 300 * DAY_MS;
    const b = rampBounds(
      entry({ end: { ms: end, precision: "year" }, fadeOutDays: 20 }),
      T0 + 900 * DAY_MS,
    );
    expect(b.solidEnd).toBe(end - 182 * DAY_MS - 20 * DAY_MS);
    expect(b.visualEnd).toBe(end + 182 * DAY_MS);
  });

  test("no end means ongoing up to now", () => {
    const now = T0 + 100 * DAY_MS;
    const b = rampBounds(entry({}), now);
    expect(b.ongoing).toBe(true);
    expect(b.visualEnd).toBe(now);
    expect(b.solidEnd).toBe(now);
  });

  test("solid span never inverts on a tiny bar with big fuzz", () => {
    const b = rampBounds(
      entry({
        start: { ms: T0, precision: "circa" },
        end: { ms: T0 + 10 * DAY_MS, precision: "circa" },
      }),
      T0 + 900 * DAY_MS,
    );
    expect(b.solidStart).toBeLessThanOrEqual(b.solidEnd);
  });
});

describe("parse and format", () => {
  test("full date parses as day precision at UTC midnight", () => {
    expect(parseDateInput("2020-05-14")).toEqual({ ms: T0, precision: "day" });
  });

  test("year-month parses as month precision anchored mid-month", () => {
    const parsed = parseDateInput("2020-05");
    expect(parsed?.precision).toBe("month");
    expect(new Date(parsed!.ms).toISOString().slice(0, 7)).toBe("2020-05");
  });

  test("bare year parses as year precision anchored mid-year", () => {
    const parsed = parseDateInput("1987");
    expect(parsed?.precision).toBe("year");
    expect(new Date(parsed!.ms).getUTCFullYear()).toBe(1987);
  });

  test("garbage is rejected", () => {
    expect(parseDateInput("not a date")).toBeNull();
    expect(parseDateInput("")).toBeNull();
  });

  test("format follows precision, not stored resolution", () => {
    expect(formatFuzzyDate({ ms: T0, precision: "day" })).toBe("2020-05-14");
    expect(formatFuzzyDate({ ms: T0, precision: "exact" })).toBe("2020-05-14");
    expect(formatFuzzyDate({ ms: T0, precision: "month" })).toBe("2020-05");
    expect(formatFuzzyDate({ ms: T0, precision: "year" })).toBe("2020");
    expect(formatFuzzyDate({ ms: T0, precision: "circa" })).toBe("ca. 2020");
  });

  test("parse/format round-trips for day precision", () => {
    const parsed = parseDateInput("1999-12-31")!;
    expect(formatFuzzyDate({ ...parsed })).toBe("1999-12-31");
  });
});

describe("utc helpers", () => {
  test("utcDayStart truncates to UTC midnight", () => {
    expect(utcDayStart(T0 + 5 * 3600_000)).toBe(T0);
  });

  test("addDays adds whole days", () => {
    expect(addDays(T0, 3)).toBe(T0 + 3 * DAY_MS);
  });
});
