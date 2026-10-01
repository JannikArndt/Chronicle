import { describe, expect, test } from "vitest";
import {
  addItem,
  ageTicks,
  clampSequence,
  knobsOf,
  moveItem,
  rebaseSequence,
  removeItem,
  setKnob,
  spansOf,
  staggerKnobs,
  toggleEnd,
} from "./sequence";
import type { Sequence, SequenceItem, SequenceRules } from "./sequence";

const PLACES: SequenceRules = { freeStart: false, endable: false };
const EDUCATION: SequenceRules = { freeStart: true, endable: true };

function item(label: string, at: number, extra: Partial<SequenceItem> = {}): SequenceItem {
  return { key: label + at, label, fallback: "", at, gap: false, ...extra };
}

function seq(items: SequenceItem[], end: number | null = null): Sequence {
  return { items, end };
}

const ats = (sequence: Sequence) => sequence.items.map((i) => i.at);
const labels = (sequence: Sequence) => sequence.items.map((i) => i.label);

describe("clampSequence", () => {
  test("places start at birth", () => {
    expect(ats(clampSequence(seq([item("Hamburg", 4)]), PLACES, 40))).toEqual([0]);
  });

  test("starts are strictly increasing and within the age", () => {
    const clamped = clampSequence(seq([item("A", 10), item("B", 10), item("C", 99)]), EDUCATION, 40);
    expect(ats(clamped)).toEqual([10, 11, 40]);
  });

  test("an end sits after the last start and not after now", () => {
    expect(clampSequence(seq([item("A", 10)], 5), EDUCATION, 40).end).toBe(11);
    expect(clampSequence(seq([item("A", 10)], 60), EDUCATION, 40).end).toBe(40);
  });

  test("with an end the last start leaves a year of room", () => {
    expect(ats(clampSequence(seq([item("A", 40)], 40), EDUCATION, 40))).toEqual([39]);
  });

  test("a sequence that can't end never has one", () => {
    expect(clampSequence(seq([item("A", 0)], 20), PLACES, 40).end).toBeNull();
  });

  test("an empty sequence has no end", () => {
    expect(clampSequence(seq([], 20), EDUCATION, 40)).toEqual({ items: [], end: null });
  });
});

describe("addItem", () => {
  test("the first item starts at its typical start and ends a typical length later", () => {
    const added = addItem(seq([]), EDUCATION, 40, { label: "School", fallback: "School", length: 12, start: 6 })!;
    expect(ats(added)).toEqual([6]);
    expect(added.end).toBe(18);
  });

  test("without a typical start it starts at 18", () => {
    const added = addItem(seq([]), EDUCATION, 40, { label: "Bachelor", fallback: "Bachelor", length: 3 })!;
    expect(ats(added)).toEqual([18]);
    expect(added.end).toBe(21);
  });

  test("the first place starts at birth and runs until now", () => {
    const added = addItem(seq([]), PLACES, 40, { label: "Hamburg", fallback: "Hamburg", length: 2 })!;
    expect(ats(added)).toEqual([0]);
    expect(added.end).toBeNull();
  });

  test("after an end, the new item starts there and pushes the end on", () => {
    const added = addItem(seq([item("School", 6)], 18), EDUCATION, 40, {
      label: "Bachelor",
      fallback: "Bachelor",
      length: 3,
    })!;
    expect(ats(added)).toEqual([6, 18]);
    expect(added.end).toBe(21);
  });

  test("the end never passes now", () => {
    const added = addItem(seq([item("School", 6)], 18), EDUCATION, 20, { label: "PhD", fallback: "PhD", length: 4 })!;
    expect(added.end).toBe(20);
  });

  test("ongoing: halfway between the last start and now", () => {
    const added = addItem(seq([item("Hamburg", 0)]), PLACES, 40, { label: "Utrecht", fallback: "Utrecht", length: 2 })!;
    expect(ats(added)).toEqual([0, 20]);
  });

  test("no room left: nothing is added", () => {
    expect(addItem(seq([item("A", 0), item("B", 40)]), PLACES, 40, { label: "C", fallback: "C", length: 1 })).toBeUndefined();
    expect(addItem(seq([item("A", 30)], 40), EDUCATION, 40, { label: "C", fallback: "C", length: 1 })).toBeUndefined();
  });

  test("a gap is an item like any other, flagged", () => {
    const added = addItem(seq([item("Bachelor", 19)], 22), EDUCATION, 40, {
      label: "",
      fallback: "",
      length: 3,
      gap: true,
    })!;
    expect(added.items[1].gap).toBe(true);
    expect(added.items[1].at).toBe(22);
    expect(added.end).toBe(25);
  });
});

