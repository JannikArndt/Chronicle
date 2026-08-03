# src/onboarding — conversational onboarding and add-flows

Typeform-style conversational onboarding, auto-shown on a fresh dataset
(`shouldShowOnboarding`, gated on `dataset.selfGroupId === undefined &&
dataset.groups.length === 0`), and manually re-triggerable any time via the
rail's "+" menu → "✨ Replay setup assistant" (for testing; see the resume
invariant below on why that path resumes rather than re-creates identity).

`AssistantStepShell` is the one shared, reusable presentational piece across
assistants — deliberately no generic step-definition/runner abstraction; each
assistant is hand-written with `useAssistantFlow` (a thin wrapper over the
pure, stack-based `assistantFlowReducer`, which is what makes Back navigation
safe).

`IdentityBirthPlacesAssistant` is the first assistant: name → full birth date
(`BirthDateInput` — locale-ordered DD/MM/YYYY segment fields, auto-advancing,
defaulting to DD/MM/YYYY and only switching to MM/DD/YYYY for `en-US`, since
`Intl`-resolved locale is an unreliable signal for actual date-format
preference) → the first place lived + its year (each still its own step) →
`PlacesTable`, a single step showing every subsequent place as a
live-editable row (place field + year field), not a step-per-place wizard —
see the invariants below on why that needed a different mutation strategy
than the rest of onboarding.

`PlaceAutocompleteInput`/`nominatim.ts` hit OpenStreetMap Nominatim directly
(no API key, no backend to hide one behind), request `addressdetails=1`, and
derive a short `title`/`subtitle` (street+city, or just city) plus structured
`street`/`city`/`country`/`coordinates` — the full Nominatim string is kept as
`fullName` but never shown as the entry/entity label. Selecting a suggestion
(click, or arrow-keys + Enter) fills the field with
`formatSuggestionText()` ("Street, City"), locks the debounced search for that
programmatic change, shows a brief confirmed state, then hands off to
`onAfterSelect` (or `onSubmit` if unset) after ~450ms — the table uses
`onAfterSelect` to focus that row's year field; the two solo place/until
steps use the default (`onSubmit` advances the step), same as before
`PlacesTable` existed.

`AddTimelineAssistant` builds the flow for creating a timeline; the domain
knowledge that would prefill it (release years, "your first car was probably
at 18", lists of universities) is deliberately deferred, and belongs in
`public-data/` when it comes.

## Invariants

- **Assistants create nothing until the last step.** `AddEntryAssistant`
  builds the entry — and the row, when a new one is needed — only in
  `commitAndFinish`, which is what makes its Back button safe. The two
  exceptions are the two live-editable tables — `PlacesTable` and
  `AddTimelineAssistant`'s `EntryTable` — where editing a row *is* the
  correction, so writes happen as you type and the step has no Back at all.
  `AddTimelineAssistant` creates its `TimelineRow` on entering that step for
  the same reason: entries need a row to sit on. Both tables inherit
  `PlacesTable`'s rules verbatim (rows in a ref, mutated by plain functions;
  every commit reads `rowsRef.current`, never a captured closure) — see below
  for why either rule alone is not enough.
- **Onboarding Back must never cross a commit boundary**: this only applies to
  the `name`/`birthYear`/`place`/`until` solo steps now — `PlacesTable`
  (everything past the first place) has no Back button at all, on purpose,
  because it's live-editable: editing a row IS the correction, so there's
  nothing to navigate back through. For the remaining solo steps, re-answering
  an earlier one after Back would, for the name step, spawn a second group.
  The name step's fix is the general pattern: check whether identity was
  already committed and update in place (`updateGroup`) instead of
  re-creating.
- **`PlacesTable` never puts a dataset write inside a `setState(prev => ...)`
  updater**: React may invoke updater functions more than once (dev
  StrictMode does this deliberately to catch impure ones), which would risk
  writing an entry twice. Its row array lives in a plain `useRef` (`rowsRef`),
  mutated synchronously by ordinary functions, with a `useReducer` counter
  (`forceRender`) only to trigger a re-render after the ref changes. This
  also solves a second problem: selecting a place suggestion defers its "row
  done" commit by ~450ms (the same confirm delay used everywhere else — see
  `PlaceAutocompleteInput` above), and a closure captured at click time would
  see stale row data if the fix relied on React state directly. Reading/
  writing `rowsRef.current` is safe regardless of which render's closure
  calls it. Every row edit — including deleting a row by clearing its place
  field — recomputes and rewrites every later row's `start` from the edited
  row forward (`reflowFrom`), since row N's start is never stored, only ever
  derived from row N-1's saved `end`.
- **Onboarding resume must never re-create identity either**: the same
  duplication risk above applies on fresh mount, not just after Back —
  replaying the assistant (rail "+" menu) on a dataset that already has
  `selfGroupId` set must NOT call `completeIdentityStep` again.
  `findExistingSetup()` in `IdentityBirthPlacesAssistant.tsx` looks up the
  existing group and its "Places lived" row from `selfGroupId` and seeds
  `setup`/`name`/`birthDateMs` from it before the first render, so
  `commitName` takes its update-in-place branch immediately. Known gap:
  re-adding a first place whose dates overlap an already-recorded entry just
  creates a second, overlapping entry (rows are always concurrent) —
  acceptable for a manual testing entry point, not for the primary flow.
