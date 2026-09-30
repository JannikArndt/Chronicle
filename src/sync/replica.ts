// The client's copy of the server, and the line between what the server has
// said and what this device has done — plans/v2-server-design.md §4.
//
//   base     the server's last word on every record this account can see
//   pending  field changes made here that the server has not acknowledged
//
// What is on screen is `base ⊕ pending`. The actions in state/actions.ts know
// nothing about any of this: they edit `state.dataset` as they always have,
// and `diffView` turns the difference between the last view and the edited
// dataset into pending field changes, each stamped with a clock. A server
// answer (`acknowledge`) or a live event (`applyServerRecords`, `applyGone`)
// updates `base`, and the view is rebuilt from both.
//
// Everything here is pure data in, data out, so the rules that decide what a
// local edit may do to someone else's records are tested without a network.

import { datasetOf, recordsOfDataset, sameValue } from "./entities";
import { PARENT_KEY } from "./protocol";
import type { EntityRecord } from "./entities";
import type { Access, FieldChange, Fields, PushRecord, PushResult, RecordKind, WireRecord } from "./protocol";
import type { TimelineDataset } from "../model/types";

export interface BaseRecord {
  id: string;
  kind: RecordKind;
  owner: string;
  access: Access;
  fields: Fields;
}

export interface PendingRecord {
  id: string;
  kind: RecordKind;
  owner: string;
  fields: Record<string, FieldChange>;
  deleted?: string; // clock of the delete
}

export interface Replica {
  me: string;
  base: Map<string, BaseRecord>;
  pending: Map<string, PendingRecord>;
}

export interface RecordMeta {
  owner: string;
  access: Access;
  // Someone else's record whose container this account cannot see, drawn at
  // the top level of this account's view instead. Its place in its real tree
  // (container and order) is not this view's to change.
  rootProjected: boolean;
}

export interface View {
  dataset: TimelineDataset;
  meta: Map<string, RecordMeta>;
  records: Map<string, EntityRecord>;
}

export interface ViewPrefs {
  // Collapsing someone else's group is a view preference of this device, not
  // an edit of their data — it would fold the group on their screen too.
  foreignCollapsed: Map<string, boolean>;
  selfGroupId?: string;
}

export function emptyReplica(me: string): Replica {
  return { me, base: new Map(), pending: new Map() };
}

function isPublicId(id: string): boolean {
  return id.startsWith("pub:");
}

function overlay(fields: Fields, changes: Record<string, FieldChange> | undefined): Fields {
  if (changes === undefined) return fields;
  const result = { ...fields };
  for (const [key, change] of Object.entries(changes)) {
    if (change.v === null || change.v === undefined) delete result[key];
    else result[key] = change.v;
  }
  return result;
}

interface CurrentRecord {
  id: string;
  kind: RecordKind;
  owner: string;
  access: Access;
  fields: Fields;
}

function currentRecords(replica: Replica): Map<string, CurrentRecord> {
  const current = new Map<string, CurrentRecord>();
  for (const base of replica.base.values()) {
    const pending = replica.pending.get(base.id);
    if (pending?.deleted !== undefined) continue;
    current.set(base.id, { ...base, fields: overlay(base.fields, pending?.fields) });
  }
  for (const pending of replica.pending.values()) {
    if (current.has(pending.id) || replica.base.has(pending.id) || pending.deleted !== undefined) continue;
    current.set(pending.id, {
      id: pending.id,
      kind: pending.kind,
      owner: pending.owner,
      access: pending.owner === replica.me ? "own" : "edit",
      fields: overlay({}, pending.fields),
    });
  }
  return current;
}

