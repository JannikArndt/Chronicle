// An in-process stand-in for the Supabase backend, used by the tests.
//
// It is not a mock that returns canned answers: it re-implements the visibility
// rule from `supabase/migrations/0001_sharing.sql` in TypeScript, so the
// invite → publish → propagate → revoke cycle can be exercised end to end
// without a live project. When the SQL policy changes, this changes with it —
// the two are meant to be read side by side.

import { keyOf } from "./records";
import type { Grant, InviteDraft, MirrorSnapshot, SharingBackend, SharingSession } from "./backend";
import type { SyncRecord } from "./records";

interface StoredInvite extends InviteDraft {
  token: string;
  createdBy: string;
}

export class FakeServer {
  // Keyed by owner, then record — one owner's `row:r1` is not another's.
  private readonly records = new Map<string, SyncRecord>();
  private readonly accounts = new Map<string, { email: string; name: string }>();
  private readonly grants: (Grant & { ownerAccountId: string })[] = [];
  private readonly coOwners = new Set<string>(); // `${groupOwnerId}:${groupId}:${accountId}`
  private readonly invites = new Map<string, StoredInvite>();
  private readonly listeners = new Set<() => void>();
  private nextId = 1;

  account(email: string, name: string): string {
    const accountId = `acct-${this.nextId++}`;
    this.accounts.set(accountId, { email, name });
    return accountId;
  }

  client(accountId: string): SharingBackend {
    return new FakeBackend(this, accountId);
  }

  private notify(): void {
    this.listeners.forEach((listener) => listener());
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  write(records: SyncRecord[]): void {
    for (const record of records) this.records.set(`${record.ownerAccountId}/${keyOf(record)}`, record);
    if (records.length > 0) this.notify();
  }

  addInvite(invite: StoredInvite): void {
    this.invites.set(invite.token, invite);
  }

  takeInvite(token: string): StoredInvite | undefined {
    return this.invites.get(token);
  }

  accountName(accountId: string): string {
    return this.accounts.get(accountId)?.name ?? "Someone";
  }

  addGrant(grant: Grant & { ownerAccountId: string }): void {
    this.grants.push(grant);
    this.notify();
  }

  addCoOwner(ownerAccountId: string, groupId: string, accountId: string): void {
    this.coOwners.add(`${ownerAccountId}:${groupId}:${accountId}`);
    this.notify();
  }

  grantsBy(ownerAccountId: string): Grant[] {
    return this.grants.filter((grant) => grant.ownerAccountId === ownerAccountId);
  }

  revoke(grantId: string, byAccountId: string): void {
    const index = this.grants.findIndex((grant) => grant.id === grantId && grant.ownerAccountId === byAccountId);
    if (index >= 0) this.grants.splice(index, 1);
    this.notify();
  }

  newId(prefix: string): string {
    return `${prefix}-${this.nextId++}`;
  }

  // The visibility rule, mirroring the SQL policy.
  visibleTo(viewer: string): MirrorSnapshot[] {
    const byOwner = new Map<string, SyncRecord[]>();
    for (const record of this.records.values()) {
      if (record.ownerAccountId === viewer) continue; // your own data is not a mirror
      // Tombstones stay server-side. They exist to order deletes against
      // concurrent edits between the owner's own devices; a reader re-pulls the
      // whole visible set, so for them the absence of a record IS the delete —
      // and shipping "this used to exist" tells them something was withdrawn.
      if (record.deleted) continue;
      const list = byOwner.get(record.ownerAccountId) ?? [];
      list.push(record);
      byOwner.set(record.ownerAccountId, list);
    }

    const snapshots: MirrorSnapshot[] = [];
    for (const [ownerAccountId, all] of byOwner) {
      const visible = this.filterVisible(all, ownerAccountId, viewer);
      if (visible.length === 0) continue;
      const isCoOwner = [...this.coOwners].some((key) => key.startsWith(`${ownerAccountId}:`) && key.endsWith(`:${viewer}`));
      snapshots.push({
        ownerAccountId,
        ownerName: this.accountName(ownerAccountId),
        role: isCoOwner ? "owner" : "reader",
        records: visible,
      });
    }
    return snapshots;
  }

  private filterVisible(all: SyncRecord[], ownerAccountId: string, viewer: string): SyncRecord[] {
    const groups = new Map(all.filter((record) => record.kind === "group").map((record) => [record.id, record]));
    const covered = (subjectKind: "group" | "row", subjectId: string): boolean =>
      this.grants.some(
        (grant) =>
          grant.ownerAccountId === ownerAccountId &&
          grant.granteeAccountId === viewer &&
          grant.subjectKind === subjectKind &&
          grant.subjectId === subjectId,
      );

    const ancestorsOf = (groupId: string | undefined): string[] => {
      const chain: string[] = [];
      let current = groupId === undefined ? undefined : groups.get(groupId);
      while (current !== undefined && !chain.includes(current.id)) {
        chain.push(current.id);
        current = current.parentId === undefined ? undefined : groups.get(current.parentId);
      }
      return chain;
    };

    const ownsGroup = (groupId: string | undefined): boolean =>
      groupId !== undefined && this.coOwners.has(`${ownerAccountId}:${groupId}:${viewer}`);

    const grantCoversGroupChain = (groupId: string | undefined): boolean =>
      ancestorsOf(groupId).some((id) => covered("group", id) || ownsGroup(id));

    // A row is visible when it is published AND the viewer holds a grant on it,
    // on its group, or on one of that group's ancestors. Co-ownership of the
    // group is the other way in.
    const visibleRows = all.filter(
      (record) =>
        record.kind === "row" &&
        (record.shared || ownsGroup(record.parentId)) &&
        (covered("row", record.id) || grantCoversGroupChain(record.parentId)),
    );
    const visibleRowIds = new Set(visibleRows.map((record) => record.id));

    // A group is visible when it is published in its own right and granted, or
    // when it is the container (or an ancestor container) of a visible row. The
    // second clause is what stops a shared row arriving with no lane to sit on.
    const containerGroupIds = new Set(visibleRows.flatMap((row) => ancestorsOf(row.parentId)));
    const visibleGroups = all.filter(
      (record) =>
        record.kind === "group" &&
        (containerGroupIds.has(record.id) ||
          ownsGroup(record.id) ||
          (record.shared && (covered("group", record.id) || grantCoversGroupChain(record.parentId)))),
    );

    // Entries and events are the same question asked twice: neither carries a
    // flag, both are visible exactly when their row is.
    const visibleOnRows = all.filter(
      (record) =>
        (record.kind === "entry" || record.kind === "event") &&
        record.parentId !== undefined &&
        visibleRowIds.has(record.parentId),
    );

    return [...visibleGroups, ...visibleRows, ...visibleOnRows];
  }
}

class FakeBackend implements SharingBackend {
  constructor(
    private readonly server: FakeServer,
    private readonly accountId: string,
  ) {}

