// The birth screen's arithmetic: a year, and optionally a month for people
// whose birthday is still to come this year. The slider is the *year* age
// (this year minus the birth year) — what you'd answer to "how old do you turn
// this year?" — and the month only decides whether you are that age yet.
// UTC throughout, like every stored instant.

export const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const MAX_AGE = 100;
// Where the slider sits before anyone touches it. Never stored on its own:
// the birth screen only writes once it was moved or confirmed.
export const DEFAULT_AGE = 30;

const YEAR_MS = 365.2425 * 86_400_000;

export interface BirthAnswer {
  year: number;
  month: number | null; // 0-based; null = only the year is known
}

export function yearAge(birthYear: number, nowMs: number): number {
  return new Date(nowMs).getUTCFullYear() - birthYear;
}

// The age today. Only a month later than the current one makes it a year
// less; in the birthday month itself we can't tell without the day, so it
// stays at the year age and the note says "N-1 or N".
export function exactAge(answer: BirthAnswer, nowMs: number): number {
  const age = yearAge(answer.year, nowMs);
  if (answer.month !== null && answer.month > new Date(nowMs).getUTCMonth()) return Math.max(0, age - 1);
  return age;
}

// Years from the start of the birth year to now, with the fraction — the
// width of a strip whose right edge is "now", not "the 1st of January".
export function ageSpan(birthYear: number, nowMs: number): number {
  return Math.max(1 / 12, (nowMs - Date.UTC(birthYear, 0, 1)) / YEAR_MS);
}

export function birthDateMs(answer: BirthAnswer): number {
  return Date.UTC(answer.year, answer.month ?? 0, 1);
}

// `Group.birthDate` has no precision, so a year-only answer is stored as the
// 1st of January and reads back as year-only.
export function birthAnswerFromMs(ms: number): BirthAnswer {
  const date = new Date(ms);
  const month = date.getUTCMonth();
  const yearOnly = month === 0 && date.getUTCDate() === 1;
  return { year: date.getUTCFullYear(), month: yearOnly ? null : month };
}

// What to store for an answer. A date that already says the same year and
// month (say, a full birthday set in the group's settings) is kept as it is:
// answering "1986, May" must not wipe out the 14th.
export function birthDateToStore(answer: BirthAnswer, previousMs: number | undefined): number {
  if (previousMs !== undefined) {
    const previous = birthAnswerFromMs(previousMs);
    const sameMonth = answer.month === null ? previous.month === null : previous.month === answer.month;
    if (previous.year === answer.year && sameMonth) return previousMs;
  }
  return birthDateMs(answer);
}

export function clampBirthYear(year: number, nowMs: number): number {
  const thisYear = new Date(nowMs).getUTCFullYear();
  return Math.min(thisYear, Math.max(thisYear - MAX_AGE, year));
}

export function monthNote(answer: BirthAnswer, nowMs: number): string {
  if (answer.month === null) return "Pick the month, or leave it.";
  const age = yearAge(answer.year, nowMs);
  const nowMonth = new Date(nowMs).getUTCMonth();
  const name = MONTH_NAMES[answer.month];
  if (answer.month === nowMonth) return `Birthday this month: ${Math.max(0, age - 1)} or ${age} until then.`;
  if (answer.month > nowMonth) return `Turns ${age} in ${name}.`;
  return `Turned ${age} in ${name}.`;
}
