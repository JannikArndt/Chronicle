import { describe, expect, test } from "vitest";
import {
  applyDelete,
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
  };
}

function makeRow(id: string, groupId: string, parentRowId?: string): TimelineRow {
  return { id, groupId, color: "#333", label: id, parentRowId };
}

// g1 ("Family") contains the sub-group g1a ("Finn") holding row r1, which has
// sub-row r2, which has sub-sub-row r3. g2 is a person of its own (it has a
// birth date) with row r4. g3 is an unrelated group with row r5.
function fixture(): TimelineDataset {
  const ds = emptyDataset();
  ds.groups = [
    { id: "g1", label: "Family", collapsed: false },
    { id: "g1a", parentGroupId: "g1", label: "Finn", collapsed: false },
    { id: "g2", label: "Me", birthDate: Date.UTC(1988, 0, 1), collapsed: false },
    { id: "g3", label: "Friends", collapsed: false },
  ];
  ds.rows = [
    makeRow("r1", "g1a"),
    makeRow("r2", "g1a", "r1"),
    makeRow("r3", "g1a", "r2"),
    makeRow("r4", "g2"),
    makeRow("r5", "g3"),
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
  test("takes the group's sub-groups, and everything on them, with it", () => {
    const cascade = collectGroupCascade(fixture(), "g1");
    expect(cascade.groupIds.sort()).toEqual(["g1", "g1a"]);
    expect(cascade.rowIds.sort()).toEqual(["r1", "r2", "r3"]);
    expect(cascade.entryIds.sort()).toEqual(["e1", "e2", "e3"]);
  });

  test("a group with no sub-groups takes only itself", () => {
    const cascade = collectGroupCascade(fixture(), "g2");
    expect(cascade.groupIds).toEqual(["g2"]);
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

describe("applyDelete", () => {
  test("removes exactly the collected ids", () => {
    const ds = fixture();
    const result = applyDelete(ds, collectGroupCascade(ds, "g1"));
    expect(result.groups.map((g) => g.id)).toEqual(["g2", "g3"]);
    expect(result.rows.map((r) => r.id)).toEqual(["r4", "r5"]);
    expect(result.entries.map((e) => e.id)).toEqual(["e4", "e5"]);
  });
});
