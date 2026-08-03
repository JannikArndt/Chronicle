# src/model — data logic

Pure data logic, no DOM. `types.ts` (schema, `SCHEMA_VERSION`), `fuzzyDate.ts`
(precision fuzz + fade ramps), `cascade.ts` (delete cascades), `sharing.ts`
(what may leave the device).

Every row is concurrent — entries on the same row may freely overlap, with no
insert-time conflict check (the exclusive-row concept was removed).

There are exactly **three** entities: `Group`, `TimelineRow` (a "timeline" in the
UI) and `TimelineEntry`. `Person` was folded into `Group` in schema v6 — a group
with a `birthDate` *is* a person, and a group nested via `parentGroupId` is what
a person inside a container group used to be. Don't reintroduce an owner field
on the row: the row's group is the whole answer to "whose timeline is this",
which is what stops a moved timeline keeping a stale owner. Full term list in
`docs/GLOSSARY.md`.

## Invariants

- **UTC everywhere**: every stored `ms` is a UTC instant; parsing, formatting,
  and ticks all use `Date.UTC`/`getUTC*`. Never introduce local-time methods.
  This is enforced across `model`, `storage`, `render`, and `ui` — not just here.
- **`sharing.ts` is the privacy gate.** `syncSubset` is the only path by which
  data reaches a server, so it fails closed (private unless something says
  otherwise) and strips every reference pointing outside the subset. It is the
  most heavily tested function here; treat a change to it as a security change.
  Publishing is per-row: entries have no flag of their own and follow their row.
