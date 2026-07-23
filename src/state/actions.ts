// All mutations of app state. Every dataset change autosaves (debounced) to
// IndexedDB — there are no Save buttons anywhere (§6). Public datasets are
// never written back.

import { planEntryInsert } from "../model/autoClose";
import { applyDelete, collectEntryCascade, collectGroupCascade, collectRowCascade } from "../model/cascade";
import { emptyDataset, newId } from "../model/dataset";
import { loadDataset, saveDataset } from "../storage/db";
import { loadPublicDatasets } from "../publicData/loader";
import { appStore } from "./store";
import type {
  Category,
  Entity,
  Group,
  Person,
  Precision,
  TimelineDataset,
  TimelineEntry,
  TimelineRow,
} from "../model/types";

let persistTimer: ReturnType<typeof setTimeout> | undefined;

function persistSoon(): void {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    void saveDataset(appStore.getState().dataset);
  }, 250);
}

function updateDataset(mutate: (dataset: TimelineDataset) => TimelineDataset): void {
  appStore.setState({ dataset: mutate(structuredClone(appStore.getState().dataset)) });
  persistSoon();
}

export async function initializeApp(): Promise<void> {
  const dataset = (await loadDataset()) ?? emptyDataset();
  appStore.setState({ dataset, publicDatasets: loadPublicDatasets(), loaded: true });
}

// ---------- selection ----------

export function selectEntry(entryId: string | undefined): void {
  appStore.setState({
    selectedEntryId: entryId,
    selectedRowId: undefined,
    draft: undefined,
    conflictMessage: undefined,
  });
}

export function selectRow(rowId: string | undefined): void {
  appStore.setState({
    selectedRowId: rowId,
    selectedEntryId: undefined,
    draft: undefined,
    conflictMessage: undefined,
  });
}

export function clearSelection(): void {
  appStore.setState({
    selectedEntryId: undefined,
    selectedRowId: undefined,
    draft: undefined,
    pickingField: undefined,
    conflictMessage: undefined,
  });
}

// ---------- drafts (§6: inserted only once titled) ----------

export function startDraft(rowId: string, startMs: number): void {
  const state = appStore.getState();
  const category = (() => {
    const row = state.dataset.rows.find((r) => r.id === rowId);
    return state.dataset.categories.find((c) => c.id === row?.categoryId);
  })();
  const draft: TimelineEntry = {
    id: newId("entry"),
    rowId,
    title: "",
    start: { ms: startMs, precision: "day" },
    linkedEntityIds: [],
    visibility: category?.defaultVisibility ?? "private",
  };
  appStore.setState({ draft, selectedEntryId: undefined, selectedRowId: rowId, conflictMessage: undefined });
}

export function updateDraft(patch: Partial<TimelineEntry>): void {
  const { draft } = appStore.getState();
  if (!draft) return;
  const updated = { ...draft, ...patch };
  appStore.setState({ draft: updated, conflictMessage: undefined });
  if (updated.title.trim() !== "") commitDraft(updated);
}

function commitDraft(draft: TimelineEntry): void {
  const plan = planEntryInsert(appStore.getState().dataset, draft);
  if (plan.kind === "conflict") {
    appStore.setState({ conflictMessage: plan.message });
    return;
  }
  updateDataset((dataset) => {
    if (plan.kind === "autoClose") {
      const previous = dataset.entries.find((e) => e.id === plan.previousEntry.id);
      if (previous) previous.end = plan.closeAt;
    }
    dataset.entries.push(draft);
    return dataset;
  });
  appStore.setState({ draft: undefined, selectedEntryId: draft.id, conflictMessage: undefined });
}

// ---------- entry editing (autosave per field) ----------

export function updateEntry(entryId: string, patch: Partial<TimelineEntry>): void {
  const { draft } = appStore.getState();
  if (draft?.id === entryId) {
    updateDraft(patch);
    return;
  }
  updateDataset((dataset) => {
    const entry = dataset.entries.find((e) => e.id === entryId);
    if (entry) Object.assign(entry, patch);
    return dataset;
  });
}

export function deleteEntryWithCascade(entryId: string): void {
  const cascade = collectEntryCascade(appStore.getState().dataset, entryId);
  updateDataset((dataset) => applyDelete(dataset, cascade));
  clearSelection();
}

// ---------- rows / groups / persons / categories ----------

export interface IdentitySetupResult {
  personId: string;
  groupId: string;
  placesRowId: string;
}

