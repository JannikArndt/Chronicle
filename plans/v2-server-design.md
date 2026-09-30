# Chronicle v2 — its own server

Status: **built** (this branch). Supersedes the Supabase-based phase 1 in
`plans/sharing-feature-design.md`, which is kept for its history and its
reasoning about privacy, most of which still holds.

## 0. The one-paragraph version

Chronicle now runs on its own server at `https://chronicle.timpanini.com`: one
Node process on CapRover that serves the app, stores accounts and records in
SQLite, and streams changes to every open tab. Signed out, the app is exactly
what it was — local-first, IndexedDB only, no network. Signed in, **your whole
dataset syncs to your account** (every device you sign in on gets it), and
what other people see is decided on the server by grants: a person can be
given *view* or *edit* access to one timeline, one group, or everything you
have published. Editors change your records in place, live; viewers see what
you publish, live. People connect through invite links, and a connection of a
connection shows up as a suggestion, never as access.

## 1. What changed from v1 and why

| | v1 (Supabase) | v2 (own server) |
|---|---|---|
| Hosting | GitHub Pages + optional Supabase | CapRover app, one container |
| Auth | Magic link (needed SMTP) | Handle + passkey and/or password (no mail server needed) |
| What is uploaded | only published timelines | everything, once you sign in |
| Other people's data | read-only mirrors, `shared:<owner>:` ids | the same records, in the same dataset, with an access level |
| Co-ownership | granted, but no write-back path | editors write in place, live |
| Conflicts | record-level LWW | **field-level** LWW (two people editing one entry keep both edits) |
| Live updates | full re-pull on every change | per-record deltas over an event stream |
| Access control | Postgres RLS, re-implemented in TS for tests | one TS function, tested directly (`server/access.ts`) |

**Uploading everything** is the one deliberate reversal of a v1 promise. The
owner asked for a server; an account that silently did not hold most of your
data was the least useful kind of account ("signing in is not a backup" was a
warning the UI had to carry). The promise now is: *your records are stored on
the server; nobody but you can read one unless you grant access to it, and a
viewer only ever sees what you have published.* The sign-in form says it.

## 2. The server

`server/` — TypeScript bundled by esbuild into `dist-server/main.mjs`, no
`node_modules` at runtime: `node:http`, `node:sqlite`, `node:crypto`,
`node:zlib`, and `@simplewebauthn/server` bundled into the same file.

- **Storage**: SQLite in `$DATA_DIR/chronicle.db` (WAL). `DATA_DIR` must be a
  CapRover persistent directory, or every deploy starts from an empty database.
- **Auth** (`auth.ts`): handle + password (scrypt), sessions are random
  256-bit tokens in an `HttpOnly; SameSite=Lax; Secure` cookie, stored hashed.
  Every non-GET API call must carry `X-Chronicle: 1`, which a cross-site form
  cannot send and a cross-site `fetch` cannot send without a CORS preflight
  this server never grants. Sign-in and sign-up are rate-limited per address.
- **Passkeys** (`passkeys.ts`): WebAuthn, discoverable credentials with user
  verification required, so signing in needs no handle. An account can be
  created with a passkey alone (no password), and has a passkey, a password,
  or both — never neither. Adding a passkey, setting the password, removing a
  passkey and deleting the account need a proof from the last 10 minutes (the
  sign-in itself, or "confirm it's you" with either); otherwise the server
  answers `403 confirm-identity`. The relying party is the request's own host
  (or `PUBLIC_ORIGIN`).
- **Records** (`records.ts`): one table, keyed by a globally unique id. Every
  field carries its own hybrid-logical-clock stamp; a write sets a field only
  if its stamp is newer. A delete is a permanent tombstone.
- **Validation** (`validate.ts`): every record is checked against its kind's
  schema after merging. Shared records are rendered on other people's
  screens, so a malformed one must not be able to crash someone else's app.
