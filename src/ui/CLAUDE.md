# src/ui — React shell

React shell: rail, detail panel, popovers, search. The rail is DOM and is
translated by the engine's `onScrollSync` callback every frame (direct style
mutation, not React state — intentional). All colors are `--color-*` custom
properties defined on `:root` in `styles.css` with a `@media
(prefers-color-scheme: dark)` override block — never hardcode a hex color in a
new rule; add or reuse a variable instead, or the dark theme silently breaks
for that element.

Events are edited in two places, mirroring entries: `DetailPanel.tsx` splits
into `EntryDetail` and `EventDetail` on desktop, `EventPane.tsx` is the mobile
half. They are separate components rather than one with branches — an event has
a single date, no fades, no short title and no ongoing state, and each of those
would otherwise be an "unless this is an event" in the middle of a field list.
Creating one differs by shell, because the two shells' add idioms differ.
Desktop: `AddEventForm` in `RowRail.tsx`, a two-field popover behind the row's ◆
button, opening on the instant last clicked on that row — the same shape as the
rail's other popovers. Mobile: the **add-entry assistant**, whose last question
("How long did it last?") has "It was a moment" as its third answer; `◆ Add an
event` in `RowPane.tsx` is that same flow opened with the answer pre-picked.
There is deliberately no inline event form on mobile — one add idiom per shell.

**Break out** (a timeline into a group of timelines, one per entry) has four
entry points, deliberately all sitting in the same action list as the matching
delete (in `RowEditor` with hiding between them, since both are ways to make
the row stop being one row):
`RowEditor` in `RowRail.tsx` and the mobile row menu in `TimelineSheet.tsx` for
a whole timeline, `EntryDetail` in `DetailPanel.tsx` and the mobile entry menu
for one entry. All four confirm first with `describeBreakOut()` — the same
shape as `describeCascade()` on the deletes — because there is no undo and this
restructures the tree.

