import { describe, expect, test } from "vitest";
import { TIMELINE_SUGGESTIONS, suggestionsForAge } from "./timelineSuggestions";

const YEAR_MS = 365.25 * 86_400_000;
const indexOf = (suggestions: typeof TIMELINE_SUGGESTIONS, label: string) =>
  suggestions.findIndex((s) => s.label === label);

describe("suggestionsForAge", () => {
  test("with no birth date, order is unchanged", () => {
    expect(suggestionsForAge(undefined)).toEqual(TIMELINE_SUGGESTIONS);
  });

  test("every suggestion is still present, only reordered", () => {
    const reordered = suggestionsForAge(Date.now() - 10 * YEAR_MS);
    expect(reordered).toHaveLength(TIMELINE_SUGGESTIONS.length);
    expect(reordered.map((s) => s.label).sort()).toEqual(TIMELINE_SUGGESTIONS.map((s) => s.label).sort());
  });

  test("a toddler's suggestions do not lead with 'Jobs'", () => {
    const toddler = suggestionsForAge(Date.now() - 2 * YEAR_MS);
    expect(toddler[0].label).not.toBe("Jobs");
  });

  test("a toddler ranks 'Schools I went to' ahead of 'Jobs'", () => {
    const toddler = suggestionsForAge(Date.now() - 2 * YEAR_MS);
    expect(indexOf(toddler, "Schools I went to")).toBeLessThan(indexOf(toddler, "Jobs"));
  });

  test("'Jobs' ranks earlier for an adult than for a toddler", () => {
    const toddlerJobsIndex = indexOf(suggestionsForAge(Date.now() - 2 * YEAR_MS), "Jobs");
    const adultJobsIndex = indexOf(suggestionsForAge(Date.now() - 30 * YEAR_MS), "Jobs");
    expect(adultJobsIndex).toBeLessThan(toddlerJobsIndex);
  });

  test("once every hint is behind an adult, all hinted suggestions outrank the ageless ones", () => {
    // Every hint in the list is under 40, so a 40-year-old has "arrived" at
    // all of them — they should all lead, ahead of every ageless suggestion.
    const adult = suggestionsForAge(Date.now() - 40 * YEAR_MS);
    const lastHintedIndex = Math.max(...adult.map((s, i) => (s.minAgeHint !== undefined ? i : -1)));
    const firstAgelessIndex = adult.findIndex((s) => s.minAgeHint === undefined);
    expect(lastHintedIndex).toBeLessThan(firstAgelessIndex);
  });
});
