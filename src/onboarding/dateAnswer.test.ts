import { describe, expect, test } from "vitest";
import { DEFAULT_FUZZ_DAYS, fuzzMs, DAY_MS } from "../model/fuzzyDate";
import { answerFromMs, answerMs, clampDay, daysInMonth, formatAnswer, toFuzzyDate } from "./dateAnswer";
import type { DateAnswer } from "./dateAnswer";

function answer(overrides: Partial<DateAnswer> = {}): DateAnswer {
  return { year: 2014, monthIndex: 4, day: 14, granularity: "year", ...overrides };
}

describe("toFuzzyDate — granularity decides the instant", () => {
  test("a year anchors mid-year, so its fuzz brackets the whole year", () => {
    expect(toFuzzyDate(answer(), "exact").ms).toBe(Date.UTC(2014, 6, 1));
  });

  test("a month anchors mid-month", () => {
    expect(toFuzzyDate(answer({ granularity: "month" }), "exact").ms).toBe(Date.UTC(2014, 4, 15));
  });

  test("a day is the day itself", () => {
    expect(toFuzzyDate(answer({ granularity: "day" }), "exact").ms).toBe(Date.UTC(2014, 4, 14));
  });

  test("a day past the end of the month is clamped, never rolled into the next one", () => {
    const february = answer({ granularity: "day", monthIndex: 1, day: 31 });
    expect(toFuzzyDate(february, "exact").ms).toBe(Date.UTC(2014, 1, 28));
    // …and a leap year keeps its 29th.
    expect(toFuzzyDate({ ...february, year: 2016 }, "exact").ms).toBe(Date.UTC(2016, 1, 29));
  });
});

describe("toFuzzyDate — certainty decides the blur", () => {
  test("“exactly” keeps the precision's own fuzz at every granularity", () => {
    for (const granularity of ["year", "month", "day"] as const) {
      const date = toFuzzyDate(answer({ granularity }), "exact");
      expect(date.fuzzDays).toBeUndefined();
      expect(fuzzMs(date)).toBe(DEFAULT_FUZZ_DAYS[date.precision] * DAY_MS);
    }
  });

  test("a vaguer answer is always blurrier than a surer one, at every granularity", () => {
    for (const granularity of ["year", "month", "day"] as const) {
      const exact = fuzzMs(toFuzzyDate(answer({ granularity }), "exact"));
      const around = fuzzMs(toFuzzyDate(answer({ granularity }), "around"));
      const vague = fuzzMs(toFuzzyDate(answer({ granularity }), "vague"));
      expect(around).toBeGreaterThan(exact);
      expect(vague).toBeGreaterThan(around);
    }
  });

  // The whole point of splitting the two axes: a date can be known to the day
  // and still be uncertain, and it must not lose the day to say so.
  test("an uncertain day keeps its day and only widens the window", () => {
    const date = toFuzzyDate(answer({ granularity: "day" }), "around");
    expect(date.ms).toBe(Date.UTC(2014, 4, 14));
    expect(date.precision).toBe("day");
    expect(date.fuzzDays).toBe(7);
  });

  // Unchanged from the year-only flow this replaces: "around then" on a year
  // is `circa`, which is what that precision means and what the readout says.
  test("a vague year becomes circa, the word the model already has for it", () => {
    expect(toFuzzyDate(answer(), "around").precision).toBe("circa");
    expect(toFuzzyDate(answer(), "around").fuzzDays).toBeUndefined();
    expect(toFuzzyDate(answer(), "vague")).toMatchObject({ precision: "circa", fuzzDays: 730 });
  });
});

describe("answerFromMs", () => {
  test("reads a UTC instant back into its parts", () => {
    expect(answerFromMs(Date.UTC(1998, 11, 24), "day")).toEqual({
      year: 1998,
      monthIndex: 11,
      day: 24,
      granularity: "day",
    });
  });

  test("defaults to year granularity — the fast path the sliders open on", () => {
    expect(answerFromMs(Date.UTC(1998, 11, 24)).granularity).toBe("year");
  });
});

describe("readout", () => {
  test("says exactly as much as the answer knows", () => {
    expect(formatAnswer(answer())).toBe("2014");
    expect(formatAnswer(answer({ granularity: "month" }))).toBe("May 2014");
    expect(formatAnswer(answer({ granularity: "day" }))).toBe("14 May 2014");
  });

  test("shows the clamped day rather than one the month does not have", () => {
    expect(formatAnswer(answer({ granularity: "day", monthIndex: 1, day: 31 }))).toBe("28 Feb 2014");
  });
});

describe("day clamping", () => {
  test("knows how long each month is, leap years included", () => {
    expect(daysInMonth(2014, 1)).toBe(28);
    expect(daysInMonth(2016, 1)).toBe(29);
    expect(daysInMonth(2014, 3)).toBe(30);
    expect(daysInMonth(2014, 0)).toBe(31);
  });

  test("clamps at both ends", () => {
    expect(clampDay(2014, 1, 31)).toBe(28);
    expect(clampDay(2014, 1, 0)).toBe(1);
    expect(clampDay(2014, 1, 12)).toBe(12);
  });
});

// The comparison the end-date clamp is built on. It has to be about the
// anchored instants, not the raw fields: a year answer stands in July, so
// "2014" really is before "20 Nov 2014" however the parts compare.
describe("answerMs", () => {
  test("anchors each granularity where toFuzzyDate does", () => {
    for (const granularity of ["year", "month", "day"] as const) {
      const one = answer({ granularity });
      expect(answerMs(one)).toBe(toFuzzyDate(one, "exact").ms);
    }
  });

  test("a year answer sits mid-year, so it can precede a late date in that year", () => {
    expect(answerMs(answer({ granularity: "year" }))).toBeLessThan(
      answerMs(answer({ granularity: "day", monthIndex: 10, day: 20 })),
    );
  });
});
