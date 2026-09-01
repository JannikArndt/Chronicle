# src/state — the store

Hand-rolled observable store (`useSyncExternalStore`), all mutations in
`actions.ts` with a 250ms debounced IndexedDB autosave. That same debounced save
is what drives the sharing push: the sync layer diffs the shareable subset
against what it last sent rather than being told which record changed, which is
why none of the mutations here carry a sync call. Entries created by
direct manipulation are drafts (`state.draft`) and only enter the dataset once
titled; `addEntry()` is the other path, for an assistant that asks everything
first and writes once.

**Events have no draft state.** A draft exists because dragging out a bar puts
something on screen before it has a name; an event is created from a form that
already knows its title and its date, so `addEvent()` writes once and there is
nothing half-made to hold. Don't add one "for symmetry".

## Invariants

- **One selection at a time, and they are separate fields.**
  `selectedEntryId` and `selectedEventId` clear each other (and the row) in
  every selection action. One shared "selected id" would leave every consumer
  guessing which array to look in, and the two are edited by different panels.
  `selectedRowClickMs` rides along with the row selection for one purpose: the
  add-event form opens on the instant that was clicked.
- **`computeEmphasis` and `computeEventEmphasis` are two passes, not one set.**
  An event has one date instead of a range and no subtitle to search, the engine
  looks the two up in different loops, and an id from the wrong entity would
  silently dim nothing. The row/group half of the filter is shared
  (`rowPasses`) so a filter cannot come to mean two different things on one
  screen.
- **`setInput` must not clear `emptyRowClick`** on the state update caused by
  the very click that stored it (guard compares against
  `emptyRowClick.rowId`).
- **`state.dataset` means "my data" and nothing else.** Public datasets and
  mirrors of other people's shared timelines are siblings, merged only for
  display by `mergedDataset()`. Every privacy guarantee in the project is stated
  in terms of that object — an export is literally `state.dataset` — so nothing
  foreign may be merged into it. Use `isForeignId` (public **or** mirrored) for
  read-only checks in the UI, not `isPublicId`.
