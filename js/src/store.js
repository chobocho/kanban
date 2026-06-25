// Persistence layer. Primary storage is IndexedDB; if it is unavailable or
// throws (private mode, corruption, quota), we transparently fall back to
// localStorage and finally to an in-memory object so the app never breaks.
import { normalizeAppData } from './normalize.js';
const DB_NAME = 'kanban-db';
const DB_VERSION = 1;
const STORE_NAME = 'app';
const DATA_KEY = 'data';
const LS_KEY = 'kanban-fallback';
let memoryCache = null;
function openDb() {
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
function idbGet(db) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).get(DATA_KEY);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}
function idbPut(db, data) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(data, DATA_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}
/** Load and normalize the persisted state. Always resolves to valid data. */
export async function loadData() {
    // Try IndexedDB first.
    try {
        const db = await openDb();
        const raw = await idbGet(db);
        db.close();
        if (raw !== undefined && raw !== null) {
            const data = normalizeAppData(raw);
            memoryCache = data;
            return data;
        }
    }
    catch {
        // fall through to localStorage
    }
    // Try localStorage.
    try {
        const text = localStorage.getItem(LS_KEY);
        if (text) {
            const data = normalizeAppData(JSON.parse(text));
            memoryCache = data;
            return data;
        }
    }
    catch {
        // fall through to default
    }
    const fresh = normalizeAppData(null);
    memoryCache = fresh;
    return fresh;
}
/** Persist the state. Best-effort across all backends; never throws. */
export async function saveData(data) {
    memoryCache = data;
    let savedToIdb = false;
    try {
        const db = await openDb();
        await idbPut(db, data);
        db.close();
        savedToIdb = true;
    }
    catch {
        savedToIdb = false;
    }
    // Mirror to localStorage as a backup (or primary if IndexedDB failed).
    try {
        localStorage.setItem(LS_KEY, JSON.stringify(data));
    }
    catch {
        if (!savedToIdb) {
            // Both backends failed; memoryCache still holds the latest state.
        }
    }
}
/** Return the last in-memory snapshot, if any. */
export function getCached() {
    return memoryCache;
}
