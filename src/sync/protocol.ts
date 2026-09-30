// The wire protocol between the Chronicle client and its server — shared by
// both sides (server/ imports this file), so a field renamed on one side is a
// type error on the other. plans/v2-server-design.md §4.
//
// A record on the wire is a model entity (Group, TimelineRow, TimelineEntry,
// TimelineEvent) minus its id, as flat `fields`. The container link stays in
// the fields under its model name (`parentGroupId`, `groupId`, `rowId`) and
// the server reads it from there to decide who may see what.

export type RecordKind = "group" | "row" | "entry" | "event";

// What the requesting account may do with a record: it is theirs, they may
// edit it (an editor grant), or they may only look at it (a viewer grant).
export type Access = "own" | "edit" | "read";

export type Fields = Record<string, unknown>;

export interface WireRecord {
  id: string;
  kind: RecordKind;
  owner: string; // account id
  access: Access;
  // A tombstone: the record is gone for good. Only ever sent to someone who
  // could see the record before it went, and only as a signal to drop it.
  deleted?: boolean;
  fields: Fields;
}

// One field's new value, stamped with the hybrid logical clock of the edit
// that made it. `v: null` unsets the field (an optional one cleared).
export interface FieldChange {
  v: unknown;
  c: string;
}

export interface PushRecord {
  id: string;
  kind: RecordKind;
  // Whose tree the record lives in. For an entry added to someone else's
  // timeline this is that someone, not the writer.
  owner: string;
  fields: Record<string, FieldChange>;
  // Present on a delete: the clock of the delete. Deletes are permanent.
  deleted?: string;
}

export interface PushResult {
  id: string;
  ok: boolean;
  reason?: string;
  // The server's resolved state of the record after this push, as the pusher
  // may see it — which can differ from what was sent when someone else's
  // newer edit won a field. Absent if the pusher can no longer see it.
  record?: WireRecord;
}

export interface AccountInfo {
  id: string;
  handle: string;
  name: string;
  // Which of the account's groups is the person themselves — the dataset's
  // `selfGroupId`, kept on the account so every device agrees.
  selfGroupId?: string;
}

export interface PersonRef {
  id: string;
  name: string;
}

export interface PullResponse {
  me: AccountInfo;
  records: WireRecord[];
  // Display names of every account whose records are in `records`.
  people: PersonRef[];
}

export type SubjectKind = "all" | "group" | "row";

// What a grant, an invite or a public link is about. `all` means every record
// of the owner's, and has an empty id.
export interface Subject {
  kind: SubjectKind;
  id: string;
}

export type Role = "viewer" | "editor";

export interface GrantInfo {
  id: string;
  subject: Subject;
  role: Role;
  owner: PersonRef;
  grantee: PersonRef;
}

export interface GrantsResponse {
  given: GrantInfo[];
  received: GrantInfo[];
}

export interface Connection extends PersonRef {
  since: number;
}

export interface Suggestion extends PersonRef {
  // The connections you share with them — "via Dad".
  via: PersonRef[];
}

export interface PeopleResponse {
  connections: Connection[];
  incoming: PersonRef[]; // requests waiting for my answer
  outgoing: PersonRef[]; // my requests waiting for theirs
  suggestions: Suggestion[];
}

export interface InviteInfo {
  id: string;
  subject: Subject | null;
  role: Role | null;
  createdAt: number;
  expiresAt: number;
}

// What someone holding an invite link is shown before they accept it.
export interface InvitePreview {
  inviter: PersonRef;
  subject: { kind: SubjectKind; label: string } | null;
  role: Role | null;
}

export interface PublicLinkInfo {
  id: string;
  subject: Subject;
  createdAt: number;
}

export interface PublicView {
  owner: PersonRef;
  records: WireRecord[];
}

// Someone else (or another of my own devices) who is online right now.
// `focusId` is the entry, event or timeline they have open — present only
// when the recipient can see that record themselves.
export interface Peer {
  connectionId: string;
  accountId: string;
  name: string;
  focusId: string | null;
}

export type ServerEvent =
  | { type: "hello"; build: string; connectionId: string; accountId: string; serverTime: number }
  | { type: "records"; records: WireRecord[] }
  | { type: "gone"; ids: string[] }
  | { type: "peers"; peers: Peer[] }
  // People, grants or invites changed — refetch them.
  | { type: "social" }
  // Something happened that deltas do not describe (an account was deleted);
  // pull everything again.
  | { type: "resync" };

// Where each kind keeps its container link.
export const PARENT_KEY: Record<RecordKind, string> = {
  group: "parentGroupId",
  row: "groupId",
  entry: "rowId",
  event: "rowId",
};

// The kind a record's container must be.
export const PARENT_KIND: Record<RecordKind, RecordKind> = {
  group: "group",
  row: "group",
  entry: "row",
  event: "row",
};

// Every mutating API call carries this header. A cross-site form cannot set
// it, and a cross-site fetch cannot send it without a CORS preflight that
// this server never answers — so the session cookie alone never authorises a
// write.
export const CSRF_HEADER = "x-chronicle";

export const HANDLE_PATTERN = /^[a-z0-9][a-z0-9._-]{2,31}$/;
export const MIN_PASSWORD_LENGTH = 8;
