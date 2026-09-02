// Vertical layout: groups nest arbitrarily deep, and each level holds its own
// timelines and sub-groups side by side (§2, §5). Pure function of the merged
// dataset; both the canvas and the DOM rail render from the same LayoutItem
// list so they can never drift apart.

import type { Group, TimelineDataset, TimelineRow } from "../model/types";

export const GROUP_HEADER_HEIGHT = 32;
export const GROUP_HEADER_HEIGHT_FLOOR = 22;
const GROUP_HEADER_STEP_PX = 3; // header shrinks this much per nesting depth
export const ROW_HEIGHT = 40;
export const ROW_GAP = 10; // between sibling rows within the same container
// Space before a group header, separating it from whatever precedes it at the
// same level — bigger than ROW_GAP so a group reads as its own section, not
// as one more row belonging to whatever came before it. Applies at every
// depth, not just top-level, per the same "hierarchy through spacing" idea
// GROUP_HEADER_CHILD_GAP applies going the other direction.
export const GROUP_GAP_BEFORE = 20;
// Tighter space from a group's own header down to its first child (row or
// sub-group) — smaller than ROW_GAP, so a header binds visually to its own
// content rather than floating an equal distance from both what precedes it
// and what it owns.
export const GROUP_HEADER_CHILD_GAP = 6;
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
  let y = 0;

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

  // One bar per direct child (own rows first, then sub-groups — the same
  // order pushContainer uses) that has anything dated, lane-packed for
  // overlap. `[]` when every child is empty or hidden.
  const groupSummaryBars = (groupId: string): GroupSummaryBar[] => {
    const bars: Array<Omit<GroupSummaryBar, "lane">> = [];
    for (const row of dataset.rows.filter((r) => r.groupId === groupId)) {
      if (hiddenRowIds.has(row.id)) continue;
      const agg = aggregate(new Set([row.id]));
      if (!agg) continue;
      bars.push({ kind: "row", id: row.id, label: row.label, color: row.color, ...agg });
    }
    for (const group of dataset.groups.filter((g) => g.parentGroupId === groupId)) {
      const agg = aggregate(new Set(visibleSubtreeRowIds(group.id)));
      if (!agg) continue;
      bars.push({ kind: "group", id: group.id, label: group.label, color: group.color, ...agg });
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

  // A container's own timelines, in dataset order, before its sub-groups —
  // "Family"'s own shared timelines sit above each family member's, at every
  // depth, including the root (`parentGroupId`/`groupId` both undefined).
  // `hasHeaderAbove` is true for a group's own body (this container's first
  // item then sits right under that header, and gets the tight
  // GROUP_HEADER_CHILD_GAP instead of the normal sibling/section gap).
  function pushContainer(parentGroupId: string | undefined, depth: number, hasHeaderAbove: boolean): void {
    const rows = dataset.rows.filter((r) => r.groupId === parentGroupId);
    const groups = dataset.groups.filter((g) => g.parentGroupId === parentGroupId);
    let index = 0;
    for (const row of rows) {
      const gapBefore = index === 0 ? (hasHeaderAbove ? GROUP_HEADER_CHILD_GAP : 0) : ROW_GAP;
      pushRow(row, depth, gapBefore);
      index++;
    }
    for (const group of groups) {
      // A collapsed group is spaced like the timeline it stands in for, not
      // like a section: GROUP_GAP_BEFORE exists to separate a header from
      // whatever precedes it, and there is no header here to separate.
      const sectionGap = isCollapsed(group) ? ROW_GAP : GROUP_GAP_BEFORE;
      const gapBefore = index === 0 ? (hasHeaderAbove ? GROUP_HEADER_CHILD_GAP : 0) : sectionGap;
      pushGroup(group, depth, gapBefore);
      index++;
    }
  }

  pushContainer(undefined, 0, false);

  return { items, totalHeight: y };
}
