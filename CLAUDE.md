# Chronicle — project guide for Claude sessions

Chronicle is a personal life-timeline web app: parallel horizontal timelines on one
shared time axis. React + TypeScript + Vite, custom Canvas renderer, IndexedDB storage,
deployed to GitHub Pages at https://jannikarndt.github.io/Chronicle/. Local-first: the
only backend is the optional Supabase project behind sharing, and without it configured
the app makes no network calls at all.

## Commands

```
npm run dev            # dev server
npm test               # vitest (300+ unit tests)
npm run build          # tsc -b && vite build  (tsc also typechecks test files)
npm run setup:supabase # optional: sharing backend, local Docker stack or a hosted project
npm run verify:sql     # apply supabase/migrations to a real Postgres, assert the RLS rules
```

`npm test` does not cover the RLS policies — there they are re-implemented in
TypeScript so the suite needs no database. `verify:sql` runs the real SQL, and CI
runs it on every PR. Setup and the rest: `supabase/README.md`.

Deploy: push to `main` → `.github/workflows/deploy.yml` builds and publishes Pages.
The local folder is `Timeline/` but the GitHub repo is `Chronicle` → Vite `base` is
`/Chronicle/`. Don't "fix" that mismatch.

## Architecture map

Each directory below has its own `CLAUDE.md` with the detail — this file only holds
what's true across the whole codebase.

- `src/model/` — pure data logic, no DOM. Four entities: `Group`, `TimelineRow`,
  `TimelineEntry` and `TimelineEvent` (glossary in `docs/GLOSSARY.md`).
- `src/render/` — the framework-agnostic canvas engine.
- `src/state/` — the observable store and all mutations.
- `src/publicData/` — read-only shared datasets loaded from `public-data/*.json`.
- `src/sharing/` — publish/subscribe sync against Supabase (phase 1: invite +
  read-only sharing). `supabase/` holds the SQL, the RLS tests and the setup guide.
- `src/storage/` — IndexedDB and export/import, including schema upgrades.
- `src/ui/` — the React shell: desktop rail/panels and the mobile shell.
- `src/onboarding/` — conversational onboarding and the entry/timeline add-flows.

## Cross-cutting invariants (violating these reintroduces known bugs)

- **UTC everywhere**: every stored `ms` is a UTC instant; parsing, formatting, and
  ticks all use `Date.UTC`/`getUTC*`. Never introduce local-time methods.
- **CSS colors are custom properties, not literals**: `styles.css` defines
  `--color-*` on `:root` plus a `@media (prefers-color-scheme: dark)` override
  block; the canvas engine mirrors the same variables via `getComputedStyle`. A new
  rule with a hardcoded hex color renders correctly in light mode and wrong (or
  invisible) in dark mode — always reuse or extend the variable set instead.
- **Privacy**: personal data lives in IndexedDB, in user-initiated exports, and —
  since sharing — in whatever the user has *explicitly published*, and nowhere
  else. Nothing personal may ever be written to the repo/filesystem; only
  `public-data/` is repo-tracked data. Signed out, the app makes no network
  calls at all. Everything that leaves the device goes through `syncSubset` in
  `src/model/sharing.ts`, and other people's data never enters `state.dataset`
  (see `src/sharing/CLAUDE.md`).
- **No dropdowns under ~7 options** — use `PillSelector`. No Save/Cancel buttons —
  autosave per field change. No browse/edit mode toggle, no modal create screen.
- **An entry is a span, an event is a point** — and the point is *only drawn
  when zoomed in* (`src/render/events.ts` owns that rule and nothing else may
  re-decide it). A zero-length entry is not an event and must not be used as
  one: it has no label anchor, no fade edges and no honest "ongoing".
- **A container's timelines and sub-groups are one ordered list** — `order` on
  both `Group` and `TimelineRow` (schema v10), resolved by `orderedChildren()`
  in `src/model/dataset.ts` and renumbered per container by
  `normalizeChildOrder()` after every mutation. Nothing may go back to reading
  array position as render order, and nothing may draw all the rows before all
  the groups: a group above a timeline was literally unrepresentable that way.
  A record with no `order` (an older export, a public dataset) still sorts
  last, rows before groups, which is exactly the pre-v10 picture.
