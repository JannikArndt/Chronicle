import "fake-indexeddb/auto";
import { beforeEach, describe, expect, test } from "vitest";
import {
  addOnboardingPlaceEntry,
  completeIdentityStep,
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
  ds.categories = [{ id: "cat-1", label: "Job", color: "#333", icon: "💼", defaultVisibility: "private" }];
  ds.groups = [{ id: "g1", label: "Me", collapsed: false }];
  ds.rows = [{ id: "r1", groupId: "g1", categoryId: "cat-1", label: "Job" }];
  ds.entries = [
    {
      id: "e1",
      rowId: "r1",
      title: "First job",
      start: { ms: T0, precision: "day" },
      linkedEntityIds: [],
      visibility: "private",
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
    expect(munich.linkedEntityIds).toHaveLength(1);
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
  test("updates an existing entry's title, dates, and linked entity in place", () => {
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

    const entity = state.dataset.entities.find((e) => e.id === entry.linkedEntityIds[0]);
    expect(entity?.label).toBe("Munich");
    expect(entity?.place?.city).toBe("Munich");
  });

  test("does nothing if the entry id no longer exists", () => {
    replaceDataset(emptyDataset());
    completeIdentityStep("Jannik");
    const before = appStore.getState().dataset.entries.length;

    updateOnboardingPlaceEntry("no-such-entry", { label: "Ghost", startMs: Date.UTC(2000, 0, 1) });

    expect(appStore.getState().dataset.entries).toHaveLength(before);
  });
});
