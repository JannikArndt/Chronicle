// Minimal observable store consumed via useSyncExternalStore — enough state
// management for one screen without pulling in a library.

import { useSyncExternalStore } from "react";
import { emptyDataset, mergeDatasets } from "../model/dataset";
import { isMirrorId } from "../sharing/mirror";
import type { TimelineDataset, TimelineEntry, Precision } from "../model/types";
import type { FamousPerson } from "../publicData/famous/types";
import type { Grant, SharingSession } from "../sharing/backend";
import type { Mirror } from "../sharing/mirror";
import { DEFAULT_ROW_STRIPES } from "../render/rowStripes";
import type { RowStripeSettings } from "../render/rowStripes";

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
  dataset: TimelineDataset; // the user's private data — the only part that persists
  publicDatasets: TimelineDataset[]; // read-only, merged into the view
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
  hiddenRowIds: string[];
  // Which optional public data the user has switched on. Nothing loads by
  // default — `publicDatasets` is rebuilt from these selections (see actions).
  // `activeFamous` holds the whole FamousPerson (not just an id) so a person
  // fetched from Wikidata at runtime survives a rebuild without a catalog.
  activeWorldKeys: string[];
  // `removedRowKeys` are base row ids (pre-namespacing) the user has removed
  // from that person's overlay — a single timeline can be taken away without
  // removing the whole person.
  activeFamous: { person: FamousPerson; aligned: boolean; removedRowKeys: string[] }[];
  sharing: SharingState;
  // Presentation preferences — how the timeline looks, never what it holds.
  // Persisted next to the dataset (not inside it): they belong to this device
  // and must not travel in an export or through sharing.
  settings: AppSettings;
}

export interface AppSettings {
  rowStripes: RowStripeSettings;
}

export interface SharingState {
  // False when the build has no Supabase project configured — which is the
  // state of a fresh clone, and must leave the rest of the app untouched.
  configured: boolean;
  session?: SharingSession;
  // Other people's shared timelines. A sibling of `publicDatasets`, never
  // merged into `dataset` — see plans/sharing-feature-design.md §D8.
  mirrors: Mirror[];
  // Who can see what of mine, for the "shared with" list.
  grants: Grant[];
  status: "off" | "idle" | "syncing" | "error";
  error?: string;
}

const initialState: AppState = {
  loaded: false,
  dataset: emptyDataset(),
  publicDatasets: [],
  search: "",
  filters: { groupIds: [] },
  hiddenRowIds: [],
  activeWorldKeys: [],
  activeFamous: [],
  sharing: { configured: false, mirrors: [], grants: [], status: "off" },
  settings: { rowStripes: DEFAULT_ROW_STRIPES },
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
  mirrors: Mirror[];
  merged: TimelineDataset;
} | null = null;

// Your data first, then people you know, then the public datasets — array order
// drives layout (§5), so this is the on-screen order too. Mirrors sit between
// the two because a shared timeline from your dad belongs nearer your own life
// than Mozart's does.
export function mergedDataset(state: AppState): TimelineDataset {
  if (
    mergedCache &&
    mergedCache.dataset === state.dataset &&
    mergedCache.publics === state.publicDatasets &&
    mergedCache.mirrors === state.sharing.mirrors
  ) {
    return mergedCache.merged;
  }
  const mirrorDatasets = state.sharing.mirrors.map((mirror) => mirror.dataset);
  const merged = mergeDatasets(state.dataset, ...mirrorDatasets, ...state.publicDatasets);
  mergedCache = {
    dataset: state.dataset,
    publics: state.publicDatasets,
    mirrors: state.sharing.mirrors,
    merged,
  };
  return merged;
}

export function isPublicId(id: string): boolean {
  return id.startsWith("pub:");
}

// Anything that isn't yours: bundled public data, or a mirror of someone
// else's shared timelines. The UI uses this to decide whether to offer an edit
// at all — a co-owned mirror is the one exception, and it is checked against
// the mirror's `role` rather than against the id.
export function isForeignId(id: string): boolean {
  return isPublicId(id) || isMirrorId(id);
}

// The user's own birth instant, used to align a famous person's life "to your
// age". Undefined until identity onboarding sets it — the picker hides the
// alignment option in that case.
export function userBirthMs(state: AppState): number | undefined {
  const self = state.dataset.groups.find((group) => group.id === state.dataset.selfGroupId);
  return self?.birthDate;
}
