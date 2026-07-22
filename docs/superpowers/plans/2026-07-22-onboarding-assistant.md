# Onboarding Assistant (Identity, Birth & Places Lived) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Typeform-style conversational onboarding flow that takes a brand-new
user from an empty dataset to a populated "Places lived" timeline (name, birth year,
and a chain of places lived) in under a minute.

**Architecture:** A small pure step-navigation reducer (`assistantFlowReducer`) drives
a hand-written React component (`IdentityBirthPlacesAssistant`) built from one shared,
reusable presentational shell (`AssistantStepShell`). Data is written incrementally
through new `actions.ts` functions, reusing the existing `planEntryInsert`/autosave
pipeline. Place lookup goes through OpenStreetMap Nominatim with no API key.

**Tech Stack:** React 18 + TypeScript (existing app), Vitest for pure-logic unit tests,
no new dependencies.

## Global Constraints

- All stored `ms` values are UTC instants; use `Date.UTC`/`getUTC*` only — never local-time methods.
- No Save/Cancel buttons anywhere — every field autosaves through the existing debounced `persistSoon()` pipeline.
- Every dataset insert must be checked by `planEntryInsert` before being pushed into `dataset.entries`, even when the caller already knows it can't conflict.
- Personal data never touches the repo/filesystem — this plan only adds code, no fixtures with personal data.
- Reuse existing UI primitives (`.small-button`, `.icon-button`, `.hint` CSS classes) rather than duplicating styles.
- `import.meta.glob`/schema/public-data files are out of scope — do not touch `public-data/`.

---

## Task 1: Add `selfPersonId` to the schema and bump `SCHEMA_VERSION`

**Files:**
- Modify: `src/model/types.ts:8` (`SCHEMA_VERSION`), `src/model/types.ts:80-88` (`TimelineDataset`)

**Interfaces:**
- Produces: `TimelineDataset.selfPersonId?: string` — the `Person` who is "you". Consumed by Task 3 (`completeIdentityStep`) and Task 5 (`shouldShowOnboarding`).
- Produces: `SCHEMA_VERSION = 2` — consumed transitively by `src/storage/exportImport.ts` and `src/storage/db.ts`, which both import the constant (no further edits needed there).

- [ ] **Step 1: Bump the schema version and add the field**

Edit `src/model/types.ts`:

```ts
export const SCHEMA_VERSION = 2;
```

```ts
export interface TimelineDataset {
  schemaVersion: number;
  people: Person[];
  groups: Group[];
  categories: Category[];
  rows: TimelineRow[];
  entities: Entity[];
  entries: TimelineEntry[];
  // The Person who is "you" — set once the identity onboarding step completes.
  // Unambiguous even though a Group.personId alone could belong to someone
  // else's solo group (e.g. a partner you've added).
  selfPersonId?: string;
}
```

- [ ] **Step 2: Run the full test suite to confirm nothing breaks**

Run: `npm test`
Expected: all existing suites still PASS (the field is optional, `emptyDataset()` doesn't need to change; `storage.test.ts`'s hardcoded `schemaVersion: 1`/`99` fixtures only assert `.ok === false`, which still holds).

- [ ] **Step 3: Commit**

```bash
git add src/model/types.ts
git commit -m "Add selfPersonId to schema, bump SCHEMA_VERSION to 2"
```

---

## Task 2: `shouldShowOnboarding` trigger predicate

**Files:**
- Create: `src/onboarding/shouldShowOnboarding.ts`
- Test: `src/onboarding/shouldShowOnboarding.test.ts`

**Interfaces:**
- Consumes: `TimelineDataset` from `src/model/types.ts` (Task 1).
- Produces: `shouldShowOnboarding(dataset: TimelineDataset): boolean` — consumed by `App.tsx` in Task 12.

- [ ] **Step 1: Write the failing test**

Create `src/onboarding/shouldShowOnboarding.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { shouldShowOnboarding } from "./shouldShowOnboarding";
import { emptyDataset } from "../model/dataset";

describe("shouldShowOnboarding", () => {
  test("true for a completely fresh dataset", () => {
    expect(shouldShowOnboarding(emptyDataset())).toBe(true);
  });

  test("false once selfPersonId is set", () => {
    const dataset = { ...emptyDataset(), selfPersonId: "person-1" };
    expect(shouldShowOnboarding(dataset)).toBe(false);
  });

  test("false once the user has created a group manually, even without selfPersonId", () => {
    const dataset = emptyDataset();
    dataset.groups.push({ id: "g1", label: "Someone", collapsed: false });
    expect(shouldShowOnboarding(dataset)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/onboarding/shouldShowOnboarding.test.ts`
Expected: FAIL — `Cannot find module './shouldShowOnboarding'`

- [ ] **Step 3: Write the implementation**

Create `src/onboarding/shouldShowOnboarding.ts`:

