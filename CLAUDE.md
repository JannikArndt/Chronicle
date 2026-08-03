# Chronicle — project guide for Claude sessions

Chronicle is a personal life-timeline web app: parallel horizontal timelines on one
shared time axis. React + TypeScript + Vite, custom Canvas renderer, IndexedDB storage,
no backend, deployed to GitHub Pages at https://jannikarndt.github.io/Chronicle/.

The full product spec is `ENGINEERING_PROMPT.md` — it is the **authority on behavior**.
Where it says "resolved during the prototype", that decision is final; don't reinterpret
it. `POC/` is the throwaway discovery prototype — never reuse it as source.

## Commands

```
npm run dev       # dev server
npm test          # vitest (100+ unit tests)
npm run build     # tsc -b && vite build  (tsc also typechecks test files)
```

Deploy: push to `main` → `.github/workflows/deploy.yml` builds and publishes Pages.
The local folder is `Timeline/` but the GitHub repo is `Chronicle` → Vite `base` is
`/Chronicle/`. Don't "fix" that mismatch.

## Architecture

- `src/model/` — pure data logic, no DOM. `types.ts` (schema, `SCHEMA_VERSION`),
  `fuzzyDate.ts` (precision fuzz + fade ramps), `cascade.ts` (delete cascades).
  Every row is concurrent — entries on the same row may freely overlap, with no
  insert-time conflict check (the exclusive-row concept was removed).
  There are exactly **three** entities: `Group`, `TimelineRow` (a "timeline" in
  the UI) and `TimelineEntry`. `Person` was folded into `Group` in schema v6 —
  a group with a `birthDate` *is* a person, and a group nested via
  `parentGroupId` is what a person inside a container group used to be. Don't
  reintroduce an owner field on the row: the row's group is the whole answer to
  "whose timeline is this", which is what stops a moved timeline keeping a
  stale owner.
- `src/render/` — the canvas engine. `engine.ts` is a **framework-agnostic** class
  (keep it free of React imports); `timeScale/timeAxis/layout/bars` are pure and
  unit-tested. Both the canvas and the DOM rail render from the same
  `computeLayout()` result — that shared layout is what keeps them in sync. The
  engine reads its paint colors from the same `--color-*` CSS custom properties as
  the DOM (`readThemeColors()`, resolved via `getComputedStyle` on `:root`) and
  listens for `matchMedia('(prefers-color-scheme: dark)')` `change` events to
  re-resolve and repaint — never hardcode a second color table in `engine.ts`, it
  will drift out of sync with the DOM theme.
- `src/state/` — hand-rolled observable store (`useSyncExternalStore`), all mutations
  in `actions.ts` with a 250ms debounced IndexedDB autosave. Entries created by direct
  manipulation are drafts (`state.draft`) and only enter the dataset once titled;
  `addEntry()` is the other path, for an assistant that asks everything first and
  writes once.
- `src/publicData/` — loads `public-data/*.json` via `import.meta.glob` at build time
  and namespaces every id/reference as `pub:<file-stem>:`. Read-only, never written.
- `src/storage/` — IndexedDB (db `chronicle`, store `datasets`, key `main`) and
  export/import. `exportImport.ts` accepts any `schemaVersion` from
  `MIN_SUPPORTED_SCHEMA_VERSION` through `SCHEMA_VERSION` and upgrades in place on
  success (two versions carry a real data step: v5 folds each category's colour
  and icon onto the row, v6 folds `people[]` into `groups[]`); it still rejects
  anything outside that range, or structurally malformed, with an explicit error
  — never a silent migration of actual data. **`loadDataset()` runs the same
  upgrade path**: it used to drop anything whose `schemaVersion` didn't match
  exactly, which turned every schema bump into a silent wipe of the only copy of
  the user's data. `triggerImportFlow()` is the shared file-picker → parse → callback
  helper used by both the top-bar Data menu and the rail's "+ Import".
- `src/ui/` — React shell: rail, detail panel, popovers, search. The rail is DOM and
  is translated by the engine's `onScrollSync` callback every frame (direct style
  mutation, not React state — intentional). All colors are `--color-*` custom
  properties defined on `:root` in `styles.css` with a `@media (prefers-color-scheme:
  dark)` override block — never hardcode a hex color in a new rule; add or reuse a
  variable instead, or the dark theme silently breaks for that element.
