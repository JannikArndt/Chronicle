// Two-level time axis ticks (§5): a finer and a coarser unit are ALWAYS both
// present, at every zoom level — an early prototype had the axis go blank and
// that is treated as a hard bug here. All boundaries are UTC.

import type { Precision } from "../model/types";
import type { TimeScale } from "./timeScale";
import { msToX, xToMs } from "./timeScale";

export interface Tick {
  ms: number;
  label: string;
}

type Unit = "hour" | "day" | "week" | "month" | "quarter" | "year" | "decade" | "century";

const UNITS: { unit: Unit; approxMs: number }[] = [
  { unit: "hour", approxMs: 3_600_000 },
  { unit: "day", approxMs: 86_400_000 },
  { unit: "week", approxMs: 7 * 86_400_000 },
  { unit: "month", approxMs: 30.44 * 86_400_000 },
  { unit: "quarter", approxMs: 91.3 * 86_400_000 },
  { unit: "year", approxMs: 365.25 * 86_400_000 },
  { unit: "decade", approxMs: 3652.5 * 86_400_000 },
  { unit: "century", approxMs: 36525 * 86_400_000 },
];

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const FULL_MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

// How a tick is written is a separate choice from which unit it marks: the same
// month boundary reads "April '16" as a title and "A" as a subtitle.
export type LabelStyle =
  | "default"
  | "monthYear"
  | "monthInitial"
  | "monthShort"
  | "monthFull"
  | "dayOfMonth";

function floorToUnit(ms: number, unit: Unit): Date {
  const d = new Date(ms);
  switch (unit) {
    case "hour":
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours()));
    case "day":
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    case "week": {
      const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
      const weekday = (day.getUTCDay() + 6) % 7; // Monday-based
      day.setUTCDate(day.getUTCDate() - weekday);
      return day;
    }
    case "month":
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
    case "quarter":
      return new Date(Date.UTC(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / 3) * 3, 1));
    case "year":
      return new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    case "decade":
      return new Date(Date.UTC(Math.floor(d.getUTCFullYear() / 10) * 10, 0, 1));
    case "century":
      return new Date(Date.UTC(Math.floor(d.getUTCFullYear() / 100) * 100, 0, 1));
  }
}

function nextUnit(date: Date, unit: Unit): Date {
  const d = new Date(date);
  switch (unit) {
    case "hour":
      d.setUTCHours(d.getUTCHours() + 1);
      return d;
    case "day":
      d.setUTCDate(d.getUTCDate() + 1);
      return d;
    case "week":
      d.setUTCDate(d.getUTCDate() + 7);
      return d;
    case "month":
      d.setUTCMonth(d.getUTCMonth() + 1);
      return d;
    case "quarter":
      d.setUTCMonth(d.getUTCMonth() + 3);
      return d;
    case "year":
      d.setUTCFullYear(d.getUTCFullYear() + 1);
      return d;
    case "decade":
      d.setUTCFullYear(d.getUTCFullYear() + 10);
      return d;
    case "century":
      d.setUTCFullYear(d.getUTCFullYear() + 100);
      return d;
  }
}

function labelFor(date: Date, unit: Unit, style: LabelStyle = "default"): string {
  if (style === "monthYear") {
    return `${FULL_MONTH_NAMES[date.getUTCMonth()]} '${String(date.getUTCFullYear()).slice(2)}`;
  }
  if (style === "monthInitial") return FULL_MONTH_NAMES[date.getUTCMonth()][0];
  if (style === "monthShort") return MONTH_NAMES[date.getUTCMonth()];
  if (style === "monthFull") return FULL_MONTH_NAMES[date.getUTCMonth()];
  if (style === "dayOfMonth") return String(date.getUTCDate());
  switch (unit) {
    case "hour":
      return `${String(date.getUTCHours()).padStart(2, "0")}:00`;
    case "day":
      return String(date.getUTCDate());
    case "week":
      return `${date.getUTCDate()} ${MONTH_NAMES[date.getUTCMonth()]}`;
    case "month":
      return MONTH_NAMES[date.getUTCMonth()];
    case "quarter":
      return `Q${Math.floor(date.getUTCMonth() / 3) + 1}`;
    case "year":
    case "decade":
    case "century":
      return String(date.getUTCFullYear());
  }
}

function ticksForUnit(scale: TimeScale, widthPx: number, unit: Unit, style: LabelStyle): Tick[] {
  const ticks: Tick[] = [];
  let cursor = floorToUnit(xToMs(scale, 0), unit);
  const endMs = xToMs(scale, widthPx);
  // Hard cap keeps a bad unit choice from generating thousands of ticks.
  while (cursor.getTime() < endMs && ticks.length < 500) {
    ticks.push({ ms: cursor.getTime(), label: labelFor(cursor, unit, style) });
    cursor = nextUnit(cursor, unit);
  }
  return ticks;
}

const MIN_FINE_SPACING_PX = 45;

