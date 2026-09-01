// The starting menu for "add a timeline": kinds of timeline people actually
// keep, each with an icon so the picture is coloured in before a single entry
// exists.
//
// These are names and icons only — no domain knowledge about the WORLD
// (prefilling "Harry Potter came out in 1997" belongs in public-data/, which
// keeps the no-backend promise, and is still not here). `minAgeHint` is the
// one exception: not world knowledge, just a rough sense of when a kind of
// timeline tends to start mattering in a life, used only to reorder — see
// `suggestionsForAge`.

export interface TimelineSuggestion {
  label: string;
  icon: string;
  // What one row of this timeline is, used as the table's placeholder.
  itemNoun: string;
  // Roughly the age a timeline like this tends to start. Absent means
  // "always about equally relevant" — it never sorts to the very back.
  minAgeHint?: number;
}

export const TIMELINE_SUGGESTIONS: TimelineSuggestion[] = [
  { label: "Places I lived", icon: "🏠", itemNoun: "Place" },
  { label: "Schools I went to", icon: "🎓", itemNoun: "School", minAgeHint: 5 },
  { label: "Jobs", icon: "💼", itemNoun: "Job", minAgeHint: 18 },
  { label: "Bands I played in", icon: "🎸", itemNoun: "Band" },
  { label: "Cars I drove", icon: "🚗", itemNoun: "Car", minAgeHint: 17 },
  { label: "Books I read", icon: "📚", itemNoun: "Book" },
  { label: "Shows I watched", icon: "📺", itemNoun: "Show" },
  { label: "Relationships", icon: "❤️", itemNoun: "Person", minAgeHint: 14 },
  { label: "Habits", icon: "🔁", itemNoun: "Habit" },
  { label: "Competitions", icon: "🏅", itemNoun: "Competition" },
];

// What to call one entry on a timeline the user named themselves.
export const DEFAULT_ITEM_NOUN = "Entry";

export function suggestionFor(label: string): TimelineSuggestion | undefined {
  return TIMELINE_SUGGESTIONS.find((candidate) => candidate.label === label);
}

// Once the group (or the timeline itself) a new timeline is being added to
// has a birth date, age-appropriate suggestions surface first — a toddler's
// picker leads with "Schools I went to", not "Jobs". Nothing is ever hidden,
// only reordered: a suggestion is a shortcut, not a rule, and "Bands I played
// in" might still be exactly right for a six-year-old prodigy.
export function suggestionsForAge(birthDateMs: number | undefined): TimelineSuggestion[] {
  if (birthDateMs === undefined) return TIMELINE_SUGGESTIONS;
  const ageYears = (Date.now() - birthDateMs) / (365.25 * 86_400_000);
  return [...TIMELINE_SUGGESTIONS].sort(
    (a, b) => distanceFromAge(a, ageYears) - distanceFromAge(b, ageYears),
  );
}

// A hinted suggestion the age has already reached ranks at the very front
// (distance 0); an ageless one sits just behind that (always in reach, never
// pushed to the back); a hinted one the age hasn't reached yet recedes the
// further off it still is.
function distanceFromAge(suggestion: TimelineSuggestion, ageYears: number): number {
  if (suggestion.minAgeHint === undefined) return 1;
  return ageYears >= suggestion.minAgeHint ? 0 : suggestion.minAgeHint - ageYears;
}
