// Pure "+" affordance geometry — where a row offers to start a new entry.
// Kept out of the canvas code so it can be unit-tested (see src/render/CLAUDE.md).

import type { TimelineEntry } from "../model/types";
import type { TimeScale } from "./timeScale";
import { msToX, xToMs } from "./timeScale";

export const PLUS_RADIUS = 11;
export const MIN_GAP_FOR_PLUS_PX = 48;

export interface PlusSpot {
  x: number;
  startMs: number;
}

export function plusSpots(input: {
  entries: TimelineEntry[]; // the row's entries, already sorted by start as the engine has them
  scale: TimeScale;
  width: number; // canvas width in CSS px
  nowMs: number;
  // Where the user last clicked an empty stretch of THIS row, or null.
  clickedMs: number | null;
}): PlusSpot[] {
  const { entries, scale, width, nowMs, clickedMs } = input;

  // A remembered click always wins, empty row or not — that's the whole
  // feature: the "+" appears exactly where the user pointed, not wherever
  // the gap heuristic below would have put it. Once set, it stays honoured
  // until the click is cleared (engine.ts clears it on selection change).
  if (clickedMs !== null) {
    return [{ x: msToX(scale, clickedMs), startMs: clickedMs }];
  }

  if (entries.length === 0) {
    const centerMs = xToMs(scale, width / 2);
    return [{ x: msToX(scale, centerMs), startMs: centerMs }];
  }

  const spots: PlusSpot[] = [];

  const first = entries[0];
  const firstX = msToX(scale, first.start.ms);
  if (firstX > PLUS_RADIUS * 3) {
    spots.push({ x: firstX - 30, startMs: xToMs(scale, firstX - 30) });
  }

  for (let i = 0; i < entries.length - 1; i++) {
    const endMs = entries[i].end?.ms ?? nowMs;
    const gapStartX = msToX(scale, endMs);
    const gapEndX = msToX(scale, entries[i + 1].start.ms);
    // Only offer a target where the on-screen gap is wide enough (§6).
    if (gapEndX - gapStartX >= MIN_GAP_FOR_PLUS_PX) {
      spots.push({ x: (gapStartX + gapEndX) / 2, startMs: endMs });
    }
  }

  const last = entries[entries.length - 1];
  const lastEndMs = last.end?.ms ?? nowMs;
  const lastX = msToX(scale, lastEndMs);
  spots.push({ x: lastX + 30, startMs: lastEndMs });

  return spots;
}
