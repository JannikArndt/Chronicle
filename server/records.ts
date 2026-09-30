// The record store: every group, row, entry and event of every account, merged
// field by field — plans/v2-server-design.md §4.
//
// Each field carries the hybrid-logical-clock stamp of the edit that set it,
// and a write only replaces a field whose stamp is older. Two people changing
// different fields of one entry at the same time therefore both keep their
// change; two people changing the same field converge on the later edit. A
// delete is permanent: a tombstone takes no more writes, so an edit arriving
// late from an offline phone cannot bring back something deliberately removed.

import { ancestorIds, computeAccess, indexRecords } from "./access";
import { transaction } from "./db";
import { ID_PATTERN, isKnownField, isRecordKind, validateFields } from "./validate";
import { PARENT_KEY, PARENT_KIND } from "../src/sync/protocol";
import type { AccessGrant, Level, OwnerIndex, StructRecord } from "./access";
import type { Database } from "./db";
import type { Access, Fields, PushRecord, PushResult, RecordKind, Role, SubjectKind, WireRecord } from "../src/sync/protocol";

// `wall:counter:node`, fixed width — see src/sync/hlc.ts.
const CLOCK_PATTERN = /^\d{15}:\d{5}:[A-Za-z0-9_.-]{1,80}$/;
// How far ahead of the server's own clock an edit may be stamped. A device
// whose clock is wildly fast would otherwise win every conflict for as long
// as its clock stays ahead.
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

const KIND_ORDER: Record<RecordKind, number> = { group: 0, row: 1, entry: 2, event: 3 };

export interface StoredRecord {
  id: string;
  owner: string;
  kind: RecordKind;
  parentId: string | null;
  shared: boolean;
  deleted: boolean;
  fields: Fields;
  clocks: Record<string, string>;
}

interface RecordRow {
  id: string;
  owner: string;
  kind: RecordKind;
  parent_id: string | null;
  shared: number;
  deleted: number;
  fields: string;
  clocks: string;
}

function fromRow(row: RecordRow): StoredRecord {
  return {
    id: row.id,
    owner: row.owner,
    kind: row.kind,
    parentId: row.parent_id,
    shared: row.shared === 1,
    deleted: row.deleted === 1,
    fields: JSON.parse(row.fields) as Fields,
    clocks: JSON.parse(row.clocks) as Record<string, string>,
  };
}

export function toStruct(record: StoredRecord): StructRecord {
  return { id: record.id, kind: record.kind, parentId: record.parentId, shared: record.shared };
}

export function toWire(record: StoredRecord, access: Access): WireRecord {
  return record.deleted
    ? { id: record.id, kind: record.kind, owner: record.owner, access, deleted: true, fields: {} }
    : { id: record.id, kind: record.kind, owner: record.owner, access, fields: record.fields };
}

function clockWall(clock: string): number {
  return Number(clock.slice(0, 15));
}

export class RecordStore {
  constructor(private readonly db: Database) {}

  // ---------- reading ----------

  get(id: string): StoredRecord | undefined {
    const row = this.db.prepare("SELECT * FROM records WHERE id = ?").get(id) as RecordRow | undefined;
    return row === undefined ? undefined : fromRow(row);
  }

  liveRecords(owner: string): StoredRecord[] {
    return (this.db.prepare("SELECT * FROM records WHERE owner = ? AND deleted = 0").all(owner) as unknown as RecordRow[]).map(
      fromRow,
    );
  }

  liveIndex(owner: string): OwnerIndex {
    const rows = this.db
      .prepare("SELECT id, kind, parent_id, shared FROM records WHERE owner = ? AND deleted = 0")
      .all(owner) as unknown as Array<{ id: string; kind: RecordKind; parent_id: string | null; shared: number }>;
    return indexRecords(rows.map((row) => ({ id: row.id, kind: row.kind, parentId: row.parent_id, shared: row.shared === 1 })));
  }

