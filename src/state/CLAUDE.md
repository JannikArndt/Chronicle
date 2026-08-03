# src/state — the store

Hand-rolled observable store (`useSyncExternalStore`), all mutations in
`actions.ts` with a 250ms debounced IndexedDB autosave. That same debounced save
is what drives the sharing push: the sync layer diffs the shareable subset
against what it last sent rather than being told which record changed, which is
why none of the mutations here carry a sync call. Entries created by
direct manipulation are drafts (`state.draft`) and only enter the dataset once
titled; `addEntry()` is the other path, for an assistant that asks everything
first and writes once.

## Invariants

- **`setInput` must not clear `emptyRowClick`** on the state update caused by
  the very click that stored it (guard compares against
  `emptyRowClick.rowId`).
- **`state.dataset` means "my data" and nothing else.** Public datasets and
  mirrors of other people's shared timelines are siblings, merged only for
  display by `mergedDataset()`. Every privacy guarantee in the project is stated
  in terms of that object — an export is literally `state.dataset` — so nothing
  foreign may be merged into it. Use `isForeignId` (public **or** mirrored) for
  read-only checks in the UI, not `isPublicId`.
