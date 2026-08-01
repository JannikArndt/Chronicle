# How to test the mobile shell

For testing on a real phone. `npm run dev` already binds to the network, so open
`http://<your-mac's-IP>:5173/Chronicle/` on the device.

Each check says **what to do**, **what you should see**, and — where it matters —
**what would mean it is broken**. Items are grouped by the backlog letter they
came from, so a failure maps straight back to
`plans/mobile-feedback-backlog.md`.

Report failures by number. "F1-c fails" is enough.

**Everything in A–G is now built**, so unlike the last round there is no
"don't test these" list. Export your data first if it matters to you: several of
these checks create and delete things.

---

## Before you start

Use a dataset with **enough timelines to scroll vertically** and at least one row
where **entries sit close together or overlap** — that is where G1 and C1 live. If
your real data doesn't have that, make two or three throwaway entries on one
timeline that start within a year of each other.

---

## The big one: there is only one sheet now

B6 replaced the two sheets (timelines, entry) with **one sheet holding three
panes**: all timelines → one timeline → one entry. Almost everything below
happens inside it, so if this is wrong, much else will look wrong too.

**B6-a — navigating in, and back out**
Timelines list → tap a timeline → tap one of its entries.
✅ The sheet **stays where it is**. It does not close, reopen, or change height.
✅ Each pane slides in from the right; going back slides in from the left.
✅ Top left always shows where back leads: `‹ All timelines` on a timeline,
`‹ 🏠 Places lived` on an entry.
❌ Broken if the sheet drops to a small "peek" height when you tap an entry.
That was the old two-sheet behaviour and is exactly what this replaced.

**B6-b — arriving from the canvas**
Drag the sheet down out of the way, then tap a bar on the canvas.
✅ The sheet comes back showing that entry, at a height that fits its title and
subtitle.
✅ Its back link names **that entry's** timeline, even though you never visited
it. Tapping back goes there.

**B6-c — the height you chose is kept**
Drag the sheet to about half screen, then navigate in and out a few times.
✅ It stays at half screen throughout.

---

## A. Sheets

**A1 — the sheet clears the life strip**
Drag the sheet all the way up.
✅ Its top edge and rounded corners are **in front of** the minimap.
❌ Broken if the strip is painted over the sheet's top.

**A2 — "still ongoing" is a value, not a switch**
Open an entry that has **no end date**.
✅ Under `Ended` the text reads **still ongoing**, in the accent colour.
✅ There is **no** separate "→ still ongoing" button next to it.
Now tap that text to edit it.
✅ A text field opens **and** a small `still ongoing` pill appears below it.
✅ Typing `2019` and pressing Enter sets a real end date; the pill disappears
because the field now holds a date.
Open an entry that **has** an end date, tap the date, tap the `still ongoing`
pill.
✅ The end is removed, the field closes, the text reads `still ongoing`, and the
bar on the canvas grows an open right edge.
❌ Broken if tapping the pill does nothing, or leaves the old date in place —
that is a focus/blur ordering bug, and worth reporting exactly.
Also try typing the words: `now`, `ongoing` and `still ongoing` should all work.

**A2-b — the end handle on an ongoing entry**
Same entry, now look at the lane below the two date blocks.
✅ **Dragging** the right-hand handle leftwards ends the entry there — the text
stops saying `still ongoing` and shows that date.
✅ A single **tap** on the lane does *not* end it. (This is deliberate: with the
toggle gone, that handle had to do something, but a stray tap must not quietly
end something that is still going.)

**A4 — the ⋯ menu**
✅ A round ⋯ button top right on the timeline and entry panes.
✅ Tapping opens a small card; "Remove…" is red.
✅ Tapping the greyed area behind it closes the menu **without** removing
anything.
✅ Removing still asks for confirmation first.
❌ Broken if the menu opens behind the dimmed backdrop and cannot be tapped.

**A4b — the menu is not there when it should not be**
Open a **public** entry (world events / famous people).
✅ No ⋯ at all — nothing there is yours to remove.
Drag a new entry on the canvas without naming it (a draft).
✅ No ⋯ either.
On the list of all timelines:
✅ No ⋯ either — there is nothing that applies to the whole list.

---

## B. The timeline pane