// How one record is drawn in this account's view: someone else's group or
// row whose container is out of sight goes to the top level, unordered; and
// someone else's group is collapsed the way this device likes it.
function project(
  record: CurrentRecord,
  me: string,
  isPresent: (id: string) => boolean,
  prefs: ViewPrefs,
): { fields: Fields; rootProjected: boolean } {
  const fields = { ...record.fields };
  let rootProjected = false;
  if (record.owner !== me) {
    if (record.kind === "group" || record.kind === "row") {
      const parentKey = PARENT_KEY[record.kind];
      const parent = fields[parentKey];
      if (typeof parent !== "string" || !isPresent(parent)) {
        delete fields[parentKey];
        delete fields.order;
        rootProjected = true;
      }
    }
    if (record.kind === "group" && prefs.foreignCollapsed.has(record.id)) {
      fields.collapsed = prefs.foreignCollapsed.get(record.id);
    }
  }
  return { fields, rootProjected };
}

export function buildView(replica: Replica, prefs: ViewPrefs): View {
  const current = currentRecords(replica);
  const ordered = [...current.values()].sort((a, b) => Number(a.owner !== replica.me) - Number(b.owner !== replica.me));
  const meta = new Map<string, RecordMeta>();
  const records = new Map<string, EntityRecord>();
  for (const record of ordered) {
    const { fields, rootProjected } = project(record, replica.me, (id) => current.has(id), prefs);
    meta.set(record.id, { owner: record.owner, access: record.access, rootProjected });
    records.set(record.id, { id: record.id, kind: record.kind, fields });
  }
  return { dataset: datasetOf(records.values(), prefs.selfGroupId), meta, records };
}

// One record's fields exactly as `buildView` would draw them now, or
// undefined if it would not be drawn — so a caller can tell whether a server
// answer changes anything on screen without rebuilding everything to find out.
export function viewFields(replica: Replica, prefs: ViewPrefs, id: string): Fields | undefined {
  const base = replica.base.get(id);
  const pending = replica.pending.get(id);
  if (pending?.deleted !== undefined) return undefined;
  let record: CurrentRecord;
  if (base !== undefined) record = { ...base, fields: overlay(base.fields, pending?.fields) };
  else if (pending !== undefined)
    record = {
      id,
      kind: pending.kind,
      owner: pending.owner,
      access: pending.owner === replica.me ? "own" : "edit",
      fields: overlay({}, pending.fields),
    };
  else return undefined;
  const isPresent = (other: string) => {
    const otherPending = replica.pending.get(other);
    if (otherPending?.deleted !== undefined) return false;
    return replica.base.has(other) || otherPending !== undefined;
  };
  return project(record, replica.me, isPresent, prefs).fields;
}

export interface DiffOutcome {
  view: View; // the edited dataset, with its meta, ready to diff against next time
  changed: boolean; // pending gained something to send
  // A change that cannot be kept — an edit to something read-only, a move
  // into someone else's tree — was dropped; rebuild the view to undo it on
  // screen too.
  refused: boolean;
  collapsed: Array<[string, boolean]>; // collapse toggles on others' groups
}

