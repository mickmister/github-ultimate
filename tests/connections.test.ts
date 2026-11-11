import { beforeEach, expect, test, vi } from 'vitest';
import { Connections, type ConnectionRecord, type ConnectionStore, type PublicConnection } from '../src/connections';

const defaultClient = { name: 'Example client', appId: 12345, clientId: 'Iv23ExampleClient' };

class MemoryStore implements ConnectionStore {
  records = new Map<string, ConnectionRecord>();
  async all() { return structuredClone([...this.records.values()]); }
  async get(id: string) { return structuredClone(this.records.get(id)); }
  async put(record: ConnectionRecord) { this.records.set(record.id, structuredClone(record)); }
  async remove(id: string) { this.records.delete(id); }
}
let store: MemoryStore, broker: Connections, clock: number;
let calls: { url: string; init: RequestInit }[], oauthResults: unknown[];
let permissions: Record<string, string>;
let gitResponses: Map<string, unknown>;
let apiOverride: ((url: string, init: RequestInit) => Response | undefined) | undefined;
const credentials = (suffix = 'one') => ({ access_token: `ghu_access_${suffix}`, refresh_token: `ghr_refresh_${suffix}`, token_type: 'bearer', expires_in: 28800, refresh_token_expires_in: 15897600 });
beforeEach(() => {
  store = new MemoryStore(); clock = 100000; calls = []; oauthResults = [];
  gitResponses = new Map();
  apiOverride = undefined;
  permissions = { contents: 'read', metadata: 'read', actions: 'write' };
  broker = new Connections(store, vi.fn(async (input, init = {}) => {
    const url = String(input); calls.push({ url, init });
    const override = apiOverride?.(url, init); if (override) return override;
    if (url.endsWith('/device/code')) return Response.json({ device_code: 'private-device-code', user_code: 'TEST-CODE', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 5 });
    if (url.endsWith('/oauth/access_token')) return Response.json(oauthResults.shift() ?? credentials());
    if (url.endsWith('/user')) return Response.json({ login: 'mickmister', id: 1 });
    if (url.includes('/user/installations?')) return Response.json({ installations: [
      { id: 1, app_id: defaultClient.appId, account: { login: 'mickmister' }, permissions },
      { id: 2, app_id: 999, account: { login: 'other-app' }, permissions },
    ] });
    if (url.includes('/user/installations/1/repositories?')) return Response.json({ repositories: [{ full_name: 'mickmister/workspace-storage', private: true, default_branch: 'feature/test' }] });
    if (url.endsWith('/git/ref/heads/feature/test')) return Response.json({ object: { sha: 'a'.repeat(40), type: 'commit' } });
    const route = url.split('/git/')[1];
    if (gitResponses.has(route)) return Response.json(gitResponses.get(route));
    throw new Error(`Unexpected request ${url}`);
  }), () => clock);
});
async function add(client = defaultClient) { return await broker.handle({ operation: 'add', ...client }) as PublicConnection; }
async function login(client = defaultClient) {
  const connection = await add(client);
  await broker.handle({ operation: 'start', id: connection.id }); clock += 5000;
  await broker.handle({ operation: 'poll', id: connection.id });
  return connection;
}
test('device flow enforces polling interval/slow_down and never returns device codes or tokens', async () => {
  const connection = await add();
  const started = await broker.handle({ operation: 'start', id: connection.id });
  expect(JSON.stringify(started)).toContain('TEST-CODE');
  expect(JSON.stringify(started)).not.toContain('private-device-code');
  await broker.handle({ operation: 'poll', id: connection.id });
  expect(calls).toHaveLength(1);
  oauthResults.push({ error: 'slow_down' }); clock += 5000;
  await broker.handle({ operation: 'poll', id: connection.id });
  expect((await store.get(connection.id))!.pending!.interval).toBe(10);
  clock += 5000; await broker.handle({ operation: 'poll', id: connection.id });
  expect(calls).toHaveLength(2);
  clock += 5000;
  const loggedIn = await broker.handle({ operation: 'poll', id: connection.id });
  expect(JSON.stringify(loggedIn)).not.toMatch(/ghu_|ghr_|private-device/);
  expect((await store.get(connection.id))!.tokens!.accessToken).toBe('ghu_access_one');
  const deviceRequest = new URLSearchParams(String(calls[0].init.body));
  expect(deviceRequest.get('scope')).toBe('offline_access');
  expect(calls.every(c => !String(c.init.body).includes('client_secret'))).toBe(true);
});
test('pending and denied authorization are distinct from success and expiry stops polling', async () => {
  const connection = await add(); await broker.handle({ operation: 'start', id: connection.id });
  clock += 5000; oauthResults.push({ error: 'authorization_pending' });
  expect((await broker.handle({ operation: 'poll', id: connection.id }) as PublicConnection).connected).toBe(false);
  clock += 5000; oauthResults.push({ error: 'access_denied' });
  await expect(broker.handle({ operation: 'poll', id: connection.id })).rejects.toThrow('denied');
  expect((await store.get(connection.id))!.pending).toBeUndefined();
  await broker.handle({ operation: 'start', id: connection.id }); clock += 900001;
  const count = calls.length;
  await expect(broker.handle({ operation: 'poll', id: connection.id })).rejects.toThrow('expired');
  expect(calls).toHaveLength(count);
});
test('two App connections keep independent credentials and disconnect cannot resurrect an in-flight refresh', async () => {
  const first = await login(), second = await login({ name: 'Organization client', appId: 999, clientId: 'Iv23OtherClient' });
  oauthResults.push(credentials('rotated'));
  const refresh = broker.handle({ operation: 'refresh', id: first.id });
  const disconnect = broker.handle({ operation: 'disconnect', id: first.id });
  await Promise.all([refresh, disconnect]);
  expect((await store.get(first.id))!.tokens).toBeUndefined();
  expect((await store.get(second.id))!.tokens!.accessToken).toBe('ghu_access_one');
  const secondInstallations = await broker.handle({ operation: 'installations', id: second.id });
  expect(secondInstallations).toMatchObject([{ app_id: 999, id: 2 }]);
  expect(JSON.stringify(await broker.handle({ operation: 'list' }))).not.toMatch(/ghu_|ghr_/);
});
test('expired-token reads rotate once, persist refresh credentials and use the new access token', async () => {
  const connection = await login(); clock += 28800000;
  oauthResults.push(credentials('rotated'));
  await Promise.all([broker.handle({ operation: 'installations', id: connection.id }), broker.handle({ operation: 'installations', id: connection.id })]);
  const refreshes = calls.filter(c => String(c.init.body).includes('grant_type=refresh_token'));
  expect(refreshes).toHaveLength(1);
  expect(String(refreshes[0].init.body)).toContain('refresh_token=ghr_refresh_one');
  expect(String(refreshes[0].init.body)).not.toContain('client_secret');
  expect((await store.get(connection.id))!.tokens!.refreshToken).toBe('ghr_refresh_rotated');
  expect(calls.filter(c => c.url.includes('/user/installations?')).every(c => (c.init.headers as Record<string, string>).Authorization === 'Bearer ghu_access_rotated')).toBe(true);
});
test('an invalid refresh clears credentials without disclosing error payloads', async () => {
  const connection = await login(); oauthResults.push({ error: 'bad_refresh_token', error_description: 'SECRET_SERVER_DETAIL' });
  await expect(broker.handle({ operation: 'refresh', id: connection.id })).rejects.toThrow('Refresh did not succeed');
  expect((await store.get(connection.id))!.tokens).toBeUndefined();
});
test('only installations belonging to the declared App can be selected; broad client writes are rejected', async () => {
  const connection = await login();
  const installations = await broker.handle({ operation: 'installations', id: connection.id });
  expect(installations).toHaveLength(1);
  await expect(broker.handle({ operation: 'selectInstallation', id: connection.id, installationId: 2 })).rejects.toThrow('not available');
  permissions.contents = 'write';
  await expect(broker.handle({ operation: 'selectInstallation', id: connection.id, installationId: 1 })).rejects.toThrow('writes beyond Actions');
});
test('private read is bound to selected installation, supports branch slashes, and uses only GET API requests', async () => {
  const connection = await login();
  await expect(broker.handle({ operation: 'probe', id: connection.id, repository: 'mickmister/workspace-storage' })).rejects.toThrow('Select an installation');
  await broker.handle({ operation: 'selectInstallation', id: connection.id, installationId: 1 });
  const result = await broker.handle({ operation: 'probe', id: connection.id, repository: 'mickmister/workspace-storage' });
  expect(result).toMatchObject({ private: true, headOid: 'a'.repeat(40) });
  await expect(broker.handle({ operation: 'probe', id: connection.id, repository: 'other-org/other-repo' })).rejects.toThrow('not available');
  expect(calls.filter(c => c.url.startsWith('https://api.github.com')).every(c => !c.init.method || c.init.method === 'GET')).toBe(true);
  expect(calls.every(c => c.init.redirect === 'error' && c.init.credentials === 'omit')).toBe(true);
});
test('rejects arbitrary endpoints, operations and unknown fields before sending requests', async () => {
  const connection = await add();
  expect(() => broker.handle({ operation: 'fetch', id: connection.id, url: 'https://evil.example' })).toThrow();
  expect(() => broker.handle({ operation: 'start', id: connection.id, client_secret: 'secret' })).toThrow();
  expect(calls).toHaveLength(0);
});
test('expired refresh and non-expiring device credentials require a new sign-in', async () => {
  const connection = await login(); clock += 15897600001;
  await expect(broker.handle({ operation: 'refresh', id: connection.id })).rejects.toThrow('Sign in again');
  await broker.handle({ operation: 'disconnect', id: connection.id });
  await broker.handle({ operation: 'start', id: connection.id }); clock += 5000;
  oauthResults.push({ access_token: 'non-expiring-secret', token_type: 'bearer' });
  await expect(broker.handle({ operation: 'poll', id: connection.id })).rejects.toThrow('Expected expiring');
  expect((await store.get(connection.id))!.tokens).toBeUndefined();
});

