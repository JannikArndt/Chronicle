import { describe, expect, test } from "vitest";
import { nextEntryStartMs } from "./nextEntryStart";
import type { TimelineEntry } from "../model/types";

const NOW_MS = Date.UTC(2026, 7, 1);

function entry(startYear: number, endYear?: number): TimelineEntry {
  return {
    id: `e${startYear}`,
    rowId: "r1",
    title: `Entry ${startYear}`,
    start: { ms: Date.UTC(startYear, 0, 1), precision: "year" },
    end: endYear === undefined ? undefined : { ms: Date.UTC(endYear, 0, 1), precision: "year" },
  };
}

describe("nextEntryStartMs", () => {
  test("an empty timeline starts today", () => {
    expect(nextEntryStartMs([], NOW_MS)).toBe(NOW_MS);
  });

  test("picks up where the last finished entry left off", () => {
    expect(nextEntryStartMs([entry(1998, 2001), entry(2001, 2004)], NOW_MS)).toBe(Date.UTC(2004, 0, 1));
  });

  test("ignores order — the latest end wins, not the last in the array", () => {
    expect(nextEntryStartMs([entry(2001, 2004), entry(1998, 2010)], NOW_MS)).toBe(Date.UTC(2010, 0, 1));
  });

  test("an ongoing entry means the timeline reaches to today", () => {
    expect(nextEntryStartMs([entry(1998, 2001), entry(2004)], NOW_MS)).toBe(NOW_MS);
  });
});
