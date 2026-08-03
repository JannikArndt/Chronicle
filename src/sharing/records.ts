// The wire format — plans/sharing-feature-design.md §D3.
//
// One flat record type for all three entities, because the merge, the diff and
// the transport all treat them identically and a discriminated union would make
// every one of them branch three ways for no gain.
//
// The column split is the load-bearing part: structural fields are plaintext
// because row-level security has to evaluate them, and everything that carries
// content lives in `payload`. That is the line end-to-end encryption would be
// drawn along later — `payload` becomes ciphertext and nothing else moves.

import type { SyncSubset } from "../model/sharing";
import type { Group, TimelineDataset, TimelineEntry, TimelineRow } from "../model/types";

export type RecordKind = "group" | "row" | "entry";

export interface SyncRecord {
  kind: RecordKind;
  id: string; // the owner's local id; unique per owner, not globally
  ownerAccountId: string;
  // Structural. group → its parentGroupId; row → its groupId; entry → its rowId.
  // Undefined for a top-level group.
  parentId?: string;
  // The publish flag RLS reads. Entries carry `false` and are never consulted:
  // an entry's visibility is its row's, which is what "entries have no flag of
  // their own" means in practice.
  shared: boolean;
  // Content. Null on a tombstone — a delete must not keep shipping the thing
  // it deleted.
  payload: Record<string, unknown> | null;
  clock: string; // serialised HLC
  updatedBy: string; // account id of the writer
  deleted: boolean;
}

export function recordKey(kind: RecordKind, id: string): string {
  return `${kind}:${id}`;
}

export function keyOf(record: SyncRecord): string {
  return recordKey(record.kind, record.id);
}

// A row's `parentRowId` and an entry's `parentEntryId` go in the payload, not
// into a structural column: they are presentational nesting, and no access
// decision reads them. Only the container link (row → group, entry → row) and
// the publish flag drive RLS, so only those stay in the clear.
export function recordsFromSubset(subset: SyncSubset, ownerAccountId: string, clock: string): SyncRecord[] {
  const base = { ownerAccountId, clock, updatedBy: ownerAccountId, deleted: false };
  return [
    ...subset.groups.map((group) => ({
      ...base,
      kind: "group" as const,
      id: group.id,
      parentId: group.parentGroupId,
      shared: group.shared === true,
      payload: groupPayload(group),
    })),
    ...subset.rows.map((row) => ({
      ...base,
      kind: "row" as const,
      id: row.id,
      parentId: row.groupId,
      shared: row.shared === true,
      payload: rowPayload(row),
    })),
    ...subset.entries.map((entry) => ({
      ...base,
      kind: "entry" as const,
      id: entry.id,
      parentId: entry.rowId,
      shared: false,
      payload: entryPayload(entry),
    })),
  ];
}

function groupPayload(group: Group): Record<string, unknown> {
  const { id, parentGroupId, shared, ...rest } = group;
  void id;
  void parentGroupId;
  void shared;
  return rest;
}

function rowPayload(row: TimelineRow): Record<string, unknown> {
  const { id, groupId, shared, ...rest } = row;
  void id;
  void groupId;
  void shared;
  return rest;
}

function entryPayload(entry: TimelineEntry): Record<string, unknown> {
  const { id, rowId, ...rest } = entry;
  void id;
  void rowId;
  return rest;
}

// Rebuild a dataset from records. Used for a subscriber's mirror, so it drops
// tombstones and anything whose container did not arrive — a viewer who is
// granted one row of a group they cannot otherwise see must not end up holding
// a half-built tree with dangling references.
export function datasetToRecordsRoundTrip(records: SyncRecord[]): Omit<TimelineDataset, "schemaVersion"> {
  const live = records.filter((record) => !record.deleted && record.payload !== null);

  const groups: Group[] = live
    .filter((record) => record.kind === "group")
    .map((record) => ({
      ...(record.payload as Omit<Group, "id" | "parentGroupId" | "shared">),
      id: record.id,
      parentGroupId: record.parentId,
      shared: record.shared,
    }));
  const groupIds = new Set(groups.map((group) => group.id));

  const rows: TimelineRow[] = live
    .filter((record) => record.kind === "row" && record.parentId !== undefined && groupIds.has(record.parentId))
    .map((record) => ({
      ...(record.payload as Omit<TimelineRow, "id" | "groupId" | "shared">),
      id: record.id,
      groupId: record.parentId as string,
      shared: record.shared,
    }));
  const rowIds = new Set(rows.map((row) => row.id));

  const entries: TimelineEntry[] = live
    .filter((record) => record.kind === "entry" && record.parentId !== undefined && rowIds.has(record.parentId))
    .map((record) => ({
      ...(record.payload as Omit<TimelineEntry, "id" | "rowId">),
      id: record.id,
      rowId: record.parentId as string,
    }));
  const entryIds = new Set(entries.map((entry) => entry.id));

  return {
    groups: groups.map((group) => ({
      ...group,
      parentGroupId:
        group.parentGroupId !== undefined && groupIds.has(group.parentGroupId) ? group.parentGroupId : undefined,
    })),
    rows: rows.map((row) => ({
      ...row,
      parentRowId: row.parentRowId !== undefined && rowIds.has(row.parentRowId) ? row.parentRowId : undefined,
    })),
    entries: entries.map((entry) => ({
      ...entry,
      parentEntryId:
        entry.parentEntryId !== undefined && entryIds.has(entry.parentEntryId) ? entry.parentEntryId : undefined,
    })),
  };
}
