// The date an assistant step is holding, before it becomes a FuzzyDate.
//
// Two independent questions, which the model's single `precision` field
// conflates and the mobile flow used to answer with one control:
//
//   * **granularity** — how much of the date you know: a year, a month, a day.
//   * **certainty** — how sure you are of it: exactly, around then, sometime
//     around.
//
// They are genuinely independent ("the 14th of May, give or take a week" is as
// real as "sometime in the nineties"), so the flow asks them separately and
// this module folds the pair back into the one `precision`/`fuzzDays` pair the
// model stores.

import { SHORT_MONTH_NAMES } from "../model/fuzzyDate";
import type { FuzzyDate, Precision } from "../model/types";

export type DateGranularity = "year" | "month" | "day";
export type DateCertainty = "exact" | "around" | "vague";

export interface DateAnswer {
  year: number;
  monthIndex: number; // 0–11; ignored at year granularity
  day: number; // 1–31, clamped to the month; ignored above day granularity
  granularity: DateGranularity;
}

export const MONTH_LABELS = SHORT_MONTH_NAMES;

// Coarse answers anchor mid-period, the same convention `parseDateInput` uses
// for typed dates: the fuzz band then brackets the whole period instead of
// hanging off the 1st of January.
const MID_YEAR_MONTH_INDEX = 6;
const MID_YEAR_DAY = 1;
const MID_MONTH_DAY = 15;

// How the two axes fold into what the model stores.
//
// At year granularity the vaguer answers become `circa`, because that is what
// that precision *means* — its default fuzz is a year, and the readout says
// "~2015", which is the answer given. Below that there is no coarser word for
// "roughly a Tuesday", so the certainty rides on `fuzzDays` and the date keeps
// saying which Tuesday. Each step out widens the window by about one more unit
// either side.
const FUZZ_DAYS: Record<DateGranularity, Record<DateCertainty, number | undefined>> = {
  // undefined = "whatever this precision already implies" (year → ±182 days,
  // month → ±15, day → none), which is exactly what "exactly" means here.
  year: { exact: undefined, around: undefined, vague: 730 },
  month: { exact: undefined, around: 45, vague: 120 },
  day: { exact: undefined, around: 7, vague: 30 },
};

const PRECISION: Record<DateGranularity, Record<DateCertainty, Precision>> = {
  year: { exact: "year", around: "circa", vague: "circa" },
  month: { exact: "month", around: "month", vague: "month" },
  day: { exact: "day", around: "day", vague: "day" },
};

export function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

// A day past the end of the chosen month is clamped rather than allowed to roll
// over: `Date.UTC(2015, 1, 30)` is the 2nd of March, which is not what anybody
// dragging a slider to 30 in February meant.
export function clampDay(year: number, monthIndex: number, day: number): number {
  return Math.min(Math.max(day, 1), daysInMonth(year, monthIndex));
}

export function answerFromMs(ms: number, granularity: DateGranularity = "year"): DateAnswer {
  const date = new Date(ms);
  return {
    year: date.getUTCFullYear(),
    monthIndex: date.getUTCMonth(),
    day: date.getUTCDate(),
    granularity,
  };
}

// The instant this answer stands on, mid-period anchoring included. Exported
// because "is the end before the start?" has to be asked about the anchored
// instants: a year answer sits in July, so a raw year/month/day comparison says
// "2014 is not before 20 Nov 2014" when after anchoring it plainly is.
export function answerMs(answer: DateAnswer): number {
  const { year, granularity } = answer;
  const monthIndex = granularity === "year" ? MID_YEAR_MONTH_INDEX : answer.monthIndex;
  const day =
    granularity === "day"
      ? clampDay(year, monthIndex, answer.day)
      : granularity === "month"
        ? MID_MONTH_DAY
        : MID_YEAR_DAY;
  return Date.UTC(year, monthIndex, day);
}

export function toFuzzyDate(answer: DateAnswer, certainty: DateCertainty): FuzzyDate {
  const fuzzDays = FUZZ_DAYS[answer.granularity][certainty];
  return {
    ms: answerMs(answer),
    precision: PRECISION[answer.granularity][certainty],
    ...(fuzzDays === undefined ? {} : { fuzzDays }),
  };
}

// "2014" · "May 2014" · "14 May 2014" — what the answer currently says, for the
// step's own readout. Not `formatByPrecision`: that reads the stored precision,
// which at year granularity has been turned into `circa` and would print "~2014"
// on top of a certainty chip already saying "around then".
export function formatAnswer(answer: DateAnswer): string {
  const { year, granularity } = answer;
  if (granularity === "year") return String(year);
  const month = MONTH_LABELS[answer.monthIndex];
  if (granularity === "month") return `${month} ${year}`;
  return `${clampDay(year, answer.monthIndex, answer.day)} ${month} ${year}`;
}
