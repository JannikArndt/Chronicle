import "fake-indexeddb/auto";
import { beforeEach, describe, expect, test } from "vitest";
import {
  addEvent,
  addOnboardingPlaceEntry,
  addRow,
  addSubGroup,
  armDatePicking,
  cancelDatePicking,
  clearSelection,
  commitPickedDate,
  completeIdentityStep,
  copyGroup,
  copyRow,
  deleteEvent,
  deleteRowWithCascade,
  moveGroup,
  moveRow,
  replaceDataset,
  selectEntry,
  selectEvent,
  selectRow,
  setGroupShareByDefault,
  setRowShared,
  startDraft,
  updateDraft,
  updateEvent,
  updateOnboardingPlaceEntry,
} from "./actions";
import { appStore, mergedDataset } from "./store";
import { serializeDataset } from "../storage/exportImport";
import { SCHEMA_VERSION } from "../model/types";
import { emptyDataset } from "../model/dataset";
import { DAY_MS } from "../model/fuzzyDate";
import type { TimelineDataset } from "../model/types";

const T0 = Date.UTC(2020, 0, 1);

function fixture(): TimelineDataset {
  const ds = emptyDataset();
  ds.groups = [{ id: "g1", label: "Me", collapsed: false }];
  ds.rows = [{ id: "r1", groupId: "g1", color: "#333", label: "Job" }];
  ds.entries = [
    {
      id: "e1",
      rowId: "r1",
      title: "First job",
      start: { ms: T0, precision: "day" },
    },
  ];
  return ds;
}

beforeEach(() => {
  replaceDataset(fixture());
});

describe("events", () => {
  test("an event is written straight away — there is no draft state for a moment", () => {
    const id = addEvent("r1", "First kiss", { ms: T0, precision: "day" }, "💋");
    const [event] = appStore.getState().dataset.events;
    expect(event).toMatchObject({ id, rowId: "r1", title: "First kiss", icon: "💋" });
    expect(event.date).toEqual({ ms: T0, precision: "day" });
  });

  test("editing one field leaves the rest alone", () => {
    const id = addEvent("r1", "First kiss", { ms: T0, precision: "day" });
    updateEvent(id, { description: "on the school steps" });
    expect(appStore.getState().dataset.events[0]).toMatchObject({
      title: "First kiss",
      description: "on the school steps",
    });
  });

  test("selecting an event deselects whatever entry or row was open, and back", () => {
    const id = addEvent("r1", "First kiss", { ms: T0, precision: "day" });
    selectEntry("e1");
    selectEvent(id);
    expect(appStore.getState().selectedEntryId).toBeUndefined();
    expect(appStore.getState().selectedEventId).toBe(id);
    selectEntry("e1");
    expect(appStore.getState().selectedEventId).toBeUndefined();
  });

  test("selecting a row remembers where on the axis it was clicked", () => {
    selectRow("r1", T0);
    expect(appStore.getState().selectedRowClickMs).toBe(T0);
    selectRow(undefined);
    expect(appStore.getState().selectedRowClickMs).toBeUndefined();
  });

  test("deleting an event removes it and clears the selection", () => {
    const id = addEvent("r1", "First kiss", { ms: T0, precision: "day" });
    selectEvent(id);
    deleteEvent(id);
    expect(appStore.getState().dataset.events).toEqual([]);
    expect(appStore.getState().selectedEventId).toBeUndefined();
  });

  test("deleting the timeline takes its events with it", () => {
    addEvent("r1", "First kiss", { ms: T0, precision: "day" });
    deleteRowWithCascade("r1");
    expect(appStore.getState().dataset.events).toEqual([]);
  });
});

