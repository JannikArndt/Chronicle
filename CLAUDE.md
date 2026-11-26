# Chronicle — project guide for Claude sessions

Chronicle is a personal life-timeline web app: parallel horizontal timelines on one
shared time axis. React + TypeScript + Vite, custom Canvas renderer, IndexedDB on the
device, and — since v2 — its own server: https://chronicle.timpanini.com, one Node
container on the owner's CapRover. Local-first still: signed out, the app makes no
network calls at all; signed in, the account's timelines sync to every device and to
the people they are shared with, live.

## Ship loop

Work on `main`. A change isn't done until it's live.

1. `npm run verify` before every push — exactly what CI runs (deploy contract,
   tests, `tsc -b` + both builds). Last line `VERIFY: PASS`.
2. Push `main`. CI: verify → `caprover deploy` → waits until `/version`
   reports this commit's build id.
3. `npm run live -- --wait` (or just `npm run ship` from a clean tree, which
   does all three). Last line `LIVE: <build>`.

| command | does | last line |
|---|---|---|
| `npm run verify` | contract test, vitest, build; every step runs, failures are printed (`verify test` runs one) | `VERIFY: PASS` / `VERIFY: FAIL (…)` |
| `npm run live` | does chronicle.timpanini.com serve this tree's build? `--wait` polls up to 10 min | `LIVE: <build>` / `NOT LIVE: …` |
| `npm run ship` | clean tree → verify → push `main` → live --wait | `LIVE: <build>` / `SHIP: FAIL (…)` |
| `npm run logs [lines]` | the container's log (needs `CAPROVER_URL`, `CAPROVER_PASSWORD` — admin, from the environment, never in git) | — |
| `npm run buildid` | the id `/version` must report | the id |
| `npm run dev` | Vite dev server (proxies /api and /version to :8787) | — |
| `npm run dev:server` | the Chronicle server on :8787, rebuilt on change, data in `.data/` | — |
| `npm test` | vitest, client and server | — |
| `npm run test:watch` | vitest in watch mode | — |
| `npm run build` | `tsc -b && vite build && esbuild server` (tsc also typechecks tests) | — |
| `npm run build:client`, `npm run build:server` | the two halves of the build | — |
| `npm start` | the built server, the same file the Dockerfile runs | — |
| `npm run preview` | Vite's preview of the built client | — |

The server's tests run a real server on port 0 with an in-memory SQLite and talk
to it over HTTP (`server/testkit.ts`) — the access rules are tested as they run.

## Deploying

- CapRover app `chronicle` (`.github/workflows/deploy.yml`): push to `main` →
  verify → deploy → live check. A pull request (Dependabot's) runs verify only;
  `workflow_dispatch` runs verify on any ref but deploys only from `main`.
  There is no dev app.
- Secrets `CAPROVER_APP`, `CAPROVER_APP_TOKEN`; optional variable `APP_URL`.
  The server URL is written into the workflow. The deploy token travels as an
  env var, the CLI is pinned (`caprover@2.4.4`), stdin is closed.
- The CLI can exit 0 without deploying, and CapRover keeps serving the old
  container when a new image fails to build or boot — so the workflow's last
  step polls `/version` for this commit's build id and fails otherwise. The
  build log is in the CapRover dashboard (or `GET /api/v2/user/apps/appData/chronicle`).
- Build id: `server/buildid.mjs` over `INPUTS` (Dockerfile, entrypoint,
  package.json, lockfile, build configs, `src`, `server`, `public-data`),
  stamped into `dist-server/BUILD_ID` by the Dockerfile's build stage, served
  at `/version` and in the page's `app-build` meta.
  `test/deploy-contract.test.mjs` keeps Dockerfile, `.dockerignore` and
  `INPUTS` in step, and holds pins, permissions, timeouts and these docs.
  Adding a file the build needs means adding it to `INPUTS` *and* the
  Dockerfile's `COPY` lines.
- The image runs `docker-entrypoint.sh` as root just long enough to give
  `/data` to `node`, then drops privileges (`su-exec`); `HEALTHCHECK` asks
  `/version`. Node is PID 1 after the exec, so SIGTERM reaches it.
- Data: CapRover volume `chronicle-data` at `/data` (SQLite, WAL). Never
  shared with another app.
- Open tabs pick up a new build at a quiet moment (`src/ui/fresh.ts`).
- Home Screen: `public/` (copied into `dist/` by Vite; in `INPUTS` and the
  Dockerfile `COPY`) holds `manifest.webmanifest` and `icons/*.png`, drawn
  by `node scripts/make-icons.mjs` (four parallel bars on one axis, the
  `:root` light tokens; the PNGs are committed). `index.html` carries the
  `apple-*` metas and two `theme-color` metas (light/dark, matching
  `--color-bg`); the contract test holds the checklist. A Home Screen copy
  has storage separate from Safari's (iOS 16.4+): cookie, IndexedDB and
  localStorage start empty, so the first launch is signed out and the person
  signs in again (passkey or password; the RP ID is the host, so passkeys
  work there; the session cookie is `Max-Age` one year, so it persists once
  set). Signed in, the account's timelines sync down; anything only in the
  Safari tab's IndexedDB stays there (export/import moves it). Invite links
  open in Safari, not in the installed app. The status bar is `default`
  (white), not `black-translucent`, because the app has a light and a dark
  ground.
- Dependabot: weekly (npm, docker, github-actions; majors ignored), merges
  itself on green and starts the deploy (`.github/workflows/dependabot-merge.yml`).
  Actions are pinned to commit SHAs, the base image to a digest.
- Pages (`pages.yml`) publishes the product page only; the Node major, the
  `caprover` pin and the Pages action SHAs move by hand or by Dependabot.

Product page: `site/` is the static page at https://jannikarndt.github.io/Chronicle/
(plain HTML + CSS, no build, no JS), published by `.github/workflows/pages.yml`
on pushes to `main` that touch it; the repo's Pages source is "GitHub Actions".
Its screenshots are real renders of the app with a made-up family —
`npm run build && CHROMIUM_PATH=/opt/pw-browsers/chromium node
scripts/site-screenshots.mjs` rewrites `site/img/`. The page carries its own
copy of the palette (it cannot load the app's CSS); keep the two in step.

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
  A record with no `order` (a public dataset) sorts last, rows before
  groups.
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
  so assert persistence via the store, not `getByText`. Passkeys are driven with
  Chromium's virtual authenticator (CDP `WebAuthn.addVirtualAuthenticator`, one
  per context = one per device); it answers the handle field's autofill request
  on its own, so a sign-in test must accept either path.

## Scope cuts (deliberate — do not "fix" unasked)

- v2 sharing (`plans/v2-server-design.md`): accounts are a handle plus a passkey,
  a password, or both — no email, so no reset (a passkey synced by the person's
  own password manager, or a second signed-in device, is the backup). No
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
