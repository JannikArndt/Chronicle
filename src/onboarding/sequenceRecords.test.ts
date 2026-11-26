import { describe, expect, test } from "vitest";
import { isEmptyPlan, loadSequence, planSequenceEntries } from "./sequenceRecords";
import { addItem, moveItem, renameItem, setKnob } from "./sequence";
import type { Sequence, SequenceRules } from "./sequence";
import type { TimelineEntry } from "../model/types";

const BIRTH = 1986;
const AGE = 40;
const PLACES: SequenceRules = { freeStart: false, endable: false };
const EDUCATION: SequenceRules = { freeStart: true, endable: true };

const year = (y: number) => ({ ms: Date.UTC(y, 0, 1), precision: "year" as const });

function entry(id: string, title: string, from: number, to?: number, extra: Partial<TimelineEntry> = {}): TimelineEntry {
  return { id, rowId: "row", title, start: year(from), end: to === undefined ? undefined : year(to), ...extra };
}

function load(entries: TimelineEntry[], rules: SequenceRules, withPlace = false): Sequence {
  const result = loadSequence(entries, { birthYear: BIRTH, age: AGE, rules, withPlace });
  if (!result.ok) throw new Error(result.reason);
  return result.sequence;
}

const summary = (sequence: Sequence) => sequence.items.map((i) => (i.gap ? `gap@${i.at}` : `${i.label}@${i.at}`));

describe("loadSequence", () => {
  test("entries become items at their age, the last end becomes the end", () => {
    const sequence = load([entry("a", "School", 1992, 2004), entry("b", "Bachelor", 2004, 2008)], EDUCATION);
    expect(summary(sequence)).toEqual(["School@6", "Bachelor@18"]);
    expect(sequence.end).toBe(22);
    expect(sequence.items[1].entryId).toBe("b");
  });

  test("a hole between two entries becomes a gap", () => {
    const sequence = load([entry("a", "Bachelor", 2005, 2008), entry("b", "Master", 2017, 2019)], EDUCATION);
    expect(summary(sequence)).toEqual(["Bachelor@19", "gap@22", "Master@31"]);
    expect(sequence.end).toBe(33);
  });

  test("an ongoing last entry means no end", () => {
    expect(load([entry("a", "Hamburg", 1986, 2006), entry("b", "Berlin", 2006)], PLACES).end).toBeNull();
  });

  test("entries in any order load sorted", () => {
    expect(summary(load([entry("b", "Berlin", 2006), entry("a", "Hamburg", 1986, 2006)], PLACES))).toEqual([
      "Hamburg@0",
      "Berlin@20",
    ]);
  });

  test("overlapping entries can't be shown", () => {
    const result = loadSequence([entry("a", "Job", 2008, 2012), entry("b", "Side job", 2010, 2011)], {
      birthYear: BIRTH,
      age: AGE,
      rules: EDUCATION,
      withPlace: false,
    });
    expect(result).toEqual({ ok: false, reason: "overlap" });
  });

  test("an ongoing entry that isn't the last one overlaps everything after it", () => {
    const result = loadSequence([entry("a", "Job", 2008), entry("b", "Other", 2012, 2014)], {
      birthYear: BIRTH,
      age: AGE,
      rules: EDUCATION,
      withPlace: false,
    });
    expect(result.ok).toBe(false);
  });

  test("two starts in the same year can't be shown either", () => {
    const result = loadSequence(
      [
        entry("a", "A", 2008, 2008, { end: { ms: Date.UTC(2008, 5, 1), precision: "month" } }),
        entry("b", "B", 2008, undefined, { start: { ms: Date.UTC(2008, 6, 1), precision: "month" } }),
      ],
      { birthYear: BIRTH, age: AGE, rules: EDUCATION, withPlace: false },
    );
    expect(result).toEqual({ ok: false, reason: "unrepresentable" });
  });

  test("an empty row is an empty sequence", () => {
    expect(load([], EDUCATION)).toEqual({ items: [], end: null });
  });
});

