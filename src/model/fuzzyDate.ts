// Fuzzy-date math shared by the renderer, the detail panel, and import/export.
// All arithmetic is in UTC ms (see the timezone convention in types.ts).

import type { FuzzyDate, Precision, TimelineEntry } from "./types";

export const DAY_MS = 86_400_000;

export const DEFAULT_FUZZ_DAYS: Record<Precision, number> = {
  exact: 0,
  day: 0,
  month: 15,
  year: 182,
  circa: 365,
};

export function fuzzMs(date: FuzzyDate): number {
  return (date.fuzzDays ?? DEFAULT_FUZZ_DAYS[date.precision]) * DAY_MS;
}

export interface RampBounds {
  visualStart: number; // where alpha reaches 0 on the left
  solidStart: number; // where alpha reaches 1
  solidEnd: number; // where alpha starts dropping from 1
  visualEnd: number; // where alpha reaches 0 on the right (or "now" if ongoing)
  ongoing: boolean;
}

// Precision fuzziness and fade-in/out are one continuous edge mechanism (§5):
// the left ramp runs from (start - fuzz) up to (start + fuzz + fadeIn), the
// right ramp from (end - fuzz - fadeOut) down to (end + fuzz). An ongoing
// entry (no end) stays solid up to `nowMs` — the arrow taper is a renderer
// concern, not a data one.
export function rampBounds(entry: TimelineEntry, nowMs: number): RampBounds {
  const startFuzz = fuzzMs(entry.start);
  const visualStart = entry.start.ms - startFuzz;
  const solidStartRaw = entry.start.ms + startFuzz + (entry.fadeInDays ?? 0) * DAY_MS;

  if (!entry.end) {
    const solidStart = Math.min(solidStartRaw, nowMs);
    return { visualStart, solidStart, solidEnd: nowMs, visualEnd: nowMs, ongoing: true };
  }

  const endFuzz = fuzzMs(entry.end);
  const visualEnd = entry.end.ms + endFuzz;
  const solidEndRaw = entry.end.ms - endFuzz - (entry.fadeOutDays ?? 0) * DAY_MS;

  // A short bar with wide fuzz can make the ramps cross; collapse the solid
  // span to the crossing point instead of inverting it.
  if (solidStartRaw > solidEndRaw) {
    const middle = (solidStartRaw + solidEndRaw) / 2;
    return { visualStart, solidStart: middle, solidEnd: middle, visualEnd, ongoing: false };
  }
  return { visualStart, solidStart: solidStartRaw, solidEnd: solidEndRaw, visualEnd, ongoing: false };
}

export function utcDayStart(ms: number): number {
  return Math.floor(ms / DAY_MS) * DAY_MS;
}

export function addDays(ms: number, days: number): number {
  return ms + days * DAY_MS;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatFuzzyDate(date: FuzzyDate): string {
  const d = new Date(date.ms);
  const year = d.getUTCFullYear();
  switch (date.precision) {
    case "exact":
    case "day":
      return `${year}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    case "month":
      return `${year}-${pad(d.getUTCMonth() + 1)}`;
    case "year":
      return `${year}`;
    case "circa":
      return `ca. ${year}`;
  }
}

// Dragging a date handle must land on whole units of whatever precision the
// field is set to — otherwise a "year" date silently acquires a day and month
// the user never chose. Anchors match parseDateInput's: mid-period.
export function snapMsToPrecision(ms: number, precision: Precision): number {
  const d = new Date(ms);
  switch (precision) {
    case "exact":
    case "day":
      return utcDayStart(ms);
    case "month":
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 15);
    case "year":
    case "circa":
      return Date.UTC(d.getUTCFullYear(), 6, 1);
  }
}

export const SHORT_MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

// The format IS the feedback: how a date is written says how precisely it is
// known, so "exactly / around / sometime" stops being an invisible property of
// the field. Unlike formatFuzzyDate (which is a round-trippable edit format),
// this is for reading.
export function formatByPrecision(date: FuzzyDate): string {
  const d = new Date(date.ms);
  const year = d.getUTCFullYear();
  const month = SHORT_MONTH_NAMES[d.getUTCMonth()];
  switch (date.precision) {
    case "exact":
    case "day":
      return `${d.getUTCDate()} ${month} ${year}`;
    case "month":
      return `${month} ${year}`;
    case "year":
      return `${year}`;
    case "circa":
      return `~${year}`;
  }
}
