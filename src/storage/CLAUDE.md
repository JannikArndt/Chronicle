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

## Keys in the `datasets` store

`main` (the user's dataset), `overlays` (which public data is switched on),
and `mirrors` (other people's shared timelines — deliberately never part of
`main`, so revoking access cannot take the user's own records with it). Only
`main` is ever exported.

## Migrations

`validateImport` upgrades an older file in place and is also what `loadDataset`
runs on whatever IndexedDB is holding. v10 is `assignSiblingOrder`: it numbers
each container's children through `normalizeChildOrder()`, which sorts
un-ordered records rows-before-groups — exactly how a pre-v10 file was drawn —
so an old export keeps the arrangement it had, and only gains the ability to
have that arrangement changed.
