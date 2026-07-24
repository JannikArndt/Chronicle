// Vertical layout: groups → person sub-groups → rows → sub-rows (§2, §5).
// Pure function of the merged dataset; both the canvas and the DOM rail render
// from the same LayoutItem list so they can never drift apart.

import type { Group, Person, TimelineDataset, TimelineRow } from "../model/types";

export const GROUP_HEADER_HEIGHT = 32;
export const PERSON_HEADER_HEIGHT = 26;
export const ROW_HEIGHT = 40;
export const ROW_GAP = 10;
export const SUB_ROW_GAP = 4; // sub-timelines hug their parent (§5)
export const GROUP_GAP = 14;
// A collapsed parent row squeezes its sub-rows into a dense band on the canvas
// (the rail drops their labels) — a compacted overview of an "area of life".
export const COMPACT_ROW_HEIGHT = 20;
export const COMPACT_ROW_GAP = 2;

export interface LayoutItem {
  kind: "group" | "person" | "row";
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
  person?: Person;
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

  const personById = new Map(dataset.people.map((p) => [p.id, p]));

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

  for (const group of dataset.groups) {
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
    const collapsed = collapsedGroupIds.has(group.id) || group.collapsed;
    if (!collapsed) {
      const groupRows = dataset.rows.filter((r) => r.groupId === group.id && r.parentRowId === undefined);
      if (group.personId) {
        // The group IS this person (§2) — rows attach directly, no sub-header.
        for (const row of groupRows) pushRowTree(row, 0, false);
      } else {
        const directRows = groupRows.filter((r) => r.personId === undefined);
        for (const row of directRows) pushRowTree(row, 0, false);
        const personIdsInOrder = [...new Set(groupRows.map((r) => r.personId).filter((id): id is string => !!id))];
        for (const personId of personIdsInOrder) {
          const person = personById.get(personId);
          if (!person) continue;
          items.push({
            kind: "person",
            id: personId,
            y,
            height: PERSON_HEADER_HEIGHT,
            depth: 0,
            isSubRow: false,
            hidden: false,
            compact: false,
            person,
            group,
          });
          y += PERSON_HEADER_HEIGHT;
          for (const row of groupRows.filter((r) => r.personId === personId)) pushRowTree(row, 0, false);
        }
      }
    }
    y += GROUP_GAP;
  }

  return { items, totalHeight: y };
}