- **Access** (`access.ts`): pure. Given one owner's records and the grants that
  owner has given one viewer, which records can that viewer read, and which
  can they edit. Used for pulls, for deltas, and to authorise writes.
- **Live** (`hub.ts`): Server-Sent Events rather than WebSockets — they pass
  through CapRover's nginx with no "WebSocket support" switch to forget, and
  the client→server direction is ordinary POSTs anyway.
- **Social** (`social.ts`): invites, grants, connections, requests,
  suggestions, public links.

## 3. Access model

A **grant** is `(owner, subject, grantee, role)`. Subject is a group, a row
(timeline), or `all` (everything of the owner's). Role is `viewer` or `editor`.

- **Owner**: everything.
- **Editor** of a subject: every record in its subtree, published or not, read
  and write — including creating records under it. The subject itself cannot
  be deleted or moved by an editor (it would leave the subtree it was granted
  on). Records an editor creates belong to the *owner of the tree*: an entry
  Dad adds to "Dad" in my tree is my record, written by him.
- **Viewer** of a subject: the subject itself, every row in its subtree that is
  `shared` (a direct grant on a row is its own publication), their entries and
  events, groups that are `shared`, and the groups on the path down to any of
  those so the tree is connected. Nothing above the subject: granting "Dad"
  does not reveal the name of the "Family" group it sits in.
- Editor beats viewer when two grants overlap.

Publishing (`shared`, `shareByDefault`) keeps its v1 meaning: it is what a
*viewer* sees. There is still one audience per owner — per-person hold-backs
remain out of scope.

## 4. Sync protocol

Records on the wire are the model entities minus their id, as flat `fields`.
The parent key stays in the fields (`parentGroupId`, `groupId`, `rowId`) and
the server reads it for access decisions.

- `GET /api/pull` — every record visible to me, with `owner` and `access`
  (`own` / `edit` / `read`).
- `POST /api/push` — per-record field changes, each field with its clock.
  The response is the resolved server state of every record in the batch.
- `GET /api/events` — the event stream: `hello` (with the server's build id),
  `records` (changed or newly visible), `gone` (deleted or no longer
  visible), `peers` (presence), `social` (people/grants changed).

**How the server decides who hears about a push**: for each account currently
connected that could be affected (the owner and everyone the owner has granted
anything to), it computes that account's access to the owner's records before
and after the write, and sends the difference. That one rule covers content
edits, publishing and un-publishing, moves in and out of a shared group, and
revocation, with no special cases.

**The client** (`src/sync/`) keeps a replica: `base` (the server's last word on
every record I can see) and `pending` (my field changes the server has not
acknowledged). The dataset on screen is `base ⊕ pending`. The ~25 actions in
`state/actions.ts` still just edit `state.dataset`; after each one, the sync
engine diffs the dataset against the last view and turns every changed field
into a pending change. That is the same "notice rather than be told" design as
v1, now running in both directions.

## 5. People

- **Invite link** — to connect, optionally with a grant (view or edit a group,
  a timeline, or everything). Single use, 30 days. The token lives in the URL
  fragment so it never reaches a server log.
- **Connections** — mutual; made by redeeming an invite, or by accepting a
  request. You can share with a connection directly, no new link needed.
- **Suggestions** — connections of your connections ("Anna, via Dad"). A
  suggestion lets you send a request; it never grants anything.
- **Public link** — read-only view of one subject for anyone holding the link,
  no account (`#/view/<token>`). Viewer rules apply: only published things.
- **Presence** — while a person has an entry, event or timeline open, the
  others who can see it get a "Dad is here" chip on it.

## 6. Deliberately not built

- Any account recovery — a forgotten password cannot be reset (there is no
  email on file, by design). A passkey synced by the person's own password
  manager, or a second signed-in device, is the backup; exporting still works.
- End-to-end encryption. The server reads what it stores, and the UI says so.
- Per-person hold-backs, invite chaining that grants access, discovery.
- Character-level merging of one text field typed by two people at once: the
  later keystroke wins that field, the presence chip is the mitigation.
