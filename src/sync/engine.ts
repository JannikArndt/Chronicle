// The sync runtime: when to diff, push, pull, reconnect — and nothing about
// what those mean, which is replica.ts. plans/v2-server-design.md §4.
//
// Signed out, none of this runs and the app makes no network calls: the
// dataset is saved to IndexedDB `main` exactly as before accounts existed.
// Signed in, the dataset on screen is built from the replica, every local
// edit becomes a pending change (the actions still only edit
// `state.dataset`; `datasetChanged` is their one hook into this module), and
// the event stream brings everyone else's changes in as they happen.

import { api, ApiError, NetworkError } from "./api";
import { formatHlc, localTick } from "./hlc";
import { openLiveStream } from "./live";
import {
  acknowledge,
  adoptLocalDataset,
  applyGone,
  applyServerRecords,
  buildView,
  diffView,
  emptyReplica,
  loadReplica,
  pendingBatch,
  replaceBase,
  storeReplica,
  viewFields,
} from "./replica";
import { sameValue } from "./entities";
import { emptyDataset, normalizeChildOrder, rekeyDataset } from "../model/dataset";
import { namespaceWithPrefix } from "../publicData/namespace";
import { appStore, isPublicId } from "../state/store";
import { clearDataset, clearSync, loadSync, saveSync } from "../storage/db";
import { noticeServerBuild, registerBusyCheck } from "../ui/fresh";
import type { Hlc } from "./hlc";
import type { LiveStream } from "./live";
import type { AccountInfo, PersonRef, Role, ServerEvent, Subject } from "./protocol";
import type { Replica, View, ViewPrefs } from "./replica";
import type { SocialState, SyncState } from "../state/store";
import type { TimelineDataset } from "../model/types";

const PUSH_DELAY_MS = 300;
const SAVE_DELAY_MS = 500;
const FOCUS_DELAY_MS = 300;
const MAX_BATCH = 500;
const RETRY_MS = 10_000;

let replica: Replica | undefined;
let view: View | undefined;
let prefs: ViewPrefs = { foreignCollapsed: new Map() };
let clock: Hlc | undefined;
let node = "device";
// Server time minus local time, learnt on every (re)connect. A phone whose
// clock is a minute slow would otherwise stamp its edits a minute in the past
// and lose every conflict it should win.
let skewMs = 0;
let stream: LiveStream | undefined;
let connectionId: string | undefined;
let pushing: Promise<void> | undefined;
let pushTimer: ReturnType<typeof setTimeout> | undefined;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let focusTimer: ReturnType<typeof setTimeout> | undefined;
let reconnectDelay = 1000;
let focus: string | null = null;
// Bumped on every sign-in and sign-out. An answer that arrives for an older
// generation belongs to a session that no longer exists and is dropped.
let generation = 0;
let initialized = false;

function patch(next: Partial<SyncState>): void {
  appStore.setState({ sync: { ...appStore.getState().sync, ...next } });
}

function stamp(): string {
  clock = localTick(clock, Date.now() + skewMs, node);
  return formatHlc(clock);
}

function deviceNode(accountId: string): string {
  const random = Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, "0")).join("");
  return `${accountId.replace(/[^A-Za-z0-9]/g, "").slice(0, 12)}-${random}`;
}

export function isSignedIn(): boolean {
  return replica !== undefined;
}

// ---------- start-up ----------

// True if this device is signed in (and the dataset came from its replica);
// false for a local-only device, whose dataset the caller loads from `main`.
export async function initSync(): Promise<boolean> {
  if (!initialized) {
    initialized = true;
    registerBusyCheck(() => replica !== undefined && (replica.pending.size > 0 || pushing !== undefined));
    appStore.subscribe(trackFocus);
  }
  const stored = await loadSync().catch(() => null);
  if (stored === null) {
    patch({ status: "local" });
    return false;
  }
  generation += 1;
  begin(stored.account, loadReplica(stored.replica), stored.names, new Map(stored.foreignCollapsed));
  connect();
  return true;
}

