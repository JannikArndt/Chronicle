# Plan: mobile shell — full-bleed canvas, life-strip, sheets

**Effort: large, but cleanly phased.** Six phases, each independently
shippable and revertable. Phases 0–2 are the bulk of the visible win; 3–5 are
the "adding data feels native" half.

This plan is the written half of a design exploration that was reviewed
interactively over several rounds. **The other half is
`plans/mobile-shell-mock.html`** — a throwaway, self-contained mock of the
agreed design. Open it in a phone-sized browser window before implementing
anything: it is the spec for *feel* (sheet physics, gesture thresholds,
transitions) in a way prose cannot be. Every decision below was made against
it, and several were reversals of an earlier attempt.

**Do not port the mock's code.** It is plain DOM with no React, no store, no
persistence; it models time as fractional years instead of UTC ms; and it
re-implements a simplified copy of the renderer. It is a specification of
behaviour, nothing else — the same relationship `POC/` has to `src/`.

## Why we're doing this (keep this in view)

Chronicle is for structuring your life and getting perspective on the years
behind and ahead of you. The eventual payoff is seeing your timeline beside
someone else's — shared on a date, in a sports group, on a company social
network, or to explain who everyone at a party is.

That sets the bar for this work: **using it should feel like Duolingo or
Airbnb, not like a database form.** Anything that makes entering data easier
is worth doing. Nothing should be hidden from the user — it should feel like a
helpful notebook they are completely in control of, without the app saying so
all the time. On mobile today, everything works but everything feels like a
desktop app that shrank.

Target platform for this plan is **Safari on iOS**, on a phone.

## Decisions already made (don't re-litigate)

- **Keep the canvas gestures exactly as they are.** Pan and pinch on the
  canvas is the one part of the current mobile experience that is already
  right. No phase below touches `attachEvents()`'s pointer handling except to
  add a tap threshold (Phase 3).
- **One layout, two renderers stays.** The sheet's row list renders from the
  same `computeLayout()` result the canvas uses, exactly as the DOM rail does
  today. Do not introduce a second traversal of `dataset.groups/rows`.
- **Hand-rolled Pointer Events for the sheet**, not a library, not CSS scroll
  snap. Same reasoning as `plans/rail-drag-and-drop.md`: one code path for
  mouse/trackpad/touch, and no first UI dependency.
- **Mobile is a different shell, not a restyled desktop.** `App.tsx` branches
  once at the top into `<MobileShell>` / `<DesktopShell>`. Resist expressing
  this as ever-growing `@media` blocks — the existing
  `@media (max-width: 640px)` block (`styles.css:894`) is already at the limit
  of what a media query can honestly do, because the information architecture
  itself differs (rows *navigate* on mobile, they *toggle* on desktop).
- **No schema change in any phase.** Everything maps onto types that exist:
  sheet sections → `Group`, ongoing → `end === undefined`, date granularity →
  `Precision`.
- **Desktop is untouched.** Every phase is additive behind the shell branch. A
  desktop regression in any phase means that phase is wrong.

## Rejected during review — do not re-add

These were each built, tried on a real phone, and removed. Re-adding them
would repeat work that has already been paid for:

- **A year · age readout in the top bar.** Tried; unnecessary. The strip plus
  the axis already answer "where am I". The top bar stays minimal.
- **Auto-hiding the life-strip** (appear-on-touch, scrollbar style). Explicitly
  rejected — it stays visible always, even though it costs ~70px.
- **Slider-based and edge-drag date editors.** Three date editors were built
  and compared (handles / sliders / drag-the-bar-edges). **Handles won.** Build
  only handles.
- **Collapsing the minimap to one lane per group.** Built when 30 timelines
  looked crowded, then rejected: every timeline gets its own lane (see
  Phase 2).
- **Visibility toggles in the timeline list.** Replaced by `›` navigation into
  a per-row settings pane, where visibility now lives.
- **A start/end summary above the date editor.** The editor's own two blocks
  already state start and end; showing them twice was noise.

## A note on `Category` (read before Phase 1 and 4)

This plan was written against `6a3d6a0`, where a row's colour and icon come
from its `Category` (`TimelineRow.categoryId` → `Category.color` / `.icon`).
**Categories are being removed from `main`.** Wherever this plan says
"category", substitute whatever now carries a row's **colour** and **icon** —
the requirement is only that a timeline has both, that the settings pane can
change them, and that the canvas, the sheet, and the minimap all read the
same source. Three touchpoints to re-verify at implementation time:

