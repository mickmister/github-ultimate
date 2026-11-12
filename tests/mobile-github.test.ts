import { describe, expect, it } from 'vitest';
import { Connections, type ConnectionRecord, type PublicConnection } from '../src/connections';
import { MobileConnectionStore } from '../src/mobile-connection-store';
import { MobileGitHub } from '../src/mobile-github';
import { grantForEntry, MobileFixtureBroker } from '../src/mobile-protocol';

const entry = 'https://pages.example/approved/app/index.html';
const context = { documentId: 'native-document', documentURL: entry, isMainFrame: true };
const id = '11111111-1111-4111-8111-111111111111';
const record = (): ConnectionRecord => ({ id, name: 'My chosen App', appId: 123, clientId: 'IvExample', user: { id: 1, login: 'owner' }, installation: { id: 7, account: 'owner' }, hostedGrants: [grantForEntry(entry)], tokens: { accessToken: 'ghu_native_secret', refreshToken: 'ghr_native_secret', expiresAt: 1e12, refreshExpiresAt: 2e12 } });
function storage() {
  const metadata = new Map<string, string>(), secrets = new Map<string, string>();
  let failMetadata = false, failVault = false;
  const plain = { async getItem(key: string) { return metadata.get(key) ?? null; }, async setItem(key: string, value: string) { if (failMetadata) throw new Error('disk failure'); metadata.set(key, value); } };
  const secure = { async getItem(key: string) { if (failVault) throw new Error('locked'); return secrets.get(key) ?? null; }, async setItem(key: string, value: string) { if (failVault) throw new Error('locked'); secrets.set(key, value); }, async removeItem(key: string) { secrets.delete(key); } };
  return { metadata, secrets, store: new MobileConnectionStore(plain, secure, () => crypto.randomUUID()), restart: () => new MobileConnectionStore(plain, secure, () => crypto.randomUUID()), failMetadata: (value: boolean) => { failMetadata = value; }, failVault: (value: boolean) => { failVault = value; } };
}
function github(store: MobileConnectionStore, enabled = () => true) {
  let clock = 1000;
  const calls: { url: string; init: RequestInit }[] = [];
  let before: ((url: string) => Promise<void>) | undefined;
  const engine = new Connections(store, async (input, init = {}) => {
    const url = String(input); calls.push({ url, init }); await before?.(url);
    if (url.endsWith('/device/code')) return Response.json({ device_code: 'private_device_code', user_code: 'USER-CODE', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 5 });
    if (url.endsWith('/oauth/access_token')) return Response.json({ access_token: 'ghu_rotated', refresh_token: 'ghr_rotated', token_type: 'bearer', expires_in: 28800, refresh_token_expires_in: 15897600 });
    if (url.endsWith('/user')) return Response.json({ id: 1, login: 'owner' });
    if (url.includes('/user/installations?')) return Response.json({ installations: [{ id: 7, app_id: 123, account: { login: 'owner' }, permissions: { contents: 'read', metadata: 'read' } }] });
    if (url.includes('/user/installations/7/repositories?')) return Response.json({ repositories: [{ full_name: 'owner/private', private: true, default_branch: 'main' }] });
    if (url.includes('/matching-refs/')) return Response.json([{ ref: 'refs/documents/workspace', object: { sha: 'a'.repeat(40), type: 'commit' } }]);
    throw new Error('Unexpected fixture route');
  }, () => clock);
  const host = new MobileGitHub(engine, enabled);
  const broker = new MobileFixtureBroker(undefined, host); broker.activate(context);
  const call = (params: object, native = context) => broker.handleAsync(native, JSON.stringify({ jsonrpc: '2.0', id: 'test_1', method: 'github.request', params }));
  return { engine, host, broker, call, calls, time: (value: number) => { clock = value; }, before: (value: typeof before) => { before = value; } };
}