describe("draft lifecycle", () => {
  test("a draft is not inserted until it has a title", () => {
    startDraft("r1", T0 + 100 * DAY_MS);
    expect(appStore.getState().dataset.entries).toHaveLength(1);
    updateDraft({ description: "still untitled" });
    expect(appStore.getState().dataset.entries).toHaveLength(1);
    expect(appStore.getState().draft?.description).toBe("still untitled");
  });

  test("titling the draft commits it as a new entry", () => {
    startDraft("r1", T0 + 100 * DAY_MS);
    updateDraft({ title: "Second job" });
    const { dataset, draft, selectedEntryId } = appStore.getState();
    expect(draft).toBeUndefined();
    expect(dataset.entries).toHaveLength(2);
    expect(selectedEntryId).toBe(dataset.entries[1].id);
  });

  test("an overlapping draft is inserted freely — rows are always concurrent", () => {
    startDraft("r1", T0 - 200 * DAY_MS);
    updateDraft({ title: "Backfilled", end: { ms: T0 + 5 * DAY_MS, precision: "day" } });
    const state = appStore.getState();
    expect(state.dataset.entries).toHaveLength(2);
    expect(state.dataset.entries.some((e) => e.title === "Backfilled")).toBe(true);
  });
});

describe("pick-on-timeline chaining", () => {
  test("starting a draft arms start→end as a chain", () => {
    startDraft("r1", T0);
    const state = appStore.getState();
    expect(state.pickingField).toBe("start");
    expect(state.pickChain).toEqual(["end"]);
  });

  test("committing the chained start pick re-arms end, then committing end finishes", () => {
    startDraft("r1", T0);
    commitPickedDate(T0 + 10 * DAY_MS, "day");
    let state = appStore.getState();
    expect(state.pickedDate).toEqual({ ms: T0 + 10 * DAY_MS, precision: "day", field: "start" });
    expect(state.pickingField).toBe("end");
    expect(state.pickChain).toEqual([]);

    commitPickedDate(T0 + 20 * DAY_MS, "day");
    state = appStore.getState();
    expect(state.pickedDate).toEqual({ ms: T0 + 20 * DAY_MS, precision: "day", field: "end" });
    expect(state.pickingField).toBeUndefined();
  });

  test("armDatePicking with no chain argument still ends picking after one commit", () => {
    armDatePicking("end");
    expect(appStore.getState().pickChain).toEqual([]);
    commitPickedDate(T0, "day");
    const state = appStore.getState();
    expect(state.pickedDate?.field).toBe("end");
    expect(state.pickingField).toBeUndefined();
  });

  test("cancelDatePicking clears both pickingField and pickChain", () => {
    startDraft("r1", T0);
    cancelDatePicking();
    const state = appStore.getState();
    expect(state.pickingField).toBeUndefined();
    expect(state.pickChain).toBeUndefined();
  });

  test("clearSelection clears both pickingField and pickChain", () => {
    startDraft("r1", T0);
    clearSelection();
    const state = appStore.getState();
    expect(state.pickingField).toBeUndefined();
    expect(state.pickChain).toBeUndefined();
  });
});

describe("selection", () => {
  test("selecting a row clears entry selection and draft", () => {
    startDraft("r1", T0);
    selectRow("r1");
    const state = appStore.getState();
    expect(state.draft).toBeUndefined();
    expect(state.selectedRowId).toBe("r1");
  });
});

// Three groups, three rows: r1 and r2 in g1, r3 in g2, g3 empty.
// Array order is display order — that's what these actions move.
function dragFixture(): TimelineDataset {
  const ds = emptyDataset();
  ds.groups = [
    { id: "g1", label: "Me", collapsed: false },
    { id: "g2", label: "Family", collapsed: false },
    { id: "g3", label: "Empty", collapsed: false },
  ];
  ds.rows = [
    { id: "r1", groupId: "g1", color: "#333", label: "Job" },
    { id: "r2", groupId: "g1", color: "#333", label: "Home" },
    { id: "r3", groupId: "g2", color: "#333", label: "School" },
  ];
  return ds;
}

function groupOrder(): string[] {
  return appStore.getState().dataset.groups.map((g) => g.id);
}

function rowOrder(): string[] {
  return appStore.getState().dataset.rows.map((r) => r.id);
}

function rowById(rowId: string) {
  return appStore.getState().dataset.rows.find((r) => r.id === rowId);
}

