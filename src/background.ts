import { Connections, ConnectionError } from './connections';
import { IndexedConnectionStore } from './connection-store';

const api = (globalThis as typeof globalThis & { browser?: typeof chrome }).browser ?? chrome;
const connections = new Connections(new IndexedConnectionStore());
api.runtime.onMessage.addListener((message: unknown, sender, reply) => {
  // Only our top-level settings page can invoke the prototype broker. In
  // particular, an internal message from a GitHub content script is not enough.
  if (sender.id !== api.runtime.id || sender.url !== api.runtime.getURL('connections.html') || sender.tab && sender.frameId !== 0) return false;
  if (!message || typeof message !== 'object' || (message as { channel?: string }).channel !== 'github-ultimate-connections-v1') return false;
  void Promise.resolve().then(() => connections.handle((message as { request?: unknown }).request)).then(
    result => reply({ ok: true, result }),
    error => reply({ ok: false, error: error instanceof ConnectionError ? error.message : 'Invalid request, response or unavailable credential storage. Retry or reconnect.' }),
  );
  return true;
});
