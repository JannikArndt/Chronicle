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

`OnboardingAssistant` is the first-run assistant (design and decisions:
`plans/onboarding-questionnaire.md`, clickable reference
`plans/onboarding-prototype.html`): your name, then one topic per screen in the
same order at every age — born → lived → learned → worked → partner → kids →
grandkids (only with kids) — ending on the canvas framed from birth to now.
Every screen after the birth one carries `OnboardingPreview`, a live drawing of
everything answered so far; there is no separate reveal screen. The parts:

- `birthYear.ts` — the birth screen's arithmetic. The slider is the *year* age
  (this year − birth year); an optional month says whether the birthday is still
  to come. `AgeFigure` paints `figurePose.ts` (pure: baby, child proportions,
  greying, glasses, stoop, cane) in the `--color-figure-*` tokens.
- `sequence.ts` — the model behind `SequenceEditor` (Strip + List), shared by
  the four "one thing after another" screens: items with a start age (`at`),
  each lasting until the next starts, plus an optional `end`. `lifeTopics.ts`
  holds each topic's row, colour, rules (places start at birth and never end),
  add chips and copy.
- `sequenceRecords.ts` and `familyRecords.ts` — load a draft from the saved
  records and plan the reconcile back; `firstRunRecords.ts` finds the records
  (self group by `selfGroupId`, topic rows by label inside it, "Family" by label
  at the top level) and applies the plan through `src/state/actions.ts`
  (`applyEntryChanges` writes one screen as one change).
- `previewLayout.ts` — what the preview draws where (lanes thin out before it
  scrolls). `FamilyEditors.tsx` — the kids and grandkids rows.

`PlaceAutocompleteInput`/`nominatim.ts` hit OpenStreetMap Nominatim directly
(no API key, no backend to hide one behind), request `addressdetails=1`, and
derive a short `title`/`subtitle` (street+city, or just city) plus structured
`street`/`city`/`country`/`coordinates` — the full Nominatim string is kept as
`fullName` but never shown as the entry/entity label. Selecting a suggestion
(click, or arrow-keys + Enter) fills the field with
`formatSuggestionText()` ("Street, City"), locks the debounced search for that
programmatic change, shows a brief confirmed state, then hands off to
`onAfterSelect` (or `onSubmit` if unset) after ~450ms — the Lived screen's adder
uses `onAfterSelect` to add the picked place, and passes the pick through a ref
because by then the closure that rendered the click is stale. It is the only
network call the first-run flow makes, and typing a place without picking a
suggestion is always a valid answer.

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
  `commitAndFinish`, which is what makes its Back button safe. Two exceptions.
  `AddTimelineAssistant`'s `EntryTable` is live-editable: editing a row *is* the
  correction, so writes happen as you type and the step has no Back at all (it
  creates its `TimelineRow` on entering that step, since entries need a row to
  sit on). And `OnboardingAssistant` writes each screen when you leave it with
  Next or Skip — see the reconcile invariant below.
- **The first-run assistant reconciles, which is why its Back may cross a
  commit.** Each screen edits a draft; Next (or Skip) reconciles it with the
  saved records — create what is new, update what changed, delete what was
  removed — and entering a screen loads its draft from those records, every
  item remembering the entry or group it came from. Going back to a committed
  screen therefore shows what was saved and updates it in place, and replaying
  the assistant walks the same path: nothing is ever created twice. This
  replaces the older rule that onboarding Back must never cross a commit
  boundary, and only holds because of the reconcile — a screen that appended
  instead would duplicate on every Back. Three details keep it honest: a start
  or end whose *year* did not change keeps its stored date and precision (a
  month refined on the canvas survives a replay); a draft left by Back without
  committing stays in memory, rebased if the birth year changed, so nothing
  typed is lost; and a timeline whose entries overlap or start in the same year
  is not shown in the editor at all ("edit it on the canvas") and is never
  touched. Closing the overlay (Escape) keeps every screen already left and
  drops only the draft on screen.
- **Reordering moves names, never dates.** In the strip and the list alike,
  dragging Berlin above Utrecht swaps which place fills which period; the years
  of the moves stay where they were (`moveItem`). Everything that says *what*
  an item is — name, gap flag, the entry it came from, place details — moves
  with it, so the reconcile updates Berlin's own record rather than renaming
  Utrecht's.
- **A gap holds time and creates nothing.** It is an item like any other in the
  draft — it can be dragged, reordered and removed — but the reconcile skips it:
  the item before it ends where the gap starts, and no entry is ever written for
  it (loading turns a hole between two entries back into a gap). It is what
  makes "back to university at 31" Bachelor → Gap → Master instead of an
  overlap.
- **Nothing invented is ever stored.** The app never prefills a name, place or
  job (the prototype's "Try as 20/40/63" was a demo); age only sets slider
  ranges and where a new item starts. The birth slider's starting point is not an
  answer either: Skip on an untouched birth screen writes no birth date, while
  "That's me" confirms what is shown. "No kids" / "None" only clear a fresh
  answer — once kids are saved they are removed one by one with their ✕, which
  deletes that child's group with everything in it.
- **A first-run screen loads its draft once per visit.** The draft is read when
  the phase changes (`useMemo` on the phase), not on every render: a reload per
  render mints new item keys and remounts the row under the finger mid-drag.
- **A live table never puts a dataset write inside a `setState(prev => ...)`
  updater.** React may invoke updater functions more than once (dev StrictMode
  does this deliberately to catch impure ones), which would risk writing an
  entry twice. `EntryTable`'s row array lives in a plain `useRef` (`rowsRef`),
  mutated synchronously by ordinary functions, with a `useReducer` counter
  (`forceRender`) only to trigger a re-render after the ref changes; every
  commit reads `rowsRef.current`, never a closure captured at click time. The
  first-run screens don't need this: their drafts are plain React state and
  nothing is written until a click handler commits.
- **Resume never re-creates anything.** Replaying the assistant on a dataset
  that already has `selfGroupId` must not call `completeIdentityStep` again —
  that would create a second group and "Places lived" row and orphan the first.
  `commitName` relabels the self group when there is one; every later screen
  finds its records again from the dataset (`firstRunRecords.ts`), so replay
  resumes exactly where the data is. A topic row renamed on the canvas is no
  longer found by its label, and the screen starts empty for it.