  grantsFrom(owner: string, grantee: string): AccessGrant[] {
    const rows = this.db
      .prepare("SELECT subject_kind, subject_id, role FROM grants WHERE owner = ? AND grantee = ?")
      .all(owner, grantee) as Array<{ subject_kind: SubjectKind; subject_id: string; role: Role }>;
    return rows.map((row) => ({ subjectKind: row.subject_kind, subjectId: row.subject_id, role: row.role }));
  }

  // Everyone the owner has granted anything to — the only accounts other than
  // the owner who can ever be affected by a change to the owner's records.
  granteesOf(owner: string): string[] {
    return (this.db.prepare("SELECT DISTINCT grantee FROM grants WHERE owner = ?").all(owner) as Array<{ grantee: string }>).map(
      (row) => row.grantee,
    );
  }

  ownersGrantingTo(grantee: string): string[] {
    return (this.db.prepare("SELECT DISTINCT owner FROM grants WHERE grantee = ?").all(grantee) as Array<{ owner: string }>).map(
      (row) => row.owner,
    );
  }

  // What `viewer` may do with each of `owner`'s live records. For the owner
  // themselves, everything is theirs.
  accessMap(viewer: string, owner: string, index: OwnerIndex = this.liveIndex(owner)): Map<string, Access> {
    if (viewer === owner) return new Map([...index.byId.keys()].map((id) => [id, "own" as const]));
    const levels = computeAccess(index, this.grantsFrom(owner, viewer));
    return new Map([...levels].map(([id, level]) => [id, level === "edit" ? ("edit" as const) : ("read" as const)]));
  }

  visibleRecords(viewer: string, owner: string): WireRecord[] {
    const records = this.liveRecords(owner);
    const access = this.accessMap(viewer, owner, indexRecords(records.map(toStruct)));
    return records.flatMap((record) => {
      const level = access.get(record.id);
      return level === undefined ? [] : [toWire(record, level)];
    });
  }

  canRead(viewer: string, recordId: string): boolean {
    const record = this.get(recordId);
    if (record === undefined || record.deleted) return false;
    if (record.owner === viewer) return true;
    return this.accessMap(viewer, record.owner).has(recordId);
  }

  // ---------- writing ----------

  // Applies one account's push to one owner's tree. Every record is either
  // written or rejected on its own — one bad record does not sink a batch
  // that also carries a day's worth of good ones.
  applyPush(writer: string, owner: string, records: PushRecord[], now: number): { results: PushResult[]; subjectsRemoved: boolean } {
    return transaction(this.db, () => {
      const applier = new PushApplier(this, this.db, writer, owner, now);
      const results = applier.apply(records);
      return { results, subjectsRemoved: applier.subjectsRemoved };
    });
  }

  deleteAllOf(owner: string): void {
    this.db.prepare("DELETE FROM records WHERE owner = ?").run(owner);
  }

