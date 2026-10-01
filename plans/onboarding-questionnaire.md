# Onboarding questionnaire — plan

Design doc for the `onboarding-questionnaire` skill (`.claude/skills/onboarding-questionnaire/SKILL.md`).
Product decisions only, never anyone's personal data. The clickable reference is
`plans/onboarding-prototype.html` — open it in a browser; every name and place in it is an
invented example.

```
✅ Discovery: done
✅ Story: "a life you'd have to type in" → "your life, drawn, in a few minutes"
✅ Blueprint: 8 screens confirmed (name + 7 topics), fixed order
✅ Copy: drafted in the prototype, see "Copy" below
✅ Implementation: built 2026-10-01 — see "What was built"
```

## Goal

Chronicle becomes useful once a person has entered a few anchor timelines about
themselves — where they lived, learned, worked, who they were with, their kids. That is
the expensive part. Onboarding should make entering exactly those anchors quick and
pleasant, mobile first, and end with the person looking at their own life on the canvas.

## Story

- **Before**: the anchors live in memory, CVs, photo dates. Typing them as dates into
  forms is tedious, so people stop after one timeline.
- **After**: in a few minutes the canvas shows places, education, work, relationships and
  family against their own age, and every later entry has something to line up with.
- **Benefits (all true of the app as built)**: see your whole life on one line per topic;
  see what you were doing when each child was born; add details later by tapping a bar.

## Decisions (confirmed with the owner, 2026-10-01)

1. **One topic per screen, fixed order, same at every age.** No question deck that
   collects counts first and asks for details later (that was tried and rejected: it breaks
   the topic in two). Age never reorders or hides screens.
2. **No counts.** Items are added one at a time ("＋ Add a child", "＋ Job").
3. **Ages and years side by side** everywhere a time is chosen ("from 20 · 2006").
4. **One sequence editor** (Strip + List) for every "one thing after another" topic:
   places, education, work, partners.
5. **The birth screen** is an age slider with an ageing figure, plus ‹ › year nudges and an
   optional month ("Birthday still to come this year? ＋ Add month"). No "18 in 2004"
   milestone line.
6. **Kids are groups** (a person = a group with a birth date), inside a "Family" group,
   each with a name. **Grandchildren** nest inside their parent's group.
7. **Partner and grandchildren screens are in.**
8. **The live preview** at the bottom of every screen stays — the owner singled it out.

## Flow

| # | Screen | Prompt | Input | Creates |
|---|--------|--------|-------|---------|
| 0 | Name | What should we call your timeline? | text (existing step) | self `Group`, sets `selfGroupId`, "Places lived" row (`completeIdentityStep`) |
| 1 | Born | When were you born? | age slider + figure, ‹ › year, optional month | `birthDate` on the self group |
| 2 | Lived | Where have you lived? | sequence editor, no gaps, no end | entries on "Places lived" |
| 3 | Learned | School and after | sequence editor + add buttons, gaps, end | "Education" row + entries |
| 4 | Worked | Where have you worked? | sequence editor + add buttons, gaps, end | "Work" row + entries |
| 5 | Partner | Who have you been with? | sequence editor + text field, gaps, end ("Still together") | "Relationships" row + entries |
| 6 | Kids | Do you have kids? | ＋ Add a child rows (name, birth-year slider) or "No kids" | "Family" group, one sub-group per child with `birthDate` |
| 7 | Grandkids | Any grandchildren? | only if ≥1 kid: rows (whose child, name, year) or "None" | sub-group inside the parent's group |
| — | Finish | "Draw my timeline →" | | closes the overlay, canvas framed on birth → now |

Every screen keeps "Skip for now", which moves to the **next** screen (the last screen's
skip finishes). Skipping never deletes what was already committed. Screen 7 is not shown
at all when there are no kids; screen 6 then carries "Draw my timeline →".

## Screen specs

### 1 · Born
- Big age number, "born 1986" between ‹ › buttons (one year per tap — the slider moves
  ~3 px per year on a phone, too fine to hit exactly), slider 0–100 years, right = older.
- Ageing figure on a canvas: baby sitting (<2), child proportions growing to 18 (bigger
  head, shorter legs), adult, hair greying from 40 and white by ~80, glasses from 44,
  stoop from 66, cane from 78. Pure pose function, painted with CSS-variable colours.
- "Birthday still to come this year? ＋ Add month" opens 12 month pills (a grid of pills,
  not a dropdown). With a month the age is exact: later than the current UTC month →
  one year younger; same month → "Birthday this month: 39 or 40 until then."
- Stored: `birthDate = Date.UTC(year, month ?? 0, 1)`. Known limitation: `Group.birthDate`
  has no precision, so a year-only answer reads as 1 January — which is exactly why the
  month link exists. A precision field is out of scope.

