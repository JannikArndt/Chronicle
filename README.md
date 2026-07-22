# Chronicle 🕰️

**Live at [jannikarndt.github.io/Chronicle](https://jannikarndt.github.io/Chronicle/)**

A personal life-timeline web app: your life — and the lives of people around you, and the
world — as parallel horizontal timelines on one shared time axis. Canvas-rendered,
no backend, statically hosted on GitHub Pages.

Built from the discovery brief in [`ENGINEERING_PROMPT.md`](./ENGINEERING_PROMPT.md).

## Privacy boundary (important)

**Personal data never touches this repo.** Your entries live in your browser's IndexedDB
and in export files you explicitly download — nothing else, no server, no filesystem
folder. The only data tracked in the repo is [`public-data/`](./public-data): world/topic
timelines everyone sees (read-only, merged into the view under namespaced ids).

Back up or move devices via **Data ▾ → Export JSON / Import JSON** (works on iOS Safari).

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

- **No publish/subscribe sharing yet** — `visibility` exists on every entry so the future
  feature needs no migration, but no sharing UI ships in v1.
- **GitHub Gist sync is an open problem**: pasting a personal access token is fine for
  power users but is not a solution for non-technical users. The Data menu marks it as
  planned; it is deliberately not faked.
- **No keyboard-only / screen-reader support**: the canvas with mouse/touch input is the
  only interaction path in v1 — an accepted scope cut.
- **No nested people**: a group either *is* a person or *contains* persons, never both.
