// All mutations of app state. Every dataset change autosaves (debounced) to
// IndexedDB — there are no Save buttons anywhere (§6). Public datasets are
// never written back.

import {
  applyDelete,
  collectEntryCascade,
  collectEventCascade,
  collectGroupCascade,
  collectRowCascade,
} from "../model/cascade";
import { emptyDataset, newId } from "../model/dataset";
import { defaultSharedFor } from "../model/sharing";
import { initializeSharing, notifyDatasetChanged } from "../sharing/sync";
import { loadDataset, loadOverlays, saveDataset, saveOverlays } from "../storage/db";
import { loadPublicCatalog } from "../publicData/loader";
import { buildFamousDataset, parseFamousGroupId, remainingRowKeys } from "../publicData/famous/alignToAge";
import { isMirrorId } from "../sharing/mirror";
import { appStore, isForeignId, userBirthMs } from "./store";
import type { AppState, PickableDateField } from "./store";
import type { FamousPerson } from "../publicData/famous/types";
import type {
  FuzzyDate,
  Group,
  Precision,
  TimelineDataset,
  TimelineEntry,
  TimelineEvent,
  TimelineRow,
} from "../model/types";

let persistTimer: ReturnType<typeof setTimeout> | undefined;

function persistSoon(): void {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    void saveDataset(appStore.getState().dataset);
    // Sharing rides the save that already existed: the sync layer diffs the
    // shareable subset against what it last sent rather than being told which
    // record changed, which is why none of the mutations below had to grow a
    // sync call. Signed out, this returns immediately and no network happens.
    notifyDatasetChanged();
  }, 250);
}

let overlayPersistTimer: ReturnType<typeof setTimeout> | undefined;

function persistOverlaysSoon(): void {
  clearTimeout(overlayPersistTimer);
  overlayPersistTimer = setTimeout(() => {
    const { activeWorldKeys, activeFamous } = appStore.getState();
    void saveOverlays({ activeWorldKeys, activeFamous });
  }, 250);
}

function updateDataset(mutate: (dataset: TimelineDataset) => TimelineDataset): void {
  appStore.setState({ dataset: mutate(structuredClone(appStore.getState().dataset)) });
  persistSoon();
}

export async function initializeApp(): Promise<void> {
  const dataset = (await loadDataset()) ?? emptyDataset();
  // Public data is opt-in: nothing is merged until picked from the rail's "+"
  // menu — but a previous session's picks are restored here so the overlay
  // survives a reload.
  const overlays = await loadOverlays();
  appStore.setState({
    dataset,
    publicDatasets: [],
    activeWorldKeys: overlays?.activeWorldKeys ?? [],
    activeFamous: overlays?.activeFamous ?? [],
    loaded: true,
  });
  rebuildPublicDatasets(appStore.getState());
  // Sharing comes last and never blocks the first paint. With no backend
  // configured — a fresh clone, or any build without the Supabase env vars —
  // this sets `configured: false` and returns without touching the network.
  void initializeSharing();
}

// ---------- optional public data (world events + famous people) ----------

// Loaded once per session; the files are bundled at build time and never change.
let worldCatalogCache: ReturnType<typeof loadPublicCatalog> | null = null;
function worldCatalog(): ReturnType<typeof loadPublicCatalog> {
  worldCatalogCache ??= loadPublicCatalog();
  return worldCatalogCache;
}

// Rebuild the merged-in `publicDatasets` from the user's current selections.
// Famous people are (re)built here so an alignment toggle re-shifts the life
// against the latest birth date without any stored copy going stale.
function rebuildPublicDatasets(state: AppState): void {
  const world = worldCatalog()
    .filter((item) => state.activeWorldKeys.includes(item.key))
    .map((item) => item.dataset);

  const famous = state.activeFamous.map((selection) => {
    const birth = selection.aligned ? userBirthMs(state) : undefined;
    return buildFamousDataset(selection.person, birth, selection.removedRowKeys);
  });

  appStore.setState({ publicDatasets: [...world, ...famous] });
  persistOverlaysSoon();
}

export function toggleWorldEvents(key: string): void {
  const state = appStore.getState();
  const active = state.activeWorldKeys.includes(key)
    ? state.activeWorldKeys.filter((k) => k !== key)
    : [...state.activeWorldKeys, key];
  appStore.setState({ activeWorldKeys: active });
  rebuildPublicDatasets(appStore.getState());
}

