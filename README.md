# Chronicle 🕰️

**Live at [chronicle.timpanini.com](https://chronicle.timpanini.com)** ·
[What it does](https://jannikarndt.github.io/Chronicle/)

A personal life-timeline web app: your life — and the lives of people around you, and the
world — as parallel horizontal timelines on one shared time axis. Canvas-rendered,
local-first, with an optional account for your other devices and the people you share with.

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
- **An account, if you want one**: your timelines on every device you sign in on, synced
  live. A handle and a passkey (Face ID, a fingerprint, your device PIN) or a password,
  or both — no email needed.
- **Sharing and live editing**: invite your dad by link to fill in his own group and watch
  his entries appear as he types them; let your family view the timelines you publish;
  edit a trip together on two phones — both edits survive, field by field, and you see
  who has what open.
- **Connecting with people**: invite links connect you; connections of your connections
  are suggested, never shared with automatically. A public link shows one published
  group to anyone, no account needed.
- **Local-first**: signed out, nothing leaves the device and the app makes no network
  calls; see the privacy section below.

See [`docs/GLOSSARY.md`](./docs/GLOSSARY.md) for the core terms (`Group`,
`TimelineRow`, `TimelineEntry`, `TimelineEvent`) and `CLAUDE.md` for the fuller
architecture map.

## Privacy boundary (important)

**Personal data never touches this repo.** Signed out, your entries live in your
browser's IndexedDB and in export files you explicitly download — nothing else, no
network. The only data tracked in the repo is [`public-data/`](./public-data):
world/topic timelines everyone sees (read-only, merged into the view).

Signed in:

- **Your timelines are stored on Chronicle's server** so every device you sign in on has
  them. Nobody else can read any of them unless you share them; the one function that
  decides is [`server/access.ts`](./server/access.ts), and it fails closed.
- **Private by default.** A viewer only ever sees timelines you have *published*, in
  groups you shared with them. An editor sees everything in the one group they were
  invited to, and nothing above or beside it.
- **Not end-to-end encrypted, and not recallable.** The server can read what it stores,
  and stopping a share ends future access but cannot un-see what someone already saw.
  The app says both, in those words.
- **No email on file**, so no password reset — a passkey (kept by your phone or password
  manager) is the default for that reason; with a password, let your browser save it.
- **An export is your own timelines only**, never what others share with you.

## Contributing public datasets

See [`public-data/CONTRIBUTING_PROMPT.md`](./public-data/CONTRIBUTING_PROMPT.md) — most
files are LLM-generated from a prompt template, validated against
[`public-data/schema.json`](./public-data/schema.json) by CI (`npm test`). Ids only need
to be unique within your file; the loader prefixes them with `pub:<filename>:` on load.

## Development

```
npm install
npm run dev:server   # the Chronicle server on :8787 (data in .data/)
npm run dev          # the client, proxying /api to the server
npm test             # client and server tests (the server's run a real server in-process)
npm run build        # typecheck + client build + server bundle
```

The server is one dependency-free Node process (`node:http`, `node:sqlite`) — see
[`server/CLAUDE.md`](./server/CLAUDE.md) and [`plans/v2-server-design.md`](./plans/v2-server-design.md).

Deployment: pushes to `main` run the tests and deploy to CapRover via
[`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml), which then waits until
`/version` reports the new build. The CapRover app needs HTTPS enabled and a persistent
directory mounted at `/data`.

## Conventions

- **Timezone**: every stored `ms` is a UTC instant and calendar dates are interpreted and
  displayed in UTC everywhere (picker, storage, renderer). A date is a calendar date, not
  a local time.
- **Fuzzy dates**: precision `exact | day | month | year | circa` with default fuzziness
  0 / 0 / 15 / 182 / 365 days, overridable per date (`fuzzDays`).
- The canvas engine (`src/render/engine.ts`) is a plain framework-agnostic TS module;
  React only owns the DOM rail, panels, and popovers.

## Scope cuts & known gaps (deliberate, not oversights)

- **No account recovery** — there is no email on file, by design. A synced passkey, a
  second signed-in device, or an export is the backup.
- **No end-to-end encryption** — the server reads what it stores; the UI says so.
- **One field typed by two people at the same moment**: the later keystroke wins that
  field. Different fields of the same entry merge fine; presence chips show who else is
  there.
- **No discovery**: people are only ever reachable through invite links and the
  connections you share.
- **No keyboard-only / screen-reader support**: the canvas with mouse/touch input is the
  only interaction path — an accepted scope cut.
