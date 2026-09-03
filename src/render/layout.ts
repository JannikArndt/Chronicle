// Vertical layout: groups nest arbitrarily deep, and each level holds its own
// timelines and sub-groups side by side (§2, §5). Pure function of the merged
// dataset; both the canvas and the DOM rail render from the same LayoutItem
// list so they can never drift apart.

import { orderedChildren } from "../model/dataset";
import type { Group, TimelineDataset, TimelineRow } from "../model/types";

export const GROUP_HEADER_HEIGHT = 32;
export const GROUP_HEADER_HEIGHT_FLOOR = 22;
const GROUP_HEADER_STEP_PX = 3; // header shrinks this much per nesting depth
export const ROW_HEIGHT = 40;
// The ONE vertical gap in this layout: between any two consecutive items,
// whatever they are — two timelines, a timeline and a group, a group header
// and its first child, the end of one group's subtree and the next thing at
// the level above. There used to be three (a wider GROUP_GAP_BEFORE so a
// group read as its own section, a tighter GROUP_HEADER_CHILD_GAP so a header
// bound to its content), and each of them was defensible on its own. Together
// with the row striping they were not: a stripe boundary falls halfway down a
// gap, so an unstriped row with a 10px gap above and a 20px gap below sat
// visibly off-centre in its own band, and no amount of tuning the stripes
// fixes a rhythm that is uneven underneath them. Hierarchy is carried by the
// indent, the ▸/▾ and the group's background band — none of which need the
// spacing to be uneven to work.
export const ROW_GAP = 10;
// Half a gap of air above the first item and below the last, so the first and
// last stripes are as tall as every other one instead of being cut off at the
// edges of the content.
const EDGE_PAD = ROW_GAP / 2;
// A group's header height, stepping down with nesting depth, never below the
// floor where a label stops being legible. This is spacing only: a group's
// NAME is styled exactly like a timeline's at every depth — see the "every
// label looks the same" invariant in CLAUDE.md. There was a matching
// groupFontSize() shrinking the text per depth; it made a deeply nested
// group's name a different thing from a timeline's name, which is precisely
// what the hierarchy must not be carried by.
export function groupHeaderHeight(depth: number): number {
  return Math.max(GROUP_HEADER_HEIGHT_FLOOR, GROUP_HEADER_HEIGHT - depth * GROUP_HEADER_STEP_PX);
}

// One summary bar standing in for one DIRECT child (row or sub-group) of a
// collapsed group — see the "group-summary" LayoutItem below. A collapsed
// group with children "Job A"/"Job B"/"Job C" gets three of these, not one
// flattened band, so it reads exactly like those three timelines did before
// collapsing.
export interface GroupSummaryBar {
  kind: "row" | "group"; // which kind of child this stands for
  id: string; // that child's id
  label: string;
  color?: string;
  startMs: number;
  endMs: number; // === startMs when the child holds only one dated thing
  ongoing: boolean; // some entry in this child's subtree has no end
  lane: number; // 0-based stacking lane — see packLanes()
}

export interface LayoutItem {
  kind: "group" | "row";
  id: string;
  y: number;
  height: number;
  // Nesting depth of the CONTAINER this item sits in — 0 at the root. Drives
  // both indentation and font-size step-down in the rail.
  depth: number;
  hidden: boolean; // row is unchecked in the rail (§2) — canvas skips its entries, rail keeps the row
  group?: Group;
  row?: TimelineRow;
  // Set on a COLLAPSED group and on nothing else — so its presence is also
  // how a renderer knows a group is collapsed, without re-deriving the rule.
  // One bar per direct child (row or sub-group) that has anything dated,
  // lane-packed for overlap (see packLanes()); empty when every direct child
  // is empty or hidden, which is a collapsed group that draws no bars rather
  // than no item.
  summaries?: GroupSummaryBar[];
  // "group" only, and only while EXPANDED — the y position where this group's
  // whole subtree (header plus every row and nested group under it, at any
  // depth) ends. Lets a renderer paint one background band over a group's
  // full extent rather than just its header line; both the canvas and the
  // rail stack these bands in the same depth-first paint order the items
  // already come in, so a nested group's band overlays its ancestors' and
  // reads as a softer shade layered inside a stronger one — hierarchy through
  // paint order, not a hand-picked color per depth. Left unset when the group
  // is collapsed, which is the whole of "a collapsed group has no band".
  subtreeEndY?: number;
}