function begin(account: AccountInfo, next: Replica, names: Record<string, string>, collapsed: Map<string, boolean>): void {
  replica = next;
  node = deviceNode(account.id);
  prefs = { foreignCollapsed: collapsed, selfGroupId: account.selfGroupId };
  patch({ account, status: "connecting", sessionExpired: false, error: undefined, names: { ...names, [account.id]: account.name } });
  rebuild();
}

// ---------- local edits ----------

// Called from the store's debounced save after every change to the dataset.
export function datasetChanged(): void {
  if (replica === undefined) return;
  capture();
  schedulePush();
  saveSoon();
}

function capture(): void {
  if (replica === undefined || view === undefined) return;
  const next = appStore.getState().dataset;
  if (next === view.dataset) return;
  const previousSelf = view.dataset.selfGroupId;
  const outcome = diffView(view, next, replica, stamp);
  view = outcome.view;
  for (const [id, collapsed] of outcome.collapsed) prefs.foreignCollapsed.set(id, collapsed);
  if (next.selfGroupId !== previousSelf) {
    prefs.selfGroupId = next.selfGroupId;
    void updateAccount({ selfGroupId: next.selfGroupId ?? null });
  }
  if (outcome.refused) rebuild();
  else patch({ meta: view.meta, pending: replica.pending.size });
}

function rebuild(): void {
  if (replica === undefined) return;
  view = buildView(replica, prefs);
  appStore.setState({
    dataset: view.dataset,
    sync: { ...appStore.getState().sync, meta: view.meta, pending: replica.pending.size },
  });
  dropStaleSelection(view.dataset);
}

// A record that disappeared (deleted elsewhere, access revoked) must not stay
// selected, or its panel would edit something that no longer exists.
function dropStaleSelection(dataset: TimelineDataset): void {
  const state = appStore.getState();
  const exists = (ids: Array<{ id: string }>, id: string | undefined) =>
    id === undefined || isPublicId(id) || ids.some((item) => item.id === id);
  const patchState: Partial<typeof state> = {};
  if (!exists(dataset.entries, state.selectedEntryId)) patchState.selectedEntryId = undefined;
  if (!exists(dataset.events, state.selectedEventId)) patchState.selectedEventId = undefined;
  if (!exists(dataset.rows, state.selectedRowId)) {
    patchState.selectedRowId = undefined;
    patchState.selectedRowClickMs = undefined;
  }
  if (state.draft !== undefined && !exists(dataset.rows, state.draft.rowId)) patchState.draft = undefined;
  if (Object.keys(patchState).length > 0) appStore.setState(patchState);
}

// Someone else's collapse state is this device's preference; the actions
// write it into the dataset like any collapse, and `capture` files it here.
export function isForeignGroupCollapsed(id: string): boolean | undefined {
  return prefs.foreignCollapsed.get(id);
}

// ---------- remote changes ----------

function remote(apply: (replica: Replica) => void): void {
  if (replica === undefined) return;
  capture(); // nothing typed in the last few hundred ms may be lost to a rebuild
  apply(replica);
  rebuild();
  saveSoon();
}

function onEvent(event: ServerEvent): void {
  if (replica === undefined) return;
  switch (event.type) {
    case "hello":
      connectionId = event.connectionId;
      skewMs = event.serverTime - Date.now();
      reconnectDelay = 1000;
      noticeServerBuild(event.build);
      if (event.accountId !== replica.me) {
        // This browser signed in as someone else in another tab.
        expireSession();
        return;
      }
      void pullNow().then((ok) => {
        if (!ok || replica === undefined) return;
        patch({ status: "online", error: undefined });
        void push();
        sendFocus();
        void refreshSocial();
      });
      return;
    case "records":
      remote((r) => applyServerRecords(r, event.records));
      return;
    case "gone":
      remote((r) => applyGone(r, event.ids));
      return;
    case "peers":
      patch({ peers: event.peers });
      return;
    case "social":
      void refreshSocial();
      return;
    case "resync":
      void pullNow();
      return;
  }
}

