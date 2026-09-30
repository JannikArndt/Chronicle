# Chronicle — project guide for Claude sessions

Chronicle is a personal life-timeline web app: parallel horizontal timelines on one
shared time axis. React + TypeScript + Vite, custom Canvas renderer, IndexedDB on the
device, and — since v2 — its own server: https://chronicle.timpanini.com, one Node
container on the owner's CapRover. Local-first still: signed out, the app makes no
network calls at all; signed in, the account's timelines sync to every device and to
the people they are shared with, live.

## Commands

```
npm run dev            # Vite dev server (proxies /api and /version to :8787)
npm run dev:server     # the Chronicle server on :8787, rebuilt on change, data in .data/
npm test               # vitest — client and server (580+ tests)
npm run build          # tsc -b && vite build && esbuild server  (tsc also typechecks tests)
npm run buildid        # the build id /version must report after a deploy
```

The server's tests run a real server on port 0 with an in-memory SQLite and talk
to it over HTTP (`server/testkit.ts`) — the access rules are tested as they run.

Deploy: push to `main` → `.github/workflows/deploy.yml` runs the tests, sends the
commit to CapRover (`caprover deploy` with the per-app token in the
`CAPROVER_*` secrets), then polls `/version` until the new build answers — a
deploy that never came up fails the workflow. `workflow_dispatch` deploys any
branch. The app's CapRover config needs HTTPS on and a persistent directory at
`/data` (the SQLite database); see `server/CLAUDE.md`. Open tabs pick up a new
build on their own at a quiet moment (`src/ui/fresh.ts`).

## Architecture map

Each directory below has its own `CLAUDE.md` with the detail — this file only holds
what's true across the whole codebase.

- `src/model/` — pure data logic, no DOM. Four entities: `Group`, `TimelineRow`,
  `TimelineEntry` and `TimelineEvent` (glossary in `docs/GLOSSARY.md`).
- `src/render/` — the framework-agnostic canvas engine.
- `src/state/` — the observable store and all mutations.
- `src/publicData/` — read-only shared datasets loaded from `public-data/*.json`.
- `src/sync/` — the client side of the server: replica, diff, push/pull, live
  stream, presence, people. `src/sync/protocol.ts` is shared with the server.
- `server/` — the server: accounts, records with field-level merge, access
  rules, live events, invites/connections/grants/public links, static client.
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
  for a signed-in account — on Chronicle's server, where `server/access.ts` is
  the one function deciding who may read or change each record (fails closed;
  viewers see only published timelines, editors only the subtree they were
  granted). Nothing personal may ever be written to the repo/filesystem; only
  `public-data/` is repo-tracked data. Signed out, the app makes no network calls
  at all. An export is your own records only (`ownDataset`), never what others
  share with you. The UI says plainly that the server can read what it stores.
- **Trees never mix**: every record has an owner, and nothing moves between two
  owners' trees — an entry added to Dad's timeline is Dad's record, written by
  you. Enforced on the server (`checkStructure`) and refused before sending on
  the client (`diffView`, `canMoveInto`). See `src/sync/CLAUDE.md`.
- **No dropdowns under ~7 options** — use `PillSelector`. No Save/Cancel buttons —
  autosave per field change. No browse/edit mode toggle, no modal create screen.
- **A favicon replaces the emoji, it never joins it** — an entry, a timeline and
  a group all carry an optional `website`, and `nameIcon()` in
  `src/model/favicon.ts` is the single place that turns "site or emoji" into one
  mark. Two coloured things in front of a name is exactly what the rail's "every
  name is the same name" rule exists to prevent, and the emoji has a second job
  as the fallback when the icon cannot be fetched.
- **Hiding is a view preference, and it hides completely** — `hiddenRowIds` /
  `hiddenGroupIds` live in the app store and the IndexedDB `overlays` record,
  never in the dataset (they must not travel with an export or be published),
  and `computeLayout` emits no item at all for a hidden row or group. There is
  no `LayoutItem.hidden` and nothing may bring one back: a dimmed-but-present
  row is what this replaced. What keeps "gone" from meaning "lost" is that every
  container offers its own hidden children back — `hiddenChildrenOf()` in
  `src/model/hidden.ts`, shown in a group's own ⚙ settings, in the rail footer
  for the top level (the root has no ⚙ to put them in), and at the foot of the
  mobile list.
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
- **The tree overlay adds strokes and nothing else** — `treeLines()`
  (`src/render/treeLines.ts`) is pure, derived from the layout items, and off by
  default; both the rail and the canvas paint from it. Turning it on must never
  move an item: the hierarchy is carried by the indent, the ▸/▾ and the group
  band, and this only draws the connection those already imply.

## Testing conventions

- Vitest, `environment: node`, tests co-located as `src/**/*.test.ts`. Canvas
  painting itself is not unit-tested — its math is (`bars.ts`, `layout.ts`,
  `timeAxis.ts`, `miniMap.ts`). Same split on the mobile side: pure logic tested,
  React components not.
- `src/publicData/schemaValidation.test.ts` Ajv-validates every `public-data/*.json`
  against `public-data/schema.json`; CI runs this, so a bad contributed file fails
  PRs.
- **The server is tested through HTTP.** `server/api.test.ts` and
  `src/sync/engine.test.ts` start a real server (`server/testkit.ts`); the engine
  test runs the browser-side sync against it with a second person as a plain API
  client, so live co-editing is asserted end to end in `npm test`.
- E2E: build, run `node dist-server/main.mjs` with `TRUST_PROXY=false`, and drive
  it with playwright-core (Chromium; several contexts are several people).
  `window.__chronicleEngine` (read `plusHits`/`entryHits` for canvas hit
  coordinates), `window.__chronicleStore` and `window.__chronicleActions` are
  exposed exactly for this. A reference script lives outside the repo; entry titles are canvas text,
  so assert persistence via the store, not `getByText`.

## Scope cuts (deliberate — do not "fix" unasked)

- v2 sharing (`plans/v2-server-design.md`): accounts are a handle and a password —
  no email, so no password reset (a second signed-in device is the backup). No
  end-to-end encryption. One audience per owner: publishing is per timeline, not
  per person. Suggestions are connections of connections and never grant
  anything; there is no discovery or search of people. Two people typing into the
  *same field* at once: the later keystroke wins that field (presence chips are
  the mitigation). The publish flag is `shared`/`shareByDefault`, deliberately
  *not* the `visibility` name that v1–v3 used and v4 removed.
- No keyboard-only/screen-reader path. Groups nest arbitrarily deep
  (`computeLayout` is recursive); a "sub-timeline" is a sub-group holding one row
  (`TimelineRow` has no `parentRowId`).
- Hover-revealed rail controls on fine pointers vs always-visible on touch is an
  intentional split, not an inconsistency.

Known gaps and pre-release TODOs for specific features live in that feature's
directory `CLAUDE.md` (e.g. the famous-people feature's punch list is in
`src/publicData/CLAUDE.md`, mobile gaps in `src/ui/CLAUDE.md`).