- **Mobile is a second shell, not a restyled first one.** `App.tsx` branches once on
  `useIsMobile()` (a width media query) into `src/ui/MobileShell.tsx`, and no media
  query tries to reconcile the two — the information architecture genuinely differs
  (a timeline row *navigates* into its own settings pane on mobile, *toggles in
  place* on desktop). The shell is a full-bleed `CanvasHost` with everything else
  floating over it: `.mobile-top-stack` (chips, search panel, `MiniMap`) is measured
  with a `ResizeObserver` and its height fed to the engine as `axisTop`, so the axis
  starts *below* the floating controls instead of behind them. `BottomSheet.tsx` is
  the shared primitive (hand-rolled Pointer Events, anchors + `sheetSnap.ts` for
  velocity-aware snapping). There is exactly **one** navigational sheet:
  `TimelineSheet.tsx`, holding three panes — `TimelineListPane` (the rail's
  replacement) → `RowPane` (one timeline) → `EntryPane` (the `DetailPanel`'s
  replacement). The add flows get the *same* primitive through
  `AssistantSheet.tsx` rather than a modal overlay, so they drag, snap and flick
  away identically and the canvas stays live behind them; its scrim is invisible
  and only takes taps while the sheet is raised, where a tap parks it at peek.
  Onboarding is the one thing that still takes the whole screen
  (`.assistant-overlay`) — it is the only thing happening.
  `MiniMap.tsx` is a second canvas painting `src/render/miniMap.ts` (pure, tested) —
  one lane per row, plus the current viewport window on *both* axes; tapping or
  dragging it calls `engine.centerOnMs()` and `engine.centerOnLayoutY()`, and it
  reads the canvas's vertical position from the `EngineView` the engine reports
  through `onViewChange`. `DateRangeEditor.tsx` + `dateLaneRange.ts` are the mobile
  date editor (two handles on one lane). Desktop still uses `DateField`. Search on
  mobile is the chip itself expanding into a field (`MobileSearchChip` in
  `MobileShell.tsx`), with no filters — `SearchBar.tsx` with its filter panel is
  desktop-only now.
- `src/onboarding/` — Typeform-style conversational onboarding, auto-shown on a fresh
  dataset (`shouldShowOnboarding`, gated on `dataset.selfGroupId === undefined &&
  dataset.groups.length === 0`), and manually re-triggerable any time via the rail's
  "+" menu → "✨ Replay setup assistant" (for testing; see the invariant below on why
  that path resumes rather than re-creates identity). `AssistantStepShell` is the one
  shared, reusable presentational piece across assistants — deliberately no generic
  step-definition/runner abstraction; each assistant is hand-written with
  `useAssistantFlow` (a thin wrapper over the pure, stack-based
  `assistantFlowReducer`, which is what makes Back navigation safe).
  `IdentityBirthPlacesAssistant` is the first assistant: name → full birth date
  (`BirthDateInput` — locale-ordered DD/MM/YYYY segment fields, auto-advancing,
  defaulting to DD/MM/YYYY and only switching to MM/DD/YYYY for `en-US`, since
  `Intl`-resolved locale is an unreliable signal for actual date-format preference)
  → the first place lived + its year (each still its own step) → `PlacesTable`, a
  single step showing every subsequent place as a live-editable row (place field +
  year field), not a step-per-place wizard — see the invariant below on why that
  needed a different mutation strategy than the rest of onboarding.
  `PlaceAutocompleteInput`/`nominatim.ts` hit OpenStreetMap Nominatim directly (no
  API key, no backend to hide one behind), request `addressdetails=1`, and derive a
  short `title`/`subtitle` (street+city, or just city) plus structured
  `street`/`city`/`country`/`coordinates` — the full Nominatim string is kept as
  `fullName` but never shown as the entry/entity label. Selecting a suggestion
  (click, or arrow-keys + Enter) fills the field with `formatSuggestionText()`
  ("Street, City"), locks the debounced search for that programmatic change, shows
  a brief confirmed state, then hands off to `onAfterSelect` (or `onSubmit` if
  unset) after ~450ms — the table uses `onAfterSelect` to focus that row's year
  field; the two solo place/until steps use the default (`onSubmit` advances the
  step), same as before `PlacesTable` existed.

