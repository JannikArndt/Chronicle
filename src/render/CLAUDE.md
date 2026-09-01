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
- **A collapsed group draws one summary bar, not nothing.** `computeLayout()`
  (since v9) emits a synthetic `"group-summary"` `LayoutItem` for a collapsed
  group — spanning the earliest start to the latest end across every entry and
  event anywhere in its subtree, at any depth — and `engine.ts`'s
  `drawGroupSummary()` paints it as one flattened bar in the group's own
  color. No per-entry detail; that's the point of collapsing. The rail skips
  this item kind entirely (`RailItem` returns `null` for it) — there is
  nothing to click or edit on an aggregate.
- **Groups nest arbitrarily deep; `LayoutItem.depth` means "nesting depth of
  the container", for both `"group"` and `"row"` items.** `groupHeaderHeight()`
  and `groupFontSize()` in `layout.ts` step down with depth (with a floor) so
  the rail's indentation and shrinking font size *are* the hierarchy — there
  is no separate two-tier "group vs. sub-group" styling any more.
