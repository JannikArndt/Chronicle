// The sync runtime: what runs, when — plans/sharing-feature-design.md §D4.
//
// Push is a diff against a snapshot of what was last sent, driven by the same
// debounced save the app already had. Pull is a full re-fetch of the visible
// set whenever the backend says something changed. Neither one required a
// change to `state/actions.ts`.

import { planPush } from "./diff";
import { formatHlc, localTick } from "./hlc";
import { buildMirrors } from "./mirror";
import { recordsFromSubset } from "./records";
import { isSharingConfigured, supabaseBackend } from "./supabaseBackend";
import { syncSubset } from "../model/sharing";
import { appStore } from "../state/store";
import { clearMirrors, loadMirrors, saveMirrors } from "../storage/db";
import type { InviteDraft, SharingBackend } from "./backend";
import type { Hlc } from "./hlc";
import type { SyncRecord } from "./records";
import type { SyncMode } from "../model/sharing";
import type { SharingState } from "../state/store";

// Phase 1 ships `shared-only` only. The gate takes a mode (and is tested in
// both), so phase 1b is a setting and a return path, not a rewrite — see §D2.
const SYNC_MODE: SyncMode = "shared-only";

const PUSH_DEBOUNCE_MS = 400;

let backend: SharingBackend = supabaseBackend;
let clock: Hlc | undefined;
let snapshot: SyncRecord[] = [];
let unsubscribe: (() => void) | undefined;
let pushTimer: ReturnType<typeof setTimeout> | undefined;

// Tests drive the whole runtime against `fakeBackend.ts`.
export function useBackend(next: SharingBackend): void {
  backend = next;
}

function patch(next: Partial<SharingState>): void {
  appStore.setState({ sharing: { ...appStore.getState().sharing, ...next } });
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong talking to the server.";
}

export async function initializeSharing(): Promise<void> {
  const configured = isSharingConfigured();
  patch({ configured, status: configured ? "idle" : "off" });
  if (!configured) return;

  // Cached mirrors first so other people's timelines are on screen before the
  // network answers — the app is offline-first everywhere else, and sharing
  // should not be the one place that shows a blank rail while it waits.
  const cached = await loadMirrors();
  if (cached.length > 0) patch({ mirrors: cached });

  const session = await backend.currentSession();
  if (session === null) {
    await forgetMirrors();
    return;
  }
  patch({ session });
  unsubscribe = backend.subscribe(() => void refreshMirrors());
  await Promise.all([refreshMirrors(), refreshGrants()]);
  notifyDatasetChanged();
}

// Called from the store's debounced autosave. Signed out, this is a no-op and
// the app makes no network calls at all.
export function notifyDatasetChanged(): void {
  if (appStore.getState().sharing.session === undefined) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => void pushNow(), PUSH_DEBOUNCE_MS);
}

export async function pushNow(): Promise<void> {
  const state = appStore.getState();
  const session = state.sharing.session;
  if (session === undefined) return;

  clock = localTick(clock, Date.now(), session.accountId);
  const current = recordsFromSubset(syncSubset(state.dataset, SYNC_MODE), session.accountId, formatHlc(clock));
  const plan = planPush(snapshot, current);
  if (plan.writes.length === 0) {
    snapshot = plan.nextSnapshot;
    return;
  }

  patch({ status: "syncing" });
  try {
    await backend.push(plan.writes);
    // Only now. Advancing the snapshot before the write lands would mark the
    // change as sent and never retry it — an un-publish that silently failed
    // would leave the timeline visible to everyone it was withdrawn from.
    snapshot = plan.nextSnapshot;
    patch({ status: "idle", error: undefined });
  } catch (error) {
    patch({ status: "error", error: describe(error) });
  }
}

export async function refreshMirrors(): Promise<void> {
  if (appStore.getState().sharing.session === undefined) return;
  try {
    const mirrors = buildMirrors(await backend.pullVisible());
    patch({ mirrors, status: "idle", error: undefined });
    await saveMirrors(mirrors);
  } catch (error) {
    patch({ status: "error", error: describe(error) });
  }
}

export async function refreshGrants(): Promise<void> {
  if (appStore.getState().sharing.session === undefined) return;
  try {
    patch({ grants: await backend.listGrants() });
  } catch (error) {
    patch({ status: "error", error: describe(error) });
  }
}

export async function requestMagicLink(email: string): Promise<void> {
  patch({ status: "syncing", error: undefined });
  try {
    await backend.requestMagicLink(email, window.location.href);
    patch({ status: "idle" });
  } catch (error) {
    patch({ status: "error", error: describe(error) });
  }
}

export async function signOut(): Promise<void> {
  unsubscribe?.();
  unsubscribe = undefined;
  clearTimeout(pushTimer);
  // A fresh snapshot and clock: the next sign-in is a different account's
  // sync state, and reusing this one would diff their data against someone
  // else's and push a pile of tombstones.
  snapshot = [];
  clock = undefined;
  try {
    await backend.signOut();
  } finally {
    patch({ session: undefined, grants: [] });
    await forgetMirrors();
  }
}

async function forgetMirrors(): Promise<void> {
  patch({ mirrors: [] });
  await clearMirrors();
}

export async function createInviteLink(draft: InviteDraft): Promise<string> {
  const token = await backend.createInvite(draft);
  // A capability URL: the token IS the permission, so it goes in the fragment
  // where it is not sent to any server in a Referer header or written to an
  // access log.
  const base = `${window.location.origin}${window.location.pathname}`;
  return `${base}#/invite/${token}`;
}

export async function redeemInviteToken(token: string): Promise<void> {
  patch({ status: "syncing", error: undefined });
  try {
    await backend.redeemInvite(token);
    await Promise.all([refreshMirrors(), refreshGrants()]);
  } catch (error) {
    patch({ status: "error", error: describe(error) });
    throw error;
  }
}

export async function revokeGrant(grantId: string): Promise<void> {
  try {
    await backend.revokeGrant(grantId);
    await refreshGrants();
  } catch (error) {
    patch({ status: "error", error: describe(error) });
  }
}

// Test seam: the module keeps push state between calls, and a test that ran
// after another would otherwise inherit it.
export function __resetSyncStateForTests(): void {
  snapshot = [];
  clock = undefined;
  unsubscribe?.();
  unsubscribe = undefined;
  clearTimeout(pushTimer);
}
