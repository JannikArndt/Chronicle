import { describe, expect, test } from "vitest";
import { planEntryInsert } from "./autoClose";
import { emptyDataset } from "./dataset";
import { DAY_MS } from "./fuzzyDate";
import type { TimelineDataset, TimelineEntry } from "./types";

const T0 = Date.UTC(2020, 0, 1);

function makeEntry(
  id: string,
  startDay: number,
  endDay?: number,
  overrides: Partial<TimelineEntry> = {},
): TimelineEntry {
  return {
    id,
    rowId: "r1",
    title: id,
    start: { ms: T0 + startDay * DAY_MS, precision: "day" },
    end: endDay === undefined ? undefined : { ms: T0 + endDay * DAY_MS, precision: "day" },
    linkedEntityIds: [],
    visibility: "private",
    ...overrides,
  };
}

function fixture(concurrency: "exclusive" | "concurrent", entries: TimelineEntry[]): TimelineDataset {
  const ds = emptyDataset();
  ds.categories = [
    { id: "cat-1", label: "Job", color: "#333", icon: "💼", concurrency, defaultVisibility: "private" },
  ];
  ds.groups = [{ id: "g1", label: "Me", collapsed: false }];
  ds.rows = [{ id: "r1", groupId: "g1", categoryId: "cat-1", label: "Job" }];
  ds.entries = entries;
  return ds;
}

describe("planEntryInsert", () => {
  test("concurrent category never blocks", () => {
    const ds = fixture("concurrent", [makeEntry("e1", 0)]);
    expect(planEntryInsert(ds, makeEntry("new", 10)).kind).toBe("ok");
  });

  test("no overlap on an exclusive row is ok", () => {
    const ds = fixture("exclusive", [makeEntry("e1", 0, 100)]);
    expect(planEntryInsert(ds, makeEntry("new", 200)).kind).toBe("ok");
  });

  test("appending after an ongoing last entry auto-closes it at the new start", () => {
    const ds = fixture("exclusive", [makeEntry("e1", 0, 100), makeEntry("e2", 100)]);
    const plan = planEntryInsert(ds, makeEntry("new", 300));
    expect(plan.kind).toBe("autoClose");
    if (plan.kind === "autoClose") {
      expect(plan.previousEntry.id).toBe("e2");
      expect(plan.closeAt.ms).toBe(T0 + 300 * DAY_MS);
      expect(plan.note).toContain("e2");
    }
  });

  test("backfilling into history is a blocked conflict, not an auto-close", () => {
    const ds = fixture("exclusive", [makeEntry("e1", 0, 100), makeEntry("e2", 100)]);
    const plan = planEntryInsert(ds, makeEntry("new", 50, 80));
    expect(plan.kind).toBe("conflict");
    if (plan.kind === "conflict") {
      expect(plan.conflictingEntry.id).toBe("e1");
      expect(plan.message).toContain("e1");
    }
  });

  test("overlapping two entries at once is a conflict", () => {
    const ds = fixture("exclusive", [makeEntry("e1", 0, 100), makeEntry("e2", 100, 200)]);
    expect(planEntryInsert(ds, makeEntry("new", 50, 150)).kind).toBe("conflict");
  });

  test("entry-level concurrent override on the draft bypasses exclusivity", () => {
    const ds = fixture("exclusive", [makeEntry("e1", 0)]);
    const plan = planEntryInsert(ds, makeEntry("new", 10, undefined, { concurrencyOverride: "concurrent" }));
    expect(plan.kind).toBe("ok");
  });

  test("concurrent override on the EXISTING overlapped entry also resolves it", () => {
    const ds = fixture("exclusive", [makeEntry("e1", 0, undefined, { concurrencyOverride: "concurrent" })]);
    expect(planEntryInsert(ds, makeEntry("new", 10)).kind).toBe("ok");
  });

  test("starting before the last entry's start is a conflict even if it only overlaps the last entry", () => {
    const ds = fixture("exclusive", [makeEntry("e1", 100)]);
    const plan = planEntryInsert(ds, makeEntry("new", 50));
    expect(plan.kind).toBe("conflict");
  });
});
