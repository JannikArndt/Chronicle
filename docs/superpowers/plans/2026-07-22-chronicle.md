# Chronicle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Chronicle, a personal life-timeline web app (parallel horizontal timelines on a shared time axis) per `ENGINEERING_PROMPT.md`.

**Architecture:** A framework-agnostic canvas rendering engine (plain TS module) draws virtualized timeline rows; a thin React shell provides the DOM row rail, detail panel, popovers, and app state. Data lives in IndexedDB (source of truth), with manual JSON export/import and read-only public datasets merged in from `public-data/*.json` with id namespacing at load.

**Tech Stack:** React + TypeScript + Vite, Vitest (+ fake-indexeddb) for tests, GitHub Actions → GitHub Pages for deploy. No backend, no timeline/chart libraries.

## Global Constraints

- Canvas renderer is custom (no SVG/D3/timeline libs), virtualized: only draw rows/entries intersecting the viewport.
- Row rail is real DOM, kept vertically in sync with canvas scroll every frame.
- No mode toggle between browsing and editing. No modal Create screen. No Save/Cancel buttons — autosave on every field change; drafts insert only once titled.
- No dropdowns for fewer than ~7 options — icon-pill row selectors instead.
- Timezone convention: store UTC ms; display/parse in UTC everywhere (picker, storage, renderer) — dates are calendar dates, not local times. Document this in code.
- Personal data never touches the repo/filesystem: IndexedDB + user-initiated export only. Only `public-data/` is repo-tracked data.
- v1 scope cuts (do NOT build): publish/subscribe sharing, Gist sync (leave marked gap), keyboard-only/screen-reader accessibility, nested people.
- Fuzz defaults (days): exact 0, day 0, month 15, year 182, circa 365.
- `schemaVersion: 1`.
- Commit after every task. Tests for all pure-logic modules; canvas painting verified visually.

## File Structure

```
index.html, vite.config.ts, tsconfig.json, package.json, .gitignore
src/model/types.ts          — §2 interfaces verbatim
src/model/fuzzyDate.ts      — fuzz defaults, ramp math, UTC parse/format per precision
src/model/dataset.ts        — empty dataset, id gen, lookups, merge
src/model/cascade.ts        — delete-cascade collection + category-delete block
src/model/autoClose.ts      — exclusive-row insert planning (auto-close vs conflict)
src/publicData/namespace.ts — pub:<file>: id prefixing
src/publicData/loader.ts    — import.meta.glob over ../../public-data/*.json
src/storage/db.ts           — IndexedDB open/load/save (store "chronicle", key "dataset")
src/storage/exportImport.ts — JSON export blob; import validation (schemaVersion, shape)
src/state/store.ts          — plain observable store + useSyncExternalStore hook
src/state/actions.ts        — all mutations; each persists via debounced save
src/render/timeScale.ts     — ms<->px mapping, zoom-at-anchor, clamps
src/render/timeAxis.ts      — two-level tick computation (never blank)
src/render/layout.ts        — groups→persons→rows→sub-rows vertical layout
src/render/bars.ts          — bar geometry: ramp stops, solid span, label anchor
src/render/engine.ts        — TimelineEngine class: rAF draw loop, virtualization,
                              hit-testing, pan/zoom/pinch/keyboard, pick mode, callbacks
src/ui/App.tsx              — composition + keyboard handling + selection state
src/ui/CanvasHost.tsx       — mounts engine, wires callbacks
src/ui/RowRail.tsx          — DOM rail (group/person headers, row controls)
src/ui/DetailPanel.tsx      — entry view/edit, draft flow, delete confirm
src/ui/PillSelector.tsx     — generic icon-pill row selector
src/ui/DateField.tsx        — date text input + precision pills + pick-on-timeline
src/ui/CategoryEditor.tsx   — popover: color, emoji, concurrency pill, visibility pill
src/ui/PersonEditor.tsx     — popover: name + native date birthdate
src/ui/SearchBar.tsx        — search + filters (dim-not-hide)
src/ui/DataMenu.tsx         — export/import UI + gist-sync marked gap
src/ui/styles.css
public-data/schema.json, public-data/CONTRIBUTING_PROMPT.md, public-data/iphone-releases.json
.github/workflows/deploy.yml
tests mirror src under src/**/*.test.ts
```

---

### Task 1: Scaffold

**Files:** package.json, vite.config.ts, tsconfig.json, index.html, src/main.tsx, src/ui/App.tsx (stub), .gitignore