- **Breaking out and collapsing are inverses on screen** — a timeline breaks
  out into a group of timelines, one per entry (`src/model/breakOut.ts`), and a
  collapsed group draws one summary bar per *direct child* rather than one band
  flattened over its whole subtree, so collapsing the new group gives back the
  picture the single timeline had — down to the presentation: collapsed, a
  group is drawn *as* a timeline (one row height, no section band), because it
  is standing in for one. More generally, **every name in the rail is the same
  name**: same size, same weight, no colour, group or timeline, at every depth,
  collapsed or not. A group is said by its ▸/▾, by the indentation of what it
  contains, and by its background band while expanded — saying it a fourth
  time in the type was what made a collapsed group look like a section and a
  deeply nested one look like a footnote. Overlapping children stack into lanes packed
  in time, never in pixels — the layout has no scale, and lanes that reshuffled
  while zooming would be a different picture at every zoom level. Publishing is
  unchanged by a break-out: the new group is private and the new rows inherit
  the row's own `shared` flag.
- **A person is a `Group` or a `TimelineRow` with a `birthDate`** — either can
  independently be a person now (a big family gets a group full of sub-groups
  and timelines; an acquaintance might get exactly one timeline). Both carry
  the same four presentational fields (`label`, `color`, `icon`, `birthDate`).
  `birthDateForRow()` in `src/model/dataset.ts` is the one place that resolves
  "whose life is this" — a row's own date first, else the nearest ancestor
  group's — and every consumer (the pre-birth hatch, the age badge, name
  suggestions) goes through it rather than re-deriving the walk.

## Testing conventions

- Vitest, `environment: node`, tests co-located as `src/**/*.test.ts`. Canvas
  painting itself is not unit-tested — its math is (`bars.ts`, `layout.ts`,
  `timeAxis.ts`, `miniMap.ts`). Same split on the mobile side: pure logic tested,
  React components not.
- `src/publicData/schemaValidation.test.ts` Ajv-validates every `public-data/*.json`
  against `public-data/schema.json`; CI runs this, so a bad contributed file fails
  PRs.
- **The RLS policies are tested in SQL, not in TypeScript.** `supabase/tests/rls.test.sql`
  runs the migration against a real Postgres with the identity switched per statement;
  `src/sharing/fakeBackend.ts` mirrors the same rule in TypeScript purely so the vitest
  suite needs no database. Changing the visibility rule means changing both, and running
  both — the TypeScript copy passing proves nothing about the policy that actually
  guards the data.
- E2E: drive the dev server with playwright-core against system Chrome
  (`channel: "chrome"`). `window.__chronicleEngine` (read `plusHits`/`entryHits` for
  canvas hit coordinates) and `window.__chronicleStore` are exposed exactly for
  this. A reference script lives outside the repo; entry titles are canvas text,
  so assert persistence via the store, not `getByText`.

## v1 scope cuts (deliberate — do not "fix" unasked)

- Publish/subscribe sharing **exists now** (schema v7, `src/sharing/`) — phase 1
  only: invite links, per-timeline publishing, one-way propagation to readers,
  co-owned groups. Co-ownership is granted and enforced server-side, but the client
  has no write-back path for a timeline shared *with* you, so a co-owned mirror is
  still read-only. Not built: opt-in full-account sync, invite chaining, live
  co-editing, public profiles via QR. The publish flag is `shared`/
  `shareByDefault`, deliberately *not* the `visibility` name that v1–v3 used and
  v4 removed; the v7 migration deletes the dead keys and never converts them.
  No Gist sync — still a marked, honest gap (PAT flow unsolved
  for non-technical users). No keyboard-only/screen-reader path. Groups nest
  arbitrarily deep now (`computeLayout` is recursive) — the former one-level
  cap is gone, and with it timeline-in-timeline nesting (`TimelineRow` no
  longer has a `parentRowId`): a "sub-timeline" is now a sub-group holding one
  row instead.
- Hover-revealed rail controls on fine pointers vs always-visible on touch is an
  intentional split, not an inconsistency.

Known gaps and pre-release TODOs for specific features live in that feature's
directory `CLAUDE.md` (e.g. the famous-people feature's punch list is in
`src/publicData/CLAUDE.md`, mobile gaps in `src/ui/CLAUDE.md`).