async function pullNow(): Promise<boolean> {
  const current = generation;
  try {
    const response = await api.pull();
    if (current !== generation || replica === undefined) return false;
    if (response.me.id !== replica.me) {
      expireSession();
      return false;
    }
    const names = { ...appStore.getState().sync.names };
    for (const person of response.people) names[person.id] = person.name;
    patch({ account: response.me, names });
    if (response.me.selfGroupId !== undefined) prefs.selfGroupId = response.me.selfGroupId;
    else if (prefs.selfGroupId !== undefined) void updateAccount({ selfGroupId: prefs.selfGroupId });
    remote((r) => replaceBase(r, response.records));
    return true;
  } catch (error) {
    if (current === generation) handleFailure(error);
    return false;
  }
}

// ---------- pushing ----------

function schedulePush(delay = PUSH_DELAY_MS): void {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => void push(), delay);
}

// One push at a time; a second caller waits for the one in flight.
function push(): Promise<void> {
  pushing ??= pushOnce().finally(() => {
    pushing = undefined;
  });
  return pushing;
}

async function pushOnce(): Promise<void> {
  if (replica === undefined || appStore.getState().sync.status !== "online") return;
  capture();
  const batch = pendingBatch(replica, MAX_BATCH);
  if (batch.length === 0) return;
  const current = generation;
  try {
    const { results } = await api.push(batch, connectionId);
    if (current !== generation || replica === undefined) return;
    capture();
    const rejected = acknowledge(replica, batch, results);
    if (rejected.length > 0) {
      console.warn("chronicle: the server refused some changes", rejected);
      patch({ error: `The server refused ${rejected.length} change${rejected.length === 1 ? "" : "s"}: ${rejected[0].reason}` });
    }
    // Rebuild only if the server's answer differs from what is on screen —
    // a rejection, or someone else's newer edit winning a field.
    const differs =
      rejected.length > 0 ||
      results.some((result) => !sameValue(viewFields(replica!, prefs, result.id), view?.records.get(result.id)?.fields));
    if (differs) rebuild();
    else patch({ pending: replica.pending.size });
    saveSoon();
    if (replica.pending.size > 0) schedulePush(50);
  } catch (error) {
    if (current === generation) {
      handleFailure(error);
      if (!(error instanceof NetworkError)) schedulePush(RETRY_MS);
    }
  }
}

// Everything done on this device reaches the server before something that
// depends on it — sharing a group made a moment ago must not ask the server
// about a group it has not heard of yet.
async function settle(): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    capture();
    if (replica === undefined || replica.pending.size === 0) return;
    if (appStore.getState().sync.status !== "online") {
      throw new Error("You are offline — sharing needs a connection to the server.");
    }
    clearTimeout(pushTimer);
    await push();
  }
}

function handleFailure(error: unknown): void {
  if (error instanceof ApiError && error.status === 401) {
    expireSession();
    return;
  }
  if (error instanceof NetworkError) {
    patch({ status: "offline" });
    return;
  }
  patch({ error: error instanceof Error ? error.message : "Something went wrong talking to the server." });
}

function expireSession(): void {
  stream?.close();
  stream = undefined;
  connectionId = undefined;
  patch({ status: "offline", sessionExpired: true, peers: [] });
}

// ---------- the live connection ----------

function connect(): void {
  if (replica === undefined) return;
  clearTimeout(reconnectTimer);
  stream?.close();
  const current = generation;
  patch({ status: "connecting" });
  const live = openLiveStream((event) => {
    if (current === generation && stream === live) onEvent(event);
  });
  stream = live;
  void live.closed.then(({ status }) => {
    if (current !== generation || stream !== live) return;
    connectionId = undefined;
    stream = undefined;
    if (status === 401) {
      expireSession();
      return;
    }
    patch({ status: "offline", peers: [] });
    reconnectTimer = setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
  });
}

// Come back online immediately when the browser says the network is back,
// instead of waiting out the backoff.
if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    if (replica !== undefined && stream === undefined && !appStore.getState().sync.sessionExpired) connect();
  });
}

// ---------- persistence ----------

function saveSoon(): void {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void saveNow(), SAVE_DELAY_MS);
}

async function saveNow(): Promise<void> {
  const state = appStore.getState();
  if (replica === undefined || state.sync.account === undefined) return;
  await saveSync({
    account: state.sync.account,
    replica: storeReplica(replica),
    names: { ...state.sync.names },
    foreignCollapsed: [...prefs.foreignCollapsed],
  });
}