export function diffView(prev: View, next: TimelineDataset, replica: Replica, stamp: () => string): DiffOutcome {
  const me = replica.me;
  const before = prev.records;
  const after = recordsOfDataset(next);
  const meta = new Map(prev.meta);
  const collapsed: Array<[string, boolean]> = [];
  let refused = false;
  let changed = false;
  let clock: string | undefined;
  const c = (): string => (clock ??= stamp());

  const metaOf = (id: string): RecordMeta => prev.meta.get(id) ?? { owner: me, access: "own", rootProjected: false };

  // Whose tree a new record belongs to: its container's owner — so an entry
  // added to Dad's timeline is Dad's record. Null when it may not be created
  // there at all.
  const resolved = new Map<string, string | null>();
  const ownerOfNew = (record: EntityRecord, seen: Set<string>): string | null => {
    if (resolved.has(record.id)) return resolved.get(record.id)!;
    const parent = record.fields[PARENT_KEY[record.kind]];
    let owner: string | null;
    if (typeof parent !== "string") owner = record.kind === "entry" || record.kind === "event" ? null : me;
    else if (isPublicId(parent)) owner = null;
    else if (meta.has(parent)) {
      const parentMeta = meta.get(parent)!;
      owner = parentMeta.access === "read" ? null : parentMeta.owner;
    } else if (after.has(parent) && !before.has(parent) && !seen.has(parent)) {
      owner = ownerOfNew(after.get(parent)!, seen.add(record.id));
    } else owner = me; // a container that does not exist: an orphan of mine
    resolved.set(record.id, owner);
    return owner;
  };

  const pendingFor = (id: string, kind: RecordKind, owner: string): PendingRecord => {
    let pending = replica.pending.get(id);
    if (pending === undefined) replica.pending.set(id, (pending = { id, kind, owner, fields: {} }));
    return pending;
  };

  for (const [id, record] of after) {
    if (isPublicId(id)) continue;
    const old = before.get(id);

    if (old === undefined) {
      const owner = ownerOfNew(record, new Set());
      if (owner === null) {
        refused = true;
        continue;
      }
      const stampNow = c();
      const fields: Record<string, FieldChange> = {};
      for (const [key, value] of Object.entries(record.fields)) fields[key] = { v: value, c: stampNow };
      replica.pending.set(id, { id, kind: record.kind, owner, fields });
      meta.set(id, { owner, access: owner === me ? "own" : "edit", rootProjected: false });
      changed = true;
      continue;
    }

    const keys = new Set([...Object.keys(old.fields), ...Object.keys(record.fields)]);
    const differing = [...keys].filter((key) => !sameValue(old.fields[key], record.fields[key]));
    if (differing.length === 0) continue;

    const recordMeta = metaOf(id);
    const foreign = recordMeta.owner !== me;
    const parentKey = PARENT_KEY[record.kind];
    const toSend: string[] = [];
    for (const key of differing) {
      if (foreign && key === "collapsed" && record.kind === "group") {
        collapsed.push([id, record.fields.collapsed === true]);
        continue;
      }
      // Where a projected record sits in someone else's tree is not this
      // view's business; renumbering it here says nothing about there. The
      // same goes for a read-only record's order: renumbering a container
      // this account sees only part of is an artefact, not an edit.
      if ((recordMeta.rootProjected || recordMeta.access === "read") && key === "order") continue;
      if (recordMeta.access === "read") {
        refused = true;
        continue;
      }
      if (key === parentKey) {
        const target = record.fields[key];
        if (recordMeta.rootProjected) {
          refused = true;
          continue;
        }
        if (typeof target !== "string") {
          if (foreign) {
            refused = true;
            continue;
          }
        } else {
          const targetMeta = meta.get(target);
          if (targetMeta === undefined || targetMeta.owner !== recordMeta.owner || targetMeta.access === "read") {
            refused = true;
            continue;
          }
        }
      }
      toSend.push(key);
    }
    if (toSend.length === 0) continue;
    const pending = pendingFor(id, record.kind, recordMeta.owner);
    const stampNow = c();
    for (const key of toSend) pending.fields[key] = { v: record.fields[key] ?? null, c: stampNow };
    changed = true;
  }

  for (const [id, old] of before) {
    if (after.has(id) || isPublicId(id)) continue;
    const recordMeta = metaOf(id);
    if (recordMeta.access === "read") {
      refused = true;
      continue;
    }
    replica.pending.set(id, { id, kind: old.kind, owner: recordMeta.owner, fields: {}, deleted: c() });
    meta.delete(id);
    changed = true;
  }

  // Changes that were refused are not in `next` as far as the next diff is
  // concerned: the caller rebuilds, and the rebuilt view is the new baseline.
  return { view: { dataset: next, meta, records: after }, changed, refused, collapsed };
}

export function pendingBatch(replica: Replica, max: number): PushRecord[] {
  const batch: PushRecord[] = [];
  for (const pending of replica.pending.values()) {
    if (batch.length >= max) break;
    batch.push({
      id: pending.id,
      kind: pending.kind,
      owner: pending.owner,
      fields: { ...pending.fields },
      ...(pending.deleted === undefined ? {} : { deleted: pending.deleted }),
    });
  }
  return batch;
}

