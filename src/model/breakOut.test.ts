import { describe, expect, test } from "vitest";
import { breakOut, canBreakOut, describeBreakOut } from "./breakOut";
import { emptyDataset } from "./dataset";
import { syncSubset } from "./sharing";
import type { TimelineDataset, TimelineEntry, TimelineEvent } from "./types";

// A deterministic stand-in for `newId`: one counter per prefix, so tests can
// assert on exact ids instead of just "some string".
function idFactory(): (prefix: string) => string {
  const counters: Record<string, number> = {};
  return (prefix: string) => {
    counters[prefix] = (counters[prefix] ?? 0) + 1;
    return `${prefix}-${counters[prefix]}`;
  };
}

function makeEntry(id: string, rowId: string, startMs: number, title = id, extra: Partial<TimelineEntry> = {}): TimelineEntry {
  return { id, rowId, title, start: { ms: startMs, precision: "day" }, ...extra };
}

function makeEvent(id: string, rowId: string, dateMs = 0): TimelineEvent {
  return { id, rowId, title: id, date: { ms: dateMs, precision: "day" } };
}

// One group ("Family") holding one row ("Work") with three job entries —
// deliberately out of chronological order in the array, to prove ordering
// comes from `start.ms` and not from array or `entryIds` order.
function threeJobsFixture(): TimelineDataset {
  const dataset = emptyDataset();
  dataset.groups = [{ id: "family", label: "Family", collapsed: false, birthDate: undefined }];
  dataset.rows = [{ id: "r1", groupId: "family", label: "Work", color: "#336699", icon: "💼" }];
  dataset.entries = [
    makeEntry("e-b", "r1", 2000, "Job B"),
    makeEntry("e-c", "r1", 3000, "Job C"),
    makeEntry("e-a", "r1", 1000, "Job A"),
  ];
  return dataset;
}

describe("breakOut — the three-jobs example", () => {
  test("one row becomes a group of three timelines, one per entry, ordered by start date", () => {
    const dataset = threeJobsFixture();
    const result = breakOut(dataset, "r1", undefined, idFactory());
    expect(result).toBeDefined();
    const { dataset: out, groupId, rowIds } = result!;

    expect(rowIds).toHaveLength(3);
    const newRows = rowIds.map((id) => out.rows.find((r) => r.id === id)!);
    expect(newRows.map((r) => r.label)).toEqual(["Job A", "Job B", "Job C"]);
    expect(newRows.every((r) => r.groupId === groupId)).toBe(true);

    // The original row had nothing left on it (no entries, no events) so it
    // is gone entirely — only the three new rows remain.
    expect(out.rows.map((r) => r.id)).toEqual(rowIds);
    expect(out.rows.find((r) => r.id === "r1")).toBeUndefined();

    // Each entry kept every field, only its rowId changed.
    const jobA = out.entries.find((e) => e.id === "e-a")!;
    expect(jobA.title).toBe("Job A");
    expect(jobA.rowId).toBe(newRows[0].id);
  });

  test("the new group inherits the row's label, color, icon, birthDate — never shared or shareByDefault", () => {
    const dataset = threeJobsFixture();
    dataset.rows[0].shared = true;
    dataset.rows[0].birthDate = Date.UTC(1990, 0, 1);
    const { dataset: out, groupId } = breakOut(dataset, "r1", undefined, idFactory())!;
    const group = out.groups.find((g) => g.id === groupId)!;
    expect(group).toMatchObject({
      label: "Work",
      color: "#336699",
      icon: "💼",
      birthDate: Date.UTC(1990, 0, 1),
      collapsed: false,
    });
    expect(group.shared).toBeUndefined();
    expect(group.shareByDefault).toBeUndefined();
  });

  test("new rows inherit the row's shared flag", () => {
    const shared = threeJobsFixture();
    shared.rows[0].shared = true;
    const sharedResult = breakOut(shared, "r1", undefined, idFactory())!;
    expect(sharedResult.dataset.rows.every((r) => r.shared === true)).toBe(true);

    const priv = threeJobsFixture();
    const privResult = breakOut(priv, "r1", undefined, idFactory())!;
    expect(privResult.dataset.rows.every((r) => r.shared === undefined)).toBe(true);
  });

  test("an untitled (blank/whitespace) entry falls back to \"Untitled\"", () => {
    const dataset = threeJobsFixture();
    dataset.entries[0] = makeEntry("e-b", "r1", 2000, "   "); // Job B's slot, now blank
    const { dataset: out, rowIds } = breakOut(dataset, "r1", undefined, idFactory())!;
    const labels = rowIds.map((id) => out.rows.find((r) => r.id === id)!.label);
    expect(labels).toEqual(["Job A", "Untitled", "Job C"]);
  });

  test("does not mutate the input dataset", () => {
    const dataset = threeJobsFixture();
    const snapshot = structuredClone(dataset);
    breakOut(dataset, "r1", undefined, idFactory());
    expect(dataset).toEqual(snapshot);
  });

  test("ties in start date keep their original relative (array) order", () => {
    const dataset = emptyDataset();
    dataset.groups = [{ id: "family", label: "Family", collapsed: false }];
    dataset.rows = [{ id: "r1", groupId: "family", label: "Work" }];
    dataset.entries = [makeEntry("e1", "r1", 500, "First"), makeEntry("e2", "r1", 500, "Second")];
    const { dataset: out, rowIds } = breakOut(dataset, "r1", undefined, idFactory())!;
    const labels = rowIds.map((id) => out.rows.find((r) => r.id === id)!.label);
    expect(labels).toEqual(["First", "Second"]);
  });
});