1. Phase 1's row settings pane (the colour/icon control).
2. Phase 2's `miniMapLanes()` (lane colour).
3. The engine's existing `categoryOf(row)` (`engine.ts:470`) and the mirrored
   lookup any new renderer needs.

## Phase 0 — shared primitives

No user-visible change; everything below depends on it.

1. **`src/ui/useIsMobile.ts`** — `matchMedia("(max-width: 640px)")` (OR
   `pointer: coarse`) through `useSyncExternalStore`, same pattern as the
   store. Must react to rotation, so not a one-shot read.
2. **`src/ui/BottomSheet.tsx`** — the reusable pull-up sheet, used by both the
   timeline list and the entry inspector. Props: `anchors: number[]` (px from
   bottom), `initialAnchor`, `closable`, `onClose`, `onPositionChange(px)`,
   `header`, `children`.
   - Drag tracks the finger 1:1 and rubber-bands past both ends: ×0.25 beyond
     the top anchor, ×0.85 below the bottom one when `closable`.
   - Release snaps to the anchor nearest `position + velocity × 170ms`, with
     velocity sampled over the last ~120ms. Transition
     `0.34s cubic-bezier(0.32, 0.72, 0, 1)` — Apple's sheet curve. **A flick
     from the bottom anchor must be able to sail past the middle one**; the
     first attempt snapped to the nearest anchor by position only and was
     immediately called out as "not feeling like iOS".
   - `closable` sheets dismiss when the projected position falls more than
     ~50px below the lowest anchor — i.e. a downward flick throws the sheet
     away, which is a required interaction, not a nicety.
   - **`setPointerCapture` on the drag header retargets the subsequent native
     `click` to the header element**, silently killing taps on buttons inside
     the header (this cost an hour in the mock — it made the inspector's
     tap-to-edit title look broken). On release, when the pointer moved <8px
     in <400ms, re-dispatch `.click()` on the original
     `event.target.closest("button")`. Also skip drag handling entirely when
     `pointerdown` lands inside an `input`/`textarea`, so text fields inside a
     sheet header behave normally.
   - Extract the snap/velocity math into a **pure** `sheetSnap.ts`
     (`nearestAnchor(pos, velocity, anchors, closable)`) and unit-test it. The
     DOM part is not unit-tested, consistent with the canvas painting.
   - Honour `prefers-reduced-motion`: keep the snap, drop the transition.
