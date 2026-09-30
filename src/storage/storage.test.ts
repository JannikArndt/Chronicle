import "fake-indexeddb/auto";
import { describe, expect, test } from "vitest";
import { loadDataset, saveDataset } from "./db";
import { parseImportFile, serializeDataset, validateImport } from "./exportImport";
import { emptyDataset } from "../model/dataset";
import { SCHEMA_VERSION } from "../model/types";

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

  test("rejects an older schemaVersion rather than upgrading it", () => {
    const result = validateImport({ ...emptyDataset(), schemaVersion: SCHEMA_VERSION - 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(`schemaVersion ${SCHEMA_VERSION - 1}`);
  });

  test("keeps the sharing flags it was written with", () => {
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
    expect(validateImport({ schemaVersion: SCHEMA_VERSION }).ok).toBe(false);
    expect(validateImport(null).ok).toBe(false);
    expect(validateImport([1, 2]).ok).toBe(false);
    expect(parseImportFile("{not json").ok).toBe(false);
  });

  test("rejects a file with no events array", () => {
    const result = validateImport({ schemaVersion: SCHEMA_VERSION, groups: [], rows: [], entries: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("events");
  });

  test("rejects malformed entries", () => {
    const ds = emptyDataset() as unknown as { entries: unknown[] };
    ds.entries.push({ id: 42 });
    expect(validateImport(ds).ok).toBe(false);
  });

  test("events survive an export/import round trip", () => {
    const dataset = emptyDataset();
    dataset.groups.push({ id: "g1", label: "Me", collapsed: false });
    dataset.rows.push({ id: "r1", groupId: "g1", label: "Love" });
    dataset.events.push({
      id: "v1",
      rowId: "r1",
      title: "First kiss",
      icon: "💋",
      date: { ms: Date.UTC(2004, 6, 2), precision: "day" },
    });
    const result = parseImportFile(serializeDataset(dataset));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.dataset.events).toEqual(dataset.events);
  });

  test("rejects malformed events rather than importing half of one", () => {
    const ds = emptyDataset() as unknown as { events: unknown[] };
    ds.events.push({ id: "v1", rowId: "r1" }); // no date
    expect(validateImport(ds).ok).toBe(false);
    expect(validateImport({ ...emptyDataset(), events: "nope" }).ok).toBe(false);
  });
});
