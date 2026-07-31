# Plan: mobile shell — full-bleed canvas, life-strip, sheets

**Effort: large, but cleanly phased.** Six phases, each independently
shippable and independently revertable. Phases 0–2 are the bulk of the visible
win; 3–5 are the "adding data feels native" half.

Source: the mobile design exploration (throwaway interactive mock, six
directions explored, one synthesis chosen). The mock lives outside the repo —
**do not port its code**. It is plain DOM, uses fractional years instead of UTC
ms, has no persistence, and duplicates the render logic. It is a spec of
*behaviour*, nothing more. Same relationship `POC/` has to `src/`.

Goal: on a phone (and specifically iOS Safari), Chronicle stops feeling like a
desktop app rendered small. The canvas gets the whole screen, a life-strip
minimap docks at the top for orientation and one-thumb navigation, and the rail
becomes a pull-up sheet. Tapping an entry pops an inspector sheet whose first
screen is just title + subtitle, editable in place.

## Decisions already made (don't re-litigate)

- **Keep the canvas gestures exactly as they are.** Pan/pinch on the canvas is
  the one part of the current mobile experience that already works. No phase
  below touches `attachEvents()`'s pointer handling except to add a tap
  threshold (Phase 3).
- **One layout, two renderers stays.** The sheet's row list renders from the
  same `computeLayout()` result the canvas uses, exactly as the DOM rail does
  today. Do not introduce a second traversal of `dataset.groups/rows`.
- **Hand-rolled Pointer Events for the sheet**, not a library, not CSS scroll
  snap. Same reasoning as `plans/rail-drag-and-drop.md`: one code path for
  mouse/trackpad/touch, and no first UI dependency.
- **Mobile is a different shell, not a restyled desktop.** `App.tsx` branches
  once at the top into `<MobileShell>` / `<DesktopShell>`. Resist the urge to
  express this as ever-growing `@media` blocks in `styles.css` — the current
  `@media (max-width: 640px)` block (`styles.css:894`) is already at the limit
  of what media queries can honestly do, since the IA itself differs.
- **No schema change in any phase.** Everything maps onto existing types:
  sheet groups → `Group`, row colour → the row's `Category.color`, date
  granularity → `Precision`, ongoing → `end === undefined`.
- **Desktop is untouched.** Every phase is additive behind the shell branch.
  A desktop regression in any phase means that phase is wrong.

## Phase 0 — shared primitives

No user-visible change; everything below depends on it.

1. **`src/ui/useIsMobile.ts`** — `matchMedia("(max-width: 640px)")` (plus a
   `pointer: coarse` OR-clause) wired through `useSyncExternalStore`, same
   pattern as the store. Not a one-shot read: it must react to rotation.
2. **`src/ui/BottomSheet.tsx`** — the reusable pull-up sheet. Props:
   `anchors: number[]` (px from bottom), `initialAnchor`, `closable`,
   `onClose`, `onPositionChange(px)`, `header`, `children`.
   - Drag tracks the finger 1:1, rubber-bands past both ends (×0.25 beyond the
     top anchor; ×0.85 below the bottom one when `closable`).
   - Release snaps to the anchor nearest `position + velocity × 170ms`,
     velocity sampled over the last ~120ms. Transition
     `0.34s cubic-bezier(0.32, 0.72, 0, 1)` — Apple's sheet curve; a flick from
     the bottom anchor must be able to sail past the middle one.
   - **`setPointerCapture` on the drag header retargets the subsequent native
     `click` to the header element**, which silently kills taps on buttons
     inside the header (this cost an hour in the mock). On release, if the
     pointer moved <8px in <400ms, re-dispatch `.click()` on the original
     `event.target.closest("button")`.
   - Extract the snap/velocity math into a **pure** `sheetSnap.ts`
     (`nearestAnchor(pos, velocity, anchors)`) and unit-test it. The DOM part
     is not unit-tested, consistent with how the canvas painting isn't.
3. **iOS input-zoom rule** in `styles.css`: any focusable `input`/`textarea`
   under 16px makes Safari zoom the whole page on focus. Add a global
   `font-size: max(16px, 1em)` for inputs (or a `.no-ios-zoom` utility applied
   in the mobile shell). **Do not** "fix" this with `maximum-scale=1` in the
   viewport meta — that disables pinch-zoom for everyone, including users who
   need it.
4. Sheet scroll containers get `overflow-x: hidden`. The date editor's handles
   and value bubbles intentionally overhang their container and would
   otherwise give the sheet a phantom horizontal scroll.

## Phase 1 — mobile shell + rail as a sheet

1. `App.tsx`: branch on `useIsMobile()`. `MobileShell` renders the canvas
   full-bleed (no `.rail` sibling, no top bar), plus a floating back/menu chip
   row and the FAB.
2. **`src/ui/RowSheet.tsx`** — the rail's content inside a `BottomSheet` with
   anchors `[96, 45vh, 84vh]`, `closable`. Renders from `computeLayout()`:
   `kind: "group"` items become section headers, `kind: "row"` items become
   rows. Person items keep their sub-header role.
