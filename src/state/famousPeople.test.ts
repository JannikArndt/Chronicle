// End-to-end wiring for the famous-people spike: drives the real store actions
// (not just the pure transform) and asserts what actually gets merged into the
// view via `publicDatasets`.

import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { appStore } from "./store";
import {
  addFamousPerson,
  initializeApp,
  removeFamousPerson,
  removeFamousRow,
  removePublicGroup,
  setFamousAlignment,
  toggleFamousPerson,
  toggleWorldEvents,
} from "./actions";
import { einstein, mozart } from "../publicData/famous/lives";
import { emptyDataset } from "../model/dataset";
import { saveOverlays } from "../storage/db";

const userBirthMs = Date.UTC(1990, 5, 15);

function seedUserWithBirthDate(): void {
  const dataset = emptyDataset();
  dataset.people = [{ id: "me", label: "Me", birthDate: userBirthMs }];
  dataset.selfPersonId = "me";
  appStore.setState({
    dataset,
    publicDatasets: [],
    activeWorldKeys: [],
    activeFamous: [],
  });
}

beforeEach(seedUserWithBirthDate);

describe("famous-people store wiring", () => {
  it("shows nothing until something is picked", () => {
    expect(appStore.getState().publicDatasets).toEqual([]);
  });

  it("adds a person's real life on toggle, and removes it on a second toggle", () => {
    toggleFamousPerson(mozart);
    const mergedIn = appStore.getState().publicDatasets;
    expect(mergedIn).toHaveLength(1);
    const salzburg = mergedIn[0].entries.find((entry) => entry.title === "Salzburg")!;
    expect(salzburg.start.ms).toBe(Date.UTC(1756, 0, 1)); // real calendar date, unaligned

    toggleFamousPerson(mozart);
    expect(appStore.getState().publicDatasets).toEqual([]);
  });

  it("re-shifts the life to the user's age when alignment is turned on", () => {
    toggleFamousPerson(mozart);
    setFamousAlignment("mozart", true);

    const dataset = appStore.getState().publicDatasets[0];
    const salzburg = dataset.entries.find((entry) => entry.title === "Salzburg")!;
    const offset = userBirthMs - mozart.birthMs;
    expect(salzburg.start.ms).toBe(Date.UTC(1756, 0, 1) + offset); // shifted onto the user's age
    expect(dataset.groups[0].label).toContain("at your age");
  });

  it("keeps world events and famous people as independent selections", () => {
    toggleFamousPerson(einstein);
    toggleWorldEvents("us-presidents");
    expect(appStore.getState().publicDatasets).toHaveLength(2);

    toggleFamousPerson(einstein);
    const remaining = appStore.getState().publicDatasets;
    expect(remaining).toHaveLength(1);
    expect(remaining[0].groups[0].id).toContain("us-presidents");
  });
});

describe("removing famous overlays", () => {
  beforeEach(seedUserWithBirthDate);

  it("removes a single timeline while keeping the person's other rows", () => {
    addFamousPerson(mozart);
    const worksRow = mozart.biography.rows.find((r) => r.label === "Works")!;
    removeFamousRow("mozart", worksRow.id);

    const dataset = appStore.getState().publicDatasets[0];
    expect(dataset.rows.map((r) => r.label)).not.toContain("Works");
    expect(dataset.rows.map((r) => r.label)).toContain("Places lived");
    expect(dataset.entries.every((e) => !e.rowId.endsWith(`:${worksRow.id}`))).toBe(true);
  });

  it("removes the whole person when the last remaining row is removed", () => {
    addFamousPerson(mozart);
    for (const row of mozart.biography.rows) removeFamousRow("mozart", row.id);
    expect(appStore.getState().activeFamous).toHaveLength(0);
    expect(appStore.getState().publicDatasets).toHaveLength(0);
  });

  it("removing a parent row as the last area removes the person, not an empty group", () => {
    const withLanes = {
      id: "x",
      name: "X",
      emoji: "⭐",
      birthMs: Date.UTC(1970, 0, 1),
      blurb: "t",
      biography: {
        groups: [{ id: "g", label: "X", collapsed: false }],
        categories: [{ id: "c", label: "C", color: "#000", icon: "💼" }],
        rows: [
          { id: "r-flat", groupId: "g", categoryId: "c", label: "Places" },
          { id: "r-parent", groupId: "g", categoryId: "c", label: "Career" },
          { id: "r-parent-0", groupId: "g", categoryId: "c", label: "Job", parentRowId: "r-parent" },
        ],
        entries: [
          { id: "e0", rowId: "r-flat", title: "Home", start: { ms: 0, precision: "year" as const }, end: { ms: 1, precision: "year" as const } },
          { id: "e1", rowId: "r-parent-0", title: "Job", start: { ms: 0, precision: "year" as const }, end: { ms: 1, precision: "year" as const } },
        ],
      },
    };
    addFamousPerson(withLanes);
    removeFamousRow("x", "r-flat"); // remove the flat area
    expect(appStore.getState().publicDatasets).toHaveLength(1);
    removeFamousRow("x", "r-parent"); // removing the parent cascades to its child → nothing left
    expect(appStore.getState().activeFamous).toHaveLength(0);
    expect(appStore.getState().publicDatasets).toHaveLength(0);
  });

  it("removePublicGroup removes a famous person by its group id", () => {
    addFamousPerson(einstein);
    const groupId = appStore.getState().publicDatasets[0].groups[0].id;
    removePublicGroup(groupId);
    expect(appStore.getState().publicDatasets).toHaveLength(0);
  });

  it("removePublicGroup removes a world-events dataset by its group id", () => {
    toggleWorldEvents("us-presidents");
    const groupId = appStore.getState().publicDatasets[0].groups[0].id;
    removePublicGroup(groupId);
    expect(appStore.getState().activeWorldKeys).toEqual([]);
    expect(appStore.getState().publicDatasets).toHaveLength(0);
  });
});

describe("overlay persistence across reload", () => {
  it("restores world + famous selections from IndexedDB on init", async () => {
    seedUserWithBirthDate();
    toggleWorldEvents("us-presidents");
    addFamousPerson(einstein);
    removeFamousPerson("einstein"); // no-op churn to exercise persistence path
    addFamousPerson(mozart);

    // Persist synchronously (bypass the debounce), then re-initialise as a fresh load.
    await saveOverlays({
      activeWorldKeys: appStore.getState().activeWorldKeys,
      activeFamous: appStore.getState().activeFamous,
    });
    appStore.setState({ activeWorldKeys: [], activeFamous: [], publicDatasets: [] });

    await initializeApp();
    const state = appStore.getState();
    expect(state.activeWorldKeys).toEqual(["us-presidents"]);
    expect(state.activeFamous.map((s) => s.person.id)).toEqual(["mozart"]);
    expect(state.publicDatasets).toHaveLength(2); // both merged back into the view
  });
});