test('hosted access is exact-origin and connection scoped, read-only, revocable and credential-free', async () => {
  const first = await login(), second = await login();
  for (const connection of [first, second]) await broker.handle({ operation: 'selectInstallation', id: connection.id, installationId: 1 });
  const origin = 'https://mickmister.github.io';
  await expect(broker.handleHosted(origin, { operation: 'connections' })).rejects.toThrow('no approved');
  await broker.handle({ operation: 'grantOrigin', id: first.id, origin });
  const result = await broker.handleHosted(origin, { operation: 'connections' });
  expect(result).toMatchObject([{ id: first.id }]);
  expect(result).toHaveLength(1);
  expect(JSON.stringify(result)).not.toMatch(/ghu_|ghr_|userCode|clientId|device/);
  await expect(broker.handleHosted(origin, { operation: 'probe', id: second.id, repository: 'mickmister/workspace-storage' })).rejects.toThrow('not approved');
  await expect(broker.handleHosted('https://other.github.io', { operation: 'connections' })).rejects.toThrow('no approved');
  expect(() => broker.handleHosted(origin, { operation: 'refresh', id: first.id })).toThrow();
  expect(() => broker.handleHosted(origin, { operation: 'probe', id: first.id, repository: 'mickmister/workspace-storage', url: 'https://evil.example' })).toThrow();
  expect(await broker.handleHosted(origin, { operation: 'probe', id: first.id, repository: 'mickmister/workspace-storage' })).toMatchObject({ private: true });
  await broker.handle({ operation: 'grantOrigin', id: second.id, origin });
  expect(await broker.handleHosted(origin, { operation: 'connections' })).toHaveLength(2);
  await broker.handle({ operation: 'revokeOrigin', id: first.id, origin });
  expect(await broker.handleHosted(origin, { operation: 'connections' })).toMatchObject([{ id: second.id }]);
  await broker.handle({ operation: 'disconnect', id: second.id });
  await expect(broker.handleHosted(origin, { operation: 'connections' })).rejects.toThrow('no approved');
});

