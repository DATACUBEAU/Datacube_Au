type KvStore = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
  keys: () => Promise<string[]>;
};

const DB_NAME = 'dcau_memory';
const DB_VERSION = 1;
const STORE_NAME = 'kv';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGetItem(key: string): Promise<string | null> {
  const db = await openDb();
  try {
    const value = await new Promise<string | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => resolve((req.result as string) ?? null);
      req.onerror = () => reject(req.error);
    });
    return value;
  } finally {
    db.close();
  }
}

async function idbSetItem(key: string, value: string): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

async function idbRemoveItem(key: string): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

async function idbKeys(): Promise<string[]> {
  const db = await openDb();
  try {
    const result = await new Promise<string[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const keys: string[] = [];
      const cursorReq = store.openKeyCursor();
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) return resolve(keys);
        keys.push(String(cursor.key));
        cursor.continue();
      };
      cursorReq.onerror = () => reject(cursorReq.error);
    });
    return result;
  } finally {
    db.close();
  }
}

const localStorageStore: KvStore = {
  async getItem(key) {
    if (typeof window === 'undefined') return null;
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  async setItem(key, value) {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(key, value);
    } catch {}
  },
  async removeItem(key) {
    if (typeof window === 'undefined') return;
    try {
      localStorage.removeItem(key);
    } catch {}
  },
  async keys() {
    if (typeof window === 'undefined') return [];
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k) keys.push(k);
    }
    return keys;
  },
};

const idbStore: KvStore = {
  async getItem(key) {
    return idbGetItem(key);
  },
  async setItem(key, value) {
    return idbSetItem(key, value);
  },
  async removeItem(key) {
    return idbRemoveItem(key);
  },
  async keys() {
    return idbKeys();
  },
};

export function getWorkingMemoryStore(): KvStore {
  if (typeof window === 'undefined') return localStorageStore;
  if (typeof indexedDB === 'undefined') return localStorageStore;
  return {
    async getItem(key) {
      try {
        return await idbStore.getItem(key);
      } catch {
        return localStorageStore.getItem(key);
      }
    },
    async setItem(key, value) {
      try {
        await idbStore.setItem(key, value);
      } catch {
        await localStorageStore.setItem(key, value);
      }
    },
    async removeItem(key) {
      try {
        await idbStore.removeItem(key);
      } catch {
        await localStorageStore.removeItem(key);
      }
    },
    async keys() {
      try {
        return await idbStore.keys();
      } catch {
        return localStorageStore.keys();
      }
    },
  };
}
