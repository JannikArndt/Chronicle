# src/publicData — read-only shared datasets

Loads `public-data/*.json` via `import.meta.glob` at build time and namespaces
every id/reference as `pub:<file-stem>:`. Read-only, never written.

`src/publicData/famous/lives.ts` is now **test-fixture only** (Mozart/Einstein/
Frida), no longer shown in the UI — keep it out of the product surface.

## Famous-people feature — pre-release TODOs

Carried over from the famous-people spike. Intentionally shipped as-is for now
but must be revisited before a real release:

- **Remove or gate the 🐞 Wikidata debug panel** (`WikidataDebugPanel` in
  `src/ui/RowRail.tsx`, toggled from the picker header). It exposes raw SPARQL
  bindings and kept/dropped candidates — a developer tool, not for end users.
  Put it behind a dev flag or delete it.
- **Cache Wikidata biographies** — every add re-runs the SPARQL query; no
  caching.
- **Row-collapse state is in-memory** (`collapsedRowIds` in `src/ui/`) and
  resets on reload, unlike overlay selections which persist. Decide whether to
  persist it. It's also lost when toggling 🎂 alignment, since the key flips
  between `pub:famous-x:` and `pub:famous-x-aligned:` — key collapse on the
  base row key instead.
- **Stage 2 not built**: company lanes don't yet nest their positions
  (Chairperson/CEO inside Tesla). The data is available (`P39` positions carry
  a `P108` employer qualifier).
- **BCE dates dropped**: `Date.parse` can't read Wikidata's 4-digit negative
  years (e.g. `-0044-…`), so pre-year-0 figures lose those dates. Add a
  negative-year parse if we want ancient people to work.