describe("breakOut — single entry", () => {
  function fixture(): TimelineDataset {
    const dataset = emptyDataset();
    dataset.groups = [{ id: "family", label: "Family", collapsed: false }];
    dataset.rows = [{ id: "r1", groupId: "family", label: "Work", color: "#333", icon: "💼", shared: true }];
    dataset.entries = [
      makeEntry("e-a", "r1", 1000, "Job A"),
      makeEntry("e-b", "r1", 2000, "Job B"),
      makeEntry("e-c", "r1", 3000, "Job C"),
    ];
    return dataset;
  }

  test("only the selected entry moves; the rest stays on the original row", () => {
    const dataset = fixture();
    const result = breakOut(dataset, "r1", ["e-b"], idFactory());
    expect(result).toBeDefined();
    const { dataset: out, groupId, rowIds } = result!;
    expect(rowIds).toHaveLength(1);

    const newRow = out.rows.find((r) => r.id === rowIds[0])!;
    expect(newRow.label).toBe("Job B");
    expect(newRow.groupId).toBe(groupId);
    expect(newRow.shared).toBe(true); // inherited from the source row

    const kept = out.rows.find((r) => r.id === "r1")!;
    expect(kept).toBeDefined();
    expect(kept.groupId).toBe(groupId); // moved into the new group too
    expect(out.entries.filter((e) => e.rowId === "r1").map((e) => e.id).sort()).toEqual(["e-a", "e-c"]);
    expect(out.entries.find((e) => e.id === "e-b")!.rowId).toBe(newRow.id);

    // The kept row stays before the newly created one.
    expect(out.rows.map((r) => r.id)).toEqual(["r1", newRow.id]);
  });

  test("a row with events keeps it alive even if every entry is broken out", () => {
    const dataset = fixture();
    dataset.entries = [makeEntry("e-a", "r1", 1000, "Job A")];
    dataset.events = [makeEvent("v1", "r1")];
    const { dataset: out, groupId, rowIds } = breakOut(dataset, "r1", undefined, idFactory())!;

    const kept = out.rows.find((r) => r.id === "r1");
    expect(kept).toBeDefined();
    expect(kept!.groupId).toBe(groupId);
    expect(out.events.find((e) => e.id === "v1")!.rowId).toBe("r1"); // events never move
    expect(out.entries.filter((e) => e.rowId === "r1")).toEqual([]);
    expect(out.rows.map((r) => r.id)).toEqual(["r1", ...rowIds]);
  });

  test("parentEntryId links are left untouched by a break-out", () => {
    const dataset = fixture();
    dataset.entries.push(makeEntry("e-child", "r1", 2500, "Child", { parentEntryId: "e-b" }));
    const { dataset: out } = breakOut(dataset, "r1", ["e-b"], idFactory())!;
    expect(out.entries.find((e) => e.id === "e-child")!.parentEntryId).toBe("e-b");
  });
});

