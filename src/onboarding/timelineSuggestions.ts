// The starting menu for "add a timeline": kinds of timeline people actually
// keep, each with an icon so the picture is coloured in before a single entry
// exists.
//
// These are names and icons only — no domain knowledge. Prefilling "Harry
// Potter came out in 1997" or "you probably got your licence at 18" is the
// point of the feature and is deliberately not here yet; when it comes it
// belongs in public-data/, which keeps the no-backend promise.

export interface TimelineSuggestion {
  label: string;
  icon: string;
  // What one row of this timeline is, used as the table's placeholder.
  itemNoun: string;
}

export const TIMELINE_SUGGESTIONS: TimelineSuggestion[] = [
  { label: "Places I lived", icon: "🏠", itemNoun: "Place" },
  { label: "Schools I went to", icon: "🎓", itemNoun: "School" },
  { label: "Jobs", icon: "💼", itemNoun: "Job" },
  { label: "Bands I played in", icon: "🎸", itemNoun: "Band" },
  { label: "Cars I drove", icon: "🚗", itemNoun: "Car" },
  { label: "Books I read", icon: "📚", itemNoun: "Book" },
  { label: "Shows I watched", icon: "📺", itemNoun: "Show" },
  { label: "Relationships", icon: "❤️", itemNoun: "Person" },
  { label: "Habits", icon: "🔁", itemNoun: "Habit" },
  { label: "Competitions", icon: "🏅", itemNoun: "Competition" },
];

// What to call one entry on a timeline the user named themselves.
export const DEFAULT_ITEM_NOUN = "Entry";

export function suggestionFor(label: string): TimelineSuggestion | undefined {
  return TIMELINE_SUGGESTIONS.find((candidate) => candidate.label === label);
}
