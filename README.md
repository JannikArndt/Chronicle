# Chronicle 🕰️

**Live at [jannikarndt.github.io/Chronicle](https://jannikarndt.github.io/Chronicle/)**

A personal life-timeline web app: your life — and the lives of people around you, and the
world — as parallel horizontal timelines on one shared time axis. Canvas-rendered,
local-first, statically hosted on GitHub Pages.

- **Parallel timelines**: one row per person, group, or topic, all sharing one time axis
  you pan and zoom.
- **Fuzzy dates**: "circa 1990" or "sometime in the 90s" are first-class, not just exact
  dates — precision fades visually the less certain a date is.
- **Spans and moments**: a job or a flat is a bar; "first kiss" or "finished the big
  project" is an event — a point on the same timeline, drawn once you zoom in far enough
  for a day to mean something, with a band as wide as the date is vague.
- **A conversational setup assistant** walks a new user through their identity, birth
  date, and places lived instead of a blank app.
- **Public overlays**: world events, famous people (via Wikidata), and a growing set of
  `public-data/` datasets (Olympics, World Cups, presidents, ...) merge into your view
  read-only, alongside your private data.
- **A dedicated mobile shell** (bottom sheets, a mini-map, touch gestures), not a
  responsive reflow of the desktop layout.
- **Sharing, if you want it**: publish individual timelines and invite someone by link —
  to read them, or to co-own a group and fill in their own life. Private by default, one
  timeline at a time. Signed out (and in any build with no backend configured) the app
  makes no network calls at all.
- **Everything local-first**: nothing leaves the device until you publish it; see the
  privacy section below.

See [`docs/GLOSSARY.md`](./docs/GLOSSARY.md) for the core terms (`Group`,
`TimelineRow`, `TimelineEntry`, `TimelineEvent`) and `CLAUDE.md` for the fuller
architecture map.

## Privacy boundary (important)

**Personal data never touches this repo.** Your entries live in your browser's IndexedDB,
in export files you explicitly download, and — since sharing — in whatever you have
explicitly published. Nothing else, no filesystem folder. The only data tracked in the
repo is [`public-data/`](./public-data): world/topic timelines everyone sees (read-only,
merged into the view under namespaced ids).

What sharing does and does not change:

- **Private by default.** A new timeline is not published; publishing is a per-timeline
  act, and the only code path by which anything reaches a server is `syncSubset` in
  [`src/model/sharing.ts`](./src/model/sharing.ts).
- **Signed out is silent.** No account, no requests. A build with no backend configured
  does not even ship the client SDK.
- **Other people's data stays separate.** Timelines shared *with* you are cached under
  their own key, never merged into your dataset, and never appear in your exports.
- **Published is not encrypted, and not recallable.** The server can read what you
  publish, and revoking stops future access but cannot un-see what someone already saw.
  The app says both, in those words, at the point of publishing.

Back up or move devices via **Data ▾ → Export JSON / Import JSON** (works on iOS Safari).
Signing in is not a backup: only what you publish is uploaded.

## Contributing public datasets

See [`public-data/CONTRIBUTING_PROMPT.md`](./public-data/CONTRIBUTING_PROMPT.md) — most
files are LLM-generated from a prompt template, validated against
[`public-data/schema.json`](./public-data/schema.json) by CI (`npm test`). Ids only need
to be unique within your file; the loader prefixes them with `pub:<filename>:` on load.

## Development

```
npm install
npm run dev       # local dev server
npm test          # unit tests (model, storage, schema validation, render math)
npm run build     # typecheck + production build
```

Sharing is optional and off unless a backend is configured — see
[`supabase/README.md`](./supabase/README.md):

```
npm run setup:supabase    # local Supabase stack in Docker, writes .env.local
npm run verify:sql        # apply the migration to a real Postgres and assert the RLS rules
```

Deployment: pushes to `main` build and publish to GitHub Pages via
[`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml). The Vite `base` is
`/Chronicle/` (project pages, matching the GitHub repo name).

## Conventions

- **Timezone**: every stored `ms` is a UTC instant and calendar dates are interpreted and
  displayed in UTC everywhere (picker, storage, renderer). A date is a calendar date, not
  a local time.
- **Fuzzy dates**: precision `exact | day | month | year | circa` with default fuzziness
  0 / 0 / 15 / 182 / 365 days, overridable per date (`fuzzDays`).
- The canvas engine (`src/render/engine.ts`) is a plain framework-agnostic TS module;
  React only owns the DOM rail, panels, and popovers.

## v1 scope cuts & known gaps (deliberate, not oversights)

- **Sharing is phase 1 only** — invite links, per-timeline publishing, one-way
  propagation to readers, co-owned groups. Not built: opt-in full-account sync, invite
  chaining, live co-editing, public profiles via QR. Co-ownership is granted and enforced
  server-side, but the client has no write-back path for a timeline shared *with* you yet,
  so a co-owned timeline is read-only on your side.
  See [`plans/sharing-feature-design.md`](./plans/sharing-feature-design.md).
- **GitHub Gist sync is an open problem**: pasting a personal access token is fine for
  power users but is not a solution for non-technical users. The Data menu marks it as
  planned; it is deliberately not faked.
- **No keyboard-only / screen-reader support**: the canvas with mouse/touch input is the
  only interaction path in v1 — an accepted scope cut.
- **Only one level of nesting**: a group may contain sub-groups (that is what a person
  inside "Family" is), but a sub-group's own sub-groups are not drawn.
