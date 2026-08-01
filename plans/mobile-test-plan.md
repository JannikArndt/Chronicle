# How to test the mobile shell

For testing on a real phone. `npm run dev` already binds to the network, so open
`http://<your-mac's-IP>:5173/Chronicle/` on the device.

Each check says **what to do**, **what you should see**, and — where it matters —
**what would mean it is broken**. Items are grouped by the backlog letter they
came from, so a failure maps straight back to
`plans/mobile-feedback-backlog.md`.

Report failures by number. "F1-c fails" is enough.

---

## Before you start

Use a dataset with **enough timelines to scroll vertically** and at least one row
where **entries sit close together or overlap** — that is where G1 and C1 live. If
your real data doesn't have that, make two or three throwaway entries on one
timeline that start within a year of each other.

---

## A. Sheets

**A1 — the sheet clears the life strip**
Drag the Timelines sheet all the way up.
✅ Its top edge and rounded corners are **in front of** the minimap.
❌ Broken if the strip is painted over the sheet's top, or the sheet's corners
disappear behind it.

**A3 — the link up to the timeline**
Tap a bar on the canvas to open the entry sheet.
✅ Above the title: `‹ 🏠 Places lived` — the icon and name of its timeline.
✅ Tapping it closes the entry sheet and opens that timeline's pane.
✅ The old "Connected" section with grey bubbles is **gone**.
❌ Broken if the link shows the wrong timeline, or the sheet lands on the list of
all timelines instead of that one's pane.

**A4 — the ⋯ menu**
On both the entry sheet and a timeline's pane:
✅ A round ⋯ button top right.
✅ Tapping opens a small card; "Remove…" is red.
✅ Tapping the greyed-out area behind it closes the menu **without** removing
anything.
✅ Removing still asks for confirmation first.
✅ No "Remove" button at the bottom of the pane any more.
❌ Broken if the menu opens behind the dimmed backdrop and cannot be tapped —
that is a z-order regression, note it exactly.

**A4b — the menu is not there when it should not be**
Open a **public** entry (world events / famous people).
✅ No ⋯ at all — nothing there is yours to remove.
Drag a new entry on the canvas without naming it (a draft).
✅ No ⋯ either.

---

## B. The timeline pane

**B1 — identity first**
Timelines sheet → tap a timeline.
✅ Top row: the icon in a rounded box, a round colour dot, then the name.
✅ Tapping the icon opens a grid of icons; picking one closes it and the bar's
icon changes.
✅ Tapping the colour dot does the same for colour — and the **bars on the canvas
change colour immediately**, without closing the sheet.
✅ Tapping the name turns it into a text field.

**B4 — moving a timeline between groups**
Needs **two or more of your own groups** to appear at all.
⋯ → "Move to another group…".
✅ A list of your groups, current one ticked.
✅ Picking a different one moves the timeline: it jumps to that group's section
in the list behind the sheet, and on the canvas.
✅ With only one group, the menu item is absent (not greyed out — absent).
✅ "Group · moving soon" is gone.

**B5 — settings are out of the way**
✅ Order in the pane: identity → `Entries · n` → the entries → `Settings` →
"Show on timeline" toggle.
✅ Toggling it hides the row from the canvas *and* from the minimap.

---

## F. The time axis — read the labels, this is the fiddly one

Zoom with a two-finger pinch. At **each** step check the two rows of text under
the minimap: the **title** (larger, upper) and the **subtitle** (smaller, lower).

**F1-a — decades**
Zoom out to see 40+ years.
✅ Titles are decades (`2000`, `2010`), subtitles are years.

**F1-b — the bug that started this**
Zoom so that roughly **2012 to 2019** fills the screen — no decade boundary
anywhere on screen.
✅ A title `2010` is **pinned at the left edge**, and stays there while you pan.
✅ It slides away and hands over as `2020` scrolls in from the right.
❌ Broken if the title row is empty. That was the original bug.

**F1-c — under five years**
Zoom until about 3–4 years fit.
✅ Titles are years, subtitles are `Q1 Q2 Q3 Q4`.
❌ **Broken if you ever see a quarter under a decade title** — a `Q1` with no year
anywhere. Report the zoom level if you manage it.

**F1-d — under six quarters**
Zoom to roughly a year.
✅ Titles are years, subtitles are single letters: `J F M A M J J A S O N D`.

**F1-e — under two months**
✅ Titles read `April '16`.
✅ Subtitles are the dates weeks start on: `6 13 20 27`.

**F1-f — under two weeks**
✅ Titles still `April '16`, subtitles are every day: `1 2 3 4 5…`.

**F1-g — never blank**
Pinch slowly from fully zoomed out to fully zoomed in, and back.
✅ **Both** rows of text are populated the entire way. No blank frame at any
point, in either direction.

---

## G. Entry labels on bars

Use a timeline where entries sit close together.

**G1-a — no more spilling**
✅ A long entry name stops before the next bar begins, ending in `…`.
❌ Broken if any name is drawn across the bar to its right.

**G1-b — the actual complaint**
Find an entry that a longer neighbour's name used to cover. Tap it.
✅ It selects, and the entry sheet shows **that** entry — not its neighbour.

**G1-c — slivers stay tappable**
Find a very short bar with clear space after it.
✅ Its name is drawn past the bar into the empty space, and tapping the **name**
selects it. (This is deliberate — the label is part of the tap target, it just
cannot reach past a neighbour any more.)

**G1-d — no lonely ellipsis**
Zoom until bars are very narrow.
✅ Bars too small for a real label show **no text at all**, not a `…` on its own.

---

## Regressions to watch for

These are the things most likely to break from the changes above, none of which
were touched deliberately:

1. **Buttons inside a sheet still work.** Every tap target in a sheet — icons,
   colours, toggles, entries — must respond on the first tap, not the second.
   The sheet's whole surface is a drag handle, so this has broken before.
2. **Dragging the sheet still works from its content**, and dragging a
   *scrolled* list scrolls the list instead of moving the sheet.
3. **Dark mode.** Switch the phone to dark and re-check the ⋯ menu, the colour
   dot and the axis. Anything invisible means a hardcoded colour slipped in.
4. **Desktop is unchanged.** Open the same dataset in a desktop browser: the
   rail, the detail panel and its "Remove" button should be exactly as before.
   The axis and bar-label changes *do* apply to desktop — that is intended —
   so check the axis there too, where it is easier to read.

---

## Not built yet — don't test these

A2 (still-ongoing as a value), B3 (add entry from a timeline), B6 (back
navigation between the two sheets), B7 (show on timeline), C1 (minimap vertical
window), D1 (search), E1/E2/E3 (the add flows). Tapping an entry inside a
timeline pane still swaps sheets with no way back — that is B6, known.
