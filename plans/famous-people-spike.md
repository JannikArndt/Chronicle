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

## Update — round 2 (feedback applied)

- **"At my age" moved to the group header.** A 🎂 toggle on each famous person's
  rail group flips that person between real dates and age-aligned, in place. The
  per-person checkbox in the add-menu is gone. `parseFamousGroupId` recovers the
  person + alignment state from the rendered group id.
- **Multi-row biographies.** Each person is now split into *Places lived /
  Education / Works* (hand-authored) or *Places lived / Education / Career /
  Works* (Wikidata), instead of one combined row.
- **Every entry has an end date.** Open ends render as ongoing arrows, which look
  wrong for a finished life. Hand-authored entries all carry ends; the Wikidata
  mapper synthesises them — open-ended residence → death (or today); point-in-time
  work → +1 year.
- **Wikidata search + dynamic load.** `wikidata.ts`:
  - `searchWikidataPeople` — MediaWiki `wbsearchentities` (`origin=*`, CORS-open).
  - `fetchWikidataBiography` — one WDQS SPARQL query (P551/P69/P39/P108/P800 +
    P569/P570), mapped by the pure, unit-tested `bindingsToPerson`.
  - Picker has a live search box; results add straight onto the timeline.

Verified the **live** endpoints from Node through the real functions: search
returns hits; the SPARQL query returns 200 with sensible ranges for Marie Curie
(Q7186). ⚠️ WDQS **403s a generic/Node User-Agent** by policy — browsers always
send a real UA (WDQS's own GUI is browser-based), so the app path is expected to
work, but this was **not** confirmed in-browser here (extension not connected).

## Deliberate spike shortcuts (not production-ready)

- Static biographies are hand-authored TS, kept out of `public-data/` on purpose
  so they don't have to satisfy the validated public schema (no `birthMs` there).
- Selections are view state only — **not persisted**, so a reload clears them.
- No client-side caching of Wikidata responses yet (each add re-queries).
- Date precision from Wikidata is coarsened to `year`; real per-statement
  precision is not read.
- Alignment requires the user's birth date; the 🎂 toggle is hidden until it's set.

## Still open / next

- Confirm WDQS works from the actual browser (UA policy) — the one unverified link.
- Persist selections; cache Wikidata biographies; read real date precision;
  optionally filter search to humans (`P31 wd:Q5`).
