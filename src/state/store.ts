// Minimal observable store consumed via useSyncExternalStore — enough state
// management for one screen without pulling in a library.

import { useSyncExternalStore } from "react";
import { emptyDataset, mergeDatasets } from "../model/dataset";
import type { TimelineDataset, TimelineEntry, Precision } from "../model/types";
import type { FamousPerson } from "../publicData/famous/types";

export interface TimeRangeFilter {
  startMs: number;
  endMs: number;
}

export interface Filters {
  categoryIds: string[];
  personIds: string[];
  timeRange?: TimeRangeFilter;
}

export interface AppState {
  loaded: boolean;
  dataset: TimelineDataset; // the user's private data — the only part that persists
  publicDatasets: TimelineDataset[]; // read-only, merged into the view
  selectedEntryId?: string;
  selectedRowId?: string;
  // A new entry stays a draft (not in the dataset) until it has a title (§6).
  draft?: TimelineEntry;
  search: string;
  filters: Filters;
  // Pick-on-timeline mode: which date field of the open entry is being picked.
  pickingField?: "start" | "end";
  pickedDate?: { ms: number; precision: Precision; field: "start" | "end" };
  hiddenRowIds: string[];
  // Parent rows collapsed into a compact canvas band (in-memory: public rows
  // can't store this on their read-only dataset).
  collapsedRowIds: string[];
  // Which optional public data the user has switched on. Nothing loads by
  // default — `publicDatasets` is rebuilt from these selections (see actions).
  // `activeFamous` holds the whole FamousPerson (not just an id) so a person
  // fetched from Wikidata at runtime survives a rebuild without a catalog.
  activeWorldKeys: string[];
  // `removedRowKeys` are base row ids (pre-namespacing) the user has removed
  // from that person's overlay — a single timeline can be taken away without
  // removing the whole person.
  activeFamous: { person: FamousPerson; aligned: boolean; removedRowKeys: string[] }[];
}

const initialState: AppState = {
  loaded: false,
  dataset: emptyDataset(),
  publicDatasets: [],
  search: "",
  filters: { categoryIds: [], personIds: [] },
  hiddenRowIds: [],
  collapsedRowIds: [],
  activeWorldKeys: [],
  activeFamous: [],
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

let mergedCache: { dataset: TimelineDataset; publics: TimelineDataset[]; merged: TimelineDataset } | null = null;

// Private data first, public datasets appended — array order drives layout,
// so public groups always render after the user's own (§5).
export function mergedDataset(state: AppState): TimelineDataset {
  if (mergedCache && mergedCache.dataset === state.dataset && mergedCache.publics === state.publicDatasets) {
    return mergedCache.merged;
  }
  const merged = mergeDatasets(state.dataset, ...state.publicDatasets);
  mergedCache = { dataset: state.dataset, publics: state.publicDatasets, merged };
  return merged;
}

export function isPublicId(id: string): boolean {
  return id.startsWith("pub:");
}

// The user's own birth instant, used to align a famous person's life "to your
// age". Undefined until identity onboarding sets it — the picker hides the
// alignment option in that case.
export function userBirthMs(state: AppState): number | undefined {
  const self = state.dataset.people.find((person) => person.id === state.dataset.selfPersonId);
  return self?.birthDate;
}
