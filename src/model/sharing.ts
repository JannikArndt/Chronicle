// What may leave the device — plans/sharing-feature-design.md §D2.
//
// This is the privacy gate for the whole sharing feature: every push goes
// through `syncSubset`, so a record this function does not return cannot reach
// the server. It is pure, it fails closed (private unless something says
// otherwise), and it is the most heavily tested code in the model.

import type { Group, TimelineDataset, TimelineEntry, TimelineEvent, TimelineRow } from "./types";

// "shared-only" is the default and uploads nothing the user hasn't published.
// "everything" is the opt-in multi-device mode (Phase 1b): private records go up
// too, and row-level security — not this function — is what keeps them from
// everyone but their owner.
export type SyncMode = "shared-only" | "everything";

export interface SyncSubset {
  groups: Group[];
  rows: TimelineRow[];
  entries: TimelineEntry[];
  // Events have no flag of their own either — like entries, they follow their
  // row, which is the whole of their access control.
  events: TimelineEvent[];
}

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

// The records eligible to leave this device, with every reference that points
// outside the subset stripped so the result is internally consistent on its own.
//
// A dangling reference is not a cosmetic problem here: it is how a private
// record leaks — every group reference is checked against the subset below.
export function syncSubset(dataset: TimelineDataset, mode: SyncMode): SyncSubset {
  const groupById = new Map(dataset.groups.map((group) => [group.id, group]));

  const eligibleRows = mode === "everything" ? dataset.rows : dataset.rows.filter((row) => row.shared === true);

  // A group goes up if it is published in its own right — which is what lets you
  // invite someone to a group before it holds any timelines — or because it
  // holds a row that is going up. Ancestors come along so the tree a viewer
  // draws is connected rather than a set of orphans.
  //
  // The consequence worth stating in the UI: publishing a timeline also
  // publishes its group's label and birth date. A bar has to be drawn under
  // some header, so there is no version of this where the container stays home.
  const groupIds = new Set<string>();
  const includeWithAncestors = (startId: string): void => {
    let current = groupById.get(startId);
    while (current !== undefined && !groupIds.has(current.id)) {
      groupIds.add(current.id);
      current = current.parentGroupId === undefined ? undefined : groupById.get(current.parentGroupId);
    }
  };
  for (const group of dataset.groups) {
    if (mode === "everything" || group.shared === true) includeWithAncestors(group.id);
  }
  // A top-level row (no group at all) needs no ancestor walk — it is already
  // eligible on its own `shared` flag.
  for (const row of eligibleRows) {
    if (row.groupId !== undefined) includeWithAncestors(row.groupId);
  }

  // A row whose group is missing from the dataset entirely has nothing to be
  // drawn under, so it stays home rather than going up as an orphan. A
  // top-level row has no such requirement.
  const rows = eligibleRows.filter((row) => row.groupId === undefined || groupIds.has(row.groupId));
  const rowIds = new Set(rows.map((row) => row.id));
  // Entries have no flag of their own — they follow their row, and that is the
  // whole of entry-level access control.
  const entries = dataset.entries.filter((entry) => rowIds.has(entry.rowId));
  const entryIds = new Set(entries.map((entry) => entry.id));
  const events = dataset.events.filter((event) => rowIds.has(event.rowId));

  return {
    groups: dataset.groups
      .filter((group) => groupIds.has(group.id))
      .map((group) => ({
        ...group,
        parentGroupId:
          group.parentGroupId !== undefined && groupIds.has(group.parentGroupId) ? group.parentGroupId : undefined,
      })),
    rows: rows.map((row) => ({ ...row })),
    entries: entries.map((entry) => ({
      ...entry,
      parentEntryId:
        entry.parentEntryId !== undefined && entryIds.has(entry.parentEntryId) ? entry.parentEntryId : undefined,
    })),
    // Nothing to strip: an event references only its row, and it is here
    // precisely because that row is in the subset.
    events,
  };
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
