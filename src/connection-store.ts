import type { ConnectionRecord, ConnectionStore } from './connections';

// Extension-origin IndexedDB is deliberately separate from chrome.storage.local:
// that storage is also used by the existing GitHub content script for drafts.
// Credentials must never become readable by that less-privileged context.
export class IndexedConnectionStore implements ConnectionStore {
  private database = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('github-ultimate-credentials', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('connections', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Credential storage unavailable.'));
  });

  private async run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.database;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('connections', mode);
      const request = action(transaction.objectStore('connections'));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = transaction.onerror = () => reject(new Error('Credential storage operation failed.'));
    });
  }

  all() { return this.run<ConnectionRecord[]>('readonly', store => store.getAll()); }
  get(id: string) { return this.run<ConnectionRecord | undefined>('readonly', store => store.get(id)); }
  async put(record: ConnectionRecord) { await this.run('readwrite', store => store.put(structuredClone(record))); }
  async remove(id: string) { await this.run('readwrite', store => store.delete(id)); }
}
