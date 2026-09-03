// The optional "tree" overlay: a line from each group down to the timelines
// and sub-groups it holds.
//
// Off by default. The hierarchy is normally carried by the indent, the ▸/▾ and
// the group's background band (see the "every name in the rail is the same
// name" invariant) — but on a deep tree, or on the canvas where there are no
// names at all, an explicit connector answers "which group is this row in?"
// without having to count pixels of indent. It is a view preference, not a
// second way of laying anything out: nothing here moves an item, and turning
// it off changes nothing but the strokes.
//
// Pure, like every other module here, and shared: the rail draws the segments
// as absolutely-positioned divs and the canvas strokes the same numbers, so
// the two cannot draw different trees.

import { groupHeaderHeight } from "./layout";
import type { LayoutItem } from "./layout";

// Both renderers indent by `RAIL_INDENT_BASE_PX + depth * RAIL_INDENT_STEP_PX`
// (the rail as `padding-left`, the canvas as the x of a pinned label). The
// trunk hangs under the middle of the ▸/▾ glyph, which occupies the first
// `COLLAPSE_GLYPH_WIDTH_PX` of that indent.
const RAIL_INDENT_BASE_PX = 8;
const RAIL_INDENT_STEP_PX = 14;
const COLLAPSE_GLYPH_WIDTH_PX = 14;

export function indentOf(depth: number): number {
  return RAIL_INDENT_BASE_PX + depth * RAIL_INDENT_STEP_PX;
}

// One straight segment. Verticals have x0 === x1, horizontals y0 === y1 — no
// diagonals, which is what makes this readable as a tree rather than a graph.
export interface TreeLine {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

// The vertical middle of an item's own box — the height the RAIL gives it, so
// a collapsed group (whose layout item grows with its summary lanes) is met at
// its name rather than in the middle of bars the name does not label.
function railMidY(item: LayoutItem): number {
  const height = item.summaries === undefined ? item.height : groupHeaderHeight(item.depth);
  return item.y + height / 2;
}

// One trunk per EXPANDED group that has children, plus one elbow per direct
// child. A collapsed group has no children on screen, and `subtreeEndY` is
// left unset on it — the same single fact both renderers already use to decide
// whether to paint its band — so it gets no trunk either.
//
// Direct children are read back out of the flat item list the way every other
// consumer reconstructs the tree: everything between the group's header and
// its `subtreeEndY` that sits exactly one level deeper. Anything deeper than
// that belongs to a sub-group and gets its own trunk.
export function treeLines(items: LayoutItem[]): TreeLine[] {
  const lines: TreeLine[] = [];

  for (const group of items) {
    if (group.kind !== "group" || group.subtreeEndY === undefined) continue;
    const children = items.filter(
      (item) =>
        item.depth === group.depth + 1 && item.y >= group.y + group.height && item.y < group.subtreeEndY!,
    );
    if (children.length === 0) continue;

    const x = indentOf(group.depth) + COLLAPSE_GLYPH_WIDTH_PX / 2;
    const lastMidY = railMidY(children[children.length - 1]);
    // The trunk stops at the LAST child's elbow, not at the bottom of the
    // subtree: a line running past the last row into empty space reads as an
    // unclosed branch.
    lines.push({ x0: x, y0: group.y + group.height, x1: x, y1: lastMidY });
    for (const child of children) {
      const midY = railMidY(child);
      lines.push({ x0: x, y0: midY, x1: indentOf(child.depth), y1: midY });
    }
  }

  return lines;
}
