import { describe, expect, test } from "vitest";
import { pickInSummary } from "./summaryPick";
import { computeLayout, rowCenterY, ROW_HEIGHT } from "./layout";
import { emptyDataset } from "../model/dataset";
import { hiddenIdsOf } from "../model/hidden";
import type { TimelineDataset, TimelineEntry } from "../model/types";

const year = (y: number) => Date.UTC(y, 0, 1);
const NOW = year(2030);

function entry(id: string, rowId: string, start: number, end?: number): TimelineEntry {
  return {
    id,
    rowId,
    title: id,
    start: { ms: start, precision: "exact" },
    ...(end === undefined ? {} : { end: { ms: end, precision: "exact" } }),
  };
}

// "Jobs" was broken out of one timeline: one child timeline per entry.
// "Schools" is a child sub-group holding two rows, one of them hidden.
function fixture(): TimelineDataset {
  const ds = emptyDataset();
  ds.groups = [
    { id: "g-work", label: "Work", collapsed: false },
    { id: "g-school", parentGroupId: "g-work", label: "Schools", collapsed: false },
  ];
  ds.rows = [
    { id: "r-a", groupId: "g-work", label: "Job A" },
    { id: "r-b", groupId: "g-work", label: "Job B" },
    { id: "r-s1", groupId: "g-school", label: "Primary" },
    { id: "r-s2", groupId: "g-school", label: "Secret" },
  ];
  ds.entries = [
    entry("e-a", "r-a", year(2010), year(2014)),
    entry("e-b", "r-b", year(2015)), // ongoing
    entry("e-s1", "r-s1", year(1996), year(2000)),
    entry("e-s1-short", "r-s1", year(1997), year(1998)),
    entry("e-s1-late", "r-s1", year(2004), year(2006)),
    entry("e-s2", "r-s2", year(1999), year(2003)),
  ];
  ds.events = [{ id: "v-s1", rowId: "r-s1", title: "Prize", date: { ms: year(2002), precision: "year" } }];
  return ds;
}

function barsOf(ds: TimelineDataset) {
  const { items } = computeLayout(ds, new Set(["g-work"]), hiddenIdsOf(["r-s2"], []));
  return items.find((item) => item.id === "g-work")!.summaries!;
}

describe("a tap on a collapsed group's summary bar", () => {
  test("a broken-out child's bar is its one entry", () => {
    const ds = fixture();
    const jobA = barsOf(ds).find((bar) => bar.id === "r-a")!;
    expect(pickInSummary(jobA, ds, year(2012), NOW)).toEqual({ kind: "entry", id: "e-a" });
  });

  test("an ongoing entry can be hit all the way to today", () => {
    const ds = fixture();
    const jobB = barsOf(ds).find((bar) => bar.id === "r-b")!;
    expect(pickInSummary(jobB, ds, year(2029), NOW)).toEqual({ kind: "entry", id: "e-b" });
  });

  test("inside overlapping entries, the narrowest one wins", () => {
    const ds = fixture();
    const schools = barsOf(ds).find((bar) => bar.id === "g-school")!;
    expect(pickInSummary(schools, ds, Date.UTC(1997, 6, 1), NOW)).toEqual({ kind: "entry", id: "e-s1-short" });
    expect(pickInSummary(schools, ds, Date.UTC(1999, 6, 1), NOW)).toEqual({ kind: "entry", id: "e-s1" });
  });

  test("in a gap, the nearest entry or event is picked", () => {
    const ds = fixture();
    const schools = barsOf(ds).find((bar) => bar.id === "g-school")!;
    expect(pickInSummary(schools, ds, Date.UTC(2003, 9, 1), NOW)).toEqual({ kind: "entry", id: "e-s1-late" });
    expect(pickInSummary(schools, ds, Date.UTC(2002, 1, 1), NOW)).toEqual({ kind: "event", id: "v-s1" });
  });

  test("a hidden row's entries are never picked, even right under the finger", () => {
    const ds = fixture();
    const schools = barsOf(ds).find((bar) => bar.id === "g-school")!;
    expect(schools.rowIds).toEqual(["r-s1"]);
    // e-s2 (hidden row r-s2) spans 1999–2003; the tap resolves to the
    // nearest visible record instead.
    expect(pickInSummary(schools, ds, Date.UTC(2000, 2, 1), NOW)).toEqual({ kind: "entry", id: "e-s1" });
  });

  test("a bar with nothing in its rows picks nothing", () => {
    expect(pickInSummary({ rowIds: ["r-none"] }, fixture(), year(2000), NOW)).toBeUndefined();
  });
});

describe("rowCenterY", () => {
  test("a visible row is centred on its own item", () => {
    const ds = fixture();
    const layout = computeLayout(ds, new Set());
    const item = layout.items.find((candidate) => candidate.id === "r-a")!;
    expect(rowCenterY(layout, "r-a")).toBe(item.y + item.height / 2);
  });

  test("a row under a collapsed group is centred on its summary bar's lane", () => {
    const ds = fixture();
    const layout = computeLayout(ds, new Set(["g-work"]));
    const group = layout.items.find((item) => item.id === "g-work")!;
    const lane = group.summaries!.find((bar) => bar.rowIds.includes("r-s1"))!.lane;
    expect(rowCenterY(layout, "r-s1")).toBe(group.y + lane * ROW_HEIGHT + ROW_HEIGHT / 2);
  });

  test("a hidden row has no position", () => {
    const layout = computeLayout(fixture(), new Set(["g-work"]), hiddenIdsOf(["r-s2"], []));
    expect(rowCenterY(layout, "r-s2")).toBeUndefined();
  });
});
