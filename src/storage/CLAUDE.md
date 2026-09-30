# src/storage — IndexedDB and export/import

IndexedDB (db `chronicle`, store `datasets`, key `main`) and export/import.

`exportImport.ts` accepts any `schemaVersion` from `MIN_SUPPORTED_SCHEMA_VERSION`
through `SCHEMA_VERSION` and upgrades in place on success (four versions carry a
real step: v5 folds each category's colour and icon onto the row, v6 folds
`people[]` into `groups[]`, v7 adds sharing, v8 adds `events[]`); it still
rejects anything outside that range, or structurally malformed, with an explicit
error — never a silent migration of actual data.

**v8 has no data to convert** — no earlier version had a concept of a moment —
so `addMissingEventsArray` only guarantees the array exists. It runs on *every*
import, not just an older one: `events` is absent from a v7 file and can be
absent from a hand-written v8 one, and every consumer reads `dataset.events`
without a `?? []`. The two places that still need that fallback are the ones
handed untyped JSON: `mergeDatasets` and `namespaceWithPrefix`, for
`public-data/` files written before the field existed.

**v1's links also go on every import.** v1/v2 kept places and people as
separate `entities`, linked from entries by `linkedEntityIds`; v3 stopped
reading both but no step ever deleted them, so a v1 record carried them through
every later bump and the app's own v11 exports still hold them. Signed in, every
field of a record goes to the server, which refuses a field it does not know —
so `foldLinkedPlaces` runs whatever the file's version: an entry's first linked
place moves onto its `place` (only `Place`'s fields; one it already has wins), a
linked person has no equivalent and goes, and both keys are deleted.

**The v7 trap.** v1–v3 wrote `visibility`/`defaultVisibility`; v4 removed them
and old exports still carry them. v7 adds a publish flag doing the same *kind*
of job, so: the new fields are named `shared`/`shareByDefault` (a name collision
is impossible, not merely avoided), `dropDeadVisibilityFields` deletes the old
keys, and an old `visibility: "public"` is **never** translated into
`shared: true`. In a backend-less app that flag meant nothing had left the
device; honouring it now would upload a timeline on the strength of a
three-versions-dead field. Everything migrates to private.

**`loadDataset()` runs the same upgrade path**: it used to drop anything whose
`schemaVersion` didn't match exactly, which turned every schema bump into a
silent wipe of the only copy of the user's data.

`triggerImportFlow()` is the shared file-picker → parse → callback helper used
by both the top-bar Data menu and the rail's "+ Import".

Three keys: `main` (a signed-out device's own dataset), `overlays` (public-data
picks and view preferences) and `sync` (a signed-in device's replica of its
account — `src/sync/replica.ts` — plus the account and names). First sign-in
adopts `main` into the account and clears it; signing out deletes `sync` and
`main` both, so nothing — yours or anyone else's — stays on a device nobody is
signed in to.

Tests import `fake-indexeddb/auto`.

## Migrations

`validateImport` upgrades an older file in place and is also what `loadDataset`
runs on whatever IndexedDB is holding. v10 is `assignSiblingOrder`: it numbers
each container's children through `normalizeChildOrder()`, which sorts
un-ordered records rows-before-groups — exactly how a pre-v10 file was drawn —
so an old export keeps the arrangement it had, and only gains the ability to
have that arrangement changed.
