// Search & filter share one treatment: matches stay opaque, everything else
// dims — non-matches never disappear, so temporal context stays legible (§6).

import { ancestorGroups } from "../model/dataset";
import type { TimelineDataset, TimelineEntry, TimelineEvent } from "../model/types";
import type { Filters } from "./store";

export function hasActiveFilters(search: string, filters: Filters): boolean {
  return (
    search.trim() !== "" ||
    filters.groupIds.length > 0 ||
    filters.timeRange !== undefined
  );
}

// Whether a row passes the group and (for a single instant) the time filter.
// Shared by entries and events so a filter can never mean two different things
// on one screen.
function rowPasses(
  dataset: TimelineDataset,
  filters: Filters,
  rowId: string,
): boolean {
  if (filters.groupIds.length === 0) return true;
  const row = dataset.rows.find((candidate) => candidate.id === rowId);
  const group = row?.groupId === undefined ? undefined : dataset.groups.find((candidate) => candidate.id === row.groupId);
  // A filter on "Family" must also keep the timelines of everyone nested
  // inside it, at any depth — so a row matches on its own group or on any of
  // that group's ancestors.
  if (group === undefined) return false;
  if (filters.groupIds.includes(group.id)) return true;
  return ancestorGroups(dataset, group.id).some((ancestor) => filters.groupIds.includes(ancestor.id));
}

// Returns null when nothing filters (no dimming at all), otherwise the set of
// entry ids to keep emphasized.
export function computeEmphasis(
  dataset: TimelineDataset,
  search: string,
  filters: Filters,
): Set<string> | null {
  if (!hasActiveFilters(search, filters)) return null;
  const query = search.trim().toLowerCase();

  const matches = (entry: TimelineEntry): boolean => {
    if (query !== "") {
      const inTitle = entry.title.toLowerCase().includes(query);
      const inDescription = entry.description?.toLowerCase().includes(query) ?? false;
      const inSubtitle = entry.subtitle?.toLowerCase().includes(query) ?? false;
      const inPlace = entry.place?.fullName.toLowerCase().includes(query) ?? false;
      if (!inTitle && !inDescription && !inSubtitle && !inPlace) return false;
    }
    if (!rowPasses(dataset, filters, entry.rowId)) return false;
    if (filters.timeRange) {
      const endMs = entry.end?.ms ?? Number.POSITIVE_INFINITY;
      if (endMs < filters.timeRange.startMs || entry.start.ms > filters.timeRange.endMs) return false;
    }
    return true;
  };

  return new Set(dataset.entries.filter(matches).map((entry) => entry.id));
}

// The same treatment for events. A separate pass rather than one mixed set:
// an event has one date instead of a range and no subtitle to search, and the
// engine looks the two up in different loops anyway.
export function computeEventEmphasis(
  dataset: TimelineDataset,
  search: string,
  filters: Filters,
): Set<string> | null {
  if (!hasActiveFilters(search, filters)) return null;
  const query = search.trim().toLowerCase();

  const matches = (event: TimelineEvent): boolean => {
    if (query !== "") {
      const inTitle = event.title.toLowerCase().includes(query);
      const inDescription = event.description?.toLowerCase().includes(query) ?? false;
      const inPlace = event.place?.fullName.toLowerCase().includes(query) ?? false;
      if (!inTitle && !inDescription && !inPlace) return false;
    }
    if (!rowPasses(dataset, filters, event.rowId)) return false;
    // A moment is inside the window or it is not — there is no overlap to
    // reason about, which is the whole difference from an entry.
    if (filters.timeRange) {
      if (event.date.ms < filters.timeRange.startMs || event.date.ms > filters.timeRange.endMs) return false;
    }
    return true;
  };

  return new Set(dataset.events.filter(matches).map((event) => event.id));
}