describe("breakOut — refusal cases", () => {
  test("a row with no entries at all returns undefined", () => {
    const dataset = emptyDataset();
    dataset.groups = [{ id: "family", label: "Family", collapsed: false }];
    dataset.rows = [{ id: "r1", groupId: "family", label: "Work" }];
    expect(breakOut(dataset, "r1")).toBeUndefined();
  });

  test("a non-existent row returns undefined", () => {
    expect(breakOut(threeJobsFixture(), "no-such-row")).toBeUndefined();
  });

  test("an empty entryIds list returns undefined, even with entries on the row", () => {
    expect(breakOut(threeJobsFixture(), "r1", [])).toBeUndefined();
  });

  test("entryIds naming only ids from other rows (or ids that don't exist) returns undefined", () => {
    expect(breakOut(threeJobsFixture(), "r1", ["not-an-entry", "also-missing"])).toBeUndefined();
  });
});

describe("breakOut — group placement (array order is render order)", () => {
  test("the new group is inserted right after the last existing sibling sharing its parentGroupId", () => {
    const dataset = emptyDataset();
    dataset.groups = [
      { id: "family", label: "Family", collapsed: false },
      { id: "family-sub", parentGroupId: "family", label: "Existing sub-group", collapsed: false },
      { id: "friends", label: "Friends", collapsed: false },
    ];
    dataset.rows = [{ id: "r1", groupId: "family", label: "Work" }];
    dataset.entries = [makeEntry("e1", "r1", 0, "Job A")];
    const { dataset: out, groupId } = breakOut(dataset, "r1", undefined, idFactory())!;
    expect(out.groups.map((g) => g.id)).toEqual(["family", "family-sub", groupId, "friends"]);
  });

  test("with no existing sibling, the new group is appended at the very end", () => {
    const dataset = emptyDataset();
    dataset.groups = [
      { id: "family", label: "Family", collapsed: false },
      { id: "friends", label: "Friends", collapsed: false },
    ];
    dataset.rows = [{ id: "r1", groupId: "family", label: "Work" }];
    dataset.entries = [makeEntry("e1", "r1", 0, "Job A")];
    const { dataset: out, groupId } = breakOut(dataset, "r1", undefined, idFactory())!;
    expect(out.groups.map((g) => g.id)).toEqual(["family", "friends", groupId]);
  });

  test("a top-level row (no group at all) produces a top-level new group, sibling to other top-level groups", () => {
    const dataset = emptyDataset();
    dataset.groups = [{ id: "gA", label: "Some other top-level group", collapsed: false }];
    dataset.rows = [{ id: "r1", label: "Work" }]; // groupId undefined: a top-level timeline
    dataset.entries = [makeEntry("e1", "r1", 0, "Job A")];
    const { dataset: out, groupId } = breakOut(dataset, "r1", undefined, idFactory())!;
    const newGroup = out.groups.find((g) => g.id === groupId)!;
    expect(newGroup.parentGroupId).toBeUndefined();
    expect(out.groups.map((g) => g.id)).toEqual(["gA", groupId]);
  });
});

