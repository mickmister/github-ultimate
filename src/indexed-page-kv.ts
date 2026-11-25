import { emptyPageKV, type PageKVSnapshot, type PageKVStore } from './page-kv';
import type { HostedGrant } from './hosted-access';

/** Separate from credentials/drafts. Origin comes only from privileged broker. */
export class IndexedPageKVStore implements PageKVStore {
  private database?: Promise<IDBDatabase>;
  private db() {
    return this.database ??= new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open('github-ultimate-page-kv', 1);
      open.onupgradeneeded = () => { open.result.createObjectStore('values'); open.result.createObjectStore('grants'); };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(new Error('Page storage database unavailable.'));
    });
  }
  async transact(origin: string, change: (current: PageKVSnapshot) => PageKVSnapshot): Promise<PageKVSnapshot> {
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('values', 'readwrite'), store = tx.objectStore('values');
      const get = store.get(origin); let next: PageKVSnapshot; let failure: unknown;
      get.onsuccess = () => {
        try { const current = get.result ?? emptyPageKV(); next = change(current); if (next !== current) store.put(next, origin); }
        catch (error) { failure = error; tx.abort(); }
      };
      tx.oncomplete = () => resolve(next);
      tx.onabort = tx.onerror = () => reject(failure ?? new Error('Page storage transaction failed.'));
    });
  }
  async grants(): Promise<HostedGrant[]> {
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('grants', 'readonly'), request = tx.objectStore('grants').getAll();
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = tx.onerror = () => reject(new Error('Page storage grants unavailable.'));
    });
  }
  async setGrant(grant: HostedGrant, enabled: boolean): Promise<void> {
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('grants', 'readwrite'), store = tx.objectStore('grants');
      const id = JSON.stringify([grant.origin, grant.subpath]);
      if (enabled) store.put(grant, id); else store.delete(id);
      tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(new Error('Could not save page storage grant.'));
    });
  }
}
