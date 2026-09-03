// Other people's shared timelines, as datasets ready to merge into the view —
// plans/sharing-feature-design.md §D8.
//
// This follows the `publicData` precedent exactly: a separate read-only dataset
// with namespaced ids, merged for display and never written into
// `state.dataset`. That is what keeps exports clean (they serialise
// `state.dataset` and nothing else), makes revocation a delete of one object,
// and leaves every privacy guarantee stated in terms of "your dataset" true.

import { SCHEMA_VERSION } from "../model/types";
import { namespaceWithPrefix } from "../publicData/namespace";
import { datasetToRecordsRoundTrip } from "./records";
import type { MirrorSnapshot } from "./backend";
import type { TimelineDataset } from "../model/types";

export const MIRROR_ID_PREFIX = "shared:";

export interface Mirror {
  ownerAccountId: string;
  ownerName: string;
  role: "owner" | "reader";
  dataset: TimelineDataset;
}

export function mirrorPrefix(ownerAccountId: string): string {
  return `${MIRROR_ID_PREFIX}${ownerAccountId}:`;
}

export function isMirrorId(id: string): boolean {
  return id.startsWith(MIRROR_ID_PREFIX);
}

// The owner whose mirror an id belongs to, or undefined for your own data.
// Ids look like `shared:<accountId>:<ownerLocalId>`, and the owner id is a uuid
// with no colons in it.
export function mirrorOwnerOfId(id: string): string | undefined {
  if (!isMirrorId(id)) return undefined;
  return id.slice(MIRROR_ID_PREFIX.length).split(":")[0];
}

export function buildMirror(snapshot: MirrorSnapshot): Mirror {
  const rebuilt = datasetToRecordsRoundTrip(snapshot.records);
  const dataset: TimelineDataset = { schemaVersion: SCHEMA_VERSION, ...rebuilt };
  // Somebody else's sibling `order` is dropped: it numbers slots in THEIR
  // rail, and carrying it over would let a mirrored group interleave among
  // the user's own top-level rows. Un-ordered records sort after every
  // ordered one (see `orderedChildren`), which is the rule that keeps other
  // people's timelines below your own — the same way public data sits below.
  dataset.groups = dataset.groups.map(({ order: _order, ...group }) => group);
  dataset.rows = dataset.rows.map(({ order: _order, ...row }) => row);
  return {
    ownerAccountId: snapshot.ownerAccountId,
    ownerName: snapshot.ownerName,
    role: snapshot.role,
    dataset: namespaceWithPrefix(dataset, mirrorPrefix(snapshot.ownerAccountId)),
  };
}

// A mirror that rebuilt to nothing is dropped rather than kept as an empty
// shell: the rail draws a header per group, so a mirror with no groups left
// would render as a phantom section carrying someone's name and nothing else.
// That happens whenever the last shared timeline is un-published — which is
// exactly the moment their name should stop being on screen.
export function buildMirrors(snapshots: MirrorSnapshot[]): Mirror[] {
  return snapshots.map(buildMirror).filter((mirror) => mirror.dataset.groups.length > 0);
}
