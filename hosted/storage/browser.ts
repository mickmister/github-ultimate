import { IndexedPageKVStore } from '../../src/indexed-page-kv';
import { PageKVService } from '../../src/page-kv';
import type { PageStorageTransport } from '../../src/page-storage';

export function storageAdapter(documentURL: string) {
  const service = new PageKVService(new IndexedPageKVStore(), () => true);
  const request: PageStorageTransport = input => service.request(documentURL, input);
  return { request, close() {} };
}
