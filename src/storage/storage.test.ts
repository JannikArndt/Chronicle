import "fake-indexeddb/auto";
import { describe, expect, test } from "vitest";
import { loadDataset, saveDataset } from "./db";
import { parseImportFile, serializeDataset, validateImport } from "./exportImport";
import { emptyDataset } from "../model/dataset";

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