test('Git object reads recheck repository authorization, restrict ref prefixes and strip API metadata', async () => {
  const connection = await login();
  const origin = 'https://mickmister.github.io';
  await broker.handle({ operation: 'selectInstallation', id: connection.id, installationId: 1 });
  await broker.handle({ operation: 'grantOrigin', id: connection.id, origin });
  const request = { operation: 'gitRefs', id: connection.id, installationId: 1, repository: 'mickmister/workspace-storage', prefix: 'documents/' };
  const ref = { ref: 'refs/documents/workspace-a', object: { sha: 'a'.repeat(40), type: 'commit', url: 'not-returned' }, url: 'not-returned' };
  gitResponses.set('matching-refs/documents/', [ref]);
  expect(await broker.handleHosted(origin, request)).toEqual([{ ref: ref.ref, object: { sha: ref.object.sha, type: 'commit' } }]);
  const count = calls.filter(call => call.url.includes('/git/')).length;
  await expect(broker.handleHosted(origin, { ...request, repository: 'other/private' })).rejects.toThrow('not available');
  expect(calls.filter(call => call.url.includes('/git/'))).toHaveLength(count);
  for (const prefix of ['heads/', '../', 'documents/workspace-a?x=y']) expect(() => broker.handleHosted(origin, { ...request, prefix })).toThrow();
  expect(() => broker.handleHosted(origin, { ...request, url: 'https://other.invalid' })).toThrow();
  gitResponses.set('matching-refs/documents/', [{ ...ref, ref: 'refs/heads/main' }]);
  await expect(broker.handleHosted(origin, request)).rejects.toThrow('outside');
  await broker.handle({ operation: 'revokeOrigin', id: connection.id, origin });
  await expect(broker.handleHosted(origin, request)).rejects.toThrow('no approved');
});

