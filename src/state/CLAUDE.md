# src/state — the store

Hand-rolled observable store (`useSyncExternalStore`), all mutations in
`actions.ts` behind a 250ms debounced save. Signed out, that save writes the
dataset to IndexedDB `main`; signed in, it calls the sync engine's
`datasetChanged()`, which diffs the dataset against the last view rather than
being told which record changed — which is why none of the mutations here
carry a sync call (`src/sync/CLAUDE.md`). Entries created by
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
- **`pickChain` is advanced only inside `commitPickedDate`'s single
  `setState`.** Creating an entry from the canvas queues `["end"]` behind
  `"start"` (in `startDraft`) so pointing out a span is one gesture instead of
  two arm-the-crosshair round trips; `cancelDatePicking` and `clearSelection`
  both clear the chain along with `pickingField`.
- **`computeEmphasis` and `computeEventEmphasis` are two passes, not one set.**
  An event has one date instead of a range and no subtitle to search, the engine
  looks the two up in different loops, and an id from the wrong entity would
  silently dim nothing. The row/group half of the filter is shared
  (`rowPasses`) so a filter cannot come to mean two different things on one
  screen.
- **`setInput` must not clear `emptyRowClick`** on the state update caused by
  the very click that stored it (guard compares against
  `emptyRowClick.rowId`).
- **`state.dataset` is everything you can see that is not public data** — your
  own records and, signed in, other people's records shared with you, in one
  dataset with globally unique ids. `state.sync.meta` says, per id, whose it is
  and what you may do (`own` / `edit` / `read`). Read-only checks use
  `isReadOnlyId` (public, or shared for viewing), never `isPublicId` alone —
  that would make someone's view-only timeline editable here. Anything that
  moves, copies, breaks out or deletes goes through `canRestructure` /
  `canMoveInto`: trees never mix, and a group you were invited into cannot be
  moved or deleted from your side. An export is `ownDataset(state)` — your
  own records only — and an import replaces only your own records.
- **View preferences are not data.** `hiddenRowIds`, `hiddenGroupIds` and
  `showTreeLines` live in the store and are persisted in the IndexedDB
  `overlays` record beside the public-data picks — never in `state.dataset`. An
  export is literally that dataset, and publishing a timeline must not tell
  anyone else what you have hidden or how you like the rail drawn. They do
  persist across reloads: hiding now removes a row from the picture entirely,
  and a hide that undid itself overnight would read as the app forgetting.
