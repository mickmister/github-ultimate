import { describe, expect, it } from 'vitest';
import { AsyncPageKVStore, PageKVService, parsePageKVRequest, type PageKVRequest } from '../src/page-kv';
import { HydratedPageStorage } from '../src/page-storage';
import { MobileFixtureBroker } from '../src/mobile-protocol';

function backing() {
  const data = new Map<string, string>();
  const store = new AsyncPageKVStore({ async getItem(key) { return data.get(key) ?? null; }, async setItem(key, value) { data.set(key, value); } });
  return { data, store };
}
const approvedURL = 'https://app.example/approved/index.html';
describe('origin-scoped privileged page storage', () => {
  it('isolates origins, subdomains and ports without accepting a page-selected namespace', async () => {
    const { store } = backing(); const service = new PageKVService(store, () => true);
    await service.request(approvedURL, { operation: 'kvSet', key: 'key.with.dots', value: '' });
    for (const url of ['https://other.example/', 'https://app.example:444/', 'https://sub.app.example/']) expect((await service.request(url, { operation: 'kvSnapshot' })).entries).toEqual([]);
    expect((await service.request('https://app.example/another/', { operation: 'kvSnapshot' })).entries).toEqual([['key.with.dots', '']]);
    expect(() => service.request(approvedURL, { operation: 'kvSnapshot', origin: 'https://other.example' })).toThrow();
  });
  it('preserves independent queued writes and survives a new broker instance', async () => {
    const { store } = backing(); const service = new PageKVService(store, () => true);
    await Promise.all(['a', 'b', '__proto__'].map(key => service.request(approvedURL, { operation: 'kvSet', key, value: 'v' })));
    const restarted = new PageKVService(store, () => true);
    expect((await restarted.request(approvedURL, { operation: 'kvSnapshot' })).entries.map(([key]) => key)).toEqual(['a', 'b', '__proto__']);
    await restarted.request(approvedURL, { operation: 'kvRemove', key: 'a' });
    expect((await restarted.request(approvedURL, { operation: 'kvSnapshot' })).entries).toHaveLength(2);
  });
  it('rechecks grant and generation for queued calls and suppresses revoked read responses', async () => {
    const { store } = backing(); let allowed = true; let current = true;
    const service = new PageKVService(store, () => allowed);
    const pending = service.request(approvedURL, { operation: 'kvSet', key: 'x', value: 'v' }, () => current);
    current = false;
    await expect(pending).rejects.toThrow('not approved');
    const request = service.request(approvedURL, { operation: 'kvSnapshot' }); allowed = false;
    await expect(request).rejects.toThrow('not approved');
    let checks = 0;
    const changing = new PageKVService(store, () => ++checks === 1);
    await expect(changing.request(approvedURL, { operation: 'kvSnapshot' })).rejects.toThrow('changed');
  });
  it('enforces quota without modifying the committed data', async () => {
    const { store } = backing(); const service = new PageKVService(store, () => true);
    for (let index = 0; index < 7; index++) await service.request(approvedURL, { operation: 'kvSet', key: String(index), value: 'x'.repeat(4096) });
    await expect(service.request(approvedURL, { operation: 'kvSet', key: 'oversized', value: 'x'.repeat(4096) })).rejects.toThrow('quota');
    expect((await service.request(approvedURL, { operation: 'kvSnapshot' })).entries).toHaveLength(7);
    expect(() => parsePageKVRequest({ operation: 'kvSet', key: 'a', value: 123 })).toThrow();
    // Escaped control characters can exceed the native wire budget even below
    // the value-length limit; reject before accepting an optimistic write.
    expect(() => parsePageKVRequest({ operation: 'kvSet', key: 'a', value: '\u0000'.repeat(4096) })).toThrow('12 KiB');
  });
  it('does not persist a stale document after awaiting authorization', async () => {
    const { data, store } = backing(); let current = true; let release!: (allowed: boolean) => void;
    const service = new PageKVService(store, () => new Promise<boolean>(resolve => { release = resolve; }));
    const request = service.request(approvedURL, { operation: 'kvSet', key: 'stale', value: 'must not commit' }, () => current);
    await Promise.resolve(); await Promise.resolve();
    current = false; release(true);
    await expect(request).rejects.toThrow('not approved');
    expect(data.size).toBe(0);
  });
  it('keeps native storage permission independent of the fixture grant and denies forged scopes/iframes', async () => {
    const { store } = backing(); const broker = new MobileFixtureBroker(store);
    const context = { documentId: 'native', documentURL: approvedURL, isMainFrame: true };
    broker.activate(context); broker.approve({ origin: 'https://app.example', subpath: '/approved/' });
    const rpc = (method: string, params = {}) => JSON.stringify({ jsonrpc: '2.0', id: 'kv1', method, params });
    expect((await broker.handleAsync(context, rpc('kv.snapshot'))).error).toBeDefined();
    broker.approveStorage({ origin: 'https://app.example', subpath: '/approved/' });
    expect((await broker.handleAsync(context, rpc('kv.set', { key: 'a.b', value: '' }))).result).toMatchObject({ entries: [['a.b', '']] });
    expect((await broker.handleAsync({ ...context, isMainFrame: false }, rpc('kv.snapshot'))).error).toBeDefined();
    expect((await broker.handleAsync(context, rpc('kv.snapshot', { origin: 'https://other.example' }))).error).toBeDefined();
    expect((await broker.handleAsync(context, rpc('kv.set', { key: 'large', value: '界'.repeat(6000) }))).error?.message).toContain('16 KiB');
    broker.approveStorage();
    expect((await broker.handleAsync(context, rpc('kv.snapshot'))).error).toBeDefined();
    expect(broker.handle(context, rpc('fixture.echo', { text: 'still approved' })).result).toEqual({ text: 'still approved' });
  });
});

