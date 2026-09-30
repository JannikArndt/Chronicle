import { describe, expect, test } from "vitest";
import { defaultSharedFor, describePublishImpact } from "./sharing";
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
