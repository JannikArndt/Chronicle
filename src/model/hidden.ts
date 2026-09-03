// Which timelines and groups are hidden from the view.
//
// Hiding is a VIEW state, not data: it lives in the app store (persisted next
// to the other view preferences, never in the dataset), so it is never
// exported, never published, and never reaches another device as if it were a
// property of the timeline itself. Two people looking at the same shared
// timeline hide different things.
//
// A hidden thing is hidden COMPLETELY — `computeLayout` emits no item for it,
// so there is no dimmed row, no ghost in the rail and no bar on the canvas.
// That is the whole point of the feature (a checkbox that left the row in
// place mostly moved the clutter around), and it is also what makes this file
// necessary: something has to remember what was hidden and where it belongs,
// so it can be offered back. `hiddenChildrenOf()` is that offer — the rail
// asks each container what it is holding back and shows it as an unhide
// affordance in the one place the user would look for it.

import { orderedChildren } from "./dataset";
import type { RailChild, RailChildRef } from "./dataset";
import type { TimelineDataset } from "./types";

export interface HiddenIds {
  rows: ReadonlySet<string>;
  // A hidden group takes its whole subtree with it — its rows and sub-groups
  // are not separately hidden, they are simply not drawn. Unhiding the group
  // brings back exactly the picture it had.
  groups: ReadonlySet<string>;
}

export const NOTHING_HIDDEN: HiddenIds = { rows: new Set(), groups: new Set() };

export function hiddenIdsOf(hiddenRowIds: readonly string[], hiddenGroupIds: readonly string[]): HiddenIds {
  return { rows: new Set(hiddenRowIds), groups: new Set(hiddenGroupIds) };
}

export function isHidden(hidden: HiddenIds, child: RailChildRef): boolean {
  return child.kind === "row" ? hidden.rows.has(child.id) : hidden.groups.has(child.id);
}

// The direct children of one container that are currently hidden, in the same
// order they would have had on screen — so the unhide list reads like the gap
// it fills. `parentGroupId` is undefined for the root container, whose hidden
// children are offered in the rail footer instead of under a group header.
export function hiddenChildrenOf(
  dataset: TimelineDataset,
  parentGroupId: string | undefined,
  hidden: HiddenIds,
): RailChild[] {
  return orderedChildren(dataset, parentGroupId).filter((child) => isHidden(hidden, child));
}

// Every hidden child in the whole dataset, in render order, skipping anything
// inside a container that is itself hidden — putting a row back inside a
// hidden group changes nothing on screen, so offering it would be a button
// that does nothing. Used by the mobile timeline list, which has no per-group
// headers to hang a container's own list under.
export function hiddenChildrenEverywhere(dataset: TimelineDataset, hidden: HiddenIds): RailChild[] {
  const found: RailChild[] = [];
  const walk = (parentGroupId: string | undefined): void => {
    for (const child of orderedChildren(dataset, parentGroupId)) {
      if (isHidden(hidden, child)) {
        found.push(child);
        continue; // its own subtree comes back with it
      }
      if (child.kind === "group") walk(child.group.id);
    }
  };
  walk(undefined);
  return found;
}