- [ ] Vite react-ts scaffold (manual, no `create-vite` churn), add vitest + fake-indexeddb + @types.
- [ ] `vite.config.ts`: `base: '/Timeline/'` (GH Pages project site), vitest config `environment: 'node'` default.
- [ ] `.gitignore`: node_modules, dist. Note in README-style comment: personal data never in repo (IndexedDB only).
- [ ] `index.html`: viewport meta with `user-scalable=no` off? — keep standard viewport; gesture conflicts handled via `touch-action: none` on canvas.
- [ ] Verify: `npm run build` and `npx vitest run` pass (empty). Commit.

### Task 2: Model types + fuzzy dates (TDD)

**Produces:** `types.ts` (§2 verbatim, `SCHEMA_VERSION = 1`); `fuzzyDate.ts`:
```ts
DEFAULT_FUZZ_DAYS: Record<Precision, number> // exact 0, day 0, month 15, year 182, circa 365
fuzzMs(d: FuzzyDate): number
// Bar edge ramp convention (single continuous mechanism):
// left ramp:  alpha 0 at start.ms - fuzzMs(start)  → alpha 1 at start.ms + fuzzMs(start) + fadeInDays*DAY
// right ramp: alpha 1 at end.ms - fuzzMs(end) - fadeOutDays*DAY → alpha 0 at end.ms + fuzzMs(end)
rampBounds(entry, nowMs): { visualStart, solidStart, solidEnd, visualEnd, ongoing: boolean }
formatFuzzyDate(d: FuzzyDate): string   // per precision: exact/day "2020-05-14", month "2020-05", year "2020", circa "ca. 2020"
parseDateInput(text: string): { ms, precision } | null  // UTC; "2020" → year, "2020-05" → month, "2020-05-14" → day
utcDayStart(ms), addDays(ms, d)
```
- [ ] Tests: defaults table, fuzzMs override, rampBounds with fade+fuzz combined, ongoing (no end → visualEnd = nowMs, ongoing true), parse/format round-trips incl. precision inference. Fail → implement → pass → commit.

### Task 3: Dataset utilities + cascades (TDD)

**Produces:** `dataset.ts`: `emptyDataset()`, `newId(prefix)`, `mergeDatasets(base, ...extra)` (concat arrays), lookup helpers `rowsOfGroup`, `entriesOfRow`, `childRows(rowId)`, `childEntries(entryId)`, `personForRow(dataset, row)` (row.personId ?? group.personId).
`cascade.ts`:
```ts
collectRowCascade(ds, rowId): { rowIds: string[], entryIds: string[] }      // sub-rows recursive + their entries + parentEntryId descendants
collectEntryCascade(ds, entryId): { entryIds: string[] }                    // parentEntryId descendants recursive
collectGroupCascade(ds, groupId): { rowIds, entryIds, personIds }           // group rows cascaded; persons only referenced by this group
describeCascade(c): string                                                  // "This deletes 3 entries and 1 sub-row."
categoryDeleteBlockers(ds, categoryId): TimelineRow[]                       // non-empty ⇒ delete blocked
applyDelete(ds, c): TimelineDataset                                         // pure removal
```
- [ ] Tests: recursive sub-row cascade, entry-nesting cascade, group cascade keeps persons referenced by other groups, category block lists rows, describeCascade wording. Commit.

### Task 4: Exclusive-row insert planning (TDD)

**Produces:** `autoClose.ts`:
```ts
type InsertPlan =
  | { kind: 'ok' }
  | { kind: 'autoClose'; previousEntry: TimelineEntry; closeAt: FuzzyDate; note: string }
  | { kind: 'conflict'; conflictingEntry: TimelineEntry; message: string };
planEntryInsert(ds, draft: TimelineEntry, nowMs): InsertPlan
// concurrency = draft.concurrencyOverride ?? category.concurrency (via row.categoryId)
// 'concurrent' → ok. Overlap test uses raw ms (ongoing end = +Infinity).
// autoClose iff: the ONLY overlap is the chronologically-last entry, draft.start.ms > last.start.ms,
// and no other entry extends past draft.start.ms. Otherwise conflict (blocked save).
```
- [ ] Tests: append-after-ongoing → autoClose with closeAt = draft.start; backfill overlap → conflict naming entry; concurrent override → ok; no overlap → ok. Commit.

### Task 5: Public data pipeline

**Files:** `public-data/schema.json`, `public-data/CONTRIBUTING_PROMPT.md`, `public-data/iphone-releases.json`, `src/publicData/namespace.ts`, `src/publicData/loader.ts`

