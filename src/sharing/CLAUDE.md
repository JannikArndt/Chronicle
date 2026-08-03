# src/sharing — publish/subscribe sync

The first backend in this project's history. Full rationale and the Phase 0
decisions live in `plans/sharing-feature-design.md`; this file is what you need
to work in here.

Phase 1 is invite + read-only sharing. Phases 1b (opt-in full sync), 2 (invite
chaining), 3 (live co-editing) and 4 (public profile via QR) are not built.

## The shape of it

- `hlc.ts` — hybrid logical clock. Serialised fixed-width so string comparison
  *is* the total order.
- `records.ts` — the wire format. One flat `SyncRecord` for all three entities.
- `lww.ts` — last-writer-wins merge with tombstones.
- `diff.ts` — current shareable subset vs. last-pushed snapshot → what to send.
- `backend.ts` — the interface. Nothing above it knows about Supabase.
- `fakeBackend.ts` — in-process server used by the tests.
- `supabaseBackend.ts` — the real adapter.
- `mirror.ts` — other people's records → namespaced read-only datasets.
- `sync.ts` — the runtime: when things push and pull.

The privacy gate itself is **not** here: it is `src/model/sharing.ts`
(`syncSubset`), because it is pure data logic and belongs with the model.

## Invariants

- **`syncSubset` is the only way data leaves the device.** Every push goes
  through it. It fails closed, and it strips references pointing outside the
  subset — a shared sub-row under a private parent keeps a `parentRowId` to a
  row the viewer must not see unless something removes it.
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

`supabase/migrations/0001_sharing.sql` is the enforcement. `fakeBackend.ts`
re-implements the same visibility rule in TypeScript so the tests can exercise
the full cycle in-process — **the two are meant to be read side by side, and
changing one means changing the other.** The client-side rule is a test double,
never a security boundary.

Group nesting is walked exactly one level, not recursively: `addSubGroup`
refuses to nest deeper and only one level is drawn.

## Not yet done

- **The SQL has never been run against a live Postgres.** No `supabase db push`,
  no two-account manual check. Flagged in the file header too. This is the
  biggest open risk in the feature.
- **No E2EE.** The structural/`payload` column split exists so it stays a later
  option (§D3), but published data is readable by the server today, and the UI
  says so.
- **Concurrent free-text edits lose keystrokes.** Record-level LWW means two
  people typing into one `description` at the same time is last-writer-wins.
  Phase 3 mitigates with presence, not with a CRDT for one field.
- **Sign-in and invites are desktop-only.** `SharingMenu` lives in the desktop
  top bar; the mobile shell has the per-timeline publish switch in `RowPane`
  but no way to sign in or create an invite. Same category as the other mobile
  rail gaps in `src/ui/CLAUDE.md`.
- **Mirror collapse state is in-memory** and is lost on the next pull — the same
  known gap public data has.
- **Magic-link delivery needs SMTP configured.** Supabase's built-in sender is
  rate-limited and dev-only.