describe("rail drag-and-drop: moveGroup", () => {
  beforeEach(() => {
    replaceDataset(dragFixture());
  });

  test("moves a group to the front, same level", () => {
    moveGroup("g3", null, "g1");
    expect(groupOrder()).toEqual(["g3", "g1", "g2"]);
  });

  test("moves a group to the middle, same level", () => {
    moveGroup("g1", null, "g3");
    expect(groupOrder()).toEqual(["g2", "g1", "g3"]);
  });

  test("moves a group to the end with a null sibling", () => {
    moveGroup("g1", null, null);
    expect(groupOrder()).toEqual(["g2", "g3", "g1"]);
  });

  test("dropping a group onto itself is a no-op", () => {
    moveGroup("g2", null, "g2");
    expect(groupOrder()).toEqual(["g1", "g2", "g3"]);
  });

  test("an unknown group id is a no-op", () => {
    moveGroup("no-such-group", null, "g1");
    expect(groupOrder()).toEqual(["g1", "g2", "g3"]);
  });

  test("an unknown beforeGroupId is a no-op", () => {
    moveGroup("g1", null, "no-such-group");
    expect(groupOrder()).toEqual(["g1", "g2", "g3"]);
  });

  test("nests a top-level group inside another, at arbitrary depth", () => {
    moveGroup("g3", "g2", null);
    const g3 = appStore.getState().dataset.groups.find((g) => g.id === "g3");
    expect(g3?.parentGroupId).toBe("g2");
    // g1's own children stay at the front of g2's, ahead of the newly nested g3.
    expect(groupOrder()).toEqual(["g1", "g2", "g3"]);
  });

  test("un-nests a sub-group back to the root", () => {
    const ds = dragFixture();
    ds.groups.push({ id: "g2a", parentGroupId: "g2", label: "Alex", collapsed: false });
    replaceDataset(ds);
    moveGroup("g2a", null, null);
    expect(appStore.getState().dataset.groups.find((g) => g.id === "g2a")?.parentGroupId).toBeUndefined();
  });

  test("cannot nest a group inside its own descendant", () => {
    const ds = dragFixture();
    ds.groups.push({ id: "g2a", parentGroupId: "g2", label: "Alex", collapsed: false });
    replaceDataset(ds);
    moveGroup("g2", "g2a", null);
    expect(appStore.getState().dataset.groups.find((g) => g.id === "g2")?.parentGroupId).toBeUndefined();
  });

  test("cannot nest a group inside itself", () => {
    moveGroup("g2", "g2", null);
    expect(appStore.getState().dataset.groups.find((g) => g.id === "g2")?.parentGroupId).toBeUndefined();
  });
});

describe("rail drag-and-drop: moveRow", () => {
  beforeEach(() => {
    replaceDataset(dragFixture());
  });

  test("reorders within a group (to the front)", () => {
    moveRow("r2", "g1", "r1");
    expect(rowOrder()).toEqual(["r2", "r1", "r3"]);
    expect(rowById("r2")?.groupId).toBe("g1");
  });

  test("reorders within a group (to the end via null sibling)", () => {
    moveRow("r1", "g1", null);
    expect(rowOrder()).toEqual(["r2", "r1", "r3"]);
  });

  test("moves a row into another group before a sibling", () => {
    moveRow("r1", "g2", "r3");
    expect(rowOrder()).toEqual(["r2", "r1", "r3"]);
    expect(rowById("r1")?.groupId).toBe("g2");
  });

  test("moves a row to the end of another group with a null sibling", () => {
    moveRow("r1", "g2", null);
    expect(rowOrder()).toEqual(["r2", "r3", "r1"]);
    expect(rowById("r1")?.groupId).toBe("g2");
  });

  test("moves a row into an empty group", () => {
    moveRow("r1", "g3", null);
    expect(rowById("r1")?.groupId).toBe("g3");
  });

  test("moves a row into a sub-group, which is how it changes person", () => {
    const ds = dragFixture();
    ds.groups.push({ id: "g2a", parentGroupId: "g2", label: "Alex", collapsed: false });
    replaceDataset(ds);
    moveRow("r1", "g2a", null);
    expect(rowById("r1")?.groupId).toBe("g2a");
  });

  test("dropping a row onto itself is a no-op", () => {
    moveRow("r1", "g1", "r1");
    expect(rowOrder()).toEqual(["r1", "r2", "r3"]);
  });

  test("an unknown row id is a no-op", () => {
    moveRow("no-such-row", "g1", null);
    expect(rowOrder()).toEqual(["r1", "r2", "r3"]);
  });

  test("an unknown target group is a no-op", () => {
    moveRow("r1", "no-such-group", null);
    expect(rowOrder()).toEqual(["r1", "r2", "r3"]);
    expect(rowById("r1")?.groupId).toBe("g1");
  });

  test("a beforeRowId outside the target group is a no-op", () => {
    moveRow("r1", "g2", "r2"); // r2 lives in g1, not g2
    expect(rowOrder()).toEqual(["r1", "r2", "r3"]);
    expect(rowById("r1")?.groupId).toBe("g1");
  });

  test("moves a row out to the top level, no group at all", () => {
    moveRow("r1", null, null);
    expect(rowById("r1")?.groupId).toBeUndefined();
  });

  test("moves a top-level row into a group", () => {
    const ds = dragFixture();
    ds.rows.push({ id: "r-top", label: "Top-level", color: "#333" });
    replaceDataset(ds);
    moveRow("r-top", "g1", null);
    expect(rowById("r-top")?.groupId).toBe("g1");
  });
});

