// Id namespacing for public datasets (ENGINEERING_PROMPT.md §4): contributors
// only keep ids unique within their own file; the loader prefixes every id and
// every id reference with `pub:<filename-without-ext>:` so independently
// authored files can't collide with each other or with private data.

import type { TimelineDataset } from "../model/types";

export function namespaceDataset(dataset: TimelineDataset, fileStem: string): TimelineDataset {
  const prefix = `pub:${fileStem}:`;
  const ns = (id: string): string => `${prefix}${id}`;
  const nsOptional = (id: string | undefined): string | undefined => (id === undefined ? undefined : ns(id));

  return {
    schemaVersion: dataset.schemaVersion,
    people: dataset.people.map((person) => ({ ...person, id: ns(person.id) })),
    groups: dataset.groups.map((group) => ({
      ...group,
      id: ns(group.id),
      personId: nsOptional(group.personId),
    })),
    categories: dataset.categories.map((category) => ({ ...category, id: ns(category.id) })),
    rows: dataset.rows.map((row) => ({
      ...row,
      id: ns(row.id),
      groupId: ns(row.groupId),
      personId: nsOptional(row.personId),
      categoryId: ns(row.categoryId),
      parentRowId: nsOptional(row.parentRowId),
    })),
    entities: dataset.entities.map((entity) => ({ ...entity, id: ns(entity.id) })),
    entries: dataset.entries.map((entry) => ({
      ...entry,
      id: ns(entry.id),
      rowId: ns(entry.rowId),
      parentEntryId: nsOptional(entry.parentEntryId),
      linkedEntityIds: entry.linkedEntityIds.map(ns),
    })),
  };
}
