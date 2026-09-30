// Client-side auto-update: notice that a new build is live and load it,
// without ever interrupting whatever the person is in the middle of.
//
// The server stamps index.html with its build id (server/static.ts) and
// answers /version with the same id. When the two disagree, this reloads —
// but only at a quiet moment:
//   1. Never out from under a finger: no focused field, no draft entry, no
//      date being picked, no assistant open, nothing unsaved or unsent.
//   2. Never twice: one reload per page life, whatever races happen.
//   3. Never in the first 20 seconds of a page's life — a page that reloads
//      itself moments after opening looks broken even when it is correct.
//   4. A page with no stamped build (the Vite dev server) does nothing.
//
// The live event stream also reports the server's build on every (re)connect,
// so a tab that is open across a deploy usually learns about it within
// seconds (src/sync/engine.ts calls `noticeServerBuild`); the poll is the
// fallback for a tab that is offline or signed out.

import { appStore } from "../state/store";

const MIN_PAGE_AGE_MS = 20_000;
const POLL_MS = 5 * 60_000;
const QUIET_RETRY_MS = 15_000;

const pageLoadedAt = Date.now();
let alreadyReloading = false;
let knownNewBuild: string | undefined;
const busyChecks: Array<() => boolean> = [];

export function currentBuild(): string {
  return document.querySelector<HTMLMetaElement>('meta[name="app-build"]')?.content ?? "dev";
}

// Anything that must hold a reload back registers here — the sync engine
// does, while it has local changes the server has not acknowledged.
export function registerBusyCheck(check: () => boolean): void {
  busyChecks.push(check);
}

function isQuiet(): boolean {
  const active = document.activeElement;
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return false;
  if (active instanceof HTMLElement && active.isContentEditable) return false;
  const state = appStore.getState();
  if (state.draft !== undefined || state.pickingField !== undefined) return false;
  if (document.querySelector(".assistant-overlay") !== null) return false;
  return !busyChecks.some((busy) => busy());
}

function reloadWhenQuiet(): void {
  if (alreadyReloading) return;
  if (Date.now() - pageLoadedAt < MIN_PAGE_AGE_MS || !isQuiet()) {
    setTimeout(reloadWhenQuiet, QUIET_RETRY_MS);
    return;
  }
  alreadyReloading = true;
  location.reload();
}

export function noticeServerBuild(build: string | undefined): void {
  if (build === undefined || currentBuild() === "dev" || build === currentBuild()) return;
  if (knownNewBuild === build) return;
  knownNewBuild = build;
  reloadWhenQuiet();
}

async function checkForNewBuild(): Promise<void> {
  if (currentBuild() === "dev") return;
  try {
    const response = await fetch("/version", { cache: "no-store" });
    noticeServerBuild(((await response.json()) as { build?: string }).build);
  } catch {
    // Offline, or the server is mid-deploy: try again next tick.
  }
}

export function startFreshnessChecks(): void {
  if (currentBuild() === "dev") return;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void checkForNewBuild();
  });
  setInterval(() => void checkForNewBuild(), POLL_MS);
}