describe("rail drag-and-drop: copyRow / copyGroup (deep copy)", () => {
  beforeEach(() => {
    replaceDataset(dragFixture());
  });

  test("copyRow duplicates the row and its entries with fresh ids", () => {
    const ds = appStore.getState().dataset;
    ds.entries.push({ id: "e1", rowId: "r1", title: "Original", start: { ms: T0, precision: "day" } });
    replaceDataset(ds);

    const newRowId = copyRow("r1");
    expect(newRowId).toBeDefined();
    expect(newRowId).not.toBe("r1");

    const state = appStore.getState();
    const copiedRow = state.dataset.rows.find((r) => r.id === newRowId)!;
    expect(copiedRow.label).toBe("Job");
    expect(copiedRow.groupId).toBe("g1");

    const copiedEntries = state.dataset.entries.filter((e) => e.rowId === newRowId);
    expect(copiedEntries).toHaveLength(1);
    expect(copiedEntries[0].id).not.toBe("e1");
    expect(copiedEntries[0].title).toBe("Original");
  });

  test("copyGroup duplicates nested sub-groups, their rows, and entries — all with fresh ids", () => {
    const ds = dragFixture();
    ds.groups.push({ id: "g1a", parentGroupId: "g1", label: "Finn", collapsed: false });
    ds.rows.push({ id: "r1a", groupId: "g1a", color: "#333", label: "School" });
    ds.entries.push({ id: "e1a", rowId: "r1a", title: "First day", start: { ms: T0, precision: "day" } });
    replaceDataset(ds);

    const newGroupId = copyGroup("g1");
    expect(newGroupId).toBeDefined();
    expect(newGroupId).not.toBe("g1");

    const state = appStore.getState();
    const copiedSubGroup = state.dataset.groups.find(
      (g) => g.parentGroupId === newGroupId && g.label === "Finn",
    );
    expect(copiedSubGroup).toBeDefined();
    expect(copiedSubGroup!.id).not.toBe("g1a");

    const copiedRows = state.dataset.rows.filter((r) => r.groupId === newGroupId || r.groupId === copiedSubGroup!.id);
    expect(copiedRows.map((r) => r.label).sort()).toEqual(["Home", "Job", "School"]);

    const copiedSubRow = copiedRows.find((r) => r.label === "School")!;
    const copiedEntries = state.dataset.entries.filter((e) => e.rowId === copiedSubRow.id);
    expect(copiedEntries).toHaveLength(1);
    expect(copiedEntries[0].id).not.toBe("e1a");
  });

  test("a copy is always private, even when the original was shared", () => {
    setRowShared("r1", true);
    const newRowId = copyRow("r1");
    expect(appStore.getState().dataset.rows.find((r) => r.id === newRowId)?.shared).toBeUndefined();
  });
});

