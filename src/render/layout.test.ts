import { describe, expect, test } from "vitest";
import {
  GROUP_HEADER_HEIGHT,
  ROW_GAP,
  ROW_HEIGHT,
  computeLayout,
  groupHeaderHeight,
} from "./layout";
import { emptyDataset } from "../model/dataset";
import type { TimelineDataset } from "../model/types";
import { hiddenIdsOf } from "../model/hidden";

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

  test("without any `order`, a container still draws its rows before its sub-groups", () => {
    // The pre-v10 arrangement, and what an older export or a public dataset
    // (whose records carry no order at all) still gets.
    const { items } = computeLayout(fixture(), new Set());
    expect(items.filter((i) => i.depth === 0).map((i) => i.id)).toEqual(["r-top", "g-me", "g-family"]);
  });

  test("`order` interleaves groups and rows freely — a group can sit above a timeline", () => {
    const ds = fixture();
    ds.groups.find((g) => g.id === "g-me")!.order = 0;
    ds.groups.find((g) => g.id === "g-family")!.order = 1;
    ds.rows.find((r) => r.id === "r-top")!.order = 2;
    const { items } = computeLayout(ds, new Set());
    expect(items.map((i) => `${i.kind}:${i.id}`)).toEqual([
      "group:g-me",
      "row:r1",
      "group:g-family",
      "group:g-finn",
      "row:r2",
      "group:g-finn-kid",
      "row:r3",
      "row:r-top",
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

  // The rhythm the row striping rests on: consecutive bands meet halfway down
  // a gap, so any gap that differs from the others leaves the item beside it
  // off-centre in its own stripe. Kind, depth and collapse state must not
  // enter into it.
  test("every consecutive pair of items is separated by exactly ROW_GAP", () => {
    const check = (layout: ReturnType<typeof computeLayout>) => {
      for (let i = 1; i < layout.items.length; i++) {
        const previous = layout.items[i - 1];
        const item = layout.items[i];
        // A group header is followed by its own first child, so "the previous
        // item's bottom" is the header's own bottom, not its subtree's.
        expect(item.y - (previous.y + previous.height)).toBe(ROW_GAP);
      }
    };
    check(computeLayout(fixture(), new Set()));
    check(computeLayout(fixture(), new Set(["g-finn"])));
  });

  test("the layout is padded by half a gap at the top and bottom", () => {
    const layout = computeLayout(fixture(), new Set());
    const first = layout.items[0];
    const last = layout.items[layout.items.length - 1];
    expect(first.y).toBe(ROW_GAP / 2);
    expect(layout.totalHeight).toBe(last.y + last.height + ROW_GAP / 2);
  });

  test("a group's subtreeEndY spans its header and everything nested under it", () => {
    const { items } = computeLayout(fixture(), new Set());
    const gFamily = items.find((i) => i.id === "g-family")!;
    const r3 = items.find((i) => i.id === "r3")!;
    // "Family" holds no rows directly — its whole visible extent is "Finn"
    // and "Finn's kid" nested underneath, bottoming out at r3.
    expect(gFamily.subtreeEndY).toBe(r3.y + r3.height);
  });

  test("collapsing a group hides its whole subtree from the rail/list", () => {
    const { items } = computeLayout(fixture(), new Set(["g-family"]));
    expect(items.some((i) => i.id === "g-finn")).toBe(false);
    expect(items.some((i) => i.id === "r2")).toBe(false);
    expect(items.some((i) => i.id === "g-finn-kid")).toBe(false);
    expect(items.some((i) => i.id === "r3")).toBe(false);
  });

  test("a sub-group child's bar aggregates its whole subtree recursively", () => {
    const ds = fixture();
    ds.entries = [
      {
        id: "e1",
        rowId: "r2",
        title: "e1",
        start: { ms: Date.UTC(2010, 0, 1), precision: "year" },
        end: { ms: Date.UTC(2015, 0, 1), precision: "year" },
      },
    ];
    ds.events = [{ id: "v1", rowId: "r3", title: "v1", date: { ms: Date.UTC(2020, 0, 1), precision: "year" } }];
    const { items } = computeLayout(ds, new Set(["g-family"]));
    const item = items.find((i) => i.kind === "group" && i.id === "g-family");
    expect(item).toBeDefined();
    // "Family" holds no rows of its own — its only direct child is the
    // sub-group "Finn", so the collapsed summary is exactly one bar labelled
    // "Finn", spanning the earliest start to the latest end across BOTH
    // Finn's own row (r2) and the grandchild "Finn's kid"'s row (r3).
    expect(item!.summaries).toEqual([
      {
        kind: "group",
        id: "g-finn",
        label: "Finn",
        color: undefined,
        startMs: Date.UTC(2010, 0, 1),
        endMs: Date.UTC(2020, 0, 1),
        ongoing: false,
        lane: 0,
      },
    ]);
  });

  test("collapsing a group with nothing dated in its subtree draws no bars", () => {
    const { items } = computeLayout(fixture(), new Set(["g-family"]));
    const item = items.find((i) => i.kind === "group" && i.id === "g-family")!;
    expect(item.summaries).toEqual([]);
    // Still one row tall: a collapsed group stands in for a timeline, and an
    // empty timeline is a row with nothing on it, not a missing row.
    expect(item.height).toBe(ROW_HEIGHT);
  });

  describe("a collapsed group is presented as a timeline", () => {
    // "Me" holds one row; collapsing it should leave something the same shape
    // as that row, not a section header with a band and a summary lane.
    function collapsedFixture(): TimelineDataset {
      const ds = fixture();
      ds.entries = [
        {
          id: "e1",
          rowId: "r1",
          title: "e1",
          start: { ms: Date.UTC(2010, 0, 1), precision: "exact" },
          end: { ms: Date.UTC(2012, 0, 1), precision: "exact" },
        },
      ];
      return ds;
    }

    test("it is one row tall, not a header plus a lane", () => {
      const { items } = computeLayout(collapsedFixture(), new Set(["g-me"]));
      const gMe = items.find((i) => i.id === "g-me")!;
      expect(gMe.height).toBe(ROW_HEIGHT);
      expect(gMe.height).toBe(items.find((i) => i.id === "r-top")!.height);
      // One item, carrying its own bars — there is no second item to find.
      expect(items.filter((i) => i.id === "g-me")).toHaveLength(1);
      expect(gMe.summaries).toHaveLength(1);
    });

    test("it has no subtreeEndY, which is what stops both renderers banding it", () => {
      const { items } = computeLayout(collapsedFixture(), new Set(["g-me"]));
      expect(items.find((i) => i.id === "g-me")!.subtreeEndY).toBeUndefined();
      // Expanded, the same group still gets its band.
      const expanded = computeLayout(collapsedFixture(), new Set());
      expect(expanded.items.find((i) => i.id === "g-me")!.subtreeEndY).toBeDefined();
    });

    test("collapsing does not move it: the gap above is the same in both states", () => {
      const collapsed = computeLayout(collapsedFixture(), new Set(["g-me"]));
      const expanded = computeLayout(collapsedFixture(), new Set());
      const gapAbove = (layout: ReturnType<typeof computeLayout>) => {
        const rTop = layout.items.find((i) => i.id === "r-top")!;
        const gMe = layout.items.find((i) => i.id === "g-me")!;
        return gMe.y - (rTop.y + rTop.height);
      };
      expect(gapAbove(collapsed)).toBe(ROW_GAP);
      expect(gapAbove(expanded)).toBe(ROW_GAP);
      // And the group's own top is unchanged by the toggle — the whole point.
      expect(collapsed.items.find((i) => i.id === "g-me")!.y).toBe(
        expanded.items.find((i) => i.id === "g-me")!.y,
      );
    });
  });

  describe("collapsed-group bars (one per direct child)", () => {
    // A group "Work" holding sibling timelines "Job A"/"Job B" directly — the
    // simplest case the feature exists for: each direct child row gets its
    // own bar, not one flattened band.
    function siblingRowsFixture(): TimelineDataset {
      const ds = emptyDataset();
      ds.groups = [{ id: "g-work", label: "Work", collapsed: false }];
      ds.rows = [
        { id: "r-a", groupId: "g-work", label: "Job A", color: "#111111" },
        { id: "r-b", groupId: "g-work", label: "Job B", color: "#222222" },
      ];
      ds.entries = [
        {
          id: "e-a",
          rowId: "r-a",
          title: "e-a",
          start: { ms: Date.UTC(2010, 0, 1), precision: "exact" },
          end: { ms: Date.UTC(2012, 0, 1), precision: "exact" },
        },
        {
          id: "e-b",
          rowId: "r-b",
          title: "e-b",
          start: { ms: Date.UTC(2015, 0, 1), precision: "exact" },
          end: { ms: Date.UTC(2016, 0, 1), precision: "exact" },
        },
      ];
      return ds;
    }

    test("one bar per direct child row, with that row's own label, colour and span", () => {
      const { items } = computeLayout(siblingRowsFixture(), new Set(["g-work"]));
      const item = items.find((i) => i.kind === "group" && i.id === "g-work")!;
      expect(item.summaries).toEqual([
        {
          kind: "row",
          id: "r-a",
          label: "Job A",
          color: "#111111",
          startMs: Date.UTC(2010, 0, 1),
          endMs: Date.UTC(2012, 0, 1),
          ongoing: false,
          lane: 0,
        },
        {
          kind: "row",
          id: "r-b",
          label: "Job B",
          color: "#222222",
          startMs: Date.UTC(2015, 0, 1),
          endMs: Date.UTC(2016, 0, 1),
          ongoing: false,
          lane: 0,
        },
      ]);
    });

    test("a hidden row is excluded from its own bar, and from an ancestor's aggregate", () => {
      const ds = siblingRowsFixture();
      const { items } = computeLayout(ds, new Set(["g-work"]), hiddenIdsOf(["r-b"], []));
      const item = items.find((i) => i.kind === "group" && i.id === "g-work")!;
      // r-b is hidden — it must not reappear as a summary bar even though it
      // has a dated entry.
      expect(item.summaries).toEqual([
        expect.objectContaining({ id: "r-a" }),
      ]);

      // And when hiding a row leaves a whole sub-group child with nothing
      // left dated, that child simply gets no bar of its own — the emptiness
      // propagates up rather than showing a hollow bar.
      const ds2 = emptyDataset();
      ds2.groups = [
        { id: "g-outer", label: "Outer", collapsed: false },
        { id: "g-inner", parentGroupId: "g-outer", label: "Inner", collapsed: false },
      ];
      ds2.rows = [{ id: "r-only", groupId: "g-inner", label: "Only", color: "#333" }];
      ds2.entries = [
        {
          id: "e-only",
          rowId: "r-only",
          title: "e-only",
          start: { ms: Date.UTC(2010, 0, 1), precision: "exact" },
        },
      ];
      const { items: items2 } = computeLayout(ds2, new Set(["g-outer"]), hiddenIdsOf(["r-only"], []));
      expect(items2.find((i) => i.kind === "group" && i.id === "g-outer")!.summaries).toEqual([]);
    });

    test("a group whose direct children are all empty draws no bars", () => {
      const ds = emptyDataset();
      ds.groups = [{ id: "g-empty", label: "Empty", collapsed: false }];
      ds.rows = [
        { id: "r-x", groupId: "g-empty", label: "Undated X", color: "#111" },
        { id: "r-y", groupId: "g-empty", label: "Undated Y", color: "#222" },
      ];
      // No entries or events at all — both direct children have nothing dated.
      const { items } = computeLayout(ds, new Set(["g-empty"]));
      expect(items.find((i) => i.kind === "group" && i.id === "g-empty")!.summaries).toEqual([]);
    });

    test("ongoing propagates: a child with any open-ended entry reports ongoing, and endMs falls back to that entry's own start", () => {
      const ds = emptyDataset();
      ds.groups = [
        { id: "g-outer", label: "Outer", collapsed: false },
        { id: "g-og", parentGroupId: "g-outer", label: "Ongoing group", collapsed: false },
      ];
      ds.rows = [
        { id: "r-og1", groupId: "g-og", label: "Finished", color: "#333" },
        { id: "r-og2", groupId: "g-og", label: "Still going", color: "#444" },
      ];
      ds.entries = [
        {
          id: "e-og1",
          rowId: "r-og1",
          title: "e-og1",
          start: { ms: Date.UTC(2005, 0, 1), precision: "exact" },
          end: { ms: Date.UTC(2010, 0, 1), precision: "exact" },
        },
        // No `end` — ongoing. Its own start (2015) is later than the other
        // entry's end (2010), so it also determines the aggregate's endMs.
        { id: "e-og2", rowId: "r-og2", title: "e-og2", start: { ms: Date.UTC(2015, 0, 1), precision: "exact" } },
      ];
      const { items } = computeLayout(ds, new Set(["g-outer"]));
      const item = items.find((i) => i.kind === "group" && i.id === "g-outer")!;
      expect(item.summaries).toEqual([
        {
          kind: "group",
          id: "g-og",
          label: "Ongoing group",
          color: undefined,
          startMs: Date.UTC(2005, 0, 1),
          endMs: Date.UTC(2015, 0, 1),
          ongoing: true,
          lane: 0,
        },
      ]);
    });

    test("nested collapsed groups: a collapsed sub-group emits its own summary while its open ancestor still shows its header", () => {
      const ds = fixture();
      ds.entries = [
        {
          id: "e1",
          rowId: "r2",
          title: "e1",
          start: { ms: Date.UTC(2010, 0, 1), precision: "year" },
          end: { ms: Date.UTC(2015, 0, 1), precision: "year" },
        },
      ];
      ds.events = [{ id: "v1", rowId: "r3", title: "v1", date: { ms: Date.UTC(2020, 0, 1), precision: "year" } }];
      // Only "Finn" is collapsed, not "Family" — "Family" and Finn's own
      // group header stay in the layout, and Finn's summary bars sit right
      // under Finn's header, one for Finn's own row (r2) and one for the
      // "Finn's kid" sub-group (aggregating r3).
      const { items } = computeLayout(ds, new Set(["g-finn"]));
      expect(items.some((i) => i.id === "g-family" && i.kind === "group")).toBe(true);
      expect(items.some((i) => i.id === "g-finn" && i.kind === "group")).toBe(true);
      const item = items.find((i) => i.kind === "group" && i.id === "g-finn")!;
      expect(item).toBeDefined();
      expect(item.summaries).toEqual([
        {
          kind: "row",
          id: "r2",
          label: "School",
          color: "#333",
          startMs: Date.UTC(2010, 0, 1),
          endMs: Date.UTC(2015, 0, 1),
          ongoing: false,
          lane: 0,
        },
        {
          kind: "group",
          id: "g-finn-kid",
          label: "Finn's kid",
          color: undefined,
          startMs: Date.UTC(2020, 0, 1),
          endMs: Date.UTC(2020, 0, 1),
          ongoing: false,
          lane: 0,
        },
      ]);

      // Collapsing BOTH levels instead: Finn is now unreachable (nested
      // inside a collapsed ancestor), so only "Family"'s own item exists —
      // its subtree is not walked at all while it is collapsed.
      const { items: bothCollapsed } = computeLayout(ds, new Set(["g-family", "g-finn"]));
      expect(bothCollapsed.some((i) => i.kind === "group" && i.id === "g-finn")).toBe(false);
      expect(bothCollapsed.some((i) => i.kind === "group" && i.id === "g-family")).toBe(true);
    });

    test("overlapping children land in separate lanes; back-to-back children share one", () => {
      const ds = emptyDataset();
      ds.groups = [{ id: "g-lanes", label: "Lanes", collapsed: false }];
      ds.rows = [
        { id: "r-x", groupId: "g-lanes", label: "X", color: "#111" },
        { id: "r-y", groupId: "g-lanes", label: "Y", color: "#222" },
        { id: "r-z", groupId: "g-lanes", label: "Z", color: "#333" },
      ];
      ds.entries = [
        // X spans wide enough to overlap both Y and the start of Z.
        {
          id: "e-x",
          rowId: "r-x",
          title: "e-x",
          start: { ms: Date.UTC(2010, 0, 1), precision: "exact" },
          end: { ms: Date.UTC(2014, 0, 1), precision: "exact" },
        },
        // Y overlaps X, so it cannot share X's lane.
        {
          id: "e-y",
          rowId: "r-y",
          title: "e-y",
          start: { ms: Date.UTC(2011, 0, 1), precision: "exact" },
          end: { ms: Date.UTC(2013, 0, 1), precision: "exact" },
        },
        // Z starts exactly where Y ends (back-to-back) but X is still
        // running at that instant, so Z must land in Y's lane, not X's.
        {
          id: "e-z",
          rowId: "r-z",
          title: "e-z",
          start: { ms: Date.UTC(2013, 0, 1), precision: "exact" },
          end: { ms: Date.UTC(2015, 0, 1), precision: "exact" },
        },
      ];
      const { items } = computeLayout(ds, new Set(["g-lanes"]));
      const item = items.find((i) => i.kind === "group" && i.id === "g-lanes")!;
      const laneOf = (id: string) => item.summaries!.find((b) => b.id === id)!.lane;
      expect(laneOf("r-x")).toBe(0);
      expect(laneOf("r-y")).toBe(1);
      expect(laneOf("r-z")).toBe(1); // shares Y's lane, back-to-back
      // Sorted by (lane, startMs): X first (lane 0), then Y then Z (lane 1).
      expect(item.summaries!.map((b) => b.id)).toEqual(["r-x", "r-y", "r-z"]);
    });

    test("the item's height grows with the lane count, and the y of the following sibling shifts accordingly", () => {
      const ds = emptyDataset();
      ds.groups = [
        { id: "g-lanes", label: "Lanes", collapsed: false },
        { id: "g-after", label: "After", collapsed: false },
      ];
      ds.rows = [
        { id: "r-x", groupId: "g-lanes", label: "X", color: "#111" },
        { id: "r-y", groupId: "g-lanes", label: "Y", color: "#222" },
        { id: "r-after", groupId: "g-after", label: "After row", color: "#333" },
      ];
      ds.entries = [
        // Overlapping, so g-lanes needs two lanes.
        {
          id: "e-x",
          rowId: "r-x",
          title: "e-x",
          start: { ms: Date.UTC(2010, 0, 1), precision: "exact" },
          end: { ms: Date.UTC(2012, 0, 1), precision: "exact" },
        },
        {
          id: "e-y",
          rowId: "r-y",
          title: "e-y",
          start: { ms: Date.UTC(2011, 0, 1), precision: "exact" },
          end: { ms: Date.UTC(2013, 0, 1), precision: "exact" },
        },
        {
          id: "e-after",
          rowId: "r-after",
          title: "e-after",
          start: { ms: Date.UTC(2020, 0, 1), precision: "exact" },
          end: { ms: Date.UTC(2021, 0, 1), precision: "exact" },
        },
      ];
      const { items } = computeLayout(ds, new Set(["g-lanes"]));
      const gLanes = items.find((i) => i.id === "g-lanes" && i.kind === "group")!;
      const gAfter = items.find((i) => i.id === "g-after" && i.kind === "group")!;
      expect(gLanes.height).toBe(2 * ROW_HEIGHT);
      // The next top-level group follows one gap past the taller collapsed
      // item — the same gap everything else gets.
      expect(gAfter.y).toBe(gLanes.y + gLanes.height + ROW_GAP);
    });
  });

  describe("hiding removes items entirely", () => {
    test("a hidden row produces no item at all", () => {
      const { items } = computeLayout(fixture(), new Set(), hiddenIdsOf(["r1"], []));
      expect(items.find((i) => i.id === "r1")).toBeUndefined();
      expect(items.find((i) => i.id === "r-top")).toBeDefined();
    });

    test("a hidden group takes its whole subtree with it", () => {
      const { items } = computeLayout(fixture(), new Set(), hiddenIdsOf([], ["g-family"]));
      const ids = items.map((i) => i.id);
      expect(ids).not.toContain("g-family");
      expect(ids).not.toContain("g-finn"); // a sub-group of g-family
      expect(ids).not.toContain("g-finn-kid"); // three levels down
      expect(ids).not.toContain("r2"); // a row inside the subtree
      expect(ids).not.toContain("r3");
      expect(ids).toContain("r-top"); // untouched, it sits at the root
    });

    test("the layout closes up: whatever is first now gets the top pad", () => {
      const all = computeLayout(fixture(), new Set());
      // r-top is the first item; hiding it must not leave its gap behind for
      // the item that takes its place.
      const without = computeLayout(fixture(), new Set(), hiddenIdsOf(["r-top"], []));
      expect(all.items[0].id).toBe("r-top");
      expect(without.items[0].id).toBe("g-me");
      expect(without.items[0].y).toBe(all.items[0].y);
      expect(without.totalHeight).toBeLessThan(all.totalHeight);
    });
  });

  test("a top-level row needs no group at all", () => {
    const { items } = computeLayout(fixture(), new Set());
    const rTop = items.find((i) => i.id === "r-top")!;
    expect(rTop.depth).toBe(0);
    expect(rTop.y).toBe(ROW_GAP / 2); // the layout's top pad, nothing above it

    expect(rTop.height).toBe(ROW_HEIGHT);
  });

  test("totalHeight covers the last item", () => {
    const { items, totalHeight } = computeLayout(fixture(), new Set());
    const last = items[items.length - 1];
    expect(totalHeight).toBeGreaterThanOrEqual(last.y + last.height);
  });
});