```ts
// Auto-trigger predicate for the onboarding overlay: only for a genuinely
// fresh dataset. Never re-triggers once either the identity step has
// completed (selfPersonId set) or the user has built something manually.

import type { TimelineDataset } from "../model/types";

export function shouldShowOnboarding(dataset: TimelineDataset): boolean {
  return dataset.selfPersonId === undefined && dataset.groups.length === 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/onboarding/shouldShowOnboarding.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/onboarding/shouldShowOnboarding.ts src/onboarding/shouldShowOnboarding.test.ts
git commit -m "Add shouldShowOnboarding trigger predicate"
```

---

## Task 3: `assistantFlowReducer` — pure step-navigation logic

**Files:**
- Create: `src/onboarding/assistantFlowReducer.ts`
- Test: `src/onboarding/assistantFlowReducer.test.ts`

**Interfaces:**
- Produces: `FlowState<TPhase> = { phase: TPhase; history: TPhase[] }`, `FlowAction<TPhase> = { type: "advance"; to: TPhase } | { type: "back" }`, `assistantFlowReducer<TPhase>(state, action): FlowState<TPhase>`, `initialFlowState<TPhase>(phase: TPhase): FlowState<TPhase>`. Consumed by `useAssistantFlow` (Task 4).

- [ ] **Step 1: Write the failing test**

Create `src/onboarding/assistantFlowReducer.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { assistantFlowReducer, initialFlowState } from "./assistantFlowReducer";

type Phase = { kind: "a" } | { kind: "b" } | { kind: "c" };

describe("assistantFlowReducer", () => {
  test("advance pushes the current phase onto history and moves to the new phase", () => {
    const state = initialFlowState<Phase>({ kind: "a" });
    const next = assistantFlowReducer(state, { type: "advance", to: { kind: "b" } });
    expect(next.phase).toEqual({ kind: "b" });
    expect(next.history).toEqual([{ kind: "a" }]);
  });

  test("back returns to the previous phase and pops history", () => {
    let state = initialFlowState<Phase>({ kind: "a" });
    state = assistantFlowReducer(state, { type: "advance", to: { kind: "b" } });
    state = assistantFlowReducer(state, { type: "advance", to: { kind: "c" } });
    const back = assistantFlowReducer(state, { type: "back" });
    expect(back.phase).toEqual({ kind: "b" });
    expect(back.history).toEqual([{ kind: "a" }]);
  });

  test("back is a no-op at the start of the flow", () => {
    const state = initialFlowState<Phase>({ kind: "a" });
    const back = assistantFlowReducer(state, { type: "back" });
    expect(back).toEqual(state);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/onboarding/assistantFlowReducer.test.ts`
Expected: FAIL — `Cannot find module './assistantFlowReducer'`

- [ ] **Step 3: Write the implementation**

Create `src/onboarding/assistantFlowReducer.ts`:

```ts
// Pure step-navigation state for an onboarding assistant: a stack of
// previously-visited phases so "back" always returns exactly where the user
// came from, including through a variable-length loop (e.g. repeated
// "place" / "until" steps whose count isn't known in advance).

export interface FlowState<TPhase> {
  phase: TPhase;
  history: TPhase[];
}

export type FlowAction<TPhase> = { type: "advance"; to: TPhase } | { type: "back" };

export function initialFlowState<TPhase>(phase: TPhase): FlowState<TPhase> {
  return { phase, history: [] };
}

export function assistantFlowReducer<TPhase>(
  state: FlowState<TPhase>,
  action: FlowAction<TPhase>,
): FlowState<TPhase> {
  if (action.type === "advance") {
    return { phase: action.to, history: [...state.history, state.phase] };
  }
  if (state.history.length === 0) return state;
  const history = state.history.slice(0, -1);
  return { phase: state.history[state.history.length - 1], history };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/onboarding/assistantFlowReducer.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/onboarding/assistantFlowReducer.ts src/onboarding/assistantFlowReducer.test.ts
git commit -m "Add pure assistant step-navigation reducer"
```

---

## Task 4: `useAssistantFlow` React hook

**Files:**
- Create: `src/onboarding/useAssistantFlow.ts`

**Interfaces:**
- Consumes: `assistantFlowReducer`, `initialFlowState`, `FlowAction` from `./assistantFlowReducer` (Task 3).
- Produces: `useAssistantFlow<TPhase>(initialPhase: TPhase): { phase: TPhase; stepIndex: number; canGoBack: boolean; advance(to: TPhase): void; back(): void }`. Consumed by `IdentityBirthPlacesAssistant` (Task 9).

This is a thin `useReducer` wrapper with no branching logic of its own — the branching
is already covered by Task 3's tests — so it has no separate unit test, consistent
with the project's existing convention that React hooks/components are verified via
the dev server and typechecking, not Vitest (see `src/render/engine.ts` vs.
`src/ui/CanvasHost.tsx` in the existing codebase).

- [ ] **Step 1: Write the implementation**

Create `src/onboarding/useAssistantFlow.ts`:

