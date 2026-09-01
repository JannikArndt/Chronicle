import { describe, expect, test } from "vitest";
import { defaultSharedFor, describePublishImpact, syncSubset } from "./sharing";
import { emptyDataset } from "./dataset";
import type { TimelineDataset, TimelineEntry, TimelineEvent, TimelineRow } from "./types";

function makeEntry(id: string, rowId: string, parentEntryId?: string): TimelineEntry {
  return { id, rowId, title: id, start: { ms: 0, precision: "day" }, parentEntryId };
}

function makeRow(id: string, groupId: string | undefined, shared?: boolean): TimelineRow {
  return { id, groupId, color: "#333", label: id, shared };
}

function makeEvent(id: string, rowId: string): TimelineEvent {
  return { id, rowId, title: id, date: { ms: 0, precision: "day" } };
}

// g1 ("Family") holds the sub-group g1a ("Finn"). Finn has one published
// timeline (r1) and one private one (r2). g2 ("Me") is private throughout.
function fixture(): TimelineDataset {
  const dataset = emptyDataset();
  dataset.groups = [
    { id: "g1", label: "Family", collapsed: false },
    { id: "g1a", parentGroupId: "g1", label: "Finn", collapsed: false },
    { id: "g2", label: "Me", birthDate: Date.UTC(1988, 0, 1), collapsed: false },
  ];
  dataset.rows = [makeRow("r1", "g1a", true), makeRow("r2", "g1a", false), makeRow("r3", "g2")];
  dataset.entries = [makeEntry("e1", "r1"), makeEntry("e2", "r2"), makeEntry("e3", "r3")];
  dataset.events = [makeEvent("v1", "r1"), makeEvent("v2", "r2"), makeEvent("v3", "r3")];
  return dataset;
}

describe("syncSubset — the privacy gate", () => {
  test("shared-only uploads published rows and nothing else", () => {
    const subset = syncSubset(fixture(), "shared-only");
    expect(subset.rows.map((row) => row.id)).toEqual(["r1"]);
    expect(subset.entries.map((entry) => entry.id)).toEqual(["e1"]);
  });

  test("an event follows its row, exactly as an entry does", () => {
    const subset = syncSubset(fixture(), "shared-only");
    expect(subset.events.map((event) => event.id)).toEqual(["v1"]);
  });

  test("an event never rides along on a private row — the moments are the diary", () => {
    const subset = syncSubset(fixture(), "shared-only");
    expect(subset.events.some((event) => event.rowId === "r2")).toBe(false);
    expect(subset.events.some((event) => event.rowId === "r3")).toBe(false);
  });

  test("a row with no shared flag keeps its events home too", () => {
    const dataset = fixture();
    dataset.rows = [makeRow("r1", "g1a")];
    expect(syncSubset(dataset, "shared-only").events).toEqual([]);
  });

  test("everything mode takes the events with it", () => {
    const subset = syncSubset(fixture(), "everything");
    expect(subset.events.map((event) => event.id)).toEqual(["v1", "v2", "v3"]);
  });

  test("an entry never rides along on a private row", () => {
    const subset = syncSubset(fixture(), "shared-only");
    expect(subset.entries.some((entry) => entry.rowId === "r2")).toBe(false);
    expect(subset.entries.some((entry) => entry.rowId === "r3")).toBe(false);
  });

  test("a row with no `shared` flag at all is private — the gate fails closed", () => {
    const dataset = fixture();
    dataset.rows = [makeRow("r1", "g1a")];
    expect(syncSubset(dataset, "shared-only").rows).toEqual([]);
  });

  test("a published row carries its group and every ancestor, so the tree is connected", () => {
    const subset = syncSubset(fixture(), "shared-only");
    expect(subset.groups.map((group) => group.id).sort()).toEqual(["g1", "g1a"]);
    expect(subset.groups.find((group) => group.id === "g1a")?.parentGroupId).toBe("g1");
  });

  test("a group holding nothing published stays home", () => {
    const subset = syncSubset(fixture(), "shared-only");
    expect(subset.groups.some((group) => group.id === "g2")).toBe(false);
  });

  test("a group published in its own right goes up empty — the invite-first case", () => {
    const dataset = fixture();
    dataset.groups = dataset.groups.map((group) => (group.id === "g2" ? { ...group, shared: true } : group));
    const subset = syncSubset(dataset, "shared-only");
    expect(subset.groups.some((group) => group.id === "g2")).toBe(true);
    expect(subset.rows.some((row) => row.groupId === "g2")).toBe(false);
  });

  test("a published top-level row (no group at all) needs no ancestor to go up", () => {
    const dataset = fixture();
    dataset.rows = [makeRow("top", undefined, true)];
    const subset = syncSubset(dataset, "shared-only");
    expect(subset.rows.map((row) => row.id)).toEqual(["top"]);
    expect(subset.groups).toEqual([]);
  });

  test("a published child entry whose parent is on a private row loses parentEntryId", () => {
    const dataset = fixture();
    dataset.rows = [makeRow("r1", "g1a", false), makeRow("r2", "g1a", true)];
    dataset.entries = [makeEntry("e1", "r1"), makeEntry("e2", "r2", "e1")];
    const subset = syncSubset(dataset, "shared-only");
    expect(subset.entries.map((entry) => entry.id)).toEqual(["e2"]);
    expect(subset.entries[0].parentEntryId).toBeUndefined();
  });

  test("a published row whose group is gone stays home — nothing to draw it under", () => {
    const dataset = fixture();
    dataset.rows = [makeRow("orphan", "missing-group", true)];
    dataset.entries = [makeEntry("e-orphan", "orphan")];
    const subset = syncSubset(dataset, "shared-only");
    expect(subset.rows).toEqual([]);
    expect(subset.entries).toEqual([]);
  });

  test("everything mode uploads the private records too, flags intact for RLS", () => {
    const subset = syncSubset(fixture(), "everything");
    expect(subset.rows.map((row) => row.id)).toEqual(["r1", "r2", "r3"]);
    expect(subset.entries).toHaveLength(3);
    expect(subset.rows.find((row) => row.id === "r2")?.shared).toBe(false);
  });

  test("everything mode is still referentially closed", () => {
    const dataset = fixture();
    dataset.rows.push(makeRow("orphan", "missing-group"));
    const subset = syncSubset(dataset, "everything");
    expect(subset.rows.some((row) => row.id === "orphan")).toBe(false);
  });

  test("a parent-group cycle terminates instead of hanging", () => {
    const dataset = emptyDataset();
    dataset.groups = [
      { id: "a", parentGroupId: "b", label: "A", collapsed: false, shared: true },
      { id: "b", parentGroupId: "a", label: "B", collapsed: false },
    ];
    expect(syncSubset(dataset, "shared-only").groups).toHaveLength(2);
  });

  test("the subset is a copy — flipping a flag on it cannot reach the dataset", () => {
    const dataset = fixture();
    const subset = syncSubset(dataset, "shared-only");
    subset.rows[0].shared = false;
    expect(dataset.rows.find((row) => row.id === "r1")?.shared).toBe(true);
  });
});

