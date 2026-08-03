# src/storage — IndexedDB and export/import

IndexedDB (db `chronicle`, store `datasets`, key `main`) and export/import.

`exportImport.ts` accepts any `schemaVersion` from `MIN_SUPPORTED_SCHEMA_VERSION`
through `SCHEMA_VERSION` and upgrades in place on success (two versions carry a
real data step: v5 folds each category's colour and icon onto the row, v6 folds
`people[]` into `groups[]`); it still rejects anything outside that range, or
structurally malformed, with an explicit error — never a silent migration of
actual data.

**`loadDataset()` runs the same upgrade path**: it used to drop anything whose
`schemaVersion` didn't match exactly, which turned every schema bump into a
silent wipe of the only copy of the user's data.

`triggerImportFlow()` is the shared file-picker → parse → callback helper used
by both the top-bar Data menu and the rail's "+ Import".

Tests import `fake-indexeddb/auto`.
