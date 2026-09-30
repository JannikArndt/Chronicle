// Publishing, as the model sees it: what a new timeline starts as, and what
// publishing one reveals, in words.
//
// Who may actually see a published record is decided on the server
// (server/access.ts) — signed in, all of an account's records are stored
// there, and `shared` is what a *viewer* of the containing group sees.

import type { TimelineDataset } from "./types";

// Does a row or sub-group created in this group start out shared? The nearest
// ancestor that states a preference wins, so setting `shareByDefault` on "My
// family" covers every person inside it without touching them one by one.
//
// The `seen` guard is not decoration: groups nest arbitrarily deep (since v9,
// the rail draws every level too), and a parent cycle would otherwise spin
// here forever.
export function defaultSharedFor(dataset: TimelineDataset, groupId: string | undefined): boolean {
  const groupById = new Map(dataset.groups.map((group) => [group.id, group]));
  const seen = new Set<string>();
  let current = groupId === undefined ? undefined : groupById.get(groupId);
  while (current !== undefined && !seen.has(current.id)) {
    seen.add(current.id);
    if (current.shareByDefault !== undefined) return current.shareByDefault;
    current = current.parentGroupId === undefined ? undefined : groupById.get(current.parentGroupId);
  }
  return false;
}

// What publishing this timeline actually sends, in words — the share control's
// counterpart to `describeCascade`. Sharing is not recallable, so the moment to
// be specific about scope is before the switch is flipped, not after.
export function describePublishImpact(dataset: TimelineDataset, rowId: string): string {
  const row = dataset.rows.find((candidate) => candidate.id === rowId);
  if (row === undefined) return "";

  const entryCount = dataset.entries.filter((entry) => entry.rowId === rowId).length;
  const eventCount = dataset.events.filter((event) => event.rowId === rowId).length;

  const count = (n: number, singular: string, plural: string): string => `${n} ${n === 1 ? singular : plural}`;
  const parts = [count(entryCount, "entry", "entries")];
  if (eventCount > 0) parts.push(count(eventCount, "event", "events"));

  const group = row.groupId === undefined ? undefined : dataset.groups.find((candidate) => candidate.id === row.groupId);
  const groupClause = group === undefined ? "" : ` It also shares the name “${group.label}”.`;
  const listed = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return `This shares ${listed}.${groupClause}`;
}
