import { describe, expect, test } from "vitest";
import {
  ageSpan,
  birthAnswerFromMs,
  birthDateMs,
  birthDateToStore,
  clampBirthYear,
  exactAge,
  monthNote,
  yearAge,
} from "./birthYear";

// 1 October 2026, mid-day UTC.
const NOW = Date.UTC(2026, 9, 1, 12);

describe("ages", () => {
  test("the year age is this year minus the birth year", () => {
    expect(yearAge(1986, NOW)).toBe(40);
  });

  test("without a month the age is the year age", () => {
    expect(exactAge({ year: 1986, month: null }, NOW)).toBe(40);
  });

  test("a birthday still to come this year makes it one less", () => {
    expect(exactAge({ year: 1986, month: 10 }, NOW)).toBe(39);
  });

  test("a birthday already passed, or this month, keeps the year age", () => {
    expect(exactAge({ year: 1986, month: 2 }, NOW)).toBe(40);
    expect(exactAge({ year: 1986, month: 9 }, NOW)).toBe(40);
  });

  test("a baby born later this year is not -1", () => {
    expect(exactAge({ year: 2026, month: 11 }, NOW)).toBe(0);
  });

  test("the span runs to now, so it carries this year's fraction", () => {
    expect(ageSpan(1986, NOW)).toBeGreaterThan(40.7);
    expect(ageSpan(1986, NOW)).toBeLessThan(40.8);
    expect(ageSpan(2026, Date.UTC(2026, 0, 1))).toBeGreaterThan(0);
  });
});

describe("storing a birth date", () => {
  test("a year alone is the 1st of January, and reads back as year-only", () => {
    const ms = birthDateMs({ year: 1986, month: null });
    expect(ms).toBe(Date.UTC(1986, 0, 1));
    expect(birthAnswerFromMs(ms)).toEqual({ year: 1986, month: null });
  });

  test("a month is the 1st of that month", () => {
    const ms = birthDateMs({ year: 1986, month: 4 });
    expect(ms).toBe(Date.UTC(1986, 4, 1));
    expect(birthAnswerFromMs(ms)).toEqual({ year: 1986, month: 4 });
  });

  test("a full date with the same year and month is kept, day and all", () => {
    const previous = Date.UTC(1986, 4, 14);
    expect(birthDateToStore({ year: 1986, month: 4 }, previous)).toBe(previous);
  });

  test("a changed year or month replaces it", () => {
    const previous = Date.UTC(1986, 4, 14);
    expect(birthDateToStore({ year: 1985, month: 4 }, previous)).toBe(Date.UTC(1985, 4, 1));
    expect(birthDateToStore({ year: 1986, month: 5 }, previous)).toBe(Date.UTC(1986, 5, 1));
    expect(birthDateToStore({ year: 1986, month: null }, previous)).toBe(Date.UTC(1986, 0, 1));
  });

  test("the year stays within 0…100 years ago", () => {
    expect(clampBirthYear(1900, NOW)).toBe(1926);
    expect(clampBirthYear(2030, NOW)).toBe(2026);
  });
});

describe("monthNote", () => {
  test("says what the month means for the age", () => {
    expect(monthNote({ year: 1986, month: null }, NOW)).toBe("Pick the month, or leave it.");
    expect(monthNote({ year: 1986, month: 11 }, NOW)).toBe("Turns 40 in Dec.");
    expect(monthNote({ year: 1986, month: 1 }, NOW)).toBe("Turned 40 in Feb.");
    expect(monthNote({ year: 1986, month: 9 }, NOW)).toBe("Birthday this month: 39 or 40 until then.");
  });
});
