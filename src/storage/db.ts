// IndexedDB persistence (ENGINEERING_PROMPT.md §3). IndexedDB — not the File
// System Access API — is the source of truth specifically because manual
// export/import must work on iOS Safari. Personal data never touches the
// repo or filesystem except through a user-initiated export.

import type { TimelineDataset } from "../model/types";
import type { FamousPerson } from "../publicData/famous/types";
import type { AccountInfo } from "../sync/protocol";
import type { StoredReplica } from "../sync/replica";
import { validateImport } from "./exportImport";

const DB_NAME = "chronicle";
const STORE_NAME = "datasets";
const DATASET_KEY = "main";
const OVERLAYS_KEY = "overlays";
// A signed-in device's copy of its account: the server's records it can see
// and the local changes not yet acknowledged. Separate from `main`, which is
// a signed-out device's own data: signing in adopts `main` into the account
// and clears it, signing out deletes this and leaves the device empty.
const SYNC_KEY = "sync";

export interface StoredSync {
  account: AccountInfo;
  replica: StoredReplica;
  names: Record<string, string>;
  foreignCollapsed: Array<[string, boolean]>;
}

// Which optional public data (world events + famous people) the user has added.
// Persisted next to the dataset so the overlay survives a reload. Famous people
// are stored whole because a Wikidata-fetched person has no catalog to rehydrate
// from. This is public-figure preference data, not personal data.
export interface StoredOverlays {
  activeWorldKeys: string[];
  activeFamous: { person: FamousPerson; aligned: boolean; removedRowKeys: string[] }[];
  // Which timelines and groups the user has hidden from the view. Here rather
  // than in the dataset because hiding is a view preference: it must not
  // travel with an export, and it must not be published as if it said
  // something about the timeline itself. Optional — an overlay record written
  // before hiding was persisted simply has neither.
  hiddenRowIds?: string[];
  hiddenGroupIds?: string[];
  // Whether the tree overlay is switched on. Same reasoning as the two above:
  // a view preference, absent from an older overlay record.
  showTreeLines?: boolean;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function loadDataset(): Promise<TimelineDataset | null> {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(DATASET_KEY);
      // The stored dataset goes through the same upgrade path as an imported
      // file. It used to be dropped outright unless its schemaVersion matched
      // exactly, which meant every schema bump silently discarded whatever the
      // browser was holding — the one copy of the user's data.
      request.onsuccess = () => {
        const stored = request.result as TimelineDataset | undefined;
        if (stored === undefined) return resolve(null);
        const upgraded = validateImport(stored);
        resolve(upgraded.ok ? upgraded.dataset : null);
      };
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export async function saveDataset(dataset: TimelineDataset): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(dataset, DATASET_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

export async function loadOverlays(): Promise<StoredOverlays | null> {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(OVERLAYS_KEY);
      request.onsuccess = () => resolve((request.result as StoredOverlays | undefined) ?? null);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export async function saveOverlays(overlays: StoredOverlays): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(overlays, OVERLAYS_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

async function readKey<T>(key: string): Promise<T | undefined> {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(key);
      request.onsuccess = () => resolve(request.result as T | undefined);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

async function writeKey(key: string, value: unknown): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      if (value === undefined) store.delete(key);
      else store.put(value, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

export async function loadSync(): Promise<StoredSync | null> {
  return (await readKey<StoredSync>(SYNC_KEY)) ?? null;
}

export async function saveSync(stored: StoredSync): Promise<void> {
  await writeKey(SYNC_KEY, stored);
}

// Signing out: another person's shared timelines, or this account's own,
// must not stay on a device nobody is signed in to.
export async function clearSync(): Promise<void> {
  await writeKey(SYNC_KEY, undefined);
}

export async function clearDataset(): Promise<void> {
  await writeKey(DATASET_KEY, undefined);
}
