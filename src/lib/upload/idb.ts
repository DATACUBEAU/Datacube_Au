type StoredFileRecord = {
  name: string;
  type: string;
  lastModified: number;
  blob: Blob;
};

const DB_NAME = 'datacube_uploads';
const DB_VERSION = 1;
const STORE_NAME = 'files';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function putJobFile(jobId: string, file: File): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const record: StoredFileRecord = {
      name: file.name,
      type: file.type,
      lastModified: file.lastModified,
      blob: file,
    };
    store.put(record, jobId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  db.close();
}

export async function getJobFile(jobId: string): Promise<File | null> {
  const db = await openDb();
  const record = await new Promise<StoredFileRecord | null>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(jobId);
    req.onsuccess = () => resolve((req.result as StoredFileRecord) ?? null);
    req.onerror = () => reject(req.error);
  });
  db.close();
  if (!record) return null;
  return new File([record.blob], record.name, { type: record.type, lastModified: record.lastModified });
}

export async function deleteJobFile(jobId: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete(jobId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  db.close();
}
