// Delete cascades (ENGINEERING_PROMPT.md §9): deletes flow down the
// row/entry parent tree and are always confirmed with a summary first.

import type { TimelineDataset } from "./types";

export interface Cascade {
  // Empty except when a group is being deleted, where it holds that group and
  // every sub-group under it — a person nested in "Family" cannot outlive it.
  groupIds: string[];
  rowIds: string[];
  entryIds: string[];
  // Events sit on rows, so they are collected whenever a row goes — but an
  // event has no children of its own, which is why there is no event tree walk
  // anywhere below.
  eventIds: string[];
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

function eventIdsOfRows(dataset: TimelineDataset, rowIds: string[]): string[] {
  return dataset.events.filter((event) => rowIds.includes(event.rowId)).map((event) => event.id);
}

export function collectRowCascade(dataset: TimelineDataset, rowId: string): Cascade {
  const directEntryIds = dataset.entries.filter((e) => e.rowId === rowId).map((e) => e.id);
  return {
    groupIds: [],
    rowIds: [rowId],
    entryIds: descendantEntryIds(dataset, directEntryIds),
    eventIds: eventIdsOfRows(dataset, [rowId]),
  };
}

export function collectEntryCascade(dataset: TimelineDataset, entryId: string): Cascade {
  return { groupIds: [], rowIds: [], entryIds: descendantEntryIds(dataset, [entryId]), eventIds: [] };
}

// An event takes nothing with it: nothing in the model points at one.
export function collectEventCascade(_dataset: TimelineDataset, eventId: string): Cascade {
  return { groupIds: [], rowIds: [], entryIds: [], eventIds: [eventId] };
}

// All descendant groups of `groupId`, at any depth, `groupId` first.
function descendantGroupIds(dataset: TimelineDataset, groupId: string): string[] {
  const collected = [groupId];
  let frontier = [groupId];
  while (frontier.length > 0) {
    const children = dataset.groups.filter((g) => g.parentGroupId !== undefined && frontier.includes(g.parentGroupId));
    frontier = children.map((g) => g.id);
    collected.push(...frontier);
  }
  return collected;
}

export function collectGroupCascade(dataset: TimelineDataset, groupId: string): Cascade {
  const groupIds = descendantGroupIds(dataset, groupId);
  const rowIds = dataset.rows.filter((row) => row.groupId !== undefined && groupIds.includes(row.groupId)).map((row) => row.id);
  const directEntryIds = dataset.entries.filter((e) => rowIds.includes(e.rowId)).map((e) => e.id);
  return {
    groupIds,
    rowIds,
    entryIds: descendantEntryIds(dataset, directEntryIds),
    eventIds: eventIdsOfRows(dataset, rowIds),
  };
}

export function describeCascade(cascade: Cascade): string {
  const parts: string[] = [];
  const count = (n: number, singular: string, plural: string) => `${n} ${n === 1 ? singular : plural}`;
  // The entry count leads and is stated even at zero — "this deletes 0 entries"
  // is worth knowing before removing a timeline. The one delete where entries
  // are not the subject at all is an event's own, and there it is left out.
  const eventsOnly =
    cascade.entryIds.length === 0 && cascade.rowIds.length === 0 && cascade.groupIds.length === 0;
  if (!eventsOnly) parts.push(count(cascade.entryIds.length, "entry", "entries"));
  // Only mentioned when there are some: "0 events" on every row delete would be
  // noise on the one prompt that has to be read.
  if (cascade.eventIds.length > 0) parts.push(count(cascade.eventIds.length, "event", "events"));
  // Deleting a group takes whole timelines with it, and none of them is the
  // thing named in the prompt — so all of them are counted, as timelines.
  // Deleting a single row never reaches here: rowIds is just that one row,
  // already named in the prompt by the caller.
  const deletesAGroup = cascade.groupIds.length > 0;
  if (deletesAGroup && cascade.rowIds.length > 0) {
    parts.push(count(cascade.rowIds.length, "timeline", "timelines"));
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
    events: dataset.events.filter((e) => !cascade.eventIds.includes(e.id)),
  };
}
