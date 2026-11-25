import { expect, test, vi } from 'vitest';
import { indexedDB } from 'fake-indexeddb';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Connections, type ConnectionRecord, type ConnectionStore } from '../src/connections';
import { createDocumentBrowserController } from '../webapp/src/features/documents/controller';
import type { AppHooksV1 } from '../webapp/src/app-hooks/contracts';
import { createQueryTransport } from '../hosted/query-cache';
import { verifiedGitBlobBytes } from '../src/git-reads';
import { CacheSettingsService, cacheSettingsKey, defaultCacheSettings } from '../src/cache-settings';
import { IndexedWorkspaceCacheStore } from '../src/indexed-workspace-cache';
import { SQLiteWorkspaceCacheStore, type CacheDatabase } from '../src/sqlite-workspace-cache';
import { WorkspaceCache, type CacheScope, type WorkspaceCacheStore } from '../src/workspace-cache';

export class MemorySettings {
  values = new Map<string, string>();
  async getItem(key: string) { return this.values.get(key) ?? null; }
  async setItem(key: string, value: string) { this.values.set(key, value); }
}
export const scope = (workspace: string, namespace: CacheScope['namespace'] = 'documents'): CacheScope => ({ connection: 'connection', account: 1, installation: 2, repository: 'owner/repo', workspace, namespace });
function sqlite(db: DatabaseSync): CacheDatabase {
  return {
    async execAsync(sql) { db.exec(sql); },
    async getFirstAsync<T>(sql: string, ...params: string[]) { return db.prepare(sql).get(...params) as T ?? null; },
    async getAllAsync<T>(sql: string) { return db.prepare(sql).all() as T[]; },
    async runAsync(sql, ...params) { return db.prepare(sql).run(...params); },
    async withExclusiveTransactionAsync(work) {
      db.exec('BEGIN IMMEDIATE');
      try { await work(sqlite(db)); db.exec('COMMIT'); } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
  };
}

for (const backend of ['indexeddb', 'sqlite'] as const) {
  test(`${backend}: survives store/engine replacement; count and byte limits apply to both namespaces`, async () => {
    const directory = mkdtempSync(join(tmpdir(), 'workspace-cache-test-'));
    const settingsStorage = new MemorySettings(), settings = new CacheSettingsService(settingsStorage);
    await settings.save({ ...defaultCacheSettings(), documentWorkspaces: 1, doltWorkspaces: 1, capacityMiB: 1 });
    const name = crypto.randomUUID();
    let db = new DatabaseSync(join(directory, 'cache.db'));
    Object.assign(globalThis, { indexedDB });
    const store = (): WorkspaceCacheStore => backend === 'indexeddb' ? new IndexedWorkspaceCacheStore(name) : new SQLiteWorkspaceCacheStore(Promise.resolve(sqlite(db)));
    let time = 1, cache = new WorkspaceCache(store(), settings, () => time++);
    try {
      await cache.put(scope('one'), 'blob:shared', 'hello');
      if (backend === 'sqlite') { db.close(); db = new DatabaseSync(join(directory, 'cache.db')); }
      cache = new WorkspaceCache(store(), new CacheSettingsService(settingsStorage), () => time++);
      expect(await cache.get(scope('one'), 'blob:shared')).toBe('hello');
      expect(await cache.get({ ...scope('one'), account: 99 }, 'blob:shared')).toBeUndefined();
      expect(await cache.get({ ...scope('one'), generation: 1 }, 'blob:shared')).toBeUndefined();
      await cache.put(scope('two'), 'blob:new', 'new');
      expect(await cache.get(scope('one'), 'blob:shared')).toBeUndefined();
      await cache.put(scope('one', 'dolt'), 'blob:dolt', 'dolt');
      await cache.put(scope('two', 'dolt'), 'blob:dolt2', 'next');
      expect(await cache.get(scope('one', 'dolt'), 'blob:dolt')).toBeUndefined();
      expect((await cache.status()).doltWorkspaces).toBe(1);
      await cache.put(scope('large'), 'a', 'x'.repeat(600000));
      await cache.put(scope('large'), 'b', 'y'.repeat(600000));
      expect(await cache.get(scope('large'), 'a')).toHaveLength(600000);
      expect(await cache.get(scope('large'), 'b')).toBeUndefined();
      expect((await cache.status()).error).toContain('capacity');
      expect((await cache.status()).bytes).toBeLessThanOrEqual(1048576);
      await settings.save({ ...defaultCacheSettings(), cacheDolt: false, capacityMiB: 1 }); await cache.trim();
      expect((await cache.status()).doltWorkspaces).toBe(0);
      await cache.clearConnection('connection'); expect((await cache.status()).entries).toBe(0);
      expect((await settings.read()).cacheDolt).toBe(false);
    } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
  });
}

test('settings are validated/persisted independently of cache data; default Dolt is on', async () => {
  const storage = new MemorySettings(), service = new CacheSettingsService(storage);
  expect(await service.read()).toEqual(defaultCacheSettings());
  expect((await service.read()).cacheDolt).toBe(true);
  await expect(service.save({ ...defaultCacheSettings(), documentWorkspaces: 0 })).rejects.toThrow();
  await service.save({ ...defaultCacheSettings(), documentWorkspaces: 3, doltWorkspaces: 7 });
  expect(await new CacheSettingsService(storage).read()).toMatchObject({ documentWorkspaces: 3, doltWorkspaces: 7 });
  expect(storage.values.get(cacheSettingsKey)).not.toContain('token');
});

test('quota failure retains last good entry and reports non-durability', async () => {
  Object.assign(globalThis, { indexedDB });
  const store = new IndexedWorkspaceCacheStore(crypto.randomUUID()), settings = new CacheSettingsService(new MemorySettings());
  const cache = new WorkspaceCache(store, settings);
  await cache.put(scope('one'), 'blob', 'good');
  const broken: WorkspaceCacheStore = { get: key => store.get(key), list: () => store.list(), async write() { throw new Error('quota'); } };
  const restarted = new WorkspaceCache(broken, settings);
  await restarted.put(scope('one'), 'blob', 'replacement');
  expect(await restarted.get(scope('one'), 'blob')).toBe('good');
  expect((await restarted.status()).error).toContain('persistence failed');
});

test('broker restart restores verified bytes without HTTP; fresh access, revoke and corruption remain enforced', async () => {
  Object.assign(globalThis, { indexedDB });
  const id = crypto.randomUUID(), documentURL = 'https://cache.example/app/';
  let record: ConnectionRecord = { id, name: 'cache', appId: 1, clientId: 'client', user: { id: 1, login: 'user' }, installation: { id: 2, account: 'user' },
    tokens: { accessToken: 'never-in-cache', expiresAt: Date.now() + 1000000 }, hostedGrants: [{ origin: 'https://cache.example', subpath: '/app/' }] };
  const records: ConnectionStore = { async all() { return [structuredClone(record)]; }, async get() { return structuredClone(record); }, async put(next) { record = structuredClone(next); }, async remove() { throw new Error('unused'); } };
  const settings = new CacheSettingsService(new MemorySettings()), name = crypto.randomUUID();
  const store = new IndexedWorkspaceCacheStore(name);
  const text = 'persisted bytes', oid = createHash('sha1').update(`blob ${Buffer.byteLength(text)}\0${text}`).digest('hex');
  const blob = { sha: oid, size: text.length, encoding: 'base64', content: Buffer.from(text).toString('base64') };
  let network = true, objectBodies = 0;
  const fetcher: typeof fetch = async url => {
    if (!network) throw new Error('offline');
    if (String(url).includes('/repositories?')) return Response.json({ repositories: [{ full_name: 'owner/repo', private: true, default_branch: 'main' }] });
    objectBodies++; return Response.json(blob);
  };
  let cache = new WorkspaceCache(store, settings), broker = new Connections(records, fetcher, undefined, undefined, undefined, cache);
  const request = { operation: 'gitBlob', id, installationId: 2, repository: 'owner/repo', workspace: 'one', oid };
  expect(await broker.handleHosted(documentURL, request)).toMatchObject(blob);
  cache = new WorkspaceCache(new IndexedWorkspaceCacheStore(name), settings);
  broker = new Connections(records, fetcher, undefined, undefined, undefined, cache);
  network = false;
  expect(await broker.handleHosted(documentURL, { ...request, cacheOnly: true })).toMatchObject(blob);
  await expect(broker.handleHosted('https://cache.example/sibling/', { ...request, cacheOnly: true })).rejects.toThrow('no approved');
  await expect(broker.handleHosted(documentURL, request)).rejects.toThrow('failed');
  network = true;
  await broker.handleHosted(documentURL, request); expect(objectBodies).toBe(1);
  const entry = (await store.list()).find(entry => entry.namespace === 'documents')!;
  await store.write({ ...entry, value: { ...blob, content: Buffer.from('corrupt bytes!!').toString('base64') } }, []);
  await expect(broker.handleHosted(documentURL, { ...request, cacheOnly: true })).rejects.toThrow('No persisted');
  await broker.handleHosted(documentURL, request); expect(objectBodies).toBe(2);
  expect(JSON.stringify(await store.get(entry.key))).not.toContain('never-in-cache');
  await broker.handle({ operation: 'revokeOrigin', id, origin: 'https://cache.example', subpath: '/app/' });
  await expect(broker.handleHosted(documentURL, { ...request, cacheOnly: true })).rejects.toThrow('no approved');
  expect((await cache.status()).entries).toBe(0);
});

test('cached document appears while HTTP is pending and survives offline refresh, but not access denial', async () => {
  let reject!: (error: Error) => void;
  let denied = false;
  const snapshot = { id: 'snapshot', commit: 'a'.repeat(40), purpose: 'cache', documents: [{ id: 'blob:documents/note.md', path: 'note.md', size: 6 }] };
  const hooks: AppHooksV1 = { contractVersion: 1, modules: { documents: {
    version: 1, async connect() { return [{ id: 'connection', name: 'test', installationId: 2, account: 'user' }]; },
    async discover() { return [{ id: 'one', hasDocuments: true }]; }, async restore() { return snapshot; },
    async readCached() { return 'cached'; }, async read() { return 'fresh'; },
    open: () => new Promise((_, fail) => { reject = fail; }), dispose() {},
    navigation: { async load() { return { connectionId: 'connection', installationId: 2, repository: 'owner/repo', workspace: 'one', documentId: snapshot.documents[0].id }; }, async save() {}, async forget() {} },
  } } };
  for (const error of ['offline', 'Access denied']) {
    const controller = createDocumentBrowserController(hooks);
    controller.actions.connect();
    await new Promise<void>(resolve => { const stop = controller.subscribe(() => { if (controller.getSnapshot().content === 'cached') { stop(); resolve(); } }); });
    // open() starts after the preview has been delivered.
    await Promise.resolve();
    expect(controller.getSnapshot()).toMatchObject({ content: 'cached', busy: true });
    reject(new Error(error)); await new Promise(resolve => setTimeout(resolve, 0));
    denied = error === 'Access denied';
    expect(controller.getSnapshot().content).toBe(denied ? null : 'cached');
    expect(controller.getSnapshot().busy).toBe(false);
    controller.dispose();
  }
});

test('TanStack deduplicates concurrent reads but never treats mutable refs as permanently fresh', async () => {
  let calls = 0, release!: () => void;
  const query = createQueryTransport(async <T>() => { calls++; await new Promise<void>(resolve => { release = resolve; }); return [] as unknown as T; });
  const request = { operation: 'gitRefs' as const, id: crypto.randomUUID(), installationId: 2, repository: 'owner/repo', prefix: 'documents/' as const };
  const first = query.transport(request), second = query.transport(request);
  release(); await Promise.all([first, second]); expect(calls).toBe(1);
  const third = query.transport(request); release(); await third; expect(calls).toBe(2);
  query.dispose();
});

test('native JSON persistence and Git integrity work without browser-only cloning/encoding APIs', async () => {
  const db = new DatabaseSync(':memory:');
  const store = new SQLiteWorkspaceCacheStore(Promise.resolve(sqlite(db)));
  const cache = new WorkspaceCache(store, new CacheSettingsService(new MemorySettings()));
  const text = 'Native café 😀', bytes = Buffer.from(text), oid = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  vi.stubGlobal('structuredClone', undefined); vi.stubGlobal('TextEncoder', undefined); vi.stubGlobal('atob', undefined);
  try {
    await cache.put(scope('native'), 'unicode', { text });
    expect(await cache.get(scope('native'), 'unicode')).toEqual({ text });
    expect([...verifiedGitBlobBytes({ sha: oid, size: bytes.length, encoding: 'base64', content: bytes.toString('base64') })]).toEqual([...bytes]);
  } finally { vi.unstubAllGlobals(); db.close(); }
});
