// IndexedDB persistence (ENGINEERING_PROMPT.md §3). IndexedDB — not the File
// System Access API — is the source of truth specifically because manual
// export/import must work on iOS Safari. Personal data never touches the
// repo or filesystem except through a user-initiated export.

import { SCHEMA_VERSION } from "../model/types";
import type { TimelineDataset } from "../model/types";

const DB_NAME = "chronicle";
const STORE_NAME = "datasets";
const DATASET_KEY = "main";

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
      request.onsuccess = () => {
        const stored = request.result as TimelineDataset | undefined;
        resolve(stored && stored.schemaVersion === SCHEMA_VERSION ? stored : null);
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
