// The sequence model behind the first-run editor's strip and list: things that
// follow one another — places lived, schools, jobs, partners. Item N lasts
// until item N+1 starts; the last one until `end`, or until now when `end` is
// null. Times are whole years after birth ("at 20"), because that is how
// people remember them; the dates are derived from the birth year on commit.
//
// Two rules the whole editor rests on:
// - Reordering moves names, never dates. Dragging Berlin above Utrecht swaps
//   which place fills which period; the years the moves happened stay put.
// - A gap holds time and creates nothing. It is what makes "back to university
//   at 31" a Bachelor → Gap → Master answer instead of an overlap.

import type { Place } from "../model/types";

// Place details picked from the search, remembered with the name they belong
// to: once the name is edited they no longer describe it.
export interface SequencePlace {
  title: string;
  subtitle?: string;
  details?: Place;
}

export interface SequenceItem {
  key: string; // React key, stable for the life of the draft
  label: string;
  // Shown, and saved, while the label is blank: "Job" for an unnamed job, the
  // saved title for an item loaded from a timeline.
  fallback: string;
  at: number; // whole years after birth
  gap: boolean;
  entryId?: string; // the entry this item was loaded from
  place?: SequencePlace;
}

export interface Sequence {
  items: SequenceItem[];
  end: number | null; // whole years after birth; null = still going
}

export interface SequenceRules {
  // Places begin at birth; everything else starts whenever it started.
  freeStart: boolean;
  // Places run until now; school, work and partners can end.
  endable: boolean;
}

export const EMPTY_SEQUENCE: Sequence = { items: [], end: null };

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);

let keyCounter = 0;
export function newItemKey(): string {
  keyCounter += 1;
  return `item-${keyCounter}`;
}

export function itemName(item: SequenceItem): string {
  if (item.gap) return "Gap";
  return item.label.trim() || item.fallback;
}

// Puts every time back in a legal place: starts strictly increasing, the
// first at birth when the start is fixed, everything within 0…age, and the
// end after the last start. `age` is the year age (this year − birth year), so
// a start "at age" means "this year".
export function clampSequence(sequence: Sequence, rules: SequenceRules, age: number): Sequence {
  const count = sequence.items.length;
  if (count === 0) return { items: [], end: null };
  const end = rules.endable ? sequence.end : null;
  const lastStartMax = end !== null ? age - 1 : age;
  const items: SequenceItem[] = [];
  sequence.items.forEach((item, index) => {
    const low = index === 0 ? 0 : items[index - 1].at + 1;
    const high = Math.max(low, lastStartMax - (count - 1 - index));
    const at = index === 0 && !rules.freeStart ? 0 : clamp(Math.round(item.at), low, high);
    items.push(at === item.at ? item : { ...item, at });
  });
  const lastAt = items[count - 1].at;
  const clampedEnd = end === null ? null : clamp(Math.round(end), lastAt + 1, Math.max(lastAt + 1, age));
  return { items, end: clampedEnd };
}

export interface AddOptions {
  label: string;
  fallback: string;
  length: number; // typical length in years
  start?: number; // typical start when this is the first item
  gap?: boolean;
  place?: SequencePlace;
}

// Where a new item goes, by the plan's rules: the first one at its typical
// start (18 if it has none); after an ended sequence at the old end, pushing
// the end on by the item's typical length; after an ongoing one halfway
// between the last start and now. `undefined` means there is no room.
export function addItem(
  sequence: Sequence,
  rules: SequenceRules,
  age: number,
  options: AddOptions,
): Sequence | undefined {
  const last = sequence.items[sequence.items.length - 1];
  let at: number;
  let end = sequence.end;
  if (!last) {
    at = rules.freeStart ? clamp(options.start ?? 18, 0, Math.max(0, rules.endable ? age - 1 : age)) : 0;
    end = rules.endable ? Math.min(age, at + options.length) : null;
    if (end !== null && end <= at) end = null;
  } else if (rules.endable && sequence.end !== null) {
    at = sequence.end;
    if (at >= age) return undefined;
    end = Math.min(age, at + options.length);
  } else {
    at = Math.round((last.at + age) / 2);
    if (at <= last.at || at > age) return undefined;
  }
  const item: SequenceItem = {
    key: newItemKey(),
    label: options.label,
    fallback: options.fallback,
    at,
    gap: options.gap ?? false,
    place: options.place,
  };
  return clampSequence({ items: [...sequence.items, item], end }, rules, age);
}

export function removeItem(sequence: Sequence, rules: SequenceRules, age: number, index: number): Sequence {
  return clampSequence({ ...sequence, items: sequence.items.filter((_, i) => i !== index) }, rules, age);
}