test('Git snapshot reads reject truncated trees, identity mismatches, oversized and malformed blobs', async () => {
  const connection = await login(); const origin = 'https://mickmister.github.io', oid = 'a'.repeat(40);
  await broker.handle({ operation: 'selectInstallation', id: connection.id, installationId: 1 });
  await broker.handle({ operation: 'grantOrigin', id: connection.id, origin });
  const base = { id: connection.id, installationId: 1, repository: 'mickmister/workspace-storage', oid, workspace: 'workspace-a' };
  gitResponses.set(`commits/${oid}`, { sha: 'b'.repeat(40), tree: { sha: oid } });
  await expect(broker.handleHosted(origin, { ...base, operation: 'gitCommit' })).rejects.toThrow('identity');
  gitResponses.set(`trees/${oid}?recursive=1`, { sha: oid, truncated: true, tree: [] });
  await expect(broker.handleHosted(origin, { ...base, operation: 'gitTree' })).rejects.toThrow('truncated');
  gitResponses.set(`blobs/${oid}`, { sha: oid, size: 16 * 1024 * 1024 + 1, encoding: 'base64', content: '' });
  await expect(broker.handleHosted(origin, { ...base, operation: 'gitBlob' })).rejects.toThrow();
  gitResponses.set(`blobs/${oid}`, { sha: oid, size: 1, encoding: 'utf-8', content: 'a' });
  await expect(broker.handleHosted(origin, { ...base, operation: 'gitBlob' })).rejects.toThrow();
  gitResponses.set(`blobs/${oid}`, { sha: oid, size: 1, encoding: 'base64', content: 'YQ==', url: 'not-returned' });
  expect(await broker.handleHosted(origin, { ...base, operation: 'gitBlob' })).toEqual({ sha: oid, size: 1, encoding: 'base64', content: 'YQ==' });
  expect(calls.filter(call => call.url.includes('api.github.com')).every(call => !call.init.method)).toBe(true);
});

