import "fake-indexeddb/auto";
import { beforeEach, describe, expect, test } from "vitest";
import { addOnboardingPlaceEntry, completeIdentityStep, replaceDataset, selectRow, startDraft, updateDraft } from "./actions";
import { appStore } from "./store";
import { emptyDataset } from "../model/dataset";
import { DAY_MS } from "../model/fuzzyDate";
import type { TimelineDataset } from "../model/types";

const T0 = Date.UTC(2020, 0, 1);

function fixture(): TimelineDataset {
  const ds = emptyDataset();
  ds.categories = [
    { id: "cat-1", label: "Job", color: "#333", icon: "💼", concurrency: "exclusive", defaultVisibility: "private" },
  ];
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

  test("titling the draft commits it and auto-closes the previous ongoing entry", () => {
    startDraft("r1", T0 + 100 * DAY_MS);
    updateDraft({ title: "Second job" });
    const { dataset, draft, selectedEntryId } = appStore.getState();
    expect(draft).toBeUndefined();
    expect(dataset.entries).toHaveLength(2);
    const first = dataset.entries.find((e) => e.id === "e1")!;
    expect(first.end?.ms).toBe(T0 + 100 * DAY_MS);
    expect(selectedEntryId).toBe(dataset.entries[1].id);
  });

  test("a conflicting draft is blocked with a message and not inserted", () => {
    startDraft("r1", T0 - 200 * DAY_MS);
    updateDraft({ title: "Backfilled", end: { ms: T0 + 5 * DAY_MS, precision: "day" } });
    const state = appStore.getState();
    expect(state.dataset.entries).toHaveLength(1);
    expect(state.conflictMessage).toContain("First job");
    expect(state.draft?.title).toBe("Backfilled");
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
  test("creates a self person, group, and an exclusive Places lived row", () => {
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

    const category = state.dataset.categories.find((c) => c.id === row?.categoryId);
    expect(category?.concurrency).toBe("exclusive");
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

  test("addOnboardingPlaceEntry backfills an ongoing previous entry's end via the autoClose plan", () => {
    replaceDataset(emptyDataset());
    const { placesRowId } = completeIdentityStep("Jannik");
    const year1990 = Date.UTC(1990, 6, 1);
    const year2010 = Date.UTC(2010, 6, 1);

    // Berlin is added without endMs, so it's ongoing and planEntryInsert
    // must return "autoClose" (not "ok") when Hamburg starts later.
    addOnboardingPlaceEntry(placesRowId, { label: "Berlin", startMs: year1990 });
    addOnboardingPlaceEntry(placesRowId, { label: "Hamburg", startMs: year2010 });

    const entries = appStore.getState().dataset.entries.filter((e) => e.rowId === placesRowId);
    const berlin = entries.find((e) => e.title === "Berlin")!;
    const hamburg = entries.find((e) => e.title === "Hamburg")!;

    expect(berlin.end?.ms).toBe(year2010);
    expect(hamburg.end).toBeUndefined();
  });

  test("addOnboardingPlaceEntry does not insert an entry when planEntryInsert reports a conflict", () => {
    replaceDataset(emptyDataset());
    const { placesRowId } = completeIdentityStep("Jannik");
    const year1985 = Date.UTC(1985, 6, 1);
    const year1990 = Date.UTC(1990, 6, 1);
    const year2000 = Date.UTC(2000, 6, 1);
    const year2005 = Date.UTC(2005, 6, 1);

    addOnboardingPlaceEntry(placesRowId, { label: "Berlin", startMs: year1990, endMs: year2005 });

    // Overlaps Berlin's span but starts before Berlin's own start, so
    // planEntryInsert's isPlainAppend check (draft.start > last.start) fails
    // and this is a true conflict, not a chronological append that could be
    // auto-closed. addOnboardingPlaceEntry must bail out (mirroring
    // commitDraft) and leave the dataset with only Berlin.
    addOnboardingPlaceEntry(placesRowId, { label: "Overlap", startMs: year1985, endMs: year2000 });

    const entries = appStore.getState().dataset.entries.filter((e) => e.rowId === placesRowId);
    expect(entries).toHaveLength(1);
    expect(entries[0].title).toBe("Berlin");
  });
});
