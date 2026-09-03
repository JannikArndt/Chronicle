import { describe, expect, test } from "vitest";
import { emptyDataset, normalizeChildOrder } from "./dataset";
import { hiddenChildrenEverywhere, hiddenChildrenOf, hiddenIdsOf, isHidden } from "./hidden";
import type { TimelineDataset } from "./types";

// Root holds: row "r-top", group "g-work" (rows r-a, r-b) and group "g-family"
// holding sub-group "g-finn" with row "r-school".
function fixture(): TimelineDataset {
  const ds = emptyDataset();
  ds.groups = [
    { id: "g-work", label: "Work", collapsed: false },
    { id: "g-family", label: "Family", collapsed: false },
    { id: "g-finn", parentGroupId: "g-family", label: "Finn", collapsed: false },
  ];
  ds.rows = [
    { id: "r-top", label: "Top" },
    { id: "r-a", groupId: "g-work", label: "Job A" },
    { id: "r-b", groupId: "g-work", label: "Job B" },
    { id: "r-school", groupId: "g-finn", label: "School" },
  ];
  return normalizeChildOrder(ds);
}

describe("isHidden", () => {
  test("reads the set that matches the child's kind", () => {
    const hidden = hiddenIdsOf(["r-a"], ["g-work"]);
    expect(isHidden(hidden, { kind: "row", id: "r-a" })).toBe(true);
    expect(isHidden(hidden, { kind: "group", id: "g-work" })).toBe(true);
    // Same id, other kind — never a false positive across the two sets.
    expect(isHidden(hidden, { kind: "group", id: "r-a" })).toBe(false);
    expect(isHidden(hidden, { kind: "row", id: "g-work" })).toBe(false);
  });
});

describe("hiddenChildrenOf", () => {
  test("lists only the container's own hidden children, in render order", () => {
    const hidden = hiddenIdsOf(["r-top", "r-b"], []);
    expect(hiddenChildrenOf(fixture(), undefined, hidden).map((c) => c.id)).toEqual(["r-top"]);
    expect(hiddenChildrenOf(fixture(), "g-work", hidden).map((c) => c.id)).toEqual(["r-b"]);
  });

  test("a hidden sub-group is listed under its parent, as a group", () => {
    const children = hiddenChildrenOf(fixture(), "g-family", hiddenIdsOf([], ["g-finn"]));
    expect(children).toHaveLength(1);
    expect(children[0].kind).toBe("group");
    expect(children[0].id).toBe("g-finn");
  });

  test("is empty when nothing in that container is hidden", () => {
    expect(hiddenChildrenOf(fixture(), "g-work", hiddenIdsOf(["r-top"], []))).toEqual([]);
  });
});

describe("hiddenChildrenEverywhere", () => {
  test("collects hidden children at every depth", () => {
    const hidden = hiddenIdsOf(["r-top", "r-school"], ["g-work"]);
    expect(hiddenChildrenEverywhere(fixture(), hidden).map((c) => c.id)).toEqual([
      "r-top",
      "g-work",
      "r-school",
    ]);
  });

  test("does not offer back something inside an already-hidden group", () => {
    // r-b is hidden, but so is the group holding it: unhiding r-b alone would
    // change nothing on screen, so it is not offered.
    const hidden = hiddenIdsOf(["r-b"], ["g-work"]);
    expect(hiddenChildrenEverywhere(fixture(), hidden).map((c) => c.id)).toEqual(["g-work"]);
  });
});
