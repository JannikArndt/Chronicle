import { describe, expect, test } from "vitest";
import { planPush } from "./diff";
import { formatHlc } from "./hlc";
import { mergeRecords, pickWinner } from "./lww";
import { datasetToRecordsRoundTrip, recordsFromSubset } from "./records";
import { syncSubset } from "../model/sharing";
import { emptyDataset } from "../model/dataset";
import type { SyncRecord } from "./records";
import type { TimelineDataset } from "../model/types";

const clockAt = (wall: number, node = "acct-me"): string => formatHlc({ wall, counter: 0, node });

function makeRecord(overrides: Partial<SyncRecord> = {}): SyncRecord {
  return {
    kind: "row",
    id: "r1",
    ownerAccountId: "acct-me",
    parentId: "g1",
    shared: true,
    payload: { label: "Job" },
    clock: clockAt(100),
    updatedBy: "acct-me",
    deleted: false,
    ...overrides,
  };
}

// One published timeline with one entry, in a group.
function fixture(): TimelineDataset {
  const dataset = emptyDataset();
  dataset.groups = [{ id: "g1", label: "Me", collapsed: false }];
  dataset.rows = [{ id: "r1", groupId: "g1", label: "Job", color: "#333", shared: true }];
  dataset.entries = [{ id: "e1", rowId: "r1", title: "Acme", start: { ms: 0, precision: "year" } }];
  return dataset;
}

function push(dataset: TimelineDataset, snapshot: SyncRecord[], wall: number) {
  const current = recordsFromSubset(syncSubset(dataset, "shared-only"), "acct-me", clockAt(wall));
  return planPush(snapshot, current);
}

describe("recordsFromSubset", () => {
  test("splits structural columns from the content payload", () => {
    const records = recordsFromSubset(syncSubset(fixture(), "shared-only"), "acct-me", clockAt(1));
    const row = records.find((record) => record.kind === "row")!;
    expect(row.parentId).toBe("g1");
    expect(row.shared).toBe(true);
    // Ids and container links are columns, never duplicated into the payload —
    // that is the line E2EE would encrypt along.
    expect(row.payload).toEqual({ label: "Job", color: "#333" });
    expect(row.payload).not.toHaveProperty("id");
    expect(row.payload).not.toHaveProperty("groupId");
  });

  test("entries carry shared: false — their row is what RLS consults", () => {
    const records = recordsFromSubset(syncSubset(fixture(), "shared-only"), "acct-me", clockAt(1));
    expect(records.find((record) => record.kind === "entry")!.shared).toBe(false);
  });

  test("round-trips back into a dataset", () => {
    const records = recordsFromSubset(syncSubset(fixture(), "shared-only"), "acct-me", clockAt(1));
    const rebuilt = datasetToRecordsRoundTrip(records);
    expect(rebuilt.groups.map((group) => group.id)).toEqual(["g1"]);
    expect(rebuilt.rows[0].label).toBe("Job");
    expect(rebuilt.entries[0].title).toBe("Acme");
  });

  test("rebuilding drops tombstones and anything orphaned by them", () => {
    const records = recordsFromSubset(syncSubset(fixture(), "shared-only"), "acct-me", clockAt(1)).map((record) =>
      record.kind === "row" ? { ...record, deleted: true, payload: null } : record,
    );
    const rebuilt = datasetToRecordsRoundTrip(records);
    expect(rebuilt.rows).toEqual([]);
    // The entry survived the wire but has no row to sit on, so it is dropped
    // rather than rendered against a lane that is not there.
    expect(rebuilt.entries).toEqual([]);
  });
});

