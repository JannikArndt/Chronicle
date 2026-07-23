# Plan: Onboarding "Where else have you lived?" fixes (PlacesTable)

**Effort: medium.** Four independent fixes in `src/onboarding/PlacesTable.tsx`,
`src/onboarding/PlaceAutocompleteInput.tsx`, and `src/ui/styles.css`.
Source TODO: `TODO.md` § "Onboarding: 'Where else have you lived?' (PlacesTable)".

Read the header comment of `PlacesTable.tsx` first — it explains the rowsRef
mutation model. **Never move a dataset write inside a `setState(prev => ...)`
updater** (CLAUDE.md invariant).

## 1. Column headers

`PlacesTable.tsx` renders `.places-table-row` rows with no header. Add a
`.places-table-header` row above the mapped rows with "Place" / "Until" labels,
aligned to the row's flex layout: place field `flex: 1`, year field fixed `64px`
(`.places-table-year`), plus the trailing remove-button gutter (the ✕
`icon-button` only renders conditionally — the header needs a matching
fixed-width spacer so columns line up whether or not a row shows ✕).

CSS goes in `src/ui/styles.css`. **Use existing `--color-*` custom properties
only — never a hardcoded hex** (dark theme invariant). A muted small-caps or
`--color-text-muted`-style label matching the app's existing hint text is enough.

## 2. Suggestions dropdown stays open after blur

`PlaceAutocompleteInput.tsx:126` renders the `<ul>` whenever
`suggestions.length > 0` — nothing clears suggestions on blur, so the list
covers the next field after focus moves away.

Fix (order matters):
1. Add `onMouseDown={(event) => event.preventDefault()}` to the suggestion
   `<button>`s (line ~133) so clicking a suggestion never blurs the input;
   selection continues through the existing `onClick` → `selectSuggestion` path.
2. Add `isFocused` state, set in the input's `onFocus`, cleared in `onBlur`
   (still call the existing `onBlur` prop afterwards — PlacesTable relies on it
   to commit the row).
3. Gate the dropdown: `{!confirmedSuggestion && isFocused && suggestions.length > 0 && (...)}`.

Step 1 must land with steps 2–3 — a plain blur→hide without it breaks
click-to-select (mousedown blurs before click fires).

## 3. Enter-selecting a suggestion skips the year field

Root cause (already diagnosed, verified in code): `PlacesTable.tsx`'s
`onAfterSelect` (line ~212) calls `commitRow(index)` *before* focusing the year
input. `commitRow`'s last step, `ensureTrailingBlankRow` (line 123-130), appends
a blank row whenever the committed row has an `entryId` — but a place-only
commit (empty year = ongoing entry) already gets an `entryId`. The new trailing
row's `PlaceAutocompleteInput` has `autoFocus={index === rows.length - 1}` →
`true`, and its mount-time autofocus wins over the explicit
`yearInputRefs.current[row.key]?.focus()` call.

Fix: `ensureTrailingBlankRow` should only append when the last row has **both**
an entry **and** a saved end date. Check the actual entry's `end` in the
dataset, mirroring how `startMsForRow` (line 106-111) reads `.end?.ms`:

```ts
const lastEntry = appStore.getState().dataset.entries.find((e) => e.id === last.entryId);
if (lastEntry?.end !== undefined) { /* append */ }
```

This restores the original intent: a new row appears once you fill the *year*,
not merely the place. After the change, verify the flow that previously created
trailing rows still does: committing a row with place **and** year (year field
blur, or Enter) must still spawn the next blank row.

## 4. Assistant window too narrow for long street names

`.assistant-shell` in `src/ui/styles.css` is `width: 360px` /
`max-width: calc(100vw - 32px)`, shared by all onboarding steps.

Decision (pre-made, don't ask): **bump the base width to 440px globally.** The
single-field steps are centered cards and tolerate the extra width; a
phase-gated modifier class adds plumbing for little gain. Keep the existing
`max-width` clamp. Then check `.places-table-row` still lays out correctly: the
year field is fixed `64px`, so all extra width must flow into the place field
(`flex: 1`) — that should already hold, just confirm.

## Verification

- `npm test` (vitest) and `npm run build` must pass.
- Manual flow via dev server (fresh dataset or rail "+" → "✨ Replay setup
  assistant"): reach the places table, then check —
  - header labels align with the columns;
  - typing in a place field, then Tab/clicking away hides the suggestion list;
  - clicking a suggestion still selects it (regression check for fix 2);
  - selecting a place with Enter lands focus in *that row's* year field,
    with no premature trailing row;
  - entering a year then blurring spawns the next blank row;
  - long street-name suggestions fit at the new width;
  - check dark mode for the new header styles (no hardcoded colors).
