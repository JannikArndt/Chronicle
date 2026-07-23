// Chronicle data model — see ENGINEERING_PROMPT.md §2.
//
// TIMEZONE CONVENTION (decided once, applies everywhere — picker, storage, renderer):
// all `ms` values are UTC instants, and calendar dates are interpreted/displayed in UTC.
// A date like "2020-05-14" always means 2020-05-14T00:00:00Z regardless of the
// viewer's local timezone, so a dataset renders identically on every device.

export const SCHEMA_VERSION = 2;

export type Precision = "exact" | "day" | "month" | "year" | "circa";

export interface FuzzyDate {
  ms: number; // reference instant (UTC)
  precision: Precision;
  fuzzDays?: number; // optional explicit override of the default fuzziness for this precision
}

export interface Category {
  id: string;
  label: string;
  color: string; // any CSS color — a native color picker, not a fixed palette
  icon: string; // any emoji — free-text input, plus a few quick-picks for convenience
  defaultVisibility: "private" | "shareable";
}

export interface Person {
  id: string;
  label: string;
  // ms, UTC. If set: time before this on any of their rows renders "inactive",
  // and their group/sub-group header shows a live computed age.
  birthDate?: number;
}

export interface Group {
  id: string;
  label: string;
  // If set, this ENTIRE group IS that person (e.g. "Me") — do not also nest a
  // person sub-header for it. If unset, the group may contain zero or more
  // person sub-groups (e.g. "Family" -> "Finn"), each of which is the future
  // attachment point for importing/subscribing to someone else's shared "Me"
  // timeline export (ENGINEERING_PROMPT.md §7).
  personId?: string;
  collapsed: boolean;
}

export interface TimelineRow {
  id: string;
  groupId: string;
  // Set when this row belongs to a person nested inside a personId-less group
  // (e.g. Finn's "Residence" row inside "Family"). Unset when the row belongs
  // directly to a personId group (that group's personId applies).
  personId?: string;
  categoryId: string;
  label: string;
  parentRowId?: string; // set for a sub-timeline (e.g. "Projects at Kestrel" under "Job")
}

export interface Entity {
  id: string;
  kind: "person" | "place" | "organization" | "object" | "other";
  label: string; // for kind "place", this is the short display title (street+number+city, or just city)
  // Only ever set when kind === "place".
  place?: {
    fullName: string; // the complete address/name as returned by the source (or as typed, if free-text)
    coordinates?: { lat: number; lon: number }; // absent for free-text entries with no picked suggestion
    street?: string; // e.g. "Hauptstraße 12" (house_number + road combined) — undefined if not resolvable
    city?: string;
    country?: string;
    subtitle?: string; // secondary context line, e.g. the city when the title is a street; state/country when the title is a city
  };
}

export interface TimelineEntry {
  id: string;
  rowId: string;
  title: string;
  description?: string;
  start: FuzzyDate;
  end?: FuzzyDate; // absent = ongoing, renders as an open arrow, not a hard stop
  fadeInDays?: number; // gradual start (e.g. "grew into" a relationship) — visually
  fadeOutDays?: number; // distinct from precision fuzziness, but combined into one continuous edge (§5)
  parentEntryId?: string; // links a sub-timeline entry to the parent entry it nests under
  linkedEntityIds: string[];
  visibility: "private" | "shareable";
}

export interface TimelineDataset {
  schemaVersion: number;
  people: Person[];
  groups: Group[];
  categories: Category[];
  rows: TimelineRow[];
  entities: Entity[];
  entries: TimelineEntry[];
  // The Person who is "you" — set once the identity onboarding step completes.
  // Unambiguous even though a Group.personId alone could belong to someone
  // else's solo group (e.g. a partner you've added).
  selfPersonId?: string;
}
