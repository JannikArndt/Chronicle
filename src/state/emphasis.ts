// Search & filter share one treatment: matches stay opaque, everything else
// dims — non-matches never disappear, so temporal context stays legible (§6).

import type { TimelineDataset, TimelineEntry } from "../model/types";
import type { Filters } from "./store";

export function hasActiveFilters(search: string, filters: Filters): boolean {
  return (
    search.trim() !== "" ||
    filters.categoryIds.length > 0 ||
    filters.personIds.length > 0 ||
    filters.timeRange !== undefined
  );
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
  const rowById = new Map(dataset.rows.map((r) => [r.id, r]));
  const groupById = new Map(dataset.groups.map((g) => [g.id, g]));

  const matches = (entry: TimelineEntry): boolean => {
    if (query !== "") {
      const inTitle = entry.title.toLowerCase().includes(query);
      const inDescription = entry.description?.toLowerCase().includes(query) ?? false;
      const inSubtitle = entry.subtitle?.toLowerCase().includes(query) ?? false;
      const inPlace = entry.place?.fullName.toLowerCase().includes(query) ?? false;
      if (!inTitle && !inDescription && !inSubtitle && !inPlace) return false;
    }
    const row = rowById.get(entry.rowId);
    if (filters.categoryIds.length > 0 && (!row || !filters.categoryIds.includes(row.categoryId))) {
      return false;
    }
    if (filters.personIds.length > 0) {
      const personId = row?.personId ?? (row ? groupById.get(row.groupId)?.personId : undefined);
      if (!personId || !filters.personIds.includes(personId)) return false;
    }
    if (filters.timeRange) {
      const endMs = entry.end?.ms ?? Number.POSITIVE_INFINITY;
      if (endMs < filters.timeRange.startMs || entry.start.ms > filters.timeRange.endMs) return false;
    }
    return true;
  };

  return new Set(dataset.entries.filter(matches).map((entry) => entry.id));
}
