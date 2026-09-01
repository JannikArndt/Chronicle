import { describe, expect, test } from "vitest";
import {
  applyDelete,
  collectEntryCascade,
  collectEventCascade,
  collectGroupCascade,
  collectRowCascade,
  describeCascade,
} from "./cascade";
import { emptyDataset } from "./dataset";
import type { TimelineDataset, TimelineEntry, TimelineEvent, TimelineRow } from "./types";

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

function makeEvent(id: string, rowId: string): TimelineEvent {
  return { id, rowId, title: id, date: { ms: 0, precision: "day" } };
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
  ds.events = [makeEvent("v1", "r1"), makeEvent("v2", "r3"), makeEvent("v3", "r4")];
  return ds;
}

describe("collectRowCascade", () => {
  test("collects sub-rows recursively with all their entries", () => {
    const cascade = collectRowCascade(fixture(), "r1");
    expect(cascade.rowIds.sort()).toEqual(["r1", "r2", "r3"]);
    expect(cascade.entryIds.sort()).toEqual(["e1", "e2", "e3"]);
  });
});

describe("events in a cascade", () => {
  test("a row takes the events on it and on its sub-rows", () => {
    const cascade = collectRowCascade(fixture(), "r1");
    expect(cascade.eventIds.sort()).toEqual(["v1", "v2"]);
  });

  test("a group takes the events on every timeline it holds", () => {
    expect(collectGroupCascade(fixture(), "g1").eventIds.sort()).toEqual(["v1", "v2"]);
  });

  test("deleting an entry leaves the events on its row alone — they are siblings", () => {
    expect(collectEntryCascade(fixture(), "e1").eventIds).toEqual([]);
  });

  test("an event takes nothing with it: nothing in the model points at one", () => {
    const cascade = collectEventCascade(fixture(), "v1");
    expect(cascade).toEqual({ groupIds: [], rowIds: [], entryIds: [], eventIds: ["v1"] });
  });

  test("applyDelete removes exactly the collected events", () => {
    const ds = fixture();
    const result = applyDelete(ds, collectRowCascade(ds, "r1"));
    expect(result.events.map((event) => event.id)).toEqual(["v3"]);
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
      "This deletes 3 entries, 2 events and 2 sub-rows.",
    );
    expect(describeCascade(collectEntryCascade(fixture(), "e3"))).toBe("This deletes 1 entry.");
  });

  // None of g1's three rows is the thing being deleted by name, so calling two
  // of them "sub-rows" both undercounted and mislabelled them.
  test("counts a group's rows as whole timelines, not as sub-rows", () => {
    expect(describeCascade(collectGroupCascade(fixture(), "g1"))).toBe(
      "This deletes 3 entries, 2 events, 3 timelines and 1 sub-group.",
    );
  });

  // "0 entries" is worth saying before deleting a timeline; on an event's own
  // delete, entries are not the subject at all.
  test("an event-only delete does not open with an entry count", () => {
    expect(describeCascade(collectEventCascade(fixture(), "v1"))).toBe("This deletes 1 event.");
  });

  test("a row with no events on it says nothing about events", () => {
    const ds = fixture();
    ds.events = [];
    expect(describeCascade(collectRowCascade(ds, "r1"))).toBe("This deletes 3 entries and 2 sub-rows.");
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
