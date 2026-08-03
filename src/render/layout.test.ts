import { describe, expect, test } from "vitest";
import { COMPACT_ROW_HEIGHT, GROUP_HEADER_HEIGHT, ROW_GAP, ROW_HEIGHT, SUB_ROW_GAP, computeLayout } from "./layout";
import { emptyDataset } from "../model/dataset";
import type { TimelineDataset } from "../model/types";

// "Me" is a person (it has a birth date) holding rows r1 (r1 has sub-row r1s).
// "Family" is a plain group containing the sub-group Finn with row r2.
function fixture(): TimelineDataset {
  const ds = emptyDataset();
  ds.groups = [
    { id: "g-me", label: "Me", birthDate: Date.UTC(1988, 0, 1), collapsed: false },
    { id: "g-family", label: "Family", collapsed: false },
    { id: "g-finn", parentGroupId: "g-family", label: "Finn", collapsed: false },
  ];
  ds.rows = [
    { id: "r1", groupId: "g-me", color: "#333", label: "Job" },
    { id: "r1s", groupId: "g-me", color: "#333", label: "Projects", parentRowId: "r1" },
    { id: "r2", groupId: "g-finn", color: "#333", label: "School" },
  ];
  return ds;
}

describe("computeLayout", () => {
  test("orders group header, rows, sub-rows, then next group with sub-group header", () => {
    const { items } = computeLayout(fixture(), new Set());
    expect(items.map((i) => `${i.kind}:${i.id}`)).toEqual([
      "group:g-me",
      "row:r1",
      "row:r1s",
      "group:g-family",
      "subgroup:g-finn",
      "row:r2",
    ]);
  });

  test("a sub-group is drawn once, under its parent — never again at top level", () => {
    const { items } = computeLayout(fixture(), new Set());
    const subGroupItems = items.filter((i) => i.kind === "subgroup");
    expect(subGroupItems).toHaveLength(1);
    expect(subGroupItems[0].id).toBe("g-finn");
    expect(subGroupItems[0].parentGroup?.id).toBe("g-family");
  });

  test("collapsing a sub-group hides only its own rows", () => {
    const { items } = computeLayout(fixture(), new Set(["g-finn"]));
    expect(items.map((i) => `${i.kind}:${i.id}`)).toEqual([
      "group:g-me",
      "row:r1",
      "row:r1s",
      "group:g-family",
      "subgroup:g-finn",
    ]);
  });

  test("sub-rows sit closer to their parent than the normal row gap", () => {
    const { items } = computeLayout(fixture(), new Set());
    const r1 = items.find((i) => i.id === "r1")!;
    const r1s = items.find((i) => i.id === "r1s")!;
    expect(r1s.y - (r1.y + r1.height)).toBe(SUB_ROW_GAP);
    expect(SUB_ROW_GAP).toBeLessThan(ROW_GAP);
    expect(r1s.isSubRow).toBe(true);
  });

  test("collapsed groups contribute only their header", () => {
    const { items } = computeLayout(fixture(), new Set(["g-me"]));
    expect(items.filter((i) => i.kind === "row" && i.row?.groupId === "g-me")).toHaveLength(0);
    expect(items[0].height).toBe(GROUP_HEADER_HEIGHT);
    expect(items[1].id).toBe("g-family");
  });

  test("hidden rows stay in the layout, flagged hidden", () => {
    const { items } = computeLayout(fixture(), new Set(), new Set(["r1s"]));
    const r1s = items.find((i) => i.id === "r1s");
    expect(r1s).toBeDefined();
    expect(r1s!.hidden).toBe(true);
    expect(items.find((i) => i.id === "r1")!.hidden).toBe(false);
  });

  test("collapsing a parent row keeps its sub-rows but renders them compact", () => {
    const { items } = computeLayout(fixture(), new Set(), new Set(), new Set(["r1"]));
    const r1 = items.find((i) => i.id === "r1")!;
    const r1s = items.find((i) => i.id === "r1s")!;
    // The parent stays full height (it's the header); the child is compacted.
    expect(r1.compact).toBe(false);
    expect(r1.height).toBe(ROW_HEIGHT);
    expect(r1s.compact).toBe(true);
    expect(r1s.height).toBe(COMPACT_ROW_HEIGHT);
    expect(COMPACT_ROW_HEIGHT).toBeLessThan(ROW_HEIGHT);
  });

  test("an un-collapsed parent leaves sub-rows full height and non-compact", () => {
    const { items } = computeLayout(fixture(), new Set());
    expect(items.find((i) => i.id === "r1s")!.compact).toBe(false);
  });

  test("totalHeight covers the last item", () => {
    const { items, totalHeight } = computeLayout(fixture(), new Set());
    const last = items[items.length - 1];
    expect(totalHeight).toBeGreaterThanOrEqual(last.y + last.height);
  });
});
