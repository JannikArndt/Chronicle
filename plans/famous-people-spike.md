# Spike: famous people + "at my age" overlay

Status: **spike** — proves the concept end-to-end; not the finished feature.

## The idea (from the brainstorm)

Public data grows, so it shouldn't all render by default. Instead the rail's
"+" menu hides two pickers:

- **🌍 World events** — toggle any bundled `public-data/*.json` dataset on/off.
- **🌟 Famous people** — add a person's biography, optionally shifted so their
  birth lands on *yours*, answering "what did Mozart do at **my** age?"

## What shipped in the spike

- `src/publicData/famous/` — a small catalog (Mozart, Einstein, Frida Kahlo).
  Each `FamousPerson` carries a `birthMs` anchor plus a biography authored in
  the same shape as a public-data file.
- `alignToAge.ts` — the one novel bit: `buildFamousDataset(person, userBirthMs?)`
  shifts every entry by `userBirthMs - person.birthMs`, so a fact at the person's
  age N lands at the calendar date when *you* are age N on the shared axis. Pure,
  unit-tested (`alignToAge.test.ts`).
- Store/actions — `activeWorldKeys` + `activeFamous` selections; nothing loads by
  default (`initializeApp` now seeds `publicDatasets: []`). `toggleWorldEvents`,
  `toggleFamousPerson`, `setFamousAlignment` rebuild `publicDatasets` from the
  selections. Verified end-to-end in `famousPeople.test.ts`.
- UI — `WorldEventsPicker` / `FamousPeoplePicker` submenus in the rail "+" menu.
- **Zero renderer changes**: famous people ride the existing public-dataset merge
  path, so the canvas/rail render them for free.

## Deliberate spike shortcuts (not production-ready)

- Biographies are hand-authored TS, kept out of `public-data/` on purpose so they
  don't have to satisfy the validated public schema (which forbids a `birthMs`).
- Selections are view state only — **not persisted**, so a reload clears them.
  A real version would persist `activeWorldKeys`/`activeFamous`.
- Alignment requires the user's birth date (identity onboarding); the "At my age"
  checkbox is hidden until it's set.
- Could not run the visual browser check (Chrome extension not connected in this
  environment); verification is via the unit + store-wiring tests instead.

## Next level (not built)

Pull biographies dynamically from **Wikidata** (`wikidata.org`) instead of the
hand-authored catalog: query a person's `P569` (birth), `P570` (death) and life
events, map to entries, cache client-side. No backend needed — Wikidata's SPARQL/
REST endpoints are CORS-open. The `FamousPerson`/`buildFamousDataset` seam is
already the right shape to slot a fetched-and-mapped biography into.