describe('hydrated localStorage method adapter', () => {
  it('hydrates before use, preserves empty values/order, and persists removal/clear', async () => {
    const { store } = backing(); const service = new PageKVService(store, () => true);
    const transport = (request: PageKVRequest) => service.request(approvedURL, request);
    const first = await HydratedPageStorage.open(transport);
    first.setItem('dotted.key', ''); first.setItem('__proto__', 'safe');
    expect(first.getItem('dotted.key')).toBe(''); expect(first.getItem('missing')).toBeNull(); expect(first.length).toBe(2); expect(first.key(0)).toBe('dotted.key');
    await first.flush();
    const restored = await HydratedPageStorage.open(transport);
    expect(restored.getItem('__proto__')).toBe('safe'); restored.removeItem('dotted.key'); await restored.flush();
    await first.refresh(); expect(first.length).toBe(1);
    first.clear(); await first.flush();
    expect((await HydratedPageStorage.open(transport)).length).toBe(0);
  });
  it('reports failed/ambiguous persistence, stops queued writes, and requires explicit reopen', async () => {
    let writes = 0; const errors: string[] = [];
    const storage = await HydratedPageStorage.open(async request => {
      if (request.operation !== 'kvSnapshot') { writes++; throw new Error('revoked'); }
      return { revision: 0, entries: [] };
    }, error => errors.push(error.message));
    storage.setItem('a', '1'); storage.setItem('b', '2');
    await expect(storage.flush()).rejects.toThrow('revoked');
    expect(writes).toBe(1); expect(errors).toEqual(['revoked']);
    expect(() => storage.setItem('c', '3')).toThrow();
    expect(storage.getItem('a')).toBe('1'); // optimistic memory is not durable proof
  });
  it('does not permit a refresh result to overwrite concurrent synchronous writes', async () => {
    let release!: () => void; let reads = 0;
    const storage = await HydratedPageStorage.open(async () => {
      if (++reads > 1) await new Promise<void>(resolve => { release = resolve; });
      return { revision: 0, entries: [] };
    });
    const refresh = storage.refresh();
    expect(() => storage.setItem('a', 'new')).toThrow('refreshing');
    await Promise.resolve(); await Promise.resolve(); release(); await refresh;
  });
});
