# Plan: Rail popover forms — Enter submits

**Effort: small.** One pattern applied in four places, all in `src/ui/RowRail.tsx`.
Source TODO: `TODO.md` § "Rail popover forms: Enter doesn't submit".

## Problem

None of the rail's "add" forms wire `onKeyDown` on their text input — every one is
click-only on the "Add" button. The onboarding assistant's steps consistently do
`onKeyDown={(e) => e.key === "Enter" && commit()}`; the rail forms should match.

## The four sites (line numbers verified 2026-07-23)

1. **`AddPersonForm`** — `RowRail.tsx:453-478`. Button calls
   `addGroup(label.trim(), true); close();`, disabled when `label.trim() === ""`.
2. **`AddGroupForm`** — `RowRail.tsx:480-510`. Button calls
   `addGroup(label.trim(), asPerson); close();`, same disabled condition.
   (Only the text input gets the handler, not the checkbox.)
3. **`AddMenu` person/row mode** — `RowRail.tsx:548-570` (the non-"menu" return).
   Button calls `addPersonToGroup(groupId, label.trim())` or
   `addRow(groupId, label.trim(), personId)` depending on `mode`, then `close()`.
4. **`SubRowForm`** — `RowRail.tsx:697` onward. Same shape (text input + Add
   button); read it first to confirm the exact handler body.

## Fix shape (identical in all four)

In each component, extract the button's inline `onClick` body into a named
function (e.g. `submit`), then:

```tsx
const submit = () => {
  addGroup(label.trim(), true);
  close();
};
// input:
onKeyDown={(e) => e.key === "Enter" && label.trim() !== "" && submit()}
// button:
onClick={submit}
```

The Enter guard must mirror the button's `disabled` condition
(`label.trim() === ""`) so Enter can't submit an empty label.

## Constraints

- Follow project code style: long descriptive names, no cleverness.
- Don't touch any other form (PersonEditor/CategoryEditor autosave per field —
  no submit concept there).

## Verification

- `npm test` and `npm run build` must pass (no new tests needed — this is
  DOM wiring, and the project doesn't unit-test React components).
- Manual smoke via dev server if feasible: open rail "+" → "+ Person", type a
  name, press Enter → person appears and popover closes. Repeat for group,
  group-level "+" (both Person and Category modes), and sub-timeline form.
- Empty input + Enter must do nothing.