test('primary exhaustion persists across broker restart and blocks another App for the same user', async () => {
  const first = await login(), second = await login({ name: 'Another app', appId: 999, clientId: 'OtherClient' });
  const until = clock + 120000;
  apiOverride = url => url.includes('/user/installations?') ? Response.json({ installations: [] }, { headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(until / 1000) } }) : undefined;
  await broker.handle({ operation: 'installations', id: first.id });
  expect((await store.get(second.id))!.apiCooldown!.until).toBe(until + 1000);
  const count = calls.length;
  // A new broker with the same persistent store must not forget the budget.
  const restarted = new Connections(store, vi.fn(async () => { throw new Error('Must not fetch'); }), () => clock);
  await expect(restarted.handle({ operation: 'installations', id: second.id })).rejects.toThrow('No request was sent');
  expect(calls).toHaveLength(count);
  clock = until + 1001; apiOverride = undefined;
  await broker.handle({ operation: 'installations', id: first.id });
  expect((await store.get(first.id))!.apiCooldown).toBeUndefined();
});

test('secondary throttles honor Retry-After, back off repeated errors, and do not retry automatically', async () => {
  const connection = await login();
  apiOverride = url => url.includes('/user/installations?') ? Response.json({ message: 'secondary rate limit' }, { status: 429, headers: { 'retry-after': '90' } }) : undefined;
  const count = calls.length;
  await expect(broker.handle({ operation: 'installations', id: connection.id })).rejects.toThrow('retry after');
  expect(calls).toHaveLength(count + 1);
  const first = (await store.get(connection.id))!.apiCooldown!;
  expect(first.until).toBe(clock + 90000);
  await expect(broker.handle({ operation: 'installations', id: connection.id })).rejects.toThrow('No request was sent');
  expect(calls).toHaveLength(count + 1);
  clock = first.until + 1;
  apiOverride = url => url.includes('/user/installations?') ? Response.json({ message: 'You have exceeded a secondary rate limit.' }, { status: 403 }) : undefined;
  await expect(broker.handle({ operation: 'installations', id: connection.id })).rejects.toThrow('retry after');
  expect((await store.get(connection.id))!.apiCooldown!.until).toBe(clock + 120000);
});

test('conditional membership reads and immutable object reuse save API work without serving revoked access', async () => {
  const connection = await login(), origin = 'https://mickmister.github.io', oid = 'a'.repeat(40);
  await broker.handle({ operation: 'selectInstallation', id: connection.id, installationId: 1 });
  await broker.handle({ operation: 'grantOrigin', id: connection.id, origin });
  let memberships = 0, revoked = false;
  apiOverride = (url, init) => {
    if (!url.includes('/user/installations/1/repositories?')) return;
    memberships++;
    if (revoked) return Response.json({}, { status: 403 });
    if (memberships > 1) {
      expect((init.headers as Record<string, string>)['If-None-Match']).toBe('"repos-v1"');
      return new Response(null, { status: 304 });
    }
    return Response.json({ repositories: [{ full_name: 'mickmister/workspace-storage', private: true, default_branch: 'main' }] }, { headers: { etag: '"repos-v1"' } });
  };
  gitResponses.set(`commits/${oid}`, { sha: oid, tree: { sha: oid } });
  const request = { operation: 'gitCommit', id: connection.id, installationId: 1, repository: 'mickmister/workspace-storage', oid, workspace: 'workspace-a' };
  await broker.handleHosted(origin, request); await broker.handleHosted(origin, request);
  expect(memberships).toBe(2);
  expect(calls.filter(call => call.url.includes(`/git/commits/${oid}`))).toHaveLength(1);
  revoked = true;
  await expect(broker.handleHosted(origin, request)).rejects.toThrow('HTTP 403');
  expect((await store.get(connection.id))!.apiCooldown).toBeUndefined();
});

