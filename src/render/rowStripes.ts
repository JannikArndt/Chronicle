// Alternating row backgrounds ("zebra striping") — pure geometry, shared by
// the canvas and the DOM rail so the two can never stripe different rows.
//
// The point of striping here is horizontal tracking: a bar sits far to the
// right of the name that labels it, and on a dense timeline the eye loses the
// line. `ROW_STRIPES` below is the settled look; the fields exist so the
// choices behind it stay named and adjustable in one place, not because
// anything reads them from a store. There was briefly a settings panel for
// them in the rail — it did its job, the values it produced are the defaults
// now, and a permanent panel for a decision made once is just clutter.

import { ROW_GAP } from "./layout";
import type { LayoutItem } from "./layout";

export type StripeScope = "all" | "group";

export interface RowStripeSettings {
  enabled: boolean;
  // Multiplies the tint's alpha: 0 is invisible, 1 is the full
  // `--color-row-stripe`. A slider rather than a fixed value because the right
  // strength depends on the palette and the screen, not on the code.
  strength: number;
  // "all": one alternation running down the whole timeline, so the stripes
  // line up across groups. "group": the count restarts inside every group, so
  // each group's own first timeline always reads the same way.
  scope: StripeScope;
  // Which of the two slots is the painted one — the whole picture inverts.
  offset: 0 | 1;
  // Whether a stripe also covers the gap above and below its row, which turns
  // separate stripes into continuous banding.
  includeGaps: boolean;
}

export const ROW_STRIPES: RowStripeSettings = {
  enabled: true,
  strength: 0.7,
  // "all", not "group": see the counter comment in `rowStripes` — restarting
  // per group is what puts two striped bands next to each other at a group
  // boundary, and a merged band is a row that is no longer centred in one.
  scope: "all",
  offset: 0,
  includeGaps: true,
};

export interface RowStripe {
  y: number;
  height: number;
}

// The stripes to paint behind `items`, in layout coordinates. Empty whenever
// striping is off or turned all the way down, so a caller can skip the paint
// entirely without repeating the test.
export function rowStripes(
  items: readonly LayoutItem[],
  settings: RowStripeSettings = ROW_STRIPES,
): RowStripe[] {
  if (!settings.enabled || settings.strength <= 0) return [];
  const stripes: RowStripe[] = [];
  // EVERY item is counted, an expanded group's header included. It is the
  // header that makes this necessary rather than tidy: skipped, it left two
  // unstriped items adjacent, which merged into one band and put the timeline
  // above the group visibly off-centre in it. Counted, the bands strictly
  // alternate down the whole layout and every item — timeline, collapsed
  // group, header — sits centred in its own.
  //
  // One counter per nesting depth, so "restart in each group" is exact:
  // entering a group zeroes the counter one level down, and coming back out
  // resumes the container's own count where it left off. In "all" scope every
  // item shares the depth-0 counter instead — which is the only scope that
  // guarantees the strict alternation above, since restarting at 0 inside a
  // group can put two striped items next to each other at the boundary.
  const counters: number[] = [0];
  for (const item of items) {
    const depth = settings.scope === "group" ? item.depth : 0;
    if (item.kind === "group" && item.summaries === undefined) {
      // An expanded group opens a container: its children start a fresh count.
      counters[item.depth + 1] = 0;
    }
    const index = counters[depth] ?? 0;
    counters[depth] = index + 1;
    if (index % 2 !== settings.offset) continue;
    // Half a gap on each side, so consecutive bands meet exactly halfway
    // between two items and every item has the same amount of air above and
    // below it before the background changes. `computeLayout` pads the top
    // and bottom of the whole layout by the same half-gap, so this never
    // reaches outside the content.
    const pad = settings.includeGaps ? ROW_GAP / 2 : 0;
    stripes.push({ y: item.y - pad, height: item.height + pad * 2 });
  }
  return stripes;
}
