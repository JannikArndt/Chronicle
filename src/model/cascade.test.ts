import { describe, expect, test } from "vitest";
import {
  applyDelete,
  categoryDeleteBlockers,
  collectEntryCascade,
  collectGroupCascade,
  collectRowCascade,
  describeCascade,
} from "./cascade";
import { emptyDataset } from "./dataset";
import type { TimelineDataset, TimelineEntry, TimelineRow } from "./types";

function makeEntry(id: string, rowId: string, parentEntryId?: string): TimelineEntry {
  return {
    id,
    rowId,
    title: id,
    start: { ms: 0, precision: "day" },
    parentEntryId,
    linkedEntityIds: [],
    visibility: "private",
  };
}

function makeRow(id: string, groupId: string, parentRowId?: string, personId?: string): TimelineRow {
  return { id, groupId, categoryId: "cat-1", label: id, parentRowId, personId };
}

// g1 (plain group) contains person p1's row r1, r1 has sub-row r2, r2 has sub-sub-row r3.
// g2 is person p2's own group with row r4. p1 also has a row in g2? No — p1 is
// additionally referenced from group g3 to test shared-person survival.
function fixture(): TimelineDataset {
  const ds = emptyDataset();
  ds.people = [
    { id: "p1", label: "Finn" },
    { id: "p2", label: "Me" },
  ];
  ds.groups = [
    { id: "g1", label: "Family", collapsed: false },
    { id: "g2", label: "Me", personId: "p2", collapsed: false },
    { id: "g3", label: "Friends", collapsed: false },
  ];
  ds.categories = [
    { id: "cat-1", label: "Job", color: "#333", icon: "💼", defaultVisibility: "private" },
    { id: "cat-2", label: "Unused", color: "#666", icon: "🎈", defaultVisibility: "private" },
  ];
  ds.rows = [
    makeRow("r1", "g1", undefined, "p1"),
    makeRow("r2", "g1", "r1", "p1"),
    makeRow("r3", "g1", "r2", "p1"),
    makeRow("r4", "g2"),
    makeRow("r5", "g3", undefined, "p1"),
  ];
  ds.entries = [
    makeEntry("e1", "r1"),
    makeEntry("e2", "r2", "e1"),
    makeEntry("e3", "r3", "e2"),
    makeEntry("e4", "r4"),
    makeEntry("e5", "r4", "e4"),
  ];
  return ds;
}

describe("collectRowCascade", () => {
  test("collects sub-rows recursively with all their entries", () => {
    const cascade = collectRowCascade(fixture(), "r1");
    expect(cascade.rowIds.sort()).toEqual(["r1", "r2", "r3"]);
    expect(cascade.entryIds.sort()).toEqual(["e1", "e2", "e3"]);
  });
});

describe("collectEntryCascade", () => {
  test("collects parentEntryId descendants recursively", () => {
    const cascade = collectEntryCascade(fixture(), "e1");
    expect(cascade.entryIds.sort()).toEqual(["e1", "e2", "e3"]);
  });

  test("a leaf entry cascades only to itself", () => {
    expect(collectEntryCascade(fixture(), "e3").entryIds).toEqual(["e3"]);
  });
});

describe("collectGroupCascade", () => {
  test("takes rows, entries, and persons only this group references", () => {
    const cascade = collectGroupCascade(fixture(), "g1");
    expect(cascade.rowIds.sort()).toEqual(["r1", "r2", "r3"]);
    expect(cascade.entryIds.sort()).toEqual(["e1", "e2", "e3"]);
    // p1 survives because g3/r5 still references it.
    expect(cascade.personIds).toEqual([]);
  });

  test("deletes a person no longer referenced anywhere else", () => {
    const cascade = collectGroupCascade(fixture(), "g2");
    expect(cascade.personIds).toEqual(["p2"]);
    expect(cascade.entryIds.sort()).toEqual(["e4", "e5"]);
  });
});

describe("describeCascade", () => {
  test("summarizes what will be removed", () => {
    expect(describeCascade(collectRowCascade(fixture(), "r1"))).toBe(
      "This deletes 3 entries and 2 sub-rows.",
    );
    expect(describeCascade(collectEntryCascade(fixture(), "e3"))).toBe("This deletes 1 entry.");
  });
});

describe("categoryDeleteBlockers", () => {
  test("lists rows still using the category", () => {
    expect(categoryDeleteBlockers(fixture(), "cat-1").map((r) => r.id).sort()).toEqual([
      "r1",
      "r2",
      "r3",
      "r4",
      "r5",
    ]);
    expect(categoryDeleteBlockers(fixture(), "cat-2")).toEqual([]);
  });
});

describe("applyDelete", () => {
  test("removes exactly the collected ids", () => {
    const ds = fixture();
    const result = applyDelete(ds, collectGroupCascade(ds, "g1"), "g1");
    expect(result.groups.map((g) => g.id)).toEqual(["g2", "g3"]);
    expect(result.rows.map((r) => r.id)).toEqual(["r4", "r5"]);
    expect(result.entries.map((e) => e.id)).toEqual(["e4", "e5"]);
    expect(result.people.map((p) => p.id)).toEqual(["p1", "p2"]);
  });
});
