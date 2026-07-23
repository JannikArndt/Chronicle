# Chronicle — Engineering Prompt

This document is a self-sufficient brief for building **Chronicle**, a personal life-timeline web app. It is the output of a discovery session (requirements gathering + an iterated interactive visual prototype) and is meant to be handed to a build session with no further context needed. Where the prototype settled a design question, that decision is stated as final. Where something is explicitly deferred, it says so — don't build it early.

A working visual-language prototype (throwaway HTML/Canvas, no framework) was built and iterated on during discovery. It is not part of this codebase and should not be reused as source — but its resolved interaction and rendering decisions are captured below in full.

## 1. Product summary

Chronicle renders a person's life — and the lives of people around them, and the world — as parallel horizontal timelines on a single shared time axis. Up to ~30 timelines ("rows") are visible at once, each made of one or more entries (bars) with a title, a date range of varying precision, a description, and a link to a parent entry for sub-timelines.

Two audiences for the same rendering engine, no separate "mode" toggle:
- **Browsing**: pan/zoom, search, filter, inspect.
- **Editing**: select a timeline to reveal its own add-affordances in place; the same detail panel used for viewing becomes the editor. There is no modal "Create" screen.

Targets: desktop and mobile browsers, no backend, statically hosted on GitHub Pages.

## 2. Data model

```ts
type Precision = "exact" | "day" | "month" | "year" | "circa";

interface FuzzyDate {
  ms: number;          // reference instant (UTC)
  precision: Precision;
  fuzzDays?: number;    // optional explicit override of the default fuzziness for this precision
}

// default fuzziness per precision when fuzzDays is not set, in days:
// exact: 0, day: 0, month: 15, year: 182, circa: 365

interface Category {
  id: string;
  label: string;
  color: string;            // any CSS color — a native color picker, not a fixed palette
  icon: string;              // any emoji — free-text input, plus a few quick-picks for convenience
  concurrency: "exclusive" | "concurrent"; // default; every entry may override this
  defaultVisibility: "private" | "shareable";
}

interface Person {
  id: string;
  label: string;
  birthDate?: number;   // ms, UTC. If set: time before this on any of their rows renders "inactive",
                         // and their group/sub-group header shows a live computed age.
}

interface Group {
  id: string;
  label: string;
  personId?: string;    // if set, this ENTIRE group IS that person (e.g. "Me") — do not also
                         // nest a person sub-header for it. If unset, the group may contain zero
                         // or more person sub-groups (e.g. "Family" -> "Finn"), each of which is
                         // the future attachment point for importing/subscribing to someone else's
                         // shared "Me" timeline export (see §7).
  collapsed: boolean;
}

interface TimelineRow {
  id: string;
  groupId: string;
  personId?: string;        // set when this row belongs to a person nested inside a personId-less
                             // group (e.g. Finn's "Residence" row inside "Family"). Unset when the
                             // row belongs directly to a personId group (that group's personId applies).
  categoryId: string;
  label: string;
  parentRowId?: string;      // set for a sub-timeline (e.g. "Projects at Kestrel" under "Job")
}

interface Place {
  fullName: string;        // complete address/name as returned by the source (or as typed, if free-text)
  coordinates?: { lat: number; lon: number }; // absent for free-text entries with no picked suggestion
  street?: string;
  city?: string;
  country?: string;
}

interface TimelineEntry {
  id: string;
  rowId: string;
  title: string;
  subtitle?: string;
  shortTitle?: string;        // shown on the timeline bar in place of title when title doesn't fit
  website?: string;           // fetches a favicon (see §5), shown in front of the label
  place?: Place;
  description?: string;
  start: FuzzyDate;
  end?: FuzzyDate;            // absent = ongoing, renders as an open arrow, not a hard stop
  fadeInDays?: number;        // gradual start (e.g. "grew into" a relationship) — visually
  fadeOutDays?: number;       // distinct concept from start/end precision fuzziness, but the
                              // two are combined into one continuous edge (see §5)
  parentEntryId?: string;     // links a sub-timeline entry to the parent entry it nests under
  concurrencyOverride?: "exclusive" | "concurrent"; // overrides the row's category default
  visibility: "private" | "shareable";
}

interface TimelineDataset {
  schemaVersion: number;
  people: Person[];
  groups: Group[];
  categories: Category[];
  rows: TimelineRow[];
  entries: TimelineEntry[];
}
```

Notes carried over from discovery, not obvious from the shapes above:

