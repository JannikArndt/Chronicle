import "fake-indexeddb/auto";
import { describe, expect, test } from "vitest";
import { loadDataset, saveDataset } from "./db";
import { parseImportFile, serializeDataset, validateImport } from "./exportImport";
import { emptyDataset } from "../model/dataset";
import { SCHEMA_VERSION } from "../model/types";
import type { TimelineDataset } from "../model/types";

describe("IndexedDB round-trip", () => {
  test("save then load returns the same dataset", async () => {
    const dataset = emptyDataset();
    dataset.groups.push({ id: "g1", label: "Me", collapsed: false });
    await saveDataset(dataset);
    const loaded = await loadDataset();
    expect(loaded).toEqual(dataset);
  });
});

describe("import validation", () => {
  test("accepts a serialized export", () => {
    const result = parseImportFile(serializeDataset(emptyDataset()));
    expect(result.ok).toBe(true);
  });

  test("rejects wrong schemaVersion with an explicit message", () => {
    const result = validateImport({ ...emptyDataset(), schemaVersion: 99 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("schemaVersion 99");
  });

  test("accepts a v1 export and upgrades it to the current schemaVersion", () => {
    const dataset = { ...emptyDataset(), schemaVersion: 1 };
    const result = validateImport(dataset);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.dataset.schemaVersion).toBe(SCHEMA_VERSION);
  });

  test("folds a pre-v5 category color and icon onto each row and drops the categories array", () => {
    const legacy = {
      schemaVersion: 4,
      people: [],
      groups: [{ id: "g1", label: "Me", collapsed: false }],
      categories: [{ id: "cat-1", label: "Job", color: "#abcdef", icon: "💼" }],
      rows: [{ id: "r1", groupId: "g1", categoryId: "cat-1", label: "Job" }],
      entries: [],
    };
    const result = validateImport(legacy);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.dataset.rows[0].color).toBe("#abcdef");
      expect(result.dataset.rows[0].icon).toBe("💼");
      expect("categoryId" in result.dataset.rows[0]).toBe(false);
      expect("categories" in result.dataset).toBe(false);
    }
  });

  // A v5 dataset covering both shapes Person could take: a group that IS a
  // person ("Me"), and a person nested inside a container group ("Family" →
  // "Finn"). Everything here is data a real user would lose if the fold went
  // wrong, so each half is asserted.
  function v5WithPeople() {
    return {
      schemaVersion: 5,
      selfPersonId: "p-me",
      people: [
        { id: "p-me", label: "Me", birthDate: Date.UTC(1988, 2, 4) },
        { id: "p-finn", label: "Finn", birthDate: Date.UTC(2015, 6, 9) },
        { id: "p-unused", label: "Nobody" },
      ],
      groups: [
        { id: "g-me", label: "Me", personId: "p-me", collapsed: false },
        { id: "g-family", label: "Family", collapsed: false },
      ],
      rows: [
        { id: "r-job", groupId: "g-me", label: "Job" },
        { id: "r-shared", groupId: "g-family", label: "Holidays" },
        { id: "r-school", groupId: "g-family", personId: "p-finn", label: "School" },
      ],
      entries: [],
    };
  }

  test("folds a v5 person-group into a group carrying the birth date", () => {
    const result = validateImport(v5WithPeople());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const me = result.dataset.groups.find((group) => group.id === "g-me")!;
    expect(me.birthDate).toBe(Date.UTC(1988, 2, 4));
    expect(result.dataset.selfGroupId).toBe("g-me");
    expect("people" in result.dataset).toBe(false);
    expect("selfPersonId" in result.dataset).toBe(false);
  });

  test("folds a v5 nested person into a sub-group and re-files its rows", () => {
    const result = validateImport(v5WithPeople());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const finn = result.dataset.groups.find((group) => group.id === "p-finn")!;
    expect(finn.label).toBe("Finn");
    expect(finn.parentGroupId).toBe("g-family");
    expect(finn.birthDate).toBe(Date.UTC(2015, 6, 9));
    // The row that named Finn now lives in Finn; the group's own row stays put.
    expect(result.dataset.rows.find((row) => row.id === "r-school")!.groupId).toBe("p-finn");
    expect(result.dataset.rows.find((row) => row.id === "r-shared")!.groupId).toBe("g-family");
    expect(result.dataset.rows.every((row) => !("personId" in row))).toBe(true);
    // A person nothing referenced had no timelines, so it leaves no group.
    expect(result.dataset.groups.some((group) => group.label === "Nobody")).toBe(false);
  });

  test("a stored v5 dataset survives a reload instead of being discarded", async () => {
    await saveDataset(v5WithPeople() as unknown as TimelineDataset);
    const loaded = await loadDataset();
    expect(loaded?.schemaVersion).toBe(SCHEMA_VERSION);
    expect(loaded?.rows).toHaveLength(3);
  });

  // The v7 hazard: v1–v3 wrote a `visibility` field that v4 removed, and v7
  // adds a publish flag doing the same kind of job. An old file that still
  // carries the dead field must not be able to publish anything.
  function v3WithVisibility() {
    return {
      schemaVersion: 3,
      defaultVisibility: "public",
      groups: [{ id: "g1", label: "Me", collapsed: false, visibility: "public" }],
      rows: [{ id: "r1", groupId: "g1", label: "Therapy", visibility: "public" }],
      entries: [{ id: "e1", rowId: "r1", title: "Session", start: { ms: 0, precision: "day" }, visibility: "public" }],
    };
  }

  test("a pre-v4 `visibility: public` does not become shared — it migrates to private", () => {
    const result = validateImport(v3WithVisibility());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.dataset.rows[0].shared).toBeUndefined();
    expect(result.dataset.groups[0].shared).toBeUndefined();
    expect(result.dataset.groups[0].shareByDefault).toBeUndefined();
  });

  test("the dead visibility fields are deleted, so no later code can read them", () => {
    const result = validateImport(v3WithVisibility());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect("defaultVisibility" in result.dataset).toBe(false);
    expect("visibility" in result.dataset.groups[0]).toBe(false);
    expect("visibility" in result.dataset.rows[0]).toBe(false);
    expect("visibility" in result.dataset.entries[0]).toBe(false);
  });

  test("a v7 export keeps the sharing flags it was written with", () => {
    const dataset = emptyDataset();
    dataset.groups.push({ id: "g1", label: "Me", collapsed: false, shareByDefault: true });
    dataset.rows.push({ id: "r1", groupId: "g1", label: "Job", shared: true });
    const result = parseImportFile(serializeDataset(dataset));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.dataset.rows[0].shared).toBe(true);
    expect(result.dataset.groups[0].shareByDefault).toBe(true);
  });

  test("rejects structurally broken files", () => {
    expect(validateImport({ schemaVersion: 1 }).ok).toBe(false);
    expect(validateImport(null).ok).toBe(false);
    expect(validateImport([1, 2]).ok).toBe(false);
    expect(parseImportFile("{not json").ok).toBe(false);
  });

  test("rejects malformed entries", () => {
    const ds = emptyDataset() as unknown as { entries: unknown[] };
    ds.entries.push({ id: 42 });
    expect(validateImport(ds).ok).toBe(false);
  });
});
