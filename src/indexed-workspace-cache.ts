import type { CacheEntry, CacheMetadata, WorkspaceCacheStore } from './workspace-cache';

export class IndexedWorkspaceCacheStore implements WorkspaceCacheStore {
  private database: Promise<IDBDatabase>;
  constructor(name = 'github-ultimate-workspace-cache-v1') {
    this.database = new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => { for (const store of ['entries', 'metadata']) request.result.createObjectStore(store, { keyPath: 'key' }); };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('Workspace cache database unavailable.'));
    });
    // Initialization failures are reported by the first cache operation.
    void this.database.catch(() => {});
  }
  private async read<T>(store: string, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.database;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(store, 'readonly'), request = action(transaction.objectStore(store));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = transaction.onabort = () => reject(new Error('Cache read failed.'));
    });
  }
  get(key: string) { return this.read<CacheEntry | undefined>('entries', store => store.get(key)); }
  list() { return this.read<CacheMetadata[]>('metadata', store => store.getAll()); }
  async write(entry: CacheEntry | undefined, remove: string[]) {
    const db = await this.database;
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(['entries', 'metadata'], 'readwrite');
      for (const key of remove) { transaction.objectStore('entries').delete(key); transaction.objectStore('metadata').delete(key); }
      if (entry) {
        const { value, ...metadata } = entry;
        transaction.objectStore('entries').put(entry); transaction.objectStore('metadata').put(metadata);
      }
      transaction.oncomplete = () => resolve();
      transaction.onerror = transaction.onabort = () => reject(new Error('Cache write failed.'));
    });
  }
}
