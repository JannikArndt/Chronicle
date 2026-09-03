# src/render — the canvas engine

`engine.ts` is a **framework-agnostic** class — keep it free of React imports.
`timeScale`/`timeAxis`/`layout`/`bars`/`events` are pure and unit-tested. Both the canvas
and the DOM rail render from the same `computeLayout()` result — that shared
layout is what keeps them in sync.

The engine reads its paint colors from the same `--color-*` CSS custom
properties as the DOM (`readThemeColors()`, resolved via `getComputedStyle` on
`:root`) and listens for `matchMedia('(prefers-color-scheme: dark)')` `change`
events to re-resolve and repaint — never hardcode a second color table here, it
will drift out of sync with the DOM theme.

`events.ts` is the whole of "events appear when you zoom in": an opacity ramp
between two and one day per pixel (`eventMarkerOpacity`) and the label
declutter (`layoutEventMarkers`). The engine paints from it and decides nothing
about visibility itself — with one deliberate exception: **a search match is
drawn at any zoom**. Dimming the whole timeline and then showing no match is
search telling a lie, and below the ramp only the matches are drawn, so there
is nothing for them to collide with.

`miniMap.ts` (paired with `src/ui/MiniMap.tsx`) is a second canvas — one lane
per row, plus the current viewport window on both axes. It deliberately draws
no events: it is an overview of spans, and a pin that only exists at high zoom
has nothing to say there.

## Invariants

- **Axis paint order**: header background/border first, then tick text —
  repainting the background after text erased the axis every frame in an early
  build.
- **One gradient per bar**: fuzz and fade are a single `createLinearGradient`
  alpha ramp; a solid rect butted against a gradient rect shows a seam.
- **Engine listeners use `this.eventAbort.signal`**, and `destroy()` aborts
  them — React StrictMode double-mounts reuse the same `<canvas>` node, and
  without the abort a zombie engine keeps handling clicks with a stale scale.
- Drag/wheel pan **both axes**; ctrl+wheel and two-pointer pinch zoom the time
  axis at the cursor/midpoint. `touch-action: none` on the canvas is
  load-bearing for iOS.
- **Canvas hit-testing picks the *narrowest* overlapping entry**
  (`EntryHit.barWidth`, with `TAP_SLOP_PX` of slop). Rows are concurrent, so a
  short bar frequently sits inside a long one; picking the first hit made the
  short one unselectable by thumb. A tap is also bounded in time
  (`TAP_MAX_DURATION_MS`) for touch and pen only — a mouse may legitimately
  rest on a target.
- **Events are hit-tested before bars, and the nearest pin wins.** A pin is a
  few pixels wide and is drawn *on top of* whatever bar it sits over, so
  checking bars first loses every ambiguous tap to the bar behind it. The pin
  head is outlined in the canvas background and its label sits on a plate of
  the same colour — both are drawn over bars of arbitrary colour, and 11px text
  straight onto one is unreadable. `EVENT_PIN_TOP_OFFSET_PX` and
  `EVENT_LABEL_PLATE_HEIGHT_PX` are tuned so the plate ends where a bar label's
  ascender begins; changing one without the other clips the bar's own label.
- **The minimap reads `--color-*` through the engine's own `readThemeColors()`.**
  That function and its `ColorTable` are exported for exactly this reason —
  there is no third color table, just as there is no second one in `engine.ts`.
- **A collapsed group IS a timeline — same item, same height, no band.**
  There is no `"group-summary"` item kind: `computeLayout()` gives a collapsed
  group one `"group"` `LayoutItem` of `ROW_HEIGHT`, carrying
  `summaries: GroupSummaryBar[]` — one bar per DIRECT child (one per child
  timeline, one per child sub-group aggregated recursively over its subtree),
  each labelled and coloured as that child — drawn by `engine.ts` in the
  group's own band, reusing `barGeometry` so an aggregate that is still
  ongoing gets the same open arrow a real entry does. Per-*child* detail,
  never per-entry: that is still the point of collapsing. It stands in for the
  timelines it hides, so it must not read as a section header:
  **`subtreeEndY` is left unset while collapsed**, and that single fact is
  what stops both renderers banding it (the canvas skips `groupBand`, the rail
  emits no `.rail-group-band`). The rail additionally sizes its box to the
  height that group's HEADER would have had while expanded, not to the layout
  item: the name then sits on the first line rather than floating in the
  middle of bars it does not label, and — since `item.y` does not move under
  the toggle either — at exactly the same pixel in both states. Collapsing a
  group must not move its name.
  **`summaries` being set is also the test for "is this collapsed"** — both
  renderers use it rather than re-deriving the `collapsedGroupIds ||
  group.collapsed` rule, which is also what makes a *public* group (collapse
  state lives outside the dataset) behave identically.
  Two rules hold the bars together: **overlapping children are lane-packed in
  time, not pixels** (`packLanes`; `computeLayout` has no access to the scale,
  so lanes can never reshuffle while zooming, and back-to-back children share
  a lane — which is exactly the "Job A, Job B, Job C" case), and **hidden rows
  are excluded** from the aggregate (as a labelled bar of its own, a row
  unchecked in the rail would otherwise be visibly back). Overlap is the one
  thing that breaks "same height as a row": the item grows to
  `lanes × ROW_HEIGHT`, because the alternative is hiding a child.
