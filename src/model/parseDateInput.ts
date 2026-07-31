// Typing a date, as an alternative to dragging a handle. The whole point is
// that **the precision of what you typed becomes the field's precision**: a
// bare "2016" means year, "Aug 2016" means month. That is the feature, not a
// fallback — it is how precision stops being an invisible property.
//
// Everything here is UTC (CLAUDE.md: UTC everywhere). No local-time method may
// appear in this file.

import type { Precision } from "./types";

// Coarse inputs anchor mid-period, so the fuzz band brackets the whole period
// rather than hanging off one end of it.
const MID_MONTH_DAY = 15;
const MID_YEAR_MONTH_INDEX = 6; // July
const MID_YEAR_DAY = 1;

const MONTH_NAMES = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

// Shown verbatim when nothing matches — the user must never be left guessing
// what this field will accept.
export const ACCEPTED_DATE_FORMATS_HINT = "Try 2016, Aug 2016, 2016-08, 6.8.2016 — or “now”.";

export type ParsedDateInput =
  | { kind: "date"; ms: number; precision: Precision }
  | { kind: "ongoing" }
  | { kind: "error"; message: string };

function monthIndexFromName(name: string): number | null {
  const lower = name.toLowerCase();
  const index = MONTH_NAMES.findIndex((month) => month.startsWith(lower) && lower.length >= 3);
  return index === -1 ? null : index;
}

// Guards against Date.UTC silently rolling 2016-13-45 over into the next year.
function utcDate(year: number, monthIndex: number, day: number): number | null {
  if (monthIndex < 0 || monthIndex > 11 || day < 1 || day > 31) return null;
  const ms = Date.UTC(year, monthIndex, day);
  const rolled = new Date(ms);
  if (rolled.getUTCMonth() !== monthIndex || rolled.getUTCDate() !== day) return null;
  return ms;
}

export function parseDateInput(text: string): ParsedDateInput {
  const trimmed = text.trim();
  if (trimmed === "") return { kind: "error", message: ACCEPTED_DATE_FORMATS_HINT };

  if (/^(now|ongoing|present)$/i.test(trimmed)) return { kind: "ongoing" };

  // "~2016" and "ca. 2016" say the year is approximate — which is exactly what
  // circa precision means, so the prefix sets it rather than being discarded.
  const circaMatch = /^(?:~|ca\.?\s*|around\s+|about\s+)(.+)$/i.exec(trimmed);
  if (circaMatch) {
    const inner = parseDateInput(circaMatch[1]);
    return inner.kind === "date" ? { ...inner, precision: "circa" } : inner;
  }

  const rules: [RegExp, (groups: string[]) => ParsedDateInput | null][] = [
    // 2016-08-06
    [/^(\d{4})-(\d{1,2})-(\d{1,2})$/, ([y, m, d]) => dateResult(+y, +m - 1, +d, "day")],
    // 6.8.2016 — day-first, the order the rest of the app defaults to.
    [/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/, ([d, m, y]) => dateResult(+y, +m - 1, +d, "day")],
    // 6 Aug 2016 / 6 August 2016
    [/^(\d{1,2})\.?\s+([a-z]+)\.?\s+(\d{4})$/i, ([d, name, y]) => namedResult(+y, name, +d, "day")],
    // Aug 6, 2016
    [/^([a-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/i, ([name, d, y]) => namedResult(+y, name, +d, "day")],
    // 2016-08
    [/^(\d{4})-(\d{1,2})$/, ([y, m]) => dateResult(+y, +m - 1, MID_MONTH_DAY, "month")],
    // 08/2016 and 8.2016
    [/^(\d{1,2})[/.](\d{4})$/, ([m, y]) => dateResult(+y, +m - 1, MID_MONTH_DAY, "month")],
    // Aug 2016 / August 2016
    [/^([a-z]+)\.?\s+(\d{4})$/i, ([name, y]) => namedResult(+y, name, MID_MONTH_DAY, "month")],
    // 2016
    [/^(\d{4})$/, ([y]) => dateResult(+y, MID_YEAR_MONTH_INDEX, MID_YEAR_DAY, "year")],
  ];

  for (const [pattern, build] of rules) {
    const match = pattern.exec(trimmed);
    if (!match) continue;
    const result = build(match.slice(1));
    if (result) return result;
  }
  return { kind: "error", message: ACCEPTED_DATE_FORMATS_HINT };
}

function dateResult(year: number, monthIndex: number, day: number, precision: Precision): ParsedDateInput | null {
  const ms = utcDate(year, monthIndex, day);
  return ms === null ? null : { kind: "date", ms, precision };
}

function namedResult(year: number, monthName: string, day: number, precision: Precision): ParsedDateInput | null {
  const monthIndex = monthIndexFromName(monthName);
  return monthIndex === null ? null : dateResult(year, monthIndex, day, precision);
}