## Hard-won invariants (violating these reintroduces known bugs)

- **Axis paint order**: header background/border first, then tick text — repainting the
  background after text erased the axis every frame in an early build.
- **One gradient per bar**: fuzz and fade are a single `createLinearGradient` alpha
  ramp; a solid rect butted against a gradient rect shows a seam.
- **Engine listeners use `this.eventAbort.signal`** and `destroy()` aborts them —
  React StrictMode double-mounts reuse the same `<canvas>` node, and without the
  abort a zombie engine keeps handling clicks with a stale scale.
- **`setInput` must not clear `emptyRowClick`** on the state update caused by the very
  click that stored it (guard compares against `emptyRowClick.rowId`).
- Drag/wheel pan **both axes**; ctrl+wheel and two-pointer pinch zoom the time axis
  at the cursor/midpoint. `touch-action: none` on the canvas is load-bearing for iOS.
- **UTC everywhere**: every stored `ms` is a UTC instant; parsing, formatting, and
  ticks all use `Date.UTC`/`getUTC*`. Never introduce local-time methods.
- **No dropdowns under ~7 options** — use `PillSelector`. No Save/Cancel buttons —
  autosave per field change. No browse/edit mode toggle, no modal create screen.
- **Privacy**: personal data exists only in IndexedDB and user-initiated exports.
  Nothing personal may ever be written to the repo/filesystem; only `public-data/`
  is repo-tracked data.
- **Onboarding Back must never cross a commit boundary**: this only applies to the
  `name`/`birthYear`/`place`/`until` solo steps now — `PlacesTable` (everything past
  the first place) has no Back button at all, on purpose, because it's live-editable:
  editing a row IS the correction, so there's nothing to navigate back through. For
  the remaining solo steps, re-answering an earlier one after Back would, for the
  name step, spawn a second group. The name step's fix is the general
  pattern: check whether identity was already committed and update in place
  (`updateGroup`) instead of re-creating.
- **`PlacesTable` never puts a dataset write inside a `setState(prev => ...)`
  updater**: React may invoke updater functions more than once (dev StrictMode does
  this deliberately to catch impure ones), which would risk writing an entry twice.
  Its row array lives in a plain `useRef` (`rowsRef`), mutated synchronously by
  ordinary functions, with a `useReducer` counter (`forceRender`) only to trigger a
  re-render after the ref changes. This also solves a second problem: selecting a
  place suggestion defers its "row done" commit by ~450ms (the same confirm delay
  used everywhere else — see `PlaceAutocompleteInput` above), and a closure captured
  at click time would see stale row data if the fix relied on React state directly.
  Reading/writing `rowsRef.current` is safe regardless of which render's closure
  calls it. Every row edit — including deleting a row by clearing its place field —
  recomputes and rewrites every later row's `start` from the edited row forward
  (`reflowFrom`), since row N's start is never stored, only ever derived from row
  N-1's saved `end`.
- **Onboarding resume must never re-create identity either**: the same duplication
  risk above applies on fresh mount, not just after Back — replaying the assistant
  (rail "+" menu) on a dataset that already has `selfGroupId` set must NOT call
  `completeIdentityStep` again. `findExistingSetup()` in
  `IdentityBirthPlacesAssistant.tsx` looks up the existing group and its "Places
  lived" row from `selfGroupId` and seeds `setup`/`name`/`birthDateMs` from it
  before the first render, so `commitName` takes its update-in-place branch
  immediately. Known gap: re-adding a first place whose dates overlap an
  already-recorded entry just creates a second, overlapping entry (rows are
  always concurrent) — acceptable for a manual testing entry point, not for the
  primary flow.
- **CSS colors are custom properties, not literals**: `styles.css` defines
  `--color-*` on `:root` plus a `@media (prefers-color-scheme: dark)` override block;
  the canvas engine mirrors the same variables via `getComputedStyle`. A new rule
  with a hardcoded hex color renders correctly in light mode and wrong (or invisible)
  in dark mode — always reuse or extend the variable set instead.