describe("planSequenceEntries", () => {
  test("a fresh draft creates one entry per item, year precision, the last one ongoing", () => {
    let sequence: Sequence = { items: [], end: null };
    sequence = addItem(sequence, PLACES, AGE, { label: "Hamburg", fallback: "Hamburg", length: 2 })!;
    sequence = addItem(sequence, PLACES, AGE, { label: "Berlin", fallback: "Berlin", length: 2 })!;
    const plan = planSequenceEntries(sequence, [], BIRTH, false);
    expect(plan.creates).toEqual([
      { title: "Hamburg", start: year(1986), end: year(2006) },
      { title: "Berlin", start: year(2006), end: undefined },
    ]);
    expect(plan.updates).toEqual([]);
    expect(plan.deletes).toEqual([]);
  });

  test("a gap creates nothing, and the item before it ends where the gap starts", () => {
    let sequence: Sequence = { items: [], end: null };
    sequence = addItem(sequence, EDUCATION, AGE, { label: "Bachelor", fallback: "Bachelor", length: 3, start: 19 })!;
    sequence = addItem(sequence, EDUCATION, AGE, { label: "", fallback: "", length: 9, gap: true })!;
    sequence = addItem(sequence, EDUCATION, AGE, { label: "Master", fallback: "Master", length: 2 })!;
    const plan = planSequenceEntries(sequence, [], BIRTH, false);
    expect(plan.creates).toEqual([
      { title: "Bachelor", start: year(2005), end: year(2008) },
      { title: "Master", start: year(2017), end: year(2019) },
    ]);
  });

  test("loading and planning without changes writes nothing", () => {
    const entries = [entry("a", "Bachelor", 2005, 2008), entry("b", "Master", 2017, 2019)];
    expect(isEmptyPlan(planSequenceEntries(load(entries, EDUCATION), entries, BIRTH, false))).toBe(true);
  });

  test("a date refined on the canvas survives when its year didn't change", () => {
    const refined = entry("a", "Bachelor", 2005, 2008, {
      start: { ms: Date.UTC(2005, 9, 1), precision: "month" },
      end: { ms: Date.UTC(2008, 6, 15), precision: "day" },
    });
    expect(isEmptyPlan(planSequenceEntries(load([refined], EDUCATION), [refined], BIRTH, false))).toBe(true);
  });

  test("moving a date updates that entry in place", () => {
    const entries = [entry("a", "Hamburg", 1986, 2006), entry("b", "Berlin", 2006)];
    const moved = setKnob(load(entries, PLACES), PLACES, AGE, { kind: "boundary", index: 1 }, 22);
    const plan = planSequenceEntries(moved, entries, BIRTH, false);
    expect(plan.creates).toEqual([]);
    expect(plan.deletes).toEqual([]);
    expect(plan.updates).toEqual([
      { id: "a", patch: { end: year(2008) } },
      { id: "b", patch: { start: year(2008) } },
    ]);
  });

  test("reordering swaps the periods two entries cover, nothing is created", () => {
    const entries = [entry("a", "Hamburg", 1986, 2006), entry("b", "Utrecht", 2006, 2017), entry("c", "Berlin", 2017)];
    const plan = planSequenceEntries(moveItem(load(entries, PLACES), 2, 1), entries, BIRTH, false);
    expect(plan.creates).toEqual([]);
    expect(plan.deletes).toEqual([]);
    expect(plan.updates).toEqual([
      { id: "c", patch: { start: year(2006), end: year(2017) } },
      { id: "b", patch: { start: year(2017), end: undefined } },
    ]);
  });

  test("a removed item deletes its entry", () => {
    const entries = [entry("a", "Hamburg", 1986, 2006), entry("b", "Berlin", 2006)];
    const sequence = load(entries, PLACES);
    const plan = planSequenceEntries({ ...sequence, items: sequence.items.slice(0, 1) }, entries, BIRTH, false);
    expect(plan.deletes).toEqual(["b"]);
    expect(plan.updates).toEqual([{ id: "a", patch: { end: undefined } }]);
  });

  test("a blank name saves the fallback", () => {
    let sequence: Sequence = { items: [], end: null };
    sequence = addItem(sequence, EDUCATION, AGE, { label: "", fallback: "Job", length: 3, start: 20 })!;
    expect(planSequenceEntries(sequence, [], BIRTH, false).creates[0].title).toBe("Job");
  });

  test("place details are kept while the name matches, dropped once it is edited", () => {
    let sequence: Sequence = { items: [], end: null };
    const details = { fullName: "Hamburg, Germany", city: "Hamburg", coordinates: { lat: 53.5, lon: 10 } };
    sequence = addItem(sequence, PLACES, AGE, {
      label: "Hamburg",
      fallback: "Hamburg",
      length: 2,
      place: { title: "Hamburg", subtitle: "Germany", details },
    })!;
    expect(planSequenceEntries(sequence, [], BIRTH, true).creates[0]).toMatchObject({ subtitle: "Germany", place: details });
    const renamed = renameItem(sequence, 0, "Altona");
    expect(planSequenceEntries(renamed, [], BIRTH, true).creates[0]).toMatchObject({
      title: "Altona",
      subtitle: undefined,
      place: { fullName: "Altona" },
    });
  });

  test("a loaded place without details is left alone", () => {
    const entries = [entry("a", "Hamburg", 1986)];
    expect(isEmptyPlan(planSequenceEntries(load(entries, PLACES, true), entries, BIRTH, true))).toBe(true);
  });
});