3. **iOS input-zoom rule** in `styles.css`: a focused `input`/`textarea` under
   16px makes Safari zoom the whole page (reported as "the entire page zooms in
   slightly when I start editing the subtitle"). Every input in a mobile
   surface must be ≥16px — including inputs created dynamically for in-place
   editing, which must copy the font of the element they replace *and* clamp
   it to `max(16px, …)`. **Do not** fix this with `maximum-scale=1` in the
   viewport meta: that disables pinch-zoom for everyone, including users who
   need it.
4. Sheet scroll containers get `overflow-x: hidden`. The date editor's handles
   and the bar's fuzzy edges intentionally overhang their container, and
   without this the sheet scrolls sideways (reported as "the time editing view
   can scroll horizontally, which is weird").
5. All new surfaces must be built in **both themes** from the start — colours
   come from `--color-*` custom properties only, never literals
   (`CLAUDE.md` invariant). The mock is dual-theme; check both.

## Phase 1 — mobile shell + the timeline list as a sheet

1. `App.tsx`: branch on `useIsMobile()`. `MobileShell` renders the canvas
   full-bleed — no `.rail` sibling, no top bar — plus a floating chip row
   (back/menu on the left, `ⓘ`-style overflow on the right) and the FAB.
2. **`src/ui/RowSheet.tsx`** — the rail's content inside a `BottomSheet`,
   anchors `[96px, 45vh, 84vh]`, `closable`. Renders from `computeLayout()`:
   `kind: "group"` items become section headers, `kind: "row"` items become
   rows showing icon, label, entry count, and a `›` chevron. Person items keep
   their sub-header role.
   - Header shows the person and a summary (`b. 1991 · 6 timelines`).
   - **Groups must be visible in this list.** An early version showed a flat
     row list and the missing grouping was immediately noticed.
3. **Rows navigate, they don't toggle.** Tapping a row opens a per-timeline
   settings pane *inside the same sheet* (with a `‹ All timelines` back link,
   and the sheet raising itself to the middle anchor if it was at peek).
   Pane contents, in order:
   - **Group** — shown as a row (making the row's group visible from here was
     specifically requested). A group picker is not yet designed; a read-only
     row plus a "not yet" affordance is acceptable for the first cut.
   - **Show on timeline** — a switch (→ `toggleRowHidden`). This is where
     visibility lives now.
   - **Colour / icon** — see the `Category` note above.
   - **Entries** — the row's entries as links; tapping one opens that entry's
     inspector (Phase 3) directly. This is a genuinely useful path for finding
     an entry that is off-screen in time.
   - **Remove timeline** — `deleteRowWithCascade`, keeping the existing
     cascade-confirmation copy from `cascade.ts`.
4. Flicking the sheet away entirely leaves a small **"🗂 Timelines" pill**
   bottom-left to bring it back. Without it the list would be unreachable.
5. **The FAB rides the sheet's top edge** (`translateY(-(position + 16px))`),
   updated on every `onPositionChange` frame, and fades out once the sheet
   passes ~40% of screen height (and whenever the inspector is open). A
   stationary FAB that the sheet slides under was reported as broken-feeling.
6. `RowRail.tsx` stays exactly as-is for desktop. Extract shared row-rendering
   only where the markup is genuinely identical — a little duplication beats a
   props-explosion component serving two different IAs.

## Phase 2 — the life-strip minimap

The piece that tested best: *"the minimap is amazing, scroll directions, zoom,
everything just works."* Treat its behaviour as settled and be careful with it.

It docks at the **top**, under the floating chips: a whole-life overview with
the current viewport drawn as an accent-outlined window.

1. **`src/render/miniMap.ts`** — pure, unit-tested:
   - `miniMapLanes(layout)` → **one lane per visible timeline**, in layout
     order, each with its colour and its entries' `[startMs, endMs ?? now]`
     spans. No grouping, no roll-up: at 30 timelines each still gets a lane,
     and because rows keep their colour the result reads as coloured bands per
     group. (A group roll-up was built and rejected — see above.)
   - `miniMapMetrics(laneCount)` → `{ pitch, barHeight, height }`. Lanes thin
     out as they multiply: pitch `6.5px` up to 8 lanes, then
     `clamp(78 / n, 2.2, 6.5)`; strip height `clamp(58, n × pitch + 22, 104)`.
     The strip **grows** with the timeline count rather than cramming.
   - `viewportWindow(scale, width)` → the window rect in strip coordinates.
   - Test at 1, 8, 30, and 60 lanes — 60 is where the design gives up, and the
     test should pin what "gives up" means rather than leaving it to chance.
2. **`src/ui/MiniMap.tsx`** — a small canvas painter. It **must** read colours
   through the engine's existing `readThemeColors()` and listen to the same
   `prefers-color-scheme` change event. Do not add a third colour table
   (`CLAUDE.md` invariant).
3. **Engine additions** (`src/render/engine.ts`) — the only new public API in
   this plan, both additive:
   - `EngineCallbacks.onViewChange?: (startMs, endMs) => void`, fired where
     `onScrollSync` already fires, so the window tracks pan and pinch every
     frame.
   - `centerOnMs(ms: number): void` — keeps the current scale and re-centres.
     (`zoomToRange` exists but changes zoom; dragging the strip must not.)
4. Dragging **or tapping** anywhere on the strip flies the canvas there.
   Hiding a timeline removes its lane and re-fits the strip height.
5. **The strip never auto-hides.**
6. The canvas's axis header renders *below* the strip. The engine currently
   assumes the axis starts at `y = 0` (`AXIS_HEIGHT`, `engine.ts:21`); add an
   `axisTop` offset to `EngineInput` (default `0`) and thread it through
   gridline and axis painting. **Keep the axis paint order** — background and
   border first, tick text after (`CLAUDE.md` invariant; the mock reproduces
   this deliberately).

## Phase 3 — the entry inspector sheet

1. **Engine tap discrimination.** `handleClick` must fire on a *tap*, not at
   the end of a pan: single pointer, moved <9px, <350ms. Verify whether the
   current handler already discriminates — if it doesn't, that is a live touch
   bug on desktop touch devices too.
2. **Hit-testing picks the narrowest bar.** Rows are concurrent and entries
   freely overlap, so a tap can land on several. Sort candidates by width and
   take the smallest — otherwise a short entry inside a long one is
   unselectable. Allow a few px of slop, and account for the ongoing-arrow
   overhang past the bar's end.
3. **`src/ui/EntrySheet.tsx`** — the mobile presentation of `DetailPanel`'s
   data. Anchors `[142px, 46vh, 84vh]`, `closable`.
   - **The peek state shows only title and subtitle.** Everything else is one
     pull away. This is the core of the interaction: tap a bar, see what it is,
     pull for detail.
   - When an entry has no subtitle, show its date range as the subtitle
     (formatted per Phase 4) rather than an empty line.
   - Tapping empty canvas dismisses it (confirmed good). Tapping a *different*
     bar swaps the contents without re-animating the sheet. Opening it hides
     the timeline sheet; closing it restores it.
4. **Title and subtitle edit in place** — tap the text, it becomes an input,
   commit on blur/Enter, no Save button (`CLAUDE.md`: no Save/Cancel anywhere).
   Writes go through the existing `updateEntry`, so the 250ms debounced
   autosave is automatic, and the canvas repaints live while typing.
   - The edit affordance is a **visible pencil (✎) at ~15px** in a muted
     colour, next to each editable line. A first version used a smaller,
     fainter glyph and was reported as too small to notice.
5. The selected entry gets an accent outline on the canvas. Check it reads
   clearly at mobile bar heights; adjust the stroke, not the model.
6. `DetailPanel.tsx` stays the desktop surface. Both read the same store
   fields (`selectedEntryId`, `draft`) and call the same actions — no new
   state, no second source of truth.

## Phase 4 — the date editor (handles)

Three designs were built and compared; **handles won**. Build only handles.

1. **`src/model/parseDateInput.ts`** — pure, unit-tested. Typing a date must
   be possible, not just dragging. Accepts `2016`, `Aug 2016`, `6 Aug 2016`,
   `2016-08`, `2016-08-06`, `08/2016`, `6.8.2016`, and `now`/`ongoing`.
   Returns `{ ms, precision }`, `{ ongoing: true }`, or `null`.
   - **The precision of what the user typed sets the field's precision** —
     typing a bare `2016` means year precision. That is the feature, not a
     fallback.
   - `now` is only meaningful as an *end*; as a start it should be refused
     with a hint, not silently accepted.
   - Unparseable input shows a hint of the accepted formats and leaves the
     value untouched — never a silent no-op, never a thrown error.
   - All parsing via `Date.UTC` (`CLAUDE.md`: UTC everywhere; no local-time
     methods anywhere near this file).
2. **`src/model/fuzzyDate.ts`** — add `formatByPrecision(date: FuzzyDate)`:
   year → `2016`, month → `Aug 2016`, day/exact → `6 Aug 2016`, circa →
   `~2016`. **Granularity visibly changes the format.** This is the answer to
   "exactly / around / sometime isn't obvious": the format *is* the feedback,
   so precision stops being an invisible property. Use it for the inspector
   subtitle too.
3. **`src/ui/DateRangeEditor.tsx`** — layout, top to bottom:
   - A **Start block on the left and an End block on the right**, each
     positioned *above the handle it controls*. Each contains: a caption, the
     date (tap to type), and a `Day | Month | Year` segmented control.
   - The **End block also carries the `→ still ongoing` toggle, directly under
     its date** — deliberately adjacent to the value it replaces, not below the
     lane. When ongoing, the end date reads `now →` and its granularity control
     is disabled.
   - Below them, **one lane with two draggable handles**, plus a `now` marker
     and the entry's bar drawn with its live fuzzy edges.
   - **No separate start/end summary above the editor** — that duplication was
     removed.
   - Handles are ≥32px hit targets with `touch-action: none`.
   - A one-line hint: drag a handle, or tap a date to type it.
4. **The lane's range is derived from the entry, not fixed**: `[start − pad,
   end + pad]` with `pad = max(2.5y, span × 1.1)`, and a minimum window so a
   one-month entry doesn't get two handles under one fingertip.
   - Recompute on every **discrete** change (typed date, ongoing toggle) but
     **never mid-drag**, or the lane shifts under the finger.
   - This is a real bug found in review: toggling "still ongoing" moved the end
     to today, outside a lane that stopped in 2016, parking the end handle
     off-screen to the right. **Add a regression test**: after setting
     `ongoing`, the end handle's normalised position is within `[0, 1]`.
5. Granularity maps to `Precision`; the model keeps all its values while the
   mobile UI exposes three. `exact` and `circa` entries (from imports or the
   desktop UI) must render and round-trip without being silently coerced.
6. Wire it into `EntrySheet` (mobile). Leave `DateField.tsx` and the
   pick-on-timeline flow (`armDatePicking`/`commitPickedDate`) alone — that is
   the desktop path and still works.

## Phase 5 — adding an entry

1. FAB → a **six-chip category grid** (a place / a job / a trip / a person / a
   hobby / something else) → a **three-question flow**: name, when, still
   ongoing. Big targets, no keyboard unless the user asks for it.
   - The name step offers **tappable suggestions per category** as well as free
     text, so a whole entry can be added without typing.
   - The when step shows a **live preview bar** whose edges visibly blur as
     precision drops — the same "format is the feedback" idea, in graphic form.
   - "Around 2015" is a first-class answer, never a validation failure.
   - The final step confirms plainly that the entry is saved on this device
     only. Say it once, here — not repeatedly throughout the app.
2. **Reuse the onboarding primitives** — `AssistantStepShell`,
   `useAssistantFlow`, `assistantFlowReducer` (`src/onboarding/`). This is
   exactly what they exist for and it is already the app's established
   conversational-input idiom. New file: `src/onboarding/AddEntryAssistant.tsx`.
3. Respect the Back-across-a-commit-boundary invariant: either create the entry
   only at the end, or make Back update in place (`updateEntry`) instead of
   creating a second one. The former is simpler here — unlike
   `IdentityBirthPlacesAssistant`, there is no identity to establish mid-flow.
4. Choosing the target row: if exactly one row matches the chosen category, use
   it; otherwise ask, or create the row. Don't silently guess.

## Still open (deliberately undecided)

- **Axis position.** It currently sits under the strip. It may belong at the
  bottom, near the thumb. Worth trying on a real device.
- **Group reordering / a group picker** from the sheet — not designed.
- **Minimap beyond ~30 timelines.** Lanes get thin. Grouping was rejected as
  the answer; a density silhouette is the untried alternative.
- **Side-by-side timelines** (the product's eventual payoff) was explored in
  the wider design round and is **out of scope here** — but this shell is the
  thing it will eventually plug into: two stacked canvases sharing one time
  axis, with calendar/same-age alignment. Don't design the shell in a way that
  assumes exactly one canvas.

## Testing

- Vitest, `environment: node`, co-located (`src/**/*.test.ts`) as always:
  `miniMap.ts` (lane assignment and metrics at 1/8/30/60 lanes), `sheetSnap.ts`
  (nearest anchor with and without velocity; the dismiss threshold),
  `parseDateInput.ts` (every accepted format, rejects, `now`-as-start, all
  UTC), `formatByPrecision`, and the date-editor range derivation including the
  ongoing regression above.
- Canvas painting stays untested — only its math is, as today.
- E2E (playwright-core against system Chrome, `channel: "chrome"`, per
  `CLAUDE.md`): drive a mobile-emulated context; assert the inspector opens on
  a bar tap via `window.__chronicleStore` (entry titles are canvas text —
  never assert with `getByText`); assert the sheet lands on its anchors.
- **The real-device gap stays open and this plan widens it.** `CLAUDE.md`
  already notes the iOS Safari gesture check has never been done. Now also
  depending on it: sheet drag vs page scroll, `100dvh` as the URL bar
  collapses, `env(safe-area-inset-*)` on notched devices, and the keyboard
  covering a sheet (`visualViewport` may be needed for the Phase 3/4 inputs).
  Budget a real-device pass before calling any phase done.

## Documentation

`CLAUDE.md` is the project guide and must be updated as part of the merge, not
after it. Add a mobile-shell section under Architecture, and add these to the
hard-won invariants:

- Sheet drag headers must re-dispatch button clicks (pointer-capture
  retargeting), and must ignore `pointerdown` originating in a text field.
- Inputs are ≥16px on mobile or iOS Safari zooms the page; never fix that with
  `maximum-scale=1`.
- The date editor's lane range is recomputed on discrete changes only, never
  mid-drag.
- The minimap reads `--color-*` via `readThemeColors()` like the engine —
  there is no third colour table.
- Canvas hit-testing picks the narrowest overlapping entry.

Delete the now-obsolete `@media (max-width: 640px)` rail rules
(`styles.css:894-929`) once Phase 1 lands, so there is exactly one mobile
story.
