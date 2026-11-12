import { bridgeRequest } from './client';
import { MobileClient } from '../src/mobile-client';
import { IndexedPageKVStore } from '../src/indexed-page-kv';
import { PageKVService } from '../src/page-kv';
import { HydratedPageStorage, overrideLocalStorage, type PageStorageTransport } from '../src/page-storage';

/** Choose a backend explicitly. A denied host never silently falls back. */
export async function openPageStorage(mode: 'browser' | 'extension' | 'mobile', replaceLocalStorage = false) {
  if (!['browser', 'extension', 'mobile'].includes(mode)) throw new Error('Choose a supported page storage backend explicitly.');
  const originalDocument = location.href;
  let client: MobileClient | undefined;
  let transport: PageStorageTransport;
  if (mode === 'extension') transport = request => bridgeRequest(request);
  else if (mode === 'mobile') {
    client = new MobileClient();
    transport = request => {
      const { operation, ...params } = request;
      const method = { kvSnapshot: 'kv.snapshot', kvSet: 'kv.set', kvRemove: 'kv.remove', kvClear: 'kv.clear' }[operation];
      return client!.request(method, params) as ReturnType<PageStorageTransport>;
    };
  } else {
    const service = new PageKVService(new IndexedPageKVStore(), () => true);
    transport = request => service.request(originalDocument, request);
  }
  try {
    const storage = await HydratedPageStorage.open(transport, error => window.dispatchEvent(new CustomEvent('page-storage-error', { detail: error.message })));
    const restore = replaceLocalStorage ? overrideLocalStorage(window, storage) : () => storage.close();
    let closed = false;
    return { storage, close: () => { if (!closed) { closed = true; restore(); client?.close(); } } };
  } catch (error) { client?.close(); throw error; }
}
