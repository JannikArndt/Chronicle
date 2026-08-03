# Mobile feedback backlog

Everything from the phone-test review of the mobile shell (2026-08-01), one item
per numbered entry. Vocabulary in `docs/GLOSSARY.md`.

Status: `[ ]` open · `[~]` in progress · `[x]` done · `[?]` needs a decision first

**As of 2026-08-02: A–G are all built.** What is left is H3 (a decision, with a
recommendation below), the rest of H4 (design work, not a bug), and H5 — the
real-device pass, which only you can do. `plans/mobile-test-plan.md` is the
script for it.

---

## A. Sheets

**A1 `[x]` A fully-extended sheet slides under the minimap.**
Its top edge should sit *above* the life strip, not behind it. Fix is a z-index
plus a full anchor that accounts for the top stack's measured height.
→ `MobileShell.tsx` (`FULL_ANCHOR_FRACTION`, `axisTop`), `styles.css`

**A2 `[x]` "Ongoing" is modelled honestly but presented confusingly.**
Two separate complaints, one root cause: internally *ongoing* means **no end**,
but the editor shows it as a toggle sitting next to a date field that also
accepts "now" — so two controls claim the same meaning and disagree.

Agreed redesign:
- When there is no end, the **end text itself reads "still ongoing"**. No
  separate toggle is visible.
- Tapping that text to edit reveals a **"still ongoing" button** which fills the
  field with that value. Typing a real date replaces it.
- So: internally still "no end"; to the user, "still ongoing" is simply the value
  the end field holds.
- Consequence: the current bug where the toggle stays lit while you type a date
  disappears, because the toggle no longer exists outside edit mode.
→ `DateRangeEditor.tsx`, `dateLaneRange.ts`, `parseDateInput.ts`

**A2-a `[x]` "still ongoing" was set in the accent colour**, which reads as an
active state rather than as a value. It is `--color-text-muted` now: dimmed
because it is a default, not because it is switched on.
→ `styles.css` (`.date-block-value-ongoing`)

**A2-b `[x]` Dragging a handle died the moment the finger drifted vertically** —
the sheet promoted its pending drag, captured the pointer, and the lane never saw
another event. The lane marks itself `data-owns-gestures`; `BottomSheet` treats
that like a text field and never starts a drag there.
→ `BottomSheet.tsx` (`beginGesture`), `DateRangeEditor.tsx`

