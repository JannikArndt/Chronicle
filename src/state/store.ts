// Minimal observable store consumed via useSyncExternalStore — enough state
// management for one screen without pulling in a library.

import { useSyncExternalStore } from "react";
import { emptyDataset, mergeDatasets } from "../model/dataset";
import type { TimelineDataset, TimelineEntry, Precision } from "../model/types";
import type { FamousPerson } from "../publicData/famous/types";
import type { RecordMeta } from "../sync/replica";
import type {
  AccountInfo,
  GrantsResponse,
  InviteInfo,
  Peer,
  PeopleResponse,
  PublicLinkInfo,
} from "../sync/protocol";

export interface TimeRangeFilter {
  startMs: number;
  endMs: number;
}

export interface Filters {
  groupIds: string[];
  timeRange?: TimeRangeFilter;
}

export type PickableDateField = "start" | "end" | "date";

export interface AppState {
  loaded: boolean;
  // Everything this account can see and that is not public data: its own
  // records, and — once signed in — other people's records shared with it,
  // each with its owner and access level in `sync.meta`. Signed out, it is
  // exactly the device's own data, as it always was.
  dataset: TimelineDataset;
  publicDatasets: TimelineDataset[]; // read-only, merged into the view
  // Someone's timelines opened from a public link (#/view/<token>): read-only,
  // in memory for this visit, never part of `dataset`.
  linkDatasets: TimelineDataset[];
  selectedEntryId?: string;
  // Events are their own selection, not a second kind of entry id: the two are
  // edited by different panels and looked up in different arrays, and one
  // shared field would have made every consumer guess which it was holding.
  selectedEventId?: string;
  selectedRowId?: string;
  // Where on the time axis the selected row was last clicked. The rail's
  // "add an event" form opens there, so pointing at a moment and naming it is
  // two steps rather than a date typed from memory.
  selectedRowClickMs?: number;
  // A new entry stays a draft (not in the dataset) until it has a title (§6).
  draft?: TimelineEntry;
  search: string;
  filters: Filters;
  // Pick-on-timeline mode: which date field of the open record is being picked.
  // "date" is an event's single instant — it has no start/end to choose between.
  pickingField?: PickableDateField;
  pickedDate?: { ms: number; precision: Precision; field: PickableDateField };
  // Fields still to be picked after the current one, in order. Creating an
  // entry from the canvas queues ["end"] behind "start" so that pointing at a
  // span is one gesture rather than two arm-the-crosshair round trips.
  pickChain?: PickableDateField[];
  // Hidden timelines and groups (src/model/hidden.ts). A view preference, not
  // data: persisted with the other overlays, never in the dataset, so hiding
  // someone's shared timeline is your decision and stays on your device. A
  // hidden thing is gone from the picture completely — what remembers it is
  // this list, and the rail offers it back in the container it belongs to.
  hiddenRowIds: string[];
  hiddenGroupIds: string[];
  // The optional tree overlay (src/render/treeLines.ts): lines from each group
  // to the timelines and sub-groups it holds. A view preference like hiding,
  // persisted the same way, off by default — the indent and the group band
  // already say the same thing on a shallow tree.
  showTreeLines: boolean;
  // Which optional public data the user has switched on. Nothing loads by
  // default — `publicDatasets` is rebuilt from these selections (see actions).
  // `activeFamous` holds the whole FamousPerson (not just an id) so a person
  // fetched from Wikidata at runtime survives a rebuild without a catalog.
  activeWorldKeys: string[];
  // `removedRowKeys` are base row ids (pre-namespacing) the user has removed
  // from that person's overlay — a single timeline can be taken away without
  // removing the whole person.
  activeFamous: { person: FamousPerson; aligned: boolean; removedRowKeys: string[] }[];
  sync: SyncState;
}

export interface SocialState {
  people: PeopleResponse;
  grants: GrantsResponse;
  invites: InviteInfo[];
  links: PublicLinkInfo[];
}

export interface SyncState {
  // "local": no account on this device — the app is local-first and makes no
  // network calls. The other three are a signed-in device's connection.
  status: "local" | "connecting" | "online" | "offline";
  account?: AccountInfo;
  // The session ended (password changed elsewhere, account deleted) while
  // this device still holds the account's data: sign in again to go on.
  sessionExpired: boolean;
  // Local changes the server has not acknowledged yet.
  pending: number;
  error?: string;
  // Owner and access of every record in `dataset` that came from, or is
  // going to, the server. Absent for a signed-out device's records.
  meta: ReadonlyMap<string, RecordMeta>;
  // Display names of the accounts whose records are in `dataset`.
  names: Readonly<Record<string, string>>;
  // Who else is online, and what they have open.
  peers: Peer[];
  social?: SocialState;
}