3. Rows on mobile **navigate** (`›`) into a per-row settings pane inside the
   same sheet, instead of exposing an inline visibility checkbox. Pane
   contents: group, `Show on timeline` (→ `toggleRowHidden`), category picker
   (this is where colour lives — reuse `PillSelector`, do not build a second
   colour palette; `Category.color` is already a free colour picker in the
   desktop popover), the row's entries as links (→ select the entry), and
   `Remove timeline` (→ `deleteRowWithCascade`, keeping the existing cascade
   confirmation copy from `cascade.ts`).
4. Dismissing the sheet entirely leaves a small "🗂 Timelines" pill bottom-left
   to bring it back. The FAB rides the sheet's top edge
   (`translateY(-(position + 16))`) and fades out past ~40% screen height.
5. `RowRail.tsx` stays exactly as-is for desktop. Extract shared row-rendering
   bits only where it's genuinely the same markup; a little duplication beats
   a props-explosion component that serves two different IAs.

## Phase 2 — the life-strip minimap

The piece that tested best. A whole-life overview docked under the top chips;
the current viewport is an accent-outlined window on it.

1. **`src/render/miniMap.ts`** — pure, unit-tested:
   - `miniMapLanes(layout)` → one lane per visible row, in layout order, each
     with its category colour and its entries' `[startMs, endMs ?? now]` spans.
   - `miniMapMetrics(laneCount)` → `{ pitch, barHeight, height }`. Lanes thin
     out as they multiply: pitch `6.5px` up to 8 lanes, then
     `clamp(78 / n, 2.2, 6.5)`, strip height `clamp(58, n × pitch + 22, 104)`.
     Verified legible at 30 timelines in the mock — every timeline keeps its
     own lane, grouped colour makes it read as bands.
   - `viewportWindow(scale, width)` → the window rect in strip coordinates.
2. **`src/ui/MiniMap.tsx`** — a small canvas painter. It **must** read its
   colours through the engine's existing `readThemeColors()` and listen to the
   same `prefers-color-scheme` change event. Do not add a third colour table
   (`CLAUDE.md` invariant).
3. **Engine additions** (`src/render/engine.ts`) — the only new public API in
   this plan:
   - `EngineCallbacks.onViewChange?: (startMs: number, endMs: number) => void`,
     fired from the same place `onScrollSync` is, so the strip window tracks
     pan/pinch every frame.
   - `centerOnMs(ms: number): void` — keeps the current scale, centres the
     viewport. (`zoomToRange` already exists but changes zoom; dragging the
     strip must not.)
   Both are additive; desktop passes no `onViewChange` and behaves identically.
4. Dragging or tapping anywhere on the strip flies the canvas there.
   The strip does **not** auto-hide — explicitly rejected during the review.
5. The canvas's axis header renders *below* the strip. The engine currently
   assumes the axis starts at `y = 0` (`AXIS_HEIGHT`, `engine.ts:21`); add an
   `axisTop` offset to `EngineInput` (default `0`) and thread it through
   `drawGridlines`/axis painting. **Keep the axis paint order** — background
   and border first, tick text after (`CLAUDE.md` invariant).

## Phase 3 — entry inspector sheet

1. Engine: `handleClick` must only fire on a *tap*, not at the end of a pan.
   Add the same threshold used elsewhere: pointer moved <9px, <350ms, single
   pointer. Check whether the existing handler already discriminates; if not,
   this is a real touch bug on desktop-sized touch devices too.
2. **`src/ui/EntrySheet.tsx`** — mobile presentation of `DetailPanel`'s data.
   Anchors `[142, 46vh, 84vh]`, `closable`. Peek state shows **only** title and
   subtitle; everything else is a pull away. Tapping an empty part of the
   canvas dismisses it (confirmed good in review); tapping a different bar
   swaps its contents without re-animating the sheet.
3. Title and subtitle edit **in place** — tap the text, it becomes an input,
   commit on blur/Enter, no Save button (§6 / `CLAUDE.md`: no Save/Cancel
   anywhere). Writes go through the existing `updateEntry`, so the 250ms
   debounced autosave is automatic. The canvas repaints live as you type.
4. Selecting an entry must show the same accent outline on the canvas that
   the mock draws — check whether the engine's existing selection highlight
   reads clearly at bar heights on mobile; adjust the stroke, not the model.
5. `DetailPanel.tsx` stays the desktop surface. Both read the same store
   fields (`selectedEntryId`, `draft`) and call the same actions — no new
   state.

## Phase 4 — the date editor

The mock A/B/C-tested three designs; **handles won**. Build only that one.

