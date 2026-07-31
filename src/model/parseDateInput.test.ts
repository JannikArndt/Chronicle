import { describe, expect, test } from "vitest";
import { ACCEPTED_DATE_FORMATS_HINT, parseDateInput } from "./parseDateInput";

function parsed(text: string) {
  const result = parseDateInput(text);
  if (result.kind !== "date") throw new Error(`expected "${text}" to parse as a date, got ${result.kind}`);
  return result;
}

function isoOf(text: string): string {
  return new Date(parsed(text).ms).toISOString();
}

describe("what the user typed sets the precision", () => {
  test("a bare year is year precision, anchored mid-year", () => {
    expect(parsed("2016").precision).toBe("year");
    expect(isoOf("2016")).toBe("2016-07-01T00:00:00.000Z");
  });

  test("a month is month precision, anchored mid-month", () => {
    for (const text of ["Aug 2016", "August 2016", "2016-08", "08/2016", "8.2016"]) {
      expect(parsed(text).precision).toBe("month");
      expect(isoOf(text)).toBe("2016-08-15T00:00:00.000Z");
    }
  });

  test("a full date is day precision, at UTC midnight", () => {
    for (const text of ["2016-08-06", "6.8.2016", "06.08.2016", "6 Aug 2016", "6 August 2016", "Aug 6, 2016"]) {
      expect(parsed(text).precision).toBe("day");
      expect(isoOf(text)).toBe("2016-08-06T00:00:00.000Z");
    }
  });

  test("an approximation marker is circa precision, not a discarded prefix", () => {
    for (const text of ["~2016", "ca. 2016", "ca 2016", "around 2016", "about 2016"]) {
      expect(parsed(text).precision).toBe("circa");
    }
  });
});

describe("ongoing", () => {
  test("now, ongoing and present all mean the same thing", () => {
    for (const text of ["now", "NOW", "ongoing", "present"]) {
      expect(parseDateInput(text)).toEqual({ kind: "ongoing" });
    }
  });
});

describe("rejection", () => {
  // Never a silent no-op and never a thrown error: the caller gets something it
  // can show.
  test("unparseable input comes back with the accepted-format hint", () => {
    for (const text of ["not a date", "", "   ", "2016-13", "2016-02-30", "32.1.2016", "Smarch 2016"]) {
      expect(parseDateInput(text)).toEqual({ kind: "error", message: ACCEPTED_DATE_FORMATS_HINT });
    }
  });

  test("a month name must be at least three letters, so 'ma 2016' is not May", () => {
    expect(parseDateInput("ma 2016").kind).toBe("error");
  });
});

describe("UTC only", () => {
  // The whole app stores UTC instants; a parser that quietly used local time
  // would shift every typed date by the reader's offset.
  test("parsing never depends on the host timezone", () => {
    expect(parsed("2016-01-01").ms).toBe(Date.UTC(2016, 0, 1));
    expect(parsed("2016-12-31").ms).toBe(Date.UTC(2016, 11, 31));
  });
});