- [ ] `namespace.ts` (TDD): `namespaceDataset(ds, fileStem)` prefixes every id and every reference (groupId, personId, categoryId, rowId, parentRowId, parentEntryId, linkedEntityIds[]) with `pub:<fileStem>:`. Test: no unprefixed references remain; undefined optionals stay undefined.
- [ ] `schema.json`: JSON Schema (draft 2020-12) of TimelineDataset restricted for public data — no `personId`, no `visibility`, no `people`; groups never personId-bearing; entries default shareable/ownerless. `additionalProperties: false`.
- [ ] `CONTRIBUTING_PROMPT.md`: paste-into-LLM template parameterized by topic; states ids only need file-local uniqueness (loader namespaces).
- [ ] `iphone-releases.json`: worked example (one group, one category, one row, iPhone releases 2007→2025, year/day precision mix). Validate against schema in a test using Ajv (dev-dep).
- [ ] `loader.ts`: `import.meta.glob('../../public-data/*.json', { eager: true })`, skip schema.json, namespace each; export `loadPublicDatasets(): TimelineDataset[]`. Commit.

### Task 6: Storage (TDD w/ fake-indexeddb)

**Produces:** `db.ts`: `loadDataset(): Promise<TimelineDataset | null>`, `saveDataset(ds): Promise<void>` (DB "chronicle" v1, store "datasets", key "main"). `exportImport.ts`: `serializeDataset(ds): string`, `validateImport(json: unknown): { ok: true; dataset } | { ok: false; error: string }` — checks schemaVersion === 1 (mismatch → explicit reject message, no silent corruption) and array shapes; `triggerDownload(ds)` (Blob + a[download], works on iOS Safari).
- [ ] Tests: save/load round-trip; import rejects wrong schemaVersion & malformed shapes with messages. Commit.

### Task 7: Store + actions

**Produces:** `store.ts`: `createStore(initial)` w/ `getState/setState/subscribe`, React `useStore(selector)` via `useSyncExternalStore`. State: `{ dataset, publicDatasets, view: { selectedEntryId?, selectedRowId?, draft?, search, filters, pickingFor? }, collapsed groups }` — dataset mutations debounce-persist (250ms) to IndexedDB (private dataset only).
`actions.ts`: named mutations — `updateEntryField`, `commitDraftIfTitled` (insert once title non-empty; runs planEntryInsert; autoClose applies close; conflict returns blocked message), `addRow`, `addSubRow`, `addGroup`, `addPerson`, `updateCategory`, `updatePerson`, `deleteEntryCascade`, `deleteRowCascade`, `deleteGroupCascade`, `deleteCategory` (blocked path), `toggleRowVisibility`, `toggleGroupCollapsed`, `importDataset`.
- [ ] Test: draft not inserted until titled; autoClose applied on commit. Commit.

### Task 8: Time scale + axis ticks (TDD)

**Produces:** `timeScale.ts`:
```ts
interface TimeScale { startMs: number; msPerPx: number }
msToX(s, ms), xToMs(s, x), panBy(s, dxPx), zoomAt(s, anchorX, factor)  // keeps xToMs(anchorX) fixed
clampScale(s)  // msPerPx ∈ [30_000, 2e10]
```
`timeAxis.ts`: tick units day/week/month/quarter/year/decade/century; `computeTicks(scale, widthPx): { fine: Tick[], coarse: Tick[] }` — fine = smallest unit with ≥ 60px spacing, coarse = next larger labeled level; never empty at any zoom. Ticks carry `{ ms, label }`, UTC boundaries.
- [ ] Tests: zoomAt anchor invariance, clamp, two non-empty levels at extreme zooms, week/day labels at deep zoom, year/decade when zoomed out. Commit.

### Task 9: Layout (TDD)

**Produces:** `layout.ts`:
```ts
interface LayoutRow { kind: 'group'|'person'|'row'; y: number; height: number; id: string; depth: number;
                      row?: TimelineRow; person?: Person; group?: Group; isSubRow: boolean }
computeLayout(ds: merged, collapsedGroupIds, hiddenRowIds): { items: LayoutRow[]; totalHeight: number }
```
Heights: group header 32, person header 26, row 40; sub-rows follow their parent row with 4px gap (vs 10px normal); collapsed groups contribute header only; public datasets' groups appended after private groups (merge order guarantees this). personId-groups get NO nested person header.
- [ ] Tests: ordering, collapse, sub-row adjacency + reduced gap, personId-group has no person item. Commit.

### Task 10: Bar geometry (TDD) + canvas engine

