# Zoom to life span — design

## Problem

The rail shows a person's computed age next to their name (`computedAge()` in
`RowRail.tsx`), but there's no quick way to jump the timeline view to that
person's whole life. Users have to pan/zoom manually to find their birth date
and stretch the view out to today.

## Goal

Add a button next to a person's name+age in the rail that, when clicked, sets
the canvas's visible time range to span from their birth date to today, with a
small margin on each side.

## Non-goals

- No vertical/row scroll change — only the horizontal time axis moves.
- No animation/transition — an immediate jump, consistent with the existing
  (currently unused) `jumpToNow()` engine method.
- No new "zoom to fit" generalization (e.g. fit-all-entries) — scoped strictly
  to a single person's birth-to-today span.

## Design

### 1. `src/render/timeScale.ts` — new pure function

```ts
export function scaleForRange(startMs: number, endMs: number, width: number): TimeScale {
  return clampScale({ startMs, msPerPx: (endMs - startMs) / width });
}
```

Follows the existing pattern of `panBy`/`zoomAt`/`clampScale` in this file:
pure, takes/returns `TimeScale`, and reuses `clampScale` so the result
respects `MIN_MS_PER_PX`/`MAX_MS_PER_PX` the same way every other scale
mutation does (e.g. a very young child's life span clamps to the engine's
max zoom-in rather than producing a degenerate scale).

Unit-tested in `timeScale.test.ts` alongside the other pure scale helpers.

### 2. `src/render/engine.ts` — new public method

```ts
zoomToRange(startMs: number, endMs: number): void {
  this.scale = scaleForRange(startMs, endMs, this.width);
  this.requestDraw();
}
```

Placed in the "public API" section next to `jumpToNow()`, following the same
shape (mutate `this.scale`, call `requestDraw()`).

### 3. Rail → engine wiring

`RowRail` currently has no way to reach the engine (only `CanvasHost` does).
`App.tsx` already owns `engineRef: useRef<TimelineEngine | null>(null)`
(passed to `CanvasHost`) — thread the same ref into `<RowRail engineRef={engineRef} .../>`.
`RowRailProps` gains `engineRef: MutableRefObject<TimelineEngine | null>`.

### 4. `RowRail.tsx` — button and range computation

```ts
function lifeSpanRange(birthDate: number): { startMs: number; endMs: number } {
  const now = Date.now();
  const padding = (now - birthDate) * 0.05;
  return { startMs: birthDate - padding, endMs: now + padding };
}
```

5% padding on each side of the birth→today span, so the birth marker and
"today" aren't flush against the canvas edges.

A new `⇔` button is added to the `rail-actions` span in both branches that
currently call `computedAge()`:

- the group-header-with-attached-person branch (`RowRail.tsx` ~125-164)
- the standalone-person branch (~166-200)

Gating: shown whenever `person.birthDate !== undefined` (i.e. whenever the
age badge itself is shown) — **not** gated on `!readOnly`/`!readOnlyPerson`,
since zooming doesn't mutate data, unlike the ⚙ edit / ＋ add buttons. This
means the `rail-actions` span itself must be rendered unconditionally in both
branches (currently it's wrapped in `{!readOnly && (...)}`), with the ⚙/＋
buttons individually gated on `!readOnly` inside it, and the new ⇔ button
gated only on `person.birthDate !== undefined`.

Click handler:

```ts
onClick={() => {
  const { startMs, endMs } = lifeSpanRange(person.birthDate!);
  engineRef.current?.zoomToRange(startMs, endMs);
}}
```

Button gets `title="Zoom to life span"`, classes `icon-button hover-reveal`
(same as the existing icon buttons, so it follows the existing
hover-on-fine-pointer / always-visible-on-touch behavior).

## Testing

- `scaleForRange` unit-tested in `timeScale.test.ts` (pure function, matches
  existing test coverage for this file).
- No new RowRail component test — consistent with the existing codebase,
  which has no test file for any `src/ui/*.tsx` component.

## Manual verification

Run the dev server, open a person with a birth date set, click ⇔, confirm the
canvas time axis now shows their birth year through the current year with a
small margin on each side.
