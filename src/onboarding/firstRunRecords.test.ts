import "fake-indexeddb/auto";
import { beforeEach, describe, expect, test } from "vitest";
import { commitBirth, commitFamily, commitTopic, findTopicRow, loadTopic, storedBirth } from "./firstRunRecords";
import { loadFamily, newKidYear } from "./familyRecords";
import { TOPICS } from "./lifeTopics";
import { addItem, moveItem, setKnob } from "./sequence";
import type { Sequence } from "./sequence";
import { completeIdentityStep, replaceDataset } from "../state/actions";
import { appStore } from "../state/store";
import { emptyDataset } from "../model/dataset";

const NOW = Date.UTC(2026, 9, 1);
const BIRTH = 1986;
const AGE = 40;
const year = (y: number) => Date.UTC(y, 0, 1);
const dataset = () => appStore.getState().dataset;

function loaded(topic: keyof typeof TOPICS): Sequence {
  const result = loadTopic(dataset(), TOPICS[topic], BIRTH, AGE);
  if (!result.ok) throw new Error(result.reason);
  return result.sequence;
}

function entriesOf(topic: keyof typeof TOPICS) {
  const row = findTopicRow(dataset(), TOPICS[topic]);
  return dataset()
    .entries.filter((entry) => entry.rowId === row?.id)
    .sort((a, b) => a.start.ms - b.start.ms);
}

function answerEverything(): void {
  completeIdentityStep("Sam");
  commitBirth({ year: BIRTH, month: 10 });

  let places: Sequence = { items: [], end: null };
  places = addItem(places, TOPICS.lived.rules, AGE, { label: "Hamburg", fallback: "Hamburg", length: 2 })!;
  places = addItem(places, TOPICS.lived.rules, AGE, { label: "Berlin", fallback: "Berlin", length: 2 })!;
  commitTopic(TOPICS.lived, places, BIRTH);

  const rules = TOPICS.learned.rules;
  let education: Sequence = { items: [], end: null };
  education = addItem(education, rules, AGE, { label: "Bachelor", fallback: "Bachelor", length: 3, start: 19 })!;
  education = addItem(education, rules, AGE, { label: "", fallback: "", length: 9, gap: true })!;
  education = addItem(education, rules, AGE, { label: "Master", fallback: "Master", length: 2 })!;
  commitTopic(TOPICS.learned, education, BIRTH);

  let work: Sequence = { items: [], end: null };
  work = addItem(work, TOPICS.worked.rules, AGE, { label: "", fallback: "Job", length: 3, start: 22 })!;
  work = { ...work, end: null };
  commitTopic(TOPICS.worked, work, BIRTH);

  const family = { kids: [{ key: "k1", name: "Mia", year: 2012 }], grandkids: [] as never[] };
  commitFamily(family);
  const reloaded = loadFamily(dataset());
  commitFamily({
    ...reloaded,
    grandkids: [{ key: "g1", parentKey: reloaded.kids[0].key, name: "Ella", year: 2026 }],
  });
}

beforeEach(() => replaceDataset(emptyDataset()));

describe("first-run commits", () => {
  test("store the birth date with its month", () => {
    answerEverything();
    const self = dataset().groups.find((g) => g.id === dataset().selfGroupId)!;
    expect(self.birthDate).toBe(Date.UTC(1986, 10, 1));
    expect(storedBirth(dataset(), NOW).answer).toEqual({ year: 1986, month: 10 });
  });

  test("an untouched birth answer is never stored", () => {
    completeIdentityStep("Sam");
    const { answer, stored } = storedBirth(dataset(), NOW);
    expect(stored).toBeUndefined();
    expect(answer.year).toBe(1996);
    expect(dataset().groups[0].birthDate).toBeUndefined();
  });

  test("write one entry per item at year precision, gaps write nothing, the last place is ongoing", () => {
    answerEverything();
    expect(entriesOf("lived").map((e) => [e.title, e.start.ms, e.end?.ms])).toEqual([
      ["Hamburg", year(1986), year(2006)],
      ["Berlin", year(2006), undefined],
    ]);
    expect(entriesOf("lived")[0].start.precision).toBe("year");
    expect(entriesOf("learned").map((e) => [e.title, e.start.ms, e.end?.ms])).toEqual([
      ["Bachelor", year(2005), year(2008)],
      ["Master", year(2017), year(2019)],
    ]);
    expect(entriesOf("worked").map((e) => [e.title, e.end])).toEqual([["Job", undefined]]);
  });

  test("create Education and Work rows in the self group, with their colours, and nothing for an empty topic", () => {
    answerEverything();
    const education = findTopicRow(dataset(), TOPICS.learned)!;
    expect(education.groupId).toBe(dataset().selfGroupId);
    expect(education.color).toBe(TOPICS.learned.color);
    expect(education.icon).toBe("🎓");
    expect(findTopicRow(dataset(), TOPICS.partner)).toBeUndefined();
  });

  test("put each child in Family and the grandchild inside its parent", () => {
    answerEverything();
    const family = dataset().groups.find((g) => g.label === "Family" && g.parentGroupId === undefined)!;
    const mia = dataset().groups.find((g) => g.parentGroupId === family.id)!;
    expect(mia.label).toBe("Mia");
    expect(mia.birthDate).toBe(year(2012));
    const ella = dataset().groups.find((g) => g.parentGroupId === mia.id && g.label === "Ella")!;
    expect(ella.birthDate).toBe(year(2026));
  });

  test("replaying every screen without changes duplicates nothing", () => {
    answerEverything();
    const before = JSON.stringify(dataset());
    commitBirth(storedBirth(dataset(), NOW).answer);
    (["lived", "learned", "worked", "partner"] as const).forEach((topic) => commitTopic(TOPICS[topic], loaded(topic), BIRTH));
    commitFamily(loadFamily(dataset()));
    expect(JSON.stringify(dataset())).toBe(before);
  });

  test("going back and moving a date updates the entries in place", () => {
    answerEverything();
    const ids = entriesOf("lived").map((e) => e.id);
    const moved = setKnob(loaded("lived"), TOPICS.lived.rules, AGE, { kind: "boundary", index: 1 }, 25);
    commitTopic(TOPICS.lived, moved, BIRTH);
    expect(entriesOf("lived").map((e) => e.id)).toEqual(ids);
    expect(entriesOf("lived").map((e) => e.start.ms)).toEqual([year(1986), year(2011)]);
  });

  test("reordering keeps every record and swaps the periods", () => {
    answerEverything();
    commitTopic(TOPICS.lived, moveItem(loaded("lived"), 1, 0), BIRTH);
    expect(entriesOf("lived").map((e) => e.title)).toEqual(["Berlin", "Hamburg"]);
    expect(entriesOf("lived")).toHaveLength(2);
  });

  test("a second child goes into the same Family group", () => {
    answerEverything();
    const draft = loadFamily(dataset());
    commitFamily({ ...draft, kids: [...draft.kids, { key: "k2", name: "", year: newKidYear(draft, BIRTH, 2026) }] });
    const families = dataset().groups.filter((g) => g.label === "Family" && g.parentGroupId === undefined);
    expect(families).toHaveLength(1);
    expect(dataset().groups.filter((g) => g.parentGroupId === families[0].id).map((g) => g.label)).toEqual([
      "Mia",
      "Child 2",
    ]);
  });

  test("removing the only child removes the Family group it made", () => {
    answerEverything();
    commitFamily({ kids: [], grandkids: [] });
    expect(dataset().groups.some((g) => g.label === "Family")).toBe(false);
    expect(dataset().groups.some((g) => g.label === "Ella")).toBe(false);
  });
});
