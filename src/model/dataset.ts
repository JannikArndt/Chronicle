import { SCHEMA_VERSION } from "./types";
import type { Group, Person, TimelineDataset, TimelineEntry, TimelineRow } from "./types";

export function emptyDataset(): TimelineDataset {
  return {
    schemaVersion: SCHEMA_VERSION,
    people: [],
    groups: [],
    categories: [],
    rows: [],
    entities: [],
    entries: [],
  };
}

let idCounter = 0;

export function newId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

// Public datasets are appended after the private one; array order is what the
// layout uses, so public groups always render below the user's own groups.
export function mergeDatasets(base: TimelineDataset, ...extra: TimelineDataset[]): TimelineDataset {
  const merged = structuredClone(base);
  for (const dataset of extra) {
    merged.people.push(...dataset.people);
    merged.groups.push(...dataset.groups);
    merged.categories.push(...dataset.categories);
    merged.rows.push(...dataset.rows);
    merged.entities.push(...dataset.entities);
    merged.entries.push(...dataset.entries);
  }
  return merged;
}

export function rowsOfGroup(dataset: TimelineDataset, groupId: string): TimelineRow[] {
  return dataset.rows.filter((row) => row.groupId === groupId);
}

export function entriesOfRow(dataset: TimelineDataset, rowId: string): TimelineEntry[] {
  return dataset.entries.filter((entry) => entry.rowId === rowId);
}

export function childRows(dataset: TimelineDataset, rowId: string): TimelineRow[] {
  return dataset.rows.filter((row) => row.parentRowId === rowId);
}

export function childEntries(dataset: TimelineDataset, entryId: string): TimelineEntry[] {
  return dataset.entries.filter((entry) => entry.parentEntryId === entryId);
}

// A row's person comes from the row itself (person nested in a plain group)
// or from its group being that person (§2 asymmetry).
export function personForRow(dataset: TimelineDataset, row: TimelineRow): Person | undefined {
  const group = dataset.groups.find((g) => g.id === row.groupId);
  const personId = row.personId ?? group?.personId;
  return personId ? dataset.people.find((p) => p.id === personId) : undefined;
}

export function groupOfRow(dataset: TimelineDataset, row: TimelineRow): Group | undefined {
  return dataset.groups.find((g) => g.id === row.groupId);
}
