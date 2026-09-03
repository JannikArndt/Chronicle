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

// ---------- sibling order (schema v10) ----------
//
// A container's children — its own timelines AND its sub-groups — live in ONE
// ordered sequence, so the two kinds can be interleaved freely. Before v10 the
// order was implicit ("every row of this container, then every group of it",
// each in array order), which made a group above a timeline literally
// unrepresentable. `order` is that sequence made explicit; array order no
// longer decides anything about the picture.
//
// A child WITHOUT an `order` sorts after every child that has one, rows before
// groups — which is exactly the pre-v10 arrangement, so a merged public
// dataset (whose records never carry an order) still lands below the user's
// own, and an un-normalized record never jumps to the top.
const UNORDERED_SORT_BASE = 1e9;

export type RailChildKind = "row" | "group";

export interface RailChildRef {
  kind: RailChildKind;
  id: string;
}

// One child of a container, resolved to the record it stands for.
export type RailChild =
  | { kind: "row"; id: string; order: number; row: TimelineRow }
  | { kind: "group"; id: string; order: number; group: Group };

// Every direct child of `parentGroupId` (undefined = the root container), in
// render order. The single place that answers "what does this container hold,
// top to bottom" — the layout, the collapsed-group summaries and every move
// action go through it rather than re-deriving the rows-then-groups walk.
export function orderedChildren(
  dataset: TimelineDataset,
  parentGroupId: string | undefined,
): RailChild[] {
  const children: Array<RailChild & { sortKey: number }> = [];
  let unordered = 0;
  dataset.rows.forEach((row) => {
    if (row.groupId !== parentGroupId) return;
    const sortKey = row.order ?? UNORDERED_SORT_BASE + unordered++;
    children.push({ kind: "row", id: row.id, order: sortKey, row, sortKey });
  });
  dataset.groups.forEach((group) => {
    if (group.parentGroupId !== parentGroupId) return;
    const sortKey = group.order ?? UNORDERED_SORT_BASE + unordered++;
    children.push({ kind: "group", id: group.id, order: sortKey, group, sortKey });
  });
  return children
    .sort((a, b) => a.sortKey - b.sortKey)
    .map(({ sortKey: _sortKey, ...child }) => child as RailChild);
}

// Every container in the dataset: the root, plus one per group.
function containerIds(dataset: TimelineDataset): Array<string | undefined> {
  return [undefined, ...dataset.groups.map((group) => group.id)];
}

// Rewrites every child's `order` to 0..n-1 in its container, preserving the
// order `orderedChildren()` reports. Called after every mutation (see
// `updateDataset`), which is what lets a caller express "put this between
// those two" by writing a fractional order and leaving the tidying to here —
// and what gives a record created without an order (a new timeline, an
// imported v9 file) a real one at the end of its container.
export function normalizeChildOrder(dataset: TimelineDataset): TimelineDataset {
  for (const parentGroupId of containerIds(dataset)) {
    orderedChildren(dataset, parentGroupId).forEach((child, index) => {
      if (child.kind === "row") child.row.order = index;
      else child.group.order = index;
    });
  }
  return dataset;
}

// The order value that puts a child immediately before `before` in
// `parentGroupId` (null/undefined `before` = at the very end). Fractional on
// purpose: `normalizeChildOrder` turns it back into an integer straight after.
export function orderForInsert(
  dataset: TimelineDataset,
  parentGroupId: string | undefined,
  before: RailChildRef | null,
): number {
  const children = orderedChildren(dataset, parentGroupId);
  if (before !== null) {
    const target = children.find((child) => child.kind === before.kind && child.id === before.id);
    if (target) return target.order - 0.5;
  }
  const last = children[children.length - 1];
  return last === undefined ? 0 : last.order + 1;
}