- **A sheet's whole surface drags, so it must give clicks back**: `BottomSheet`
  treats content `pointerdown` as a *pending* drag and only calls
  `setPointerCapture` once the finger has moved past `CONTENT_DRAG_THRESHOLD_PX`
  downward *and* the list is already scrolled to the top. Capturing eagerly
  retargets the native click and every button inside the sheet goes dead;
  capturing never means the page pulls to refresh instead of the sheet moving.
  Below the top anchor the list gets `.sheet-list-locked` so a drag can't be eaten
  by an inner scroll. Anything inside a sheet that drags on its own axis —
  today only `DateRangeEditor`'s lane — marks itself `data-owns-gestures`, which
  `beginGesture` treats exactly like a text field: the sheet never starts a drag
  there. Without it a few degrees of vertical wobble promoted the sheet's pending
  drag, captured the pointer, and killed the lane's drag mid-gesture.
- **Every input on a mobile surface is ≥16px, and the rule that says so is the
  last block in `styles.css`** — iOS Safari zooms the page the moment a smaller
  field takes focus, and an autofocused one means the app *opens* zoomed. It used
  to sit mid-file and name each selector that might outrank it; that failed,
  because a media query adds no specificity and `.assistant-input-area input {
  font-size: 15px }` further down won on source order alone. Being last is the
  whole mechanism — never move it, and never "fix" a zoom with
  `maximum-scale=1`: that takes pinch-zoom away from everyone who needs it.
- **The date editor's lane range is recomputed on discrete changes only** — a typed
  date or the ongoing toggle — never mid-drag. Deriving it on render moves the lane
  under the finger on every frame. The regression it guards: switching to ongoing
  throws the end to today and used to park the end handle off-screen.
- **The minimap reads `--color-*` through the engine's own `readThemeColors()`.**
  That function and its `ColorTable` are exported for exactly this reason — there is
  no third colour table, just as there is no second one in `engine.ts`.
- **Canvas hit-testing picks the *narrowest* overlapping entry** (`EntryHit.barWidth`,
  with `TAP_SLOP_PX` of slop). Rows are concurrent, so a short bar frequently sits
  inside a long one; picking the first hit made the short one unselectable by thumb.
  A tap is also bounded in time (`TAP_MAX_DURATION_MS`) for touch and pen only — a
  mouse may legitimately rest on a target.
- **Assistants create nothing until the last step.** `AddEntryAssistant` builds the
  entry — and the row, when a new one is needed — only in `commitAndFinish`, which is
  what makes its Back button safe. The two exceptions are the two live-editable
  tables — `PlacesTable` and `AddTimelineAssistant`'s `EntryTable` — where editing a
  row *is* the correction, so writes happen as you type and the step has no Back at
  all. `AddTimelineAssistant` creates its `TimelineRow` on entering that step for the
  same reason: entries need a row to sit on. Both tables inherit `PlacesTable`'s two
  rules verbatim (rows in a ref, mutated by plain functions; every commit reads
  `rowsRef.current`, never a captured closure) — see the `PlacesTable` invariant
  above for why either one alone is not enough.
- **The mobile pane stack is derived, never stored.** `TimelineSheet` computes its
  pane from the store and from `settingsRowId`: an entry selection means the entry
  pane, otherwise an opened timeline means the row pane, otherwise the list. That is
  what lets the canvas, the list and search all select an entry through the same
  action and land in the same place. `settingsRowId` lives in `MobileShell`, above
  the sheet, because "back from an entry" leads to a *place* (its timeline) and not
  to a history — the entry may have been tapped on the canvas, having never visited
  the timeline at all.
- **"Ongoing" is a value of the end field, not a control beside it.** The model
  still stores it as *no end date*, but an earlier build put a toggle next to a
  field that also accepted "now", so two controls claimed one meaning and could
  visibly disagree. The end field reads `still ongoing`, and the only way to reach
  that state is to edit the field — type it, or tap the pill that appears while
  editing. That pill must `preventDefault` on `pointerdown`: blur fires first,
  commits, and would unmount the pill before its own click ran.

## Testing conventions

- Vitest, `environment: node`, tests co-located as `src/**/*.test.ts`. Canvas painting
  itself is not unit-tested — its math (`bars.ts`, `layout.ts`, `timeAxis.ts`,
  `miniMap.ts`) is. The mobile surfaces follow the same split: the pure parts are
  tested (`sheetSnap.ts`, `dateLaneRange.ts`, `parseDateInput.ts`,
  `entryPreviewBar.ts`, `addEntryCategories.ts`), the React components are not.
