// Break out ("explode" was the working name; "break out" is what shipped):
// turns one timeline into a group of timelines, one per entry — or, given a
// single entry id, peels just that entry onto its own new timeline while
// everything else stays on the original row. Pure and side-effect free like
// the rest of `src/model`; `src/state/actions.ts` is the only caller that
// touches the store.

import { newId } from "./dataset";
import type { Group, TimelineDataset, TimelineEntry, TimelineRow } from "./types";

export interface BreakOutResult {
  dataset: TimelineDataset; // a NEW dataset — the argument is never mutated
  groupId: string; // the new group
  rowIds: string[]; // the new timelines, in the order created
}

// The entries a call actually acts on: every entry on `rowId` when `entryIds`
// is undefined, otherwise only the ones from `entryIds` that are actually on
// that row — an id for another row, or one that doesn't exist, is silently
// dropped rather than treated as an error. Sorted ascending by start so the
// new rows come out in chronological order (Array#sort is stable, so ties
// keep their original relative order).
function entriesToBreakOut(dataset: TimelineDataset, rowId: string, entryIds?: string[]): TimelineEntry[] {
  const onRow = dataset.entries.filter((entry) => entry.rowId === rowId);
  const selected = entryIds === undefined ? onRow : onRow.filter((entry) => entryIds.includes(entry.id));
  return [...selected].sort((a, b) => a.start.ms - b.start.ms);
}

function titleOf(entry: TimelineEntry): string {
  return entry.title.trim() || "Untitled";
}

// True when there is at least one entry on that row for `entryIds` to select
// — the same test `breakOut` itself uses to decide whether to do anything.
export function canBreakOut(dataset: TimelineDataset, rowId: string, entryIds?: string[]): boolean {
  return entriesToBreakOut(dataset, rowId, entryIds).length > 0;
}

// `entryIds` undefined means "every entry on the row".
export function breakOut(
  dataset: TimelineDataset,
  rowId: string,
  entryIds?: string[],
  makeId: (prefix: string) => string = newId,
): BreakOutResult | undefined {
  const sourceRow = dataset.rows.find((row) => row.id === rowId);
  if (!sourceRow) return undefined;
  const ordered = entriesToBreakOut(dataset, rowId, entryIds);
  if (ordered.length === 0) return undefined;

  const result = structuredClone(dataset);

  // The group is a near-copy of the row's own presentation — but never
  // `shared`/`shareByDefault`: publishing is always a separate, deliberate
  // act, so a break-out must never make anything new public by itself.
  const newGroup: Group = {
    id: makeId("group"),
    parentGroupId: sourceRow.groupId,
    label: sourceRow.label,
    color: sourceRow.color,
    icon: sourceRow.icon,
    website: sourceRow.website,
    birthDate: sourceRow.birthDate,
    collapsed: false,
    // The new group takes the row's own slot among its siblings — breaking
    // out and collapsing are inverses on screen, so the group has to appear
    // exactly where the timeline it replaces was. The row itself moves inside
    // it, so nothing is left holding this order.
    order: sourceRow.order,
  };

  // One new row per broken-out entry, in the chronological order already
  // established by `entriesToBreakOut`. `birthDate` is deliberately not
  // copied here — `birthDateForRow()` already falls back to the ancestor
  // group's, and copying it too would leave two places to keep in sync.
  const newRows: TimelineRow[] = ordered.map((entry) => ({
    id: makeId("row"),
    groupId: newGroup.id,
    label: titleOf(entry),
    color: sourceRow.color,
    icon: sourceRow.icon,
    // The entry's own site beats the row's: a "Jobs" row broken out into one
    // row per employer should show each employer's favicon, and the entry is
    // where that site was already recorded. The row's own is the fallback.
    website: entry.website ?? sourceRow.website,
    shared: sourceRow.shared,
  }));
  const newRowIdByEntryId = new Map(ordered.map((entry, i) => [entry.id, newRows[i].id]));

  // Every field of a broken-out entry — including its title — stays exactly
  // as it was; only `rowId` moves. `parentEntryId` links are left alone:
  // cascade.ts already walks that tree across rows.
  result.entries = result.entries.map((entry) => {
    const newRowId = newRowIdByEntryId.get(entry.id);
    return newRowId === undefined ? entry : { ...entry, rowId: newRowId };
  });

  // The original row moves into the new group and keeps whatever it didn't
  // give up — remaining entries and every one of its events (events never
  // move: rule is "the row keeps its events", full stop). If nothing is left
  // on it at all, it disappears rather than living on as an empty timeline.
  const remainingEntries = result.entries.filter((entry) => entry.rowId === rowId).length;
  const remainingEvents = result.events.filter((event) => event.rowId === rowId).length;
  if (remainingEntries === 0 && remainingEvents === 0) {
    result.rows = result.rows.filter((row) => row.id !== rowId);
  } else {
    const keptRow = result.rows.find((row) => row.id === rowId)!;
    keptRow.groupId = newGroup.id;
  }

  // Array position no longer decides anything (schema v10) — `newGroup.order`
  // above is what places it, and `normalizeChildOrder` numbers the new rows
  // inside it in the order they are appended.
  result.groups.push(newGroup);
  result.rows.push(...newRows);

  return { dataset: result, groupId: newGroup.id, rowIds: newRows.map((row) => row.id) };
}

function quote(text: string): string {
  return `“${text}”`;
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

// One short sentence for the confirm dialog. Two shapes: breaking out every
// entry on the row reads as the row becoming a group; breaking out fewer reads
// as those entries leaving while the row stays behind.
export function describeBreakOut(dataset: TimelineDataset, rowId: string, entryIds?: string[]): string {
  const row = dataset.rows.find((candidate) => candidate.id === rowId);
  if (!row) return "";
  const selected = entriesToBreakOut(dataset, rowId, entryIds);
  if (selected.length === 0) return "";

  const totalOnRow = dataset.entries.filter((entry) => entry.rowId === rowId).length;
  if (selected.length === totalOnRow) {
    const titles = selected.map(titleOf);
    const count = titles.length;
    return `${quote(row.label)} becomes a group with ${count} ${count === 1 ? "timeline" : "timelines"}: ${titles.join(", ")}.`;
  }

  if (selected.length === 1) {
    return `${quote(titleOf(selected[0]))} moves onto its own timeline inside a new group ${quote(row.label)}.`;
  }

  const titles = selected.map((entry) => quote(titleOf(entry)));
  return `${joinList(titles)} move onto their own timelines inside a new group ${quote(row.label)}.`;
}