- **Concurrency** is a per-category *default*, always overridable per entry (`concurrencyOverride`). Adding a new entry to an exclusive row does not silently forbid overlap — it auto-closes the previous entry's end date unless the user overrides it, and the UI must show a note explaining that when it's about to happen (see §6). This auto-close only applies to the common case: appending a new entry after the row's chronologically last entry (i.e. no existing entry already extends past the new entry's start). If the new entry's range would instead overlap an existing entry some other way — backfilling into the row's history, inserting mid-timeline — auto-close does not fire: saving is blocked with an inline conflict message naming the overlapping entry, and the user must either adjust that entry's dates first or set `concurrencyOverride: "concurrent"` on one of the two entries.
- **Sub-timelines** (`parentRowId` on a row, `parentEntryId` on an entry) are just regular rows/entries with a parent reference — no separate data shape.
- **Person vs. group is intentionally asymmetric.** A group can either *be* a person or *contain* persons — never both, and never a person nested under a person. This was a deliberate simplification, not an oversight; revisit only if a real use case needs it (e.g. a person's own sub-people).
- **`visibility`** exists on every entry now so that a future "publish/subscribe" feature (§7) needs no migration — but no sharing mechanism ships in v1.

## 3. Storage & sync

- **Source of truth**: IndexedDB, per device.
- **v1 sync path**: manual export/import of the full `TimelineDataset` as JSON. Must work on iOS Safari — this is the reason IndexedDB (not File System Access API) is primary.
- **v2 (planned, not built now)**: sync via a GitHub Gist the user connects with a personal access token. Flag explicitly in code/comments as incomplete: pasting a PAT is a fine power-user flow but is not a solution for non-technical users, and that problem is still open. Don't invent a workaround for it now — surface it as a known gap.
- **Public/world timeline data**: lives in a `public-data/` folder in this repo as static JSON files, one `TimelineDataset`-shaped file per topic, contributed via PRs. These load at build/runtime as read-only additional datasets merged into the view alongside the user's own private IndexedDB data — never written back.

## 4. Public data contribution (LLM-authored)

Most `public-data/*.json` files will be generated by pasting a prompt into an LLM, not hand-typed. Ship:

1. A JSON Schema (`public-data/schema.json`) validating the `TimelineDataset` shape from §2, restricted to what public data actually needs (no `personId`/`visibility` complexity — public entries are always `shareable` and ownerless).
2. A prompt template (`public-data/CONTRIBUTING_PROMPT.md`) that contributors paste into any LLM, parameterized by topic (e.g. "German chancellors", "iPhone release history"), instructing it to emit a schema-conformant file.
3. One worked example file (e.g. `public-data/iphone-releases.json`) checked in as a reference for both the schema and the prompt template.
4. **Id namespacing on load, not on authoring.** Contributors and the LLM prompt template only need ids to be unique *within* their own file — the loader automatically prefixes every id (and every reference to an id) from a given `public-data/*.json` file with `pub:<filename-without-ext>:` (e.g. `pub:iphone-releases:cat-1`) when merging it into the view. This is what keeps independently authored public files, and public data merged against the user's private dataset, from silently colliding on ids like `cat-1` or `row-3`.

## 5. Rendering

Custom Canvas renderer (not SVG/D3, not a timeline library) with virtualization — only draw rows and entries intersecting the current viewport. This was chosen specifically for pinch-zoom/pan smoothness with ~30 rows on mobile.

**Row header rail** (the left-hand column) is real DOM, not canvas — it needs real buttons, popovers, and a native `<input type="color">` / `<input type="date">`, which canvas can't give you cheaply. It must stay vertically in sync with the canvas's row scroll position (translate the header list by the same scroll delta every frame the canvas redraws).

**Bar rendering, resolved during the prototype:**
- Precision fuzziness and fade-in/out are visually the *same mechanism*: one continuous alpha-ramp gradient across the whole bar (a single `createLinearGradient` fill), not a solid rect plus a separate gradient rect butted against it — the seam between two separately-drawn regions was a visible defect in an earlier iteration and must not reappear.
- `circa`-precision edges additionally get a diagonal hatch texture layered over the fuzzy region.
- The bar's label must remain fully legible regardless of where the fade/fuzz alpha is low — anchor the label inside whichever sub-span of the bar is actually near-opaque (compute the solid span explicitly; don't just place the label at a fixed offset from the bar's nominal edge).
- No end date ("ongoing") renders as a small arrow taper, not a hard-stopped rectangle.
- Sub-timelines render close to their parent row (small gap, not a full row-gap) and share a vertical bracket line: it runs from the parent row's entry down through the sub-row(s), with a short notch drawn across the parent bar itself where the bracket meets it, so the nesting reads as "cut into" the parent rather than merely adjacent. When a sub-entry doesn't set `parentEntryId`, resolve the attachment at render time: use whichever parent-row entry's date range contains the sub-entry's start date, or, absent one, the nearest parent entry active before it; if no parent entry qualifies, draw no bracket for that sub-entry. Setting `parentEntryId` explicitly overrides this and is the only way to attach across non-overlapping ranges.
- A person's rows (resolved via `Group.personId` or `TimelineRow.personId`, see §2) render a dimmed, diagonally-hatched "inactive" band from the left edge of the viewport up to their `birthDate`, if set.

**Time axis**: always shows a coarser and finer tick simultaneously depending on zoom (years, or year+month, or week+day), never blank. This was a real bug in an early build — the header background was being repainted *after* the axis text was drawn, silently erasing it every frame — so when implementing, draw the header background/border first, then gridlines and text on top of it, never after.

**Groups → persons → rows → sub-rows** is the vertical layout hierarchy (§2). Each loaded public dataset (§3–§4) contributes its own top-level groups — defined in that file's `groups` array, never `personId`-bearing — which render as additional top-level groups appended after the user's private groups; combined with the id namespacing in §4, this is where public data lives both visually and in the id space. Group headers and person sub-headers are collapsible (groups; persons are not, in v1). Each group/person header carries:
- a single "+" that opens a small menu offering "Person" (only where a person can legally be added — not inside a personId-having group) and "Category" (adds a new timeline row).
- a gear (⚙) *only* on group headers/person headers that represent a person — opens a popover to edit that person's name and birthdate (native `<input type="date">`).
- Icon buttons (add-sub-timeline, edit-category gear, these add/edit-person controls) are hover-revealed only on devices with real hover (`@media (hover: hover) and (pointer: fine)`); on touch devices (no hover to discover them with) they're visible by default. Keep this split — it isn't an inconsistency to "fix" later.

Row-level controls, always visible in the rail: a visibility checkbox, the category color swatch + icon, the row label, and (row-specific) an add-sub-timeline icon and a category-edit gear (opens color picker + free-text emoji + exclusive/concurrent pill + visibility pill — all live-editable, no fixed swatch/icon palettes).

**Mobile**: the rail is narrower and semi-translucent (not a full drawer hiding the canvas) — row labels collapse to just their first letter (checkbox + color swatch + icon + initial), since full names don't fit and the row is still identifiable by color/icon/initial plus tapping it.

## 6. Interaction

**Pan/zoom** (this took several iterations to get right — implement exactly this, not a simpler subset):
- Mouse or single-finger touch drag pans **both** axes at once (time horizontally, row-scroll vertically) — panning was originally horizontal-only, which was explicitly called out as broken.
- Trackpad/mouse-wheel scroll (no modifier) pans both axes using `deltaX`/`deltaY` directly.
- `Ctrl`+wheel (how browsers report a trackpad pinch gesture) or two-finger touch pinch zooms the time axis, centered on the cursor/gesture midpoint.
- Keyboard: `Esc` (deselect / cancel date-picking / close panel, in that priority order), arrow keys (pan/scroll), `+`/`-` (zoom), all ignored while focus is inside a text input.

**Selecting and creating** (the create/explore mode split was tried and explicitly rejected — do not reintroduce a mode toggle):
- Click a bar → opens/toggles the detail panel for that entry (view state, with an edit affordance).
- Click empty canvas space inside a row's band → selects that row (subtle highlight) and reveals its own contextual "+" buttons: before its first entry, in gaps between entries (only where the gap is wide enough on-screen to be worth a target), after its last entry — or, if the row has no entries yet, a single "+" exactly where the user clicked.
- Clicking a "+" opens the same detail panel, now in a pre-filled draft state: e.g. "add next job" defaults its start to the previous job's end date, and if the row's category is exclusive, shows an inline note that saving will close the previous entry on that date.
- Click elsewhere (empty canvas outside any row, or another bar) clears the current selection.

**Editing fields**: no Save/Cancel buttons — autosave on every field change (Apple-style). A brand-new draft entry is only actually inserted into the dataset once it has a non-empty title; until then, further edits just mutate the in-memory draft. Category and visibility are icon-pill row selectors (icon + small caption label), not `<select>` dropdowns — this project's rule of thumb is **no dropdown for fewer than ~7 options**. Each date field pairs with a 5-option precision pill selector (`exact`/`day`/`month`/`year`/`circa`) using the same icon-pill pattern as category/visibility. Date fields also have a "pick on timeline" affordance (a target/crosshair icon button): activating it arms a picking mode where hovering the canvas shows a live vertical guide line and a floating tooltip with the date under the cursor, snapped to a sensible unit for the current zoom level; clicking commits that date *and* its precision into the field together, from the snapped-to unit. Manual text entry into the date field defaults to `exact`/`day` precision and the user widens it via the pill.

**Connections between entries**: always exist as data (`parentEntryId`), but are only drawn as connector lines when an entry is selected — at rest, no persistent web of lines. Selecting an entry also dims every unrelated bar so the connected ones stand out.

**Search & filter**: text search matches title/description/subtitle/place; non-matches dim rather than disappear (keeps spatial/temporal context legible). Filtering by time range, person, and category should reuse the same dim-not-hide treatment for consistency, plus the existing group/row visibility checkboxes for outright hiding.

## 7. Deferred — reserved in the data model, not built now

- **Publish/subscribe sharing**: eventually, a user should be able to publish a subset of their timelines as a static export that others "subscribe" to, iCal-subscription-style, decentralized, with the original owner staying the source of truth — no publish/subscribe UI ships in v1. **DEPRECATED (2026-07-23):** the `visibility`/`defaultVisibility` field this bullet originally reserved for that purpose has been removed. The planned replacement (see `docs/superpowers/plans/2026-07-23-share-feature.md`) instead lets the user pick which groups/rows to include at share time, with no schema field involved — not yet built.
- **GitHub Gist sync** for non-technical users: still an open problem (see §3). Don't paper over it with a fake solution; leave it as a clearly marked gap.
- **Nested people** (a person containing their own person sub-groups): the data model's group/person asymmetry (§2) doesn't support this. Not needed yet — revisit only if a real scenario demands it.

## 8. Tech stack & hosting

- **React + TypeScript + Vite.** No strong user preference was expressed; this was chosen for ecosystem maturity and straightforward static builds. The canvas rendering engine itself should be a plain, framework-agnostic TS module (it was prototyped in vanilla JS/Canvas) with a thin React shell around it for the rail, panels, popovers, and app state.
- Static build, deployed to GitHub Pages via a GitHub Actions workflow. No backend, no server-rendered anything.

## 9. Gotchas / open risks — call these out explicitly, don't silently skip them

- **Privacy**: this repo may be public. Only `public-data/` is ever repo-tracked; personal entries must never be committed — they live in IndexedDB and user-initiated export files only. Get this boundary right in the project structure from the very first commit (e.g. a gitignored `local-data/` or similar is not even the right shape — personal data shouldn't touch the filesystem/repo at all in the shipped app).
- **Timezones**: exact-time entries need a defined convention (UTC storage, local display) — decide once, document it, and don't let it drift between the picker, the storage layer, and the renderer.
- **Accessibility**: v1 explicitly does not support keyboard-only or screen-reader use — the canvas renderer with mouse/touch input is the only interaction path. This is an accepted v1 scope cut, not an oversight to silently work around; don't build keyboard entry-navigation or a non-visual list view for it.
- **Mobile gesture conflicts**: pinch-zoom and page-level browser zoom/scroll can fight each other if `touch-action` isn't set correctly on the canvas; verify this on a real iOS Safari device, not just a desktop emulator.
- **Undo/delete safety**: autosave (§6) means there's no "cancel" — deleting or badly editing an entry needs its own explicit confirmation or undo path, since there's no draft state to just discard. Deletes also cascade through the data model's parent/child relationships: deleting a `TimelineRow` cascades to its entries and to any sub-rows (`parentRowId` pointing to it, recursively) and their entries; deleting an entry cascades to entries nested under it via `parentEntryId`; deleting a `Group` cascades the same way through its person sub-groups, their rows, and entries. Every cascade shows a single confirmation stating what will be removed (e.g. "This deletes 3 entries and 1 sub-row") rather than deleting silently. Deleting a `Category` is different — it's a shared flat resource, not part of the row/entry tree — so it's *blocked*, not cascaded, while any row still references it via `categoryId`; the UI must show which rows use it and require reassigning or deleting them first.
- **Import validation**: the manual JSON import path (§3) needs to check `schemaVersion` and reject or migrate mismatched files rather than corrupting IndexedDB silently.
- **Performance budget**: validate virtualization actually holds up with 30 rows × dense entries × deep zoom on a mid-range mobile device before considering the renderer done — the prototype was only ever tested with a handful of rows and entries.

## Verification

There's no running app yet — this document is the handoff artifact. Once a build session implements against it: run it, exercise pan/zoom/select/create/edit/autosave end to end, add a public dataset file and validate it against the JSON Schema, and re-check every "resolved during the prototype" claim in §5–§6 against the actual running app before calling any of it done.