function fromWire(record: WireRecord): BaseRecord {
  return { id: record.id, kind: record.kind, owner: record.owner, access: record.access, fields: record.fields };
}

// The server's answer to a push. What it accepted leaves `pending` (unless a
// newer local edit of the same field has happened since it was sent — that
// one stays, with its newer clock); what it resolved becomes `base`.
export function acknowledge(replica: Replica, sent: PushRecord[], results: PushResult[]): PushResult[] {
  const sentById = new Map(sent.map((record) => [record.id, record]));
  const rejected: PushResult[] = [];
  for (const result of results) {
    const was = sentById.get(result.id);
    const pending = replica.pending.get(result.id);
    if (was !== undefined && pending !== undefined) {
      for (const [key, change] of Object.entries(was.fields)) {
        if (pending.fields[key]?.c === change.c) delete pending.fields[key];
      }
      if (was.deleted !== undefined && pending.deleted === was.deleted) delete pending.deleted;
      if (Object.keys(pending.fields).length === 0 && pending.deleted === undefined) replica.pending.delete(result.id);
    }
    if (!result.ok) {
      rejected.push(result);
      // A record the server never accepted cannot be completed by a later
      // field change either: drop what is left of it.
      if (!replica.base.has(result.id)) replica.pending.delete(result.id);
      continue;
    }
    const record = result.record;
    if (record === undefined || record.deleted === true) {
      replica.base.delete(result.id);
      replica.pending.delete(result.id);
    } else {
      replica.base.set(record.id, fromWire(record));
    }
  }
  return rejected;
}

export function applyServerRecords(replica: Replica, records: WireRecord[]): void {
  for (const record of records) {
    if (record.deleted === true) {
      replica.base.delete(record.id);
      replica.pending.delete(record.id);
      continue;
    }
    replica.base.set(record.id, fromWire(record));
    if (record.access === "read") replica.pending.delete(record.id);
  }
}

export function applyGone(replica: Replica, ids: string[]): void {
  for (const id of ids) {
    replica.base.delete(id);
    replica.pending.delete(id);
  }
}

// A full pull replaces `base`. Pending changes to records the server no
// longer shows are dropped — they were deleted elsewhere, or access to them
// ended — except records this device created and has not had acknowledged
// yet, which the server has simply not heard of.
export function replaceBase(replica: Replica, records: WireRecord[]): void {
  const previous = replica.base;
  replica.base = new Map(records.filter((record) => record.deleted !== true).map((record) => [record.id, fromWire(record)]));
  for (const [id, pending] of replica.pending) {
    const now = replica.base.get(id);
    if (now === undefined) {
      if (previous.has(id)) replica.pending.delete(id);
      continue;
    }
    if (now.access === "read") replica.pending.delete(id);
    else if (pending.owner !== now.owner) pending.owner = now.owner;
  }
}

// Every record of `dataset` as a creation by `me`: what a device's local
// timelines become on the first sign-in.
export function adoptLocalDataset(replica: Replica, dataset: TimelineDataset, stamp: string): void {
  for (const record of recordsOfDataset(dataset).values()) {
    if (isPublicId(record.id)) continue;
    const fields: Record<string, FieldChange> = {};
    for (const [key, value] of Object.entries(record.fields)) fields[key] = { v: value, c: stamp };
    replica.pending.set(record.id, { id: record.id, kind: record.kind, owner: replica.me, fields });
  }
}

// ---------- persistence shape ----------

export interface StoredReplica {
  me: string;
  base: BaseRecord[];
  pending: PendingRecord[];
}

export function storeReplica(replica: Replica): StoredReplica {
  return { me: replica.me, base: [...replica.base.values()], pending: [...replica.pending.values()] };
}

export function loadReplica(stored: StoredReplica): Replica {
  return {
    me: stored.me,
    base: new Map(stored.base.map((record) => [record.id, record])),
    pending: new Map(stored.pending.map((record) => [record.id, record])),
  };
}