**A2-c `[?]` The lane has no orientation.** You can drag roughly two years either
way with nothing saying so, and nothing naming which handle is which. Partly
addressed: the lane now prints its two edge dates beneath it and labels the `now`
marker, so the scale is readable. What is still unsolved is *which end is which*
while dragging — neither of us has a design for it yet. Candidates, none built:
show the dragged value in a bubble above the handle; caption each handle
"Started"/"Ended" under the lane; or move each date block directly above the
handle it controls (which the file header already claims happens, and doesn't).
→ `DateRangeEditor.tsx`

**A3 `[x]` "Connected" is a bad section with a bad name.**
It shows three read-only chips: the entry's **group**, its **row**, its
**person** — i.e. *where this entry lives*, nothing more. There is no
relationship concept behind it; `parentEntryId` (sub-entries) exists in the model
but is not what these chips show. Options: rename to "Timeline" and show just the
row (tappable, navigating to that timeline), or drop the section entirely.
Recommendation: **rename to "Timeline", keep only the row chip, make it tappable.**
→ `EntrySheet.tsx:84`

**A4 `[x]` No confirming action at the bottom of a sheet — only "Remove".**
Users do expect a way to say "I'm finished" and a bottom-anchored destructive
button is a known misfire risk. Recommendation: **no OK button** (it implies
unsaved changes, and everything is already saved), but **move the remove button
out of the scroll flow** — into a small area behind a "…" or at the very bottom
under a divider with a `window.confirm` (which it already has). Closing stays a
drag-down or a tap on the canvas.
→ `EntrySheet.tsx`, `RowSheet.tsx`

---

## B. Timelines sheet (row sheet)

**B1 `[x]` The timeline pane should lead with identity: colour, icon, name — all
three tappable to edit,** as one header block. Today the name is editable but
colour and icon are pick-rows further down the pane.
→ `RowSheet.tsx` (`RowSettingsPane`, `RowAppearance`)

**B2 `[x]` Then the entries list** (already there — just below the header block).

**B3 `[x]` An "add entry" action at the bottom of the entries list,** prefilled
with this timeline and a start year derived from the entries above it: the
highest existing end year, or today if the last entry is ongoing.
Depends on E3 (assistant in a sheet) to avoid a full-screen jump from here.

**B4-a `[x]` Moving a timeline left the pane's header naming the old group.**
It named the row's *person* first and only fell back to the group, and moving a
row changes the group, never the person. Group first now.
→ `TimelineSheet.tsx` (`ownerLabel`)

**B4 `[x]` "Group · moving soon" — decide or delete.**
It is a placeholder I added: a row belongs to a group, moving it between groups
is not designed for mobile, so the field is shown read-only with a tag. It gives
the user nothing. Recommendation: **delete the row entirely** until moving is
designed. Group membership is already visible from the section headers.
→ `RowSheet.tsx:164`

**B5 `[x]` Settings move to the bottom.** Visibility toggle (and anything later)
belongs down with "Remove timeline", not between the name and the entries.

**B6 `[x]` Tapping an entry should navigate *within* the sheet, not swap sheets.**
Today the row sheet closes and the entry sheet opens at a different height, with
no way back. Wanted: the timeline pane slides left, the entry pane slides in from
the right, **in the same sheet at the same height**, with a **back button top
left**. This is the same push-navigation `RowSettingsPane` already does one level
up — it needs to extend one level deeper and absorb the entry sheet's content.
Structurally the biggest item here: `EntrySheet` and `RowSheet` become two panes
of one navigable sheet.

**B7 `[x]` A "show on the timeline" button, top right of the entry pane** —
lowers the sheet to peek and highlights the entry on the canvas. ("Canvas" is our
word; the user-facing phrasing is **"Show on timeline"** or **"Find it"**.)
Needs an engine call to centre on an entry — `centerOnMs()` exists, vertical
centring does not.

---

## C. Minimap

**C1 `[x]` The viewport window ignores vertical scrolling.**
It spans the strip's full height regardless of which timelines are on screen.
With enough rows to scroll vertically it should shrink and move up/down, exactly
as it already narrows and moves horizontally. `viewportWindow()` returns `x0/x1`
only and needs `y0/y1` from the canvas's `scrollY` + visible height against the
layout's total height.
→ `src/render/miniMap.ts` (`viewportWindow`), `MiniMap.tsx`, `engine.ts`

**C1-a `[x]` …and then the window couldn't be dragged vertically at all.**
Following y on every `pointermove` made a sideways scrub jerk up and down (the
strip is ~60px standing in for the whole stack), so the first fix refused
vertical movement except on `pointerdown` — which read as "this axis is dead".
Now the drag engages vertically once the finger passes 6px on that axis, and
follows for the rest of the gesture.
→ `MiniMap.tsx` (`VERTICAL_ENGAGE_PX`)

---

## D. Search

**D1 `[x]` Replace the search toolbar with an expanding button.**
The 🔍 chip should grow into a text field in place; no second bar appearing above
the strip. **Remove the filters entirely.** (Bonus: this shrinks the top stack, so
the axis stops being pushed down when search is open.)
→ `MobileShell.tsx` (`mobile-search-panel`), `SearchBar.tsx`, `styles.css`

---

## E. Adding things

**E1 `[x]` Finish the add-entry flow properly:** a **"Done"** primary action next
to the secondary "Add another", and on Done, **move the canvas to the entry that
was just created** so you see what you made.
→ `AddEntryAssistant.tsx` (`commitAndFinish`, done step)

**E2 `[x]` Present the add flow in a sheet, not full screen.**
First attempt only *looked* like a sheet: a modal overlay with a dimmed backdrop,
bottom-aligned. It didn't drag, didn't snap, and swallowed every gesture, so the
canvas froze exactly when you most wanted to look at it. It uses the real
`BottomSheet` now, through `AssistantSheet.tsx` — same drag, same snap, same
flick-to-dismiss — with an invisible scrim that takes taps only while the sheet
is raised and parks it at peek when tapped.
→ `AssistantSheet.tsx`, `MobileShell.tsx`, `styles.css` (`.sheet-assistant`)

**E3 `[x]` Guided creation of whole *timelines*, not just entries.**
The plural is the product direction. "Bands I played in", "Places I lived",
"Competitions", "Shows I watched", "Supplements I took", "Cars I drove",
"Habits", "Meetups", "Favourite foods", "People", "Schools I went to", "Books I
read".

**Scoped for now: build the flow, not the knowledge.** A guided
"add a timeline" that names the timeline, picks its icon and colour, and then
collects entries one after another — the shape `PlacesTable` already has in
onboarding, which is the closest existing thing: a live-editable table of rows,
each with a label and a year, where row N's start is derived from row N−1's end.
That component solved the two hard problems already (never write inside a
`setState` updater; reflow every later row when an earlier one changes), so it
is the model to follow rather than reinvent.

**Deferred: the domain knowledge** (release years for books and shows, "your
first car was probably at 18", lists of universities). Preferably as bundled
`public-data/`, which keeps the no-backend promise — but out of scope until the
flow itself exists.

**E3-a `[x]` The table zoomed iOS Safari.** Not the table's fault: the ≥16px
input floor was losing on source order to `.assistant-input-area input {
font-size: 15px }`. The floor is the last block in `styles.css` now, which is
what makes it hold. See the invariant in `CLAUDE.md`.
→ `styles.css`

---

## F. Time axis

**F1 `[x]` The axis goes coarse far too early, and can show a nonsense pair.**
Today the fine unit is chosen by "first unit at least 45 px wide" and the coarse
one is 1–2 steps above it, which can produce **decades over quarters** — Q1, with
no way to tell 2015 from 2016. That is a real bug, not just density.

Wanted ladder (title = coarse, subtitle = fine), by visible span:
| Visible span | Title | Subtitle |
|---|---|---|
| < 5 years | year | quarter |
| < 6 quarters | year | month, single letter (J F M A M J J A S O N D) |
| ≤ 2 months | month + year (`April '16`) | first day of each week, as a number |
| ≤ 2 weeks | month + year | day |

Coarse must always be exactly one meaningful step above fine — never two.
→ `src/render/timeAxis.ts` (`pickUnits`, `labelFor`), `timeAxis.test.ts`

---

## G. Bars

**G1 `[x]` Entry labels overflow their bar, cover the next one, and steal its taps.**
Three fixes, in order of importance:
1. **Truncate** the label with an ellipsis to the space actually available —
   today it is drawn at full length past the bar's end.
2. **Stop widening the hit box to cover the label.** `engine.ts:696` does
   `x0: Math.min(x0, labelX)` / `x1: Math.max(x1, labelX + textWidth)` on
   purpose, which is precisely why a long name makes its neighbour unclickable.
3. **Expose `shortTitle` in the mobile sheets** — it exists in the model and on
   desktop, but there is no way to set it on a phone. `pickBarLabel()` already
   swaps to it when the title overflows.
→ `src/render/bars.ts`, `engine.ts:684-702`, `EntrySheet.tsx`

---

## H. Housekeeping

**H1 `[x]` Delete the design mock** `plans/mobile-shell-mock.html` once the items
above have taken what they need from it.

**H2 `[x]` `DataMenu.tsx` and `MobileShell`'s `MobileMenu` duplicate the import
handler** — extract one. Done: it was three copies, counting the rail's ＋ menu.
Now `src/ui/importFlow.ts`.

**H3 `[?]` `useIsMobile` is a width query only**, so a narrow desktop window gets
the mobile shell. Decide whether that is acceptable or add `pointer: coarse`.

**Left as-is, deliberately, and here is the argument** — over to you if you
disagree: the thing that actually fails in a 500px-wide desktop window is the
*desktop* shell. The rail plus the detail panel plus the canvas need width that
isn't there. `pointer: coarse` would keep that broken layout on screen and give
a fine pointer a shell it can't use. The one real cost is that sheet drag with
a mouse is unusual — but it works, because BottomSheet is Pointer Events
throughout and never assumes touch.

**H4 `[~]` Rail actions with no mobile equivalent:** ＋ Group, ＋ Person,
🌍 World events, 🌟 Famous people were all private components inside
`RowRail.tsx`.
- 🌍 World events: **done** — extracted to `WorldEventsPicker.tsx`, now in the
  mobile ⋯ menu. It is a list of checkboxes, so it needed no redesign.
- 🌟 Famous people: still rail-only. Extractable the same way, but it carries
  the Wikidata search *and* the 🐞 debug panel that is itself on the pre-release
  TODO list — worth doing those two together.
- ＋ Group / ＋ Person: not extraction problems but design ones. A row's group
  can now be changed from the row pane's ⋯; *creating* a group or a person on a
  phone has no designed home yet.

**H5 `[ ]` Real-device iOS Safari pass** is still owed: pinch vs page zoom,
`100dvh` as the URL bar collapses, safe areas, keyboard covering a sheet.
