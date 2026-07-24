// End-to-end wiring for the famous-people spike: drives the real store actions
// (not just the pure transform) and asserts what actually gets merged into the
// view via `publicDatasets`.

import { beforeEach, describe, expect, it } from "vitest";
import { appStore } from "./store";
import { setFamousAlignment, toggleFamousPerson, toggleWorldEvents } from "./actions";
import { mozart } from "../publicData/famous/lives";
import { emptyDataset } from "../model/dataset";

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
    toggleFamousPerson("mozart");
    const mergedIn = appStore.getState().publicDatasets;
    expect(mergedIn).toHaveLength(1);
    const born = mergedIn[0].entries.find((entry) => entry.title.startsWith("Born"))!;
    expect(born.start.ms).toBe(mozart.birthMs); // real calendar date, unaligned

    toggleFamousPerson("mozart");
    expect(appStore.getState().publicDatasets).toEqual([]);
  });

  it("re-shifts the life to the user's age when alignment is turned on", () => {
    toggleFamousPerson("mozart");
    setFamousAlignment("mozart", true);

    const dataset = appStore.getState().publicDatasets[0];
    const born = dataset.entries.find((entry) => entry.title.startsWith("Born"))!;
    expect(born.start.ms).toBe(userBirthMs); // Mozart's birth now sits on the user's
    expect(dataset.groups[0].label).toContain("at your age");
  });

  it("keeps world events and famous people as independent selections", () => {
    toggleFamousPerson("einstein");
    toggleWorldEvents("us-presidents");
    expect(appStore.getState().publicDatasets).toHaveLength(2);

    toggleFamousPerson("einstein");
    const remaining = appStore.getState().publicDatasets;
    expect(remaining).toHaveLength(1);
    expect(remaining[0].groups[0].id).toContain("us-presidents");
  });
});