// Onboarding step 1 (docs/superpowers/specs/2026-07-22-onboarding-assistant-design.md):
// creates the user's own Person + Group and their first row, all in one save.
export function completeIdentityStep(name: string): IdentitySetupResult {
  let result!: IdentitySetupResult;
  updateDataset((dataset) => {
    const person: Person = { id: newId("person"), label: name };
    dataset.people.push(person);
    const group: Group = { id: newId("group"), label: name, personId: person.id, collapsed: false };
    dataset.groups.push(group);
    dataset.selfPersonId = person.id;
    const category = ensureCategory(dataset, "Places lived", "#8ba66f", "🏠", "exclusive");
    const row: TimelineRow = { id: newId("row"), groupId: group.id, categoryId: category.id, label: "Places lived" };
    dataset.rows.push(row);
    result = { personId: person.id, groupId: group.id, placesRowId: row.id };
    return dataset;
  });
  return result;
}

export interface OnboardingPlaceAnswer {
  label: string; // short display title — kept as `label` for backward compatibility with existing tests/call sites
  startMs: number;
  endMs?: number; // absent = "still living here" (ongoing)
  subtitle?: string;
  fullName?: string;
  coordinates?: { lat: number; lon: number };
}

// Onboarding places loop: entries are built directly (not through the
// click-driven startDraft flow) but still pass through planEntryInsert,
// preserving the invariant that every insert is checked — by construction
// these are always chronological appends, so it's a defensive no-op here.
export function addOnboardingPlaceEntry(rowId: string, place: OnboardingPlaceAnswer): void {
  const entity = ensureEntity(
    place.label,
    "place",
    place.fullName ? { fullName: place.fullName, coordinates: place.coordinates, subtitle: place.subtitle } : undefined,
  );
  const draft: TimelineEntry = {
    id: newId("entry"),
    rowId,
    title: place.label,
    start: { ms: place.startMs, precision: "year" },
    end: place.endMs !== undefined ? { ms: place.endMs, precision: "year" } : undefined,
    linkedEntityIds: [entity.id],
    visibility: "private",
  };
  const plan = planEntryInsert(appStore.getState().dataset, draft);
  if (plan.kind === "conflict") {
    return;
  }
  updateDataset((dataset) => {
    if (plan.kind === "autoClose") {
      const previous = dataset.entries.find((e) => e.id === plan.previousEntry.id);
      if (previous) previous.end = plan.closeAt;
    }
    dataset.entries.push(draft);
    return dataset;
  });
}

export function addGroup(label: string, asPerson: boolean): void {
  updateDataset((dataset) => {
    let personId: string | undefined;
    if (asPerson) {
      const person: Person = { id: newId("person"), label };
      dataset.people.push(person);
      personId = person.id;
    }
    const group: Group = { id: newId("group"), label, personId, collapsed: false };
    dataset.groups.push(group);
    return dataset;
  });
}

export function addPersonToGroup(groupId: string, label: string): void {
  updateDataset((dataset) => {
    const group = dataset.groups.find((g) => g.id === groupId);
    // §2 asymmetry: a person can only be added inside a personId-less group.
    if (!group || group.personId) return dataset;
    const person: Person = { id: newId("person"), label };
    dataset.people.push(person);
    // A person needs at least one row to be visible; start with a generic one.
    const category = ensureCategory(dataset, "General", "#7a8ba6", "📌");
    dataset.rows.push({
      id: newId("row"),
      groupId,
      personId: person.id,
      categoryId: category.id,
      label: "General",
    });
    return dataset;
  });
}

function ensureCategory(
  dataset: TimelineDataset,
  label: string,
  color: string,
  icon: string,
  concurrency: Category["concurrency"] = "concurrent",
): Category {
  const existing = dataset.categories.find((c) => c.label === label);
  if (existing) return existing;
  const category: Category = {
    id: newId("cat"),
    label,
    color,
    icon,
    concurrency,
    defaultVisibility: "private",
  };
  dataset.categories.push(category);
  return category;
}

export function addRow(groupId: string, label: string, personId?: string): void {
  updateDataset((dataset) => {
    const category = ensureCategory(dataset, label, randomPastelColor(), "🏷️");
    dataset.rows.push({ id: newId("row"), groupId, personId, categoryId: category.id, label });
    return dataset;
  });
}

export function addSubRow(parentRowId: string, label: string): void {
  updateDataset((dataset) => {
    const parent = dataset.rows.find((r) => r.id === parentRowId);
    if (!parent) return dataset;
    const category = ensureCategory(dataset, label, randomPastelColor(), "🏷️");
    dataset.rows.push({
      id: newId("row"),
      groupId: parent.groupId,
      personId: parent.personId,
      categoryId: category.id,
      label,
      parentRowId,
    });
    return dataset;
  });
}

