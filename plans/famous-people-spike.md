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

## Update — round 3 (feedback applied)

- **Removal.** An "✕" on every overlay group header removes it — a famous person
  (`removeFamousPerson`) or a world-events dataset (`removePublicGroup` routes by
  namespace). Each famous timeline (row) has its own "✕" (`removeFamousRow`),
  filtered out of the rebuilt dataset via per-person `removedRowKeys`; removing
  the last remaining row drops the whole person.
- **Persistence across reload.** Overlay selections (world keys + the full
  `activeFamous`, including Wikidata-fetched biographies) are stored in the same
  IndexedDB under an `overlays` key and restored in `initializeApp`. Persist is
  debounced and centralised in `rebuildPublicDatasets`, so every add/remove/align
  is saved. Verified end-to-end with fake-indexeddb.

## Update — round 4 (feedback applied)

- **Remove ✕ is hover-reveal** now, like the other rail controls (`.hover-reveal`),
  not always-on.
- **Search filtered to people.** `wbsearchentities` can't filter by type, so we
  now follow it with one `wbgetentities?props=claims` call, read each hit's `P31`
  (instance of), and keep only humans (`Q5`). Both calls are on the CORS-open
  action API (`origin=*`) — no WDQS. "Napoleon" now shows the emperor + Napoleon III
  and drops the given-names, the Ohio city and the video game.
- **🐞 Debug view.** A toggle in the picker opens a panel showing exactly what
  came back and how we read it:
  - the raw search hits, each marked kept/dropped with its `P31` ids and
    description (so you see *why* something was filtered out);
  - for the last loaded person: birth + entry/row counts, our interpreted rows
    and entries with year spans, side by side with the raw SPARQL bindings.

### What the Wikidata API gives us (for reference)

- **Search** (`wbsearchentities`): id, label, description, match — good ranking,
  no type info (hence the P31 follow-up).
- **Biography** (one WDQS SPARQL query): residences `P551`, education `P69`,
  positions `P39` + employers `P108`, notable works `P800`, plus birth `P569`
  and death `P570`. Ranges come from statement qualifiers `P580`/`P582` (start/
  end) or, for works, the work's publication date `P577`. Coverage is uneven —
  many statements have no dates and are dropped; open-ended ranges are closed at
  death/today; point works get a +1yr span.

## Deliberate spike shortcuts (not production-ready)

- Static biographies are hand-authored TS, kept out of `public-data/` on purpose
  so they don't have to satisfy the validated public schema (no `birthMs` there).
- No client-side caching of Wikidata responses yet (each add re-queries).
- Date precision from Wikidata is coarsened to `year`; real per-statement
  precision is not read.
- Alignment requires the user's birth date; the 🎂 toggle is hidden until it's set.

## Still open / next

- Confirm WDQS works from the actual browser (UA policy) — the one unverified link.
- Cache Wikidata biographies; read real date precision; optionally filter search
  to humans (`P31 wd:Q5`).
