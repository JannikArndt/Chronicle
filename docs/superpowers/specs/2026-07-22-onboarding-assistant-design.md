# Onboarding Assistant: Identity, Birth & Places Lived

Sub-project 1 of the onboarding-assistant initiative. Later sub-projects (education,
workplaces, partners, trips, vehicles, memberships, hobbies, ...) build on the same
visual/interaction vocabulary established here but are designed and planned separately.

## Goal

A Typeform-style, low-friction conversational flow that gets a brand-new user from an
empty dataset to a populated "Places lived" timeline in under a minute: their name,
year of birth, and every place they've lived, chained end-to-end with year precision.

## A. Trigger & lifecycle

- Auto-shows when `dataset.selfPersonId === undefined && dataset.groups.length === 0`
  — a genuinely fresh dataset. Never triggers again once either condition is false,
  whether because the assistant completed or the user built something manually first.
- "Skip for now" / Esc closes the overlay at any step. Anything already committed
  (person, group, row, entries) stays as real autosaved data.
- A persistent nudge lives in the existing `.rail-footer`, visible whenever
  `selfPersonId` is unset ("Set up your timeline"), so a skipped flow can be resumed.
  This slot is the intended home for future assistants' own nudges too.

## B. Data model change

`TimelineDataset` gains `selfPersonId?: string` — the `Person` who is "you". This is
necessary because a `Group.personId` alone is ambiguous (a user may add other people's
solo groups, e.g. a partner), and future assistants need an unambiguous attachment
point for "your" timeline.

This is a schema change: `SCHEMA_VERSION` moves from 1 to 2. No migration path —
nobody has real exported data under version 1 yet, so old exports simply become
invalid on import, consistent with the project's existing "reject mismatched version"
policy (never silently migrate).

## C. Visual chrome

One shared component, `<AssistantStepShell>`: prompt text, one input area, progress
dots, Back / Next / Skip. No generic step-definition/runner abstraction — each
assistant (this one and future ones) is hand-written using the shell directly, so the
*visual and cognitive* consistency is shared without a forced data-driven framework.

- Desktop: centered card over a dimmed but still-visible canvas, so entries appear
  live behind the card as the user answers.
- Below the existing 640px breakpoint: full-screen takeover, matching the app's
  existing mobile pattern (narrow rail, translucent overlays).

## D. Step sequence

Every step has the same shape (one prompt, one input) so cognitive load stays flat:

1. **Name** — commits identity: creates a `Person` + `Group` (`asPerson: true`), sets
   `dataset.selfPersonId`, and creates a "Places lived" `TimelineRow` (creating an
   exclusive-concurrency `Category` for it if none exists yet).
2. **Birth year** — year-only input.
3. **Place** — copy is "Where were you born?" on the first iteration, "Where did you
   live next?" on subsequent ones. Backed by autocomplete (§E).
4. **Until** (year, optional) — blank means "still living here": the entry stays
   ongoing (no `end`) and the loop ends. A filled year becomes this entry's `end` and
   the implicit `start` of the next iteration, which loops back to step 3. A visible
   "That's all for now" control is always available as an alternate way to stop even
   with a filled year.

Every date field carries a small hint: "You can fine-tune the exact month or day
later." All onboarding dates are written at `precision: "year"` and remain editable
afterward through the normal `DetailPanel`, like any other entry.

## E. Place autocomplete

`src/onboarding/nominatim.ts` wraps OpenStreetMap Nominatim's `/search` endpoint:
no API key, debounced ~500ms (comfortably under the 1 req/sec usage-policy ceiling).
Free-text entry is always accepted even without picking a suggestion, or if the
request fails — the flow is never blocked by network state.

Each confirmed place becomes (or reuses, via the existing `ensureEntity`) an `Entity`
of kind `"place"`, linked to its `TimelineEntry` via `linkedEntityIds`.

## F. Data writes

Entries are constructed directly (not through the click-driven `startDraft`/canvas
flow) but still pass through `planEntryInsert` before being pushed, preserving the
existing invariant that every insert is checked. By construction, onboarding entries
are always chronological appends, so this is a defensive no-op here — never a real
conflict — but keeps the code path uniform with manual entry creation.

## G. New files

```
src/onboarding/
  AssistantStepShell.tsx            shared shell UI (prompt, input slot, progress, nav)
  useAssistantFlow.ts               step index + answers + back/next/skip (pure-ish hook)
  IdentityBirthPlacesAssistant.tsx  the concrete step sequence for this assistant
  PlaceAutocompleteInput.tsx        Nominatim-backed input + suggestion dropdown
  nominatim.ts                      fetch wrapper, debounced, no key
  shouldShowOnboarding.ts           pure trigger predicate
```

Edits: `src/model/types.ts` (schema bump + `selfPersonId`), `src/state/actions.ts`
(`completeIdentityStep`, `addOnboardingEntry`), `src/ui/App.tsx` / rail (mount point +
footer nudge), `src/ui/styles.css` (shell + mobile full-screen variant).

## H. Testing

- Unit: `useAssistantFlow` reducer (back/next/skip/answers), `shouldShowOnboarding`
  predicate, place-chaining logic (start/end construction, ongoing termination),
  schema-version bump in export/import validation.
- `nominatim.ts` tested against a mocked `fetch`.
- Manual/E2E pass for the full flow (name → birth → places → skip/resume), following
  the project's existing `window.__chronicleStore` verification convention.

## Out of scope (deliberately deferred to later sub-projects)

- Education assistant (school inference/lookup for Germany, the US, France).
- Any other future assistant (workplaces, partners, trips, vehicles, memberships,
  hobbies) and any generic assistant-definition/runner abstraction — not justified
  until a second concrete assistant exists to compare against.
