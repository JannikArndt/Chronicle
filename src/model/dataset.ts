import { SCHEMA_VERSION } from "./types";
import type { Group, TimelineDataset, TimelineEntry, TimelineEvent, TimelineRow } from "./types";

export function emptyDataset(): TimelineDataset {
  return {
    schemaVersion: SCHEMA_VERSION,
    groups: [],
    rows: [],
    entries: [],
    events: [],
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
    // `?? []` because a public-data file authored before v8 simply has no
    // events array — the JSON is typed as a dataset but is not validated by
    // the compiler, so the absence is real at runtime.
    merged.events.push(...(dataset.events ?? []));
  }
  return merged;
}

export function rowsOfGroup(dataset: TimelineDataset, groupId: string): TimelineRow[] {
  return dataset.rows.filter((row) => row.groupId === groupId);
}

export function entriesOfRow(dataset: TimelineDataset, rowId: string): TimelineEntry[] {
  return dataset.entries.filter((entry) => entry.rowId === rowId);
}

export function eventsOfRow(dataset: TimelineDataset, rowId: string): TimelineEvent[] {
  return dataset.events.filter((event) => event.rowId === rowId);
}

export function childEntries(dataset: TimelineDataset, entryId: string): TimelineEntry[] {
  return dataset.entries.filter((entry) => entry.parentEntryId === entryId);
}

export function groupOfRow(dataset: TimelineDataset, row: TimelineRow): Group | undefined {
  return row.groupId === undefined ? undefined : dataset.groups.find((g) => g.id === row.groupId);
}

// Every ancestor group of a group, nearest first. Cycle-guarded — the model
// stopped forbidding deep trees, but a malformed/imported file could still
// loop parentGroupId back on itself.
export function ancestorGroups(dataset: TimelineDataset, groupId: string): Group[] {
  const groupById = new Map(dataset.groups.map((g) => [g.id, g]));
  const chain: Group[] = [];
  const seen = new Set<string>();
  let current = groupById.get(groupId)?.parentGroupId;
  while (current !== undefined && !seen.has(current)) {
    seen.add(current);
    const group = groupById.get(current);
    if (!group) break;
    chain.push(group);
    current = group.parentGroupId;
  }
  return chain;
}

// Whose life this timeline belongs to, as a birth date. A row can be a person
// in its own right (its own `birthDate`); otherwise the nearest ancestor group
// that has one wins — not just its immediate group, so "Finn's kids" still
// fades before Finn's own birth if nothing closer says otherwise.
export function birthDateForRow(dataset: TimelineDataset, row: TimelineRow): number | undefined {
  if (row.birthDate !== undefined) return row.birthDate;
  const group = groupOfRow(dataset, row);
  if (group === undefined) return undefined;
  if (group.birthDate !== undefined) return group.birthDate;
  return ancestorGroups(dataset, group.id).find((g) => g.birthDate !== undefined)?.birthDate;
}