// Reorders what fills each period. Everything that says *what* the item is
// moves with it — name, gap flag, the entry it came from, place details — and
// the `at` of each slot stays where it was.
export function moveItem(sequence: Sequence, from: number, to: number): Sequence {
  if (from === to) return sequence;
  const identities = sequence.items.map((item) => ({ ...item }));
  const [moved] = identities.splice(from, 1);
  identities.splice(to, 0, moved);
  return {
    ...sequence,
    items: identities.map((identity, index) => ({ ...identity, at: sequence.items[index].at })),
  };
}

export function renameItem(sequence: Sequence, index: number, label: string): Sequence {
  return { ...sequence, items: sequence.items.map((item, i) => (i === index ? { ...item, label } : item)) };
}

// ---------- knobs: the draggable boundaries on the strip ----------

export type Knob = { kind: "start"; index: number } | { kind: "boundary"; index: number } | { kind: "end" };

export function knobsOf(sequence: Sequence, rules: SequenceRules): Knob[] {
  const knobs: Knob[] = [];
  sequence.items.forEach((_, index) => {
    if (index > 0) knobs.push({ kind: "boundary", index });
    else if (rules.freeStart) knobs.push({ kind: "start", index });
  });
  if (rules.endable && sequence.end !== null && sequence.items.length > 0) knobs.push({ kind: "end" });
  return knobs;
}

export function knobValue(sequence: Sequence, knob: Knob): number {
  return knob.kind === "end" ? (sequence.end ?? 0) : sequence.items[knob.index].at;
}

export function setKnob(sequence: Sequence, rules: SequenceRules, age: number, knob: Knob, value: number): Sequence {
  if (knob.kind === "end") return clampSequence({ ...sequence, end: value }, rules, age);
  return clampSequence(
    { ...sequence, items: sequence.items.map((item, i) => (i === knob.index ? { ...item, at: value } : item)) },
    rules,
    age,
  );
}

export function setItemStart(sequence: Sequence, rules: SequenceRules, age: number, index: number, at: number): Sequence {
  return setKnob(sequence, rules, age, index === 0 ? { kind: "start", index } : { kind: "boundary", index }, at);
}

// "▸ Still going" and "Set an end" are one switch: an end two years after the
// last start (or as close to now as there is room for), or none.
export function toggleEnd(sequence: Sequence, rules: SequenceRules, age: number): Sequence {
  const last = sequence.items[sequence.items.length - 1];
  if (!rules.endable || !last) return sequence;
  if (sequence.end !== null) return { ...sequence, end: null };
  return clampSequence({ ...sequence, end: clamp(last.at + 2, last.at + 1, age) }, rules, age);
}

// Knobs closer than a finger drop to a second row instead of overlapping.
// Returns, per knob in order, whether it sits on the lower row.
export function staggerKnobs(positions: number[], minDistance = 32): boolean[] {
  let upper = -Infinity;
  let lower = -Infinity;
  return positions.map((x) => {
    const low = x - upper < minDistance && x - lower >= minDistance;
    if (low) lower = x;
    else upper = x;
    return low;
  });
}

// ---------- what the sequence covers ----------

export interface Span {
  from: number;
  to: number | null; // null = until now
  name: string;
  gap: boolean;
  index: number;
}

export function spansOf(sequence: Sequence): Span[] {
  return sequence.items.map((item, index) => ({
    from: item.at,
    to: index + 1 < sequence.items.length ? sequence.items[index + 1].at : sequence.end,
    name: itemName(item),
    gap: item.gap,
    index,
  }));
}

// Age ticks for a strip of `span` years (fractional, to now): every 2 years
// for a child, 5 up to 30, 10 after. A tick too close to the right edge is
// dropped so it doesn't collide with "now".
export function ageTicks(span: number): number[] {
  const step = span <= 12 ? 2 : span <= 30 ? 5 : 10;
  const ticks: number[] = [];
  for (let t = 0; t <= span; t += step) {
    if (t !== 0 && span - t < step * 0.45) continue;
    ticks.push(t);
  }
  return ticks;
}

// Shifts a draft made against one birth year onto another, keeping every year
// where it was — what reloading it from the saved entries would also give.
export function rebaseSequence(
  sequence: Sequence,
  rules: SequenceRules,
  fromBirthYear: number,
  toBirthYear: number,
  age: number,
): Sequence {
  const shift = fromBirthYear - toBirthYear;
  if (shift === 0) return sequence;
  return clampSequence(
    {
      items: sequence.items.map((item) => ({ ...item, at: item.at + shift })),
      end: sequence.end === null ? null : sequence.end + shift,
    },
    rules,
    age,
  );
}
