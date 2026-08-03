# src/ui — React shell

React shell: rail, detail panel, popovers, search. The rail is DOM and is
translated by the engine's `onScrollSync` callback every frame (direct style
mutation, not React state — intentional). All colors are `--color-*` custom
properties defined on `:root` in `styles.css` with a `@media
(prefers-color-scheme: dark)` override block — never hardcode a hex color in a
new rule; add or reuse a variable instead, or the dark theme silently breaks
for that element.

🌟 Famous people picking is private to `RowRail.tsx` (see pre-release TODOs in
`src/publicData/CLAUDE.md`, since the debug panel and collapse-state issues
live there). 🌍 World events is done — `WorldEventsPicker.tsx`.

## Mobile shell

**Mobile is a second shell, not a restyled first one.** `App.tsx` branches once
on `useIsMobile()` (a width media query) into `MobileShell.tsx`, and no media
query tries to reconcile the two — the information architecture genuinely
differs (a timeline row *navigates* into its own settings pane on mobile,
*toggles in place* on desktop).

The shell is a full-bleed `CanvasHost` with everything else floating over it:
`.mobile-top-stack` (chips, search panel, `MiniMap`) is measured with a
`ResizeObserver` and its height fed to the engine as `axisTop`, so the axis
starts *below* the floating controls instead of behind them.

`BottomSheet.tsx` is the shared primitive (hand-rolled Pointer Events, anchors
+ `sheetSnap.ts` for velocity-aware snapping). There is exactly **one**
navigational sheet: `TimelineSheet.tsx`, holding three panes —
`TimelineListPane` (the rail's replacement) → `RowPane` (one timeline) →
`EntryPane` (the `DetailPanel`'s replacement). The add flows get the *same*
primitive through `AssistantSheet.tsx` rather than a modal overlay, so they
drag, snap and flick away identically and the canvas stays live behind them;
its scrim is invisible and only takes taps while the sheet is raised, where a
tap parks it at peek. Onboarding is the one thing that still takes the whole
screen (`.assistant-overlay`) — it is the only thing happening.

`MiniMap.tsx` is a second canvas painting `src/render/miniMap.ts` (pure,
tested) — one lane per row, plus the current viewport window on *both* axes;
tapping or dragging it calls `engine.centerOnMs()` and
`engine.centerOnLayoutY()`, and it reads the canvas's vertical position from
the `EngineView` the engine reports through `onViewChange`.

`DateRangeEditor.tsx` + `dateLaneRange.ts` are the mobile date editor (two
handles on one lane). Desktop still uses `DateField`.

Search on mobile is the chip itself expanding into a field (`MobileSearchChip`
in `MobileShell.tsx`), with no filters — `SearchBar.tsx` with its filter panel
is desktop-only now.

## Invariants

- **A sheet's whole surface drags, so it must give clicks back**: `BottomSheet`
  treats content `pointerdown` as a *pending* drag and only calls
  `setPointerCapture` once the finger has moved past `CONTENT_DRAG_THRESHOLD_PX`
  downward *and* the list is already scrolled to the top. Capturing eagerly
  retargets the native click and every button inside the sheet goes dead;
  capturing never means the page pulls to refresh instead of the sheet moving.
  Below the top anchor the list gets `.sheet-list-locked` so a drag can't be
  eaten by an inner scroll. Anything inside a sheet that drags on its own axis
  — today only `DateRangeEditor`'s lane — marks itself `data-owns-gestures`,
  which `beginGesture` treats exactly like a text field: the sheet never
  starts a drag there. Without it a few degrees of vertical wobble promoted
  the sheet's pending drag, captured the pointer, and killed the lane's drag
  mid-gesture.
- **Every input on a mobile surface is ≥16px, and the rule that says so is the
  last block in `styles.css`** — iOS Safari zooms the page the moment a
  smaller field takes focus, and an autofocused one means the app *opens*
  zoomed. It used to sit mid-file and name each selector that might outrank
  it; that failed, because a media query adds no specificity and
  `.assistant-input-area input { font-size: 15px }` further down won on source
  order alone. Being last is the whole mechanism — never move it, and never
  "fix" a zoom with `maximum-scale=1`: that takes pinch-zoom away from
  everyone who needs it.
- **The date editor's lane range is recomputed on discrete changes only** — a
  typed date or the ongoing toggle — never mid-drag. Deriving it on render
  moves the lane under the finger on every frame. The regression it guards:
  switching to ongoing throws the end to today and used to park the end
  handle off-screen.
- **"Ongoing" is a value of the end field, not a control beside it.** The
  model still stores it as *no end date*, but an earlier build put a toggle
  next to a field that also accepted "now", so two controls claimed one
  meaning and could visibly disagree. The end field reads `still ongoing`, and
  the only way to reach that state is to edit the field — type it, or tap the
  pill that appears while editing. That pill must `preventDefault` on
  `pointerdown`: blur fires first, commits, and would unmount the pill before
  its own click ran.
- **The mobile pane stack is derived, never stored.** `TimelineSheet` computes
  its pane from the store and from `settingsRowId`: an entry selection means
  the entry pane, otherwise an opened timeline means the row pane, otherwise
  the list. That is what lets the canvas, the list and search all select an
  entry through the same action and land in the same place. `settingsRowId`
  lives in `MobileShell`, above the sheet, because "back from an entry" leads
  to a *place* (its timeline) and not to a history — the entry may have been
  tapped on the canvas, having never visited the timeline at all.
- **No dropdowns under ~7 options** — use `PillSelector`. No Save/Cancel
  buttons — autosave per field change. No browse/edit mode toggle, no modal
  create screen.

## Still open / untested

- Real-device iOS Safari gesture check (pinch vs page zoom) has never been
  done. The mobile shell widened this gap and now depends on it: sheet drag vs
  page scroll, `100dvh` as the URL bar collapses, `env(safe-area-inset-*)` on
  notched devices, and the keyboard covering a sheet (`visualViewport` may be
  needed). Budget a real-device pass.
- Public-data collapse state is in-memory only; private group collapse
  persists.
- `useIsMobile` is a width query only, not `pointer: coarse` — a narrow desktop
  window gets the mobile shell. Left that way deliberately: what actually
  breaks in a 500px desktop window is the *desktop* shell (rail + panel +
  canvas need width that isn't there), and `BottomSheet` is Pointer Events
  throughout, so a mouse can drive it.
- Rail actions still missing on mobile: "＋ Group" (a design gap, not an
  extraction one — creating a group on a phone has no designed home) and 🌟
  Famous people (still private to `RowRail.tsx`; worth extracting together
  with gating its 🐞 debug panel — see `src/publicData/CLAUDE.md`).