export interface Layout {
  items: LayoutItem[];
  totalHeight: number;
}

export function computeLayout(
  dataset: TimelineDataset,
  collapsedGroupIds: Set<string>,
  hiddenRowIds: Set<string> = new Set(),
): Layout {
  const items: LayoutItem[] = [];
  let y = EDGE_PAD;

  const isCollapsed = (group: Group): boolean => collapsedGroupIds.has(group.id) || group.collapsed;

  // Every group at or under `groupId`, `groupId` itself first.
  const subtreeGroupIds = (groupId: string): string[] => {
    const collected = [groupId];
    let frontier = [groupId];
    while (frontier.length > 0) {
      const children = dataset.groups.filter(
        (g) => g.parentGroupId !== undefined && frontier.includes(g.parentGroupId),
      );
      frontier = children.map((g) => g.id);
      collected.push(...frontier);
    }
    return collected;
  };

  // Every row directly under `groupId`, at any depth, EXCLUDING hidden ones —
  // a row the user unchecked in the rail must not resurface as part of a
  // collapsed ancestor's summary.
  const visibleSubtreeRowIds = (groupId: string): string[] => {
    const groupIds = new Set(subtreeGroupIds(groupId));
    return dataset.rows
      .filter((r) => r.groupId !== undefined && groupIds.has(r.groupId) && !hiddenRowIds.has(r.id))
      .map((r) => r.id);
  };

  // Earliest start / latest end / "does anything here lack an end" across
  // every entry and event on the given rows. `undefined` when none of those
  // rows have anything dated — the caller turns that into "no bar".
  const aggregate = (
    rowIds: ReadonlySet<string>,
  ): { startMs: number; endMs: number; ongoing: boolean } | undefined => {
    let startMs = Number.POSITIVE_INFINITY;
    let endMs = Number.NEGATIVE_INFINITY;
    let ongoing = false;
    for (const entry of dataset.entries) {
      if (!rowIds.has(entry.rowId)) continue;
      startMs = Math.min(startMs, entry.start.ms);
      endMs = Math.max(endMs, entry.end?.ms ?? entry.start.ms);
      if (!entry.end) ongoing = true;
    }
    for (const event of dataset.events) {
      if (!rowIds.has(event.rowId)) continue;
      startMs = Math.min(startMs, event.date.ms);
      endMs = Math.max(endMs, event.date.ms);
    }
    return Number.isFinite(startMs) ? { startMs, endMs, ongoing } : undefined;
  };

  // Overlap handling for a collapsed group's summary bars, and deliberately
  // zoom-independent — computeLayout knows nothing about the time scale, so
  // this packs purely by ms comparison, not pixels. Sorted by start; each bar
  // takes the first lane whose last bar already ends at or before this bar's
  // start, else opens a new lane. An ongoing bar occupies its lane to
  // +Infinity. The `<=` (not `<`) is what lets back-to-back children —
  // one ending exactly where the next starts — share a lane, which is what
  // makes the collapsed group read like the one original timeline it stands
  // in for.
  const packLanes = (bars: Array<Omit<GroupSummaryBar, "lane">>): GroupSummaryBar[] => {
    const laneEnds: number[] = []; // last bar's end in each lane so far
    const withLanes = [...bars]
      .sort((a, b) => a.startMs - b.startMs)
      .map((bar) => {
        let lane = laneEnds.findIndex((end) => end <= bar.startMs);
        if (lane === -1) lane = laneEnds.length;
        laneEnds[lane] = bar.ongoing ? Number.POSITIVE_INFINITY : bar.endMs;
        return { ...bar, lane };
      });
    withLanes.sort((a, b) => a.lane - b.lane || a.startMs - b.startMs);
    return withLanes;
  };

  // One bar per direct child that has anything dated, in the same single
  // ordered sequence pushContainer walks, lane-packed for overlap. `[]` when
  // every child is empty or hidden.
  const groupSummaryBars = (groupId: string): GroupSummaryBar[] => {
    const bars: Array<Omit<GroupSummaryBar, "lane">> = [];
    for (const child of orderedChildren(dataset, groupId)) {
      if (child.kind === "row") {
        if (hiddenRowIds.has(child.row.id)) continue;
        const agg = aggregate(new Set([child.row.id]));
        if (!agg) continue;
        bars.push({ kind: "row", id: child.row.id, label: child.row.label, color: child.row.color, ...agg });
      } else {
        const agg = aggregate(new Set(visibleSubtreeRowIds(child.group.id)));
        if (!agg) continue;
        bars.push({ kind: "group", id: child.group.id, label: child.group.label, color: child.group.color, ...agg });
      }
    }
    return packLanes(bars);
  };

  const pushRow = (row: TimelineRow, depth: number, gapBefore: number): void => {
    y += gapBefore;
    items.push({
      kind: "row",
      id: row.id,
      y,
      height: ROW_HEIGHT,
      depth,
      hidden: hiddenRowIds.has(row.id),
      row,
    });
    y += ROW_HEIGHT;
  };

  const pushGroup = (group: Group, depth: number, gapBefore: number): void => {
    y += gapBefore;

    // Collapsed, a group IS a timeline: one item, one row height, the summary
    // bars of its direct children drawn in that same band, and no
    // `subtreeEndY` — so neither renderer paints a section background behind
    // it. It stands in for the timelines it hides, so looking like a section
    // header would be describing something the user can no longer see.
    // Overlapping children are the one exception to "one row height": they
    // need their lanes, and the item grows to hold them.
    if (isCollapsed(group)) {
      const summaries = groupSummaryBars(group.id);
      const laneCount = summaries.length === 0 ? 1 : summaries[summaries.length - 1].lane + 1;
      const height = laneCount * ROW_HEIGHT;
      items.push({ kind: "group", id: group.id, y, height, depth, hidden: false, group, summaries });
      y += height;
      return;
    }

    const height = groupHeaderHeight(depth);
    const item: LayoutItem = { kind: "group", id: group.id, y, height, depth, hidden: false, group };
    items.push(item);
    y += height;
    pushContainer(group.id, depth + 1, true);
    item.subtreeEndY = y;
  };

  // A container's timelines and sub-groups in ONE ordered sequence
  // (`orderedChildren`, schema v10) — the two kinds interleave freely, so a
  // group can sit above a timeline at any depth, including the root
  // (`parentGroupId`/`groupId` both undefined). `hasHeaderAbove` is true for a
  // group's own body, i.e. this container's first item sits under that
  // header rather than at the top of the layout.
  function pushContainer(parentGroupId: string | undefined, depth: number, hasHeaderAbove: boolean): void {
    orderedChildren(dataset, parentGroupId).forEach((child, index) => {
      // ROW_GAP before everything, with one exception: the very first item in
      // the whole layout, which has nothing above it to be separated from and
      // already sits on EDGE_PAD. Kind and collapse state do not enter into
      // it — a gap that changed under the ▸/▾ made the group jump on expand,
      // and a gap that differs by kind puts the row above it off-centre in
      // its stripe.
      const gapBefore = index === 0 && !hasHeaderAbove && depth === 0 ? 0 : ROW_GAP;
      if (child.kind === "row") pushRow(child.row, depth, gapBefore);
      else pushGroup(child.group, depth, gapBefore);
    });
  }

  pushContainer(undefined, 0, false);

  return { items, totalHeight: y + EDGE_PAD };
}
