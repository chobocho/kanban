// Persistence layer. Primary storage is IndexedDB; if it is unavailable or
// throws (private mode, corruption, quota), we transparently fall back to
// localStorage and finally to an in-memory object so the app never breaks.
//
// Each backend stores a small envelope { savedAt, data }. localStorage is
// written synchronously *before* the async IndexedDB write so that a flush on
// page unload still persists, and on load we pick whichever backend has the
// most recent savedAt to avoid returning stale data after a quick exit.

import { AppData } from './types.js';
import { normalizeAppData } from './normalize.js';

const DB_NAME = 'kanban-db';
const DB_VERSION = 1;
const STORE_NAME = 'app';
const DATA_KEY = 'data';
const LS_KEY = 'kanban-fallback';

interface Envelope {
  savedAt: number;
  data: AppData;
}

let memoryCache: AppData | null = null;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('open failed'));
  });
}

function idbGet(db: IDBDatabase): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(DATA_KEY);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(db: IDBDatabase, env: Envelope): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(env, DATA_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Extract a savedAt timestamp from an arbitrary stored value (0 if unknown). */
function savedAtOf(value: unknown): number {
  if (value && typeof value === 'object' && typeof (value as Envelope).savedAt === 'number') {
    return (value as Envelope).savedAt;
  }
  return 0;
}

/** Pull the inner data from an envelope, tolerating legacy bare-AppData values. */
function dataOf(value: unknown): unknown {
  if (value && typeof value === 'object' && 'data' in (value as object)) {
    return (value as Envelope).data;
  }
  return value;
}

/** Load and normalize the persisted state. Always resolves to valid data. */
export async function loadData(): Promise<AppData> {
  let idbValue: unknown;
  try {
    const db = await openDb();
    idbValue = await idbGet(db);
    db.close();
  } catch {
    idbValue = undefined;
  }

  let lsValue: unknown;
  try {
    const text = localStorage.getItem(LS_KEY);
    lsValue = text ? JSON.parse(text) : undefined;
  } catch {
    lsValue = undefined;
  }

  // Choose whichever backend holds the most recent save.
  let chosen: unknown = undefined;
  if (idbValue !== undefined && lsValue !== undefined) {
    chosen = savedAtOf(lsValue) > savedAtOf(idbValue) ? lsValue : idbValue;
  } else {
    chosen = idbValue !== undefined ? idbValue : lsValue;
  }

  const data = normalizeAppData(dataOf(chosen));
  memoryCache = data;
  return data;
}

/** Persist the state. Best-effort across all backends; never throws. */
export async function saveData(data: AppData): Promise<void> {
  memoryCache = data;
  const env: Envelope = { savedAt: Date.now(), data };

  // localStorage first: synchronous, so it survives an imminent page unload.
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(env));
  } catch {
    // ignore quota/availability errors
  }

  // IndexedDB: the durable primary store.
  try {
    const db = await openDb();
    await idbPut(db, env);
    db.close();
  } catch {
    // ignore; localStorage/memory still hold the latest state
  }
}

/** Return the last in-memory snapshot, if any. */
export function getCached(): AppData | null {
  return memoryCache;
}
