import { describe, expect, test } from "vitest";
import { GROUP_GAP, GROUP_HEADER_HEIGHT, ROW_GAP, ROW_HEIGHT, computeLayout, groupHeaderHeight } from "./layout";
import { emptyDataset } from "../model/dataset";
import type { TimelineDataset } from "../model/types";

// "Me" is a person (birth date) holding row r1. "r-top" is a timeline with no
// group at all. "Family" holds no rows of its own but nests "Finn" two levels
// deep — "Finn" holds r2 directly and nests "Finn's kid" a third level down,
// holding r3 — exercising nesting beyond the old one-level cap.
function fixture(): TimelineDataset {
  const ds = emptyDataset();
  ds.groups = [
    { id: "g-me", label: "Me", birthDate: Date.UTC(1988, 0, 1), collapsed: false },
    { id: "g-family", label: "Family", collapsed: false },
    { id: "g-finn", parentGroupId: "g-family", label: "Finn", collapsed: false },
    { id: "g-finn-kid", parentGroupId: "g-finn", label: "Finn's kid", collapsed: false },
  ];
  ds.rows = [
    { id: "r-top", label: "Top-level timeline", color: "#333" },
    { id: "r1", groupId: "g-me", color: "#333", label: "Job" },
    { id: "r2", groupId: "g-finn", color: "#333", label: "School" },
    { id: "r3", groupId: "g-finn-kid", color: "#333", label: "Nursery" },
  ];
  return ds;
}

describe("computeLayout", () => {
  test("depth-first: a group's own rows before its sub-groups, at every depth", () => {
    const { items } = computeLayout(fixture(), new Set());
    expect(items.map((i) => `${i.kind}:${i.id}`)).toEqual([
      "row:r-top",
      "group:g-me",
      "row:r1",
      "group:g-family",
      "group:g-finn",
      "row:r2",
      "group:g-finn-kid",
      "row:r3",
    ]);
  });

  test("depth tracks nesting all the way down, not just one level", () => {
    const { items } = computeLayout(fixture(), new Set());
    const depthOf = (id: string) => items.find((i) => i.id === id)!.depth;
    expect(depthOf("r-top")).toBe(0);
    expect(depthOf("g-me")).toBe(0);
    expect(depthOf("r1")).toBe(1);
    expect(depthOf("g-family")).toBe(0);
    expect(depthOf("g-finn")).toBe(1);
    expect(depthOf("r2")).toBe(2);
    expect(depthOf("g-finn-kid")).toBe(2);
    expect(depthOf("r3")).toBe(3);
  });

  test("a group header shrinks with depth, down to a floor", () => {
    const { items } = computeLayout(fixture(), new Set());
    const heightOf = (id: string) => items.find((i) => i.id === id)!.height;
    expect(heightOf("g-me")).toBe(GROUP_HEADER_HEIGHT);
    expect(heightOf("g-finn")).toBe(groupHeaderHeight(1));
    expect(heightOf("g-finn-kid")).toBe(groupHeaderHeight(2));
    expect(groupHeaderHeight(1)).toBeLessThan(GROUP_HEADER_HEIGHT);
    expect(groupHeaderHeight(50)).toBeGreaterThan(0);
  });

  test("only a top-level group gets the extra breathing room after it", () => {
    const { items } = computeLayout(fixture(), new Set());
    const r1 = items.find((i) => i.id === "r1")!;
    const gFamily = items.find((i) => i.id === "g-family")!;
    // g-me has no nested groups, so its content is just r1 — the gap after the
    // whole top-level group's content lands right after r1.
    expect(gFamily.y - (r1.y + r1.height)).toBe(GROUP_GAP);
  });

  test("collapsing a group hides its whole subtree from the rail/list", () => {
    const { items } = computeLayout(fixture(), new Set(["g-family"]));
    expect(items.some((i) => i.id === "g-finn")).toBe(false);
    expect(items.some((i) => i.id === "r2")).toBe(false);
    expect(items.some((i) => i.id === "g-finn-kid")).toBe(false);
    expect(items.some((i) => i.id === "r3")).toBe(false);
  });

  test("collapsing a group with dated entries anywhere in its subtree emits one summary bar", () => {
    const ds = fixture();
    ds.entries = [
      { id: "e1", rowId: "r2", title: "e1", start: { ms: Date.UTC(2010, 0, 1), precision: "year" }, end: { ms: Date.UTC(2015, 0, 1), precision: "year" } },
    ];
    ds.events = [{ id: "v1", rowId: "r3", title: "v1", date: { ms: Date.UTC(2020, 0, 1), precision: "year" } }];
    const { items } = computeLayout(ds, new Set(["g-family"]));
    const summary = items.find((i) => i.kind === "group-summary" && i.id === "g-family");
    expect(summary).toBeDefined();
    // The bar spans the earliest entry start to the latest event date, across
    // both "Finn"'s own row and the grandchild "Finn's kid"'s row.
    expect(summary!.summary).toEqual({ startMs: Date.UTC(2010, 0, 1), endMs: Date.UTC(2020, 0, 1) });
  });

  test("collapsing a group with nothing dated in its subtree emits no summary bar", () => {
    const { items } = computeLayout(fixture(), new Set(["g-family"]));
    expect(items.some((i) => i.kind === "group-summary")).toBe(false);
  });

  test("hidden rows stay in the layout, flagged hidden", () => {
    const { items } = computeLayout(fixture(), new Set(), new Set(["r1"]));
    const r1 = items.find((i) => i.id === "r1");
    expect(r1).toBeDefined();
    expect(r1!.hidden).toBe(true);
    expect(items.find((i) => i.id === "r-top")!.hidden).toBe(false);
  });

  test("a top-level row needs no group at all", () => {
    const { items } = computeLayout(fixture(), new Set());
    const rTop = items.find((i) => i.id === "r-top")!;
    expect(rTop.depth).toBe(0);
    expect(rTop.y).toBe(ROW_GAP);
    expect(rTop.height).toBe(ROW_HEIGHT);
  });

  test("totalHeight covers the last item", () => {
    const { items, totalHeight } = computeLayout(fixture(), new Set());
    const last = items[items.length - 1];
    expect(totalHeight).toBeGreaterThanOrEqual(last.y + last.height);
  });
});
