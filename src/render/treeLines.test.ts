import { describe, expect, test } from "vitest";
import { computeLayout, groupHeaderHeight, ROW_HEIGHT } from "./layout";
import { indentOf, treeLines } from "./treeLines";
import { emptyDataset, normalizeChildOrder } from "../model/dataset";
import type { TimelineDataset } from "../model/types";

// "Work" holds two timelines and a sub-group "Side" holding one more.
function fixture(): TimelineDataset {
  const ds = emptyDataset();
  ds.groups = [
    { id: "g-work", label: "Work", collapsed: false },
    { id: "g-side", parentGroupId: "g-work", label: "Side", collapsed: false },
  ];
  ds.rows = [
    { id: "r-a", groupId: "g-work", label: "Job A" },
    { id: "r-b", groupId: "g-work", label: "Job B" },
    { id: "r-c", groupId: "g-side", label: "Side project" },
  ];
  return normalizeChildOrder(ds);
}

const verticals = (lines: ReturnType<typeof treeLines>) => lines.filter((l) => l.x0 === l.x1);
const horizontals = (lines: ReturnType<typeof treeLines>) => lines.filter((l) => l.y0 === l.y1);

describe("treeLines", () => {
  test("one trunk per expanded group, one elbow per direct child", () => {
    const lines = treeLines(computeLayout(fixture(), new Set()).items);
    // Two expanded groups: "Work" (3 direct children: r-a, r-b, g-side) and
    // "Side" (1: r-c).
    expect(verticals(lines)).toHaveLength(2);
    expect(horizontals(lines)).toHaveLength(4);
  });

  test("a child's elbow meets its own indent at its own middle", () => {
    const { items } = computeLayout(fixture(), new Set());
    const lines = treeLines(items);
    const rowA = items.find((i) => i.id === "r-a")!;
    const elbow = horizontals(lines).find((l) => l.y0 === rowA.y + ROW_HEIGHT / 2)!;
    expect(elbow).toBeDefined();
    expect(elbow.x1).toBe(indentOf(rowA.depth));
    expect(elbow.x0).toBe(indentOf(rowA.depth - 1) + 7); // the parent's ▸/▾ centre
  });

  test("the trunk stops at the last child, not at the end of the subtree", () => {
    const { items } = computeLayout(fixture(), new Set());
    const work = items.find((i) => i.id === "g-work")!;
    const side = items.find((i) => i.id === "g-side")!;
    const trunk = verticals(treeLines(items)).find((l) => l.x0 === indentOf(0) + 7)!;
    expect(trunk.y0).toBe(work.y + work.height);
    // g-side is Work's last direct child; the trunk ends at its header's
    // middle, well above `work.subtreeEndY` (which sits past r-c).
    expect(trunk.y1).toBe(side.y + groupHeaderHeight(side.depth) / 2);
    expect(trunk.y1).toBeLessThan(work.subtreeEndY!);
  });

  test("a collapsed group gets no trunk — it has no children on screen", () => {
    const lines = treeLines(computeLayout(fixture(), new Set(["g-work"])).items);
    expect(lines).toEqual([]);
  });

  test("an empty group gets no trunk", () => {
    const ds = emptyDataset();
    ds.groups = [{ id: "g-empty", label: "Empty", collapsed: false }];
    expect(treeLines(computeLayout(normalizeChildOrder(ds), new Set()).items)).toEqual([]);
  });
});