const DAY = 86_400_000;
const MONTH_MS = 30.44 * DAY;
const TWO_WEEKS_MS = 14 * DAY;
const TWO_MONTHS_MS = 62 * DAY;
const SIX_QUARTERS_MS = 18 * MONTH_MS;
const FIVE_YEARS_MS = 5 * 365.25 * DAY;

// A month tick spells itself out as the zoom gives it room: "A" → "Apr" →
// "April". Thresholds are the width of the longest label in each style plus
// breathing room, at the 11px the fine row is painted in.
const SHORT_MONTH_MIN_PX = 34;
const FULL_MONTH_MIN_PX = 72;

function monthLabelStyle(pxPerMonth: number): LabelStyle {
  if (pxPerMonth >= FULL_MONTH_MIN_PX) return "monthFull";
  if (pxPerMonth >= SHORT_MONTH_MIN_PX) return "monthShort";
  return "monthInitial";
}

interface UnitChoice {
  fine: Unit;
  fineStyle: LabelStyle;
  coarse: Unit;
  coarseStyle: LabelStyle;
}

// Chosen from the span actually on screen, not from pixel density alone.
//
// Below five years the ladder is fixed, because density alone used to pair a
// decade title with quarter subtitles — "Q1" with nothing anywhere on the axis
// saying which year's Q1. The coarse unit is now always exactly one meaningful
// step above the fine one, which makes that pairing unreachable.
function pickUnits(scale: TimeScale, widthPx: number): UnitChoice {
  const spanMs = widthPx * scale.msPerPx;

  if (spanMs <= TWO_WEEKS_MS) {
    return { fine: "day", fineStyle: "dayOfMonth", coarse: "month", coarseStyle: "monthYear" };
  }
  if (spanMs <= TWO_MONTHS_MS) {
    // Week ticks labelled by the date they start on: "6", "13", "20".
    return { fine: "week", fineStyle: "dayOfMonth", coarse: "month", coarseStyle: "monthYear" };
  }
  if (spanMs <= SIX_QUARTERS_MS) {
    return {
      fine: "month",
      fineStyle: monthLabelStyle(widthPx / (spanMs / MONTH_MS)),
      coarse: "year",
      coarseStyle: "default",
    };
  }
  if (spanMs < FIVE_YEARS_MS) {
    return { fine: "quarter", fineStyle: "default", coarse: "year", coarseStyle: "default" };
  }

  // Above five years, density picks the fine unit and the coarse one is the
  // very next step up — never two, which is where the old bug came from.
  for (let i = 0; i < UNITS.length; i++) {
    if (UNITS[i].approxMs / scale.msPerPx >= MIN_FINE_SPACING_PX) {
      const coarseIndex = Math.min(i + 1, UNITS.length - 1);
      return {
        fine: UNITS[i].unit,
        fineStyle: "default",
        coarse: UNITS[coarseIndex].unit,
        coarseStyle: "default",
      };
    }
  }
  return { fine: "century", fineStyle: "default", coarse: "century", coarseStyle: "default" };
}

export function computeTicks(scale: TimeScale, widthPx: number): { fine: Tick[]; coarse: Tick[] } {
  const { fine, fineStyle, coarse, coarseStyle } = pickUnits(scale, widthPx);
  let fineTicks = ticksForUnit(scale, widthPx, fine, fineStyle);
  let coarseTicks = ticksForUnit(scale, widthPx, coarse, coarseStyle);
  // A period wider than the viewport still needs its label visible: fall back
  // to the period containing the left edge so neither level is ever blank.
  // (The renderer pins an off-screen-left coarse label to the edge for the same
  // reason — a title you cannot see is the same as no title.)
  if (coarseTicks.length === 0) {
    const containing = floorToUnit(xToMs(scale, 0), coarse);
    coarseTicks = [{ ms: containing.getTime(), label: labelFor(containing, coarse, coarseStyle) }];
  }
  if (fineTicks.length === 0) {
    const containing = floorToUnit(xToMs(scale, 0), fine);
    fineTicks = [{ ms: containing.getTime(), label: labelFor(containing, fine, fineStyle) }];
  }
  return { fine: fineTicks, coarse: coarseTicks };
}

// "Pick on timeline" (§6): the clicked date snaps to a unit appropriate for
// the zoom level, and that unit also determines the committed precision.
export function snapForScale(
  scale: TimeScale,
  ms: number,
  widthPx: number,
): { ms: number; precision: Precision } {
  const { fine } = pickUnits(scale, widthPx);
  const snapped = floorToUnit(ms, fine);
  switch (fine) {
    case "hour":
      return { ms: snapped.getTime(), precision: "exact" };
    case "day":
    case "week":
      return { ms: floorToUnit(ms, "day").getTime(), precision: "day" };
    case "month":
    case "quarter":
      return { ms: floorToUnit(ms, "month").getTime(), precision: "month" };
    default:
      return { ms: floorToUnit(ms, "year").getTime(), precision: "year" };
  }
}

export function tickX(scale: TimeScale, tick: Tick): number {
  return msToX(scale, tick.ms);
}
