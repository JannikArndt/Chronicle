import "fake-indexeddb/auto";
import { beforeEach, describe, expect, test } from "vitest";
import {
  addOnboardingPlaceEntry,
  completeIdentityStep,
  moveRow,
  reorderGroup,
  replaceDataset,
  selectRow,
  startDraft,
  updateDraft,
  updateOnboardingPlaceEntry,
} from "./actions";
import { appStore } from "./store";
import { emptyDataset } from "../model/dataset";
import { DAY_MS } from "../model/fuzzyDate";
import type { TimelineDataset } from "../model/types";

const T0 = Date.UTC(2020, 0, 1);

function fixture(): TimelineDataset {
  const ds = emptyDataset();
  ds.categories = [{ id: "cat-1", label: "Job", color: "#333", icon: "💼" }];
  ds.groups = [{ id: "g1", label: "Me", collapsed: false }];
  ds.rows = [{ id: "r1", groupId: "g1", categoryId: "cat-1", label: "Job" }];
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

describe("selection", () => {
  test("selecting a row clears entry selection and draft", () => {
    startDraft("r1", T0);
    selectRow("r1");
    const state = appStore.getState();
    expect(state.draft).toBeUndefined();
    expect(state.selectedRowId).toBe("r1");
  });
});

// Three groups, three rows: r1 and r2 in g1, r3 (belonging to person p1) in
// g2, g3 empty. Array order is display order — that's what these actions move.
function dragFixture(): TimelineDataset {
  const ds = emptyDataset();
  ds.categories = [{ id: "cat-1", label: "Job", color: "#333", icon: "💼" }];
  ds.people = [{ id: "p1", label: "Alex" }];
  ds.groups = [
    { id: "g1", label: "Me", collapsed: false },
    { id: "g2", label: "Family", collapsed: false },
    { id: "g3", label: "Empty", collapsed: false },
  ];
  ds.rows = [
    { id: "r1", groupId: "g1", categoryId: "cat-1", label: "Job" },
    { id: "r2", groupId: "g1", categoryId: "cat-1", label: "Home" },
    { id: "r3", groupId: "g2", personId: "p1", categoryId: "cat-1", label: "School" },
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

describe("rail drag-and-drop: reorderGroup", () => {
  beforeEach(() => {
    replaceDataset(dragFixture());
  });

  test("moves a group to the front", () => {
    reorderGroup("g3", "g1");
    expect(groupOrder()).toEqual(["g3", "g1", "g2"]);
  });

  test("moves a group to the middle", () => {
    reorderGroup("g1", "g3");
    expect(groupOrder()).toEqual(["g2", "g1", "g3"]);
  });

  test("moves a group to the end with a null sibling", () => {
    reorderGroup("g1", null);
    expect(groupOrder()).toEqual(["g2", "g3", "g1"]);
  });

  test("dropping a group onto itself is a no-op", () => {
    reorderGroup("g2", "g2");
    expect(groupOrder()).toEqual(["g1", "g2", "g3"]);
  });

  test("an unknown group id is a no-op", () => {
    reorderGroup("no-such-group", "g1");
    expect(groupOrder()).toEqual(["g1", "g2", "g3"]);
  });

  test("an unknown beforeGroupId is a no-op", () => {
    reorderGroup("g1", "no-such-group");
    expect(groupOrder()).toEqual(["g1", "g2", "g3"]);
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
    expect(rowById("r1")?.personId).toBeUndefined();
  });

  test("adopts the personId of the drop position", () => {
    moveRow("r1", "g2", "r3"); // before a person's row → joins that person's section
    expect(rowById("r1")?.personId).toBe("p1");
    moveRow("r2", "g2", null); // end of the group — last row belongs to p1
    expect(rowById("r2")?.personId).toBe("p1");
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

  test("a sub-row cannot be moved", () => {
    const ds = dragFixture();
    ds.rows.push({ id: "r1-sub", groupId: "g1", categoryId: "cat-1", label: "Sub", parentRowId: "r1" });
    replaceDataset(ds);
    moveRow("r1-sub", "g2", null);
    expect(rowById("r1-sub")?.groupId).toBe("g1");
  });
});

describe("onboarding: completeIdentityStep", () => {
  test("creates a self person, group, and a Places lived row", () => {
    replaceDataset(emptyDataset());
    const result = completeIdentityStep("Jannik");
    const state = appStore.getState();

    expect(state.dataset.selfPersonId).toBe(result.personId);

    const person = state.dataset.people.find((p) => p.id === result.personId);
    expect(person?.label).toBe("Jannik");

    const group = state.dataset.groups.find((g) => g.id === result.groupId);
    expect(group?.personId).toBe(result.personId);

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
