// Who may see and who may change which record — plans/v2-server-design.md §3.
//
// This is the privacy boundary of the whole application: every pull, every
// live delta and every write authorisation goes through `computeAccess`. It is
// pure (records and grants in, a map out), fails closed (a record it does not
// reach is invisible), and is the most heavily tested code on the server.
//
// The rules, for one owner's records and one other person's grants on them:
//   - editor of a subject: everything in its subtree, published or not;
//   - viewer of a subject: the subject itself, the published rows in its
//     subtree with their entries and events, the published groups, and the
//     groups on the path down to any of those so the tree stays connected —
//     and nothing above the subject;
//   - edit beats read where two grants overlap.

import type { RecordKind, Role, SubjectKind } from "../src/sync/protocol";

// The structural part of a live (not deleted) record — all an access decision
// ever reads. Content never influences who may see it.
export interface StructRecord {
  id: string;
  kind: RecordKind;
  parentId: string | null;
  shared: boolean;
}

export interface AccessGrant {
  subjectKind: SubjectKind;
  subjectId: string;
  role: Role;
}

export type Level = "read" | "edit";

export interface OwnerIndex {
  byId: Map<string, StructRecord>;
  // Children by container id. `null` holds the top level: groups and rows
  // with no container, or whose container does not exist (an orphan is
  // reachable only through an `all` grant, never through a group's).
  children: Map<string | null, StructRecord[]>;
}

export function indexRecords(records: StructRecord[]): OwnerIndex {
  const byId = new Map(records.map((record) => [record.id, record]));
  const children = new Map<string | null, StructRecord[]>();
  for (const record of records) {
    let key = record.parentId;
    if (key !== null && !byId.has(key)) {
      // Entries and events never float to the top level: without their row
      // they have nothing to be drawn on, so they are simply unreachable.
      if (record.kind === "entry" || record.kind === "event") continue;
      key = null;
    }
    if (key === null && (record.kind === "entry" || record.kind === "event")) continue;
    const list = children.get(key);
    if (list === undefined) children.set(key, [record]);
    else list.push(record);
  }
  return { byId, children };
}

export function computeAccess(index: OwnerIndex, grants: AccessGrant[]): Map<string, Level> {
  const access = new Map<string, Level>();
  const markRead = (id: string): void => {
    if (!access.has(id)) access.set(id, "read");
  };

  for (const grant of grants) {
    const roots = rootsOf(index, grant);
    if (grant.role === "editor") {
      const seen = new Set<string>();
      const stack = [...roots];
      while (stack.length > 0) {
        const node = stack.pop()!;
        if (seen.has(node.id)) continue;
        seen.add(node.id);
        access.set(node.id, "edit");
        stack.push(...(index.children.get(node.id) ?? []));
      }
      continue;
    }

    // Viewer. Depth-first with the path of groups from the subject down, so
    // a published row deep inside brings exactly its own chain of containers
    // along — and never anything above the subject.
    const seen = new Set<string>();
    const visit = (node: StructRecord, path: string[], isSubject: boolean): void => {
      if (seen.has(node.id)) return;
      seen.add(node.id);
      const reveal = (): void => {
        markRead(node.id);
        path.forEach(markRead);
      };
      if (node.kind === "row") {
        // A direct grant on a timeline is its own act of publishing.
        if (isSubject || node.shared) {
          reveal();
          for (const child of index.children.get(node.id) ?? []) markRead(child.id);
        }
        return;
      }
      if (node.kind === "group") {
        if (isSubject || node.shared) reveal();
        for (const child of index.children.get(node.id) ?? []) visit(child, [...path, node.id], false);
      }
      // A grant can only name a group or a row, so an entry or event is never
      // a subject and is only ever reached through its row above.
    };
    const subjectIsRoot = grant.subjectKind !== "all";
    for (const root of roots) visit(root, [], subjectIsRoot);
  }
  return access;
}

function rootsOf(index: OwnerIndex, grant: AccessGrant): StructRecord[] {
  if (grant.subjectKind === "all") return index.children.get(null) ?? [];
  const subject = index.byId.get(grant.subjectId);
  if (subject === undefined || subject.kind !== grant.subjectKind) return [];
  return [subject];
}

// Every group on the way from `id` up to the top, nearest first — used to
// refuse a move that would put a group inside its own subtree.
export function ancestorIds(index: OwnerIndex, id: string): string[] {
  const chain: string[] = [];
  const seen = new Set<string>([id]);
  let current = index.byId.get(id)?.parentId ?? null;
  while (current !== null && !seen.has(current)) {
    seen.add(current);
    chain.push(current);
    current = index.byId.get(current)?.parentId ?? null;
  }
  return chain;
}
