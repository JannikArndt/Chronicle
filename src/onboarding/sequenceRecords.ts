// Between a timeline's entries and the first-run editor's sequence, both ways.
//
// Each topic screen edits a draft and only writes on Next (or Skip): it loads
// its draft from the row's entries, and `planSequenceEntries` reconciles the
// draft back — create what is new, update what changed, delete what was
// removed. Draft items remember the entry they came from, so going Back to a
// screen that was already committed, or replaying the whole assistant, edits
// those entries in place instead of adding a second copy. That is what lets
// Back cross a commit boundary in this assistant.
//
// Only what the editor can show is touched: a start or end whose *year* did
// not change keeps its stored date and precision, so a month refined later on
// the canvas survives a replay.

import { clampSequence, itemName, newItemKey } from "./sequence";
import type { Sequence, SequenceItem, SequenceRules } from "./sequence";
import type { FuzzyDate, Place, TimelineEntry } from "../model/types";

const yearOf = (ms: number) => new Date(ms).getUTCFullYear();

export type SequenceLoad =
  | { ok: true; sequence: Sequence }
  // "overlap": two entries share time, which a one-after-another editor can't
  // say. "unrepresentable": starts in the same year, an entry shorter than a
  // year before a gap, or something outside birth…now.
  | { ok: false; reason: "overlap" | "unrepresentable" };

export interface LoadOptions {
  birthYear: number;
  age: number; // year age: this year − birth year
  rules: SequenceRules;
  withPlace: boolean;
}

export function loadSequence(entries: TimelineEntry[], options: LoadOptions): SequenceLoad {
  const { birthYear, age, rules, withPlace } = options;
  const sorted = [...entries].sort((a, b) => a.start.ms - b.start.ms);
  if (sorted.length === 0) return { ok: true, sequence: { items: [], end: null } };

  for (let i = 0; i + 1 < sorted.length; i++) {
    const end = sorted[i].end;
    if (end === undefined || end.ms > sorted[i + 1].start.ms) return { ok: false, reason: "overlap" };
  }

  const items: SequenceItem[] = [];
  let end: number | null = null;
  sorted.forEach((entry, index) => {
    items.push({
      key: newItemKey(),
      label: entry.title,
      fallback: entry.title,
      at: yearOf(entry.start.ms) - birthYear,
      gap: false,
      entryId: entry.id,
      place: withPlace ? { title: entry.title, subtitle: entry.subtitle, details: entry.place } : undefined,
    });
    if (entry.end === undefined) return;
    const endAt = yearOf(entry.end.ms) - birthYear;
    const next = sorted[index + 1];
    if (next === undefined) end = endAt;
    else if (endAt < yearOf(next.start.ms) - birthYear) {
      // A hole between two entries is a gap: it holds the time and is not saved.
      items.push({ key: newItemKey(), label: "", fallback: "", at: endAt, gap: true });
    }
  });

  // Places begin at birth by definition, so the first one may sit anywhere;
  // everything else has to fit the editor exactly or it is not shown at all.
  const checked = rules.freeStart ? items : items.slice(1);
  if (checked.some((item) => item.at < 0 || item.at > age)) return { ok: false, reason: "unrepresentable" };
  for (let i = 1; i < items.length; i++) {
    if (items[i].at <= items[i - 1].at) return { ok: false, reason: "unrepresentable" };
  }
  if (end !== null && (end <= items[items.length - 1].at || end > age)) return { ok: false, reason: "unrepresentable" };

  return { ok: true, sequence: clampSequence({ items, end: rules.endable ? end : null }, rules, age) };
}

export interface EntryPlan {
  creates: Array<Omit<TimelineEntry, "id" | "rowId">>;
  updates: Array<{ id: string; patch: Partial<TimelineEntry> }>;
  deletes: string[];
}

export function isEmptyPlan(plan: EntryPlan): boolean {
  return plan.creates.length === 0 && plan.updates.length === 0 && plan.deletes.length === 0;
}

function yearDate(year: number, existing: FuzzyDate | undefined): FuzzyDate {
  if (existing && yearOf(existing.ms) === year) return existing;
  return { ms: Date.UTC(year, 0, 1), precision: "year" };
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

// What a place item saves: the picked details while the name still matches
// them, otherwise the name as typed — the same rule the old places table had.
function placeFields(item: SequenceItem, title: string): { subtitle?: string; place?: Place } {
  if (item.place && item.place.title === title) {
    return { subtitle: item.place.subtitle, place: item.place.details };
  }
  return { subtitle: undefined, place: { fullName: title } };
}

export function planSequenceEntries(
  sequence: Sequence,
  entries: TimelineEntry[],
  birthYear: number,
  withPlace: boolean,
): EntryPlan {
  const plan: EntryPlan = { creates: [], updates: [], deletes: [] };
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const kept = new Set<string>();

  sequence.items.forEach((item, index) => {
    if (item.gap) return;
    const next = sequence.items[index + 1];
    const endAt = next ? next.at : sequence.end;
    const existing = item.entryId ? byId.get(item.entryId) : undefined;
    const title = itemName(item);
    const start = yearDate(birthYear + item.at, existing?.start);
    const end = endAt === null ? undefined : yearDate(birthYear + endAt, existing?.end);
    const placed = withPlace ? placeFields(item, title) : {};

    if (!existing) {
      plan.creates.push({ title, start, end, ...placed });
      return;
    }
    kept.add(existing.id);
    const patch: Partial<TimelineEntry> = {};
    if (existing.title !== title) patch.title = title;
    if (!sameJson(existing.start, start)) patch.start = start;
    if (!sameJson(existing.end, end)) patch.end = end;
    if (withPlace) {
      if ((existing.subtitle ?? undefined) !== placed.subtitle) patch.subtitle = placed.subtitle;
      if (!sameJson(existing.place, placed.place)) patch.place = placed.place;
    }
    if (Object.keys(patch).length > 0) plan.updates.push({ id: existing.id, patch });
  });

  entries.forEach((entry) => {
    if (!kept.has(entry.id)) plan.deletes.push(entry.id);
  });
  return plan;
}
