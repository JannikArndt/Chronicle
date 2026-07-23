# Zoom to Life Span Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a ⇔ button next to a person's name+age in the rail that zooms the canvas's visible time range to that person's birth date through today.

**Architecture:** A new pure `scaleForRange` helper in `timeScale.ts` computes a `TimeScale` from a `[startMs, endMs]` window; a new `zoomToRange` method on `TimelineEngine` applies it; `App.tsx` threads its existing `engineRef` into `RowRail`, which gains a `⇔` button calling `engineRef.current?.zoomToRange(...)` with a 5%-padded birth→today range.

**Tech Stack:** React + TypeScript, Vitest for unit tests. No new dependencies.

## Global Constraints

- UTC/epoch-ms everywhere — `Person.birthDate` and `Date.now()` are both epoch ms; no local-time methods.
- No hardcoded colors — this feature adds no new styling, so N/A here, but if a CSS rule is touched, reuse existing `--color-*` custom properties.
- The new button must show for public/read-only people too — gate only on `person.birthDate !== undefined`, not on `!readOnly`/`!readOnlyPerson`.
- No vertical/row scroll change, no animation — an immediate jump, matching the existing (currently uncalled) `jumpToNow()`.
- 5% padding on each side of the birth→today span.

---

### Task 1: `scaleForRange` pure function

**Files:**
- Modify: `src/render/timeScale.ts`
- Test: `src/render/timeScale.test.ts`

**Interfaces:**
- Produces: `scaleForRange(startMs: number, endMs: number, width: number): TimeScale` — exported from `src/render/timeScale.ts`, used by Task 2's `TimelineEngine.zoomToRange`.

- [ ] **Step 1: Write the failing test**

Add to `src/render/timeScale.test.ts`, inside the existing `describe("time scale", ...)` block (after the `clampScale` test, before the closing `});`):

```ts
  test("scaleForRange fits the given window to the viewport width", () => {
    const startMs = T0;
    const endMs = T0 + 100 * DAY_MS;
    const width = 1000;
    const result = scaleForRange(startMs, endMs, width);
    expect(result.startMs).toBe(startMs);
    expect(result.msPerPx).toBe((endMs - startMs) / width);
    expect(msToX(result, endMs)).toBeCloseTo(width, 5);
  });

  test("scaleForRange clamps an extremely narrow window to MIN_MS_PER_PX", () => {
    const result = scaleForRange(T0, T0 + 1000, 1000);
    expect(result.msPerPx).toBe(MIN_MS_PER_PX);
  });
```

Update the import line at the top of the file to include `scaleForRange`:

```ts
import { MAX_MS_PER_PX, MIN_MS_PER_PX, clampScale, msToX, panBy, scaleForRange, xToMs, zoomAt } from "./timeScale";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- timeScale.test.ts`
Expected: FAIL — `scaleForRange` is not exported from `./timeScale`.

- [ ] **Step 3: Write minimal implementation**

In `src/render/timeScale.ts`, add after `clampScale`:

```ts
export function scaleForRange(startMs: number, endMs: number, width: number): TimeScale {
  return clampScale({ startMs, msPerPx: (endMs - startMs) / width });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- timeScale.test.ts`
Expected: PASS, all tests in the file green.

- [ ] **Step 5: Commit**

```bash
git add src/render/timeScale.ts src/render/timeScale.test.ts
git commit -m "Add scaleForRange pure helper for fitting a time window to viewport width"
```

---

### Task 2: `TimelineEngine.zoomToRange`

**Files:**
- Modify: `src/render/engine.ts`

**Interfaces:**
- Consumes: `scaleForRange(startMs, endMs, width): TimeScale` from Task 1.
- Produces: `zoomToRange(startMs: number, endMs: number): void` public method on `TimelineEngine`, used by Task 3's rail button.

- [ ] **Step 1: Update the import**

In `src/render/engine.ts`, line 11, change:

```ts
import { clampScale, msToX, panBy, xToMs, zoomAt } from "./timeScale";
```

to:

```ts
import { clampScale, msToX, panBy, scaleForRange, xToMs, zoomAt } from "./timeScale";
```

- [ ] **Step 2: Add the method**

In `src/render/engine.ts`, in the "public API" section, immediately after `jumpToNow()` (which ends at line 202 with its closing `}`), add:

