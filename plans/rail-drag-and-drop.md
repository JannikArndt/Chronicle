# Plan: Rail drag-and-drop — reorder rows/groups, move rows between groups

**Effort: large — this is the one non-trivial plan in `plans/`.** From-scratch
feature; no drag-and-drop code exists in `src/` today.
Source TODO: `TODO.md` § "Rail: drag-and-drop reorder + move rows between groups".

Goal: a hover-revealed `≡` handle on each row and group in `src/ui/RowRail.tsx`
that lets you (a) reorder rows within a group, (b) reorder groups, and (c) drag
a row into a different group.

## Decisions already made (don't re-litigate)

- **Hand-rolled Pointer Events**, not native HTML5 DnD (no touch support
  without a polyfill — conflicts with the rail's touch-first treatment) and not
  a library (would be the project's first UI dependency). Use
  `pointerdown`/`pointermove`/`pointerup` + `setPointerCapture` — one code path
  for mouse, trackpad, and touch, same category as the canvas engine's
  pan/zoom handling.
- **No data-model change.** Order is array position in
  `dataset.groups`/`dataset.rows`; `TimelineRow.groupId`
  (`src/model/types.ts:47`) already exists. No `SCHEMA_VERSION` bump.

## Step 1 — state actions (`src/state/actions.ts`)

Two new exported actions next to `updateGroup`/`updateRow`:

- `reorderGroup(groupId: string, beforeGroupId: string | null)` — reposition in
  `dataset.groups`, immediately before `beforeGroupId`, or at the end if `null`.
- `moveRow(rowId: string, targetGroupId: string, beforeRowId: string | null)` —
  set `groupId` and reposition in `dataset.rows`, immediately before
  `beforeRowId` within the target group, or at the end of that group's rows if
  `null`. (Handles within-group reorder too — same-group move is not special.)

Both go through the existing `updateDataset()` (`actions.ts:29-32`), so the
250ms debounced autosave is automatic. Guard against no-ops
(`groupId === beforeGroupId`, row dropped onto its own position) and against
unknown ids (return without mutating).

**Unit-test these** (`src/state/actions.test.ts` or wherever action tests
live — check existing conventions first): reorder to front/middle/end,
move across groups, `null` sibling, self-referential no-op, unknown id.
Pure array logic is exactly what this repo unit-tests.

## Step 2 — drag handle UI (`src/ui/RowRail.tsx`)

Add a `≡` `icon-button` per rail item (group headers and rows) using the
existing `hoverReveal(visible)` helper (`RowRail.tsx:181`) the same way the
other per-row buttons do (e.g. `RowRail.tsx:206`). That gates visibility to
`(hover: hover) and (pointer: fine)` (`styles.css:373-380`) — hidden-until-
hover on desktop, always-visible on touch, for free. No new CSS pattern
needed; if any new rule is required, use `--color-*` variables only.

On the handle: `onPointerDown` starts the drag (`setPointerCapture` on the
handle element), `touch-action: none` on the handle so touch drags aren't
swallowed by scrolling. A click without movement (below a small threshold,
~4px) must not start a drag.

## Step 3 — hit-testing + drop indicator

Each rail item's vertical position comes from `LayoutItem.y`/`.height`
(`src/render/layout.ts:14-25`), applied as inline
`style={{ top: item.y, height: item.height }}` (`RowRail.tsx:178`). During
`pointermove`:

- Convert pointer Y into rail coordinates (mind the engine's `onScrollSync`
  translation — the rail is translated by direct style mutation every frame,
  so prefer live DOM rects via `getBoundingClientRect` over layout math if the
  offset is fiddly).
- Find the candidate item under the pointer and whether the drop lands above or
  below its midpoint.
- Render a thin insertion-line indicator between items showing where the drop
  will land. Keep drag state in React state local to the rail component; the
  indicator is a simple absolutely-positioned element.

Drop resolution rules:
- Dragging a **group handle**: candidates are groups only →
  `reorderGroup(draggedGroupId, beforeGroupId | null)`.
- Dragging a **row handle**: candidates are row slots in any expanded group →
  `moveRow(draggedRowId, targetGroupId, beforeRowId | null)`. Dropping onto a
  group header (or an empty group) means "end of that group" →
  `moveRow(rowId, groupId, null)`.
- `pointerup` outside any valid target, or `Escape`/`pointercancel`, aborts
  with no mutation.

## Scope cuts (flag in the PR/commit message, do not silently solve)

- **Parent rows don't carry sub-rows**: moving a parent row (`parentRowId`
  children via `addSubRow`) to another group leaves its children behind —
  attached but visually orphaned under the old group. This is a known open
  question per TODO.md; ship without it and say so.
- Don't attempt drag of sub-rows, entries, or public-data (`pub:`-prefixed)
  items — public data is read-only. Skip rendering the handle on public items.

## Verification

- `npm test` (new action tests included) and `npm run build` pass.
- Manual via dev server: reorder rows within a group, reorder groups, drag a
  row into another group; reload the page and confirm the order persisted
  (IndexedDB autosave). Confirm plain clicks on rail items still work
  (no accidental drag), and the handle is hidden until hover on desktop.
- E2E-style check if practical: `window.__chronicleStore` exposes the store —
  assert persistence via the store, not DOM text (project convention).
