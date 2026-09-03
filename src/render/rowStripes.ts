// Alternating row backgrounds ("zebra striping") — pure geometry, shared by
// the canvas and the DOM rail so the two can never stripe different rows.
//
// The point of striping here is horizontal tracking: a bar sits far to the
// right of the name that labels it, and on a dense timeline the eye loses the
// line. Everything about how strong that hint is, and where it restarts, is a
// setting rather than a hardcoded look — see `RowStripeSettings`.

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

export const DEFAULT_ROW_STRIPES: RowStripeSettings = {
  enabled: true,
  strength: 0.6,
  scope: "group",
  offset: 0,
  includeGaps: false,
};

export interface RowStripe {
  y: number;
  height: number;
}

// Which layout items get a stripe of their own. A timeline does; so does a
// COLLAPSED group, because collapsed a group *is* the timeline it stands in
// for (see src/render/CLAUDE.md) and skipping it would drop one row out of the
// alternation. An expanded group's header does not: it labels a section, and
// striping it would band the section title rather than a row.
function isStripeable(item: LayoutItem): boolean {
  return item.kind === "row" || item.summaries !== undefined;
}

// The stripes to paint behind `items`, in layout coordinates. Empty whenever
// striping is off or turned all the way down, so a caller can skip the paint
// entirely without repeating the test.
export function rowStripes(items: readonly LayoutItem[], settings: RowStripeSettings): RowStripe[] {
  if (!settings.enabled || settings.strength <= 0) return [];
  const stripes: RowStripe[] = [];
  // One counter per nesting depth, so "restart in each group" is exact:
  // entering a group zeroes the counter one level down, and coming back out
  // resumes the container's own count where it left off. In "all" scope every
  // item shares the depth-0 counter instead.
  const counters: number[] = [0];
  for (const item of items) {
    const depth = settings.scope === "group" ? item.depth : 0;
    if (item.kind === "group" && item.summaries === undefined) {
      // An expanded group opens a container: its children start a fresh count.
      counters[item.depth + 1] = 0;
    }
    if (!isStripeable(item)) continue;
    const index = counters[depth] ?? 0;
    counters[depth] = index + 1;
    if (index % 2 !== settings.offset) continue;
    const pad = settings.includeGaps ? ROW_GAP / 2 : 0;
    stripes.push({ y: item.y - pad, height: item.height + pad * 2 });
  }
  return stripes;
}
