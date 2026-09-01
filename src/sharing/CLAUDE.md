# src/sharing — publish/subscribe sync

The first backend in this project's history. Full rationale and the Phase 0
decisions live in `plans/sharing-feature-design.md`; this file is what you need
to work in here.

Phase 1 is invite + read-only sharing. Phases 1b (opt-in full sync), 2 (invite
chaining), 3 (live co-editing) and 4 (public profile via QR) are not built.

## The shape of it

- `hlc.ts` — hybrid logical clock. Serialised fixed-width so string comparison
  *is* the total order.
- `records.ts` — the wire format. One flat `SyncRecord` for every entity, now
  four kinds (`group`, `row`, `entry`, `event`).
- `lww.ts` — last-writer-wins merge with tombstones.
- `diff.ts` — current shareable subset vs. last-pushed snapshot → what to send.
- `backend.ts` — the interface. Nothing above it knows about Supabase.
- `fakeBackend.ts` — in-process server used by the tests.
- `supabaseBackend.ts` — the real adapter.
- `mirror.ts` — other people's records → namespaced read-only datasets.
- `sync.ts` — the runtime: when things push and pull.

The privacy gate itself is **not** here: it is `src/model/sharing.ts`
(`syncSubset`), because it is pure data logic and belongs with the model.

An **event's access control is its row's**, exactly like an entry's: it carries
`shared: false` on the wire and nothing ever asks. Publishing a timeline
publishes its moments, and `describePublishImpact` says so before the switch is
flipped.

Outside `src/`: `supabase/migrations/` (the SQL), `supabase/tests/` (the RLS
assertions plus a shim standing in for a Supabase project), `supabase/README.md`
(setup), and `scripts/setup-supabase.sh` / `scripts/verify-sql.sh`.

## Invariants

- **`syncSubset` is the only way data leaves the device.** Every push goes
  through it. It fails closed, and it strips references pointing outside the
  subset — a published entry whose `parentEntryId` points at one on a private
  row loses that reference rather than pointing at something the viewer must
  not see.
- **Mirrors never enter `state.dataset`.** They are a sibling of
  `publicDatasets`, namespaced `shared:<accountId>:`, stored under their own
  IndexedDB key. This is what keeps exports clean (`triggerDownload` serialises
  `state.dataset`) and makes revocation a delete of one object. Do not
  "simplify" this by merging mirrors into the dataset.
- **The snapshot advances only after a successful push.** Advancing it first
  marks a change as sent and never retries it — and the change that must never
  be silently dropped is an un-publish.
- **Tombstones stay server-side.** Readers re-pull the whole visible set, so
  absence is the delete. Shipping "this used to exist" tells someone that
  something was withdrawn, which is itself a leak.
- **The SDK is lazy-imported and missing config is a supported state.** A
  signed-out user must download no websocket client, and a fresh clone with no
  Supabase project must behave exactly as Chronicle did before sharing existed.
  Verified: with the env vars set the SDK is a separate 223 kB chunk; without
  them it is absent from the build entirely.
- **The dataset never learns anyone's email.** Grants, co-owners and invites are
  server-side only. `accountId` is an opaque uuid. The dataset is the thing users
  export and pass around.

## The SQL is the real access control

`supabase/migrations/0001_sharing.sql` plus `0002_events.sql` are the
enforcement — 0002 widens the `kind` constraint and adds the `event` branch to
`can_write_record` and to `records_readable`. It is a separate file rather than
an edit to 0001 because 0001 has been applied to real databases, where
`create table if not exists` would silently leave the old constraint in place.

`fakeBackend.ts` re-implements the same visibility rule in TypeScript so the tests can exercise
the full cycle in-process — **the two are meant to be read side by side, and
changing one means changing the other.** The client-side rule is a test double,
never a security boundary.

`npm run verify:sql` is what holds the SQL side up: it applies the migrations to
a real Postgres and runs `supabase/tests/rls.test.sql`, the family scenario
asserted with RLS on and the identity switched per statement the way PostgREST
switches it per request. CI runs it on every pull request. Setup:
`supabase/README.md`.

That run is not ceremony — the first one found three real bugs in SQL that had
only ever been read:

- `encode(…, 'base64url')` as the invite token default. Postgres has no such
  encoding, and a column default is not evaluated until the first insert, so it
  would have failed at invite time rather than at migration time.
- `records_coowner_write` was one `for all` policy. A `for all` policy is also a
  SELECT policy, and permissive policies are OR-ed, so its laxer condition
  re-admitted rows `records_readable` had filtered out: **tombstones leaked to
  readers**. Now three write-only policies.
- That same policy's entry branch asked `can_read_row`, which a plain grant
  satisfies — so a **read-only grant carried write access to every entry** on a
  shared timeline. Writes now go through `can_write_record`, which asks about
  co-ownership of the group and nothing else.

## Not yet done

- **No manual two-account check against a hosted project.** The policies are
  asserted against real Postgres, but nothing has driven two real browsers
  through a magic-link sign-in on a live Supabase project. That is the last
  untested seam: PostgREST's request shape and Supabase's auth, not the rules.
- **No write-back path for a mirror.** Co-ownership is granted server-side and
  the policies accept the write, but a co-owned mirror is still read-only in the
  client — `isForeignId` blocks the edit and nothing routes it back. The UI says
  so rather than promising editing it cannot do.
- **No E2EE.** The structural/`payload` column split exists so it stays a later
  option (§D3), but published data is readable by the server today, and the UI
  says so.
- **Concurrent free-text edits lose keystrokes.** Record-level LWW means two
  people typing into one `description` at the same time is last-writer-wins.
  Phase 3 mitigates with presence, not with a CRDT for one field.
- **Mirror collapse state is in-memory** and is lost on the next pull — the same
  known gap public data has.
- **Magic-link delivery needs SMTP configured.** Supabase's built-in sender is
  rate-limited and dev-only — see `supabase/README.md`. Locally, `supabase start`
  catches the mail instead, so the invite cycle can be driven without a sender.
