import { describe, expect, test } from "vitest";
import {
  grandkidYearRange,
  kidYearRange,
  loadFamily,
  newGrandkidYear,
  newKidYear,
  planFamily,
  removeKid,
} from "./familyRecords";
import type { FamilyDraft } from "./familyRecords";
import { emptyDataset } from "../model/dataset";
import type { TimelineDataset } from "../model/types";

function withFamily(): TimelineDataset {
  const dataset = emptyDataset();
  dataset.groups = [
    { id: "me", label: "Sam", collapsed: false, birthDate: Date.UTC(1966, 0, 1), order: 0 },
    { id: "fam", label: "Family", collapsed: false, order: 1 },
    { id: "mia", parentGroupId: "fam", label: "Mia", collapsed: false, birthDate: Date.UTC(1992, 4, 14), order: 0 },
    { id: "jo", parentGroupId: "fam", label: "Jonas", collapsed: false, birthDate: Date.UTC(1995, 0, 1), order: 1 },
    { id: "pets", parentGroupId: "fam", label: "Pets", collapsed: false, order: 2 },
    { id: "ella", parentGroupId: "mia", label: "Ella", collapsed: false, birthDate: Date.UTC(2021, 0, 1), order: 0 },
  ];
  return dataset;
}

describe("loadFamily", () => {
  test("kids are the people in the top-level Family group, grandkids the people inside them", () => {
    const draft = loadFamily(withFamily());
    expect(draft.kids.map((k) => [k.name, k.year, k.groupId])).toEqual([
      ["Mia", 1992, "mia"],
      ["Jonas", 1995, "jo"],
    ]);
    expect(draft.grandkids.map((g) => [g.name, g.year, g.groupId])).toEqual([["Ella", 2021, "ella"]]);
    expect(draft.grandkids[0].parentKey).toBe(draft.kids[0].key);
  });

  test("no Family group, no kids", () => {
    expect(loadFamily(emptyDataset())).toEqual({ kids: [], grandkids: [] });
  });
});

describe("planFamily", () => {
  test("a first child creates the Family group, then the child", () => {
    const draft: FamilyDraft = { kids: [{ key: "k1", name: "", year: 2014 }], grandkids: [] };
    expect(planFamily(draft, emptyDataset())).toEqual([
      { kind: "createFamily" },
      { kind: "createKid", key: "k1", label: "Child 1", birthDate: Date.UTC(2014, 0, 1) },
    ]);
  });

  test("a grandchild of a new child is created inside it", () => {
    const draft: FamilyDraft = {
      kids: [{ key: "k1", name: "Mia", year: 1992 }],
      grandkids: [{ key: "g1", parentKey: "k1", name: "", year: 2021 }],
    };
    expect(planFamily(draft, emptyDataset())).toContainEqual({
      kind: "createGrandkid",
      parent: { kidKey: "k1" },
      label: "Grandchild",
      birthDate: Date.UTC(2021, 0, 1),
    });
  });

  test("loading and planning without changes writes nothing — the stored day of a birthday survives", () => {
    const dataset = withFamily();
    expect(planFamily(loadFamily(dataset), dataset)).toEqual([]);
  });

  test("a changed name or year updates the same group", () => {
    const dataset = withFamily();
    const draft = loadFamily(dataset);
    draft.kids[1] = { ...draft.kids[1], name: "Jonah", year: 1996 };
    expect(planFamily(draft, dataset)).toEqual([
      { kind: "update", groupId: "jo", patch: { label: "Jonah", birthDate: Date.UTC(1996, 0, 1) } },
    ]);
  });

  test("a grandchild given to another child moves into that child's group", () => {
    const dataset = withFamily();
    const draft = loadFamily(dataset);
    draft.grandkids[0] = { ...draft.grandkids[0], parentKey: draft.kids[1].key };
    expect(planFamily(draft, dataset)).toEqual([{ kind: "move", groupId: "ella", parent: { groupId: "jo" } }]);
  });

  test("removals come last, after a grandchild has moved out of a removed child", () => {
    const dataset = withFamily();
    let draft = loadFamily(dataset);
    draft.grandkids[0] = { ...draft.grandkids[0], parentKey: draft.kids[1].key };
    draft = removeKid(draft, draft.kids[0].key);
    expect(planFamily(draft, dataset)).toEqual([
      { kind: "move", groupId: "ella", parent: { groupId: "jo" } },
      { kind: "delete", groupId: "mia" },
    ]);
  });

  test("removing a child removes its grandchildren from the draft", () => {
    const draft = loadFamily(withFamily());
    expect(removeKid(draft, draft.kids[0].key).grandkids).toEqual([]);
  });

  test("with every child removed, the Family group goes if nothing else is in it", () => {
    const dataset = withFamily();
    const ops = planFamily({ kids: [], grandkids: [] }, dataset);
    expect(ops).toContainEqual({ kind: "delete", groupId: "mia" });
    expect(ops).toContainEqual({ kind: "delete", groupId: "jo" });
    expect(ops[ops.length - 1]).toEqual({ kind: "deleteFamilyIfEmpty" });
  });
});

describe("ranges and defaults", () => {
  test("a child's year runs from your 14th year to now", () => {
    expect(kidYearRange(1986, 2026)).toEqual([2000, 2026]);
    expect(kidYearRange(2020, 2026)).toEqual([2026, 2026]);
  });

  test("the first child defaults by age, each further one three years later", () => {
    const first = newKidYear({ kids: [], grandkids: [] }, 1986, 2026);
    expect(first).toBe(1986 + 16 + 12);
    expect(newKidYear({ kids: [{ key: "a", name: "", year: first }], grandkids: [] }, 1986, 2026)).toBe(first + 3);
  });

  test("a grandchild is at least 15 years younger than its parent, and not in the future", () => {
    expect(grandkidYearRange(1992, 2026)).toEqual([2007, 2026]);
    expect(newGrandkidYear(1992, 2026)).toBe(2022);
    expect(newGrandkidYear(2015, 2026)).toBe(2026);
  });
});
