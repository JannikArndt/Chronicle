# TODO

## Onboarding: "Where else have you lived?" (PlacesTable)

All items below are in `src/onboarding/PlacesTable.tsx` and
`src/onboarding/PlaceAutocompleteInput.tsx` unless noted.

- [ ] **Column headers.** The table (`.places-table` rows in `PlacesTable.tsx`)
  has no header row — add a small `.places-table-header` row above the rows
  with "Place" / "Until" labels, aligned to the same flex widths as
  `.places-table-row` (place field `flex: 1`, year field fixed `64px`, plus
  the row's trailing remove-button gutter) so the columns actually line up.

- [ ] **Suggestions stay visible after focus moves away, covering the next
  field.** In `PlaceAutocompleteInput.tsx`, the suggestion `<ul>` renders
  whenever `suggestions.length > 0`, with no check on whether the `<input>`
  is actually focused. Nothing currently clears `suggestions` on blur — only
  a new search (debounce effect) or a selection does. Fix: track focus
  (`isFocused` state via `onFocus`/`onBlur`) and gate the dropdown on it. The
  naive version breaks click-to-select, though: clicking a suggestion
  `<button>` blurs the input *before* the click fires, so a plain
  `blur → hide` would hide the list out from under the click. Standard fix,
  and it also cleans up a second thing below: add
  `onMouseDown={(e) => e.preventDefault()}` to the suggestion buttons so
  clicking one never blurs the input at all — selection then happens via the
  existing `onClick`/`selectSuggestion` path while focus never leaves the
  field. Only *then* is a plain `isFocused && suggestions.length > 0` gate
  safe.

- [ ] **Enter-selecting a suggestion sometimes skips the year field and
  jumps to the next place field instead.** Root cause, found while writing
  this: `PlacesTable`'s `onAfterSelect` calls `commitRow(index)` *before*
  focusing the year input. `commitRow` doesn't only save the entry — its
  last step, `ensureTrailingBlankRow`, appends a new blank row whenever the
  committed row has an `entryId`, but it never checks whether that row also
  has a *year*. Since a place-only commit (year field still empty, "still
  living there" state) already writes an ongoing entry and thus already has
  an `entryId`, selecting a place immediately spawns a new trailing row —
  and that new row's `PlaceAutocompleteInput` has
  `autoFocus={index === rows.length - 1}`, i.e. `true`. Its mount-time
  autofocus wins the race against the explicit `yearInputRefs.current[...]
  .focus()` call made moments earlier, stealing focus to the new row's place
  field instead. Fix: `ensureTrailingBlankRow` should only append when the
  committed row has *both* an entry **and** a saved end date — e.g. check
  the actual entry's `end` in the dataset (mirrors how `startMsForRow`
  already reads `.end?.ms` off the previous entry), not just `row.entryId`.
  This also restores the original intent ("a new row appears once you fill
  the *year*", not merely the place).

- [ ] **Assistant window too narrow for long street names.** `.assistant-shell`
  in `src/ui/styles.css` is a fixed `width: 360px` (`max-width: calc(100vw -
  32px)`), shared by every onboarding step (name/birthDate/place/until/
  places). Widening it globally affects every step's centered card, which
  may or may not be wanted for the single-field steps. Options: bump the
  base width somewhat (~420–480px) since none of the other steps look
  cramped at that size either, or add a modifier class (e.g.
  `.assistant-shell-wide`) applied only when `IdentityBirthPlacesAssistant`
  is in the `"places"` phase. Also worth checking `.places-table-row`'s
  flex layout still holds up at whatever width is chosen — the year field
  is a fixed `64px`, so extra width should flow entirely into the place
  field, which is exactly the field with the long-string problem.

## Rail popover forms: Enter doesn't submit

All in `src/ui/RowRail.tsx`. None of the rail's "add" forms wire an
`onKeyDown` handler on their text input — every one of them is click-only
on the "Add" button, unlike the onboarding assistant's steps (which
consistently do `onKeyDown={(e) => e.key === "Enter" && commit()}`). The
user flagged two; the same gap exists in a third and fourth place with the
identical shape, worth fixing together since it's one pattern, not four
separate bugs:

- [ ] `AddPersonForm` (~line 388) — the rail "+" menu's "+ Person" shortcut,
  calls `addGroup(label.trim(), true)`.
- [ ] `AddMenu`'s person/row mode (~line 482–502) — reached via a group's own
  "+" button, not the rail-level menu; same input, calls either
  `addPersonToGroup` or `addRow` depending on `mode`. This is the "New
  Person" / "New Timeline Row" case the user named.
- [ ] `AddGroupForm` (~line 414) — not explicitly reported, but has the
  identical missing-Enter gap.
- [ ] `SubRowForm` (~line 632) — same gap, "Add sub-timeline" form.

Fix shape is identical in all four: add
`onKeyDown={(e) => e.key === "Enter" && !<disabled-condition> && <same
handler the button's onClick runs>()}` to each text `<input>`, extracting
the button's inline `onClick` body into a named function first if it isn't
already one (all four currently inline the logic directly in `onClick`).
