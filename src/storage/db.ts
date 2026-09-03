// IndexedDB persistence (ENGINEERING_PROMPT.md §3). IndexedDB — not the File
// System Access API — is the source of truth specifically because manual
// export/import must work on iOS Safari. Personal data never touches the
// repo or filesystem except through a user-initiated export.

import type { TimelineDataset } from "../model/types";
import type { FamousPerson } from "../publicData/famous/types";
import type { Mirror } from "../sharing/mirror";
import { validateImport } from "./exportImport";

const DB_NAME = "chronicle";
const STORE_NAME = "datasets";
const DATASET_KEY = "main";
const OVERLAYS_KEY = "overlays";
// Other people's shared timelines, cached so they are on screen before the
// network answers. Deliberately a SEPARATE key from `main`: it is somebody
// else's personal data, it must never reach an export, and revoking access has
// to be a delete that cannot possibly take the user's own records with it.
const MIRRORS_KEY = "mirrors";

// Which optional public data (world events + famous people) the user has added.
// Persisted next to the dataset so the overlay survives a reload. Famous people
// are stored whole because a Wikidata-fetched person has no catalog to rehydrate
// from. This is public-figure preference data, not personal data.
export interface StoredOverlays {
  activeWorldKeys: string[];
  activeFamous: { person: FamousPerson; aligned: boolean; removedRowKeys: string[] }[];
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

export async function loadMirrors(): Promise<Mirror[]> {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(MIRRORS_KEY);
      request.onsuccess = () => resolve((request.result as Mirror[] | undefined) ?? []);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export async function saveMirrors(mirrors: Mirror[]): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(mirrors, MIRRORS_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

// Signing out drops every mirror. Leaving another person's timelines cached on
// a device nobody is signed in to would be the one way this feature could leak
// their data to whoever picks the phone up next.
export async function clearMirrors(): Promise<void> {
  await saveMirrors([]);
}