export function isFamousActive(personId: string): boolean {
  return appStore.getState().activeFamous.some((selection) => selection.person.id === personId);
}

export function addFamousPerson(person: FamousPerson): void {
  if (isFamousActive(person.id)) return;
  const selection = { person, aligned: false, removedRowKeys: [] };
  appStore.setState({ activeFamous: [...appStore.getState().activeFamous, selection] });
  rebuildPublicDatasets(appStore.getState());
}

export function removeFamousPerson(personId: string): void {
  const active = appStore.getState().activeFamous.filter((selection) => selection.person.id !== personId);
  appStore.setState({ activeFamous: active });
  rebuildPublicDatasets(appStore.getState());
}

// Remove a single timeline (row) from a famous person's overlay. If it was the
// last remaining row, remove the whole person instead of leaving an empty group.
export function removeFamousRow(personId: string, rowKey: string): void {
  const selection = appStore.getState().activeFamous.find((s) => s.person.id === personId);
  if (!selection) return;
  // Cascade-aware: removing a parent row also drops its sub-rows, so ask what
  // would remain *after* this removal — not a naive filter that ignores children.
  if (remainingRowKeys(selection.person, [...selection.removedRowKeys, rowKey]).length === 0) {
    removeFamousPerson(personId);
    return;
  }
  const active = appStore.getState().activeFamous.map((s) =>
    s.person.id === personId ? { ...s, removedRowKeys: [...s.removedRowKeys, rowKey] } : s,
  );
  appStore.setState({ activeFamous: active });
  rebuildPublicDatasets(appStore.getState());
}

// Remove any optional public group from its header: a famous person, or a
// world-events dataset (identified by the `pub:<key>:` namespace).
export function removePublicGroup(groupId: string): void {
  const famous = parseFamousGroupId(groupId);
  if (famous) {
    removeFamousPerson(famous.personId);
    return;
  }
  const worldKey = /^pub:([^:]+):/.exec(groupId)?.[1];
  if (worldKey && appStore.getState().activeWorldKeys.includes(worldKey)) {
    toggleWorldEvents(worldKey);
  }
}

export function toggleFamousPerson(person: FamousPerson): void {
  if (isFamousActive(person.id)) removeFamousPerson(person.id);
  else addFamousPerson(person);
}

// Flip one famous person between real calendar dates and "aligned to your age".
export function setFamousAlignment(personId: string, aligned: boolean): void {
  const active = appStore.getState().activeFamous.map((selection) =>
    selection.person.id === personId ? { ...selection, aligned } : selection,
  );
  appStore.setState({ activeFamous: active });
  rebuildPublicDatasets(appStore.getState());
}

// ---------- selection ----------

export function selectEntry(entryId: string | undefined): void {
  appStore.setState({
    selectedEntryId: entryId,
    selectedEventId: undefined,
    selectedRowId: undefined,
    draft: undefined,
  });
}

export function selectEvent(eventId: string | undefined): void {
  appStore.setState({
    selectedEventId: eventId,
    selectedEntryId: undefined,
    selectedRowId: undefined,
    draft: undefined,
  });
}

// `clickMs` is where on the axis the row was clicked, and it is remembered for
// exactly one thing: the add-event form opens at that instant instead of
// asking for a date the user has just pointed at.
export function selectRow(rowId: string | undefined, clickMs?: number): void {
  appStore.setState({
    selectedRowId: rowId,
    selectedRowClickMs: rowId === undefined ? undefined : clickMs,
    selectedEntryId: undefined,
    selectedEventId: undefined,
    draft: undefined,
  });
}

export function clearSelection(): void {
  appStore.setState({
    selectedEntryId: undefined,
    selectedEventId: undefined,
    selectedRowId: undefined,
    selectedRowClickMs: undefined,
    draft: undefined,
    pickingField: undefined,
  });
}

// ---------- drafts (§6: inserted only once titled) ----------

export function startDraft(rowId: string, startMs: number): void {
  const draft: TimelineEntry = {
    id: newId("entry"),
    rowId,
    title: "",
    start: { ms: startMs, precision: "day" },
  };
  appStore.setState({ draft, selectedEntryId: undefined, selectedRowId: rowId });
}

export function updateDraft(patch: Partial<TimelineEntry>): void {
  const { draft } = appStore.getState();
  if (!draft) return;
  const updated = { ...draft, ...patch };
  appStore.setState({ draft: updated });
  if (updated.title.trim() !== "") commitDraft(updated);
}