describe('native GitHub credential persistence', () => {
  it('keeps device codes/tokens out of metadata, survives restart, rotates and removes only the chosen connection', async () => {
    const disk = storage(), app = github(disk.store);
    const added = await app.host.settings({ operation: 'add', name: 'User configured', appId: 123, clientId: 'IvChosenByUser' }) as PublicConnection;
    const started = await app.host.settings({ operation: 'start', id: added.id });
    expect(JSON.stringify(started)).toContain('USER-CODE');
    expect(JSON.stringify(started)).not.toContain('private_device_code');
    expect([...disk.metadata.values()].join('')).not.toMatch(/private_device_code|ghu_|ghr_/);
    expect([...disk.secrets.values()].join('')).toContain('private_device_code');
    app.time(6000); await app.host.settings({ operation: 'poll', id: added.id });
    await app.host.settings({ operation: 'selectInstallation', id: added.id, installationId: 7 });
    await app.host.settings({ operation: 'grantOrigin', id: added.id, ...grantForEntry(entry) });
    const restored = github(disk.restart());
    const response = await restored.call({ operation: 'repositories', id: added.id });
    expect(response.result).toMatchObject([{ full_name: 'owner/private', private: true }]);
    expect(JSON.stringify(response)).not.toMatch(/ghu_|ghr_|private_device/);
    const second = { ...record(), id: crypto.randomUUID() }; await disk.store.put(second);
    const beforeRotation = [...disk.secrets.keys()];
    await app.host.settings({ operation: 'refresh', id: added.id });
    expect(beforeRotation.filter(key => disk.secrets.has(key))).toHaveLength(1); // second connection only
    await app.host.settings({ operation: 'disconnect', id: added.id });
    expect((await disk.restart().get(added.id))?.tokens).toBeUndefined();
    expect((await disk.restart().get(added.id))?.hostedGrants ?? []).toEqual([]);
    expect((await disk.restart().get(second.id))?.tokens?.accessToken).toBe('ghu_native_secret');
    expect([...disk.metadata.values()].join('')).not.toMatch(/private_device_code|ghu_|ghr_/);
    await app.host.settings({ operation: 'remove', id: second.id });
    expect(disk.secrets.size).toBe(0);
  });
  it('does not commit a broken pointer or fall back to plaintext when secure/metadata writes fail', async () => {
    const disk = storage(); await disk.store.put(record());
    const committed = [...disk.secrets.entries()];
    disk.failMetadata(true);
    await expect(disk.store.put({ ...record(), tokens: { ...record().tokens!, accessToken: 'replacement' } })).rejects.toThrow('commit');
    expect([...disk.secrets.entries()]).toEqual(committed);
    disk.failMetadata(false); disk.failVault(true);
    await expect(disk.store.put(record())).rejects.toThrow('locked');
    await expect(disk.store.all()).rejects.toThrow('locked');
    expect([...disk.metadata.values()].join('')).not.toContain('ghu_');
    disk.failVault(false); expect((await disk.restart().get(id))?.tokens?.accessToken).toBe('ghu_native_secret');
    await expect(disk.store.put({ ...record(), tokens: { ...record().tokens!, accessToken: 'x'.repeat(2000) } })).rejects.toThrow('secure storage limits');
  });
  it('requires fresh sign-in and grants when backup metadata has no keystore secret', async () => {
    const disk = storage(); await disk.store.put(record()); disk.secrets.clear();
    const recovered = await disk.restart().get(id);
    expect(recovered).toMatchObject({ id, hostedGrants: [], origins: [] });
    expect(recovered?.tokens).toBeUndefined(); expect(recovered?.installation).toBeUndefined();
  });
});

