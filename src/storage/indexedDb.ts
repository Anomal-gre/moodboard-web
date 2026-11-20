export const DB_NAME = 'moodboard-workspace';
export const DB_VERSION = 1;

export const STORES = {
  META: 'meta',
  PROJECTS: 'projects',
  ASSET_META: 'assetMeta',
  ASSET_BYTES: 'assetBytes',
} as const;

export type StoreName = (typeof STORES)[keyof typeof STORES];

export class StorageQuotaError extends Error {
  constructor(message = 'Dung lượng lưu trữ trình duyệt đã đầy.') {
    super(message);
    this.name = 'StorageQuotaError';
  }
}

export class StorageOpenError extends Error {
  constructor(message = 'Không thể mở kho IndexedDB.') {
    super(message);
    this.name = 'StorageOpenError';
  }
}

let dbPromise: Promise<IDBDatabase> | null = null;

export function resetDbConnection(): void {
  dbPromise = null;
}

export function openMoodboardDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new StorageOpenError('Trình duyệt không hỗ trợ IndexedDB.'));
      return;
    }
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORES.META)) {
          db.createObjectStore(STORES.META);
        }
        if (!db.objectStoreNames.contains(STORES.PROJECTS)) {
          db.createObjectStore(STORES.PROJECTS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORES.ASSET_META)) {
          db.createObjectStore(STORES.ASSET_META, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORES.ASSET_BYTES)) {
          db.createObjectStore(STORES.ASSET_BYTES, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };
      req.onerror = () => {
        dbPromise = null;
        const err = req.error;
        reject(
          new StorageOpenError(
            err?.name === 'VersionError'
              ? 'Kho dữ liệu thuộc phiên bản mới hơn mức ứng dụng hỗ trợ.'
              : err?.message || 'Không thể mở IndexedDB.'
          )
        );
      };
      req.onblocked = () => {
        dbPromise = null;
        reject(new StorageOpenError('Kho dữ liệu đang bị khóa bởi một tab khác.'));
      };
    } catch (e) {
      dbPromise = null;
      reject(new StorageOpenError(e instanceof Error ? e.message : 'Lỗi IndexedDB.'));
    }
  });
  return dbPromise;
}

export function wrapIdbError(err: unknown): Error {
  if (err instanceof DOMException && (err.name === 'QuotaExceededError' || err.code === 22)) {
    return new StorageQuotaError();
  }
  if (err instanceof Error && /quota/i.test(err.message)) {
    return new StorageQuotaError();
  }
  return err instanceof Error ? err : new Error(String(err));
}

export async function idbGet<T>(storeName: StoreName, key: IDBValidKey): Promise<T | undefined> {
  const db = await openMoodboardDb();
  return new Promise<T | undefined>((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(wrapIdbError(req.error));
  });
}

export async function idbGetAll<T>(storeName: StoreName): Promise<T[]> {
  const db = await openMoodboardDb();
  return new Promise<T[]>((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve((req.result as T[]) ?? []);
    req.onerror = () => reject(wrapIdbError(req.error));
  });
}

export async function idbPut<T>(
  storeName: StoreName,
  value: T,
  key?: IDBValidKey
): Promise<void> {
  const db = await openMoodboardDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    if (key !== undefined) {
      store.put(value, key);
    } else {
      store.put(value);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(wrapIdbError(tx.error));
    tx.onabort = () => reject(wrapIdbError(tx.error ?? new Error('Transaction aborted')));
  });
}

export async function idbDelete(storeName: StoreName, key: IDBValidKey): Promise<void> {
  const db = await openMoodboardDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(wrapIdbError(tx.error));
    tx.onabort = () => reject(wrapIdbError(tx.error ?? new Error('Transaction aborted')));
  });
}

export async function idbRunTransaction(
  storeNames: StoreName[],
  mode: IDBTransactionMode,
  fn: (tx: IDBTransaction) => void
): Promise<void> {
  const db = await openMoodboardDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(storeNames, mode);
    try {
      fn(tx);
    } catch (e) {
      try {
        tx.abort();
      } catch {
        // ignore
      }
      reject(wrapIdbError(e));
      return;
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(wrapIdbError(tx.error));
    tx.onabort = () => reject(wrapIdbError(tx.error ?? new Error('Transaction aborted')));
  });
}
