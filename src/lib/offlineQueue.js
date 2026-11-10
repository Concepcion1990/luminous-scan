/**
 * Offline queue — T6. The phone saves every scan on the device FIRST.
 *
 * A queued change is one stock write the server has not confirmed yet:
 *   { key, businessId, kind, payload, status, attempts, createdAt, lastError }
 * `kind` is 'movement' (receive/sold/count/transfer/damaged/...) or
 * 'reserve' (hold/release). `key` is a client-generated UUID — the
 * server's idempotency key, so a replayed change can never
 * double-count stock.
 *
 * Storage: IndexedDB in the browser (survives a closed tab and a dead
 * battery), with an in-memory store when IndexedDB is unavailable
 * (private mode, old browsers, node tests). The queue never trusts
 * the network: a change is only removed once the server CONFIRMS it
 * (see src/lib/syncClient.js flushQueue).
 *
 * Statuses: 'pending' (saved, not yet sent), 'sending' (in flight
 * right now), 'failed' (the server refused it for good — e.g. the
 * product was deleted — kept on the device so nothing is silently
 * dropped; staff can discard it from the sync indicator).
 */
const DB_NAME = 'luminous-stockhaven';
const STORE_NAME = 'offline-queue';
const DB_VERSION = 1;

export function newQueuedChange(businessId, kind, payload) {
  return {
    key:
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `q-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    businessId,
    kind,
    payload,
    status: 'pending',
    attempts: 0,
    createdAt: new Date().toISOString(),
    lastError: '',
  };
}

/** In-memory store: same interface as the IndexedDB store. */
export function createMemoryQueue() {
  const rows = new Map();
  return {
    async add(change) {
      rows.set(change.key, { ...change });
      return change;
    },
    async all() {
      return [...rows.values()].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    },
    async update(change) {
      rows.set(change.key, { ...change });
      return change;
    },
    async remove(key) {
      rows.delete(key);
    },
    async clear() {
      rows.clear();
    },
  };
}

function openIdb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open the offline queue'));
  });
}

function idbTx(db, mode) {
  return db.transaction(STORE_NAME, mode).objectStore(STORE_NAME);
}

function idbRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Offline queue read failed'));
  });
}

/** IndexedDB store: same interface as the in-memory store. */
export function createIdbQueue() {
  return {
    async add(change) {
      const db = await openIdb();
      try {
        await idbRequest(idbTx(db, 'readwrite').add({ ...change }));
      } finally {
        db.close();
      }
      return change;
    },
    async all() {
      const db = await openIdb();
      try {
        const rows = await idbRequest(idbTx(db, 'readonly').getAll());
        return rows.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
      } finally {
        db.close();
      }
    },
    async update(change) {
      const db = await openIdb();
      try {
        await idbRequest(idbTx(db, 'readwrite').put({ ...change }));
      } finally {
        db.close();
      }
      return change;
    },
    async remove(key) {
      const db = await openIdb();
      try {
        await idbRequest(idbTx(db, 'readwrite').delete(key));
      } finally {
        db.close();
      }
    },
    async clear() {
      const db = await openIdb();
      try {
        await idbRequest(idbTx(db, 'readwrite').clear());
      } finally {
        db.close();
      }
    },
  };
}

let sharedQueue = null;

/**
 * The queue the app uses. IndexedDB when it exists, memory otherwise
 * (the memory queue still holds work for the session — a closed tab
 * in a browser without IndexedDB is the one honest gap, and the
 * indicator says so by showing the work as still sending).
 */
export function getOfflineQueue() {
  if (!sharedQueue) {
    sharedQueue = typeof indexedDB !== 'undefined' ? createIdbQueue() : createMemoryQueue();
  }
  return sharedQueue;
}

/** Test hook: swap the shared queue (memory) between tests. */
export function __setOfflineQueue(queue) {
  sharedQueue = queue;
}