describe("onboarding: completeIdentityStep", () => {
  test("creates the self group and a Places lived row", () => {
    replaceDataset(emptyDataset());
    const result = completeIdentityStep("Jannik");
    const state = appStore.getState();

    expect(state.dataset.selfGroupId).toBe(result.groupId);

    const group = state.dataset.groups.find((g) => g.id === result.groupId);
    expect(group?.label).toBe("Jannik");

    const row = state.dataset.rows.find((r) => r.id === result.placesRowId);
    expect(row?.label).toBe("Places lived");
    expect(row?.groupId).toBe(result.groupId);
  });
});

describe("onboarding: addOnboardingPlaceEntry", () => {
  test("addOnboardingPlaceEntry chains consecutive places and leaves the last one ongoing", () => {
    replaceDataset(emptyDataset());
    const { placesRowId } = completeIdentityStep("Jannik");
    const year1990 = Date.UTC(1990, 6, 1);
    const year2005 = Date.UTC(2005, 6, 1);

    addOnboardingPlaceEntry(placesRowId, { label: "Berlin", startMs: year1990, endMs: year2005 });
    addOnboardingPlaceEntry(placesRowId, { label: "Munich", startMs: year2005 });

    const entries = appStore.getState().dataset.entries.filter((e) => e.rowId === placesRowId);
    expect(entries).toHaveLength(2);

    const berlin = entries.find((e) => e.title === "Berlin")!;
    const munich = entries.find((e) => e.title === "Munich")!;
    expect(berlin.end?.ms).toBe(year2005);
    expect(berlin.start.precision).toBe("year");
    expect(munich.end).toBeUndefined();
  });

  test("addOnboardingPlaceEntry allows overlapping places — rows are always concurrent", () => {
    replaceDataset(emptyDataset());
    const { placesRowId } = completeIdentityStep("Jannik");
    const year1985 = Date.UTC(1985, 6, 1);
    const year1990 = Date.UTC(1990, 6, 1);
    const year2000 = Date.UTC(2000, 6, 1);
    const year2005 = Date.UTC(2005, 6, 1);

    addOnboardingPlaceEntry(placesRowId, { label: "Berlin", startMs: year1990, endMs: year2005 });
    addOnboardingPlaceEntry(placesRowId, { label: "Overlap", startMs: year1985, endMs: year2000 });

    const entries = appStore.getState().dataset.entries.filter((e) => e.rowId === placesRowId);
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.title).sort()).toEqual(["Berlin", "Overlap"]);
  });

  test("addOnboardingPlaceEntry returns the created entry's id", () => {
    replaceDataset(emptyDataset());
    const { placesRowId } = completeIdentityStep("Jannik");
    const year1990 = Date.UTC(1990, 6, 1);
    const year2005 = Date.UTC(2005, 6, 1);

    const berlinId = addOnboardingPlaceEntry(placesRowId, { label: "Berlin", startMs: year1990, endMs: year2005 });
    expect(typeof berlinId).toBe("string");
    expect(appStore.getState().dataset.entries.find((e) => e.id === berlinId)?.title).toBe("Berlin");
  });
});

describe("onboarding: updateOnboardingPlaceEntry", () => {
  test("updates an existing entry's title, dates, and place data in place", () => {
    replaceDataset(emptyDataset());
    const { placesRowId } = completeIdentityStep("Jannik");
    const year1990 = Date.UTC(1990, 6, 1);
    const year2005 = Date.UTC(2005, 6, 1);
    const year2010 = Date.UTC(2010, 6, 1);

    const entryId = addOnboardingPlaceEntry(placesRowId, { label: "Berlin", startMs: year1990, endMs: year2005 });

    updateOnboardingPlaceEntry(entryId, {
      label: "Munich",
      startMs: year1990,
      endMs: year2010,
      fullName: "Munich, Bavaria, Germany",
      city: "Munich",
      country: "Germany",
    });

    const state = appStore.getState();
    const entries = state.dataset.entries.filter((e) => e.rowId === placesRowId);
    expect(entries).toHaveLength(1); // still one entry — an update, not an append
    const entry = entries[0];
    expect(entry.id).toBe(entryId);
    expect(entry.title).toBe("Munich");
    expect(entry.start.ms).toBe(year1990);
    expect(entry.end?.ms).toBe(year2010);
    expect(entry.place?.city).toBe("Munich");
    expect(entry.place?.country).toBe("Germany");
  });

  test("does nothing if the entry id no longer exists", () => {
    replaceDataset(emptyDataset());
    completeIdentityStep("Jannik");
    const before = appStore.getState().dataset.entries.length;

    updateOnboardingPlaceEntry("no-such-entry", { label: "Ghost", startMs: Date.UTC(2000, 0, 1) });

    expect(appStore.getState().dataset.entries).toHaveLength(before);
  });
});

