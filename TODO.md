# TODO

All three items from the previous version of this file are implemented
(plans in `plans/`, shipped in commits `6de4365`, `7a8600b`, `131b5fe`).
What remains:

## Drag-and-drop follow-ups

- [ ] **Manual browser check of the drag interaction.** Unit tests cover
  `reorderGroup`/`moveRow` (17 cases in `src/state/actions.test.ts`), but the
  pointer-event mechanics (handle drag, insertion indicator, Escape abort,
  touch) have not been exercised in a real browser yet.

- [ ] **Open question, shipped as a flagged scope cut:** moving a parent row to
  another group leaves its sub-rows' stored `groupId` stale. They still render
  under the parent (layout follows `parentRowId`), so nothing looks wrong, but
  the field is inconsistent. Decide whether `moveRow` should rewrite children's
  `groupId` along with the parent, or whether the stale field is harmless
  enough to leave.

## Onboarding follow-ups

- [ ] **Manual check of the PlacesTable fixes** (dropdown hides on blur,
  Enter-select lands in the year field, header alignment, 440px shell width,
  dark mode) — implemented and unit-test/build-verified only.