**B1 — identity first**
Tap a timeline in the list.
✅ Top row: the icon in a rounded box, a round colour dot, then the name.
✅ Tapping the icon opens a grid; picking one changes the bar's icon.
✅ Tapping the colour dot does the same for colour — and the **bars on the canvas
change immediately**, without closing the sheet.
✅ Tapping the name turns it into a text field.
✅ The header above shows **whose** timeline it is (your name, or the group's) —
not the timeline's own name, which is right there and editable.

**B3 — adding an entry from here**
Scroll to the bottom of a timeline's entries.
✅ A dashed `＋ Add an entry` row.
✅ Tapping it opens the add flow **already knowing the timeline** — it never asks
"which timeline should it go on?" and never shows the six category chips.
✅ The year slider starts at the year the last entry **ended** (or today, if the
last one is still ongoing).
❌ Broken if it asks for a category, or starts the slider in the middle of your
life regardless of the timeline.

**B4 — moving a timeline between groups**
Needs **two or more of your own groups** to appear at all.
⋯ → "Move to another group…".
✅ A list of your groups, current one ticked.
✅ Picking a different one moves the timeline: it jumps to that group's section
in the list, and on the canvas.
✅ With only one group, the menu item is absent (not greyed out — absent).

**B5 — settings are out of the way**
✅ The visibility toggle lives in ⋯ as "Show on timeline", with a ✓ when on.
✅ Toggling it hides the row from the canvas *and* from the minimap.
✅ There is no `Settings` section and no bottom "Remove" button in the pane.

**B7 — show on timeline**
Open any entry. Its top bar has a `Show on timeline` pill next to ⋯.
✅ Tapping it drops the sheet to its smallest height and **moves the canvas so
the entry is centred** — horizontally *and* vertically.
✅ The entry stays selected, and its title is still readable in the sheet's
header.
❌ Broken if it only scrolls sideways and you have to hunt for the row.

---

## C. Minimap

**C1 — the window has a height now**
You need more timelines than fit on screen for this to mean anything.
✅ The orange window on the strip is **shorter than the strip**, covering only
the timelines currently on the canvas.
✅ Dragging the canvas up and down moves the window up and down with it.
✅ Scrolled to the very bottom, the window's lower edge sits on the strip's last
lane and stops.
✅ If every timeline fits on screen, the window is full height again — correctly,
because you *are* looking at all of them.

**C1-b — tapping navigates in both directions**
Tap near the bottom-left of the strip.
✅ The canvas jumps both back in time **and** down to those timelines.

---

## D. Search

**D1 — the chip becomes the field**
Tap 🔍 Search.
✅ The chip itself **grows into a text field** in the same row as ⋯.
✅ No second toolbar appears above the strip, and the strip and axis do **not**
move down.
✅ Typing emphasises matching entries and dims the rest.
✅ There are **no filter controls at all** any more.
✅ ✕ closes it and clears the query, so nothing is left dimmed.
✅ Closing it with text still in it: the collapsed chip shows the query, not the
word "Search".
❌ Broken if the page zooms in when the field takes focus — that is the 16px
font rule, and it is a hard bug.

---

## E. Adding things

**E1/E2 — the add-entry flow**
Tap the ＋ button.
✅ It opens as a **sheet from the bottom**, with the canvas still visible above
it — not a full screen.
Go through to the end.
✅ The last step offers **Done** (filled, primary) and **Add another**
(secondary), in that order.
✅ Tapping **Done** closes the flow, **moves the canvas to the entry you just
made**, and opens it in the sheet.
❌ Broken if Done just closes and leaves you looking at an unchanged screen —
that is the whole point of the change.

**E3 — creating a whole timeline**
Timelines list → scroll to the bottom → `＋ New timeline`.
✅ Step 1: ten suggestions ("Places I lived", "Bands I played in", …) plus a
free-text field. Picking a suggestion also picks its icon.
✅ Step 2: a live preview chip, an icon grid and a colour row. Changing either
updates the preview.
✅ Step 3: a table with `From` and `To` columns, one blank row.
✅ Typing a name and a year, then tapping away, **saves it immediately** — the
bar appears on the canvas behind the sheet — and a new blank row appears below.
✅ Leaving `To` empty makes it ongoing.
✅ Clearing a row's name deletes that entry (the bar disappears).
✅ **Done** closes the flow and opens the new timeline's pane, listing what you
just entered.
❌ Broken if any entry is created **twice**. That is the setState-updater trap
this table was written to avoid, and it is the single most important thing to
watch for here.
Note: no domain knowledge yet — it will not know when Harry Potter came out.
That is deliberate and deferred.

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
❌ Broken if the title row is empty. That was the original bug.

**F1-b2 — years shorten before they give up**
Zoom so about 10–14 years fill a phone screen.
✅ Subtitles read `'12 '13 '14 …` rather than jumping straight to decades.
✅ Zoom in a little more and they spell themselves out as `2012 2013 …`.

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
✅ It selects, and the sheet shows **that** entry — not its neighbour.

**G1-c — slivers stay tappable**
Find a very short bar with clear space after it.
✅ Its name is drawn past the bar into the empty space, and tapping the **name**
selects it. (Deliberate — the label is part of the tap target, it just cannot
reach past a neighbour any more.)

**G1-d — no lonely ellipsis**
Zoom until bars are very narrow.
✅ Bars too small for a real label show **no text at all**, not a `…` on its own.

**G1-e — short names**
Open an entry with a long title. Scroll to `Short name` and type something brief.
✅ When the bar is too narrow for the full title, it shows the short name
instead — and shows the full one again when there is room.

---

## H. Housekeeping you can see

**H4 — world events on a phone**
⋯ (top right of the screen, not of the sheet) → `🌍 World events…`.
✅ The same checkbox list the desktop rail offers; ticking one adds those bars.
Still missing on mobile, knowingly: ＋ Group, ＋ Person, 🌟 Famous people.

---

## Regressions to watch for

These are the things most likely to break, none of which were touched
deliberately:

1. **Buttons inside a sheet still work.** Every tap target in a sheet — icons,
   colours, menu items, entries, the new `＋ Add an entry` — must respond on the
   **first** tap. The sheet's whole surface is a drag handle, so this has broken
   before.
2. **Dragging the sheet still works from its content**, and dragging a
   *scrolled* list scrolls the list instead of moving the sheet.
3. **Dark mode.** Switch the phone to dark and re-check: the ⋯ menu, the colour
   dot, the axis, the new `Show on timeline` pill, the `still ongoing` text and
   the dashed `＋ Add an entry` row. Anything invisible means a hardcoded colour
   slipped in.
4. **Desktop is unchanged.** Open the same dataset in a desktop browser: the
   rail, the detail panel and its Remove button, the Data menu's import, and the
   rail's ＋ menu (which now shares its import and world-events code with
   mobile). The axis and bar-label changes *do* apply to desktop — intended — so
   check the axis there too, where it is easier to read.
5. **Onboarding is still full screen.** Only the add flows became sheets. ⋯ →
   "Replay setup assistant" must still take the whole screen.
