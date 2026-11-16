import { afterEach, expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { indexedDB } from 'fake-indexeddb';
import { Connections, type ConnectionRecord, type ConnectionStore } from '../src/connections';
import { WorkspaceCache, type CacheScope } from '../src/workspace-cache';
import { CacheSettingsService, defaultCacheSettings } from '../src/cache-settings';
import { IndexedWorkspaceCacheStore } from '../src/indexed-workspace-cache';
import { SQLiteWorkspaceCacheStore, type CacheDatabase } from '../src/sqlite-workspace-cache';
import type { DocumentCacheStatus } from '../src/document-cache';
import type { GitBlob, GitTree } from '../src/git-reads';

const blob = (text: string): GitBlob => { const bytes = Buffer.from(text); return { sha: createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'), size: bytes.length, encoding: 'base64', content: bytes.toString('base64') }; };
const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });
function sqlite(db: DatabaseSync): CacheDatabase {
  return {
    async execAsync(sql) { db.exec(sql); },
    async getFirstAsync<T>(sql: string, ...params: string[]) { return db.prepare(sql).get(...params) as T ?? null; },
    async getAllAsync<T>(sql: string) { return db.prepare(sql).all() as T[]; },
    async runAsync(sql, ...params) { return db.prepare(sql).run(...params); },
    async withExclusiveTransactionAsync(work) { db.exec('BEGIN IMMEDIATE'); try { await work(sqlite(db)); db.exec('COMMIT'); } catch (error) { db.exec('ROLLBACK'); throw error; } },
  };
}
async function fixture(backend = 'indexeddb') {
  Object.assign(globalThis, { indexedDB });
  const id = crypto.randomUUID(), url = 'https://cache.example/app/';
  let record: ConnectionRecord = { id, name: 'test', appId: 1, clientId: 'test', user: { id: 1, login: 'test' }, installation: { id: 2, account: 'test' }, tokens: { accessToken: 'secret', expiresAt: Date.now() + 1000000 }, hostedGrants: [{ origin: 'https://cache.example', subpath: '/app/' }] };
  const records: ConnectionStore = { async all() { return [structuredClone(record)]; }, async get() { return structuredClone(record); }, async put(value) { record = structuredClone(value); }, async remove() {} };
  const values = new Map<string, string>();
  const settings = new CacheSettingsService({ async getItem(key) { return values.get(key) ?? null; }, async setItem(key, value) { values.set(key, value); } });
  const name = crypto.randomUUID();
  const directory = backend === 'sqlite' ? mkdtempSync(join(tmpdir(), 'document-cache-')) : '';
  let db = backend === 'sqlite' ? new DatabaseSync(join(directory, 'cache.db')) : undefined;
  if (db) cleanups.push(() => { db?.close(); rmSync(directory, { recursive: true, force: true }); });
  const storage = () => db ? new SQLiteWorkspaceCacheStore(Promise.resolve(sqlite(db))) : new IndexedWorkspaceCacheStore(name);
  let store = storage(), cache = new WorkspaceCache(store, settings);
  const bodies = new Map<string, unknown>(), fetched: string[] = [];
  let online = true, fail = '';
  const fetcher: typeof fetch = async input => {
    const path = String(input).replace('https://api.github.com', '');
    if (!online || fail && path.includes(fail)) throw new Error('offline fixture');
    if (path.includes('/repositories?')) return Response.json({ repositories: [{ full_name: 'owner/repo', private: true, default_branch: 'main' }] });
    fetched.push(path);
    if (!bodies.has(path)) return Response.json({}, { status: 404 });
    return Response.json(bodies.get(path));
  };
  let broker = new Connections(records, fetcher, undefined, undefined, undefined, cache);
  const scope: CacheScope = { connection: id, account: 1, installation: 2, repository: 'owner/repo', workspace: 'one', namespace: 'documents' };
  const base = { id, installationId: 2, repository: 'owner/repo', workspace: 'one' };
  const manifest = blob(JSON.stringify({ schema_version: 1, workspace: 'one', observed_at: '2026-11-09T00:00:00Z', purpose: 'Café Documents' }));
  function snapshot(character: string, files: Record<string, GitBlob>, extra: GitTree['tree'] = []) {
    const commit = character.repeat(40), tree = createHash('sha1').update(commit).digest('hex');
    bodies.set('/repos/owner/repo/git/matching-refs/documents/', [{ ref: 'refs/documents/one', object: { sha: commit, type: 'commit' } }]);
    bodies.set(`/repos/owner/repo/git/commits/${commit}`, { sha: commit, tree: { sha: tree } });
    const all = { 'workspace/manifest.json': manifest, ...files };
    bodies.set(`/repos/owner/repo/git/trees/${tree}?recursive=1`, { sha: tree, truncated: false, tree: [...Object.entries(all).map(([path, blob]) => ({ path: `documents/${path}`, mode: '100644', type: 'blob', sha: blob.sha, size: blob.size })), ...extra] });
    for (const value of Object.values(all)) bodies.set(`/repos/owner/repo/git/blobs/${value.sha}`, value);
    return commit;
  }
  const call = (action: 'fill' | 'restore', commit?: string, priority: string[] = []) => broker.handleHosted(url, { operation: 'documentCache', action, ...base, commit, priority }) as Promise<DocumentCacheStatus>;
  return {
    scope, settings, bodies, fetched, snapshot, call, manifest,
    get cache() { return cache; }, get store() { return store; },
    async read(oid: string, retain = false, cacheOnly = true) { return broker.handleHosted(url, { operation: 'gitBlob', ...base, oid, cacheOnly, cacheRetain: retain }); },
    offline() { online = false; }, online() { online = true; }, fail(oid: string) { fail = oid; },
    restart() { if (db) { db.close(); db = new DatabaseSync(join(directory, 'cache.db')); } store = storage(); cache = new WorkspaceCache(store, settings); broker = new Connections(records, fetcher, undefined, undefined, undefined, cache); },
    async revoke() { await broker.handle({ operation: 'revokeOrigin', id, origin: 'https://cache.example', subpath: '/app/' }); },
    async finish(commit: string) { for (let i = 0; i < 20; i++) { const result = await call('fill', commit); if (result.error || result.complete) return result; } throw new Error('Fill made no progress'); },
  };
}

test.each(['indexeddb', 'sqlite'])('%s: interrupted fill resumes after broker replacement; unopened documents restore without HTTP', async backend => {
  const f = await fixture(backend), first = blob('first'), priority = blob('open me first'), last = blob('never opened');
  const commit = f.snapshot('a', { 'a.md': first, 'z.md': priority, 'unopened.md': last });
  const partial = await f.call('fill', commit, [priority.sha]);
  expect(partial).toMatchObject({ complete: false, cached: 2, total: 4 });
  expect(f.fetched.filter(path => path.includes('/blobs/'))).toEqual([`/repos/owner/repo/git/blobs/${f.manifest.sha}`, `/repos/owner/repo/git/blobs/${priority.sha}`]);
  f.fail(first.sha); expect((await f.call('fill', commit)).error).toContain('failed');
  f.restart(); f.fail('');
  expect(await f.finish(commit)).toMatchObject({ complete: true, cached: 4, total: 4 });
  expect(f.fetched.filter(path => path.endsWith(priority.sha))).toHaveLength(1);
  f.restart(); f.offline();
  expect(await f.call('restore')).toMatchObject({ commit, complete: true, cached: 4 });
  expect(await f.read(last.sha)).toEqual(last);
  await f.revoke(); await expect(f.call('restore')).rejects.toThrow('no approved');
  expect((await f.cache.status()).entries).toBe(0);
});

test('last complete snapshot survives interrupted refresh; promotion collects old objects except review pins', async () => {
  const f = await fixture(), removed = blob('removed'), pinned = blob('reviewed revision'), added = blob('new'), later = blob('later');
  const old = f.snapshot('a', { 'old.md': removed, 'review.md': pinned });
  expect((await f.finish(old)).complete).toBe(true);
  await f.read(pinned.sha, true);
  const next = f.snapshot('b', { 'new.md': added, 'later.md': later });
  expect((await f.call('fill', next)).complete).toBe(false);
  // An old tab cannot discard or collect the newer pending inventory.
  expect(await f.call('fill', old)).toMatchObject({ commit: old, complete: true });
  f.restart(); f.offline();
  expect(await f.call('restore')).toMatchObject({ commit: old, complete: true });
  expect(await f.read(removed.sha)).toEqual(removed);
  f.online(); expect((await f.finish(next)).complete).toBe(true);
  expect(await f.cache.get(f.scope, `gitBlob:${removed.sha}`)).toBeUndefined();
  expect(await f.read(pinned.sha)).toEqual(pinned);
  expect(await f.call('restore')).toMatchObject({ commit: next, complete: true });
});

test('workspace-count eviction removes inventory and objects coherently', async () => {
  const f = await fixture(), commit = f.snapshot('a', { 'data.md': blob('data') });
  expect((await f.finish(commit)).complete).toBe(true);
  await f.settings.save({ ...defaultCacheSettings(), documentWorkspaces: 1 });
  await f.cache.put({ ...f.scope, workspace: 'other' }, 'object', 'other workspace');
  expect(await f.call('restore')).toMatchObject({ complete: false, total: 0 });
  expect(await f.cache.resources(f.scope)).toEqual([]);
});

test('over-capacity, oversized and truncated candidates never replace a complete snapshot', async () => {
  const f = await fixture(), good = f.snapshot('a', { 'good.md': blob('good') });
  expect((await f.finish(good)).complete).toBe(true);
  await f.settings.save({ ...defaultCacheSettings(), capacityMiB: 1 });
  const large = f.snapshot('b', { 'large.md': blob('x'.repeat(900000)) });
  expect((await f.finish(large)).error).toContain('capacity');
  expect(await f.call('restore')).toMatchObject({ commit: good, complete: true });
  const oversize = f.snapshot('c', {}, [{ path: 'documents/too-big.bin', type: 'blob', mode: '100644', sha: 'd'.repeat(40), size: 17 * 1024 * 1024 }]);
  expect((await f.call('fill', oversize)).error).toContain('16 MiB');
  const truncated = f.snapshot('d', {});
  for (const [path, value] of f.bodies) if (path.includes('/trees/') && JSON.stringify(value).includes('"truncated":false')) {
    if ((value as GitTree).sha === createHash('sha1').update(truncated).digest('hex')) f.bodies.set(path, { ...(value as GitTree), truncated: true });
  }
  expect((await f.call('fill', truncated)).error).toContain('truncated');
  expect(await f.call('restore')).toMatchObject({ commit: good, complete: true });
});

test('corruption invalidates completeness and is repaired; failed promotion is atomic', async () => {
  const f = await fixture(), data = blob('verified'), commit = f.snapshot('a', { 'data.md': data });
  expect((await f.finish(commit)).complete).toBe(true);
  const entry = (await f.store.list()).find(item => item.key.includes(`gitBlob:${data.sha}`))!;
  await f.store.write({ ...entry, value: { ...data, content: 'broken' } }, []);
  expect(await f.call('restore')).toMatchObject({ complete: false, cached: 1 });
  f.restart(); expect((await f.finish(commit)).complete).toBe(true);
  expect(await f.read(data.sha)).toEqual(data);
  const next = f.snapshot('b', { 'new.md': blob('replacement') });
  // Fail the adapter transaction only for the completed-snapshot index replacement.
  const write = f.store.write.bind(f.store);
  f.store.write = async (entry, remove) => {
    if (entry?.key.includes('documentSnapshots:v1') && (entry.value as { complete?: { commit: string }; pending?: unknown }).complete?.commit === next && !(entry.value as { pending?: unknown }).pending) throw new Error('quota at promotion');
    return write(entry, remove);
  };
  expect((await f.finish(next)).error).toContain('promotion');
  expect(await f.call('restore')).toMatchObject({ commit, complete: true });
  expect(await f.read(data.sha)).toEqual(data);
});