test('workspace access follows the requested App installation without manual binding or credential fallback', async () => {
  const first = await login(); oauthResults.push(credentials('other-app'));
  const second = await login({ name: 'Organization App', appId: 999, clientId: 'OtherClient' });
  const origin = 'https://mickmister.github.io', repository = 'mickmister/workspace-storage', workspace = 'workspace-a';
  apiOverride = url => url.includes('/user/installations/2/repositories?') ? Response.json({ repositories: [{ full_name: repository, private: true, default_branch: 'main' }] }) : undefined;
  for (const connection of [first, second]) {
    await broker.handle({ operation: 'selectInstallation', id: connection.id, installationId: connection.appId === defaultClient.appId ? 1 : 2 });
    await broker.handle({ operation: 'grantOrigin', id: connection.id, origin });
  }
  const oid = 'a'.repeat(40);
  gitResponses.set(`commits/${oid}`, { sha: oid, tree: { sha: oid } });
  const request = { operation: 'gitCommit', repository, workspace, oid };
  await broker.handleHosted(origin, { ...request, id: first.id, installationId: 1 });
  await broker.handleHosted(origin, { ...request, id: second.id, installationId: 2 });
  expect(calls.filter(call => call.url.endsWith(`/git/commits/${oid}`)).map(call => (call.init.headers as Record<string, string>).Authorization)).toEqual(['Bearer ghu_access_one', 'Bearer ghu_access_other-app']);
  await broker.handle({ operation: 'revokeOrigin', id: first.id, origin });
  const count = calls.length;
  await expect(broker.handleHosted(origin, { ...request, id: first.id, installationId: 1 })).rejects.toThrow('not approved');
  expect(calls).toHaveLength(count);
  expect(() => broker.handle({ operation: 'bindWorkspace', id: second.id, repository, workspace })).toThrow();
});

test('same App supports two workspace access routes; changed installation provenance is rejected', async () => {
  const first = await login(), second = await login();
  const origin = 'https://mickmister.github.io', repository = 'mickmister/workspace-storage';
  apiOverride = url => {
    if (url.includes('/user/installations?')) return Response.json({ installations: [
      { id: 1, app_id: defaultClient.appId, account: { login: 'personal' }, permissions },
      { id: 3, app_id: defaultClient.appId, account: { login: 'organization' }, permissions },
    ] });
    if (url.includes('/user/installations/3/repositories?')) return Response.json({ repositories: [{ full_name: repository, private: true, default_branch: 'main' }] });
  };
  const oid = 'a'.repeat(40); gitResponses.set(`commits/${oid}`, { sha: oid, tree: { sha: oid } });
  for (const [connection, installationId, workspace] of [[first, 1, 'personal-work'], [second, 3, 'organization-work']] as const) {
    await broker.handle({ operation: 'selectInstallation', id: connection.id, installationId });
    await broker.handle({ operation: 'grantOrigin', id: connection.id, origin });
    expect(await broker.handleHosted(origin, { operation: 'gitCommit', id: connection.id, installationId, repository, workspace, oid })).toMatchObject({ sha: oid });
  }
  await broker.handle({ operation: 'selectInstallation', id: second.id, installationId: 1 });
  const count = calls.length;
  await expect(broker.handleHosted(origin, { operation: 'gitCommit', id: second.id, installationId: 3, repository, workspace: 'organization-work', oid })).rejects.toThrow('installation changed');
  expect(calls).toHaveLength(count);
});
