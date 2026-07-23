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
  `fuzzyDate.ts` (precision fuzz + fade ramps), `cascade.ts` (delete cascades),
  `autoClose.ts` (exclusive-row insert planning: auto-close vs blocked conflict).
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
  in `actions.ts` with a 250ms debounced IndexedDB autosave. New entries are drafts
  (`state.draft`) and only enter the dataset once titled.
- `src/publicData/` — loads `public-data/*.json` via `import.meta.glob` at build time
  and namespaces every id/reference as `pub:<file-stem>:`. Read-only, never written.
- `src/storage/` — IndexedDB (db `chronicle`, store `datasets`, key `main`) and
  export/import. `exportImport.ts` accepts any `schemaVersion` from
  `MIN_SUPPORTED_SCHEMA_VERSION` through `SCHEMA_VERSION` and upgrades in place on
  success (currently a no-op beyond bumping the number, since v1→v2's only diff,
  `selfPersonId`, is optional); it still rejects anything outside that range, or
  structurally malformed, with an explicit error — never a silent migration of
  actual data. `triggerImportFlow()` is the shared file-picker → parse → callback
  helper used by both the top-bar Data menu and the rail's "+ Import".
- `src/ui/` — React shell: rail, detail panel, popovers, search. The rail is DOM and
  is translated by the engine's `onScrollSync` callback every frame (direct style
  mutation, not React state — intentional). All colors are `--color-*` custom
  properties defined on `:root` in `styles.css` with a `@media (prefers-color-scheme:
  dark)` override block — never hardcode a hex color in a new rule; add or reuse a
  variable instead, or the dark theme silently breaks for that element.
- `src/onboarding/` — Typeform-style conversational onboarding, auto-shown on a fresh
  dataset (`shouldShowOnboarding`, gated on `dataset.selfPersonId === undefined &&
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
  → a chained places-lived loop via `completeIdentityStep`/`addOnboardingPlaceEntry`
  in `actions.ts`. `PlaceAutocompleteInput`/`nominatim.ts` hit OpenStreetMap
  Nominatim directly (no API key, no backend to hide one behind), request
  `addressdetails=1`, and derive a short `title`/`subtitle` (street+city, or just
  city) plus structured `street`/`city`/`country`/`coordinates` — the full Nominatim
  string is kept as `fullName` but never shown as the entry/entity label. Selecting
  a suggestion (click, or arrow-keys + Enter) fills the field with `formatSuggestion
  Text()` ("Street, City"), locks the debounced search for that programmatic change,
  shows a brief confirmed state, then auto-advances the step after ~450ms.

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
- **Onboarding Back must never cross a commit boundary**: `IdentityBirthPlacesAssistant`
  disables its Back button at `place{iteration > 1}` on purpose — reaching that step
  means the previous iteration's entry already committed, and re-answering an earlier
  step after Back would either silently collide with it (`planEntryInsert` returns
  `"conflict"`, which `addOnboardingPlaceEntry` correctly no-ops on — but silently, so
  the data is just lost) or, for the name step, spawn a second Person/Group. The name
  step's fix is the general pattern: check whether identity was already committed and
  update in place (`updatePerson`/`updateGroup`) instead of re-creating.
- **Onboarding resume must never re-create identity either**: the same duplication
  risk above applies on fresh mount, not just after Back — replaying the assistant
  (rail "+" menu) on a dataset that already has `selfPersonId` set must NOT call
  `completeIdentityStep` again. `findExistingSetup()` in
  `IdentityBirthPlacesAssistant.tsx` looks up the existing Person/Group/"Places
  lived" row from `selfPersonId` and seeds `setup`/`name`/`birthDateMs` from it
  before the first render, so `commitName` takes its update-in-place branch
  immediately. Known gap: re-adding a first place whose start date collides with an
  already-recorded entry still silently no-ops via the same `"conflict"` path above —
  acceptable for a manual testing entry point, not for the primary flow.
- **CSS colors are custom properties, not literals**: `styles.css` defines
  `--color-*` on `:root` plus a `@media (prefers-color-scheme: dark)` override block;
  the canvas engine mirrors the same variables via `getComputedStyle`. A new rule
  with a hardcoded hex color renders correctly in light mode and wrong (or invisible)
  in dark mode — always reuse or extend the variable set instead.

## Testing conventions

- Vitest, `environment: node`, tests co-located as `src/**/*.test.ts`. Canvas painting
  itself is not unit-tested — its math (`bars.ts`, `layout.ts`, `timeAxis.ts`) is.
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
  non-technical users). No keyboard-only/screen-reader path. No nested people
  (a group either *is* a person or *contains* persons, never both).
- Hover-revealed rail controls on fine pointers vs always-visible on touch is an
  intentional split, not an inconsistency.

## Still open / untested

- Real-device iOS Safari gesture check (pinch vs page zoom) has never been done.
- Public-data collapse state is in-memory only; private group collapse persists.
- Editing an *existing* entry's dates bypasses `planEntryInsert` (only drafts are
  checked) — spec only mandates the check when adding.