  write(record: StoredRecord, writer: string, now: number): void {
    this.db
      .prepare(
        `INSERT INTO records (id, owner, kind, parent_id, shared, deleted, fields, clocks, updated_by, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET parent_id = excluded.parent_id, shared = excluded.shared,
           deleted = excluded.deleted, fields = excluded.fields, clocks = excluded.clocks,
           updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
      )
      .run(
        record.id,
        record.owner,
        record.kind,
        record.parentId,
        record.shared ? 1 : 0,
        record.deleted ? 1 : 0,
        JSON.stringify(record.fields),
        JSON.stringify(record.clocks),
        writer,
        now,
      );
  }
}

class PushApplier {
  private readonly index: OwnerIndex;
  // Only for a writer who is not the owner: what they may edit, kept current
  // as the batch creates records (a new record under something editable is
  // itself editable — which is exactly what an editor grant means).
  private readonly access: Map<string, Level> | undefined;
  private readonly editorSubjects = new Set<string>();
  private readonly editsEverything: boolean;
  // Set when a delete took a grant, an invite or a public link with it, so
  // the people on the other end of those hear about it.
  subjectsRemoved = false;

  constructor(
    private readonly store: RecordStore,
    private readonly db: Database,
    private readonly writer: string,
    private readonly owner: string,
    private readonly now: number,
  ) {
    this.index = store.liveIndex(owner);
    if (writer === owner) {
      this.editsEverything = true;
      return;
    }
    const grants = store.grantsFrom(owner, writer);
    this.access = computeAccess(this.index, grants);
    for (const grant of grants) if (grant.role === "editor") this.editorSubjects.add(grant.subjectId);
    this.editsEverything = grants.some((grant) => grant.role === "editor" && grant.subjectKind === "all");
  }

  apply(records: PushRecord[]): PushResult[] {
    // Containers before their contents, and a new group before a new group
    // inside it — so a whole new subtree can arrive in one batch.
    const depthInBatch = new Map<string, number>();
    const batchGroups = new Map(records.filter((r) => r.kind === "group").map((r) => [r.id, r]));
    const groupDepth = (id: string, seen = new Set<string>()): number => {
      if (depthInBatch.has(id)) return depthInBatch.get(id)!;
      const parent = batchGroups.get(id)?.fields.parentGroupId?.v;
      const depth = typeof parent === "string" && batchGroups.has(parent) && !seen.has(parent) ? groupDepth(parent, seen.add(id)) + 1 : 0;
      depthInBatch.set(id, depth);
      return depth;
    };
    const ordered = [...records].sort(
      (a, b) =>
        (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9) ||
        (a.kind === "group" && b.kind === "group" ? groupDepth(a.id) - groupDepth(b.id) : 0),
    );
    const results = new Map<string, PushResult>();
    for (const record of ordered) results.set(record.id, this.applyOne(record));
    return records.map((record) => results.get(record.id)!);
  }

  private reject(id: string, reason: string): PushResult {
    return { id, ok: false, reason };
  }

  private levelOf(id: string | null): Level | undefined {
    if (id === null) return undefined;
    if (this.access === undefined) return this.index.byId.has(id) ? "edit" : undefined;
    return this.access.get(id);
  }

  private applyOne(push: PushRecord): PushResult {
    const { id, kind } = push;
    if (typeof id !== "string" || !ID_PATTERN.test(id) || id.startsWith("pub:")) return this.reject(String(id), "invalid id");
    if (!isRecordKind(kind)) return this.reject(id, "invalid kind");
    if (typeof push.fields !== "object" || push.fields === null) return this.reject(id, "invalid fields");

    for (const [field, change] of Object.entries(push.fields)) {
      if (!isKnownField(kind, field)) return this.reject(id, `unknown field “${field}” on a ${kind}`);
      if (typeof change !== "object" || change === null || !this.validClock(change.c)) return this.reject(id, "invalid clock");
    }
    if (push.deleted !== undefined && !this.validClock(push.deleted)) return this.reject(id, "invalid clock");

    const existing = this.store.get(id);
    if (existing !== undefined && existing.owner !== this.owner) return this.reject(id, "that id belongs to someone else");
    if (existing !== undefined && existing.kind !== kind) return this.reject(id, "that id is a different kind of record");
    if (existing?.deleted === true) return this.accepted(existing);
    if (existing === undefined && push.deleted !== undefined) {
      // Deleting something the server never had: nothing to do, and nothing
      // to report back.
      return { id, ok: true };
    }

    // Merge, newest stamp per field.
    const fields: Fields = { ...(existing?.fields ?? {}) };
    const clocks: Record<string, string> = { ...(existing?.clocks ?? {}) };
    for (const [field, change] of Object.entries(push.fields)) {
      const current = clocks[field];
      if (current !== undefined && current >= change.c) continue;
      clocks[field] = change.c;
      if (change.v === null || change.v === undefined) delete fields[field];
      else fields[field] = change.v;
    }
    const deleted = push.deleted !== undefined;
    const parentValue = fields[PARENT_KEY[kind]];
    const parentId = typeof parentValue === "string" ? parentValue : null;
    const oldParentId = existing?.parentId ?? null;

    const denied = this.authorize(existing, kind, id, parentId, oldParentId, deleted);
    if (denied !== undefined) return this.reject(id, denied);

    if (!deleted) {
      const structural = this.checkStructure(kind, id, parentId);
      if (structural !== undefined) return this.reject(id, structural);
      const invalid = validateFields(kind, fields);
      if (invalid !== undefined) return this.reject(id, invalid);
    }

    const record: StoredRecord = {
      id,
      owner: this.owner,
      kind,
      parentId,
      shared: fields.shared === true,
      deleted,
      fields: deleted ? {} : fields,
      clocks: deleted ? {} : clocks,
    };
    this.store.write(record, this.writer, this.now);
    if (deleted) {
      this.cleanUpSubject(id);
      this.index.byId.delete(id);
      this.access?.delete(id);
    } else {
      this.index.byId.set(id, { id, kind, parentId, shared: record.shared });
      if (existing === undefined && this.access !== undefined) this.access.set(id, "edit");
    }
    return this.accepted(record);
  }

  private accepted(record: StoredRecord): PushResult {
    const access: Access = this.writer === this.owner ? "own" : "edit";
    return { id: record.id, ok: true, record: toWire(record, access) };
  }

  private validClock(clock: unknown): boolean {
    return typeof clock === "string" && CLOCK_PATTERN.test(clock) && clockWall(clock) <= this.now + MAX_CLOCK_SKEW_MS;
  }

  // Undefined if allowed; otherwise why not. The owner may do anything to
  // their own tree; an editor only within the subtree they were granted, and
  // never to the granted subject's own place in the tree.
  private authorize(
    existing: StoredRecord | undefined,
    kind: RecordKind,
    id: string,
    parentId: string | null,
    oldParentId: string | null,
    deleted: boolean,
  ): string | undefined {
    if (this.writer === this.owner) return undefined;
    const topLevelOk = this.editsEverything && (kind === "group" || kind === "row");
    if (existing !== undefined) {
      if (this.levelOf(id) !== "edit") return "you cannot edit this";
      if (this.editorSubjects.has(id) && (deleted || parentId !== oldParentId)) {
        return "what you were invited to edit cannot be moved or deleted";
      }
      if (!deleted && parentId !== oldParentId) {
        if (parentId === null ? !topLevelOk : this.levelOf(parentId) !== "edit") return "you cannot move this there";
      }
      return undefined;
    }
    if (parentId === null ? !topLevelOk : this.levelOf(parentId) !== "edit") return "you cannot add to this";
    return undefined;
  }

  private checkStructure(kind: RecordKind, id: string, parentId: string | null): string | undefined {
    if (parentId === null) {
      return kind === "entry" || kind === "event" ? `a ${kind} needs a timeline` : undefined;
    }
    const inTree = this.index.byId.get(parentId);
    if (inTree === undefined) {
      const elsewhere = this.store.get(parentId);
      if (elsewhere !== undefined && elsewhere.owner !== this.owner) return "its container belongs to someone else";
      if (elsewhere?.deleted === true) return "its container was deleted";
      // Not on the server at all (yet). Allowed for the owner, whose client
      // may still be sending it; unreachable until it arrives.
      return undefined;
    }
    if (inTree.kind !== PARENT_KIND[kind]) return `a ${kind} cannot sit inside a ${inTree.kind}`;
    if (kind === "group" && (parentId === id || ancestorIds(this.index, parentId).includes(id))) {
      return "a group cannot sit inside itself";
    }
    return undefined;
  }

  // A deleted record can no longer be anyone's grant, invite or public link.
  private cleanUpSubject(id: string): void {
    const removed = [
      this.db.prepare("DELETE FROM grants WHERE owner = ? AND subject_id = ?").run(this.owner, id),
      this.db.prepare("DELETE FROM public_links WHERE owner = ? AND subject_id = ?").run(this.owner, id),
      this.db.prepare("DELETE FROM invites WHERE owner = ? AND subject_id = ? AND redeemed_at IS NULL").run(this.owner, id),
    ].reduce((sum, result) => sum + Number(result.changes), 0);
    if (removed > 0) this.subjectsRemoved = true;
  }
}