Sharing's contents live in `SharingPanel.tsx` (sign in, invite links, who can
see what, the disclosures) and are rendered by two frames: `SharingMenu.tsx`,
the desktop top-bar popover, and the mobile ⋯ menu's sharing sub-view in
`MobileShell.tsx`. One component rather than two, because the part that would
drift is the text saying published data is server-readable and not recallable.
`InviteLanding.tsx` is the `#/invite/<token>` route. The per-timeline publish
switch is `ShareToggle` in `RowRail.tsx` and a row in `RowPane.tsx` on mobile.
All of it is absent when the build has no Supabase project configured.

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
navigational sheet: `TimelineSheet.tsx`, holding four panes —
`TimelineListPane` (the rail's replacement) → `RowPane` (one timeline) →
`EntryPane` or `EventPane` (the `DetailPanel`'s replacements; siblings at the
same depth, both reached from a timeline and both leading back to it). The add
flows get the *same* primitive through `AssistantSheet.tsx` rather than a modal
overlay, so they
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
  the entry pane, an event selection the event pane, otherwise an opened
  timeline means the row pane, otherwise the list. That is what lets the canvas,
  the list and search all select through the same action and land in the same
  place. `settingsRowId`
  lives in `MobileShell`, above the sheet, because "back from an entry" leads
  to a *place* (its timeline) and not to a history — the entry may have been
  tapped on the canvas, having never visited the timeline at all.
- **No dropdowns under ~7 options** — use `PillSelector`. No Save/Cancel
  buttons — autosave per field change. No browse/edit mode toggle, no modal
  create screen.
- **`DateBlock` right-aligns only when it has a sibling.** The range editor's
  End block hugs the right, above the handle it controls; an event has one date,
  and a lone block sitting hard right reads as a layout bug — hence
  `:last-child:not(:first-child)`.
- **The unhide affordance is never hover-revealed**, for the same reason the
  share toggle is not: it is the only way back for something the user took out
  of the picture, and a control found only by hovering is how a hidden timeline
  stays hidden. It exists only while its container is actually holding
  something back — a `Hidden here` list inside the group's own ⚙, `🙈 n` in the
  rail footer for the top level, `👁 Show …` at the foot of the mobile list.
- **A rail item has exactly one menu, and it is the ⚙.** A group's settings,
  everything you can add inside it, what it is holding back and both ways to
  make it go away all live in `GroupEditor`; there is no second ＋ menu beside
  it. The split is what let "delete group" exist twice, in two menus that
  looked nothing alike. Below the fields, every action is a `.menu-item` with a
  `.menu-item-icon` — one width, one alignment, one hover — so the destructive
  one is told apart by its colour and its position at the end, not by being a
  differently-shaped button. `Done` is the exception on purpose: it dismisses
  the popover rather than acting on the thing, so it sits in `.popover-footer`
  as a button.
- **Rail action buttons are as tall as their row.** `.rail-actions` stretches
  and its `.icon-button`s fill it (`min-width: 26px`, no gap, no padding on the
  row's right edge), so the ≡ and the ⚙ are hit targets rather than glyphs to
  aim at. Every pixel of that comes out of the margin *inside* the row
  background — the row box, its height and the name's position are unchanged.
- **The share toggle stays visible while it is on**, unlike every other
  hover-revealed rail action. "Who can see this" has to be legible at a glance;
  a share control that hides itself is how someone forgets what they published.
- **Read-only checks use `isForeignId`, not `isPublicId`.** Mirrored timelines
  from other people are read-only for the same reason bundled public data is
  (the co-owned case is checked against the mirror's `role` instead). Using
  `isPublicId` for a new read-only check makes someone else's data editable, and
  the edit then goes nowhere.
- **Every label in the rail is the same label.** A group's name and a
  timeline's name share one `font-size` declaration (on the `.rail-group,
  .rail-row` block), carry no colour and no extra weight, and start at the same
  x because the ▸/▾ and a timeline's empty `.rail-row-spacer` share one width
  rule (that slot held a visibility checkbox until hiding moved into ⚙). What says
  "group" is the ▸/▾, the indent of its contents (inline `padding-left` from
  `LayoutItem.depth`), and `.rail-group-band` while expanded. Every attempt to
  say it in the type as well — bold, the group's colour, a size that shrank one
  pixel per nesting level — made two things worse: a collapsed group read as a
  section header when it is standing in for a timeline, and a name's appearance
  depended on where it sat rather than on what it was.
- **A drop target names a container AND a sibling of either kind.** Since
  groups and timelines share one `order` per container (schema v10),
  `computeDropSlots()` emits one "before this child" slot per private rail
  item whatever is being dragged — so a group drops between two timelines and
  a timeline between two groups. There is no longer a per-kind slot function.
- **Rail drag-and-drop targets a container (a group id, or `null` for the
  root), not a fixed level.** `RowRail.tsx`'s `analyzeContainers()` rebuilds,
  purely from the rendered DOM's depth-first order (`data-rail-depth`), which
  private group directly contains each element and where its subtree ends —
  the same reconstruction-from-flattened-list trick `computeLayout()` itself
  relies on. Both groups and timelines can drop at any depth or at the root.
- **Holding Alt/Option while dragging copies instead of moving** (checked live
  via `event.altKey` on every `pointermove`, not just at drag-start, so
  pressing or releasing it mid-drag switches modes). The drop still composes
  with positioning: `copyGroup`/`copyRow` create the duplicate, then
  `moveGroup`/`moveRow` place it at the drop target — a copy is always
  private, regardless of whether the original was shared.

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
  with gating its 🐞 debug panel — see `src/publicData/CLAUDE.md`). Since v9,
  also missing: editing a group's color/emoji/birth date (desktop-only —
  `GroupEditor` in `RowRail.tsx` has no mobile counterpart), moving a group or
  timeline to the root level (`RowPane`'s "Move to group" picker only offers
  existing groups, not "no group"), and copy-via-drag (Alt/Option-drag has no
  touch equivalent).
- **Bar or pin is the last question, not the first.** The FAB flow does not ask
  what kind of thing you are adding up front — "an entry or an event?" is
  vocabulary, not a question anyone has — it asks how long it lasted at the end,
  where "It was a moment" sits beside "Still ongoing" and "It ended". Everything
  before that step is identical for both, which is why the flow has no branch in
  it until `commitAndFinish`.
- **A co-owned mirror is still read-only.** `isForeignId` blocks the edit and
  there is no write-back path, so the "Shared with you" list says editing comes
  later rather than offering it. Don't loosen the `isForeignId` check to "fix"
  this: the edit would land in the store and go nowhere.