// ---------- account ----------

export async function signUp(handle: string, password: string, name: string): Promise<void> {
  const { me } = await api.signUp(handle, password, name);
  await adopt(me, true);
}

// `keepLocal`: add this device's own timelines to the account. On a device
// that already holds the account (its session had expired), nothing is
// adopted — the replica simply carries on.
export async function signIn(handle: string, password: string, keepLocal: boolean): Promise<void> {
  const { me } = await api.signIn(handle, password);
  if (replica !== undefined && replica.me === me.id) {
    generation += 1;
    patch({ account: me, sessionExpired: false, error: undefined });
    connect();
    return;
  }
  if (replica !== undefined) await forgetEverything();
  await adopt(me, keepLocal);
}

async function adopt(me: AccountInfo, keepLocal: boolean): Promise<void> {
  generation += 1;
  const local = appStore.getState().dataset;
  const hasLocal = keepLocal && (local.groups.length > 0 || local.rows.length > 0);
  const next = emptyReplica(me.id);
  node = deviceNode(me.id);
  let selfGroupId = me.selfGroupId;
  if (hasLocal) {
    const adopted = normalizeChildOrder(rekeyDataset(structuredClone(local)));
    adoptLocalDataset(next, adopted, stamp());
    if (selfGroupId === undefined && adopted.selfGroupId !== undefined) {
      selfGroupId = adopted.selfGroupId;
      void api.updateMe({ selfGroupId }).catch(() => undefined);
    }
  }
  begin({ ...me, selfGroupId }, next, {}, new Map());
  appStore.setState({ selectedEntryId: undefined, selectedEventId: undefined, selectedRowId: undefined, draft: undefined });
  await saveNow();
  await clearDataset();
  connect();
}

export async function signOut(): Promise<void> {
  try {
    await api.signOut();
  } catch {
    // Signing out locally does not depend on the server hearing about it.
  }
  await forgetEverything();
}

export async function deleteAccount(password: string): Promise<void> {
  await api.deleteAccount(password);
  await forgetEverything();
}

async function forgetEverything(): Promise<void> {
  generation += 1;
  stream?.close();
  stream = undefined;
  connectionId = undefined;
  for (const timer of [pushTimer, saveTimer, reconnectTimer, focusTimer]) clearTimeout(timer);
  replica = undefined;
  view = undefined;
  prefs = { foreignCollapsed: new Map() };
  pushing = undefined;
  await clearSync();
  await clearDataset();
  appStore.setState({
    dataset: emptyDataset(),
    selectedEntryId: undefined,
    selectedEventId: undefined,
    selectedRowId: undefined,
    draft: undefined,
    sync: { status: "local", sessionExpired: false, pending: 0, meta: new Map(), names: {}, peers: [] },
  });
}

export async function updateAccount(patchMe: { name?: string; selfGroupId?: string | null }): Promise<void> {
  if (replica === undefined) return;
  try {
    const { me } = await api.updateMe(patchMe);
    patch({ account: me, names: { ...appStore.getState().sync.names, [me.id]: me.name } });
    void saveNow();
  } catch (error) {
    handleFailure(error);
  }
}

export async function changePassword(current: string, next: string): Promise<void> {
  await api.changePassword(current, next);
}

// ---------- presence ----------

function trackFocus(): void {
  const state = appStore.getState();
  const next = state.selectedEntryId ?? state.selectedEventId ?? state.selectedRowId ?? null;
  const shareable = next !== null && !isPublicId(next) ? next : null;
  if (shareable === focus) return;
  focus = shareable;
  clearTimeout(focusTimer);
  focusTimer = setTimeout(sendFocus, FOCUS_DELAY_MS);
}

function sendFocus(): void {
  if (connectionId === undefined || replica === undefined) return;
  void api.presence(connectionId, focus).catch(() => undefined);
}

// ---------- people ----------

function withNames(people: PersonRef[]): void {
  const names = { ...appStore.getState().sync.names };
  for (const person of people) names[person.id] = person.name;
  patch({ names });
}