**Produces:** `bars.ts` (pure, testable):
```ts
barGeometry(entry, scale, nowMs): { xVisualStart, xSolidStart, xSolidEnd, xVisualEnd, ongoing }
labelAnchorX(geom, textWidth): number   // inside near-opaque span, clamped to viewport
gradientStops(geom): { offset: number; alpha: number }[]  // ONE continuous gradient, no seams
```
`engine.ts`: `TimelineEngine` class (framework-agnostic):
- constructor(canvas, callbacks: { onSelectEntry, onSelectRow, onRequestDraft(rowId, startMs), onPickDate(ms, precision), onScrollSync(scrollY), onViewChange })
- `setData(merged, layout, scale, selection, searchDim, pickMode)` + `requestDraw()` rAF loop
- Virtualization: cull rows by y-viewport, entries by x-range.
- Drawing order per frame: axis header background/border FIRST, then gridlines, then axis text (two levels), then rows (never repaint header after text — regression noted in spec §5).
- Bars: single `createLinearGradient` alpha ramp per bar; `circa` edges get diagonal hatch overlay (offscreen pattern canvas); ongoing → arrow taper at right; label per `labelAnchorX` in contrasting text.
- Inactive band before person birthDate: dimmed diagonal hatch from viewport left to birth x, on all that person's rows.
- Sub-timeline bracket: vertical line from parent entry down through sub-rows + notch across parent bar; attachment resolution: explicit `parentEntryId`, else parent-row entry whose range contains sub-entry start, else nearest parent entry active before it, else no bracket.
- Selection: connector lines (entry → linked entities' entries via linkedEntityIds + parent/child entries) drawn ONLY when selected; unrelated bars dimmed. Search dim: non-matching bars at 0.25 alpha.
- Row selection highlight + "+" affordances: before first, in gaps ≥ 48px on-screen, after last (or at click point for empty rows); hit-testable.
- Input: pointer drag pans BOTH axes; wheel pans both via deltaX/deltaY; ctrl+wheel zooms at cursor; two-pointer pinch zooms at midpoint; `touch-action: none`. Pick mode: crosshair, live vertical guide + date tooltip snapped to zoom-appropriate unit; click commits (ms + precision from snapped unit).
- [ ] Tests for bars.ts math (ramp stop positions incl. fade+fuzz, ongoing, label clamp). Engine verified visually in Task 12. Commit.

### Task 11: React shell — App, CanvasHost, RowRail

- [ ] `App.tsx`: compose SearchBar / rail+canvas / DetailPanel; global keyboard: Esc priority (deselect → cancel pick → close panel — spec order: deselect/cancel-pick/close as stated §6), arrows pan, +/- zoom, all ignored inside inputs.
- [ ] `CanvasHost.tsx`: ResizeObserver + devicePixelRatio; engine lifecycle; feeds store state in.
- [ ] `RowRail.tsx`: real DOM; translateY sync with canvas scroll every frame (callback from engine). Group headers: collapse chevron, "+" menu (Person — only where legal, Category/row), gear only on person-representing headers → PersonEditor. Row lines: visibility checkbox, color swatch + icon, label, add-sub-timeline icon, category gear → CategoryEditor. Hover-reveal controls only under `@media (hover: hover) and (pointer: fine)`; always visible on touch. Mobile (<640px): narrow (56px) semi-translucent rail overlaying canvas, labels collapse to first letter.
- [ ] Live age on person headers (birthDate → computed age). Verify in browser: pan/zoom/pinch smooth, rail sync, headers draw. Commit.

### Task 12: Detail panel + editing flow

- [ ] `PillSelector.tsx` generic (icon + small caption, horizontal row).
- [ ] `DateField.tsx`: text input (UTC parse, manual entry defaults exact/day) + 5-option precision pills + crosshair pick-on-timeline button (arms engine pick mode; commit writes ms + precision together).
- [ ] `DetailPanel.tsx`: view state w/ edit affordance; fields: title, description, start/end DateFields (+ "ongoing" toggle = clear end), fadeIn/fadeOut days, category via row, concurrency override pill, visibility pill, linked entities (add/remove by label with kind pill), parent entry picker for sub-rows. Autosave every change; drafts (from "+"): pre-filled start = previous entry end; inline note when exclusive auto-close will fire ("Saving will close ‹prev› on ‹date›"); conflict message blocks commit. Delete button → cascade confirmation text from describeCascade.
- [ ] Verify full create/edit/autosave/delete loop in browser. Commit.

### Task 13: Search & filter + data menu

- [ ] `SearchBar.tsx`: text search (title/description/linked entity labels) → dim non-matches; filter chips: time range, person, place (entity), category — same dim treatment; row/group checkboxes already hide outright.
- [ ] `DataMenu.tsx`: Export JSON (download), Import (file input → validateImport → confirm replace), and a clearly-marked disabled "Sync via GitHub Gist — planned, unresolved for non-technical users" gap note. Commit.

### Task 14: Deploy + docs + verification

- [ ] `.github/workflows/deploy.yml`: build + upload-pages-artifact + deploy-pages on push to main.
- [ ] `README.md`: what it is, privacy boundary (personal data never in repo), public-data contribution flow, dev commands, v1 scope cuts & known gaps (Gist sync, a11y), timezone convention.
- [ ] Run full verification per spec §Verification: pan/zoom/select/create/edit/autosave e2e in browser; schema validation test green; re-check §5–§6 resolved claims. `npm run build` + all tests. Commit.
