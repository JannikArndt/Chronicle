import { SCHEMA_VERSION } from "./types";
import type { Group, TimelineDataset, TimelineEntry, TimelineRow } from "./types";

export function emptyDataset(): TimelineDataset {
  return {
    schemaVersion: SCHEMA_VERSION,
    groups: [],
    rows: [],
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
    merged.groups.push(...dataset.groups);
    merged.rows.push(...dataset.rows);
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

export function groupOfRow(dataset: TimelineDataset, row: TimelineRow): Group | undefined {
  return dataset.groups.find((g) => g.id === row.groupId);
}

// Whose life this timeline belongs to, as a birth date — its own group's, or
// the group it is nested in ("Finn" inside "Family" carries the date; a row
// filed directly under a container group inherits nothing).
export function birthDateForRow(dataset: TimelineDataset, row: TimelineRow): number | undefined {
  const group = groupOfRow(dataset, row);
  if (group === undefined) return undefined;
  if (group.birthDate !== undefined) return group.birthDate;
  const parent = group.parentGroupId;
  return parent === undefined ? undefined : dataset.groups.find((g) => g.id === parent)?.birthDate;
}

export function subGroupsOf(dataset: TimelineDataset, groupId: string): Group[] {
  return dataset.groups.filter((group) => group.parentGroupId === groupId);
}
