import type { ConnectionRecord, ConnectionStore } from './connections';
import type { S3ConnectionRecord, S3ConnectionStore } from './s3-connections';

// Extension-origin IndexedDB is deliberately separate from chrome.storage.local:
// that storage is also used by the existing GitHub content script for drafts.
// Credentials must never become readable by that less-privileged context.
class IndexedStore<Record extends { id: string }> {
  constructor(private storeName: string) {}
  private database = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('github-ultimate-credentials', 2);
    request.onupgradeneeded = () => {
      for (const name of ['connections', 's3Connections']) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Credential storage unavailable.'));
  });

  private async run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.database;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.storeName, mode);
      const request = action(transaction.objectStore(this.storeName));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = transaction.onerror = () => reject(new Error('Credential storage operation failed.'));
    });
  }

  all() { return this.run<Record[]>('readonly', store => store.getAll()); }
  get(id: string) { return this.run<Record | undefined>('readonly', store => store.get(id)); }
  async put(record: Record) { await this.run('readwrite', store => store.put(structuredClone(record))); }
  async remove(id: string) { await this.run('readwrite', store => store.delete(id)); }
}
export class IndexedConnectionStore extends IndexedStore<ConnectionRecord> implements ConnectionStore { constructor() { super('connections'); } }
export class IndexedS3ConnectionStore extends IndexedStore<S3ConnectionRecord> implements S3ConnectionStore { constructor() { super('s3Connections'); } }