- **A container's rows and sub-groups are ONE ordered sequence.**
  `pushContainer` walks `orderedChildren()` (`src/model/dataset.ts`, schema
  v10) rather than "every row, then every group", which is what lets a group
  sit above a timeline at any depth. `groupSummaryBars` walks the same list,
  so a collapsed group's bars come in the order its children were in.
- **ONE gap between every pair of items, and every item takes a stripe slot.**
  `ROW_GAP` is the only vertical gap `computeLayout` has: same value between
  two timelines, between a timeline and a group, between a group header and
  its first child, and at every depth and collapse state. There were three
  (a wider `GROUP_GAP_BEFORE`, a tighter `GROUP_HEADER_CHILD_GAP`) and each
  read well on its own, but a stripe boundary falls halfway down a gap, so an
  unstriped row with 10px above and 20px below sat visibly off-centre in its
  own band. For the same reason `rowStripes()` counts EVERY item, an expanded
  header included: skipped, the header and the row above it were both
  unstriped, their bands merged, and that row lost its boundary entirely.
  Together the two rules give one property worth protecting — **every item has
  exactly `ROW_GAP / 2` of air above and below it before the background
  changes** — and `computeLayout` pads the top and bottom of the whole layout
  by that same half-gap so the first and last bands are not cut off.
  `ROW_STRIPES.scope` is `"all"` for the same reason: restarting the count per
  group can put two striped items either side of a boundary.
- **`rowStripes.ts` owns the alternating row backgrounds, and both renderers
  paint from it** — the canvas in `drawRowStripes` (over the WHOLE layout,
  then culled: counting only the virtualized visible items would flip every
  stripe as the user scrolls) and the rail as absolutely-positioned divs.
  `ROW_STRIPES.strength` is applied as `globalAlpha`/`opacity` over the single
  `--color-row-stripe` token, so neither renderer parses a colour.
  `ROW_STRIPES` is a constant, not state: the knobs were live controls in the
  rail long enough to settle them, and what is left is the settled look plus
  the named fields that produced it.
- **Groups nest arbitrarily deep; `LayoutItem.depth` means "nesting depth of
  the container", for both `"group"` and `"row"` items** — and it is what the
  rail indents by, which is most of how the hierarchy reads. There is no
  two-tier "group vs. sub-group" styling, and since the labels were unified
  there is no per-depth type either: `groupFontSize()` is **gone**, and
  `groupHeaderHeight()` is spacing only. A name is a name at every depth.
- **A remembered empty-stretch click overrides the gap heuristic.** Clicking an
  empty stretch of a row remembers that instant (`emptyRowClick`); as long as it
  is still current for that row, `drawPlusAffordances` shows exactly one "+" at
  that point — even on a row that already has entries — instead of the
  first/gap/last heuristic. The spot math itself lives in the pure, unit-tested
  `plusSpots.ts` (`plusSpots()`, `PLUS_RADIUS`, `MIN_GAP_FOR_PLUS_PX`);
  `engine.ts` only paints the returned spots and registers `plusHits`, and still
  owns clamping to `[-PLUS_RADIUS, width + PLUS_RADIUS]` before painting. A pick
  gesture (`EngineInput.picking`) also calls `event.preventDefault()` on
  `pointerdown`, after `setPointerCapture` — otherwise the browser's
  compatibility mousedown pulls DOM focus out of whatever title input the user
  was typing in.
- **The engine can draw its own row/group name labels (`EngineInput.showRowLabels`),
  pinned to the left edge on a plate like an event label** — but only the
  mobile shell turns it on. Desktop already has the DOM rail sitting beside the
  canvas for that; enabling it there would just duplicate every name. Mobile
  has no rail at all (`MobileShell`'s `railContentRef` is a permanent no-op),
  so without this the entries drawn on screen have nothing naming the
  timeline they belong to.
