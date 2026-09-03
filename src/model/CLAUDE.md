# src/model — data logic

Pure data logic, no DOM. `types.ts` (schema, `SCHEMA_VERSION`), `fuzzyDate.ts`
(precision fuzz + fade ramps), `cascade.ts` (delete cascades), `sharing.ts`
(what may leave the device).

Every row is concurrent — entries on the same row may freely overlap, with no
insert-time conflict check (the exclusive-row concept was removed).

There are **four** entities: `Group`, `TimelineRow` (a "timeline" in the UI),
`TimelineEntry` and — since v8 — `TimelineEvent`. `Person` was folded into
`Group` in schema v6 — a group with a `birthDate` *is* a person, and a group
nested via `parentGroupId` (arbitrarily deep, since v9) is what a person inside
a container group used to be. Since v9, `TimelineRow` can independently carry
its own `birthDate` too — a person doesn't have to be a whole group; a single
timeline can be one (an acquaintance you're not modelling a whole family for).
`Group` and `TimelineRow` are deliberate near-mirrors: both carry `label`,
`color`, `icon`, `birthDate` — the only real difference is that a `Group` can
contain things (`parentGroupId`, sub-groups, rows) and a `TimelineRow` holds
entries/events instead. `TimelineRow.groupId` is optional — a timeline needs
no container at all (a top-level timeline). Don't reintroduce an owner field
beyond `groupId`: the row's group is the whole answer to "whose timeline is
this", which is what stops a moved timeline keeping a stale owner. There is no
`parentRowId` any more — a timeline cannot nest inside another timeline; model
that as a sub-group holding one row instead (v9 migration flattens any
existing sub-row into a plain sibling, `flattenSubRows` in
`src/storage/exportImport.ts`). Full term list in `docs/GLOSSARY.md`.

**An event is a point, an entry is a span**, and that single difference is why
it is its own entity rather than an entry with `end === start`: a zero-width bar
has no label anchor, no fade edges and no "ongoing", so every one of those would
have grown an "unless it is a point" branch. An event carries one `date`
(a `FuzzyDate`, so "sometime in 1998" stays honest), a `rowId`, and nothing that
only makes sense for a duration. Nothing in the model points *at* an event —
which is why `collectEventCascade` walks no tree.

`breakOut.ts` is the one **structural** conversion in the model: a timeline
becomes a group of timelines, one per entry ("break out" — the ask called it
"exploding"; `plans/break-out-feature-design.md` §1 says why not *explode*,
*expand* or *split*). Given a single entry id it peels just that entry off and
leaves the rest of the row alone. It is pure and takes an injectable id factory
so the tests get stable ids. Two rules are load-bearing rather than cosmetic:
the new group takes the row's presentation (label, colour, icon, birth date)
but is **never `shared`**, while the new rows inherit the row's own flag — so
exactly the entries that were published stay published and nothing new becomes
public, which `breakOut.test.ts` asserts against `syncSubset` itself. And
events never move: the row keeps every one of them, because guessing which span
owns a point in time is a guess.

## Invariants

- **Sibling order is `order`, never array position.** `orderedChildren()` is
  the single answer to "what does this container hold, top to bottom", and
  `normalizeChildOrder()` (run from `updateDataset`) renumbers each container
  to 0..n-1. That is what lets a caller say "put this between those two" by
  writing a fractional order — `breakOut` gives the new group the row's own
  order, the copy actions use `source.order + 0.5` — and leave the tidying to
  one place.

- **UTC everywhere**: every stored `ms` is a UTC instant; parsing, formatting,
  and ticks all use `Date.UTC`/`getUTC*`. Never introduce local-time methods.
  This is enforced across `model`, `storage`, `render`, and `ui` — not just here.
- **`sharing.ts` is the privacy gate.** `syncSubset` is the only path by which
  data reaches a server, so it fails closed (private unless something says
  otherwise) and strips every reference pointing outside the subset. It is the
  most heavily tested function here; treat a change to it as a security change.
  Publishing is per-row: entries have no flag of their own and follow their row.