describe("defaultSharedFor", () => {
  test("private when nothing states a preference", () => {
    expect(defaultSharedFor(fixture(), "g1a")).toBe(false);
  });

  test("a group's own override wins", () => {
    const dataset = fixture();
    dataset.groups = dataset.groups.map((group) => (group.id === "g1a" ? { ...group, shareByDefault: true } : group));
    expect(defaultSharedFor(dataset, "g1a")).toBe(true);
  });

  test("the override is inherited by sub-groups", () => {
    const dataset = fixture();
    dataset.groups = dataset.groups.map((group) => (group.id === "g1" ? { ...group, shareByDefault: true } : group));
    expect(defaultSharedFor(dataset, "g1a")).toBe(true);
  });

  test("the nearest ancestor wins, so a sub-group can opt back out", () => {
    const dataset = fixture();
    dataset.groups = dataset.groups.map((group) => {
      if (group.id === "g1") return { ...group, shareByDefault: true };
      if (group.id === "g1a") return { ...group, shareByDefault: false };
      return group;
    });
    expect(defaultSharedFor(dataset, "g1a")).toBe(false);
  });

  test("an unknown or absent group is private", () => {
    expect(defaultSharedFor(fixture(), "nope")).toBe(false);
    expect(defaultSharedFor(fixture(), undefined)).toBe(false);
  });
});

describe("describePublishImpact", () => {
  test("counts the entries and names the group whose label goes with them", () => {
    const dataset = fixture();
    dataset.events = [];
    expect(describePublishImpact(dataset, "r1")).toBe("This shares 1 entry. It also shares the name “Finn”.");
  });

  // Publishing a timeline publishes its moments, so the sentence read before
  // the switch is flipped has to say so.
  test("counts the events too, when there are any", () => {
    expect(describePublishImpact(fixture(), "r1")).toBe(
      "This shares 1 entry and 1 event. It also shares the name “Finn”.",
    );
  });

  test("only the named row's own entries are counted — another row's are not", () => {
    const dataset = fixture();
    dataset.rows = [makeRow("r1", "g1a", true), makeRow("other", "g1a", false)];
    dataset.entries = [makeEntry("e1", "r1"), makeEntry("e2", "other")];
    dataset.events = [];
    expect(describePublishImpact(dataset, "r1")).toBe("This shares 1 entry. It also shares the name “Finn”.");
  });

  test("a top-level row (no group) names no group in the impact", () => {
    const dataset = fixture();
    dataset.rows = [makeRow("top", undefined, true)];
    dataset.entries = [makeEntry("e1", "top")];
    dataset.events = [];
    expect(describePublishImpact(dataset, "top")).toBe("This shares 1 entry.");
  });

  test("an unknown row describes nothing", () => {
    expect(describePublishImpact(fixture(), "nope")).toBe("");
  });
});