1. **`src/model/parseDateInput.ts`** — pure, unit-tested. Accepts `2016`,
   `Aug 2016`, `6 Aug 2016`, `2016-08`, `2016-08-06`, `08/2016`, `6.8.2016`,
   and `now`/`ongoing`. Returns `{ ms, precision }` or `{ ongoing: true }` or
   `null`. **The precision of what the user typed sets the field's precision** —
   typing `2016` means year-precision, and that is a feature, not a fallback.
   All parsing via `Date.UTC` (`CLAUDE.md`: UTC everywhere, no local-time
   methods anywhere near this file).
2. **`src/model/fuzzyDate.ts`** — add `formatByPrecision(date: FuzzyDate)`:
   year → `2016`, month → `Aug 2016`, day/exact → `6 Aug 2016`, circa →
   `~2016`. The existing `formatFuzzyDate` is used by `DetailPanel`; keep it,
   or migrate both to the new one if the outputs turn out to be the same
   function with different callers.
3. **`src/ui/DateRangeEditor.tsx`** — start and end each get a block containing
   its date (tap to type) and a `Day | Month | Year` segmented control; the
   end block also carries the `→ still ongoing` toggle, adjacent to the date
   it replaces. Below sits a single lane with two draggable handles.
   - Granularity maps to `Precision`; the model keeps all five values, the
     mobile UI exposes three. `exact` and `circa` entries (from imports or the
     desktop UI) must render and round-trip without being silently coerced.
   - **The lane's range is derived from the entry, not fixed**: `[start − pad,
     end + pad]` with `pad = max(2.5y, span × 1.1)`, recomputed on every
     *discrete* change (typed date, ongoing toggle) but **not** mid-drag, so
     the lane doesn't shift under the finger. This is exactly the bug found in
     review — toggling "still ongoing" moved the end to today, outside a lane
     that stopped in 2016, parking the handle off-screen. Add a unit test:
     after `ongoing = true`, the end handle's position is within `[0, 1]`.
   - Handles are 32px hit targets with `touch-action: none`.
4. Wire it into `EntrySheet` (mobile). Leave `DateField.tsx` and the
   pick-on-timeline flow (`armDatePicking`/`commitPickedDate`) alone; they are
   the desktop path and still work.

## Phase 5 — adding an entry

1. FAB → a category chooser (place / job / trip / person / hobby / other) →
   a **three-question flow**: name (with suggestions), when, still-ongoing.
   Big targets, no keyboard unless the user asks for it, a live preview bar
   that grows fuzzy edges as precision changes.
2. **Reuse the onboarding primitives** — `AssistantStepShell`,
   `useAssistantFlow`, `assistantFlowReducer` (`src/onboarding/`). This is
   exactly the machinery they exist for, and it is already the app's
   established conversational-input idiom. New file:
   `src/onboarding/AddEntryAssistant.tsx`.
3. Respect the Back-across-a-commit-boundary invariant: either the entry is
   created only at the end, or Back updates in place (`updateEntry`) rather
   than creating a second one. The former is simpler here — there is no
   identity to establish mid-flow, unlike `IdentityBirthPlacesAssistant`.
4. The chosen category and row: if the user has exactly one row of that
   category, use it; otherwise ask, or create the row. Don't silently guess.

## Testing

- Vitest, `environment: node`, co-located (`src/**/*.test.ts`) as always:
  `miniMap.ts` (lane assignment, metrics at 1/8/30 lanes), `sheetSnap.ts`
  (nearest anchor with and without velocity, close-vs-snap threshold),
  `parseDateInput.ts` (every accepted format + rejects, all UTC),
  `formatByPrecision`, and the date-editor range derivation.
- Canvas painting stays untested, as today — only its math is.
- E2E (playwright-core against system Chrome, `channel: "chrome"`, per
  `CLAUDE.md`): drive a mobile-emulated context, assert the inspector opens on
  a bar tap via `window.__chronicleStore` (entry titles are canvas text — never
  assert with `getByText`), and assert the sheet lands on its anchors.
- **The real-device gap stays open.** `CLAUDE.md` already lists "Real-device
  iOS Safari gesture check (pinch vs page zoom) has never been done". This plan
  multiplies what depends on it: sheet drag vs page scroll, `100dvh` with the
  URL bar collapsing, `env(safe-area-inset-*)` on notched devices, and the
  keyboard covering a sheet (`visualViewport` may be needed for Phase 3/4
  inputs). Budget a real-device pass before calling any phase done.

## Documentation

`CLAUDE.md` is the project guide and must be updated as part of the merge, not
after it. Add a mobile-shell section under Architecture, and add these to the
hard-won invariants:

- Sheet drag headers must re-dispatch button clicks (pointer-capture
  retargeting).
- Inputs are ≥16px on mobile or iOS Safari zooms the page; never fix it with
  `maximum-scale=1`.
- The date editor's lane range is recomputed on discrete changes only, never
  mid-drag.
- The minimap reads `--color-*` via `readThemeColors()` like the engine —
  there is no third colour table.

Delete the now-obsolete `@media (max-width: 640px)` rail rules in
`styles.css:894-929` once Phase 1 lands, so there is exactly one mobile story.