describe("planPush", () => {
  test("first push sends everything", () => {
    const plan = push(fixture(), [], 100);
    expect(plan.writes).toHaveLength(3);
    expect(plan.nextSnapshot).toHaveLength(3);
  });

  test("an unchanged dataset sends nothing", () => {
    const dataset = fixture();
    const first = push(dataset, [], 100);
    expect(push(dataset, first.nextSnapshot, 200).writes).toEqual([]);
  });

  test("unchanged records keep their original clock", () => {
    const dataset = fixture();
    const first = push(dataset, [], 100);
    const second = push(dataset, first.nextSnapshot, 999);
    expect(second.nextSnapshot.every((record) => record.clock === clockAt(100))).toBe(true);
  });

  test("an edit sends only the record that changed", () => {
    const dataset = fixture();
    const first = push(dataset, [], 100);
    dataset.entries[0].title = "Acme Corp";
    const second = push(dataset, first.nextSnapshot, 200);
    expect(second.writes.map((record) => record.id)).toEqual(["e1"]);
    expect(second.writes[0].clock).toBe(clockAt(200));
  });

  test("key order alone is not a change", () => {
    const dataset = fixture();
    const first = push(dataset, [], 100);
    // What `Object.assign` patching produces: same content, different insertion order.
    dataset.rows[0] = { label: "Job", color: "#333", shared: true, groupId: "g1", id: "r1" };
    expect(push(dataset, first.nextSnapshot, 200).writes).toEqual([]);
  });

  // The group goes too, and that is the point: it was on the server only as the
  // container of a published row. Once nothing in it is shared, its name has no
  // business still being there.
  test("un-publishing the last row in a group tombstones the row, its entries and the group", () => {
    const dataset = fixture();
    const first = push(dataset, [], 100);
    dataset.rows[0].shared = false;
    const second = push(dataset, first.nextSnapshot, 200);
    const tombstoned = second.writes.filter((record) => record.deleted);
    expect(tombstoned.map((record) => record.id).sort()).toEqual(["e1", "g1", "r1"]);
    expect(tombstoned.every((record) => record.payload === null)).toBe(true);
  });

  test("a group with another published row in it stays up", () => {
    const dataset = fixture();
    dataset.rows.push({ id: "r2", groupId: "g1", label: "Hobbies", color: "#333", shared: true });
    const first = push(dataset, [], 100);
    dataset.rows[0].shared = false;
    const second = push(dataset, first.nextSnapshot, 200);
    expect(second.writes.some((record) => record.id === "g1")).toBe(false);
  });

  test("deleting a row tombstones it too — the wire cannot tell the two apart", () => {
    const dataset = fixture();
    const first = push(dataset, [], 100);
    dataset.rows = [];
    dataset.entries = [];
    const second = push(dataset, first.nextSnapshot, 200);
    expect(second.writes.filter((record) => record.deleted).map((record) => record.id).sort()).toEqual([
      "e1",
      "g1",
      "r1",
    ]);
  });

  test("a tombstone is sent once, not on every later push", () => {
    const dataset = fixture();
    const first = push(dataset, [], 100);
    dataset.rows[0].shared = false;
    const second = push(dataset, first.nextSnapshot, 200);
    expect(second.writes.some((record) => record.deleted)).toBe(true);
    expect(push(dataset, second.nextSnapshot, 300).writes).toEqual([]);
  });

  test("re-publishing after an un-publish sends a live record again", () => {
    const dataset = fixture();
    const first = push(dataset, [], 100);
    dataset.rows[0].shared = false;
    const second = push(dataset, first.nextSnapshot, 200);
    dataset.rows[0].shared = true;
    const third = push(dataset, second.nextSnapshot, 300);
    const row = third.writes.find((record) => record.id === "r1")!;
    expect(row.deleted).toBe(false);
    expect(row.payload).not.toBeNull();
  });

  // The whole point of D2's opt-in: turning full sync back off has to delete the
  // private records from the server, not just stop updating them.
  test("narrowing the sync mode tombstones what is no longer eligible", () => {
    const dataset = fixture();
    dataset.rows.push({ id: "r-private", groupId: "g1", label: "Therapy", color: "#333" });
    const everything = recordsFromSubset(syncSubset(dataset, "everything"), "acct-me", clockAt(100));
    const first = planPush([], everything);
    expect(first.writes.some((record) => record.id === "r-private")).toBe(true);

    const narrowed = recordsFromSubset(syncSubset(dataset, "shared-only"), "acct-me", clockAt(200));
    const second = planPush(first.nextSnapshot, narrowed);
    const tombstone = second.writes.find((record) => record.id === "r-private")!;
    expect(tombstone.deleted).toBe(true);
    expect(tombstone.payload).toBeNull();
  });
});

describe("mergeRecords", () => {
  test("the later clock wins", () => {
    const older = makeRecord({ clock: clockAt(100), payload: { label: "Job" } });
    const newer = makeRecord({ clock: clockAt(200), payload: { label: "New job" } });
    expect(mergeRecords([older], [newer])[0].payload).toEqual({ label: "New job" });
    expect(mergeRecords([newer], [older])[0].payload).toEqual({ label: "New job" });
  });

  test("merging is order-independent — three writers converge", () => {
    const a = makeRecord({ clock: clockAt(100, "acct-a"), updatedBy: "acct-a", payload: { label: "A" } });
    const b = makeRecord({ clock: clockAt(300, "acct-b"), updatedBy: "acct-b", payload: { label: "B" } });
    const c = makeRecord({ clock: clockAt(200, "acct-c"), updatedBy: "acct-c", payload: { label: "C" } });
    const one = mergeRecords(mergeRecords([a], [b]), [c]);
    const two = mergeRecords(mergeRecords([c], [a]), [b]);
    expect(one).toEqual(two);
    expect(one[0].payload).toEqual({ label: "B" });
  });

  // Without tombstones this is the resurrection bug: a delete arriving before a
  // concurrent older edit gets undone by that edit.
  test("a delete is not undone by an older edit arriving after it", () => {
    const deletion = makeRecord({ clock: clockAt(300), deleted: true, payload: null });
    const staleEdit = makeRecord({ clock: clockAt(100), payload: { label: "Job" } });
    expect(mergeRecords([deletion], [staleEdit])[0].deleted).toBe(true);
  });

  test("a newer edit does revive a deleted record — that is LWW, not a bug", () => {
    const deletion = makeRecord({ clock: clockAt(100), deleted: true, payload: null });
    const newerEdit = makeRecord({ clock: clockAt(300), payload: { label: "Back" } });
    expect(mergeRecords([deletion], [newerEdit])[0].deleted).toBe(false);
  });

  test("records with different keys all survive", () => {
    const row = makeRecord({ kind: "row", id: "r1" });
    const entry = makeRecord({ kind: "entry", id: "e1" });
    const sameIdDifferentKind = makeRecord({ kind: "group", id: "r1" });
    expect(mergeRecords([row], [entry, sameIdDifferentKind])).toHaveLength(3);
  });

  test("on an exact clock tie the delete wins", () => {
    const edit = makeRecord({ clock: clockAt(100) });
    const deletion = makeRecord({ clock: clockAt(100), deleted: true, payload: null });
    expect(pickWinner(edit, deletion).deleted).toBe(true);
    expect(pickWinner(deletion, edit).deleted).toBe(true);
  });
});
