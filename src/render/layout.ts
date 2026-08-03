// Vertical layout: groups → sub-groups → rows → sub-rows (§2, §5).
// Pure function of the merged dataset; both the canvas and the DOM rail render
// from the same LayoutItem list so they can never drift apart.

import type { Group, TimelineDataset, TimelineRow } from "../model/types";

export const GROUP_HEADER_HEIGHT = 32;
export const SUB_GROUP_HEADER_HEIGHT = 26;
export const ROW_HEIGHT = 40;
export const ROW_GAP = 10;
export const SUB_ROW_GAP = 4; // sub-timelines hug their parent (§5)
export const GROUP_GAP = 14;
// A collapsed parent row squeezes its sub-rows into a dense band on the canvas
// (the rail drops their labels) — a compacted overview of an "area of life".
export const COMPACT_ROW_HEIGHT = 20;
export const COMPACT_ROW_GAP = 2;

export interface LayoutItem {
  // "subgroup" is a group nested in another one — the smaller header that used
  // to be a person. It carries a `group` like any other group item.
  kind: "group" | "subgroup" | "row";
  id: string;
  y: number;
  height: number;
  depth: number; // sub-row nesting depth (rows only)
  isSubRow: boolean;
  hidden: boolean; // row is unchecked in the rail (§2) — canvas skips its entries, rail keeps the row
  // A sub-row inside a collapsed parent: drawn compact on the canvas and hidden
  // in the rail. The bar carries its row's own label (there is no rail label).
  compact: boolean;
  group?: Group;
  // For a "subgroup" item: the top-level group it sits under.
  parentGroup?: Group;
  row?: TimelineRow;
}

export interface Layout {
  items: LayoutItem[];
  totalHeight: number;
}

export function computeLayout(
  dataset: TimelineDataset,
  collapsedGroupIds: Set<string>,
  hiddenRowIds: Set<string> = new Set(),
  collapsedRowIds: Set<string> = new Set(),
): Layout {
  const items: LayoutItem[] = [];
  let y = 0;

  // `compact` is inherited: once a collapsed row is crossed, everything below it
  // renders compact. The collapsed row itself stays full height (it's the header).
  const pushRowTree = (row: TimelineRow, depth: number, compact: boolean) => {
    y += compact ? COMPACT_ROW_GAP : depth > 0 ? SUB_ROW_GAP : ROW_GAP;
    const height = compact ? COMPACT_ROW_HEIGHT : ROW_HEIGHT;
    items.push({
      kind: "row",
      id: row.id,
      y,
      height,
      depth,
      isSubRow: depth > 0,
      hidden: hiddenRowIds.has(row.id),
      compact,
      row,
    });
    y += height;
    const childCompact = compact || collapsedRowIds.has(row.id);
    for (const child of dataset.rows.filter((r) => r.parentRowId === row.id)) {
      pushRowTree(child, depth + 1, childCompact);
    }
  };

  const isCollapsed = (group: Group): boolean => collapsedGroupIds.has(group.id) || group.collapsed;

  // A group's own top-level rows, in dataset order. Sub-rows are pushed by
  // pushRowTree from their parent, never listed here.
  const topRowsOf = (groupId: string) =>
    dataset.rows.filter((r) => r.groupId === groupId && r.parentRowId === undefined);

  for (const group of dataset.groups) {
    // Sub-groups are drawn by their parent, in place, so skip them here.
    if (group.parentGroupId !== undefined) continue;
    items.push({
      kind: "group",
      id: group.id,
      y,
      height: GROUP_HEADER_HEIGHT,
      depth: 0,
      isSubRow: false,
      hidden: false,
      compact: false,
      group,
    });
    y += GROUP_HEADER_HEIGHT;
    if (!isCollapsed(group)) {
      // Rows filed directly in the group come before its sub-groups, so
      // "Family"'s own shared timelines sit above each family member's.
      for (const row of topRowsOf(group.id)) pushRowTree(row, 0, false);
      for (const subGroup of dataset.groups.filter((g) => g.parentGroupId === group.id)) {
        items.push({
          kind: "subgroup",
          id: subGroup.id,
          y,
          height: SUB_GROUP_HEADER_HEIGHT,
          depth: 0,
          isSubRow: false,
          hidden: false,
          compact: false,
          group: subGroup,
          parentGroup: group,
        });
        y += SUB_GROUP_HEADER_HEIGHT;
        if (isCollapsed(subGroup)) continue;
        for (const row of topRowsOf(subGroup.id)) pushRowTree(row, 0, false);
      }
    }
    y += GROUP_GAP;
  }

  return { items, totalHeight: y };
}
