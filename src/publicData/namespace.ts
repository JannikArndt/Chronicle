// Id namespacing for public datasets (ENGINEERING_PROMPT.md §4): contributors
// only keep ids unique within their own file; the loader prefixes every id and
// every id reference with `pub:<filename-without-ext>:` so independently
// authored files can't collide with each other or with private data.

import type { TimelineDataset } from "../model/types";

export function namespaceDataset(dataset: TimelineDataset, fileStem: string): TimelineDataset {
  return namespaceWithPrefix(dataset, `pub:${fileStem}:`);
}

// Same mechanism, arbitrary prefix. Mirrors of other people's shared timelines
// use `shared:<accountId>:` — owner-scoped because two people can each have a
// local id `group-abc-1`, and a mirror that collided with another mirror (or
// with your own data) would render one person's life on another's lane.
export function namespaceWithPrefix(dataset: TimelineDataset, prefix: string): TimelineDataset {
  const ns = (id: string): string => `${prefix}${id}`;
  const nsOptional = (id: string | undefined): string | undefined => (id === undefined ? undefined : ns(id));

  return {
    schemaVersion: dataset.schemaVersion,
    groups: dataset.groups.map((group) => ({
      ...group,
      id: ns(group.id),
      parentGroupId: nsOptional(group.parentGroupId),
    })),
    rows: dataset.rows.map((row) => ({
      ...row,
      id: ns(row.id),
      groupId: nsOptional(row.groupId),
    })),
    entries: dataset.entries.map((entry) => ({
      ...entry,
      id: ns(entry.id),
      rowId: ns(entry.rowId),
      parentEntryId: nsOptional(entry.parentEntryId),
    })),
    // `?? []` because a contributed public-data file predating schema v8 has no
    // events array at all — the JSON is typed, but nothing type-checks it.
    events: (dataset.events ?? []).map((event) => ({
      ...event,
      id: ns(event.id),
      rowId: ns(event.rowId),
    })),
  };
}
