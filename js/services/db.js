// Tiny promise wrapper around IndexedDB, the browser's built-in database.
// Everything (photos, settings, documents) is stored here, on this device only.

const DB_NAME = 'clearpage';
const DB_VERSION = 1;
export const STORES = ['docs', 'pages', 'folders', 'blobs', 'kv'];

let dbPromise = null;

export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('docs')) db.createObjectStore('docs', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('pages')) db.createObjectStore('pages', { keyPath: 'id' }).createIndex('docId', 'docId');
      if (!db.objectStoreNames.contains('folders')) db.createObjectStore('folders', { keyPath: 'id' });
      // Binary data is stored as { type, data: ArrayBuffer }. Plain ArrayBuffers have been more
      // reliable in Safari's IndexedDB than Blob objects.
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    req.onsuccess = () => {
      const db = req.result;
      // If another tab upgrades the database, close ours instead of blocking it.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Database is blocked by another open tab'));
  });
  return dbPromise;
}

function done(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function get(store, key) {
  const db = await openDb();
  return done(db.transaction(store).objectStore(store).get(key));
}

export async function getAll(store) {
  const db = await openDb();
  return done(db.transaction(store).objectStore(store).getAll());
}

export async function getByIndex(store, index, value) {
  const db = await openDb();
  return done(db.transaction(store).objectStore(store).index(index).getAll(value));
}

export async function put(store, value, key) {
  const db = await openDb();
  const tx = db.transaction(store, 'readwrite');
  const r = key === undefined ? tx.objectStore(store).put(value) : tx.objectStore(store).put(value, key);
  await txDone(tx);
  return r.result;
}

export async function del(store, key) {
  const db = await openDb();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).delete(key);
  return txDone(tx);
}

// Runs several writes in one transaction, so they all happen or none do.
// fn receives a map of store name -> object store.
export async function batch(storeNames, fn) {
  const db = await openDb();
  const tx = db.transaction(storeNames, 'readwrite');
  const stores = Object.fromEntries(storeNames.map((n) => [n, tx.objectStore(n)]));
  fn(stores);
  return txDone(tx);
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
  });
}

// ---- binary helpers ----

export async function putBlob(key, blob) {
  const data = await blob.arrayBuffer();
  await put('blobs', { type: blob.type, data }, key);
  return key;
}

export async function getBlob(key) {
  if (!key) return null;
  const rec = await get('blobs', key);
  return rec ? new Blob([rec.data], { type: rec.type }) : null;
}

export function delBlob(key) {
  return key ? del('blobs', key) : Promise.resolve();
}

export function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}
