// People: invites, connections, requests, suggestions, grants, public links —
// plans/v2-server-design.md §5.
//
// Two rules hold everything here together:
//   - Access is only ever granted by the owner of the data, to someone they
//     are connected to (an invite link makes the connection and the grant in
//     one step). A suggestion never grants anything.
//   - Every change to a grant runs inside `sync.whileWatching`, so the person
//     it affects sees the timelines arrive or leave the moment it happens.

import { randomUUID } from "node:crypto";
import { newToken, sha256 } from "./auth";
import { HttpError } from "./http";
import { toStruct } from "./records";
import { computeAccess, indexRecords } from "./access";
import type { Database } from "./db";
import type { Hub } from "./hub";
import type { RecordStore } from "./records";
import type { SyncService } from "./sync";
import type {
  GrantInfo,
  GrantsResponse,
  InviteInfo,
  InvitePreview,
  PeopleResponse,
  PersonRef,
  PublicLinkInfo,
  PublicView,
  Role,
  Subject,
  SubjectKind,
} from "../src/sync/protocol";

const INVITE_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

interface GrantRow {
  id: string;
  owner: string;
  subject_kind: SubjectKind;
  subject_id: string;
  grantee: string;
  role: Role;
}

interface InviteRow {
  id: string;
  owner: string;
  subject_kind: SubjectKind | null;
  subject_id: string | null;
  role: Role | null;
  created_at: number;
  expires_at: number;
  redeemed_at: number | null;
}

export function parseSubject(value: unknown): Subject {
  const subject = value as Partial<Subject> | null;
  if (subject === null || typeof subject !== "object") throw new HttpError(400, "Missing subject.");
  if (subject.kind === "all") return { kind: "all", id: "" };
  if ((subject.kind === "group" || subject.kind === "row") && typeof subject.id === "string" && subject.id !== "") {
    return { kind: subject.kind, id: subject.id };
  }
  throw new HttpError(400, "Invalid subject.");
}

export function parseRole(value: unknown): Role {
  if (value === "viewer" || value === "editor") return value;
  throw new HttpError(400, "Role must be viewer or editor.");
}

export class Social {
  constructor(
    private readonly db: Database,
    private readonly store: RecordStore,
    private readonly sync: SyncService,
    private readonly hub: Hub,
  ) {}

  // ---------- names and connections ----------

  nameOf(accountId: string): string {
    const row = this.db.prepare("SELECT name FROM accounts WHERE id = ?").get(accountId) as { name: string } | undefined;
    return row?.name ?? "Someone";
  }

  person(accountId: string): PersonRef {
    return { id: accountId, name: this.nameOf(accountId) };
  }

  connectionsOf(accountId: string): string[] {
    return (this.db.prepare("SELECT b FROM connections WHERE a = ?").all(accountId) as Array<{ b: string }>).map((row) => row.b);
  }

  isConnected(a: string, b: string): boolean {
    return this.db.prepare("SELECT 1 FROM connections WHERE a = ? AND b = ?").get(a, b) !== undefined;
  }

  private connect(a: string, b: string): void {
    if (a === b) return;
    const now = Date.now();
    const insert = this.db.prepare("INSERT OR IGNORE INTO connections (a, b, created_at) VALUES (?, ?, ?)");
    insert.run(a, b, now);
    insert.run(b, a, now);
    this.db.prepare("DELETE FROM connection_requests WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)").run(a, b, b, a);
    this.db
      .prepare("DELETE FROM dismissed_suggestions WHERE (account_id = ? AND suggested_id = ?) OR (account_id = ? AND suggested_id = ?)")
      .run(a, b, b, a);
  }

  private notify(...accounts: string[]): void {
    for (const account of new Set(accounts)) this.hub.send(account, { type: "social" });
  }

  people(accountId: string): PeopleResponse {
    const connections = this.db
      .prepare("SELECT b, created_at FROM connections WHERE a = ? ORDER BY created_at")
      .all(accountId) as Array<{ b: string; created_at: number }>;
    const connected = new Set(connections.map((row) => row.b));
    const incoming = (this.db.prepare("SELECT from_id FROM connection_requests WHERE to_id = ?").all(accountId) as Array<{
      from_id: string;
    }>).map((row) => row.from_id);
    const outgoing = (this.db.prepare("SELECT to_id FROM connection_requests WHERE from_id = ?").all(accountId) as Array<{
      to_id: string;
    }>).map((row) => row.to_id);
    const dismissed = new Set(
      (this.db.prepare("SELECT suggested_id FROM dismissed_suggestions WHERE account_id = ?").all(accountId) as Array<{
        suggested_id: string;
      }>).map((row) => row.suggested_id),
    );
    const pending = new Set([...incoming, ...outgoing]);
    return {
      connections: connections.map((row) => ({ ...this.person(row.b), since: row.created_at })),
      incoming: incoming.map((id) => this.person(id)),
      outgoing: outgoing.map((id) => this.person(id)),
      suggestions: [...this.suggestionsFor(accountId, connected)]
        .filter(([id]) => !dismissed.has(id) && !pending.has(id))
        .map(([id, via]) => ({ ...this.person(id), via: via.map((viaId) => this.person(viaId)) })),
    };
  }

