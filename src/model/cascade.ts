// Delete cascades (ENGINEERING_PROMPT.md §9): deletes flow down the
// row/entry parent tree and are always confirmed with a summary first.

import type { TimelineDataset } from "./types";

export interface Cascade {
  // Empty except when a group is being deleted, where it holds that group and
  // every sub-group under it — a person nested in "Family" cannot outlive it.
  groupIds: string[];
  rowIds: string[];
  entryIds: string[];
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
  return { groupIds: [], rowIds, entryIds: descendantEntryIds(dataset, directEntryIds) };
}

export function collectEntryCascade(dataset: TimelineDataset, entryId: string): Cascade {
  return { groupIds: [], rowIds: [], entryIds: descendantEntryIds(dataset, [entryId]) };
}

export function collectGroupCascade(dataset: TimelineDataset, groupId: string): Cascade {
  const groupIds = [groupId, ...dataset.groups.filter((g) => g.parentGroupId === groupId).map((g) => g.id)];
  const directRowIds = dataset.rows.filter((row) => groupIds.includes(row.groupId)).map((row) => row.id);
  const rowIds = descendantRowIds(dataset, directRowIds);
  const directEntryIds = dataset.entries.filter((e) => rowIds.includes(e.rowId)).map((e) => e.id);
  return { groupIds, rowIds, entryIds: descendantEntryIds(dataset, directEntryIds) };
}

export function describeCascade(cascade: Cascade): string {
  const parts: string[] = [];
  const count = (n: number, singular: string, plural: string) => `${n} ${n === 1 ? singular : plural}`;
  parts.push(count(cascade.entryIds.length, "entry", "entries"));
  // Deleting a group takes whole timelines with it, and none of them is the
  // thing named in the prompt — so all of them are counted, as timelines.
  // Deleting a row is the other case: the first row id IS the named row, and
  // the rest are its sub-rows.
  const deletesAGroup = cascade.groupIds.length > 0;
  if (deletesAGroup) {
    if (cascade.rowIds.length > 0) parts.push(count(cascade.rowIds.length, "timeline", "timelines"));
  } else {
    const subRowCount = Math.max(0, cascade.rowIds.length - 1);
    if (subRowCount > 0) parts.push(count(subRowCount, "sub-row", "sub-rows"));
  }
  // The first group id is the group being deleted itself, not a sub-group.
  const subGroupCount = Math.max(0, cascade.groupIds.length - 1);
  if (subGroupCount > 0) parts.push(count(subGroupCount, "sub-group", "sub-groups"));
  if (parts.length === 1) return `This deletes ${parts[0]}.`;
  return `This deletes ${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}.`;
}

export function applyDelete(dataset: TimelineDataset, cascade: Cascade): TimelineDataset {
  return {
    ...dataset,
    groups: dataset.groups.filter((g) => !cascade.groupIds.includes(g.id)),
    rows: dataset.rows.filter((r) => !cascade.rowIds.includes(r.id)),
    entries: dataset.entries.filter((e) => !cascade.entryIds.includes(e.id)),
  };
}
