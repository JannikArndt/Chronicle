// Delete cascades (ENGINEERING_PROMPT.md §9): deletes flow down the
// row/entry parent tree and are always confirmed with a summary first.
// Categories are a shared flat resource — deleting one is blocked while
// any row references it, never cascaded.

import type { TimelineDataset, TimelineRow } from "./types";

export interface Cascade {
  rowIds: string[];
  entryIds: string[];
  personIds: string[];
}

function descendantRowIds(dataset: TimelineDataset, rootRowIds: string[]): string[] {
  const collected = new Set(rootRowIds);
  let frontier = rootRowIds;
  while (frontier.length > 0) {
    frontier = dataset.rows
      .filter((row) => row.parentRowId !== undefined && frontier.includes(row.parentRowId) && !collected.has(row.id))
      .map((row) => row.id);
    frontier.forEach((id) => collected.add(id));
  }
  return [...collected];
}

function descendantEntryIds(dataset: TimelineDataset, rootEntryIds: string[]): string[] {
  const collected = new Set(rootEntryIds);
  let frontier = rootEntryIds;
  while (frontier.length > 0) {
    frontier = dataset.entries
      .filter(
        (entry) =>
          entry.parentEntryId !== undefined && frontier.includes(entry.parentEntryId) && !collected.has(entry.id),
      )
      .map((entry) => entry.id);
    frontier.forEach((id) => collected.add(id));
  }
  return [...collected];
}

export function collectRowCascade(dataset: TimelineDataset, rowId: string): Cascade {
  const rowIds = descendantRowIds(dataset, [rowId]);
  const directEntryIds = dataset.entries.filter((e) => rowIds.includes(e.rowId)).map((e) => e.id);
  return { rowIds, entryIds: descendantEntryIds(dataset, directEntryIds), personIds: [] };
}

export function collectEntryCascade(dataset: TimelineDataset, entryId: string): Cascade {
  return { rowIds: [], entryIds: descendantEntryIds(dataset, [entryId]), personIds: [] };
}

export function collectGroupCascade(dataset: TimelineDataset, groupId: string): Cascade {
  const group = dataset.groups.find((g) => g.id === groupId);
  const directRowIds = dataset.rows.filter((row) => row.groupId === groupId).map((row) => row.id);
  const rowIds = descendantRowIds(dataset, directRowIds);
  const directEntryIds = dataset.entries.filter((e) => rowIds.includes(e.rowId)).map((e) => e.id);
  const entryIds = descendantEntryIds(dataset, directEntryIds);

  // Persons are deleted only if nothing OUTSIDE this cascade still references
  // them — a person can appear in several plain groups (§2).
  const candidatePersonIds = new Set<string>();
  if (group?.personId) candidatePersonIds.add(group.personId);
  for (const row of dataset.rows) {
    if (rowIds.includes(row.id) && row.personId) candidatePersonIds.add(row.personId);
  }
  const personIds = [...candidatePersonIds].filter((personId) => {
    const referencedByOtherGroup = dataset.groups.some((g) => g.id !== groupId && g.personId === personId);
    const referencedByOtherRow = dataset.rows.some((r) => !rowIds.includes(r.id) && r.personId === personId);
    return !referencedByOtherGroup && !referencedByOtherRow;
  });

  return { rowIds, entryIds, personIds };
}

export function describeCascade(cascade: Cascade): string {
  const parts: string[] = [];
  const count = (n: number, singular: string, plural: string) => `${n} ${n === 1 ? singular : plural}`;
  parts.push(count(cascade.entryIds.length, "entry", "entries"));
  // The first row id is the row being deleted itself, not a sub-row.
  const subRowCount = Math.max(0, cascade.rowIds.length - (cascade.rowIds.length > 0 ? 1 : 0));
  if (subRowCount > 0) parts.push(count(subRowCount, "sub-row", "sub-rows"));
  if (cascade.personIds.length > 0) parts.push(count(cascade.personIds.length, "person", "persons"));
  if (parts.length === 1) return `This deletes ${parts[0]}.`;
  return `This deletes ${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}.`;
}

export function categoryDeleteBlockers(dataset: TimelineDataset, categoryId: string): TimelineRow[] {
  return dataset.rows.filter((row) => row.categoryId === categoryId);
}

export function applyDelete(dataset: TimelineDataset, cascade: Cascade, groupId?: string): TimelineDataset {
  return {
    ...dataset,
    groups: dataset.groups.filter((g) => g.id !== groupId),
    rows: dataset.rows.filter((r) => !cascade.rowIds.includes(r.id)),
    entries: dataset.entries.filter((e) => !cascade.entryIds.includes(e.id)),
    people: dataset.people.filter((p) => !cascade.personIds.includes(p.id)),
  };
}