describe("canBreakOut", () => {
  test("true when the row has at least one entry", () => {
    expect(canBreakOut(threeJobsFixture(), "r1")).toBe(true);
  });

  test("false for a row with no entries, an unknown row, or an empty/unmatched entryIds list", () => {
    const empty = emptyDataset();
    empty.groups = [{ id: "family", label: "Family", collapsed: false }];
    empty.rows = [{ id: "r1", groupId: "family", label: "Work" }];
    expect(canBreakOut(empty, "r1")).toBe(false);
    expect(canBreakOut(threeJobsFixture(), "no-such-row")).toBe(false);
    expect(canBreakOut(threeJobsFixture(), "r1", [])).toBe(false);
    expect(canBreakOut(threeJobsFixture(), "r1", ["not-here"])).toBe(false);
  });
});

describe("describeBreakOut", () => {
  test("breaking out the whole row reads as the row becoming a group", () => {
    expect(describeBreakOut(threeJobsFixture(), "r1")).toBe(
      "“Work” becomes a group with 3 timelines: Job A, Job B, Job C.",
    );
  });

  test("breaking out a single entry (with a remainder) reads as that entry moving", () => {
    const dataset = threeJobsFixture();
    expect(describeBreakOut(dataset, "r1", ["e-a"])).toBe(
      "“Job A” moves onto its own timeline inside a new group “Work”.",
    );
  });

  test("returns empty string when there is nothing to break out, or the row doesn't exist", () => {
    expect(describeBreakOut(threeJobsFixture(), "no-such-row")).toBe("");
    expect(describeBreakOut(threeJobsFixture(), "r1", [])).toBe("");
  });
});

// The privacy gate (src/model/sharing.ts) must not notice a break-out at all:
// entries keep their ids and their row's `shared` flag is carried onto the
// row(s) they land on, so what leaves the device is exactly the same before
// and after.
describe("breakOut is a no-op for sharing", () => {
  test("syncSubset yields the same entry ids and the same published/unpublished split before and after", () => {
    const dataset = emptyDataset();
    dataset.groups = [
      { id: "family", label: "Family", collapsed: false },
      { id: "finn", parentGroupId: "family", label: "Finn", collapsed: false },
    ];
    dataset.rows = [
      { id: "r1", groupId: "finn", label: "Work", color: "#333", shared: true }, // published
      { id: "r2", groupId: "finn", label: "Diary", color: "#333" }, // private
    ];
    dataset.entries = [
      makeEntry("e-a", "r1", 1000, "Job A"),
      makeEntry("e-b", "r1", 2000, "Job B"),
      makeEntry("e-c", "r1", 3000, "Job C"),
      makeEntry("e-d", "r2", 4000, "Secret"),
    ];

    const before = syncSubset(dataset, "shared-only");
    const beforeIds = new Set(before.entries.map((e) => e.id));
    const beforeRowIds = new Set(before.rows.map((r) => r.id));

    const { dataset: after } = breakOut(dataset, "r1", undefined, idFactory())!;
    const afterSubset = syncSubset(after, "shared-only");
    const afterIds = new Set(afterSubset.entries.map((e) => e.id));

    // Same universe of entries considered at all.
    expect(dataset.entries.map((e) => e.id).sort()).toEqual(after.entries.map((e) => e.id).sort());
    // Same set of entries actually published.
    expect(afterIds).toEqual(beforeIds);
    expect(afterIds.has("e-a")).toBe(true);
    expect(afterIds.has("e-b")).toBe(true);
    expect(afterIds.has("e-c")).toBe(true);
    expect(afterIds.has("e-d")).toBe(false); // stayed private throughout

    // r1 is gone (nothing left on it) and replaced by three published rows —
    // the row-level split changed shape, but the row that was published
    // before break-out is unpublished nowhere, and vice versa.
    expect(beforeRowIds.has("r1")).toBe(true);
    expect(afterSubset.rows.every((r) => r.shared === true)).toBe(true);
    expect(afterSubset.rows.some((r) => r.id === "r2")).toBe(false);
  });
});