function randomPastelColor(): string {
  const hue = Math.floor(Math.random() * 360);
  return `hsl(${hue} 45% 60%)`;
}

export function updateRow(rowId: string, patch: Partial<TimelineRow>): void {
  updateDataset((dataset) => {
    const row = dataset.rows.find((r) => r.id === rowId);
    if (row) Object.assign(row, patch);
    return dataset;
  });
}

export function deleteRowWithCascade(rowId: string): void {
  const cascade = collectRowCascade(appStore.getState().dataset, rowId);
  updateDataset((dataset) => applyDelete(dataset, cascade));
  clearSelection();
}

export function updateGroup(groupId: string, patch: Partial<Group>): void {
  updateDataset((dataset) => {
    const group = dataset.groups.find((g) => g.id === groupId);
    if (group) Object.assign(group, patch);
    return dataset;
  });
}

export function deleteGroupWithCascade(groupId: string): void {
  const cascade = collectGroupCascade(appStore.getState().dataset, groupId);
  updateDataset((dataset) => applyDelete(dataset, cascade, groupId));
  clearSelection();
}

export function updatePerson(personId: string, patch: Partial<Person>): void {
  updateDataset((dataset) => {
    const person = dataset.people.find((p) => p.id === personId);
    if (person) Object.assign(person, patch);
    return dataset;
  });
}

// Reuses an existing private entity with the same label; creates it otherwise.
// For kind "place", placeDetails carries the full address/coordinates that
// shouldn't be shown as the label itself (that stays a short display title).
// Matching an existing entity that has no place data yet upgrades it in
// place rather than overwriting already-set place data.
export function ensureEntity(
  label: string,
  kind: Entity["kind"],
  placeDetails?: { fullName: string; coordinates?: { lat: number; lon: number }; subtitle?: string },
): Entity {
  const existing = appStore
    .getState()
    .dataset.entities.find((e) => e.label.toLowerCase() === label.toLowerCase());
  if (existing) {
    if (placeDetails && !existing.place) {
      let upgraded!: Entity;
      updateDataset((dataset) => {
        const entity = dataset.entities.find((e) => e.id === existing.id);
        if (entity) entity.place = placeDetails;
        upgraded = entity ?? existing;
        return dataset;
      });
      return upgraded;
    }
    return existing;
  }
  const entity: Entity = { id: newId("ent"), kind, label, place: placeDetails };
  updateDataset((dataset) => {
    dataset.entities.push(entity);
    return dataset;
  });
  return entity;
}

export function updateCategory(categoryId: string, patch: Partial<Category>): void {
  updateDataset((dataset) => {
    const category = dataset.categories.find((c) => c.id === categoryId);
    if (category) Object.assign(category, patch);
    return dataset;
  });
}

// ---------- visibility / collapse / search / filters ----------

export function toggleGroupCollapsed(groupId: string): void {
  const state = appStore.getState();
  const isPublic = groupId.startsWith("pub:");
  if (!isPublic) {
    updateGroup(groupId, {
      collapsed: !state.dataset.groups.find((g) => g.id === groupId)?.collapsed,
    });
    return;
  }
  // Public data is read-only; collapse state for it lives in memory only.
  appStore.setState({
    publicDatasets: state.publicDatasets.map((dataset) => ({
      ...dataset,
      groups: dataset.groups.map((g) => (g.id === groupId ? { ...g, collapsed: !g.collapsed } : g)),
    })),
  });
}

export function toggleRowHidden(rowId: string): void {
  const { hiddenRowIds } = appStore.getState();
  appStore.setState({
    hiddenRowIds: hiddenRowIds.includes(rowId)
      ? hiddenRowIds.filter((id) => id !== rowId)
      : [...hiddenRowIds, rowId],
  });
}

export function setSearch(search: string): void {
  appStore.setState({ search });
}

export function setFilters(filters: AppStateFilters): void {
  appStore.setState({ filters });
}

type AppStateFilters = ReturnType<typeof appStore.getState>["filters"];

// ---------- date picking (§6 "pick on timeline") ----------

export function armDatePicking(field: "start" | "end"): void {
  appStore.setState({ pickingField: field, pickedDate: undefined });
}

export function cancelDatePicking(): void {
  appStore.setState({ pickingField: undefined });
}

export function commitPickedDate(ms: number, precision: Precision): void {
  const { pickingField } = appStore.getState();
  if (!pickingField) return;
  appStore.setState({ pickedDate: { ms, precision, field: pickingField }, pickingField: undefined });
}

// ---------- import ----------

export function replaceDataset(dataset: TimelineDataset): void {
  appStore.setState({ dataset });
  persistSoon();
  clearSelection();
}
