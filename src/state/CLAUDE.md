# src/state — the store

Hand-rolled observable store (`useSyncExternalStore`), all mutations in
`actions.ts` with a 250ms debounced IndexedDB autosave. Entries created by
direct manipulation are drafts (`state.draft`) and only enter the dataset once
titled; `addEntry()` is the other path, for an assistant that asks everything
first and writes once.

## Invariants

- **`setInput` must not clear `emptyRowClick`** on the state update caused by
  the very click that stored it (guard compares against
  `emptyRowClick.rowId`).