  // Connections of my connections, with who links us. This is the whole of
  // "your dad added your brother": the brother redeemed dad's invite, so he is
  // one step from me, and I am offered — not given — a connection.
  private suggestionsFor(accountId: string, connected: Set<string>): Map<string, string[]> {
    const suggestions = new Map<string, string[]>();
    for (const friend of connected) {
      for (const candidate of this.connectionsOf(friend)) {
        if (candidate === accountId || connected.has(candidate)) continue;
        const via = suggestions.get(candidate);
        if (via === undefined) suggestions.set(candidate, [friend]);
        else via.push(friend);
      }
    }
    return suggestions;
  }

  // A request may only go to someone the app would suggest — a connection of
  // a connection. Anything wider would make account ids a way to reach
  // strangers, and discovery is deliberately not a feature.
  request(from: string, to: string): void {
    if (from === to) throw new HttpError(400, "That is you.");
    if (this.isConnected(from, to)) return;
    const reverse = this.db.prepare("SELECT 1 FROM connection_requests WHERE from_id = ? AND to_id = ?").get(to, from);
    if (reverse !== undefined) {
      this.connect(from, to);
      this.notify(from, to);
      this.hub.presenceChanged(from);
      return;
    }
    if (!this.suggestionsFor(from, new Set(this.connectionsOf(from))).has(to)) {
      throw new HttpError(403, "You can only ask to connect with someone you have a connection in common with.");
    }
    this.db.prepare("INSERT OR IGNORE INTO connection_requests (from_id, to_id, created_at) VALUES (?, ?, ?)").run(from, to, Date.now());
    this.notify(from, to);
  }

  accept(accountId: string, from: string): void {
    const request = this.db.prepare("SELECT 1 FROM connection_requests WHERE from_id = ? AND to_id = ?").get(from, accountId);
    if (request === undefined) throw new HttpError(404, "No such request.");
    this.connect(accountId, from);
    this.notify(accountId, from);
    this.hub.presenceChanged(accountId);
  }

  decline(accountId: string, other: string): void {
    this.db
      .prepare("DELETE FROM connection_requests WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)")
      .run(other, accountId, accountId, other);
    this.notify(accountId, other);
  }

  dismiss(accountId: string, suggested: string): void {
    if (this.db.prepare("SELECT 1 FROM accounts WHERE id = ?").get(suggested) === undefined) return;
    this.db.prepare("INSERT OR IGNORE INTO dismissed_suggestions (account_id, suggested_id) VALUES (?, ?)").run(accountId, suggested);
    this.notify(accountId);
  }

  // Disconnecting ends every grant between the two, both ways: a connection
  // is the precondition of sharing, so sharing cannot outlive it.
  disconnect(accountId: string, other: string): void {
    for (const [owner, grantee] of [
      [accountId, other],
      [other, accountId],
    ]) {
      this.sync.whileWatching(
        owner,
        () => this.db.prepare("DELETE FROM grants WHERE owner = ? AND grantee = ?").run(owner, grantee),
        { extraViewers: [grantee] },
      );
    }
    this.db.prepare("DELETE FROM connections WHERE (a = ? AND b = ?) OR (a = ? AND b = ?)").run(accountId, other, other, accountId);
    this.decline(accountId, other);
    this.notify(accountId, other);
    this.hub.presenceChanged(accountId);
    this.hub.presenceChanged(other);
  }

  // ---------- grants ----------

  private grantInfo(row: GrantRow): GrantInfo {
    return {
      id: row.id,
      subject: { kind: row.subject_kind, id: row.subject_id },
      role: row.role,
      owner: this.person(row.owner),
      grantee: this.person(row.grantee),
    };
  }

  grants(accountId: string): GrantsResponse {
    const given = this.db.prepare("SELECT * FROM grants WHERE owner = ? ORDER BY created_at").all(accountId) as unknown as GrantRow[];
    const received = this.db.prepare("SELECT * FROM grants WHERE grantee = ? ORDER BY created_at").all(accountId) as unknown as GrantRow[];
    return { given: given.map((row) => this.grantInfo(row)), received: received.map((row) => this.grantInfo(row)) };
  }

