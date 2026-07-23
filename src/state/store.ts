// Minimal observable store consumed via useSyncExternalStore — enough state
// management for one screen without pulling in a library.

import { useSyncExternalStore } from "react";
import { emptyDataset, mergeDatasets } from "../model/dataset";
import type { TimelineDataset, TimelineEntry, Precision } from "../model/types";

export interface TimeRangeFilter {
  startMs: number;
  endMs: number;
}

export interface Filters {
  categoryIds: string[];
  personIds: string[];
  entityIds: string[];
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
}

const initialState: AppState = {
  loaded: false,
  dataset: emptyDataset(),
  publicDatasets: [],
  search: "",
  filters: { categoryIds: [], personIds: [], entityIds: [] },
  hiddenRowIds: [],
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