describe("sharing defaults (schema v7)", () => {
  beforeEach(() => {
    replaceDataset(fixture());
  });

  test("a new timeline is private", () => {
    const id = addRow("g1", "Hobbies");
    expect(appStore.getState().dataset.rows.find((row) => row.id === id)?.shared).toBeUndefined();
  });

  test("a new timeline in a shareByDefault group starts shared", () => {
    setGroupShareByDefault("g1", true);
    const id = addRow("g1", "Hobbies");
    expect(appStore.getState().dataset.rows.find((row) => row.id === id)?.shared).toBe(true);
  });

  test("the override is inherited by a sub-group's starter timeline", () => {
    setGroupShareByDefault("g1", true);
    addSubGroup("g1", "Finn");
    const finn = appStore.getState().dataset.groups.find((group) => group.label === "Finn")!;
    const starter = appStore.getState().dataset.rows.find((row) => row.groupId === finn.id)!;
    expect(starter.shared).toBe(true);
  });

  // shareByDefault decides what the NEXT timeline starts as. Reaching back and
  // publishing the ones already there would turn one toggle into a bulk share
  // of everything in the group, which is the opposite of private-by-default.
  test("turning on shareByDefault does not publish the timelines already there", () => {
    setGroupShareByDefault("g1", true);
    expect(appStore.getState().dataset.rows.find((row) => row.id === "r1")?.shared).toBeUndefined();
  });

  test("un-publishing clears the flag rather than storing false", () => {
    setRowShared("r1", true);
    expect(appStore.getState().dataset.rows.find((row) => row.id === "r1")?.shared).toBe(true);
    setRowShared("r1", false);
    expect(appStore.getState().dataset.rows.find((row) => row.id === "r1")?.shared).toBeUndefined();
  });
});

describe("mirrors stay out of the user's own data", () => {
  const mirror = {
    ownerAccountId: "acct-dad",
    ownerName: "Dad",
    role: "reader" as const,
    dataset: {
      schemaVersion: SCHEMA_VERSION,
      groups: [{ id: "shared:acct-dad:g1", label: "Dad", collapsed: false }],
      rows: [{ id: "shared:acct-dad:r1", groupId: "shared:acct-dad:g1", label: "His jobs" }],
      entries: [],
      events: [],
    },
  };

  beforeEach(() => {
    replaceDataset(fixture());
    appStore.setState({ sharing: { ...appStore.getState().sharing, mirrors: [mirror] } });
  });

  test("a mirror is drawn — it is merged into the view", () => {
    expect(mergedDataset(appStore.getState()).rows.map((row) => row.label)).toContain("His jobs");
  });

  // The privacy guarantee that makes §D8 worth the indirection: an export
  // serialises `state.dataset`, so someone else's timelines cannot be in it.
  test("a mirror is not in the export", () => {
    const exported = serializeDataset(appStore.getState().dataset);
    expect(exported).not.toContain("His jobs");
    expect(exported).not.toContain("acct-dad");
  });

  test("dropping the mirror leaves the user's own data untouched", () => {
    appStore.setState({ sharing: { ...appStore.getState().sharing, mirrors: [] } });
    expect(mergedDataset(appStore.getState()).rows.map((row) => row.label)).toEqual(["Job"]);
  });
});