const initialState: AppState = {
  loaded: false,
  dataset: emptyDataset(),
  publicDatasets: [],
  search: "",
  filters: { groupIds: [] },
  hiddenRowIds: [],
  hiddenGroupIds: [],
  showTreeLines: false,
  activeWorldKeys: [],
  activeFamous: [],
  linkDatasets: [],
  sync: { status: "local", sessionExpired: false, pending: 0, meta: new Map(), names: {}, peers: [] },
};

type Listener = () => void;

function createStore(initial: AppState) {
  let state = initial;
  const listeners = new Set<Listener>();
  return {
    getState: () => state,
    setState(patch: Partial<AppState>) {
      state = { ...state, ...patch };
      listeners.forEach((listener) => listener());
    },
    subscribe(listener: Listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const appStore = createStore(initialState);

export function useAppState<T>(selector: (state: AppState) => T): T {
  return useSyncExternalStore(appStore.subscribe, () => selector(appStore.getState()));
}

let mergedCache: {
  dataset: TimelineDataset;
  publics: TimelineDataset[];
  links: TimelineDataset[];
  merged: TimelineDataset;
} | null = null;

// Your data (and what is shared with you) first, then anything opened from a
// public link, then the public datasets. Records without an `order` sort in
// array order after every ordered sibling, so this is the on-screen order of
// everything that is not yours to arrange.
export function mergedDataset(state: AppState): TimelineDataset {
  if (
    mergedCache &&
    mergedCache.dataset === state.dataset &&
    mergedCache.publics === state.publicDatasets &&
    mergedCache.links === state.linkDatasets
  ) {
    return mergedCache.merged;
  }
  const merged = mergeDatasets(state.dataset, ...state.linkDatasets, ...state.publicDatasets);
  mergedCache = { dataset: state.dataset, publics: state.publicDatasets, links: state.linkDatasets, merged };
  return merged;
}

export function isPublicId(id: string): boolean {
  return id.startsWith("pub:");
}

// Whether an edit to this record can stick: bundled public data and anything
// shared with you for viewing cannot. Someone else's record you were given
// edit access to CAN — the whole point of an editor grant.
export function isReadOnlyId(id: string, state: AppState = appStore.getState()): boolean {
  return isPublicId(id) || state.sync.meta.get(id)?.access === "read";
}

// Whose tree a record lives in — an account id, "public" for public data, or
// "me" for a signed-out device's own records. Two records with different
// owners never nest inside each other; the drag-and-drop targets use this.
export function ownerOfId(id: string, state: AppState = appStore.getState()): string {
  if (isPublicId(id)) return "public";
  return state.sync.meta.get(id)?.owner ?? state.sync.account?.id ?? "me";
}

export function isOwnId(id: string, state: AppState = appStore.getState()): boolean {
  if (isPublicId(id)) return false;
  const owner = state.sync.meta.get(id)?.owner;
  return owner === undefined || owner === state.sync.account?.id;
}

// Someone else's record drawn at the top level of this view because its real
// container is out of sight (the group you were invited to, say): it can be
// edited, but not moved, broken out or deleted from here.
export function isAnchoredId(id: string, state: AppState = appStore.getState()): boolean {
  return state.sync.meta.get(id)?.rootProjected === true;
}

// Only your own records: what an export contains, and what a signed-out
// device holds anyway.
export function ownDataset(state: AppState): TimelineDataset {
  if (state.sync.meta.size === 0) return state.dataset;
  const own = (id: string) => isOwnId(id, state);
  return {
    ...state.dataset,
    groups: state.dataset.groups.filter((g) => own(g.id)),
    rows: state.dataset.rows.filter((r) => own(r.id)),
    entries: state.dataset.entries.filter((e) => own(e.id)),
    events: state.dataset.events.filter((e) => own(e.id)),
  };
}

// The user's own birth instant, used to align a famous person's life "to your
// age". Undefined until identity onboarding sets it — the picker hides the
// alignment option in that case.
export function userBirthMs(state: AppState): number | undefined {
  const self = state.dataset.groups.find((group) => group.id === state.dataset.selfGroupId);
  return self?.birthDate;
}