- Storage tests import `fake-indexeddb/auto`.
- `src/publicData/schemaValidation.test.ts` Ajv-validates every `public-data/*.json`
  against `public-data/schema.json`; CI runs this, so a bad contributed file fails PRs.
- E2E: drive the dev server with playwright-core against system Chrome
  (`channel: "chrome"`). `window.__chronicleEngine` (read `plusHits`/`entryHits` for
  canvas hit coordinates) and `window.__chronicleStore` are exposed exactly for this.
  A reference script lives outside the repo; entry titles are canvas text, so assert
  persistence via the store, not `getByText`.

## v1 scope cuts (deliberate — do not "fix" unasked)

- No publish/subscribe sharing; `visibility` exists on entries only to avoid a future
  migration. No Gist sync — it's a marked, honest gap (PAT flow unsolved for
  non-technical users). No keyboard-only/screen-reader path. Only one level of
  group nesting is *drawn* — the model no longer forbids more (see v6 above),
  but `computeLayout` draws a group, then its sub-groups, and stops.
- Hover-revealed rail controls on fine pointers vs always-visible on touch is an
  intentional split, not an inconsistency.

## Still open / untested

- Real-device iOS Safari gesture check (pinch vs page zoom) has never been done.
  **The mobile shell widened this gap** and now depends on it: sheet drag vs page
  scroll, `100dvh` as the URL bar collapses, `env(safe-area-inset-*)` on notched
  devices, and the keyboard covering a sheet (`visualViewport` may be needed).
  Budget a real-device pass.
- Public-data collapse state is in-memory only; private group collapse persists.
- `useIsMobile` is a width query only, not `pointer: coarse` — a narrow desktop
  window gets the mobile shell. Left that way deliberately: what actually breaks in
  a 500px desktop window is the *desktop* shell (rail + panel + canvas need width
  that isn't there), and `BottomSheet` is Pointer Events throughout, so a mouse can
  drive it. See H3 in `plans/mobile-feedback-backlog.md`.
- Rail actions still missing on mobile: "＋ Group" (a design gap, not
  an extraction one — creating a group on a phone has no designed home) and
  🌟 Famous people (still private to `RowRail.tsx`; worth extracting together with
  gating its 🐞 debug panel). 🌍 World events is done — `WorldEventsPicker.tsx`.
- `AddTimelineAssistant` builds the *flow* for creating a timeline; the domain
  knowledge that would prefill it (release years, "your first car was probably at
  18", lists of universities) is deliberately deferred, and belongs in
  `public-data/` when it comes.

## TODOs before final release (famous-people feature)

Carried over from the famous-people spike (`plans/famous-people-spike.md`). These
are intentionally shipped as-is for now but must be revisited before a real release:

- **Remove or gate the 🐞 Wikidata debug panel** (`WikidataDebugPanel` in
  `RowRail.tsx`, toggled from the picker header). It exposes raw SPARQL bindings
  and kept/dropped candidates — a developer tool, not for end users. Put it behind
  a dev flag or delete it.
- **Cache Wikidata biographies** — every add re-runs the SPARQL query; no caching.
- **Row-collapse state is in-memory** (`collapsedRowIds`) and resets on reload,
  unlike overlay selections which persist. Decide whether to persist it.
- **Stage 2 not built**: company lanes don't yet nest their positions
  (Chairperson/CEO inside Tesla). The data is available (`P39` positions carry a
  `P108` employer qualifier); see round 6 in the plan.
- `src/publicData/famous/lives.ts` is now **test-fixture only** (Mozart/Einstein/
  Frida), no longer shown in the UI — keep it out of the product surface.
- **Row-collapse state is lost when toggling 🎂 alignment**: `collapsedRowIds`
  holds the namespaced row id, which flips between `pub:famous-x:` and
  `pub:famous-x-aligned:`. Key collapse on the base row key instead.
- **BCE dates dropped**: `Date.parse` can't read Wikidata's 4-digit negative
  years (e.g. `-0044-…`), so pre-year-0 figures lose those dates. Add a
  negative-year parse if we want ancient people to work.
