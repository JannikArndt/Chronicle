# Break out — design doc

Status: **built** (model, layout, canvas, both shells).

One timeline becomes a group of timelines, one per entry, so a single bar can be
detailed into whatever it was really made of — and collapsing that group again
gives you back the picture you started with.

---

## 0. The one-paragraph version

A "Work" timeline with three entries — Job A, Job B, Job C — **breaks out** into
a group "Work" holding three timelines, one per job, each carrying its original
entry. Each of those can now be split further: projects, locations, phases.
Collapse the group and it reads exactly as it did before: three bars labelled
Job A, Job B, Job C, in the original colour, on one lane. Nothing about that
last part is special to a broken-out group — **every** collapsed group now
summarises *per direct child* instead of flattening its whole subtree into one
bar.

---

## 1. The name

The ask called it "exploding". The verb we use is **break out** — as in
"break out the numbers by region": show the constituent parts separately. It
was picked over the alternatives because none of them were free:

- *Explode* — reads as destruction, and the operation is lossless.
- *Expand* / *unfold* — already taken. A group **expands** and **collapses**
  every time you click its triangle, and that is a view state, not a change to
  your data. Two meanings for one word, one of them undoable by a click and the
  other not, is how someone loses a timeline.
- *Split* — means cutting one entry into two along the time axis, which is a
  different feature somebody will eventually want.
- *Promote* — accurate for the single-entry case, meaningless for the whole-row
  case, and jargon in both.

UI copy: **Break out into timelines…** on a timeline, **Break out into its own
timeline…** on an entry. There is no inverse action; the inverse is collapsing
the group, which is free and reversible.

---

## 2. What it does to the data

`breakOut(dataset, rowId, entryIds?)` in `src/model/breakOut.ts` — pure, returns
a new dataset, injectable id factory so the tests are deterministic.

```
before                                after
──────                                ─────
Group "Me"                            Group "Me"
└── Row "Work"                        └── Group "Work"        ← label/colour/icon/birthDate of the row
    ├── Entry "Job A"                     ├── Row "Job A" ──── Entry "Job A"
    ├── Entry "Job B"                     ├── Row "Job B" ──── Entry "Job B"
    └── Entry "Job C"                     └── Row "Job C" ──── Entry "Job C"
```

- The **new group takes the row's presentation** (label, colour, icon, birth
  date) — it is the same thing, one level up. `birthDateForRow()` then resolves
  the children through it, so the birth date is not duplicated onto the new rows.
- The **new group is never `shared`**, whatever the row was. Publishing is
  per-row and always deliberate; the new rows inherit the row's own `shared`
  flag, so exactly the entries that were published stay published and no others.
  `syncSubset` parity across a break-out is asserted in the tests.
- Entries keep every field, including their title and their `parentEntryId`.
  Only `rowId` changes.
- New rows are created in start-date order.
- **Single-entry break-out** does the same conversion but moves only that entry.
  Whatever is left — the other entries, and *all* of the row's events — stays on
  the original row, which moves into the new group and keeps its name. Events
  are not redistributed by "which job was I in then?": an event is a point, and
  guessing which span owns it is a guess.
- The original row is removed only when nothing at all is left on it.

---

## 3. What it does to the picture

`computeLayout()` used to give a collapsed group **one** synthetic
`"group-summary"` bar spanning its whole subtree. It now gives **one bar per
direct child** — one per child timeline, one per child sub-group (aggregated
recursively) — each labelled and coloured as that child, which is what makes a
collapsed broken-out group look like the timeline it came from.

And *look* like one it must, literally: a collapsed group is drawn as a
timeline, not as a section header with a lane under it. One `LayoutItem` of
`ROW_HEIGHT` carrying its own bars, `subtreeEndY` left unset so neither
renderer paints a band behind it, `ROW_GAP` before it instead of
`GROUP_GAP_BEFORE`, and a rail label with the header's weight, colour and
font-size step-down dropped. It is standing in for the timelines it hides;
looking like a section would be describing something you can no longer see.

Overlap is the obvious consequence — two jobs at once, a sabbatical inside a
career — and it is handled by **lane packing**: bars sorted by start, each
assigned to the first lane whose previous bar ended at or before its start,
otherwise a new lane. An ongoing bar holds its lane to `+Infinity`. Packing is
computed in **time, not pixels**, so lanes never reshuffle while you zoom —
`computeLayout` has no access to the time scale, and that is deliberate. The
summary item's height is `lanes × ROW_HEIGHT`, so everything below it moves down
by exactly as much as it needs to.

Two smaller consequences, both deliberate:

- Back-to-back children share a lane. That is what keeps "Job A, Job B, Job C"
  on one line.
- **Hidden rows are excluded** from the aggregate. Before this change they were
  folded into the one flattened bar; as a labelled bar of its own, a row you
  unchecked in the rail would have been visibly back.

---

## 4. Where you press it

| | whole timeline | single entry |
|---|---|---|
| desktop | `RowEditor` popover in `RowRail.tsx`, above **Delete row…** | `EntryDetail` in `DetailPanel.tsx`, above **Delete entry…** |
| mobile | ⋯ sheet menu, row pane, above **Remove timeline** | ⋯ sheet menu, entry pane, above **Remove from timeline** |

Both confirm first, with `describeBreakOut()` supplying the sentence — the same
shape as the delete affordances and `describeCascade()`. There is no undo in
Chronicle, and this restructures the tree.

---

## 5. Not built

- No "merge back" action. Collapsing the group is the answer to "I want the old
  picture"; genuinely undoing the structure is a drag of each timeline back and
  a delete of the group.
- Events are not distributed onto the broken-out timelines (see §2).
- Clicking a collapsed group's summary bar does not expand the group.
