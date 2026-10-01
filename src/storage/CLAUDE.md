# src/storage — IndexedDB and export/import

IndexedDB (db `chronicle`, store `datasets`, key `main`) and export/import.

`exportImport.ts` accepts exactly `SCHEMA_VERSION` and rejects anything else —
another version, a missing `groups`/`rows`/`entries`/`events` array, a
malformed entry or event — with an explicit error, never a silent migration.
There is no upgrade path from older versions; the only data that predated v11
was converted once, by hand. The `?? []` fallbacks for `events` in
`mergeDatasets` and `namespaceWithPrefix` stay: they read untyped
`public-data/` JSON, which never went through this importer.

**`loadDataset()` runs the same check** on whatever IndexedDB holds, and drops
what fails it. So a schema bump must bring its upgrade step in
`validateImport` with it — otherwise the bump silently wipes the one copy of a
signed-out device's data.

`triggerImportFlow()` is the shared file-picker → parse → callback helper used
by both the top-bar Data menu and the rail's "+ Import".

Three keys: `main` (a signed-out device's own dataset), `overlays` (public-data
picks and view preferences) and `sync` (a signed-in device's replica of its
account — `src/sync/replica.ts` — plus the account and names). First sign-in
adopts `main` into the account and clears it; signing out deletes `sync` and
`main` both, so nothing — yours or anyone else's — stays on a device nobody is
signed in to.

Tests import `fake-indexeddb/auto`.
