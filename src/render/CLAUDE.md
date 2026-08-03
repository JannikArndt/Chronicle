# src/render — the canvas engine

`engine.ts` is a **framework-agnostic** class — keep it free of React imports.
`timeScale`/`timeAxis`/`layout`/`bars` are pure and unit-tested. Both the canvas
and the DOM rail render from the same `computeLayout()` result — that shared
layout is what keeps them in sync.

The engine reads its paint colors from the same `--color-*` CSS custom
properties as the DOM (`readThemeColors()`, resolved via `getComputedStyle` on
`:root`) and listens for `matchMedia('(prefers-color-scheme: dark)')` `change`
events to re-resolve and repaint — never hardcode a second color table here, it
will drift out of sync with the DOM theme.

`miniMap.ts` (paired with `src/ui/MiniMap.tsx`) is a second canvas — one lane
per row, plus the current viewport window on both axes.

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
- **The minimap reads `--color-*` through the engine's own `readThemeColors()`.**
  That function and its `ColorTable` are exported for exactly this reason —
  there is no third color table, just as there is no second one in `engine.ts`.