  private assertOwnSubject(owner: string, subject: Subject): void {
    if (subject.kind === "all") return;
    const record = this.store.get(subject.id);
    if (record === undefined || record.deleted || record.owner !== owner || record.kind !== subject.kind) {
      throw new HttpError(404, "You can only share your own timelines and groups.");
    }
  }

  // Grant (or change the role of) one connection's access to one subject.
  grant(owner: string, grantee: string, subject: Subject, role: Role): GrantInfo {
    if (owner === grantee) throw new HttpError(400, "You already have access to your own timelines.");
    if (!this.isConnected(owner, grantee)) throw new HttpError(403, "You can only share with people you are connected to.");
    this.assertOwnSubject(owner, subject);
    let id = "";
    this.sync.whileWatching(
      owner,
      () => {
        const existing = this.db
          .prepare("SELECT id FROM grants WHERE owner = ? AND subject_kind = ? AND subject_id = ? AND grantee = ?")
          .get(owner, subject.kind, subject.id, grantee) as { id: string } | undefined;
        if (existing !== undefined) {
          id = existing.id;
          this.db.prepare("UPDATE grants SET role = ? WHERE id = ?").run(role, id);
        } else {
          id = randomUUID();
          this.db
            .prepare(
              "INSERT INTO grants (id, owner, subject_kind, subject_id, grantee, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            )
            .run(id, owner, subject.kind, subject.id, grantee, role, Date.now());
        }
      },
      { extraViewers: [grantee] },
    );
    this.notify(owner, grantee);
    this.hub.presenceChanged(grantee);
    return this.grantInfo(this.db.prepare("SELECT * FROM grants WHERE id = ?").get(id) as unknown as GrantRow);
  }

  // The owner revokes it, or the grantee leaves it ("stop showing me this").
  revoke(accountId: string, grantId: string): void {
    const row = this.db.prepare("SELECT * FROM grants WHERE id = ?").get(grantId) as GrantRow | undefined;
    if (row === undefined || (row.owner !== accountId && row.grantee !== accountId)) throw new HttpError(404, "No such grant.");
    this.sync.whileWatching(row.owner, () => this.db.prepare("DELETE FROM grants WHERE id = ?").run(grantId), {
      extraViewers: [row.grantee],
    });
    this.notify(row.owner, row.grantee);
    this.hub.presenceChanged(row.grantee);
  }

  // ---------- invites ----------

  createInvite(owner: string, subject: Subject | null, role: Role | null): { token: string; invite: InviteInfo } {
    if (subject !== null) this.assertOwnSubject(owner, subject);
    const token = newToken();
    const id = randomUUID();
    const now = Date.now();
    this.db
      .prepare(
        "INSERT INTO invites (id, token_hash, owner, subject_kind, subject_id, role, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(id, sha256(token), owner, subject?.kind ?? null, subject?.id ?? null, subject === null ? null : role, now, now + INVITE_LIFETIME_MS);
    return { token, invite: this.inviteInfo(this.inviteRow(id)!) };
  }

  private inviteRow(id: string): InviteRow | undefined {
    return this.db.prepare("SELECT * FROM invites WHERE id = ?").get(id) as InviteRow | undefined;
  }

  private inviteInfo(row: InviteRow): InviteInfo {
    return {
      id: row.id,
      subject: row.subject_kind === null ? null : { kind: row.subject_kind, id: row.subject_id ?? "" },
      role: row.role,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    };
  }

  invites(owner: string): InviteInfo[] {
    const rows = this.db
      .prepare("SELECT * FROM invites WHERE owner = ? AND redeemed_at IS NULL AND expires_at > ? ORDER BY created_at")
      .all(owner, Date.now()) as unknown as InviteRow[];
    return rows.map((row) => this.inviteInfo(row));
  }

  cancelInvite(owner: string, id: string): void {
    this.db.prepare("DELETE FROM invites WHERE id = ? AND owner = ? AND redeemed_at IS NULL").run(id, owner);
  }

  // Deliberately silent about WHY a token does not work: "expired", "used"
  // and "never existed" look the same from outside.
  private liveInvite(token: string): InviteRow {
    const row = this.db.prepare("SELECT * FROM invites WHERE token_hash = ?").get(sha256(token)) as InviteRow | undefined;
    if (row === undefined || row.redeemed_at !== null || row.expires_at <= Date.now()) {
      throw new HttpError(404, "This invite link has expired or has already been used.");
    }
    return row;
  }

  previewInvite(token: string): InvitePreview {
    const row = this.liveInvite(token);
    let subject: InvitePreview["subject"] = null;
    if (row.subject_kind === "all") subject = { kind: "all", label: "" };
    else if (row.subject_kind !== null) {
      const record = this.store.get(row.subject_id ?? "");
      const label = record === undefined || record.deleted ? "" : String(record.fields.label ?? "");
      subject = { kind: row.subject_kind, label };
    }
    return { inviter: this.person(row.owner), subject, role: row.role };
  }

  redeemInvite(accountId: string, token: string): { inviter: PersonRef } {
    const row = this.liveInvite(token);
    if (row.owner === accountId) throw new HttpError(400, "This is your own invite — send it to someone else.");
    this.db.prepare("UPDATE invites SET redeemed_at = ?, redeemed_by = ? WHERE id = ?").run(Date.now(), accountId, row.id);
    const wasConnected = this.isConnected(row.owner, accountId);
    this.connect(row.owner, accountId);
    if (row.subject_kind !== null && row.role !== null) {
      const subject: Subject = { kind: row.subject_kind, id: row.subject_id ?? "" };
      // The subject may have been deleted since the link was made; the
      // connection still stands, there is just nothing left to share.
      const exists = subject.kind === "all" || this.store.get(subject.id)?.deleted === false;
      if (exists) this.grant(row.owner, accountId, subject, row.role);
    }
    // A new connection changes suggestions for everyone one step away.
    this.notify(row.owner, accountId, ...this.connectionsOf(row.owner), ...this.connectionsOf(accountId));
    if (!wasConnected) {
      this.hub.presenceChanged(accountId);
    }
    return { inviter: this.person(row.owner) };
  }

  // ---------- public links ----------

  createPublicLink(owner: string, subject: Subject): { token: string; link: PublicLinkInfo } {
    this.assertOwnSubject(owner, subject);
    const token = newToken();
    const id = randomUUID();
    const now = Date.now();
    this.db
      .prepare("INSERT INTO public_links (id, token_hash, owner, subject_kind, subject_id, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, sha256(token), owner, subject.kind, subject.id, now);
    return { token, link: { id, subject, createdAt: now } };
  }

  publicLinks(owner: string): PublicLinkInfo[] {
    const rows = this.db.prepare("SELECT * FROM public_links WHERE owner = ? ORDER BY created_at").all(owner) as Array<{
      id: string;
      subject_kind: SubjectKind;
      subject_id: string;
      created_at: number;
    }>;
    return rows.map((row) => ({ id: row.id, subject: { kind: row.subject_kind, id: row.subject_id }, createdAt: row.created_at }));
  }

  deletePublicLink(owner: string, id: string): void {
    this.db.prepare("DELETE FROM public_links WHERE id = ? AND owner = ?").run(id, owner);
  }

  // Anyone holding the token sees what a viewer of the subject would see —
  // published things only — and nothing else: no account, no cookie.
  publicView(token: string): PublicView {
    const row = this.db.prepare("SELECT * FROM public_links WHERE token_hash = ?").get(sha256(token)) as
      | { owner: string; subject_kind: SubjectKind; subject_id: string }
      | undefined;
    if (row === undefined) throw new HttpError(404, "This link has been switched off.");
    const records = this.store.liveRecords(row.owner);
    const access = computeAccess(indexRecords(records.map(toStruct)), [
      { subjectKind: row.subject_kind, subjectId: row.subject_id, role: "viewer" },
    ]);
    return {
      owner: this.person(row.owner),
      records: records
        .filter((record) => access.has(record.id))
        .map((record) => ({ id: record.id, kind: record.kind, owner: record.owner, access: "read", fields: record.fields })),
    };
  }

  // ---------- presence ----------

  relevantAccounts(accountId: string): Set<string> {
    return new Set(this.connectionsOf(accountId));
  }

  // ---------- account deletion ----------

  // Everything the account owns goes, and everyone who could see any of it
  // is told, in the same way a revocation would tell them.
  deleteAccount(accountId: string): void {
    const grantees = this.store.granteesOf(accountId);
    const connections = this.connectionsOf(accountId);
    this.sync.whileWatching(
      accountId,
      () => {
        this.store.deleteAllOf(accountId);
        this.db.prepare("DELETE FROM grants WHERE owner = ?").run(accountId);
      },
      { extraViewers: grantees },
    );
    // Records they wrote into other people's trees stay: they belong to the
    // owner of that tree now, exactly as they always did.
    this.db.prepare("DELETE FROM accounts WHERE id = ?").run(accountId);
    this.notify(...grantees, ...connections);
    for (const connection of connections) this.hub.presenceChanged(connection);
  }
}
