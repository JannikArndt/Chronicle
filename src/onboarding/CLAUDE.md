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

`AddEntryAssistant` is the mobile add flow: category → name → timeline → when →
how long. Its last question is what decides *what gets created*: "Still
ongoing" and "It ended" make a `TimelineEntry`, "It was a moment" makes a
`TimelineEvent`. That is the only branch in the flow — every step before it is
the same for both — and it is the last question rather than the first because
"an entry or an event?" is vocabulary, not something anyone wants to be asked.

`dateAnswer.ts` is the "when" step's data: a `DateAnswer` (year, month, day and
a **granularity**) plus the **certainty** answered beside it, folded into the
one `precision`/`fuzzDays` pair the model stores. The step used to ask for a
year and nothing else, so "exactly" could only ever mean "exactly this year".

`AddTimelineAssistant` builds the flow for creating a timeline; the domain
knowledge that would prefill it (release years, "your first car was probably
at 18", lists of universities) is deliberately deferred, and belongs in
`public-data/` when it comes.

## Invariants

- **Granularity and certainty are two questions, not one.** How much of the date
  is known (year / month / day) and how sure you are of it (exactly / around
  then / sometime around) are independent — "the 14th of May, give or take a
  week" is as real as "sometime in the nineties" — and `dateAnswer.ts` is where
  the pair is folded back into the model's single `precision`. At year
  granularity the vaguer answers become `circa`, which is what that precision
  means and what the readout says; below it the certainty rides on `fuzzDays` so
  the date keeps saying which day. Answering both with one control is what made
  "exactly" mean "exactly this year".
- **A day is always clamped to its month.** `Date.UTC(2015, 1, 30)` is the 2nd
  of March, so a 31st dragged into February must be clamped rather than allowed
  to roll — every change in `DateAnswerField` re-clamps, and `toFuzzyDate`
  clamps again on the way out.
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
