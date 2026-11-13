import { MobileClient } from '../../src/mobile-client';
import type { PageStorageTransport } from '../../src/page-storage';

// Compatibility adapter for already-installed shells predating window injection.
export function storageAdapter() {
  const client = new MobileClient();
  const request: PageStorageTransport = input => {
    const { operation, ...params } = input;
    return client.request({ kvSnapshot: 'kv.snapshot', kvSet: 'kv.set', kvRemove: 'kv.remove', kvClear: 'kv.clear' }[operation], params) as ReturnType<PageStorageTransport>;
  };
  return { request, close: () => client.close() };
}
