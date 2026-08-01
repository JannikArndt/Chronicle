import { describe, expect, test } from "vitest";
import { entryDatesFromYearText } from "./timelineEntryRows";

describe("entryDatesFromYearText", () => {
  test("two years become a start and an end", () => {
    const dates = entryDatesFromYearText("1998", "2004");
    expect(dates?.start.precision).toBe("year");
    expect(new Date(dates!.start.ms).getUTCFullYear()).toBe(1998);
    expect(new Date(dates!.end!.ms).getUTCFullYear()).toBe(2004);
  });

  test("an empty end means ongoing, not today", () => {
    expect(entryDatesFromYearText("1998", "")?.end).toBeUndefined();
  });

  test("the typed precision carries through — 'Aug 2016' is a month", () => {
    expect(entryDatesFromYearText("Aug 2016", "")?.start.precision).toBe("month");
  });

  test("a row with no readable start is not an entry yet", () => {
    expect(entryDatesFromYearText("", "2004")).toBeNull();
    expect(entryDatesFromYearText("sometime", "")).toBeNull();
  });

  test("a backwards range keeps the later year as the end", () => {
    const dates = entryDatesFromYearText("2004", "1998");
    expect(new Date(dates!.end!.ms).getUTCFullYear()).toBe(2004);
  });

  test("an unreadable end is dropped rather than guessed at", () => {
    expect(entryDatesFromYearText("1998", "later")?.end).toBeUndefined();
  });
});