export async function refreshSocial(): Promise<void> {
  if (replica === undefined) return;
  const current = generation;
  try {
    const [people, grants, invites, links] = await Promise.all([api.people(), api.grants(), api.invites(), api.links()]);
    if (current !== generation) return;
    patch({ social: { people, grants, invites: invites.invites, links: links.links } });
    withNames([
      ...people.connections,
      ...grants.received.map((grant) => grant.owner),
      ...grants.given.map((grant) => grant.grantee),
    ]);
  } catch (error) {
    if (current === generation) handleFailure(error);
  }
}

function patchSocial(next: Partial<SocialState>): void {
  const social = appStore.getState().sync.social;
  if (social !== undefined) patch({ social: { ...social, ...next } });
}

function appUrl(hash: string): string {
  const base = typeof window === "undefined" ? "" : `${window.location.origin}${window.location.pathname}`;
  return `${base}#/${hash}`;
}

// A capability URL: the token IS the permission, so it rides in the fragment,
// which browsers never send to any server.
export async function createInviteLink(subject: Subject | null, role: Role | null): Promise<string> {
  if (subject !== null) await settle();
  const { token } = await api.createInvite(subject, role);
  void refreshSocial();
  return appUrl(`invite/${token}`);
}

export async function cancelInvite(id: string): Promise<void> {
  patchSocial({ invites: (await api.cancelInvite(id)).invites });
}

export const previewInvite = (token: string) => api.previewInvite(token);

export async function redeemInvite(token: string): Promise<PersonRef> {
  const { inviter } = await api.redeemInvite(token);
  withNames([inviter]);
  void refreshSocial();
  return inviter;
}

export async function grantAccess(granteeId: string, subject: Subject, role: Role): Promise<void> {
  await settle();
  patchSocial({ grants: await api.grant(granteeId, subject, role) });
}

export async function revokeGrant(grantId: string): Promise<void> {
  patchSocial({ grants: await api.revoke(grantId) });
}

export async function createPublicLink(subject: Subject): Promise<string> {
  await settle();
  const { token } = await api.createLink(subject);
  patchSocial({ links: (await api.links()).links });
  return appUrl(`view/${token}`);
}

export async function deletePublicLink(id: string): Promise<void> {
  patchSocial({ links: (await api.deleteLink(id)).links });
}

async function peopleAction(action: Promise<SocialState["people"]>): Promise<void> {
  patchSocial({ people: await action });
}
export const requestConnection = (id: string) => peopleAction(api.requestConnection(id));
export const acceptConnection = (id: string) => peopleAction(api.acceptConnection(id));
export const declineConnection = (id: string) => peopleAction(api.declineConnection(id));
export const dismissSuggestion = (id: string) => peopleAction(api.dismissSuggestion(id));
export async function disconnect(id: string): Promise<void> {
  await peopleAction(api.disconnect(id));
  void refreshSocial();
}

// ---------- public links, as a visitor ----------

let linkCounter = 0;

// Someone's published timelines from a public link, as a read-only overlay —
// namespaced `pub:` like any public data, so everything that keeps public
// data read-only keeps this read-only too. Works signed out: no account, no
// cookie, nothing of the visitor's is sent.
export async function openPublicLink(token: string): Promise<string> {
  const { owner, records } = await api.publicView(token);
  const viewer = emptyReplica("public-link-visitor");
  applyServerRecords(viewer, records);
  const { dataset } = buildView(viewer, { foreignCollapsed: new Map() });
  linkCounter += 1;
  const rootId = "root";
  dataset.groups = [
    { id: rootId, label: `${owner.name} — shared with you`, collapsed: false },
    ...dataset.groups.map((group) => (group.parentGroupId === undefined ? { ...group, parentGroupId: rootId } : group)),
  ];
  dataset.rows = dataset.rows.map((row) => (row.groupId === undefined ? { ...row, groupId: rootId } : row));
  const namespaced = namespaceWithPrefix(dataset, `pub:link${linkCounter}:`);
  appStore.setState({ linkDatasets: [...appStore.getState().linkDatasets, namespaced] });
  return owner.name;
}

// Test seam: module state survives between tests in one file.
export async function __resetEngineForTests(): Promise<void> {
  await forgetEverything();
  initialized = false;
  clock = undefined;
  skewMs = 0;
  reconnectDelay = 1000;
}
