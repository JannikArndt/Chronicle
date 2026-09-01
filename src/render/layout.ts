// Vertical layout: groups nest arbitrarily deep, and each level holds its own
// timelines and sub-groups side by side (§2, §5). Pure function of the merged
// dataset; both the canvas and the DOM rail render from the same LayoutItem
// list so they can never drift apart.

import type { Group, TimelineDataset, TimelineRow } from "../model/types";

export const GROUP_HEADER_HEIGHT = 32;
export const GROUP_HEADER_HEIGHT_FLOOR = 22;
const GROUP_HEADER_STEP_PX = 3; // header shrinks this much per nesting depth
export const ROW_HEIGHT = 40;
export const ROW_GAP = 10;
export const GROUP_GAP = 14; // extra breathing room after each TOP-LEVEL group
export const GROUP_FONT_SIZE = 13;
export const GROUP_FONT_SIZE_FLOOR = 11;
const GROUP_FONT_STEP_PX = 1; // font shrinks this much per nesting depth

// A group's header height, stepping down with nesting depth so the hierarchy
// reads at a glance, never below the floor where a label stops being legible.
export function groupHeaderHeight(depth: number): number {
  return Math.max(GROUP_HEADER_HEIGHT_FLOOR, GROUP_HEADER_HEIGHT - depth * GROUP_HEADER_STEP_PX);
}

// Same idea for the label's font size — used by the rail (canvas text sizes
// are set per-draw-call, not from this).
export function groupFontSize(depth: number): number {
  return Math.max(GROUP_FONT_SIZE_FLOOR, GROUP_FONT_SIZE - depth * GROUP_FONT_STEP_PX);
}

// The aggregated span a collapsed group's summary bar covers — earliest start
// to latest end across every entry/event anywhere in its subtree.
export interface GroupSummary {
  startMs: number;
  endMs: number;
}

export interface LayoutItem {
  // "group-summary" is the one synthetic bar standing in for a whole collapsed
  // group's subtree — canvas-only, the rail skips it (there is nothing to
  // click or edit on an aggregate).
  kind: "group" | "row" | "group-summary";
  id: string;
  y: number;
  height: number;
  // Nesting depth of the CONTAINER this item sits in — 0 at the root. Drives
  // both indentation and font-size step-down in the rail.
  depth: number;
  hidden: boolean; // row is unchecked in the rail (§2) — canvas skips its entries, rail keeps the row
  group?: Group;
  row?: TimelineRow;
  // "group-summary" only. Undefined if the subtree has nothing dated at all,
  // in which case no summary item is emitted for that group.
  summary?: GroupSummary;
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

  // A collapsed group aggregates its whole subtree into one bar: earliest
  // start to latest end across every entry and event on every timeline nested
  // anywhere under it, at any depth.
  const summarizeGroup = (groupId: string): GroupSummary | undefined => {
    const groupIds = new Set(subtreeGroupIds(groupId));
    const rowIds = new Set(
      dataset.rows.filter((r) => r.groupId !== undefined && groupIds.has(r.groupId)).map((r) => r.id),
    );
    let startMs = Number.POSITIVE_INFINITY;
    let endMs = Number.NEGATIVE_INFINITY;
    for (const entry of dataset.entries) {
      if (!rowIds.has(entry.rowId)) continue;
      startMs = Math.min(startMs, entry.start.ms);
      endMs = Math.max(endMs, entry.end?.ms ?? entry.start.ms);
    }
    for (const event of dataset.events) {
      if (!rowIds.has(event.rowId)) continue;
      startMs = Math.min(startMs, event.date.ms);
      endMs = Math.max(endMs, event.date.ms);
    }
    return Number.isFinite(startMs) ? { startMs, endMs } : undefined;
  };

  const pushRow = (row: TimelineRow, depth: number): void => {
    y += ROW_GAP;
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

  const pushGroup = (group: Group, depth: number): void => {
    const height = groupHeaderHeight(depth);
    items.push({ kind: "group", id: group.id, y, height, depth, hidden: false, group });
    y += height;
    if (isCollapsed(group)) {
      const summary = summarizeGroup(group.id);
      if (summary) {
        items.push({
          kind: "group-summary",
          id: group.id,
          y,
          height: ROW_HEIGHT,
          depth: depth + 1,
          hidden: false,
          group,
          summary,
        });
        y += ROW_HEIGHT;
      }
    } else {
      pushContainer(group.id, depth + 1);
    }
  };

  // A container's own timelines, in dataset order, before its sub-groups —
  // "Family"'s own shared timelines sit above each family member's, at every
  // depth, including the root (`parentGroupId`/`groupId` both undefined).
  function pushContainer(parentGroupId: string | undefined, depth: number): void {
    for (const row of dataset.rows.filter((r) => r.groupId === parentGroupId)) pushRow(row, depth);
    for (const group of dataset.groups.filter((g) => g.parentGroupId === parentGroupId)) {
      pushGroup(group, depth);
      // Extra breathing room after each TOP-LEVEL group only — nested groups
      // pack tighter, which is part of how depth reads on screen.
      if (depth === 0) y += GROUP_GAP;
    }
  }

  pushContainer(undefined, 0);

  return { items, totalHeight: y };
}
