# server — the Chronicle server

One Node process: serves the built client, answers the API, streams live
changes. Design and rationale: `plans/v2-server-design.md`. TypeScript,
bundled by esbuild (`scripts/build-server.mjs`) into `dist-server/main.mjs`,
**zero runtime dependencies** — `node:http`, `node:sqlite`, `node:crypto`,
`node:zlib`. Keep it that way; the Docker image carries no `node_modules`.

## Files

- `main.ts` — env → `createApp` → listen. SIGTERM closes streams cleanly.
- `app.ts` — every route, the CSRF check, the HTTPS-only sign-in rule.
- `db.ts` — SQLite schema (`CREATE TABLE IF NOT EXISTS`), `transaction()`.
- `auth.ts` — scrypt passwords, hashed session tokens, rate limits.
- `records.ts` — the record store and `PushApplier` (merge, authorise, validate).
- `access.ts` — **the privacy boundary**, pure: who may read/edit what.
- `validate.ts` — per-kind field schemas.
- `sync.ts` — pull, push, and `whileWatching` (the one broadcast rule).
- `hub.ts` — SSE connections and presence.
- `social.ts` — invites, connections, suggestions, grants, public links,
  account deletion.
- `static.ts` — dist/ with caching rules, the CSP, the build-id stamp.
- `buildid.mjs` — hash of every shipped file; `/version` and the deploy
  workflow's live check both use it. Plain JS so CI runs it without a build.
- `testkit.ts` — a real server on port 0 + a cookie-keeping client with an
  SSE reader. Every server test goes through HTTP with it.

## Invariants

- **`computeAccess` is the only answer to "who may see this".** Pulls, live
  deltas, presence and write authorisation all call it. It fails closed. A
  change to it is a security change — extend `access.test.ts` first.
- **Broadcasts are before/after comparisons, never special cases.**
  `SyncService.whileWatching(owner, change)` computes every connected
  affected account's access before and after `change` and sends the
  difference. Anything that can change visibility — a push, a grant, a
  revocation, a disconnect, a deletion — runs inside it. Adding a new kind
  of change means wrapping it, not writing a new notification path.
- **Records never change owner and trees never mix.** A record's parent must
  belong to the same owner (`checkStructure`); an editor's writes stay inside
  the granted subtree and cannot move or delete the granted subject itself.
- **Every field merges on its own clock; a tombstone is permanent.** A write
  only replaces a field whose stamp is older; a deleted record ignores all
  later writes. Clocks more than 5 minutes ahead of the server are refused.
- **A shared record is validated before it is stored** (`validate.ts`) — it is
  rendered on other people's screens.
- **Capability tokens are hashed at rest and never travel in a URL path.**
  Invite and public-link tokens arrive in request bodies (paths end up in
  proxy access logs); session tokens live in an HttpOnly cookie.
- **Every non-GET `/api` request needs `X-Chronicle: 1`** — the CSRF guard.
- **Behind the proxy (`TRUST_PROXY=true`), sign-in refuses plain HTTP.**
- **`node:sqlite` is loaded via `createRequire`**, not `import`: Vitest strips
  the `node:` prefix, and `sqlite` only exists with it.

## Running it

```
npm run dev:server   # esbuild --watch + restart, on :8787, data in .data/
npm run dev          # Vite on :5173, proxying /api and /version to :8787
npm test             # includes server/**/*.test.ts
```

Production env: `PORT` (80), `DATA_DIR` (`/data` — **must be a CapRover
persistent directory**), `TRUST_PROXY` (true), `STATIC_DIR` (../dist).

## Not built

- Passkeys; any password recovery (there is no email on file, on purpose).
- Incremental pulls: a reconnect pulls everything visible. Fine at family
  scale; `records` has no sequence column yet.
- Backups: the database is one SQLite file (WAL) in the persistent directory.