  currentSession(): Promise<SharingSession | null> {
    return Promise.resolve({ accountId: this.accountId, email: `${this.accountId}@example.test` });
  }

  requestMagicLink(): Promise<void> {
    return Promise.resolve();
  }

  signOut(): Promise<void> {
    return Promise.resolve();
  }

  push(records: SyncRecord[]): Promise<void> {
    this.server.write(records.map((record) => ({ ...record, ownerAccountId: this.accountId })));
    return Promise.resolve();
  }

  pullVisible(): Promise<MirrorSnapshot[]> {
    return Promise.resolve(this.server.visibleTo(this.accountId));
  }

  subscribe(onChange: () => void): () => void {
    return this.server.onChange(onChange);
  }

  createInvite(draft: InviteDraft): Promise<string> {
    const token = this.server.newId("invite");
    this.server.addInvite({ ...draft, token, createdBy: this.accountId });
    return Promise.resolve(token);
  }

  redeemInvite(token: string): Promise<void> {
    const invite = this.server.takeInvite(token);
    if (invite === undefined) return Promise.reject(new Error("This invite link is not valid."));
    if (invite.role === "owner" && invite.subjectKind === "group") {
      this.server.addCoOwner(invite.createdBy, invite.subjectId, this.accountId);
      return Promise.resolve();
    }
    this.server.addGrant({
      id: this.server.newId("grant"),
      ownerAccountId: invite.createdBy,
      subjectKind: invite.subjectKind,
      subjectId: invite.subjectId,
      granteeAccountId: this.accountId,
      granteeName: this.server.accountName(this.accountId),
    });
    return Promise.resolve();
  }

  listGrants(): Promise<Grant[]> {
    return Promise.resolve(this.server.grantsBy(this.accountId));
  }

  revokeGrant(grantId: string): Promise<void> {
    this.server.revoke(grantId, this.accountId);
    return Promise.resolve();
  }
}