describe("moveItem: reordering moves names, never dates", () => {
  test("Berlin above Utrecht swaps which place fills which period", () => {
    const before = seq([item("Hamburg", 0), item("Utrecht", 20, { entryId: "e2" }), item("Berlin", 31, { entryId: "e3" })]);
    const after = moveItem(before, 2, 1);
    expect(labels(after)).toEqual(["Hamburg", "Berlin", "Utrecht"]);
    expect(ats(after)).toEqual([0, 20, 31]);
    // The entry travels with its name, so Berlin's record is what moves.
    expect(after.items[1].entryId).toBe("e3");
  });

  test("a gap moves like a name", () => {
    const before = seq([item("Bachelor", 19), item("", 22, { gap: true }), item("Master", 31)], 33);
    const after = moveItem(before, 1, 2);
    expect(after.items.map((i) => i.gap)).toEqual([false, false, true]);
    expect(ats(after)).toEqual([19, 22, 31]);
    expect(after.end).toBe(33);
  });
});

describe("knobs", () => {
  test("places have no start knob and no end knob", () => {
    const knobs = knobsOf(seq([item("A", 0), item("B", 20)]), PLACES);
    expect(knobs).toEqual([{ kind: "boundary", index: 1 }]);
  });

  test("an endable sequence has a start knob and, with an end, an end knob", () => {
    expect(knobsOf(seq([item("A", 6)], 18), EDUCATION)).toEqual([{ kind: "start", index: 0 }, { kind: "end" }]);
    expect(knobsOf(seq([item("A", 6)]), EDUCATION)).toEqual([{ kind: "start", index: 0 }]);
  });

  test("dragging a boundary right pushes the later starts along", () => {
    const moved = setKnob(seq([item("A", 0), item("B", 10), item("C", 12)]), PLACES, 40, { kind: "boundary", index: 1 }, 15);
    expect(ats(moved)).toEqual([0, 15, 16]);
  });

  test("dragging a boundary left stops at the one before it", () => {
    const moved = setKnob(seq([item("A", 0), item("B", 10), item("C", 12)]), PLACES, 40, { kind: "boundary", index: 2 }, 3);
    expect(ats(moved)).toEqual([0, 10, 11]);
  });

  test("the end knob stays after the last start", () => {
    expect(setKnob(seq([item("A", 6)], 18), EDUCATION, 40, { kind: "end" }, 2).end).toBe(7);
  });

  test("knobs closer than a finger drop to a second row", () => {
    expect(staggerKnobs([10, 20, 60, 70, 80])).toEqual([false, true, false, true, false]);
    expect(staggerKnobs([10, 20, 25])).toEqual([false, true, false]);
  });
});

describe("toggleEnd", () => {
  test("sets an end two years after the last start, or clears it", () => {
    const ended = toggleEnd(seq([item("A", 30)]), EDUCATION, 40);
    expect(ended.end).toBe(32);
    expect(toggleEnd(ended, EDUCATION, 40).end).toBeNull();
  });

  test("near now, the end is as close as there is room for", () => {
    expect(toggleEnd(seq([item("A", 39)]), EDUCATION, 40).end).toBe(40);
  });
});

describe("spans", () => {
  test("each item lasts until the next starts; the last until the end or now", () => {
    const spans = spansOf(seq([item("School", 6), item("", 18, { gap: true }), item("Master", 25)], 27));
    expect(spans.map((s) => [s.from, s.to, s.gap])).toEqual([
      [6, 18, false],
      [18, 25, true],
      [25, 27, false],
    ]);
    expect(spansOf(seq([item("Hamburg", 0)]))[0].to).toBeNull();
  });

  test("an unnamed job is called Job", () => {
    expect(spansOf(seq([item("", 20, { fallback: "Job" })]))[0].name).toBe("Job");
  });
});

describe("removeItem", () => {
  test("removing the first place lets the next one start at birth", () => {
    expect(ats(removeItem(seq([item("A", 0), item("B", 20)]), PLACES, 40, 0))).toEqual([0]);
  });
});

describe("ageTicks", () => {
  test("every 2 years for a child, 5 up to 30, 10 after", () => {
    expect(ageTicks(9.75)).toEqual([0, 2, 4, 6, 8]);
    expect(ageTicks(8.5)).toEqual([0, 2, 4, 6]);
    expect(ageTicks(25.7)).toEqual([0, 5, 10, 15, 20]);
    expect(ageTicks(40.75)).toEqual([0, 10, 20, 30]);
  });
});

describe("rebaseSequence", () => {
  test("keeps the years when the birth year changes", () => {
    const draft = seq([item("School", 6), item("Bachelor", 19)], 22);
    const rebased = rebaseSequence(draft, EDUCATION, 1986, 1985, 41);
    expect(ats(rebased)).toEqual([7, 20]);
    expect(rebased.end).toBe(23);
  });
});
