// Chronicle data model — see ENGINEERING_PROMPT.md §2.
//
// TIMEZONE CONVENTION (decided once, applies everywhere — picker, storage, renderer):
// all `ms` values are UTC instants, and calendar dates are interpreted/displayed in UTC.
// A date like "2020-05-14" always means 2020-05-14T00:00:00Z regardless of the
// viewer's local timezone, so a dataset renders identically on every device.

export const SCHEMA_VERSION = 10;

export type Precision = "exact" | "day" | "month" | "year" | "circa";

export interface FuzzyDate {
  ms: number; // reference instant (UTC)
  precision: Precision;
  fuzzDays?: number; // optional explicit override of the default fuzziness for this precision
}

// A group is a labelled bundle of sub-groups and timelines — and, when it has a
// birth date, also a person. There used to be a separate `Person` referenced by
// both Group and TimelineRow; a person turned out to be nothing but a group
// with an age, and the two-entity version cost an asymmetry ("a group either IS
// a person or CONTAINS persons, never both") that every consumer had to
// special-case.
export interface Group {
  id: string;
  // Groups nest arbitrarily deep: "Family" contains "Finn", which can contain
  // "Finn's kids". Undefined means top-level.
  parentGroupId?: string;
  label: string;
  color?: string; // any CSS color — accents this group's own header
  icon?: string; // any emoji, shown before the group's name — free-text input
  // ms, UTC. What makes a group a *person*. Time before it renders "inactive"
  // on this group's own timelines and those of its sub-groups, and the header
  // shows a live computed age. (A TimelineRow can independently carry its own
  // birthDate too — see there for why a person isn't only ever a group.)
  birthDate?: number;
  collapsed: boolean;
  // Where this group sits among its container's children (v10). Groups and
  // timelines share ONE ordering sequence per container, so the two can be
  // mixed in any order — before v10 the layout drew every row first and every
  // group after, which made "a group above a timeline" unreachable by drag.
  // Normalized to 0..n-1 per container by `normalizeChildOrder()`; a record
  // that arrives without one (an older export, a public dataset) sorts after
  // the ordered ones, which reproduces the pre-v10 picture exactly.
  order?: number;
  // --- sharing (v7) ---
  // Absent/false is private. NOT called `visibility`: v1–v3 had a field by that
  // name, v4 removed it, and old exports still carry it — a new field reusing
  // the name could be fed a three-versions-dead value. See plans/sharing-feature-design.md §D6.
  shared?: boolean;
  // The override: rows and sub-groups created under here start shared. Inherited
  // by sub-groups, so setting it on "My family" covers everyone inside it.
  shareByDefault?: boolean;
}

export interface TimelineRow {
  id: string;
  // The group this timeline sits directly in. Undefined means top-level — a
  // timeline needs no container at all.
  groupId?: string;
  color?: string; // any CSS color for this row's bars — a native color picker, not a fixed palette
  icon?: string; // any emoji, shown before the row label in the rail and inspector — free-text input
  label: string;
  // ms, UTC. A timeline can independently BE a person too — not every person
  // deserves a whole group of sub-groups and timelines; an acquaintance might
  // get exactly one timeline, with its own birth date, age badge and pre-birth
  // fade. If unset, birthDateForRow() falls back to the nearest ancestor
  // group's birthDate.
  birthDate?: number;
  // Where this timeline sits among its container's children (v10) — the same
  // single sequence a sibling Group is placed in. See Group.order.
  order?: number;
  // --- sharing (v7) ---
  // The publish switch for one timeline, and the finest granularity there is:
  // entries have no flag of their own, they follow their row.
  shared?: boolean;
}

export interface Place {
  fullName: string; // the complete address/name as returned by the source (or as typed, if free-text)
  coordinates?: { lat: number; lon: number }; // absent for free-text entries with no picked suggestion
  street?: string; // e.g. "Hauptstraße 12" (house_number + road combined) — undefined if not resolvable
  city?: string;
  country?: string;
}

export interface TimelineEntry {
  id: string;
  rowId: string;
  title: string;
  subtitle?: string;
  shortTitle?: string; // shown on the timeline bar in place of title when title doesn't fit
  website?: string; // used to fetch a favicon (§5), shown in front of the label
  place?: Place;
  description?: string;
  start: FuzzyDate;
  end?: FuzzyDate; // absent = ongoing, renders as an open arrow, not a hard stop
  fadeInDays?: number; // gradual start (e.g. "grew into" a relationship) — visually
  fadeOutDays?: number; // distinct from precision fuzziness, but combined into one continuous edge (§5)
  parentEntryId?: string; // links a sub-timeline entry to the parent entry it nests under
}

// A moment on a timeline: "first kiss", "finished the big project", "she was
// born". An entry is a span, an event is a point — that single difference is
// the whole reason this is its own entity rather than a zero-length entry:
// a bar with no width has no label anchor, no fade edges and no "ongoing", and
// every one of those would have had to grow an "unless it is a point" branch.
//
// Events belong to a row exactly the way entries do (`rowId`), follow their row
// when it is published, and are drawn only once the view is zoomed in far
// enough for a point in time to mean anything (src/render/events.ts).
export interface TimelineEvent {
  id: string;
  rowId: string;
  title: string;
  // One instant, with its precision — an event dated "1998" is drawn with a
  // year-wide fuzz band, not as a false pin on the 1st of July.
  date: FuzzyDate;
  icon?: string; // any emoji, drawn in front of the label — free-text input
  description?: string;
  place?: Place;
}

export interface TimelineDataset {
  schemaVersion: number;
  groups: Group[];
  rows: TimelineRow[];
  entries: TimelineEntry[];
  // Moments on those rows. Added in schema v8; an older export has no such
  // array, and the importer fills one in rather than rejecting the file.
  events: TimelineEvent[];
  // The group that is "you" — set once the identity onboarding step completes.
  // Needed because a birth date alone doesn't say *whose*: a partner you added
  // has one too.
  selfGroupId?: string;
  // --- sharing (v7) ---
  // The signed-in account this dataset belongs to. An opaque uuid, never an
  // email: the dataset is the thing users export and pass around, so no
  // identity — theirs or anyone else's — is allowed to live in it. Grants,
  // co-owners and invites are server-side only.
  accountId?: string;
}
