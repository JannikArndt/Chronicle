import "fake-indexeddb/auto";
import { beforeEach, describe, expect, test } from "vitest";
import { completeIdentityStep, replaceDataset, selectRow, startDraft, updateDraft } from "./actions";
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