function commitDraft(draft: TimelineEntry): void {
  updateDataset((dataset) => {
    dataset.entries.push(draft);
    return dataset;
  });
  appStore.setState({ draft: undefined, selectedEntryId: draft.id });
}

// A complete entry, written in one go. The draft mechanism above exists for
// direct manipulation, where a bar appears before it has a title; an assistant
// asks every question first and commits once, which is also what keeps its
// Back button from ever crossing a commit boundary.
export function addEntry(entry: Omit<TimelineEntry, "id">): string {
  const id = newId("entry");
  updateDataset((dataset) => {
    dataset.entries.push({ ...entry, id });
    return dataset;
  });
  return id;
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

// ---------- events (§: a moment on a timeline) ----------

// Events have no draft state, unlike entries. A draft exists because dragging
// out a bar puts something on screen before it has a name; an event is created
// from a form that already knows its title and its date, so there is nothing to
// show early and nothing to commit later.
export function addEvent(rowId: string, title: string, date: FuzzyDate, icon?: string): string {
  const id = newId("event");
  updateDataset((dataset) => {
    dataset.events.push({ id, rowId, title, date, icon });
    return dataset;
  });
  return id;
}

export function updateEvent(eventId: string, patch: Partial<TimelineEvent>): void {
  updateDataset((dataset) => {
    const event = dataset.events.find((candidate) => candidate.id === eventId);
    if (event) Object.assign(event, patch);
    return dataset;
  });
}

export function deleteEvent(eventId: string): void {
  const cascade = collectEventCascade(appStore.getState().dataset, eventId);
  updateDataset((dataset) => applyDelete(dataset, cascade));
  clearSelection();
}

// ---------- rows / groups ----------

export interface IdentitySetupResult {
  groupId: string;
  placesRowId: string;
}

// Onboarding step 1 (docs/superpowers/specs/2026-07-22-onboarding-assistant-design.md):
// creates the user's own group and their first timeline, all in one save. The
// group gets its birth date later, from the step after this one.
export function completeIdentityStep(name: string): IdentitySetupResult {
  let result!: IdentitySetupResult;
  updateDataset((dataset) => {
    const group: Group = { id: newId("group"), label: name, collapsed: false };
    dataset.groups.push(group);
    dataset.selfGroupId = group.id;
    const row: TimelineRow = { id: newId("row"), groupId: group.id, color: "#8ba66f", icon: "🏠", label: "Places lived" };
    dataset.rows.push(row);
    result = { groupId: group.id, placesRowId: row.id };
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
  street?: string;
  city?: string;
  country?: string;
}

// Onboarding places loop: entries are built directly (not through the
// click-driven startDraft flow). Returns the created entry's id, for the
// caller to track for later edits.
export function addOnboardingPlaceEntry(rowId: string, place: OnboardingPlaceAnswer): string {
  const draft: TimelineEntry = {
    id: newId("entry"),
    rowId,
    title: place.label,
    subtitle: place.subtitle,
    place: place.fullName
      ? {
          fullName: place.fullName,
          coordinates: place.coordinates,
          street: place.street,
          city: place.city,
          country: place.country,
        }
      : undefined,
    start: { ms: place.startMs, precision: "year" },
    end: place.endMs !== undefined ? { ms: place.endMs, precision: "year" } : undefined,
  };
  updateDataset((dataset) => {
    dataset.entries.push(draft);
    return dataset;
  });
  return draft.id;
}

// Onboarding places TABLE (unlike addOnboardingPlaceEntry's append-only path):
// every row stays live-editable, so editing an earlier row's place or year has
// to update its already-saved entry directly. Chaining consistency (row N's
// start = row N-1's end) is kept by the caller always recomputing and
// rewriting every row's start from the edited row forward, not by any check
// in here.
export function updateOnboardingPlaceEntry(entryId: string, place: OnboardingPlaceAnswer): void {
  updateDataset((dataset) => {
    const entry = dataset.entries.find((e) => e.id === entryId);
    if (!entry) return dataset;
    entry.title = place.label;
    entry.subtitle = place.subtitle;
    entry.place = place.fullName
      ? {
          fullName: place.fullName,
          coordinates: place.coordinates,
          street: place.street,
          city: place.city,
          country: place.country,
        }
      : undefined;
    entry.start = { ms: place.startMs, precision: "year" };
    entry.end = place.endMs !== undefined ? { ms: place.endMs, precision: "year" } : undefined;
    return dataset;
  });
}

// A birth date is what makes a group a person, so it is offered here rather
// than asked for as a separate "is this a person?" question.
export function addGroup(label: string, birthDate?: number): void {
  updateDataset((dataset) => {
    dataset.groups.push({ id: newId("group"), label, birthDate, collapsed: false });
    return dataset;
  });
}

// Nest a group inside another — "Finn" inside "Family". Only one level deep is
// drawn, so a group that is already nested cannot take children.
export function addSubGroup(parentGroupId: string, label: string, birthDate?: number): void {
  updateDataset((dataset) => {
    const parent = dataset.groups.find((g) => g.id === parentGroupId);
    if (!parent || parent.parentGroupId !== undefined) return dataset;
    const id = newId("group");
    // Insert directly after the parent's existing children so siblings stay
    // together; array order is what the layout draws.
    const lastChildIndex = lastIndexWhere(dataset.groups, (g) => g.parentGroupId === parentGroupId);
    const parentIndex = dataset.groups.findIndex((g) => g.id === parentGroupId);
    dataset.groups.splice(Math.max(lastChildIndex, parentIndex) + 1, 0, {
      id,
      parentGroupId,
      label,
      birthDate,
      collapsed: false,
    });
    // A group needs at least one timeline to be visible; start with a generic one.
    dataset.rows.push({
      id: newId("row"),
      groupId: id,
      color: "#7a8ba6",
      icon: "📌",
      label: "General",
      shared: defaultSharedFor(dataset, id) ? true : undefined,
    });
    return dataset;
  });
}

// ---------- sharing (schema v7) ----------

// Publishing is always explicit. There is no bulk "share everything" switch:
// `shareByDefault` changes what the NEXT timeline starts as, and deliberately
// does not reach back and publish the ones already there.
export function setRowShared(rowId: string, shared: boolean): void {
  updateRow(rowId, { shared: shared ? true : undefined });
}

export function setGroupShared(groupId: string, shared: boolean): void {
  updateGroup(groupId, { shared: shared ? true : undefined });
}

export function setGroupShareByDefault(groupId: string, shareByDefault: boolean): void {
  updateGroup(groupId, { shareByDefault: shareByDefault ? true : undefined });
}

// Records which account this dataset belongs to, so a device that signs in as
// someone else does not diff one person's data against another's.
export function setDatasetAccount(accountId: string | undefined): void {
  updateDataset((dataset) => {
    dataset.accountId = accountId;
    return dataset;
  });
}

// Returns the new row's id so a caller that has to put something on it right
// away (the add-entry assistant) doesn't have to search for it afterwards.
export function addRow(groupId: string, label: string, icon = "🏷️"): string {
  const id = newId("row");
  updateDataset((dataset) => {
    // Private unless the group (or one of its ancestors) says otherwise. A new
    // timeline is never shared by accident — that is the whole rule.
    const shared = defaultSharedFor(dataset, groupId) ? true : undefined;
    dataset.rows.push({ id, groupId, color: randomPastelColor(), icon, label, shared });
    return dataset;
  });
  return id;
}

export function addSubRow(parentRowId: string, label: string): void {
  updateDataset((dataset) => {
    const parent = dataset.rows.find((r) => r.id === parentRowId);
    if (!parent) return dataset;
    dataset.rows.push({
      id: newId("row"),
      groupId: parent.groupId,
      color: randomPastelColor(),
      icon: "🏷️",
      label,
      parentRowId,
      shared: defaultSharedFor(dataset, parent.groupId) ? true : undefined,
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

// ---------- rail drag-and-drop (reorder groups, move rows) ----------

// Order is array position — no explicit order field exists (deliberate: no
// schema change for drag-and-drop).

// Repositions a group immediately before `beforeGroupId`, or at the end of
// `dataset.groups` when `beforeGroupId` is null. Unknown ids and
// self-referential drops are no-ops.
export function reorderGroup(groupId: string, beforeGroupId: string | null): void {
  if (groupId === beforeGroupId) return;
  updateDataset((dataset) => {
    const movingGroup = dataset.groups.find((g) => g.id === groupId);
    if (!movingGroup) return dataset;
    if (beforeGroupId !== null && !dataset.groups.some((g) => g.id === beforeGroupId)) return dataset;
    const remainingGroups = dataset.groups.filter((g) => g.id !== groupId);
    const insertIndex =
      beforeGroupId === null
        ? remainingGroups.length
        : remainingGroups.findIndex((g) => g.id === beforeGroupId);
    remainingGroups.splice(insertIndex, 0, movingGroup);
    dataset.groups = remainingGroups;
    return dataset;
  });
}

// Moves a top-level row into `targetGroupId`, immediately before `beforeRowId`
// (which must belong to the target group), or at the end of that group's rows
// when null. Same-group reorder is the same code path. `targetGroupId` may be a
// sub-group — that is now the whole of "which person does this belong to", so
// there is nothing else to adopt at the drop position. Known scope cut: a moved
// parent's sub-rows keep their stored groupId (they still render under their
// parent, since layout follows parentRowId, but their groupId goes stale).
export function moveRow(rowId: string, targetGroupId: string, beforeRowId: string | null): void {
  if (rowId === beforeRowId) return;
  updateDataset((dataset) => {
    const movingRow = dataset.rows.find((r) => r.id === rowId);
    // Sub-rows are not draggable (plan scope cut) — refuse them here too so no
    // caller can detach a sub-row from its parent's group.
    if (!movingRow || movingRow.parentRowId !== undefined) return dataset;
    if (!dataset.groups.some((g) => g.id === targetGroupId)) return dataset;
    const beforeRow = beforeRowId === null ? undefined : dataset.rows.find((r) => r.id === beforeRowId);
    if (beforeRowId !== null && (beforeRow === undefined || beforeRow.groupId !== targetGroupId)) {
      return dataset;
    }
    const remainingRows = dataset.rows.filter((r) => r.id !== rowId);
    let insertIndex: number;
    if (beforeRow !== undefined) {
      insertIndex = remainingRows.findIndex((r) => r.id === beforeRow.id);
    } else {
      const lastIndexInTargetGroup = lastIndexWhere(remainingRows, (r) => r.groupId === targetGroupId);
      insertIndex = lastIndexInTargetGroup === -1 ? remainingRows.length : lastIndexInTargetGroup + 1;
    }
    movingRow.groupId = targetGroupId;
    remainingRows.splice(insertIndex, 0, movingRow);
    dataset.rows = remainingRows;
    return dataset;
  });
}

// Array.prototype.findLastIndex needs ES2023; the build targets ES2022.
function lastIndexWhere<T>(items: T[], matches: (item: T) => boolean): number {
  for (let i = items.length - 1; i >= 0; i--) {
    if (matches(items[i])) return i;
  }
  return -1;
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
  updateDataset((dataset) => applyDelete(dataset, cascade));
  clearSelection();
}

// ---------- visibility / collapse / search / filters ----------

export function toggleGroupCollapsed(groupId: string): void {
  const state = appStore.getState();
  if (!isForeignId(groupId)) {
    updateGroup(groupId, {
      collapsed: !state.dataset.groups.find((g) => g.id === groupId)?.collapsed,
    });
    return;
  }
  const toggle = (dataset: TimelineDataset): TimelineDataset => ({
    ...dataset,
    groups: dataset.groups.map((g) => (g.id === groupId ? { ...g, collapsed: !g.collapsed } : g)),
  });
  // Someone else's shared data is read-only for the same reason public data is,
  // so its collapse state lives in memory only — and is lost on the next pull,
  // the same known gap public data has.
  if (isMirrorId(groupId)) {
    appStore.setState({
      sharing: {
        ...state.sharing,
        mirrors: state.sharing.mirrors.map((mirror) => ({ ...mirror, dataset: toggle(mirror.dataset) })),
      },
    });
    return;
  }
  appStore.setState({ publicDatasets: state.publicDatasets.map(toggle) });
}

export function toggleRowHidden(rowId: string): void {
  const { hiddenRowIds } = appStore.getState();
  appStore.setState({
    hiddenRowIds: hiddenRowIds.includes(rowId)
      ? hiddenRowIds.filter((id) => id !== rowId)
      : [...hiddenRowIds, rowId],
  });
}

export function toggleRowCollapsed(rowId: string): void {
  const { collapsedRowIds } = appStore.getState();
  appStore.setState({
    collapsedRowIds: collapsedRowIds.includes(rowId)
      ? collapsedRowIds.filter((id) => id !== rowId)
      : [...collapsedRowIds, rowId],
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

export function armDatePicking(field: PickableDateField): void {
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