describe('read-only native GitHub bridge', () => {
  it('keeps GitHub approval independent and rejects page settings, writes, forged scopes and subframes', async () => {
    const disk = storage(); await disk.store.put({ ...record(), hostedGrants: [] });
    const app = github(disk.store); app.broker.approve(grantForEntry(entry)); app.broker.approveStorage(grantForEntry(entry));
    expect((await app.call({ operation: 'connections' })).error?.message).toContain('no approved connections');
    await app.host.settings({ operation: 'grantOrigin', id, ...grantForEntry(entry) });
    const connections = await app.call({ operation: 'connections' });
    expect(connections.result).toMatchObject([{ id, name: 'My chosen App' }]);
    expect(JSON.stringify(connections)).not.toMatch(/ghu_|ghr_/);
    const discovery = await app.call({ operation: 'discover' });
    expect(discovery.result).not.toHaveProperty('capabilities', expect.arrayContaining(['reviewWrite']));
    for (const request of [{ operation: 'start', id }, { operation: 'grantOrigin', id, origin: 'https://evil.example' }, { operation: 's3Connections' }, { operation: 'connections', origin: 'https://evil.example' }]) expect((await app.call(request)).error).toBeDefined();
    expect((await app.call({ operation: 'connections' }, { ...context, isMainFrame: false })).error).toBeDefined();
    const other = { ...context, documentURL: 'https://pages.example/sibling/index.html' }; app.broker.activate(other);
    expect((await app.call({ operation: 'connections' }, other)).error).toBeDefined();
    app.broker.activate(context);
    await app.host.settings({ operation: 'revokeOrigin', id, ...grantForEntry(entry) });
    expect((await app.call({ operation: 'repositories', id })).error).toBeDefined();
  });
  it('suppresses in-flight results immediately when access is revoked', async () => {
    const disk = storage(); await disk.store.put(record()); const app = github(disk.store);
    let release!: () => void, started!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    app.before(async url => { if (url.includes('/repositories?')) { started(); await new Promise<void>(resolve => { release = resolve; }); } });
    const read = app.call({ operation: 'repositories', id }); await entered;
    const revoke = app.host.settings({ operation: 'revokeOrigin', id, ...grantForEntry(entry) });
    release(); expect((await read).error?.message).toContain('changed'); await revoke;
    expect((await app.call({ operation: 'connections' })).error).toBeDefined();
  });
  it('rejects queued reads after navigation and never sends their GitHub HTTP request', async () => {
    const disk = storage(); await disk.store.put(record()); const app = github(disk.store);
    let release!: () => void, started!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    app.before(async url => { if (url.endsWith('/oauth/access_token')) { started(); await new Promise<void>(resolve => { release = resolve; }); } });
    const refresh = app.host.settings({ operation: 'refresh', id }); await entered;
    const read = app.call({ operation: 'repositories', id }); app.broker.invalidate(); release(); await refresh;
    expect((await read).error?.message).toContain('changed');
    expect(app.calls.some(call => call.url.includes('/repositories?'))).toBe(false);
  });
  it('rotates expired credentials in secure storage before serving a private read', async () => {
    const disk = storage(); await disk.store.put({ ...record(), tokens: { ...record().tokens!, expiresAt: 0 } }); const app = github(disk.store);
    expect((await app.call({ operation: 'repositories', id })).result).toMatchObject([{ private: true }]);
    expect((app.calls.find(call => call.url.includes('/repositories?'))!.init.headers as Record<string, string>).Authorization).toBe('Bearer ghu_rotated');
    expect((await disk.restart().get(id))?.tokens?.refreshToken).toBe('ghr_rotated'); expect(disk.secrets.size).toBe(1);
  });
  it('keeps the credential feature disabled by default without making network requests', async () => {
    const disk = storage(); await disk.store.put(record()); const app = github(disk.store, () => false);
    expect((await app.call({ operation: 'connections' })).error?.message).toContain('disabled');
    await expect(app.host.settings({ operation: 'start', id })).rejects.toThrow('disabled');
    await app.host.settings({ operation: 'disconnect', id });
    expect(app.calls).toHaveLength(0); expect(disk.secrets.size).toBe(0);
  });
  it('does not disclose credential fragments in parser or OS error diagnostics', async () => {
    const disk = storage(); await disk.store.put(record()); const app = github(disk.store);
    for (const key of disk.secrets.keys()) disk.secrets.set(key, 'ghu_corrupt_private_secret');
    const response = await app.call({ operation: 'connections' });
    expect(response.error?.message).toContain('unavailable');
    expect(JSON.stringify(response)).not.toContain('ghu_'); expect(app.calls).toHaveLength(0);
  });
});
