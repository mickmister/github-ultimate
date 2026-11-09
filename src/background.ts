import { Connections, ConnectionError } from './connections';
import { IndexedConnectionStore } from './connection-store';
import { trustedOrigin, originPattern } from './hosted-protocol';

const api = (globalThis as typeof globalThis & { browser?: typeof chrome }).browser ?? chrome;
const store = new IndexedConnectionStore();
const connections = new Connections(store);
let registrationTail: Promise<unknown> = Promise.resolve();
function syncRegistrations() {
  const work = registrationTail.catch(() => {}).then(async () => {
    const patterns = [...new Set((await store.all()).flatMap(record => record.origins ?? []).map(originPattern))];
    const scripts: chrome.scripting.RegisteredContentScript[] = [];
    for (const pattern of patterns) {
      if (!await api.permissions.contains({ origins: [pattern] })) continue;
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pattern));
      const id = `hosted-${[...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')}`;
      scripts.push({ id, matches: [pattern], js: ['hosted-content.js'], runAt: 'document_start' as const, allFrames: false, persistAcrossSessions: true });
    }
    const current = (await api.scripting.getRegisteredContentScripts()).filter(script => script.id.startsWith('hosted-'));
    const stale = current.filter(script => !scripts.some(next => next.id === script.id)).map(script => script.id);
    if (stale.length) await api.scripting.unregisterContentScripts({ ids: stale });
    const missing = scripts.filter(script => !current.some(old => old.id === script.id));
    const existing = scripts.filter(script => current.some(old => old.id === script.id));
    if (existing.length) await api.scripting.updateContentScripts(existing);
    if (missing.length) await api.scripting.registerContentScripts(missing);
  });
  registrationTail = work;
  return work;
}
api.runtime.onInstalled.addListener(() => { void syncRegistrations().catch(() => {}); });
api.runtime.onStartup.addListener(() => { void syncRegistrations().catch(() => {}); });
api.runtime.onMessage.addListener((message: unknown, sender, reply) => {
  if (sender.id !== api.runtime.id || !message || typeof message !== 'object') return false;
  const { channel, request } = message as { channel?: string; request?: unknown };
  const settings = channel === 'github-ultimate-connections-v1' && sender.url === api.runtime.getURL('connections.html') && (!sender.tab || sender.frameId === 0);
  const hosted = channel === 'github-ultimate-hosted-v1' && sender.tab && sender.frameId === 0 && sender.url;
  if (!settings && !hosted) return false;
  void Promise.resolve().then(async () => {
    if (!settings) {
      const origin = trustedOrigin(new URL(sender.url!).origin);
      if (sender.origin && sender.origin !== origin) throw new ConnectionError('Sender origin mismatch.');
      if (!await api.permissions.contains({ origins: [originPattern(origin)] })) throw new ConnectionError('Browser host access has been revoked.');
      return connections.handleHosted(origin, request);
    }
    if ((request as { operation?: string })?.operation === 'grantOrigin') {
      const origin = trustedOrigin((request as { origin: string }).origin);
      if (!await api.permissions.contains({ origins: [originPattern(origin)] })) throw new ConnectionError('Browser host permission was not granted.');
    }
    const result = await connections.handle(request);
    if (['grantOrigin', 'revokeOrigin', 'disconnect', 'remove'].includes((request as { operation: string }).operation)) await syncRegistrations();
    return result;
  }).then(
    result => reply({ ok: true, result }),
    error => reply({ ok: false, error: error instanceof ConnectionError ? error.message : 'Invalid request, response or unavailable credential storage. Retry or reconnect.' }),
  );
  return true;
});