```ts
import { useReducer } from "react";
import { assistantFlowReducer, initialFlowState } from "./assistantFlowReducer";
import type { FlowAction } from "./assistantFlowReducer";

export interface AssistantFlow<TPhase> {
  phase: TPhase;
  stepIndex: number; // 0-based count of steps already completed in this flow
  canGoBack: boolean;
  advance(to: TPhase): void;
  back(): void;
}

export function useAssistantFlow<TPhase>(initialPhase: TPhase): AssistantFlow<TPhase> {
  const [state, dispatch] = useReducer(
    (s: ReturnType<typeof initialFlowState<TPhase>>, action: FlowAction<TPhase>) =>
      assistantFlowReducer(s, action),
    initialPhase,
    initialFlowState,
  );
  return {
    phase: state.phase,
    stepIndex: state.history.length,
    canGoBack: state.history.length > 0,
    advance: (to: TPhase) => dispatch({ type: "advance", to }),
    back: () => dispatch({ type: "back" }),
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc -b`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/onboarding/useAssistantFlow.ts
git commit -m "Add useAssistantFlow hook wrapping the flow reducer"
```

---

## Task 5: `completeIdentityStep` action

**Files:**
- Modify: `src/state/actions.ts:172-185` (`ensureCategory`), add new export near `addGroup` (`src/state/actions.ts:138-150`)
- Test: `src/state/actions.test.ts`

**Interfaces:**
- Consumes: `newId`, `updateDataset` (both already private to `actions.ts`), `Category`, `Group`, `Person`, `TimelineRow` types (already imported in `actions.ts`).
- Produces: `completeIdentityStep(name: string): { personId: string; groupId: string; placesRowId: string }`. Consumed by `IdentityBirthPlacesAssistant` (Task 9).
- Produces (widened): `ensureCategory(dataset, label, color, icon, concurrency = "concurrent")` — existing call sites (`addPersonToGroup`, `addRow`, `addSubRow`) are unaffected since the new parameter defaults to today's behavior.

- [ ] **Step 1: Write the failing test**

Add to `src/state/actions.test.ts` (new imports at the top, new `describe` block at the bottom):

```ts
import { completeIdentityStep, replaceDataset, selectRow, startDraft, updateDraft } from "./actions";
```

```ts
describe("onboarding: completeIdentityStep", () => {
  test("creates a self person, group, and an exclusive Places lived row", () => {
    replaceDataset(emptyDataset());
    const result = completeIdentityStep("Jannik");
    const state = appStore.getState();

    expect(state.dataset.selfPersonId).toBe(result.personId);

    const person = state.dataset.people.find((p) => p.id === result.personId);
    expect(person?.label).toBe("Jannik");

    const group = state.dataset.groups.find((g) => g.id === result.groupId);
    expect(group?.personId).toBe(result.personId);

    const row = state.dataset.rows.find((r) => r.id === result.placesRowId);
    expect(row?.label).toBe("Places lived");
    expect(row?.groupId).toBe(result.groupId);

    const category = state.dataset.categories.find((c) => c.id === row?.categoryId);
    expect(category?.concurrency).toBe("exclusive");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/state/actions.test.ts -t "completeIdentityStep"`
Expected: FAIL — `completeIdentityStep is not a function` / import error

- [ ] **Step 3: Widen `ensureCategory` and add `completeIdentityStep`**

Modify `ensureCategory` in `src/state/actions.ts:172-185`:

```ts
function ensureCategory(
  dataset: TimelineDataset,
  label: string,
  color: string,
  icon: string,
  concurrency: Category["concurrency"] = "concurrent",
): Category {
  const existing = dataset.categories.find((c) => c.label === label);
  if (existing) return existing;
  const category: Category = {
    id: newId("cat"),
    label,
    color,
    icon,
    concurrency,
    defaultVisibility: "private",
  };
  dataset.categories.push(category);
  return category;
}
```

Add a new export directly above `addGroup` (`src/state/actions.ts:138`):

```ts
export interface IdentitySetupResult {
  personId: string;
  groupId: string;
  placesRowId: string;
}

// Onboarding step 1 (docs/superpowers/specs/2026-07-22-onboarding-assistant-design.md):
// creates the user's own Person + Group and their first row, all in one save.
export function completeIdentityStep(name: string): IdentitySetupResult {
  let result!: IdentitySetupResult;
  updateDataset((dataset) => {
    const person: Person = { id: newId("person"), label: name };
    dataset.people.push(person);
    const group: Group = { id: newId("group"), label: name, personId: person.id, collapsed: false };
    dataset.groups.push(group);
    dataset.selfPersonId = person.id;
    const category = ensureCategory(dataset, "Places lived", "#8ba66f", "🏠", "exclusive");
    const row: TimelineRow = { id: newId("row"), groupId: group.id, categoryId: category.id, label: "Places lived" };
    dataset.rows.push(row);
    result = { personId: person.id, groupId: group.id, placesRowId: row.id };
    return dataset;
  });
  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/state/actions.test.ts -t "completeIdentityStep"`
Expected: PASS (1 test)

- [ ] **Step 5: Run the full suite and commit**

Run: `npm test`
Expected: all suites PASS

```bash
git add src/state/actions.ts src/state/actions.test.ts
git commit -m "Add completeIdentityStep onboarding action"
```

---

## Task 6: `addOnboardingPlaceEntry` action

**Files:**
- Modify: `src/state/actions.ts` (new export near `ensureEntity`, `src/state/actions.ts:254-265`)
- Test: `src/state/actions.test.ts`

**Interfaces:**
- Consumes: `completeIdentityStep` (Task 5), `ensureEntity`, `planEntryInsert`, `newId`, `updateDataset`, `appStore` (all already present in `actions.ts`).
- Produces: `addOnboardingPlaceEntry(rowId: string, place: { label: string; startMs: number; endMs?: number }): void`. Consumed by `IdentityBirthPlacesAssistant` (Task 9).

- [ ] **Step 1: Write the failing test**

Add to `src/state/actions.test.ts`:

```ts
test("addOnboardingPlaceEntry chains consecutive places and leaves the last one ongoing", () => {
  replaceDataset(emptyDataset());
  const { placesRowId } = completeIdentityStep("Jannik");
  const year1990 = Date.UTC(1990, 6, 1);
  const year2005 = Date.UTC(2005, 6, 1);

  addOnboardingPlaceEntry(placesRowId, { label: "Berlin", startMs: year1990, endMs: year2005 });
  addOnboardingPlaceEntry(placesRowId, { label: "Munich", startMs: year2005 });

  const entries = appStore.getState().dataset.entries.filter((e) => e.rowId === placesRowId);
  expect(entries).toHaveLength(2);

  const berlin = entries.find((e) => e.title === "Berlin")!;
  const munich = entries.find((e) => e.title === "Munich")!;
  expect(berlin.end?.ms).toBe(year2005);
  expect(berlin.start.precision).toBe("year");
  expect(munich.end).toBeUndefined();
  expect(munich.linkedEntityIds).toHaveLength(1);
});
```

(Add this test inside the same `describe("onboarding: completeIdentityStep", ...)` block from Task 5, or its own `describe("onboarding: addOnboardingPlaceEntry", ...)` block — either is fine.)

Update the import line to include the new function:

```ts
import { addOnboardingPlaceEntry, completeIdentityStep, replaceDataset, selectRow, startDraft, updateDraft } from "./actions";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/state/actions.test.ts -t "chains consecutive places"`
Expected: FAIL — `addOnboardingPlaceEntry is not a function`

- [ ] **Step 3: Write the implementation**

Add to `src/state/actions.ts`, near `ensureEntity`:

```ts
export interface OnboardingPlaceAnswer {
  label: string;
  startMs: number;
  endMs?: number; // absent = "still living here" (ongoing)
}

// Onboarding places loop: entries are built directly (not through the
// click-driven startDraft flow) but still pass through planEntryInsert,
// preserving the invariant that every insert is checked — by construction
// these are always chronological appends, so it's a defensive no-op here.
export function addOnboardingPlaceEntry(rowId: string, place: OnboardingPlaceAnswer): void {
  const entity = ensureEntity(place.label, "place");
  const draft: TimelineEntry = {
    id: newId("entry"),
    rowId,
    title: place.label,
    start: { ms: place.startMs, precision: "year" },
    end: place.endMs !== undefined ? { ms: place.endMs, precision: "year" } : undefined,
    linkedEntityIds: [entity.id],
    visibility: "private",
  };
  const plan = planEntryInsert(appStore.getState().dataset, draft);
  updateDataset((dataset) => {
    if (plan.kind === "autoClose") {
      const previous = dataset.entries.find((e) => e.id === plan.previousEntry.id);
      if (previous) previous.end = plan.closeAt;
    }
    dataset.entries.push(draft);
    return dataset;
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/state/actions.test.ts -t "chains consecutive places"`
Expected: PASS

- [ ] **Step 5: Run the full suite and commit**

Run: `npm test`
Expected: all suites PASS

```bash
git add src/state/actions.ts src/state/actions.test.ts
git commit -m "Add addOnboardingPlaceEntry onboarding action"
```

---

## Task 7: `nominatim.ts` — place search wrapper

**Files:**
- Create: `src/onboarding/nominatim.ts`
- Test: `src/onboarding/nominatim.test.ts`

**Interfaces:**
- Produces: `interface PlaceSuggestion { label: string; lat: string; lon: string }`, `searchPlaces(query: string, fetchImpl?: typeof fetch): Promise<PlaceSuggestion[]>`. Consumed by `PlaceAutocompleteInput` (Task 8).

- [ ] **Step 1: Write the failing test**

Create `src/onboarding/nominatim.test.ts`:

```ts
import { describe, expect, test, vi } from "vitest";
import { searchPlaces } from "./nominatim";

function mockFetch(body: unknown, ok = true): typeof fetch {
  return vi.fn().mockResolvedValue({ ok, json: () => Promise.resolve(body) }) as unknown as typeof fetch;
}

describe("searchPlaces", () => {
  test("returns an empty array for very short queries without calling fetch", async () => {
    const fetchImpl = mockFetch([]);
    const result = await searchPlaces("a", fetchImpl);
    expect(result).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("maps Nominatim results to PlaceSuggestion", async () => {
    const fetchImpl = mockFetch([{ display_name: "Berlin, Germany", lat: "52.52", lon: "13.40" }]);
    const result = await searchPlaces("Berlin", fetchImpl);
    expect(result).toEqual([{ label: "Berlin, Germany", lat: "52.52", lon: "13.40" }]);
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining("nominatim.openstreetmap.org/search"),
      expect.objectContaining({ headers: expect.objectContaining({ Accept: "application/json" }) }),
    );
  });

  test("returns an empty array when the request fails", async () => {
    const fetchImpl = mockFetch([], false);
    const result = await searchPlaces("Berlin", fetchImpl);
    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/onboarding/nominatim.test.ts`
Expected: FAIL — `Cannot find module './nominatim'`

- [ ] **Step 3: Write the implementation**

Create `src/onboarding/nominatim.ts`:

```ts
// OpenStreetMap Nominatim place search: no API key, no backend to hide one
// behind. Debouncing to stay under the 1 req/sec usage policy happens in
// PlaceAutocompleteInput, not here — this module is a thin, DI-friendly
// fetch wrapper so it's testable without mocking globals.

export interface PlaceSuggestion {
  label: string;
  lat: string;
  lon: string;
}

interface NominatimResult {
  display_name: string;
  lat: string;
  lon: string;
}

export async function searchPlaces(query: string, fetchImpl: typeof fetch = fetch): Promise<PlaceSuggestion[]> {
  if (query.trim().length < 2) return [];
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&q=${encodeURIComponent(query)}`;
  const response = await fetchImpl(url, { headers: { Accept: "application/json" } });
  if (!response.ok) return [];
  const results = (await response.json()) as NominatimResult[];
  return results.map((r) => ({ label: r.display_name, lat: r.lat, lon: r.lon }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/onboarding/nominatim.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/onboarding/nominatim.ts src/onboarding/nominatim.test.ts
git commit -m "Add Nominatim place search wrapper"
```

---

## Task 8: `AssistantStepShell` — shared step UI

**Files:**
- Create: `src/onboarding/AssistantStepShell.tsx`
- Modify: `src/ui/styles.css` (append new section)

**Interfaces:**
- Produces: `<AssistantStepShell prompt hint? stepIndex onBack? onSkip>{children}</AssistantStepShell>`. Consumed by `IdentityBirthPlacesAssistant` (Task 9).

- [ ] **Step 1: Write the component**

Create `src/onboarding/AssistantStepShell.tsx`:

```tsx
// Shared presentational shell for every onboarding-assistant step: one
// prompt, one input area, growing progress dots, back/skip navigation.
// This is the single piece of visual/interaction consistency shared across
// assistants — no generic step-definition/runner abstraction on top of it.

import type { ReactNode } from "react";

interface AssistantStepShellProps {
  prompt: string;
  hint?: string;
  stepIndex: number; // 0-based count of steps already completed in this flow
  onBack?: () => void;
  onSkip: () => void;
  children: ReactNode;
}

export function AssistantStepShell({ prompt, hint, stepIndex, onBack, onSkip, children }: AssistantStepShellProps) {
  const dotCount = stepIndex + 1;
  return (
    <div className="assistant-shell">
      <div className="assistant-progress">
        {Array.from({ length: dotCount }, (_, index) => (
          <span
            key={index}
            className={`assistant-dot ${index < dotCount - 1 ? "assistant-dot-done" : "assistant-dot-current"}`}
          />
        ))}
      </div>
      <div className="assistant-prompt">{prompt}</div>
      <div className="assistant-input-area">{children}</div>
      {hint && <div className="hint">{hint}</div>}
      <div className="assistant-nav">
        {onBack ? (
          <button type="button" className="icon-button" onClick={onBack}>
            ← Back
          </button>
        ) : (
          <span />
        )}
        <button type="button" className="icon-button" onClick={onSkip}>
          Skip for now
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add the CSS**

Append to `src/ui/styles.css`:

```css
/* ---------- onboarding assistant ---------- */

.assistant-overlay {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: grid;
  place-items: center;
  background: rgba(41, 37, 34, 0.35);
}

.assistant-shell {
  width: 360px;
  max-width: calc(100vw - 32px);
  background: #fff;
  border: 1px solid #d6d3cd;
  border-radius: 14px;
  box-shadow: 0 16px 44px rgba(0, 0, 0, 0.22);
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.assistant-progress {
  display: flex;
  gap: 5px;
}

.assistant-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #e5e3dd;
}

.assistant-dot-done {
  background: #a8a29e;
}

.assistant-dot-current {
  background: #c2410c;
}

.assistant-prompt {
  font-size: 17px;
  font-weight: 600;
}

.assistant-input-area {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.assistant-input-area input {
  font-size: 15px;
  padding: 8px 10px;
}

.assistant-nav {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.place-autocomplete {
  position: relative;
}

.place-suggestions {
  list-style: none;
  margin: 4px 0 0;
  padding: 0;
  border: 1px solid #d6d3cd;
  border-radius: 8px;
  background: #fff;
  max-height: 180px;
  overflow-y: auto;
}

.place-suggestions li button {
  width: 100%;
  text-align: left;
  font-size: 13px;
}

@media (max-width: 640px) {
  .assistant-overlay {
    align-items: stretch;
    background: #fafaf8;
  }

  .assistant-shell {
    width: 100%;
    max-width: none;
    height: 100%;
    border-radius: 0;
    border: none;
    justify-content: center;
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc -b`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/onboarding/AssistantStepShell.tsx src/ui/styles.css
git commit -m "Add shared AssistantStepShell UI and onboarding styles"
```

---

## Task 9: `PlaceAutocompleteInput` component

**Files:**
- Create: `src/onboarding/PlaceAutocompleteInput.tsx`

**Interfaces:**
- Consumes: `searchPlaces`, `PlaceSuggestion` from `./nominatim` (Task 7).
- Produces: `<PlaceAutocompleteInput value onChange onSubmit />`. Consumed by `IdentityBirthPlacesAssistant` (Task 10).

- [ ] **Step 1: Write the component**

Create `src/onboarding/PlaceAutocompleteInput.tsx`:

```tsx
// Free-text input backed by Nominatim suggestions. Never blocks the
// onboarding flow: typing and pressing Enter without picking a suggestion
// (or with the network unavailable) is always a valid answer.

import { useEffect, useRef, useState } from "react";
import { searchPlaces } from "./nominatim";
import type { PlaceSuggestion } from "./nominatim";

interface PlaceAutocompleteInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
}

const DEBOUNCE_MS = 500;

export function PlaceAutocompleteInput({ value, onChange, onSubmit }: PlaceAutocompleteInputProps) {
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    if (value.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    debounceRef.current = setTimeout(() => {
      searchPlaces(value)
        .then(setSuggestions)
        .catch(() => setSuggestions([]));
    }, DEBOUNCE_MS);
    return () => clearTimeout(debounceRef.current);
  }, [value]);

  return (
    <div className="place-autocomplete">
      <input
        autoFocus
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => event.key === "Enter" && onSubmit()}
        placeholder="City, region, or country"
      />
      {suggestions.length > 0 && (
        <ul className="place-suggestions">
          {suggestions.map((suggestion) => (
            <li key={`${suggestion.lat},${suggestion.lon}`}>
              <button
                type="button"
                className="menu-item"
                onClick={() => {
                  onChange(suggestion.label);
                  setSuggestions([]);
                }}
              >
                {suggestion.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc -b`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/onboarding/PlaceAutocompleteInput.tsx
git commit -m "Add Nominatim-backed place autocomplete input"
```

---

## Task 10: `IdentityBirthPlacesAssistant` — the assistant itself

**Files:**
- Create: `src/onboarding/IdentityBirthPlacesAssistant.tsx`

**Interfaces:**
- Consumes: `useAssistantFlow` (Task 4), `completeIdentityStep`, `addOnboardingPlaceEntry`, `updatePerson` from `../state/actions` (Tasks 5, 6, existing), `parseDateInput` from `../model/fuzzyDate` (existing), `AssistantStepShell` (Task 8), `PlaceAutocompleteInput` (Task 9).
- Produces: `<IdentityBirthPlacesAssistant onFinished={() => void} />`. Consumed by `App.tsx` (Task 11).

- [ ] **Step 1: Write the component**

Create `src/onboarding/IdentityBirthPlacesAssistant.tsx`:

```tsx
// Sub-project 1 of the onboarding-assistant initiative
// (docs/superpowers/specs/2026-07-22-onboarding-assistant-design.md):
// name -> birth year -> a chained loop of places lived, each with an
// optional "until" year. A blank "until" means "still living here" and
// ends the loop; "That's all for now" is always available as well.

import { useState } from "react";
import { AssistantStepShell } from "./AssistantStepShell";
import { PlaceAutocompleteInput } from "./PlaceAutocompleteInput";
import { useAssistantFlow } from "./useAssistantFlow";
import { addOnboardingPlaceEntry, completeIdentityStep, updatePerson } from "../state/actions";
import { parseDateInput } from "../model/fuzzyDate";

type Phase =
  | { kind: "name" }
  | { kind: "birthYear" }
  | { kind: "place"; iteration: number }
  | { kind: "until"; iteration: number };

interface IdentityBirthPlacesAssistantProps {
  onFinished: () => void;
}

export function IdentityBirthPlacesAssistant({ onFinished }: IdentityBirthPlacesAssistantProps) {
  const flow = useAssistantFlow<Phase>({ kind: "name" });
  const [name, setName] = useState("");
  const [birthYearText, setBirthYearText] = useState("");
  const [placeText, setPlaceText] = useState("");
  const [untilText, setUntilText] = useState("");
  const [setup, setSetup] = useState<{ personId: string; placesRowId: string } | null>(null);
  const [nextStartMs, setNextStartMs] = useState<number | null>(null);
  const [pendingPlaceLabel, setPendingPlaceLabel] = useState<string | null>(null);

  const commitName = () => {
    const trimmed = name.trim();
    if (trimmed === "") return;
    const result = completeIdentityStep(trimmed);
    setSetup({ personId: result.personId, placesRowId: result.placesRowId });
    flow.advance({ kind: "birthYear" });
  };

  const commitBirthYear = () => {
    const parsed = parseDateInput(birthYearText.trim());
    if (!parsed) return;
    if (setup) updatePerson(setup.personId, { birthDate: parsed.ms });
    setNextStartMs(parsed.ms);
    flow.advance({ kind: "place", iteration: 1 });
  };

  const commitPlace = () => {
    const trimmed = placeText.trim();
    if (trimmed === "" || flow.phase.kind !== "place") return;
    setPendingPlaceLabel(trimmed);
    setPlaceText("");
    flow.advance({ kind: "until", iteration: flow.phase.iteration });
  };

  const commitUntil = () => {
    const trimmed = untilText.trim();
    const endParsed = trimmed === "" ? null : parseDateInput(trimmed);
    if (trimmed !== "" && !endParsed) return;
    if (!setup || nextStartMs === null || pendingPlaceLabel === null || flow.phase.kind !== "until") return;

    addOnboardingPlaceEntry(setup.placesRowId, {
      label: pendingPlaceLabel,
      startMs: nextStartMs,
      endMs: endParsed?.ms,
    });
    setUntilText("");
    const finishedIteration = flow.phase.iteration;
    setPendingPlaceLabel(null);

    if (!endParsed) {
      onFinished();
      return;
    }
    setNextStartMs(endParsed.ms);
    flow.advance({ kind: "place", iteration: finishedIteration + 1 });
  };

  switch (flow.phase.kind) {
    case "name":
      return (
        <AssistantStepShell prompt="What should we call your timeline?" stepIndex={flow.stepIndex} onSkip={onFinished}>
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && commitName()}
            placeholder="Your name"
          />
          <button type="button" className="small-button" onClick={commitName}>
            Next →
          </button>
        </AssistantStepShell>
      );

    case "birthYear":
      return (
        <AssistantStepShell
          prompt="When were you born?"
          hint="Just the year is enough for now — you can fine-tune the exact month or day later."
          stepIndex={flow.stepIndex}
          onBack={flow.canGoBack ? flow.back : undefined}
          onSkip={onFinished}
        >
          <input
            autoFocus
            value={birthYearText}
            onChange={(event) => setBirthYearText(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && commitBirthYear()}
            placeholder="e.g. 1990"
            inputMode="numeric"
          />
          <button type="button" className="small-button" onClick={commitBirthYear}>
            Next →
          </button>
        </AssistantStepShell>
      );

    case "place":
      return (
        <AssistantStepShell
          prompt={flow.phase.iteration === 1 ? "Where were you born?" : "Where did you live next?"}
          hint="You can fine-tune the exact address later."
          stepIndex={flow.stepIndex}
          onBack={flow.canGoBack ? flow.back : undefined}
          onSkip={onFinished}
        >
          <PlaceAutocompleteInput value={placeText} onChange={setPlaceText} onSubmit={commitPlace} />
          <button type="button" className="small-button" onClick={commitPlace}>
            Next →
          </button>
          {flow.phase.iteration > 1 && (
            <button type="button" className="icon-button" onClick={onFinished}>
              That's all for now
            </button>
          )}
        </AssistantStepShell>
      );

    case "until":
      return (
        <AssistantStepShell
          prompt={`Until when did you live in ${pendingPlaceLabel ?? "this place"}?`}
          hint="Leave blank if you still live there. You can fine-tune the exact month or day later."
          stepIndex={flow.stepIndex}
          onBack={flow.canGoBack ? flow.back : undefined}
          onSkip={onFinished}
        >
          <input
            value={untilText}
            onChange={(event) => setUntilText(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && commitUntil()}
            placeholder="e.g. 2005, or leave blank"
            inputMode="numeric"
          />
          <button type="button" className="small-button" onClick={commitUntil}>
            {untilText.trim() === "" ? "Still living here →" : "Next →"}
          </button>
        </AssistantStepShell>
      );
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc -b`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/onboarding/IdentityBirthPlacesAssistant.tsx
git commit -m "Add IdentityBirthPlacesAssistant onboarding flow"
```

---

## Task 11: Wire the assistant into `App.tsx` and the rail footer nudge

**Files:**
- Modify: `src/ui/App.tsx:1-102`
- Modify: `src/ui/RowRail.tsx:37-85`

**Interfaces:**
- Consumes: `shouldShowOnboarding` (Task 2), `IdentityBirthPlacesAssistant` (Task 10).

- [ ] **Step 1: Add onboarding state and the overlay to `App.tsx`**

Modify `src/ui/App.tsx`. Change the import line and add the two onboarding imports:

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { computeLayout } from "../render/layout";
import type { TimelineEngine } from "../render/engine";
import {
  cancelDatePicking,
  clearSelection,
  initializeApp,
} from "../state/actions";
import { appStore, mergedDataset, useAppState } from "../state/store";
import { CanvasHost } from "./CanvasHost";
import { DataMenu } from "./DataMenu";
import { DetailPanel } from "./DetailPanel";
import { RowRail } from "./RowRail";
import { SearchBar } from "./SearchBar";
import { IdentityBirthPlacesAssistant } from "../onboarding/IdentityBirthPlacesAssistant";
import { shouldShowOnboarding } from "../onboarding/shouldShowOnboarding";
```

Inside the `App` function, add onboarding state right after the existing `useEffect` that calls `initializeApp()`:

```tsx
  const [onboardingOpen, setOnboardingOpen] = useState(false);

  useEffect(() => {
    void initializeApp();
  }, []);

  useEffect(() => {
    if (loaded && shouldShowOnboarding(state.dataset)) setOnboardingOpen(true);
    // Only re-check right after load — once open, later dataset changes
    // (created by the assistant itself) must not affect this decision.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);
```

Pass a launcher into `RowRail` and render the overlay at the end of `.main-area`:

```tsx
      <div className="main-area">
        <RowRail
          layout={layout}
          railContentRef={railContentRef}
          onStartOnboarding={() => setOnboardingOpen(true)}
        />
        <CanvasHost layout={layout} railContentRef={railContentRef} engineRef={engineRef} />
        {isEmpty && (
          <div className="empty-hint">
            Start with “＋ Group” in the bottom-left — e.g. a group called “Me” that is a person.
          </div>
        )}
        <DetailPanel />
      </div>
      {onboardingOpen && (
        <div className="assistant-overlay">
          <IdentityBirthPlacesAssistant onFinished={() => setOnboardingOpen(false)} />
        </div>
      )}
```

- [ ] **Step 2: Add the rail-footer nudge to `RowRail.tsx`**

Modify `src/ui/RowRail.tsx`. Add `onStartOnboarding` to the props interface:

```tsx
interface RowRailProps {
  layout: Layout;
  railContentRef: RefObject<HTMLDivElement>;
  onStartOnboarding: () => void;
}
```

Destructure it in the component signature:

```tsx
export function RowRail({ layout, railContentRef, onStartOnboarding }: RowRailProps) {
```

Add the nudge button in the footer, before the existing "＋ Group" button:

```tsx
      <div className="rail-footer">
        {dataset.selfPersonId === undefined && (
          <button type="button" className="small-button" onClick={onStartOnboarding}>
            ✨ Set up your timeline
          </button>
        )}
        <button
          type="button"
          className="small-button"
          onClick={() => setPopover({ kind: "add-group", top: 0 })}
        >
          ＋ Group
        </button>
      </div>
```

- [ ] **Step 3: Typecheck and build**

Run: `npx tsc -b`
Expected: no errors

Run: `npm run build`
Expected: build succeeds

- [ ] **Step 4: Commit**

```bash
git add src/ui/App.tsx src/ui/RowRail.tsx
git commit -m "Wire onboarding assistant into App and rail footer nudge"
```

---

## Task 12: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full automated test suite**

Run: `npm test`
Expected: all suites PASS, including the new `shouldShowOnboarding`, `assistantFlowReducer`, `nominatim`, and the two new `actions.test.ts` cases.

- [ ] **Step 2: Run the production build**

Run: `npm run build`
Expected: `tsc -b && vite build` completes with no errors.

- [ ] **Step 3: Manual verification in the dev server**

Run: `npm run dev`, open the app in a browser with a clean IndexedDB (private/incognito window, or clear IndexedDB in devtools for the dev origin).

Walk through:
1. The onboarding overlay auto-opens on first load.
2. Enter a name, press Enter → advances to birth year.
3. Enter a 4-digit year, press Enter → advances to "Where were you born?".
4. Type a city name, wait ~500ms → suggestions appear from Nominatim (requires network); click one or just press Enter with free text.
5. Leave "Until" blank, press Enter → overlay closes; the timeline now shows one group with a "Places lived" row containing one ongoing entry.
6. Reopen via the rail footer's "Set up your timeline" is no longer shown (since `selfPersonId` is now set) — confirms the nudge condition.
7. Refresh the page (reload) → the overlay does NOT reappear (dataset is non-empty), and the created entry persists (IndexedDB).

Then repeat with a second clean profile, this time filling in an "until" year for the first place to confirm the loop continues to a second "Where did you live next?" step, and that "That's all for now" ends it without a trailing ongoing entry.

Verify programmatically via the existing test hook, in the browser console:

```js
window.__chronicleStore.getState().dataset.selfPersonId // should be a string
window.__chronicleStore.getState().dataset.entries.filter(e => e.rowId ===
  window.__chronicleStore.getState().dataset.rows.find(r => r.label === "Places lived").id)
// should show the chained entries with correct start/end ms and year precision
```

- [ ] **Step 4: Update CLAUDE.md if anything diverged from the design during implementation**

If the implementation matches the spec exactly, no changes needed. Otherwise, note the divergence in `CLAUDE.md`'s architecture section under `src/onboarding/`.

- [ ] **Step 5: Final commit (if Step 4 produced changes)**

```bash
git add CLAUDE.md
git commit -m "Document onboarding assistant in CLAUDE.md"
```
