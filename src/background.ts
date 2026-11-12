import { Connections, ConnectionError } from './connections';
import { IndexedConnectionStore, IndexedS3ConnectionStore } from './connection-store';
import { trustedOrigin, originPattern } from './hosted-protocol';
import { hostedGrants, loadedDocument, matchesGrant, trustedSubpath } from './hosted-access';
import { hostedRelayRevision } from './bridge-channels';
import { S3Connections } from './s3-connections';
import { IndexedPageKVStore } from './indexed-page-kv';
import { PageKVService } from './page-kv';
import { z } from 'zod';

const api = (globalThis as typeof globalThis & { browser?: typeof chrome }).browser ?? chrome;
const store = new IndexedConnectionStore();
const connections = new Connections(store);
const s3Store = new IndexedS3ConnectionStore();
const s3Connections = new S3Connections(s3Store, (...args) => fetch(...args), origin => api.permissions.contains({ origins: [originPattern(origin)] }));
const pageKVStore = new IndexedPageKVStore();
const pageKV = new PageKVService(pageKVStore, async documentURL => {
  const document = loadedDocument(documentURL);
  return await api.permissions.contains({ origins: [originPattern(document.origin)] }) && (await pageKVStore.grants()).some(grant => matchesGrant(grant, document));
});
let registrationTail: Promise<unknown> = Promise.resolve();
function syncRegistrations() {
  const work = registrationTail.catch(() => {}).then(async () => {
    const records = [...await store.all(), ...await s3Store.all()];
    const patterns = [...new Set([...records.flatMap(record => hostedGrants(record).map(grant => grant.origin)), ...(await pageKVStore.grants()).map(grant => grant.origin)].map(originPattern))];
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
  const { channel, request, documentURL, relayRevision } = message as { channel?: string; request?: unknown; documentURL?: unknown; relayRevision?: unknown };
  const s3Settings = channel === 'github-ultimate-s3-settings-v1';
  const kvSettings = channel === 'github-ultimate-page-storage-settings-v1';
  const settings = (channel === 'github-ultimate-connections-v1' || s3Settings || kvSettings) && sender.url === api.runtime.getURL('connections.html') && (!sender.tab || sender.frameId === 0);
  const hosted = channel === 'github-ultimate-hosted-v1' && sender.tab && sender.frameId === 0 && sender.url;
  if (!settings && !hosted) return false;
  void Promise.resolve().then(async () => {
    if (!settings) {
      if (relayRevision !== hostedRelayRevision || typeof documentURL !== 'string' || documentURL.length > 16384) throw new ConnectionError('The injected relay is outdated. Reload this page to verify its original document path.');
      const original = loadedDocument(documentURL);
      const origin = trustedOrigin(new URL(sender.url!).origin);
      if (original.origin !== origin || sender.origin && sender.origin !== origin) throw new ConnectionError('Sender origin mismatch.');
      if (!await api.permissions.contains({ origins: [originPattern(origin)] })) throw new ConnectionError('Browser host access has been revoked.');
      const operation = (request as { operation?: unknown })?.operation;
      if (typeof operation === 'string' && operation.startsWith('kv')) return pageKV.request(original.href, request);
      return typeof operation === 'string' && operation.startsWith('s3') ? s3Connections.handleHosted(original.href, request) : connections.handleHosted(original.href, request);
    }
    if (kvSettings) {
      const value = z.discriminatedUnion('operation', [
        z.object({ operation: z.literal('list') }).strict(),
        z.object({ operation: z.enum(['grant', 'revoke']), origin: z.string().max(300), subpath: z.string().max(1000) }).strict(),
      ]).parse(request);
      if (value.operation === 'list') return pageKVStore.grants();
      const grant = { origin: trustedOrigin(value.origin), subpath: trustedSubpath(value.subpath) };
      if (value.operation === 'grant' && !await api.permissions.contains({ origins: [originPattern(grant.origin)] })) throw new ConnectionError('Browser host access was not granted.');
      await pageKVStore.setGrant(grant, value.operation === 'grant');
      await syncRegistrations();
      return pageKVStore.grants();
    }
    if ((request as { operation?: string })?.operation === 'grantOrigin') {
      const origin = trustedOrigin((request as { origin: string }).origin);
      if (!await api.permissions.contains({ origins: [originPattern(origin)] })) throw new ConnectionError('Browser host permission was not granted.');
    }
    const result = await (s3Settings ? s3Connections : connections).handle(request);
    if (['grantOrigin', 'revokeOrigin', 'disconnect', 'remove'].includes((request as { operation: string }).operation)) await syncRegistrations();
    return result;
  }).then(
    result => reply({ ok: true, result }),
    error => {
      const operation = (request as { operation?: unknown })?.operation;
      reply({ ok: false, error: error instanceof Error && (error instanceof ConnectionError || kvSettings || typeof operation === 'string' && operation.startsWith('kv')) ? error.message : 'Invalid request, response or unavailable credential storage. Retry or reconnect.' });
    },
  );
  return true;
});