### 2 · Lived — and the sequence editor (shared by 2–5)
**Model.** A sequence is `items[]` (each: label, `at` = age in whole years when it starts,
`gap` flag, optional link to the entry it was loaded from / committed to, place details)
plus `end` (age, or `null` = still going). Item N lasts until item N+1 starts; the last
until `end` or now. Starts are strictly increasing, all within 0…age.
- Places: first item starts at birth (fixed), no gaps, no end (the last place is ongoing).
- Education / Work / Partner: free first start, gaps allowed, optional end.

**Strip view** (default): one bar from birth to now, age ticks above, year ticks below
(ticks every 2/5/10 years by age). Segments in the row's colour, alternating shade,
labels clipped; the last segment has the open-arrow end when ongoing; gaps are dashed and
transparent. Each boundary is a knob on a stem below the bar (`role="slider"`, arrow keys
±1 year, pointer capture, `touch-action: none`); with a free start there is a start knob,
with an end there is an end knob. Knobs closer than 32 px drop to a second row instead of
overlapping. A line under the strip says what the drag means ("Moved to Utrecht at 20 ·
2006"). Over 6 items the strip offers "Switch to the list".

**List view**: one row per item — ≡ handle (drag to reorder; arrow keys too), name field
(16 px for iOS), "from 20 / 2006" with ‹ ›, ✕. Gap rows are dashed, placeholder
"Gap · creates nothing". Endable sequences get a last row: "🏁 Ended at 33 / 2019 ‹ ›" +
"Still going", or "▸ Still going" + "Set an end". The header's "▸ Still going" pill
toggles the same thing.

**Reordering moves names, never dates.** Dragging Berlin above Utrecht swaps which place
fills which period; the move years stay where they were ("Reordered. The dates stayed
put."). Same rule as `PlacesTable`'s derived starts today.

**Adding.** First item: the add button's typical start (or 18), end = start + typical
length where the sequence is endable. With an end set: the new item starts at the old
end and the end moves on by its typical length. Ongoing: it starts halfway between the
last start and now. No room → "No room left. Move a date first." Places use
`PlaceAutocompleteInput` for the add field (see Network).

**Add buttons** (typical length in years; start when it is the first item):
- Education: 🏫 School (12, starts 6), 🛠 Ausbildung (3, starts 16), 🎓 Bachelor (3),
  🎓 Master (2), 📜 PhD (4), 🌍 Year abroad (1), ⏸ Gap (3).
- Work: 💼 Job (3, starts 20; no label → shown and saved as "Job"), 👶 Parental leave
  (1), 🌴 Sabbatical (1), ⏸ Gap (1).
- Partner: free text field + ⏸ Gap (2).

**Gaps** hold time and create nothing. They are what makes "back to university at 31 for
a Master" a two-tap answer: Bachelor → Gap → Master.

### 6 · Kids
"＋ Add a child" appends a row: name (placeholder "Child 1"), birth-year slider (from
your age 14 to now), "born 2014 · you were 28", ✕. The first child defaults to
age × 0.4 + 12 (clamped), each further one 3 years later. "No kids" clears and skips 7.
The summary reads "👨‍👩‍👧 Family group · Mia, Jonas, each a group with a birth year".

### 7 · Grandkids
Only when there is at least one child. Each row: whose child (pills with the kids'
names), name, birth-year slider (parent's birth + 15 … now), "born 2021 · Jonas was 29",
✕. Removing a child removes its grandchildren from the draft.

### Live preview (every screen from 2 on)
A compact drawing of everything answered so far, at the bottom of the screen: year ticks
above "age N" ticks, one lane per created row (icon in a narrow left column), bars in the
row colours with clipped labels, a "Family" band with kids indented and grandkids under
their parent. Gaps are not drawn. It updates on every drag and keystroke — this is the
"reveal" happening continuously, so there is no separate reveal screen. Cap its height
(about a third of the screen) and shrink lane height before scrolling; consider hiding
it while the on-screen keyboard is open on phones.

## Data mapping

All ms are UTC: an age `a` on a sequence maps to `Date.UTC(birthYear + a, 0, 1)` with
precision `"year"`. Row colours are data (like `completeIdentityStep`'s "#8ba66f"), one
fixed distinct colour per topic.

| Topic | Container | Records |
|-------|-----------|---------|
| Born | self group | `updateGroup(selfGroupId, { birthDate })` |
| Lived | "Places lived" row 🏠 (exists) | one `TimelineEntry` per non-gap item; `end` = next item's start; last one ongoing (`end` undefined). Place details from autocomplete kept as today (`addOnboardingPlaceEntry` / `updateOnboardingPlaceEntry`) |
| Learned | "Education" row 🎓 in the self group, created on first commit with ≥1 item | same; the last item's `end` = sequence end, or undefined when still going |
| Worked | "Work" row 💼 | same |
| Partner | "Relationships" row ❤️ | same; title = partner's name |
| Kids | top-level "Family" group 👨‍👩‍👧 | one sub-group per child: label = name (or "Child N"), `birthDate = Date.UTC(year, 0, 1)` |
| Grandkids | the parent's sub-group | one sub-group per grandchild |

A span is an entry; nothing here creates a zero-length entry or an event. New rows and
groups get their `order` through `updateDataset`/`normalizeChildOrder()` as today.
`addSubGroup` returns `void` today and needs to return the new id. `birthDateForRow()`
then resolves the kids' and grandkids' ages and pre-birth hatching with no new code.

## Commit, Back and resume

- Each screen edits a **draft**. "Next" (or Skip) **commits** that screen by reconciling the
  draft with the dataset: create what is new, update what changed, delete entries that
  were removed in the editor. Draft items remember the entry/group id they came from.
- Entering a screen **loads** its draft from the dataset (entries of that row sorted by
  start; a hole between one entry's end and the next start becomes a gap item; the
  last entry's end becomes `end`). So **Back may cross a commit boundary**: returning
  to a committed screen shows what was committed and updates it in place — never
  creates a second copy. This replaces the old "Back never crosses a commit boundary"
  rule for this assistant, and the reconcile function is what makes it safe; document
  that in `src/onboarding/CLAUDE.md`.
- If a row's entries overlap (added later on the canvas), that topic's editor cannot
  represent them: show "This timeline has overlapping entries — edit it on the canvas"
  and leave it untouched.
- Replay ("✨ Replay setup assistant") resumes from the dataset the same way, extending
  `findExistingSetup()`: rows found by label in the self group, "Family" by label at the
  top level. `shouldShowOnboarding` stays the single auto-show predicate.
- Nothing is written before a screen's Next/Skip except the name step's group (existing).
- Questionnaire answers that only steer creation ("No kids", Strip vs List) are not
  stored.

## Copy

As in the prototype: second person, short. Prompts: "When were you born?" · "Where have
you lived?" · "School and after" · "Where have you worked?" · "Who have you been with?" ·
"Do you have kids?" · "Any grandchildren?". Hints: "The year is enough for now." · "Drag
the dots to when you moved. Roughly is fine." · "Add in order. Gaps hold time and create
nothing." · "One job after another. Name them now or later." · "Add the ones that matter
to you. Skipping is fine." · "Name and birth year. More family can come later." · "Pick
whose child, then name and year." Last action: "Draw my timeline →".

## Network

Signed out the app makes no network calls, with one existing, stated exception in this
flow: `PlaceAutocompleteInput` → OpenStreetMap Nominatim while typing a place (no key,
no backend). Plain text without picking a suggestion must keep working.

## Out of scope (deliberately)

Things that overlap (a side job during university — added later on the canvas or with the
normal add flows); wedding/birth events; parents and siblings; country-specific education
lists; a precision field for `birthDate`; partners as person groups; prefilled example
content (the prototype's "Try as 20/40/63" presets are a demo only — the app never
invents names, places or jobs; age only sets ranges and where a new item starts);
analytics of any kind.

## Implementation notes

- New assistant replacing `IdentityBirthPlacesAssistant` in `App.tsx` (both shells use
  `.assistant-overlay`). Hand-written with `useAssistantFlow` + `AssistantStepShell`; no
  generic step runner. Remove `PlacesTable` / `BirthDateInput` / old steps only if nothing
  else imports them.
- Pure, tested modules (co-located `*.test.ts`): the sequence model (clamp, add with
  typical lengths, move names, set knob, end toggle, ticks, knob staggering, spans),
  load/reconcile (entries ⇄ items incl. gaps, overlap detection, create/update/delete
  plan), preview layout, figure pose by age, birth/age arithmetic with month.
- Components: `SequenceEditor` (Strip + List), `OnboardingPreview` (canvas),
  `AgeFigure` (canvas). Colours only via `--color-*` in `src/ui/styles.css`, light and dark
  blocks kept in step — add figure and preview tokens there; canvases read them with
  `getComputedStyle`, like the engine. No hex in component rules.
- Mobile first at 390 × 844, also fine in the desktop overlay. Inputs ≥16 px (the last
  block in `styles.css`). Pills for < ~7 options; autosave; no Save/Cancel.
- On finish, frame the canvas on birth → now through whatever API the engine already
  exposes (look at how `MiniMap` and `centerOnEntry` move it).
- `scripts/site-screenshots.mjs` captures `site/img/onboarding.png` from this overlay —
  update its steps and regenerate if it breaks.

## Verification

`npm test` and `npm run build` green. Then E2E per root `CLAUDE.md` (build, run
`node dist-server/main.mjs` with `TRUST_PROXY=false`, playwright-core with
`/opt/pw-browsers/chromium`, 390 × 844 viewport, fresh profile) and assert through
`window.__chronicleStore`:
- self group `birthDate`; with a month, the right month;
- entries on Places lived / Education / Work / Relationships with the expected UTC ms,
  ongoing last items without `end`, and **no entry for a gap**;
- Family group → child sub-groups with `birthDate` → grandchild nested under the chosen
  parent;
- Back from Kids to Lived, change a date, Next → entries updated, count unchanged;
- replay the assistant → nothing duplicated;
- one screenshot per screen in light and dark.

## What was built

`OnboardingAssistant` replaces `IdentityBirthPlacesAssistant` in `App.tsx` (both shells);
`PlacesTable`, `BirthDateInput` and the two `…OnboardingPlaceEntry` actions are gone.

**Pure, tested** (`src/onboarding/`): `birthYear.ts` (year age, month, what to store),
`sequence.ts` (clamp, add with typical lengths, move names, knobs, staggering, ticks,
rebase), `sequenceRecords.ts` (entries ⇄ items, gaps, overlap detection, reconcile plan),
`familyRecords.ts` (kids/grandkids load and plan), `previewLayout.ts`, `figurePose.ts`,
and `firstRunRecords.ts` — the commits, tested against the real store (replay writes
nothing, Back + change updates in place, reorder keeps every record).

**Components**: `OnboardingAssistant.tsx`, `SequenceEditor.tsx` (Strip + List),
`FamilyEditors.tsx`, `OnboardingPreview.tsx`, `AgeFigure.tsx`, `canvasTheme.ts`;
`lifeTopics.ts` holds the four topics' rows, colours, chips and copy. `AssistantStepShell`
gained `totalSteps` (all dots drawn), `className` and `footer` (the preview).

**Elsewhere**: `addSubGroup` returns the new id; `addRow` takes an optional colour;
`applyEntryChanges` writes one screen's plan as one change. `--color-figure-*` tokens in
both themes; the first-run CSS block in `styles.css`. `scripts/site-screenshots.mjs`
drives the new flow; `site/img/onboarding.png` and the product page's copy for it were
updated.

**Verified**: `npm test`, `npm run build`, and an E2E run at 390 × 844 in light and dark
asserting through `window.__chronicleStore` — birth date with month; entries per topic
with year precision, ongoing last items without `end`, no entry for a gap; a dragged
strip dot; Family → kids → grandchild under the chosen parent; Back from Kids to Lived,
a date changed, same entry ids; replay changing nothing; no request but the (stubbed)
place search. A second run picks a place suggestion and checks the saved details.
Screenshots of every screen from that run, light and dark: `plans/onboarding-screens/`.
Every input in the flow measures 16 px at phone width.

**Deviations from this plan**
- The name screen's "Skip for now" still closes the assistant, as before: without a
  name there is no self group to put anything on.
- Skip on an *untouched* birth screen stores no birth date; the slider's starting
  point (30) is not an answer. Later screens count ages from that shown year until a
  birth year is saved. "That's me →" always stores what is shown.
- Back keeps an uncommitted draft in memory (rebased if the birth year changed), so
  going back and forward again loses nothing; Escape keeps every committed screen
  and drops only the one on screen.
- "No kids" / "None" are offered only while nothing is saved yet. Saved children are
  removed one at a time with ✕, which on Next deletes that child's group with
  everything in it; the Family group goes too once it is empty.
- Besides overlaps, a timeline whose entries start in the same year or fall outside
  birth…now also shows "edit it on the canvas" and is left alone.
- Places and partners need a typed name to be added (no "Place 3" placeholders);
  unnamed jobs are saved as "Job", as planned.
- Strip/List and "whose child" use `PillSelector` rather than the prototype's
  segmented control and plain pills. The kids' sliders run over years, not ages.
- The strip's right edge is now (this year's fraction included), so something can
  start this year.
- Each child's group gets `addSubGroup`'s usual "General" starter timeline and the
  kids' colour.

**Open follow-ups**
- Real-device iOS pass: dragging dots and ≡ handles inside the scrolling overlay.
- Topic rows are found by label; one renamed on the canvas is not found on replay.
- `Group.birthDate` still has no precision (a year reads as 1 January).
- A grandchild of a child born less than 15 years ago can only be "born this year".
