// The six things people actually add to a life timeline. This is not the
// removed `Category` model concept coming back — nothing is stored on the
// entry. A category only picks the wording of the name question, the tappable
// suggestions, and (when a new timeline has to be created) its icon.

import type { TimelineRow } from "../model/types";

export interface EntryCategory {
  key: string;
  icon: string;
  label: string; // on the chip
  description: string; // the small second line on the chip
  nameQuestion: string;
  suggestions: string[];
  newRowLabel: string; // the timeline created when none matches
}

export const ENTRY_CATEGORIES: EntryCategory[] = [
  {
    key: "place",
    icon: "🏠",
    label: "A place I lived",
    description: "city, flat, neighbourhood",
    nameQuestion: "Where did you live?",
    suggestions: ["Barcelona", "Amsterdam", "Back home"],
    newRowLabel: "Places lived",
  },
  {
    key: "work",
    icon: "💼",
    label: "A job or school",
    description: "roles, studies, projects",
    nameQuestion: "What was the job?",
    suggestions: ["New role", "Freelance", "Sabbatical"],
    newRowLabel: "Work",
  },
  {
    key: "people",
    icon: "❤️",
    label: "A person",
    description: "friends, partners, family",
    nameQuestion: "Who are they?",
    suggestions: ["Partner", "Flatmate", "Mentor"],
    newRowLabel: "People",
  },
  {
    key: "trip",
    icon: "✈️",
    label: "A trip",
    description: "travels big and small",
    nameQuestion: "Where did you go?",
    suggestions: ["Japan", "Interrail", "Road trip"],
    newRowLabel: "Trips",
  },
  {
    key: "hobby",
    icon: "🧗",
    label: "A hobby",
    description: "sports, music, crafts",
    nameQuestion: "What did you pick up?",
    suggestions: ["Running", "Piano", "Pottery"],
    newRowLabel: "Hobbies",
  },
  {
    key: "other",
    icon: "✨",
    label: "Something else",
    description: "anything with a when",
    nameQuestion: "Give it a name",
    suggestions: ["Got a dog", "The band years", "Van life"],
    newRowLabel: "Life",
  },
];

// Which of the user's own timelines this category could belong on. The icon is
// the only link — a row created by this assistant carries its category's icon —
// so the match is a hint, never a guess the user can't see: exactly one match
// is used silently, anything else is asked about.
export function rowsForCategory(ownRows: TimelineRow[], category: EntryCategory): TimelineRow[] {
  return ownRows.filter((row) => row.icon === category.icon);
}