```ts

  zoomToRange(startMs: number, endMs: number): void {
    this.scale = scaleForRange(startMs, endMs, this.width);
    this.requestDraw();
  }
```

- [ ] **Step 3: Typecheck**

Run: `npm run build`
Expected: succeeds with no TypeScript errors (this project has no engine unit tests — `engine.ts` is exercised only through the app; a clean `tsc -b` is the verification for this step).

- [ ] **Step 4: Commit**

```bash
git add src/render/engine.ts
git commit -m "Add TimelineEngine.zoomToRange to jump the time axis to an exact window"
```

---

### Task 3: Rail button wiring

**Files:**
- Modify: `src/ui/App.tsx`
- Modify: `src/ui/RowRail.tsx`

**Interfaces:**
- Consumes: `engineRef: MutableRefObject<TimelineEngine | null>` (already created in `App.tsx:22`), `TimelineEngine.zoomToRange(startMs, endMs)` from Task 2.
- Produces: nothing consumed by later tasks — this is the final task.

- [ ] **Step 1: Pass `engineRef` into `RowRail` from `App.tsx`**

In `src/ui/App.tsx`, lines 111-115, change:

```tsx
        <RowRail
          layout={layout}
          railContentRef={railContentRef}
          onStartOnboarding={() => setOnboardingOpen(true)}
        />
```

to:

```tsx
        <RowRail
          layout={layout}
          railContentRef={railContentRef}
          onStartOnboarding={() => setOnboardingOpen(true)}
          engineRef={engineRef}
        />
```

- [ ] **Step 2: Accept `engineRef` in `RowRailProps` and thread it to `RailItem`**

In `src/ui/RowRail.tsx`:

Add the type import (line 6, alongside the existing `RefObject` import):

```ts
import type { MutableRefObject, RefObject } from "react";
```

Add `TimelineEngine` type import (new line, after the existing `Layout`/`LayoutItem` import at line 8):

```ts
import type { TimelineEngine } from "../render/engine";
```

Update `RowRailProps` (lines 47-51):

```ts
interface RowRailProps {
  layout: Layout;
  railContentRef: RefObject<HTMLDivElement>;
  onStartOnboarding: () => void;
  engineRef: MutableRefObject<TimelineEngine | null>;
}
```

Update the component signature and destructuring (line 53):

```tsx
export function RowRail({ layout, railContentRef, onStartOnboarding, engineRef }: RowRailProps) {
```

Pass `engineRef` down to each `RailItem` in the `layout.items.map(...)` call (lines 71-81):

```tsx
          {layout.items.map((item) => (
            <RailItem
              key={`${item.kind}:${item.id}`}
              item={item}
              personById={personById}
              categoryById={categoryById}
              hiddenRowIds={hiddenRowIds}
              selectedRowId={selectedRowId}
              openPopover={setPopover}
              engineRef={engineRef}
            />
          ))}
```

- [ ] **Step 3: Add `lifeSpanRange` helper**

In `src/ui/RowRail.tsx`, immediately after `computedAge` (lines 106-110), add:

```ts
function lifeSpanRange(birthDate: number): { startMs: number; endMs: number } {
  const now = Date.now();
  const padding = (now - birthDate) * 0.05;
  return { startMs: birthDate - padding, endMs: now + padding };
}
```

- [ ] **Step 4: Accept `engineRef` in `RailItemProps` and destructure it**

Update `RailItemProps` (lines 112-119):

```ts
interface RailItemProps {
  item: LayoutItem;
  personById: Map<string, Person>;
  categoryById: Map<string, Category>;
  hiddenRowIds: string[];
  selectedRowId?: string;
  openPopover: (p: PopoverState) => void;
  engineRef: MutableRefObject<TimelineEngine | null>;
}
```

Update the `RailItem` function signature (line 121):

```tsx
function RailItem({ item, personById, categoryById, hiddenRowIds, selectedRowId, openPopover, engineRef }: RailItemProps) {
```

- [ ] **Step 5: Add the ⇔ button to the group-header-with-person branch**

In `src/ui/RowRail.tsx`, the group branch currently reads (lines 138-161):

