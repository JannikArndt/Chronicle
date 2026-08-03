# src/storage — IndexedDB and export/import

IndexedDB (db `chronicle`, store `datasets`, key `main`) and export/import.

`exportImport.ts` accepts any `schemaVersion` from `MIN_SUPPORTED_SCHEMA_VERSION`
through `SCHEMA_VERSION` and upgrades in place on success (three versions carry a
real step: v5 folds each category's colour and icon onto the row, v6 folds
`people[]` into `groups[]`, v7 adds sharing); it still rejects anything outside
that range, or structurally malformed, with an explicit error — never a silent
migration of actual data.

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

Three keys now: `main` (your dataset), `overlays` (public-data picks) and
`mirrors` (other people's shared timelines, cached for offline). `mirrors` is
deliberately separate from `main` — it is someone else's personal data, it must
never reach an export, and revoking has to be a delete that cannot take your own
records with it. Signing out clears it.

Tests import `fake-indexeddb/auto`.