```tsx
        {!readOnly && (
          <span className="rail-actions">
            {person && (
              <button
                type="button"
                className="icon-button hover-reveal"
                title="Edit person"
                onClick={(e) =>
                  openPopover({ kind: "person-edit", personId: person.id, groupId: group.id, top: topOf(e) })
                }
              >
                ⚙
              </button>
            )}
            <button
              type="button"
              className="icon-button hover-reveal"
              title="Add…"
              onClick={(e) => openPopover({ kind: "add-menu", groupId: group.id, top: topOf(e) })}
            >
              ＋
            </button>
          </span>
        )}
```

Replace it with (the `rail-actions` span is now rendered unconditionally; `⚙`/`＋` stay gated on `!readOnly`, and the new `⇔` is gated only on `person && person.birthDate !== undefined`):

```tsx
        <span className="rail-actions">
          {person && person.birthDate !== undefined && (
            <button
              type="button"
              className="icon-button hover-reveal"
              title="Zoom to life span"
              onClick={() => {
                const { startMs, endMs } = lifeSpanRange(person.birthDate!);
                engineRef.current?.zoomToRange(startMs, endMs);
              }}
            >
              ⇔
            </button>
          )}
          {!readOnly && (
            <>
              {person && (
                <button
                  type="button"
                  className="icon-button hover-reveal"
                  title="Edit person"
                  onClick={(e) =>
                    openPopover({ kind: "person-edit", personId: person.id, groupId: group.id, top: topOf(e) })
                  }
                >
                  ⚙
                </button>
              )}
              <button
                type="button"
                className="icon-button hover-reveal"
                title="Add…"
                onClick={(e) => openPopover({ kind: "add-menu", groupId: group.id, top: topOf(e) })}
              >
                ＋
              </button>
            </>
          )}
        </span>
```

- [ ] **Step 6: Add the ⇔ button to the standalone-person branch**

In `src/ui/RowRail.tsx`, the person branch currently reads (lines 176-197):

```tsx
        {!readOnlyPerson && (
          <span className="rail-actions">
            <button
              type="button"
              className="icon-button hover-reveal"
              title="Edit person"
              onClick={(e) => openPopover({ kind: "person-edit", personId: person.id, top: topOf(e) })}
            >
              ⚙
            </button>
            <button
              type="button"
              className="icon-button hover-reveal"
              title="Add…"
              onClick={(e) =>
                openPopover({ kind: "add-menu", groupId: item.group!.id, personId: person.id, top: topOf(e) })
              }
            >
              ＋
            </button>
          </span>
        )}
```

Replace it with:

```tsx
        <span className="rail-actions">
          {person.birthDate !== undefined && (
            <button
              type="button"
              className="icon-button hover-reveal"
              title="Zoom to life span"
              onClick={() => {
                const { startMs, endMs } = lifeSpanRange(person.birthDate!);
                engineRef.current?.zoomToRange(startMs, endMs);
              }}
            >
              ⇔
            </button>
          )}
          {!readOnlyPerson && (
            <>
              <button
                type="button"
                className="icon-button hover-reveal"
                title="Edit person"
                onClick={(e) => openPopover({ kind: "person-edit", personId: person.id, top: topOf(e) })}
              >
                ⚙
              </button>
              <button
                type="button"
                className="icon-button hover-reveal"
                title="Add…"
                onClick={(e) =>
                  openPopover({ kind: "add-menu", groupId: item.group!.id, personId: person.id, top: topOf(e) })
                }
              >
                ＋
              </button>
            </>
          )}
        </span>
```

- [ ] **Step 7: Typecheck and run the full test suite**

Run: `npm run build && npm test`
Expected: `tsc -b` succeeds with no errors; all existing tests still pass (this task adds no new automated tests — there is no existing test file for any `src/ui/*.tsx` component, so this follows the established pattern).

- [ ] **Step 8: Manual verification**

Run: `npm run dev`

In the browser: open a person row (or a group with an attached person) that has a birth date set. Confirm:
- The ⇔ button appears next to the name+age, for both a private person and (if any public-data person with a birth date exists) a read-only one.
- Clicking it changes the canvas's horizontal time axis to span from ~5% before their birth date to ~5% after today, with no change in vertical scroll position and no animation.

- [ ] **Step 9: Commit**

```bash
git add src/ui/App.tsx src/ui/RowRail.tsx
git commit -m "Add rail button to zoom the timeline to a person's life span"
```
